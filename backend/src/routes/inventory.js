import express from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
// Viewing stock and logging consumption/restock is available to lounge_staff too (they're the
// ones actually pulling items during service) — only creating items and editing reorder levels
// is admin-only, enforced per-route below rather than on the whole router.
router.use(authenticate, requireRole('lounge_admin', 'lounge_staff'));

// List all items, grouped implicitly by category (frontend groups client-side), each with a
// computed low-stock flag so the UI can warn without recalculating on every render.
router.get('/items', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT *, (current_stock <= reorder_level) AS low_stock
     FROM inventory_items WHERE active = TRUE ORDER BY category, name`
  );
  res.json(rows);
});

router.get('/summary', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total_items,
            COUNT(*) FILTER (WHERE current_stock <= reorder_level) AS low_stock_items
     FROM inventory_items WHERE active = TRUE`
  );
  res.json(rows[0]);
});

router.get('/items/:id/transactions', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS created_by_name
     FROM inventory_transactions t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.item_id = $1
     ORDER BY t.created_at DESC LIMIT 20`,
    [req.params.id]
  );
  res.json(rows);
});

// Adding new items and editing reorder levels/names is a stock-control policy decision —
// admin only, same reasoning as rate cards being admin-managed elsewhere in this system.
router.post('/items', requireRole('lounge_admin'), async (req, res) => {
  const { name, category, unit, current_stock, reorder_level, unit_cost } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
  if (!['food', 'non_alcoholic', 'alcoholic', 'supplies'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const { rows } = await pool.query(
    `INSERT INTO inventory_items (name, category, unit, current_stock, reorder_level, unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, category, unit || 'pcs', current_stock || 0, reorder_level || 0, unit_cost || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/items/:id', requireRole('lounge_admin'), async (req, res) => {
  const { name, category, unit, reorder_level, unit_cost, active } = req.body;
  const { rows } = await pool.query(
    `UPDATE inventory_items SET
       name = COALESCE($1, name),
       category = COALESCE($2, category),
       unit = COALESCE($3, unit),
       reorder_level = COALESCE($4, reorder_level),
       unit_cost = COALESCE($5, unit_cost),
       active = COALESCE($6, active)
     WHERE id = $7 RETURNING *`,
    [name, category, unit, reorder_level, unit_cost, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(rows[0]);
});

// Logs a stock movement and updates the running total in one transaction. Both staff and admin
// can do this — staff logging consumption/waste during service is the normal day-to-day case;
// restocking is usually staff or admin depending on how the lounge runs deliveries.
router.post('/items/:id/adjust', async (req, res) => {
  const { change_amount, reason, notes } = req.body;
  const amount = Number(change_amount);
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'change_amount must be a non-zero number' });
  if (!['restock', 'consumption', 'waste', 'adjustment'].includes(reason)) {
    return res.status(400).json({ error: 'Invalid reason' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT current_stock FROM inventory_items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    const newStock = Number(current.rows[0].current_stock) + amount;
    if (newStock < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `This would take stock negative (currently ${current.rows[0].current_stock}). Check the amount.` });
    }

    const updated = await client.query(
      'UPDATE inventory_items SET current_stock = $1 WHERE id = $2 RETURNING *',
      [newStock, req.params.id]
    );
    await client.query(
      `INSERT INTO inventory_transactions (item_id, change_amount, reason, notes, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, amount, reason, notes || null, req.user.id]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to adjust stock', detail: err.message });
  } finally {
    client.release();
  }
});

export default router;
