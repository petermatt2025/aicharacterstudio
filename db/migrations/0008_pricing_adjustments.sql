-- Pricing review (2026-11-12): photoshoot and angle sheets use reference photos like other tools, so they move to
-- 3 credits per image; the per-workspace monthly AI-cost fair-use cap rises so Agency plans can use all their credits.
-- Only rows still at their original seeded values change, so admin edits are preserved.
UPDATE credit_rules SET credits = 12 WHERE key = 'angle_sheet' AND credits = 10 AND per_outputs = 4;
UPDATE credit_rules SET credits = 36 WHERE key = 'photoshoot' AND credits = 24 AND per_outputs = 12;
UPDATE app_settings SET value = '75', updated_at = now() WHERE key = 'workspace_monthly_cost_cap_usd' AND value = '40'::jsonb;
