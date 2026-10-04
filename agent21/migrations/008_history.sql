-- Chat history moves from Assistant Cloud into this database. cloud_id stays as an unused legacy column.
ALTER TABLE agent21_conversations ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'New conversation';
ALTER TABLE agent21_conversations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS agent21_messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent21_conversations(id),
  owner_id text NOT NULL REFERENCES agent21_users(id), external_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')), text text NOT NULL,
  files jsonb NOT NULL DEFAULT '[]', feedback text CHECK (feedback IN ('positive','negative')),
  created_at timestamptz NOT NULL, UNIQUE(conversation_id,external_id)
);
CREATE INDEX IF NOT EXISTS agent21_messages_history ON agent21_messages(conversation_id,created_at);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent21_runs' AND column_name='cloud_user_id') THEN
    ALTER TABLE agent21_runs RENAME COLUMN cloud_user_id TO user_message_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent21_runs' AND column_name='cloud_assistant_id') THEN
    ALTER TABLE agent21_runs RENAME COLUMN cloud_assistant_id TO assistant_message_id;
  END IF;
END $$;
