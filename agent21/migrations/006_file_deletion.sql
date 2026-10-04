ALTER TABLE agent21_files DROP CONSTRAINT IF EXISTS agent21_files_state_check;
ALTER TABLE agent21_files ADD CONSTRAINT agent21_files_state_check CHECK(state IN ('pending','ready','rejected','deleting'));
CREATE TABLE IF NOT EXISTS agent21_file_deletions (
  id uuid PRIMARY KEY, owner_id text NOT NULL, conversation_id uuid NOT NULL,
  file_id uuid NOT NULL UNIQUE, state text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
