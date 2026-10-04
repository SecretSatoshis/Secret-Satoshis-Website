CREATE TABLE IF NOT EXISTS agent21_users (
  id text PRIMARY KEY, beta_enabled boolean NOT NULL DEFAULT false,
  deleting boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent21_conversations (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES agent21_users(id),
  cloud_id text UNIQUE, session_id text, agent_id text NOT NULL, template_id text NOT NULL,
  runtime_version text NOT NULL, deleting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent21_conversations_owner ON agent21_conversations(owner_id);
CREATE TABLE IF NOT EXISTS agent21_sessions (
  id text PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent21_conversations(id),
  environment_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent21_runs (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent21_conversations(id),
  owner_id text NOT NULL REFERENCES agent21_users(id), request_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','submitting','in_progress','completed','failed','cancelled','unknown')),
  input jsonb, display jsonb NOT NULL DEFAULT '{}', session_id text, turn_id text,
  workflow_id text, cancel_requested boolean NOT NULL DEFAULT false,
  reserved_usd numeric NOT NULL, cost_usd numeric, usage_known boolean NOT NULL DEFAULT false,
  cloud_user_id text, cloud_assistant_id text, provider_accepted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE(conversation_id,request_id)
);
CREATE INDEX IF NOT EXISTS agent21_runs_active ON agent21_runs(owner_id,state);
CREATE TABLE IF NOT EXISTS agent21_files (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES agent21_users(id),
  conversation_id uuid NOT NULL REFERENCES agent21_conversations(id), run_id uuid REFERENCES agent21_runs(id),
  kind text NOT NULL CHECK(kind IN ('upload','source','artifact')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','rejected')),
  name text NOT NULL, content_type text NOT NULL, bytes bigint NOT NULL,
  blob_path text UNIQUE NOT NULL, sha256 text, openai_file_id text,
  artifact_key text UNIQUE, provenance jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent21_calls (
  session_id text NOT NULL, turn_id text NOT NULL, call_id text NOT NULL,
  result jsonb, lease_until timestamptz, submitted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(session_id,turn_id,call_id)
);
CREATE TABLE IF NOT EXISTS agent21_spend (
  day date PRIMARY KEY, usd numeric NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent21_events (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent21_deletions (
  id uuid PRIMARY KEY, owner_id text NOT NULL, conversation_id uuid,
  state text NOT NULL DEFAULT 'pending', workflow_id text, created_at timestamptz NOT NULL DEFAULT now()
);
