import express from 'express';
import { queryScoped } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Posting a payment is a cash-handling action — restricted to cashier + lounge_admin, distinct
// from lounge_staff who can verify passengers but shouldn't be recording money received. This
// is the actual gate; the RLS policy on payments is a DB-layer backstop behind it.
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

// List payments — RLS scopes this automatically: a travel agent sees their own + their
// clients' payments, a corporate account sees only its own, lounge roles see everything.
router.get('/', async (req, res) => {
  const { payer_type, payer_id } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;
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
