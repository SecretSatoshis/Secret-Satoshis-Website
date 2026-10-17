-- The Responses engine. A conversation keeps its OpenAI conversation (the
-- Conversations API holds its items without expiry) and, while it lives, its
-- hosted shell container. Agents-only columns stay for the dormant Agents
-- engine and become optional.
ALTER TABLE agent21_conversations ADD COLUMN IF NOT EXISTS openai_conversation_id text;
ALTER TABLE agent21_conversations ADD COLUMN IF NOT EXISTS container_id text;
ALTER TABLE agent21_conversations ADD COLUMN IF NOT EXISTS container_last_at timestamptz;
ALTER TABLE agent21_conversations ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE agent21_conversations ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE agent21_conversations ALTER COLUMN runtime_version DROP NOT NULL;
-- A run's current round, so a step that stops mid-answer resumes from the last
-- response instead of starting over.
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS response_id text;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 0;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS prompt_version integer;
ALTER TABLE agent21_runs ADD COLUMN IF NOT EXISTS paths text;
CREATE INDEX IF NOT EXISTS agent21_runs_response ON agent21_runs (response_id);
-- Every stored response, kept so deletion removes them: deleting an OpenAI
-- conversation removes its items but not the responses made in it.
CREATE TABLE IF NOT EXISTS agent21_responses (
  id text PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES agent21_conversations(id),
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent21_responses_conversation ON agent21_responses (conversation_id);
-- Hosted shell containers a conversation used, kept until deleted with it.
CREATE TABLE IF NOT EXISTS agent21_containers (
  id text PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES agent21_conversations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent21_containers_conversation ON agent21_containers (conversation_id);
-- Uploads already copied into a container, so a reused one receives only new files.
CREATE TABLE IF NOT EXISTS agent21_container_files (
  container_id text NOT NULL REFERENCES agent21_containers(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES agent21_files(id) ON DELETE CASCADE,
  PRIMARY KEY (container_id, file_id)
);
-- The system prompt, published from the private repo by `pnpm ops prompt
-- publish`; exactly one version is active.
CREATE TABLE IF NOT EXISTS agent21_prompts (
  version serial PRIMARY KEY,
  sha256 text NOT NULL,
  text text NOT NULL,
  source text,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent21_prompts_active ON agent21_prompts (active) WHERE active;
-- Spend on the Responses engine: one row per answer (tokens and web searches)
-- and one per shell container (billed per 20-minute session).
ALTER TABLE agent21_usage DROP CONSTRAINT IF EXISTS agent21_usage_kind_check;
ALTER TABLE agent21_usage ADD CONSTRAINT agent21_usage_kind_check
  CHECK (kind IN ('session', 'warm', 'response', 'container'));
