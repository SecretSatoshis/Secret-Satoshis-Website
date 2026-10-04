ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS worker_lease_id uuid;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS worker_lease_until timestamptz;
