-- Sample data for local testing / demo
-- Default password for ALL seeded users below is: password123
-- Safe to run more than once — every insert either uses a fixed ID with ON CONFLICT DO NOTHING,
-- or is guarded with a WHERE NOT EXISTS check, so re-running this script won't create duplicates
-- or error out.

INSERT INTO tenants (id, name, contact_email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Skyline Travel Agency', 'ops@skylinetravel.example')
ON CONFLICT (id) DO NOTHING;

INSERT INTO corporate_accounts (id, tenant_id, name, billing_contact_email, report_cadence) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Acme Mining Corp', 'finance@acmemining.example', 'monthly'),
  ('33333333-3333-3333-3333-333333333333', NULL, 'Direct Corp Ltd (no agent)', 'accounts@directcorp.example', 'weekly')
ON CONFLICT (id) DO NOTHING;

-- Global default rate card
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  SELECT 'global', NULL, 50.00, 'flat', 10.00
  WHERE NOT EXISTS (
    SELECT 1 FROM rate_cards WHERE scope_type = 'global' AND scope_id IS NULL AND effective_to IS NULL
  );

-- Tenant-level rate for Skyline (overrides global for anything under this tenant without a more specific rate)
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  SELECT 'tenant', '11111111-1111-1111-1111-111111111111', 50.00, 'flat', 10.00
  WHERE NOT EXISTS (
    SELECT 1 FROM rate_cards WHERE scope_type = 'tenant'
      AND scope_id = '11111111-1111-1111-1111-111111111111' AND effective_to IS NULL
  );

-- Corporate-specific rate: Acme gets a percentage markup instead of flat
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  SELECT 'corporate_account', '22222222-2222-2222-2222-222222222222', 50.00, 'percentage', 20.00
  WHERE NOT EXISTS (
    SELECT 1 FROM rate_cards WHERE scope_type = 'corporate_account'
      AND scope_id = '22222222-2222-2222-2222-222222222222' AND effective_to IS NULL
  );

-- Direct corp (no agent) — lounge rate only, no markup layer
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  SELECT 'corporate_account', '33333333-3333-3333-3333-333333333333', 55.00, 'flat', 0.00
  WHERE NOT EXISTS (
    SELECT 1 FROM rate_cards WHERE scope_type = 'corporate_account'
      AND scope_id = '33333333-3333-3333-3333-333333333333' AND effective_to IS NULL
  );

-- Platform subscription: lounge pays the software provider per verified visit
INSERT INTO platform_subscription (billing_model, rate_per_pax)
  SELECT 'per_pax', 1.50
  WHERE NOT EXISTS (SELECT 1 FROM platform_subscription WHERE effective_to IS NULL);

-- Users — password_hash below is bcrypt('password123')
INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('admin@lounge.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Lounge Admin', 'lounge_admin'),
  ('staff@lounge.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Front Desk Staff', 'lounge_staff')
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (email, password_hash, full_name, role, tenant_id) VALUES
  ('agent@skylinetravel.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Skyline Agent', 'travel_agent', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (email, password_hash, full_name, role, corporate_account_id) VALUES
  ('finance@acmemining.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Acme Finance', 'corporate_admin', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (email) DO NOTHING;
