import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool, queryScoped } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
// Base gate allows cashier through too, since they need to read tenants/corporate-accounts to
// pick a payer when posting a payment or generating a statement. Every other route below is
// explicitly re-locked to lounge_admin only via a second requireRole call.
router.use(authenticate, requireRole('lounge_admin', 'cashier'));

// ---------- Tenants (travel agents) ----------
// GET is shared with cashier (see base gate above); POST (creating a new agent) stays admin-only.
router.get('/tenants', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants ORDER BY name');
  res.json(rows);
});
router.post('/tenants', requireRole('lounge_admin'), async (req, res) => {
  const { name, contact_email, contact_phone } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO tenants (name, contact_email, contact_phone) VALUES ($1,$2,$3) RETURNING *',
    [name, contact_email, contact_phone]
  );
  res.status(201).json(rows[0]);
});

// ---------- Corporate accounts ----------
// Uses queryScoped, not a plain pool query — corporate_accounts has RLS forced even for the
// owning DB user; the corp_accounts_lounge_full policy grants full access once the session's
// app.role is set to lounge_admin or lounge_staff. Cashier isn't in that policy, but doesn't
// need row-level scoping here anyway — GET is shared via the base gate for the payer picker,
// while POST (creating a new corporate account) stays admin-only.
router.get('/corporate-accounts', async (req, res) => {
  const { rows } = await queryScoped(
    req.user,
    `SELECT ca.*, t.name AS tenant_name FROM corporate_accounts ca
     LEFT JOIN tenants t ON t.id = ca.tenant_id ORDER BY ca.name`
  );
  res.json(rows);
});
router.post('/corporate-accounts', requireRole('lounge_admin'), async (req, res) => {
  const { tenant_id, name, billing_contact_name, billing_contact_email, report_cadence } = req.body;
  const { rows } = await queryScoped(
    req.user,
    `INSERT INTO corporate_accounts (tenant_id, name, billing_contact_name, billing_contact_email, report_cadence)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [tenant_id || null, name, billing_contact_name, billing_contact_email, report_cadence || 'monthly']
  );
  res.status(201).json(rows[0]);
});

// ---------- Rate cards ----------
// Rates are set and edited exclusively by lounge admins per agreed contracts.
// Editing a rate never mutates history: this always INSERTs a new row and closes out
// the previous one's effective_to, so old visits keep the values that applied at the time.
router.get('/rate-cards', requireRole('lounge_admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT rc.*,
            CASE rc.scope_type
              WHEN 'tenant' THEN t.name
              WHEN 'corporate_account' THEN ca.name
              ELSE 'Global default'
            END AS scope_name
     FROM rate_cards rc
     LEFT JOIN tenants t ON rc.scope_type = 'tenant' AND t.id = rc.scope_id
     LEFT JOIN corporate_accounts ca ON rc.scope_type = 'corporate_account' AND ca.id = rc.scope_id
     WHERE rc.effective_to IS NULL
     ORDER BY rc.scope_type, scope_name`
  );
  res.json(rows);
});

