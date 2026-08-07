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

// Runs a query within a transaction that has the RLS session variables set for this
// request's user, so Postgres enforces tenant/corporate isolation at the DB layer.
export async function queryScoped(reqUser, text, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.role = $1`, [reqUser?.role || '']);
    await client.query(`SET LOCAL app.tenant_id = $1`, [reqUser?.tenant_id || '']);
    await client.query(`SET LOCAL app.corporate_account_id = $1`, [reqUser?.corporate_account_id || '']);
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
