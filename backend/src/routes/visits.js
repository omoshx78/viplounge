import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryScoped } from '../db.js';

const router = express.Router();
router.use(authenticate);

const SORTABLE_COLUMNS = {
  name: 'p.full_name',
  date: 'v.visit_datetime',
  department: 'v.department',
  amount: 'v.client_charge',
  flight: 'v.flight_number',
};

// GET /api/visits?search=&tenant_id=&corporate_account_id=&direction=&from=&to=&sort=date&order=desc&page=1&pageSize=25
// RLS (via queryScoped) already restricts rows to what this user's role/tenant/corporate is
// allowed to see, so filters here are additive narrowing within that allowed set — an agent
// passing another agent's tenant_id simply gets zero rows, never a leak.
router.get('/', async (req, res) => {
  const {
    search = '', tenant_id, corporate_account_id, direction, status,
    from, to, sort = 'date', order = 'desc', page = 1, pageSize = 50,
  } = req.query;

  const conditions = [];
  const params = [];
  let i = 1;

  if (search) {
    conditions.push(`(p.full_name ILIKE $${i} OR p.passport_number ILIKE $${i} OR v.staff_consultant_id ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  if (tenant_id) { conditions.push(`v.tenant_id = $${i}`); params.push(tenant_id); i++; }
  if (corporate_account_id) { conditions.push(`v.corporate_account_id = $${i}`); params.push(corporate_account_id); i++; }
  if (direction) { conditions.push(`v.direction = $${i}`); params.push(direction); i++; }
  if (status) { conditions.push(`v.status = $${i}`); params.push(status); i++; }
  if (from) { conditions.push(`v.visit_datetime >= $${i}`); params.push(from); i++; }
  if (to) { conditions.push(`v.visit_datetime <= $${i}`); params.push(to); i++; }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.date;
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(pageSize) || 50, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  params.push(limit, offset);

  const { rows } = await queryScoped(
    req.user,
    `SELECT v.id, v.direction, v.flight_number, v.visit_datetime, v.status,
            v.staff_consultant_id, v.department, v.branch_project, v.reference_number,
            v.payment_type, v.lounge_cost, v.agent_markup, v.client_charge,
            p.full_name, p.passport_number,
            ca.name AS corporate_account_name, t.name AS tenant_name
     FROM visits v
     JOIN passengers p ON p.id = v.passenger_id
     LEFT JOIN corporate_accounts ca ON ca.id = v.corporate_account_id
     LEFT JOIN tenants t ON t.id = v.tenant_id
     ${whereClause}
     ORDER BY ${sortCol} ${sortOrder}
     LIMIT $${i} OFFSET $${i + 1}`,
    params
  );

  res.json(rows);
});

// Type-ahead search suggestions for the pax/staff search box
router.get('/search-suggest', async (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  const { rows } = await queryScoped(
    req.user,
    `SELECT DISTINCT p.full_name, p.passport_number
     FROM visits v JOIN passengers p ON p.id = v.passenger_id
     WHERE p.full_name ILIKE $1 OR p.passport_number ILIKE $1
     LIMIT 8`,
    [`%${q}%`]
  );
  res.json(rows);
});

// Summary numbers for dashboard cards — respects the same RLS scoping.
router.get('/summary', async (req, res) => {
  const { from, to } = req.query;
  const conditions = ["status = 'verified'"];
  const params = [];
  let i = 1;
  if (from) { conditions.push(`visit_datetime >= $${i}`); params.push(from); i++; }
  if (to) { conditions.push(`visit_datetime <= $${i}`); params.push(to); i++; }

  const { rows } = await queryScoped(
    req.user,
    `SELECT
       COUNT(*) AS total_visits,
       COUNT(*) FILTER (WHERE direction = 'arrival') AS arrivals,
       COUNT(*) FILTER (WHERE direction = 'departure') AS departures,
       COUNT(*) FILTER (WHERE payment_type = 'corporate') AS corporate_visits,
       COUNT(*) FILTER (WHERE payment_type != 'corporate') AS individual_visits,
       COALESCE(SUM(client_charge) FILTER (WHERE payment_type = 'corporate'), 0) AS corporate_revenue,
       COALESCE(SUM(client_charge) FILTER (WHERE payment_type != 'corporate'), 0) AS individual_revenue,
       COALESCE(SUM(agent_markup), 0) AS total_agent_markup
     FROM visits WHERE ${conditions.join(' AND ')}`,
    params
  );
  res.json(rows[0]);
});

export default router;
