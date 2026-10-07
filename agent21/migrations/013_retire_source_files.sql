-- Files from the retired data tools: no file has kind 'source' or provenance.
ALTER TABLE agent21_files DROP COLUMN IF EXISTS provenance;
ALTER TABLE agent21_files DROP CONSTRAINT IF EXISTS agent21_files_kind_check;
ALTER TABLE agent21_files ADD CONSTRAINT agent21_files_kind_check CHECK(kind IN ('upload','artifact'));
