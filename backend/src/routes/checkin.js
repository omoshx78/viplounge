import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Public endpoint — reached via the QR code. No auth: this is the passenger's own device.
// Looks up a returning passenger by passport number so the form can pre-fill their details.
router.get('/lookup/:passportNumber', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, passport_number, full_name, nationality, phone, email, default_corporate_account_id
     FROM passengers WHERE passport_number = $1`,
    [req.params.passportNumber]
  );
  if (!rows[0]) return res.status(404).json({ found: false });
  res.json({ found: true, passenger: rows[0] });
});

// Corporate account picker for the check-in form (name + which tenant, if any)
router.get('/corporate-accounts', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM corporate_accounts WHERE active = TRUE ORDER BY name`
  );
  res.json(rows);
});

// Passenger self-registration submission — creates/updates the passenger profile and
// drops a 'pending' visit into the staff verification queue. No billing is calculated yet;
// that happens on staff verification, once the visit is confirmed real.
router.post('/', async (req, res) => {
  const {
    passport_number, full_name, nationality, phone, email,
    direction, flight_number,
    sponsorship_type, corporate_account_id,
    staff_consultant_id, department, branch_project, reference_number,
    payment_type,
    passport_image_data, staff_id_image_data,
    consent_accepted,
  } = req.body;

  if (!passport_number || !full_name || !direction || !flight_number) {
    return res.status(400).json({ error: 'passport_number, full_name, direction and flight_number are required' });
  }
  if (sponsorship_type === 'corporate' && !corporate_account_id) {
    return res.status(400).json({ error: 'corporate_account_id is required for corporate sponsorship' });
  }
  if (!consent_accepted) {
    return res.status(400).json({ error: 'You must accept the data policy / terms of use to check in.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upsertPassenger = await client.query(
      `INSERT INTO passengers (passport_number, full_name, nationality, phone, email, default_corporate_account_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (passport_number) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         nationality = COALESCE(EXCLUDED.nationality, passengers.nationality),
         phone = COALESCE(EXCLUDED.phone, passengers.phone),
         email = COALESCE(EXCLUDED.email, passengers.email)
       RETURNING id`,
      [passport_number, full_name, nationality, phone, email, corporate_account_id || null]
    );
    const passengerId = upsertPassenger.rows[0].id;

    let tenantId = null;
    if (sponsorship_type === 'corporate') {
      const corp = await client.query('SELECT tenant_id FROM corporate_accounts WHERE id = $1', [corporate_account_id]);
      tenantId = corp.rows[0]?.tenant_id || null;
    }

    const hasImage = Boolean(passport_image_data || staff_id_image_data);

    const visit = await client.query(
      `INSERT INTO visits (
         passenger_id, corporate_account_id, tenant_id, direction, flight_number,
         staff_consultant_id, department, branch_project, reference_number,
         payment_type, status,
         passport_image_data, staff_id_image_data, image_uploaded_at,
         consent_accepted, consent_accepted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,now())
       RETURNING id`,
      [
        passengerId,
        sponsorship_type === 'corporate' ? corporate_account_id : null,
        tenantId,
        direction,
        flight_number,
        staff_consultant_id || null,
        department || null,
        branch_project || null,
        reference_number || null,
        sponsorship_type === 'corporate' ? 'corporate' : (payment_type || 'cash'),
        passport_image_data || null,
        staff_id_image_data || null,
        hasImage ? new Date() : null,
        true,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ visit_id: visit.rows[0].id, passenger_id: passengerId, status: 'pending' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Check-in failed', detail: err.message });
  } finally {
    client.release();
  }
});

export default router;
