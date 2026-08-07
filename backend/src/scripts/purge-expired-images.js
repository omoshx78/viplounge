import { pool } from '../db.js';

// Passport and staff/consultant ID images are the sensitive part of a visit record and are
// retained for a maximum of 30 days. This nulls ONLY the image columns on expiry — the rest
// of the visit row (billing figures, dates, verification status) is kept for reporting and
// reconciliation, since those don't carry the same sensitivity and finance/ops need them
// beyond 30 days.
//
// Intended to run daily via a Render Cron Job (see render.yaml) or any scheduler that can
// run `npm run purge-images` in this service's environment.

const RETENTION_DAYS = 30;

async function run() {
  const { rowCount } = await pool.query(
    `UPDATE visits
     SET passport_image_data = NULL,
         staff_id_image_data = NULL
     WHERE image_uploaded_at IS NOT NULL
       AND image_uploaded_at < now() - INTERVAL '${RETENTION_DAYS} days'
       AND (passport_image_data IS NOT NULL OR staff_id_image_data IS NOT NULL)`
  );
  console.log(`Purged images from ${rowCount} visit record(s) older than ${RETENTION_DAYS} days.`);
  await pool.end();
}

run().catch((err) => {
  console.error('Image purge failed:', err);
  process.exit(1);
});
