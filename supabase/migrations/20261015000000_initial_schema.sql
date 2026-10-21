CREATE SCHEMA IF NOT EXISTS tdrive;

CREATE TABLE tdrive.users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE tdrive.sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  user_agent text,
  ip text
);
CREATE INDEX sessions_user_idx ON tdrive.sessions(user_id);
CREATE INDEX sessions_expires_idx ON tdrive.sessions(expires_at);

CREATE TABLE tdrive.folders (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  parent_id text REFERENCES tdrive.folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  path text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX folders_unique_idx ON tdrive.folders(user_id, COALESCE(parent_id, ''), name);
CREATE INDEX folders_parent_idx ON tdrive.folders(user_id, parent_id);
CREATE INDEX folders_path_idx ON tdrive.folders(user_id, path);

CREATE TABLE tdrive.files (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  folder_id text REFERENCES tdrive.folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  ext text,
  type text NOT NULL DEFAULT 'bin',
  mime text,
  size bigint NOT NULL DEFAULT 0,
  storage_key text,
  sha256 text,
  status text NOT NULL DEFAULT 'ready',
  source text NOT NULL DEFAULT 'upload',
  source_url text,
  thumb_key text,
  duration double precision,
  width integer,
  height integer,
  starred smallint NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  pinned smallint NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  trashed smallint NOT NULL DEFAULT 0 CHECK (trashed IN (0, 1)),
  trashed_at bigint,
  backend text NOT NULL DEFAULT 'telegram',
  chunk_size integer,
  thumb_tg_file_id text,
  thumb_tg_message_id bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX files_listing_idx ON tdrive.files(user_id, folder_id, trashed, updated_at);
CREATE INDEX files_trash_idx ON tdrive.files(user_id, trashed, trashed_at);
CREATE INDEX files_name_idx ON tdrive.files(user_id, name);
CREATE INDEX files_status_idx ON tdrive.files(status);

CREATE TABLE tdrive.uploads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  folder_id text REFERENCES tdrive.folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  mime text,
  size bigint NOT NULL,
  chunk_size integer NOT NULL,
  total_chunks integer NOT NULL,
  fingerprint text,
  status text NOT NULL DEFAULT 'pending',
  file_id text REFERENCES tdrive.files(id) ON DELETE SET NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE UNIQUE INDEX uploads_client_key_idx ON tdrive.uploads(user_id, client_key);
CREATE INDEX uploads_status_idx ON tdrive.uploads(status, expires_at);

CREATE TABLE tdrive.upload_chunks (
  upload_id text NOT NULL REFERENCES tdrive.uploads(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  size integer NOT NULL,
  sha256 text NOT NULL,
  received_at bigint NOT NULL,
  PRIMARY KEY (upload_id, idx)
);

CREATE TABLE tdrive.file_chunks (
  file_id text NOT NULL REFERENCES tdrive.files(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  size integer NOT NULL,
  sha256 text,
  tg_message_id bigint,
  tg_file_id text,
  cached smallint NOT NULL DEFAULT 1 CHECK (cached IN (0, 1)),
  PRIMARY KEY (file_id, idx)
);
CREATE INDEX file_chunks_file_idx ON tdrive.file_chunks(file_id, idx);

CREATE TABLE tdrive.jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text,
  progress double precision NOT NULL DEFAULT 0,
  speed text,
  eta text,
  stage text,
  total_bytes bigint,
  done_bytes bigint,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  lease_until bigint,
  lease_owner text,
  cancel_req smallint NOT NULL DEFAULT 0 CHECK (cancel_req IN (0, 1)),
  error text,
  result jsonb,
  file_id text REFERENCES tdrive.files(id) ON DELETE SET NULL,
  run_after bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX jobs_claim_idx ON tdrive.jobs(status, run_after);
CREATE INDEX jobs_user_idx ON tdrive.jobs(user_id, status, updated_at);

CREATE TABLE tdrive.settings (
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE tdrive.shares (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  file_id text REFERENCES tdrive.files(id) ON DELETE CASCADE,
  folder_id text REFERENCES tdrive.folders(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  password_hash text,
  expires_at bigint,
  max_downloads integer,
  download_count integer NOT NULL DEFAULT 0,
  views_count integer NOT NULL DEFAULT 0,
  revoked smallint NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  ip_allow text,
  permission text NOT NULL DEFAULT 'download' CHECK (permission IN ('view', 'download')),
  created_at bigint NOT NULL,
  CHECK ((file_id IS NULL) <> (folder_id IS NULL))
);
CREATE INDEX shares_user_idx ON tdrive.shares(user_id, revoked);

CREATE TABLE tdrive.activity_log (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_name text,
  ip text,
  meta jsonb,
  created_at bigint NOT NULL
);
CREATE INDEX activity_user_idx ON tdrive.activity_log(user_id, created_at);
CREATE INDEX activity_target_idx ON tdrive.activity_log(user_id, target_id, created_at);

CREATE TABLE tdrive.api_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tdrive.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_at bigint NOT NULL,
  last_used_at bigint,
  revoked_at bigint
);
CREATE INDEX api_keys_user_idx ON tdrive.api_keys(user_id, created_at);
CREATE INDEX api_keys_active_idx ON tdrive.api_keys(key_hash, revoked_at);

CREATE TABLE tdrive.kv (
  k text PRIMARY KEY,
  v text NOT NULL,
  updated_at bigint NOT NULL
);

REVOKE ALL ON SCHEMA tdrive FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA tdrive TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA tdrive TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA tdrive FROM anon, authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'sessions', 'folders', 'files', 'uploads', 'upload_chunks',
    'file_chunks', 'jobs', 'settings', 'shares', 'activity_log', 'api_keys', 'kv'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tdrive.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY service_role_all ON tdrive.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;

COMMENT ON SCHEMA tdrive IS 'Private Tdrive application data. Runtime migration from SQLite is a separate phase.';
COMMENT ON TABLE tdrive.api_keys IS 'Only SHA-256 hashes are stored; the raw API key is returned once at creation.';
