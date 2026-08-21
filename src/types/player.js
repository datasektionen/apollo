/**
 * Player domain model helpers.
 */

export const PLAYER_LOOP_MODES = {
  OFF: 'off',
  ONE: 'one',
  ALL: 'all',
};

export const PLAYER_COLLECTION_TYPES = {
  MY_DEVICE_MIXES: 'my_device_mixes',
  PLAYLIST: 'playlist',
  TUTTI: 'tutti',
  GLOBAL: 'global',
};

export function normalizePlayerLoopMode(value) {
  if (value === PLAYER_LOOP_MODES.ONE) return PLAYER_LOOP_MODES.ONE;
  if (value === PLAYER_LOOP_MODES.ALL) return PLAYER_LOOP_MODES.ALL;
  return PLAYER_LOOP_MODES.OFF;
}

export function createQueueItemFromMix(mix, collectionType, collectionId = null) {
  if (!mix?.projectId || !mix?.presetId) return null;
  return {
    id: String(mix.id || `${collectionType}:${mix.projectId}:${mix.presetId}`),
    mixId: String(mix.id || ''),
    projectId: String(mix.projectId),
    presetId: String(mix.presetId),
    presetVariantKey: mix.presetVariantKey ?? null,
    advancedMix: mix.advancedMix || {},
    name: String(mix.name || mix.projectName || 'Untitled Mix'),
    projectName: String(mix.projectName || ''),
    musicalNumber: String(mix.musicalNumber || ''),
    showId: String(mix.showId || ''),
    showName: String(mix.showName || ''),
    durationMs: Number(mix.durationMs) || 0,
    canWrite: Boolean(mix.canWrite),
    collectionType,
    collectionId: collectionId ? String(collectionId) : null,
  };
}