router.post('/rate-cards', requireRole('lounge_admin'), async (req, res) => {
  const { scope_type, scope_id, lounge_rate, markup_type, markup_value } = req.body;
  if (!['global', 'tenant', 'corporate_account'].includes(scope_type)) {
    return res.status(400).json({ error: 'Invalid scope_type' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Close out any current active rate card for this exact scope
    await client.query(
      `UPDATE rate_cards SET effective_to = now()
       WHERE scope_type = $1 AND (scope_id = $2 OR ($2 IS NULL AND scope_id IS NULL)) AND effective_to IS NULL`,
      [scope_type, scope_id || null]
    );
    const { rows } = await client.query(
      `INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [scope_type, scope_id || null, lounge_rate, markup_type || 'flat', markup_value || 0, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to update rate card', detail: err.message });
  } finally {
    client.release();
  }
});

// ---------- Platform subscription (amount the lounge owes its software provider) ----------
// Entirely separate from passenger/corporate billing — visible to lounge_admin only.
router.get('/platform-subscription', requireRole('lounge_admin'), async (_req, res) => {
  const current = await pool.query(
    `SELECT * FROM platform_subscription WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`
  );
  const charges = await pool.query(
    `SELECT * FROM platform_subscription_charges ORDER BY period_start DESC LIMIT 12`
  );
  const outstanding = await pool.query(
    `SELECT COALESCE(SUM(amount_due - amount_paid), 0) AS total_outstanding
     FROM platform_subscription_charges WHERE status != 'paid'`
  );
  res.json({
    current_plan: current.rows[0] || null,
    recent_charges: charges.rows,
    total_outstanding: outstanding.rows[0].total_outstanding,
  });
});

router.post('/platform-subscription', requireRole('lounge_admin'), async (req, res) => {
  const { billing_model, rate_per_pax, flat_monthly_amount } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE platform_subscription SET effective_to = now() WHERE effective_to IS NULL`);
    const { rows } = await client.query(
      `INSERT INTO platform_subscription (billing_model, rate_per_pax, flat_monthly_amount)
       VALUES ($1,$2,$3) RETURNING *`,
      [billing_model, rate_per_pax || null, flat_monthly_amount || null]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to update subscription plan', detail: err.message });
  } finally {
    client.release();
  }
});

// Generates the platform subscription charge for a completed period, based on verified
// visit count (per-pax model = every visit, returning pax counted each time) or flat rate.
router.post('/platform-subscription/generate-charge', requireRole('lounge_admin'), async (req, res) => {
  const { period_start, period_end } = req.body;
  const plan = await pool.query(
    `SELECT * FROM platform_subscription WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`
  );
  const current = plan.rows[0];
  if (!current) return res.status(400).json({ error: 'No active subscription plan configured' });

  let paxCount = 0;
  let amountDue = 0;

  if (current.billing_model === 'per_pax') {
    const count = await queryScoped(
      req.user,
      `SELECT COUNT(*) FROM visits WHERE status = 'verified' AND visit_datetime BETWEEN $1 AND $2`,
      [period_start, period_end]
    );
    paxCount = Number(count.rows[0].count);
    amountDue = Number((paxCount * Number(current.rate_per_pax)).toFixed(2));
  } else {
    amountDue = Number(current.flat_monthly_amount);
  }

  const { rows } = await pool.query(
    `INSERT INTO platform_subscription_charges (period_start, period_end, pax_count, amount_due)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [period_start, period_end, paxCount, amountDue]
  );
  res.status(201).json(rows[0]);
});

// ---------- Users (logins for staff, agents, and corporate admins) ----------
// Only lounge_admin can create logins — this is how a travel agent or corporate account
// actually gets access to their own scoped dashboard after being set up above.
router.get('/users', requireRole('lounge_admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.active, u.created_at,
            t.name AS tenant_name, ca.name AS corporate_account_name
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN corporate_accounts ca ON ca.id = u.corporate_account_id
     ORDER BY u.created_at DESC`
  );
  res.json(rows);
});

router.post('/users', requireRole('lounge_admin'), async (req, res) => {
  const { email, password, full_name, role, tenant_id, corporate_account_id } = req.body;
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name and role are required' });
  }
  if (!['lounge_admin', 'lounge_staff', 'travel_agent', 'corporate_admin', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (role === 'travel_agent' && !tenant_id) {
    return res.status(400).json({ error: 'tenant_id is required for a travel_agent login' });
  }
  if (role === 'corporate_admin' && !corporate_account_id) {
    return res.status(400).json({ error: 'corporate_account_id is required for a corporate_admin login' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, tenant_id, corporate_account_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, full_name, role, tenant_id, corporate_account_id, created_at`,
      [
        email, password_hash, full_name, role,
        role === 'travel_agent' ? tenant_id : null,
        role === 'corporate_admin' ? corporate_account_id : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    res.status(500).json({ error: 'Failed to create user', detail: err.message });
  }
});

// Generates a one-time password reset link for a user who's forgotten their password.
// The admin shares this link manually (email/WhatsApp/etc.) — there's no automatic email
// delivery in this scaffold. The admin never learns the new password the user sets when they
// follow the link; only the user chooses it. Link expires after 24 hours or first use.
router.post('/users/:id/generate-reset-link', requireRole('lounge_admin'), async (req, res) => {
  const { rows: userRows } = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
  if (!userRows[0]) return res.status(404).json({ error: 'User not found' });

  const token = crypto.randomBytes(32).toString('hex');
  const token_hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
    [req.params.id, token_hash, expires_at]
  );

  // The frontend's reset page reads the token from the URL — share this exact link with the user.
  const frontendOrigin = (process.env.CORS_ORIGIN || '').split(',')[0].trim() || 'https://your-app.vercel.app';
  res.status(201).json({
    reset_link: `${frontendOrigin}/reset-password?token=${token}`,
    expires_at,
    for_email: userRows[0].email,
  });
});

export default router;
