import express from 'express';
import { queryScoped } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { resolveBilling } from '../utils/billing.js';

const router = express.Router();
router.use(authenticate, requireRole('lounge_admin', 'lounge_staff'));

// Live queue of pending check-ins waiting for front-desk verification.
// Uses queryScoped (not a plain pool query) because visits/corporate_accounts now have RLS
// forced even for the owning DB user — the visits_lounge_full / corp_accounts_lounge_full
// policies grant full access once the session's app.role is set to lounge_admin/lounge_staff.
router.get('/queue', async (req, res) => {
  const { rows } = await queryScoped(
    req.user,
    `SELECT v.id, v.direction, v.flight_number, v.payment_type, v.created_at,
            v.staff_consultant_id, v.department, v.branch_project, v.reference_number,
            v.passport_image_data, v.staff_id_image_data, v.consent_accepted,
            p.full_name, p.passport_number, p.nationality,
            ca.name AS corporate_account_name
     FROM visits v
     JOIN passengers p ON p.id = v.passenger_id
     LEFT JOIN corporate_accounts ca ON ca.id = v.corporate_account_id
     WHERE v.status = 'pending'
     ORDER BY v.created_at ASC`
  );
  res.json(rows);
});

// Staff confirms the passenger's identity matches their passport/boarding pass.
// This is the moment billing gets calculated and locked onto the visit record.
router.post('/verify/:visitId', async (req, res) => {
  const { visitId } = req.params;
  const visitResult = await queryScoped(req.user, 'SELECT * FROM visits WHERE id = $1', [visitId]);
  const visit = visitResult.rows[0];
  if (!visit) return res.status(404).json({ error: 'Visit not found' });
  if (visit.status !== 'pending') return res.status(400).json({ error: `Visit already ${visit.status}` });

  const billing = await resolveBilling({
    corporateAccountId: visit.corporate_account_id,
    tenantId: visit.tenant_id,
    visitDateTime: visit.visit_datetime,
  });

  const updated = await queryScoped(
    req.user,
    `UPDATE visits SET
       status = 'verified',
       verified_by_user_id = $1,
       verified_at = now(),
       lounge_cost = $2,
       agent_markup = $3,
       client_charge = $4
     WHERE id = $5
     RETURNING *`,
    [req.user.id, billing.lounge_cost, billing.agent_markup, billing.client_charge, visitId]
  );

  res.json(updated.rows[0]);
});

router.post('/reject/:visitId', async (req, res) => {
  const { rows } = await queryScoped(
    req.user,
    `UPDATE visits SET status = 'rejected', verified_by_user_id = $1, verified_at = now()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.id, req.params.visitId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Visit not found or not pending' });
  res.json(rows[0]);
});

export default router;
