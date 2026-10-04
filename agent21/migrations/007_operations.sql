-- Old budget totals are intentionally not relabeled as confirmed billing.
ALTER TABLE agent21_spend ADD COLUMN IF NOT EXISTS estimated_usd numeric CHECK (estimated_usd >= 0);
ALTER TABLE agent21_spend ADD COLUMN IF NOT EXISTS confirmed_usd numeric CHECK (confirmed_usd >= 0);
ALTER TABLE agent21_spend ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
CREATE TABLE IF NOT EXISTS agent21_billing_reconciliations (
  id uuid PRIMARY KEY,
  day date NOT NULL,
  confirmed_usd numeric NOT NULL CHECK (confirmed_usd >= 0),
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent21_billing_reconciliations_day ON agent21_billing_reconciliations(day,reconciled_at);
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS last_diagnostic jsonb;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS last_error_at timestamptz;
