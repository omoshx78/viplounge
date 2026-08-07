-- Sample data for local testing / demo
-- Default password for ALL seeded users below is: password123

INSERT INTO tenants (id, name, contact_email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Skyline Travel Agency', 'ops@skylinetravel.example');

INSERT INTO corporate_accounts (id, tenant_id, name, billing_contact_email, report_cadence) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Acme Mining Corp', 'finance@acmemining.example', 'monthly'),
  ('33333333-3333-3333-3333-333333333333', NULL, 'Direct Corp Ltd (no agent)', 'accounts@directcorp.example', 'weekly');

-- Global default rate card
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  VALUES ('global', NULL, 50.00, 'flat', 10.00);

-- Tenant-level rate for Skyline (overrides global for anything under this tenant without a more specific rate)
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  VALUES ('tenant', '11111111-1111-1111-1111-111111111111', 50.00, 'flat', 10.00);

-- Corporate-specific rate: Acme gets a percentage markup instead of flat
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  VALUES ('corporate_account', '22222222-2222-2222-2222-222222222222', 50.00, 'percentage', 20.00);

-- Direct corp (no agent) — lounge rate only, no markup layer
INSERT INTO rate_cards (scope_type, scope_id, lounge_rate, markup_type, markup_value)
  VALUES ('corporate_account', '33333333-3333-3333-3333-333333333333', 55.00, 'flat', 0.00);

-- Platform subscription: lounge pays the software provider per verified visit
INSERT INTO platform_subscription (billing_model, rate_per_pax) VALUES ('per_pax', 1.50);

-- Users — password_hash below is bcrypt('password123')
INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('admin@lounge.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Lounge Admin', 'lounge_admin'),
  ('staff@lounge.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Front Desk Staff', 'lounge_staff');

INSERT INTO users (email, password_hash, full_name, role, tenant_id) VALUES
  ('agent@skylinetravel.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Skyline Agent', 'travel_agent', '11111111-1111-1111-1111-111111111111');

INSERT INTO users (email, password_hash, full_name, role, corporate_account_id) VALUES
  ('finance@acmemining.example', '$2a$10$MC2ma1pNKLmMoyj7bSMAG.gzqTK7g9DLH1k1cqm2MtP8ek9ARtN8a', 'Acme Finance', 'corporate_admin', '22222222-2222-2222-2222-222222222222');
