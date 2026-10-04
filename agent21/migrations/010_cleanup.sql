-- The beta has no spending caps: run costs come from the OpenAI Costs API, and
-- each run keeps only its own estimate in agent21_runs.cost_usd.
DROP TABLE IF EXISTS agent21_billing_reconciliations;
DROP TABLE IF EXISTS agent21_spend;
ALTER TABLE agent21_runs DROP COLUMN IF EXISTS reserved_usd;
-- Assistant Cloud thread IDs; chat history lives in agent21_messages.
ALTER TABLE agent21_conversations DROP COLUMN IF EXISTS cloud_id;
-- One unfinished answer per user, enforced by the database instead of a global lock.
CREATE UNIQUE INDEX IF NOT EXISTS agent21_runs_one_active ON agent21_runs(owner_id) WHERE finished_at IS NULL;
