export const SHOW_SETTINGS_MODES = {
  PLAYER: 'player',
  DAW: 'daw',
};

export const DEFAULT_NO_ACCESS_MESSAGE = 'You do not currently have any permissions. Please contact an admin if you should.';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalId(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function getSessionShowSettings(accessSummary = {}) {
  const settings = accessSummary?.showSettings || {};
  const sharedMessage = normalizeText(
    settings.noAccessMessage
      || accessSummary?.emptyAccessMessage
  ) || DEFAULT_NO_ACCESS_MESSAGE;
  const splitPlayerDawDefaults = settings.splitPlayerDawDefaults === true;

  return {
    defaultShowId: normalizeOptionalId(settings.defaultShowId),
    splitPlayerDawDefaults,
    playerDefaultShowId: normalizeOptionalId(settings.playerDefaultShowId),
    dawDefaultShowId: normalizeOptionalId(settings.dawDefaultShowId),
    noAccessMessage: sharedMessage,
    playerNoAccessMessage: normalizeText(
      settings.playerNoAccessMessage
        || accessSummary?.playerNoAccessMessage
    ) || sharedMessage,
    dawNoAccessMessage: normalizeText(
      settings.dawNoAccessMessage
        || accessSummary?.dawNoAccessMessage
    ) || sharedMessage,
  };
}

export function getConfiguredShowId(accessSummary, mode) {
  const settings = getSessionShowSettings(accessSummary);
  if (!settings.splitPlayerDawDefaults) {
    return settings.defaultShowId;
  }
  return mode === SHOW_SETTINGS_MODES.DAW
    ? settings.dawDefaultShowId
    : settings.playerDefaultShowId;
}

export function getNoAccessMessage(accessSummary, mode) {
  const settings = getSessionShowSettings(accessSummary);
  if (!settings.splitPlayerDawDefaults) {
    return settings.noAccessMessage;
  }
  return mode === SHOW_SETTINGS_MODES.DAW
    ? settings.dawNoAccessMessage
    : settings.playerNoAccessMessage;
}
