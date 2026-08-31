import { pool } from './db.js';

export const APP_SETTINGS_ID = 1;
export const DEFAULT_APP_NO_ACCESS_MESSAGE = 'You do not currently have any permissions. Please contact an admin if you should.';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalId(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeBoolean(value) {
  return value === true || normalizeText(value).toLowerCase() === 'true';
}

function valueFromRow(row, camelKey, snakeKey) {
  return row?.[camelKey] ?? row?.[snakeKey];
}

export function normalizeAppSettings(row = {}) {
  const noAccessMessage = normalizeText(
    valueFromRow(row, 'noAccessMessage', 'no_access_message')
  ) || DEFAULT_APP_NO_ACCESS_MESSAGE;

  return {
    defaultShowId: normalizeOptionalId(
      valueFromRow(row, 'defaultShowId', 'default_show_id')
    ),
    splitPlayerDawDefaults: normalizeBoolean(
      valueFromRow(row, 'splitPlayerDawDefaults', 'split_player_daw_defaults')
    ),
    playerDefaultShowId: normalizeOptionalId(
      valueFromRow(row, 'playerDefaultShowId', 'player_default_show_id')
    ),
    dawDefaultShowId: normalizeOptionalId(
      valueFromRow(row, 'dawDefaultShowId', 'daw_default_show_id')
    ),
    noAccessMessage,
    playerNoAccessMessage: normalizeText(
      valueFromRow(row, 'playerNoAccessMessage', 'player_no_access_message')
    ) || noAccessMessage,
    dawNoAccessMessage: normalizeText(
      valueFromRow(row, 'dawNoAccessMessage', 'daw_no_access_message')
    ) || noAccessMessage,
    updatedBy: normalizeOptionalId(valueFromRow(row, 'updatedBy', 'updated_by')),
    updatedAt: valueFromRow(row, 'updatedAt', 'updated_at') || null,
  };
}

export function getEffectiveAppSettingsForMode(settings = {}, mode = 'player') {
  const normalized = normalizeAppSettings(settings);
  const normalizedMode = String(mode || '').toLowerCase();
  const useModeSettings = normalizedMode === 'player' || normalizedMode === 'daw';
  const useDawSettings = normalizedMode === 'daw';
  return {
    defaultShowId: normalized.splitPlayerDawDefaults && useModeSettings
      ? (useDawSettings ? normalized.dawDefaultShowId : normalized.playerDefaultShowId)
      : normalized.defaultShowId,
    noAccessMessage: normalized.splitPlayerDawDefaults && useModeSettings
      ? (useDawSettings ? normalized.dawNoAccessMessage : normalized.playerNoAccessMessage)
      : normalized.noAccessMessage,
  };
}

export async function getAppSettings(db = pool) {
  const result = await db.query(
    `SELECT id,
            default_show_id AS "defaultShowId",
            split_player_daw_defaults AS "splitPlayerDawDefaults",
            player_default_show_id AS "playerDefaultShowId",
            daw_default_show_id AS "dawDefaultShowId",
            no_access_message AS "noAccessMessage",
            player_no_access_message AS "playerNoAccessMessage",
            daw_no_access_message AS "dawNoAccessMessage",
            updated_by AS "updatedBy",
            updated_at AS "updatedAt"
     FROM app_settings
     WHERE id = $1`,
    [APP_SETTINGS_ID]
  );
  return normalizeAppSettings(result.rows[0] || {});
}

export async function saveAppSettings(input = {}, actorUserId = null, db = pool) {
  const current = await getAppSettings(db);
  const merged = { ...current };
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      merged[key] = value;
    }
  });
  const next = normalizeAppSettings(merged);
  const result = await db.query(
    `INSERT INTO app_settings(
       id,
       default_show_id,
       split_player_daw_defaults,
       player_default_show_id,
       daw_default_show_id,
       no_access_message,
       player_no_access_message,
       daw_no_access_message,
       updated_by,
       updated_at
     )
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (id) DO UPDATE
     SET default_show_id = EXCLUDED.default_show_id,
         split_player_daw_defaults = EXCLUDED.split_player_daw_defaults,
         player_default_show_id = EXCLUDED.player_default_show_id,
         daw_default_show_id = EXCLUDED.daw_default_show_id,
         no_access_message = EXCLUDED.no_access_message,
         player_no_access_message = EXCLUDED.player_no_access_message,
         daw_no_access_message = EXCLUDED.daw_no_access_message,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
     RETURNING id,
               default_show_id AS "defaultShowId",
               split_player_daw_defaults AS "splitPlayerDawDefaults",
               player_default_show_id AS "playerDefaultShowId",
               daw_default_show_id AS "dawDefaultShowId",
               no_access_message AS "noAccessMessage",
               player_no_access_message AS "playerNoAccessMessage",
               daw_no_access_message AS "dawNoAccessMessage",
               updated_by AS "updatedBy",
               updated_at AS "updatedAt"`,
    [
      APP_SETTINGS_ID,
      next.defaultShowId,
      next.splitPlayerDawDefaults,
      next.playerDefaultShowId,
      next.dawDefaultShowId,
      next.noAccessMessage,
      next.playerNoAccessMessage,
      next.dawNoAccessMessage,
      normalizeOptionalId(actorUserId),
    ]
  );
  return normalizeAppSettings(result.rows[0] || next);
}
