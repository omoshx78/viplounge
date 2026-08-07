import express from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate, requireRole('lounge_admin'));

// ---------- Tenants (travel agents) ----------
router.get('/tenants', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants ORDER BY name');
  res.json(rows);
});
router.post('/tenants', async (req, res) => {
  const { name, contact_email, contact_phone } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO tenants (name, contact_email, contact_phone) VALUES ($1,$2,$3) RETURNING *',
    [name, contact_email, contact_phone]
  );
  res.status(201).json(rows[0]);
});

// ---------- Corporate accounts ----------
router.get('/corporate-accounts', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ca.*, t.name AS tenant_name FROM corporate_accounts ca
     LEFT JOIN tenants t ON t.id = ca.tenant_id ORDER BY ca.name`
  );
  res.json(rows);
});
router.post('/corporate-accounts', async (req, res) => {
  const { tenant_id, name, billing_contact_name, billing_contact_email, report_cadence } = req.body;
  const { rows } = await pool.query(
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
router.get('/rate-cards', async (_req, res) => {
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

router.post('/rate-cards', async (req, res) => {
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
router.get('/platform-subscription', async (_req, res) => {
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

router.post('/platform-subscription', async (req, res) => {
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
router.post('/platform-subscription/generate-charge', async (req, res) => {
  const { period_start, period_end } = req.body;
  const plan = await pool.query(
    `SELECT * FROM platform_subscription WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`
  );
  const current = plan.rows[0];
  if (!current) return res.status(400).json({ error: 'No active subscription plan configured' });

  let paxCount = 0;
  let amountDue = 0;

  if (current.billing_model === 'per_pax') {
    const count = await pool.query(
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

export default router;
