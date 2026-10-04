ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS submission jsonb;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS prior_turn_ids jsonb;
