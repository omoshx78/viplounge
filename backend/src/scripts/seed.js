import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/seed.sql'), 'utf8');
  console.log('Applying seed.sql...');
  await pool.query(sql);
  console.log('Seed data applied. Demo login password for all seeded users: password123');
  await pool.end();
}

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
