CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_show_id TEXT REFERENCES shows(id) ON DELETE SET NULL,
  split_player_daw_defaults BOOLEAN NOT NULL DEFAULT FALSE,
  player_default_show_id TEXT REFERENCES shows(id) ON DELETE SET NULL,
  daw_default_show_id TEXT REFERENCES shows(id) ON DELETE SET NULL,
  no_access_message TEXT NOT NULL DEFAULT 'You do not currently have any permissions. Please contact an admin if you should.',
  player_no_access_message TEXT NOT NULL DEFAULT 'You do not currently have any permissions. Please contact an admin if you should.',
  daw_no_access_message TEXT NOT NULL DEFAULT 'You do not currently have any permissions. Please contact an admin if you should.',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings(
  id,
  no_access_message,
  player_no_access_message,
  daw_no_access_message
)
VALUES(
  1,
  COALESCE(
    (
      SELECT NULLIF(BTRIM(empty_access_message), '')
      FROM rbac_roles
      WHERE system_key = 'default_user'
      LIMIT 1
    ),
    'You do not currently have any permissions. Please contact an admin if you should.'
  ),
  COALESCE(
    (
      SELECT NULLIF(BTRIM(empty_access_message), '')
      FROM rbac_roles
      WHERE system_key = 'default_user'
      LIMIT 1
    ),
    'You do not currently have any permissions. Please contact an admin if you should.'
  ),
  COALESCE(
    (
      SELECT NULLIF(BTRIM(empty_access_message), '')
      FROM rbac_roles
      WHERE system_key = 'default_user'
      LIMIT 1
    ),
    'You do not currently have any permissions. Please contact an admin if you should.'
  )
)
ON CONFLICT (id) DO NOTHING;
