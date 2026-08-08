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

// Applies the hardcoded, non-negotiable scope for the current role directly to the query
// conditions — a travel agent ALWAYS gets AND v.tenant_id = <their own tenant>, a corporate
// admin ALWAYS gets AND v.corporate_account_id = <their own account>, regardless of what
// tenant_id/corporate_account_id the client passed in the request. This is enforced here in
// application code, not left to depend on RLS/session state alone: even if RLS were ever
// misconfigured, bypassed, or simply wrong, a travel agent's request can only ever produce SQL
// that is already restricted to their own data before it reaches the database. lounge_admin and
// lounge_staff get no additional restriction (by design, they see everything).
function applyRoleScope(user, conditions, params, i) {
  if (user.role === 'travel_agent') {
    conditions.push(`v.tenant_id = $${i}`);
    params.push(user.tenant_id);
    return i + 1;
  }
  if (user.role === 'corporate_admin') {
    conditions.push(`v.corporate_account_id = $${i}`);
    params.push(user.corporate_account_id);
    return i + 1;
  }
  return i;
}

// GET /api/visits?search=&tenant_id=&corporate_account_id=&direction=&from=&to=&sort=date&order=desc&page=1&pageSize=25
// tenant_id/corporate_account_id from the query string are only ever used as ADDITIONAL
// narrowing filters within whatever the role scope above already allows (e.g. lounge_admin
// picking a specific corporate account to look at) — they can never be used to escape it, since
// applyRoleScope's condition is always present in the query for travel_agent/corporate_admin
// regardless of what the client requests.
router.get('/', async (req, res) => {
  const {
    search = '', tenant_id, corporate_account_id, direction, status, payment_type,
    from, to, sort = 'date', order = 'desc', page = 1, pageSize = 50,
  } = req.query;

  const conditions = [];
  const params = [];
  let i = 1;

  i = applyRoleScope(req.user, conditions, params, i);

  if (search) {
    conditions.push(`(p.full_name ILIKE $${i} OR p.passport_number ILIKE $${i} OR v.staff_consultant_id ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  // A lounge role may narrow by any tenant/corporate; an agent/corporate role narrowing further
  // within their own already-enforced scope is harmless (it can only ever narrow, not widen).
  if (tenant_id) { conditions.push(`v.tenant_id = $${i}`); params.push(tenant_id); i++; }
  if (corporate_account_id) { conditions.push(`v.corporate_account_id = $${i}`); params.push(corporate_account_id); i++; }
  if (direction) { conditions.push(`v.direction = $${i}`); params.push(direction); i++; }
  if (status) { conditions.push(`v.status = $${i}`); params.push(status); i++; }
  if (payment_type) { conditions.push(`v.payment_type = $${i}`); params.push(payment_type); i++; }
  if (from) { conditions.push(`v.visit_datetime >= $${i}`); params.push(from); i++; }
  if (to) { conditions.push(`v.visit_datetime <= $${i}`); params.push(to); i++; }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.date;
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(pageSize) || 50, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  params.push(limit, offset);

  // CRITICAL: lounge_cost and agent_markup are the travel agent's cost basis and margin —
  // commercially sensitive information a corporate account must never see, even in the raw
  // API response (not just hidden in the UI). Only lounge_admin/lounge_staff/travel_agent
  // get those two columns; corporate_admin gets client_charge only. This is enforced here at
  // the query level so it holds even if someone inspects network traffic directly.
  const canSeeBreakdown = ['lounge_admin', 'lounge_staff', 'travel_agent'].includes(req.user.role);

  const { rows } = await queryScoped(
    req.user,
    `SELECT v.id, v.direction, v.flight_number, v.visit_datetime, v.status,
            v.staff_consultant_id, v.department, v.branch_project, v.reference_number,
            v.payment_type,
            ${canSeeBreakdown ? 'v.lounge_cost, v.agent_markup,' : 'NULL AS lounge_cost, NULL AS agent_markup,'}
            v.client_charge,
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

  const conditions = ['(p.full_name ILIKE $1 OR p.passport_number ILIKE $1)'];
  const params = [`%${q}%`];
  let i = 2;
  i = applyRoleScope(req.user, conditions, params, i);

  const { rows } = await queryScoped(
    req.user,
    `SELECT DISTINCT p.full_name, p.passport_number
     FROM visits v JOIN passengers p ON p.id = v.passenger_id
     WHERE ${conditions.join(' AND ')}
     LIMIT 8`,
    params
  );
  res.json(rows);
});

// Summary numbers for dashboard cards
router.get('/summary', async (req, res) => {
  const { from, to } = req.query;
  const conditions = ["status = 'verified'"];
  const params = [];
  let i = 1;
  // applyRoleScope's SQL uses the "v." alias, but this query has no join/alias — build the
  // equivalent unaliased condition directly for the two scoped roles.
  if (req.user.role === 'travel_agent') { conditions.push(`tenant_id = $${i}`); params.push(req.user.tenant_id); i++; }
  if (req.user.role === 'corporate_admin') { conditions.push(`corporate_account_id = $${i}`); params.push(req.user.corporate_account_id); i++; }
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

  const summary = rows[0];
  // Same rule as the visits list: a corporate account never sees the agent's margin,
  // even in an aggregate figure.
  if (req.user.role === 'corporate_admin') {
    delete summary.total_agent_markup;
  }
  res.json(summary);
});

// Returns the corporate accounts visible to the current user — a travel agent gets their own
// managed clients, a corporate admin gets just their own account, lounge roles get everything.
// Scoped explicitly here in application code (see applyRoleScope note above), not left to RLS
// alone. This exists because /api/admin/corporate-accounts is admin/cashier only; agents and
// corporate accounts need their own way to populate a "which of my clients" dropdown.
router.get('/my-corporate-accounts', async (req, res) => {
  const conditions = [];
  const params = [];
  let i = 1;
  if (req.user.role === 'travel_agent') { conditions.push(`ca.tenant_id = $${i}`); params.push(req.user.tenant_id); i++; }
  if (req.user.role === 'corporate_admin') { conditions.push(`ca.id = $${i}`); params.push(req.user.corporate_account_id); i++; }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await queryScoped(
    req.user,
    `SELECT ca.*, t.name AS tenant_name FROM corporate_accounts ca
     LEFT JOIN tenants t ON t.id = ca.tenant_id ${whereClause} ORDER BY ca.name`,
    params
  );
  res.json(rows);
});

// Full detail for one visit, including the passport/staff-ID photos if still within their
// 30-day retention window (null after that — see the image-purge job). Deliberately NOT
// included in the list endpoint above: base64 images are large, and a paginated list of 50
// rows each carrying two images would bloat that response for no reason. This is fetched only
// when someone actually opens a passenger's detail.
//
// IMPORTANT: this route is registered LAST, after every other specific GET route on this
// router (/search-suggest, /summary, /my-corporate-accounts) — Express matches routes in
// declaration order, and a bare "/:id" placed earlier would swallow those specific paths too.
router.get('/:id', async (req, res) => {
  const conditions = ['v.id = $1'];
  const params = [req.params.id];
  let i = 2;
  i = applyRoleScope(req.user, conditions, params, i);

  const canSeeBreakdown = ['lounge_admin', 'lounge_staff', 'travel_agent'].includes(req.user.role);

  const { rows } = await queryScoped(
    req.user,
    `SELECT v.id, v.direction, v.flight_number, v.visit_datetime, v.status,
            v.staff_consultant_id, v.department, v.branch_project, v.reference_number,
            v.payment_type,
            ${canSeeBreakdown ? 'v.lounge_cost, v.agent_markup,' : 'NULL AS lounge_cost, NULL AS agent_markup,'}
            v.client_charge, v.passport_image_data, v.staff_id_image_data, v.image_uploaded_at,
            v.payment_collected, v.payment_reference, v.payment_notes, v.payment_collected_at,
            p.full_name, p.passport_number, p.nationality, p.phone, p.email,
            ca.name AS corporate_account_name, t.name AS tenant_name
     FROM visits v
     JOIN passengers p ON p.id = v.passenger_id
     LEFT JOIN corporate_accounts ca ON ca.id = v.corporate_account_id
     LEFT JOIN tenants t ON t.id = v.tenant_id
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  if (!rows[0]) return res.status(404).json({ error: 'Visit not found, or not accessible to you' });
  res.json(rows[0]);
});

export default router;
