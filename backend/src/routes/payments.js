import express from 'express';
import { queryScoped } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Same principle as visits.js's applyRoleScope: enforced explicitly in application code, not
// left to depend on RLS/session state alone. A travel agent's payments list is always
// restricted to their own direct payments PLUS payments from any corporate account they
// manage; a corporate admin's is always restricted to their own account only.
function buildPaymentScope(user, conditions, params, i) {
  if (user.role === 'travel_agent') {
    conditions.push(`(
      (payer_type = 'tenant' AND payer_id = $${i})
      OR (payer_type = 'corporate_account' AND payer_id IN (SELECT id FROM corporate_accounts WHERE tenant_id = $${i}))
    )`);
    params.push(user.tenant_id);
    return i + 1;
  }
  if (user.role === 'corporate_admin') {
    conditions.push(`(payer_type = 'corporate_account' AND payer_id = $${i})`);
    params.push(user.corporate_account_id);
    return i + 1;
  }
  return i;
}

// Explicit yes/no check used by the statement endpoint, where the client names exactly one
// payer up front — this confirms that payer is one this user is actually allowed to see before
// running any of the balance/charge queries, rather than relying on the query itself failing
// closed. Returns true unconditionally for lounge_admin/lounge_staff/cashier.
async function isAuthorizedForPayer(user, payerType, payerId) {
  if (['lounge_admin', 'lounge_staff', 'cashier'].includes(user.role)) return true;
  if (user.role === 'travel_agent') {
    if (payerType === 'tenant') return payerId === user.tenant_id;
    if (payerType === 'corporate_account') {
      const { rows } = await queryScoped(
        user,
        'SELECT 1 FROM corporate_accounts WHERE id = $1 AND tenant_id = $2',
        [payerId, user.tenant_id]
      );
      return rows.length > 0;
    }
  }
  if (user.role === 'corporate_admin') {
    return payerType === 'corporate_account' && payerId === user.corporate_account_id;
  }
  return false;
}

// Posting a payment is a cash-handling action — restricted to cashier + lounge_admin, distinct
// from lounge_staff who can verify passengers but shouldn't be recording money received.
router.post('/', requireRole('cashier', 'lounge_admin'), async (req, res) => {
  const { payer_type, payer_id, amount, payment_date, payment_method, reference_number, notes } = req.body;
  if (!payer_type || !payer_id || !amount || !payment_method) {
    return res.status(400).json({ error: 'payer_type, payer_id, amount and payment_method are required' });
  }
  if (!['corporate_account', 'tenant'].includes(payer_type)) {
    return res.status(400).json({ error: 'Invalid payer_type' });
  }
  if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be positive' });

  const { rows } = await queryScoped(
    req.user,
    `INSERT INTO payments (payer_type, payer_id, amount, payment_date, payment_method, reference_number, notes, posted_by)
     VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6,$7,$8) RETURNING *`,
    [payer_type, payer_id, amount, payment_date || null, payment_method, reference_number || null, notes || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

// List payments — scoped explicitly in application code (see buildPaymentScope above): a
// travel agent sees their own + their clients' payments, a corporate account sees only its
// own, lounge roles and cashier see everything.
router.get('/', async (req, res) => {
  const { payer_type, payer_id } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;

  i = buildPaymentScope(req.user, conditions, params, i);

  if (payer_type) { conditions.push(`payer_type = $${i}`); params.push(payer_type); i++; }
  if (payer_id) { conditions.push(`payer_id = $${i}`); params.push(payer_id); i++; }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await queryScoped(
    req.user,
    `SELECT p.*, u.full_name AS posted_by_name
     FROM payments p LEFT JOIN users u ON u.id = p.posted_by
     ${whereClause}
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    params
  );
  res.json(rows);
});

// Statement of account: opening balance (everything before the period) + line items within
// the period (charges from visits, payments from here) + closing balance. This is the core
// billing document a corporate account or travel agent actually wants periodically.
router.get('/statement', async (req, res) => {
  const { payer_type, payer_id, from, to } = req.query;
  if (!payer_type || !payer_id || !from || !to) {
    return res.status(400).json({ error: 'payer_type, payer_id, from and to are required' });
  }
  if (!['corporate_account', 'tenant'].includes(payer_type)) {
    return res.status(400).json({ error: 'Invalid payer_type' });
  }

  const authorized = await isAuthorizedForPayer(req.user, payer_type, payer_id);
  if (!authorized) {
    return res.status(403).json({ error: "You don't have access to this account's statement" });
  }

  const visitsCol = payer_type === 'corporate_account' ? 'corporate_account_id' : 'tenant_id';

  // Charges and payments strictly before the period define the opening balance.
  const chargesBefore = await queryScoped(
    req.user,
    `SELECT COALESCE(SUM(client_charge),0) AS total FROM visits
     WHERE status = 'verified' AND ${visitsCol} = $1 AND visit_datetime < $2`,
    [payer_id, from]
  );
  const paymentsBefore = await queryScoped(
    req.user,
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments
     WHERE payer_type = $1 AND payer_id = $2 AND payment_date < $3`,
    [payer_type, payer_id, from]
  );

  // Line items actually within the period.
  const chargesInPeriod = await queryScoped(
    req.user,
    `SELECT v.id, v.visit_datetime, v.flight_number, v.direction, v.client_charge,
            p.full_name, v.staff_consultant_id, v.department
     FROM visits v JOIN passengers p ON p.id = v.passenger_id
     WHERE v.status = 'verified' AND v.${visitsCol} = $1 AND v.visit_datetime BETWEEN $2 AND $3
     ORDER BY v.visit_datetime`,
    [payer_id, from, to]
  );
  const paymentsInPeriod = await queryScoped(
    req.user,
    `SELECT * FROM payments WHERE payer_type = $1 AND payer_id = $2 AND payment_date BETWEEN $3 AND $4
     ORDER BY payment_date`,
    [payer_type, payer_id, from, to]
  );

  const openingBalance = Number(chargesBefore.rows[0].total) - Number(paymentsBefore.rows[0].total);
  const totalChargesInPeriod = chargesInPeriod.rows.reduce((sum, r) => sum + Number(r.client_charge), 0);
  const totalPaymentsInPeriod = paymentsInPeriod.rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const closingBalance = openingBalance + totalChargesInPeriod - totalPaymentsInPeriod;

  res.json({
    payer_type, payer_id, period_start: from, period_end: to,
    opening_balance: Number(openingBalance.toFixed(2)),
    charges: chargesInPeriod.rows,
    payments: paymentsInPeriod.rows,
    total_charges: Number(totalChargesInPeriod.toFixed(2)),
    total_payments: Number(totalPaymentsInPeriod.toFixed(2)),
    closing_balance: Number(closingBalance.toFixed(2)),
  });
});

export default router;
