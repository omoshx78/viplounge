import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// Stateless connection pool — any API instance can serve any request, which is what lets
// this scale horizontally on Render without redesign as pax volume grows unpredictably.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
});

// CRITICAL: pg's Pool emits 'error' when an idle connection in the pool has a problem
// (network blip, database restart, etc). Without a listener here, Node treats that as an
// uncaught exception and kills the entire process — every route, not just the one query that
// failed. This has almost certainly been the real cause of the backend going down entirely.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

// Runs a query within a transaction that has the RLS session variables set for this
// request's user, so Postgres enforces tenant/corporate isolation at the DB layer.
//
// IMPORTANT: this uses set_config(), not "SET LOCAL x = $1". Postgres's SET command is a
// utility statement that does NOT accept bind parameters ($1) — only set_config() (a regular
// function call) does. Using SET LOCAL with a parameter here was throwing a Postgres syntax
// error on every single call, which is why RLS-scoped endpoints (visits list, search, summary)
// were failing with 500s.
export async function queryScoped(reqUser, text, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.role', $1, true)`, [reqUser?.role || '']);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [reqUser?.tenant_id || '']);
    await client.query(`SELECT set_config('app.corporate_account_id', $1, true)`, [reqUser?.corporate_account_id || '']);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
