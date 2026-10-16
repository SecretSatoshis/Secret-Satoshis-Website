-- What each OpenAI session, and each pre-warmed sandbox no session used, cost:
-- tokens, web searches and sandbox minutes, priced with lib/agent21/usage.ts.
-- Rows are kept apart from conversations and accounts, so spend survives
-- deleting a conversation or "Delete my Agent 21 data" and the per-account
-- beta allowance holds; deleting the Clerk account removes them. They hold
-- counts only, no content.
CREATE TABLE IF NOT EXISTS agent21_usage (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('session', 'warm')),
  owner_id text NOT NULL,
  conversation_id text,
  model text,
  service_tier text,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  reasoning_tokens bigint NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  sandbox_size text NOT NULL,
  sandbox_started_at timestamptz NOT NULL,
  sandbox_last_at timestamptz NOT NULL,
  model_usd numeric(12, 6) NOT NULL DEFAULT 0,
  search_usd numeric(12, 6) NOT NULL DEFAULT 0,
  sandbox_usd numeric(12, 6) NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  -- OpenAI fills a session's token usage a few seconds after a turn ends.
  usage_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent21_usage_owner ON agent21_usage (owner_id);
CREATE INDEX IF NOT EXISTS agent21_usage_conversation ON agent21_usage (conversation_id);
-- Set only when the Clerk account itself was deleted: that deletion removes the
-- account's usage rows too.
ALTER TABLE agent21_deletions ADD COLUMN IF NOT EXISTS remove_usage boolean NOT NULL DEFAULT false;
