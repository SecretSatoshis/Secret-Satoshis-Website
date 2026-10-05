-- Per-run cost estimates were removed until cost tracking is designed; the ops
-- report reads actual charges from the OpenAI Costs API.
ALTER TABLE agent21_runs DROP COLUMN IF EXISTS cost_usd;
ALTER TABLE agent21_runs DROP COLUMN IF EXISTS usage_known;
