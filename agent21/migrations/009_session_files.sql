-- Files already copied into a sandbox, so later turns attach only new files.
CREATE TABLE IF NOT EXISTS agent21_session_files (
  session_id text NOT NULL REFERENCES agent21_sessions(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES agent21_files(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id,file_id)
);
-- Maintenance restarts a file cleanup only when its workflow is no longer running.
ALTER TABLE agent21_file_deletions ADD COLUMN IF NOT EXISTS workflow_id text;
