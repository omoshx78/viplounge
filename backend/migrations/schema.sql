-- ============================================================
-- VIP Lounge Access & Billing System — PostgreSQL schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Tenants (travel agents) ----------
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Corporate accounts ----------
-- tenant_id is nullable: a corporate account with no tenant books directly with the lounge.
CREATE TABLE IF NOT EXISTS corporate_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  billing_contact_name TEXT,
  billing_contact_email TEXT,
  report_cadence TEXT NOT NULL DEFAULT 'monthly' CHECK (report_cadence IN ('daily','weekly','monthly')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Rate cards ----------
-- Rates are set and managed exclusively by lounge admins, per prior agreed contracts.
-- scope_type + scope_id determine who the rate applies to. Most specific match wins:
-- corporate_account > tenant > global (scope_id NULL, scope_type = 'global').
-- effective_from/effective_to preserve history — a rate change never rewrites past visits.
CREATE TABLE IF NOT EXISTS rate_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','tenant','corporate_account')),
  scope_id UUID, -- NULL when scope_type = 'global'
  lounge_rate NUMERIC(10,2) NOT NULL,
  markup_type TEXT NOT NULL DEFAULT 'flat' CHECK (markup_type IN ('flat','percentage')),
  markup_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ, -- NULL = still active
  created_by UUID, -- references users.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_scope ON rate_cards(scope_type, scope_id, effective_from);

-- ---------- Platform subscription (what the lounge owes its software provider) ----------
-- Entirely separate ledger from passenger/corporate billing. Never shown to agents/corporates.
CREATE TABLE IF NOT EXISTS platform_subscription (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  billing_model TEXT NOT NULL CHECK (billing_model IN ('per_pax','flat_monthly')),
  rate_per_pax NUMERIC(10,2), -- used when billing_model = 'per_pax'
  flat_monthly_amount NUMERIC(10,2), -- used when billing_model = 'flat_monthly'
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_subscription_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pax_count INTEGER NOT NULL DEFAULT 0, -- per-visit count; returning pax counted each visit
  amount_due NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding','paid','overdue')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Users (logins for every role) ----------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('lounge_admin','lounge_staff','travel_agent','corporate_admin')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- set when role = travel_agent
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE CASCADE, -- set when role = corporate_admin
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Inventory (F&B and VIP supplies stock control) ----------
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('food', 'non_alcoholic', 'alcoholic', 'supplies')),
  unit TEXT NOT NULL DEFAULT 'pcs', -- e.g. pcs, bottle, tot, kg, liter, tray
  current_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(10,2) NOT NULL DEFAULT 0, -- triggers a low-stock warning at or below this
  unit_cost NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every stock change (restock, consumption, waste, correction) is one row here — this is the
-- audit trail behind current_stock, the same "ledger, not just a running total" pattern used
-- for visits/billing elsewhere in this schema.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  change_amount NUMERIC(10,2) NOT NULL, -- positive = restock/correction up, negative = consumption/waste
  reason TEXT NOT NULL CHECK (reason IN ('restock', 'consumption', 'waste', 'adjustment')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item ON inventory_transactions(item_id, created_at);

-- ---------- Password reset tokens ----------
-- Supports self-service password changes and admin-initiated reset links. The token itself is
-- never stored in plain text — only its hash — so a database leak alone can't be used to reset
-- anyone's password.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- ---------- Passengers ----------
CREATE TABLE IF NOT EXISTS passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passport_number TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  nationality TEXT,
  phone TEXT,
  email TEXT,
  default_corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_passengers_name ON passengers USING gin (full_name gin_trgm_ops);

-- ---------- Visits (the core ledger — one row per lounge entry) ----------
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id UUID NOT NULL REFERENCES passengers(id),
  corporate_account_id UUID REFERENCES corporate_accounts(id), -- NULL = individual/cash pax
  tenant_id UUID REFERENCES tenants(id), -- denormalized from corporate_account for fast tenant-scoped queries

  direction TEXT NOT NULL CHECK (direction IN ('arrival','departure')),
  flight_number TEXT NOT NULL,
  visit_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Corporate visit metadata (captured at check-in, not roster-verified)
  staff_consultant_id TEXT,
  department TEXT,
  branch_project TEXT,
  reference_number TEXT,

  -- Document images: optional for individual/cash pax, collected for corporate pax
  -- (passport + staff/consultant ID) to support staff verification.
  -- Stored as base64 data for this scaffold — see README for moving to object storage.
  -- SENSITIVE: image_uploaded_at drives a scheduled purge (see purge-expired-images script)
  -- that nulls these two columns after 30 days. The rest of the visit row is retained
  -- indefinitely for billing/reporting — only the images themselves expire.
  passport_image_data TEXT,
  staff_id_image_data TEXT,
  image_uploaded_at TIMESTAMPTZ,

  -- Consent: passenger must accept the data policy/terms of use before submitting
  consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_accepted_at TIMESTAMPTZ,

  -- Billing split: three linked values, snapshotted at time of entry
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash','card','corporate')),
  lounge_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  agent_markup NUMERIC(10,2) NOT NULL DEFAULT 0,
  client_charge NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Verification workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visits_tenant ON visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_visits_corporate ON visits(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_visits_datetime ON visits(visit_datetime);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);

-- ---------- Invoices ----------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  corporate_account_id UUID REFERENCES corporate_accounts(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- ============================================================
-- Row-Level Security — tenant/corporate isolation enforced at the DB layer
-- ============================================================

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;

-- By default, Postgres RLS does NOT apply to a table's owner — and the database user this app
-- connects as IS the owner, since it's the same user that ran this migration. Without FORCE,
-- every policy below would be silently bypassed for all queries, making the tenant/corporate
-- isolation purely decorative. FORCE closes that gap.
ALTER TABLE visits FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE corporate_accounts FORCE ROW LEVEL SECURITY;

-- App sets these session variables per request based on the JWT (see middleware/tenantScope.js)
-- app.role: 'lounge_admin' | 'lounge_staff' | 'travel_agent' | 'corporate_admin'
-- app.tenant_id: uuid or ''
-- app.corporate_account_id: uuid or ''
--
-- Postgres has no "CREATE POLICY IF NOT EXISTS", so each policy below is dropped first if it
-- already exists — this makes the whole schema safe to run more than once (e.g. re-running
-- this migration after already applying it once won't error out).

DROP POLICY IF EXISTS visits_lounge_full ON visits;
CREATE POLICY visits_lounge_full ON visits
  USING (current_setting('app.role', true) IN ('lounge_admin','lounge_staff'));

DROP POLICY IF EXISTS visits_tenant_scoped ON visits;
CREATE POLICY visits_tenant_scoped ON visits
  USING (
    current_setting('app.role', true) = 'travel_agent'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  );

DROP POLICY IF EXISTS visits_corporate_scoped ON visits;
CREATE POLICY visits_corporate_scoped ON visits
  USING (
    current_setting('app.role', true) = 'corporate_admin'
    AND corporate_account_id = NULLIF(current_setting('app.corporate_account_id', true), '')::UUID
  );

-- The passenger self check-in form is unauthenticated (a passenger has no login) but still
-- needs to create its own visit row. This allows that one specific action — inserting a new
-- row — while constraining it to status = 'pending' only, so a crafted request can never insert
-- a row that's already 'verified' with fabricated billing figures; only staff verification
-- (which goes through queryScoped as lounge_admin/lounge_staff) can ever set status to verified.
DROP POLICY IF EXISTS visits_public_checkin_insert ON visits;
CREATE POLICY visits_public_checkin_insert ON visits
  FOR INSERT
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS invoices_lounge_full ON invoices;
CREATE POLICY invoices_lounge_full ON invoices
  USING (current_setting('app.role', true) IN ('lounge_admin','lounge_staff'));

DROP POLICY IF EXISTS invoices_tenant_scoped ON invoices;
CREATE POLICY invoices_tenant_scoped ON invoices
  USING (current_setting('app.role', true) = 'travel_agent' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS invoices_corporate_scoped ON invoices;
CREATE POLICY invoices_corporate_scoped ON invoices
  USING (current_setting('app.role', true) = 'corporate_admin' AND corporate_account_id = NULLIF(current_setting('app.corporate_account_id', true), '')::UUID);

DROP POLICY IF EXISTS corp_accounts_lounge_full ON corporate_accounts;
CREATE POLICY corp_accounts_lounge_full ON corporate_accounts
  USING (current_setting('app.role', true) IN ('lounge_admin','lounge_staff'));

DROP POLICY IF EXISTS corp_accounts_tenant_scoped ON corporate_accounts;
CREATE POLICY corp_accounts_tenant_scoped ON corporate_accounts
  USING (current_setting('app.role', true) = 'travel_agent' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS corp_accounts_self_scoped ON corporate_accounts;
CREATE POLICY corp_accounts_self_scoped ON corporate_accounts
  USING (current_setting('app.role', true) = 'corporate_admin' AND id = NULLIF(current_setting('app.corporate_account_id', true), '')::UUID);

-- The passenger check-in form is unauthenticated (a passenger has no login) but still needs to
-- read the list of active corporate accounts to populate its "which company sponsors you"
-- dropdown. This is a narrow, deliberate public exception: SELECT-only, and only the rows
-- already flagged active — it grants no access to INSERT/UPDATE/DELETE, and inactive/archived
-- corporate accounts stay invisible to it.
DROP POLICY IF EXISTS corp_accounts_public_active_read ON corporate_accounts;
CREATE POLICY corp_accounts_public_active_read ON corporate_accounts
  FOR SELECT
  USING (active = TRUE);

-- NOTE: cash/individual visits (corporate_account_id IS NULL, tenant_id IS NULL) never match
-- the tenant_scoped or corporate_scoped policies above, so they are structurally invisible
-- to every agent/corporate login and visible only to lounge_admin / lounge_staff.
