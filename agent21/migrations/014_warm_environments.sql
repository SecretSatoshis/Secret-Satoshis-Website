-- A sandbox started from the environment template while the user writes, so the
-- next new session attaches to it instead of waiting for a cold start. One per
-- account; OpenAI expires it five minutes after creation if nothing attaches.
CREATE TABLE IF NOT EXISTS agent21_warm_environments (
  owner_id text PRIMARY KEY REFERENCES agent21_users(id) ON DELETE CASCADE,
  environment_id text,
  template_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
