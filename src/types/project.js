import { dbToVolume, normalizePanLawDb, DEFAULT_PAN_LAW_DB } from '../utils/audio';
import { DEFAULT_AUTO_PAN_SETTINGS } from '../utils/choirAutoPan';
import { createId } from '../utils/id';
import {
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
  TRACK_CHOIR_PART_ROLES,
  getDefaultIconByRole,
} from '../utils/trackRoles';

/**
 * Project data model types (authoritative)
 * All time values are in milliseconds
 */

export const TRACK_ROLES = {
  INSTRUMENT: TRACK_ROLE_INSTRUMENT,
  LEAD: TRACK_ROLE_LEAD,
  CHOIR: TRACK_ROLE_CHOIR,
  METRONOME: TRACK_ROLE_METRONOME,
  CHOIR_PART_1: TRACK_CHOIR_PART_ROLES[0],
  CHOIR_PART_2: TRACK_CHOIR_PART_ROLES[1],
  CHOIR_PART_3: TRACK_CHOIR_PART_ROLES[2],
  CHOIR_PART_4: TRACK_CHOIR_PART_ROLES[3],
  CHOIR_PART_5: TRACK_CHOIR_PART_ROLES[4],
  OTHER: TRACK_ROLE_OTHER,
};

export const SAMPLE_RATE = 44100;
export const DEFAULT_EXPORT_SETTINGS = {
  transformedPanRange: 100,
  practiceFocusDiffDb: 0,
  panLawDb: DEFAULT_PAN_LAW_DB,
  forceMonoOutput: false,
};

export function normalizeProjectPublished(value = false) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

export function normalizeExportSettings(settings = {}) {
  const next = {
    ...DEFAULT_EXPORT_SETTINGS,
    ...settings,
  };
  const transformedPanRange = Number(next.transformedPanRange);
  const practiceFocusDiffDb = Number(next.practiceFocusDiffDb);
  next.panLawDb = normalizePanLawDb(next.panLawDb ?? next.legacyPanLawDb ?? DEFAULT_PAN_LAW_DB);
  next.forceMonoOutput = next.forceMonoOutput === true;
  next.transformedPanRange = Number.isFinite(transformedPanRange)
    ? Math.max(0, Math.min(200, transformedPanRange))
    : DEFAULT_EXPORT_SETTINGS.transformedPanRange;
  next.practiceFocusDiffDb = Number.isFinite(practiceFocusDiffDb)
    ? Math.max(-6, Math.min(6, practiceFocusDiffDb))
    : DEFAULT_EXPORT_SETTINGS.practiceFocusDiffDb;
  return next;
}

/**
 * @typedef {Object} Clip
 * @property {string} id - UUID
 * @property {string} blobId - IndexedDB blob reference
 * @property {number} timelineStartMs - Position on timeline in milliseconds
 * @property {number} sourceStartMs - Start position in source audio (ms)
 * @property {number} sourceDurationMs - Duration of source audio (ms)
 * @property {number} cropStartMs - Crop start offset (ms)
 * @property {number} cropEndMs - Crop end offset (ms)
 * @property {number} gainDb - Gain adjustment in dB
 * @property {boolean} muted - Clip mute state
 */

/**
 * @typedef {Object} Track
 * @property {string} id - UUID
 * @property {'audio'} type - Track node type
 * @property {string} name - Track name
 * @property {boolean} part - Whether this track represents a musical part scope
 * @property {string} role - Track role (from TRACK_ROLES)
 * @property {string} icon - Track icon key
 * @property {number} volume - Volume (0-100, maps to -60dB to 0dB)
 * @property {number} pan - Pan (-100 to +100, maps to -1 to +1)
 * @property {number} [autoPanStoredPan] - Pan to restore if the track leaves choir while auto-pan is on
 * @property {boolean} muted - Mute state
 * @property {boolean} soloed - Solo state
 * @property {Clip[]} clips - Array of clips on this track
 */

/**
 * @typedef {Object} Loop
 * @property {boolean} enabled - Loop enabled state
 * @property {number} startMs - Loop start in milliseconds
 * @property {number} endMs - Loop end in milliseconds
 */

/**
 * @typedef {Object} Project
 * @property {string} projectId - UUID
 * @property {string} projectName - Project name
 * @property {string} musicalNumber - Musical number (must start with "<number>.")
 * @property {boolean} published - Whether everyone can see and listen to the tutti mix
 * @property {number} sampleRate - Sample rate (always 44100)
 * @property {number} masterVolume - Master volume (0-100)
 * @property {Object} autoPan - Auto-pan configuration
 * @property {boolean} autoPan.enabled - Auto-pan enabled
 * @property {string} autoPan.strategy - Auto-pan strategy id
 * @property {boolean} autoPan.inverted - Invert pan direction
 * @property {boolean} autoPan.manualChoirParts - Use manual choir part selection
 * @property {number} autoPan.rangeLimit - Max pan range
 * @property {number} autoPan.spreadK - Spread factor
 * @property {Object} exportSettings - Export configuration
 * @property {number} exportSettings.transformedPanRange - Pan transform range control (0-200)
 * @property {number} exportSettings.practiceFocusDiffDb - Practice backing level difference from focus in dB (-6 to 6)
 * @property {number} exportSettings.panLawDb - Stereo export pan law in dB at center (0, -3, -4.5, -6)
 * @property {boolean} exportSettings.forceMonoOutput - Export mono output instead of stereo
 * @property {Array} trackTree - Hierarchy nodes for groups/tracks
 * @property {Track[]} tracks - Array of tracks
 * @property {Loop} loop - Loop configuration
 */

/**
 * Create a new empty project
 */
export function createEmptyProject(
  name = 'Untitled Project',
  autoPan = null,
  exportSettings = null,
  musicalNumber = '0.0'
) {
  return {
    projectId: createId(),
    projectName: name,
    musicalNumber: String(musicalNumber || '0.0').trim() || '0.0',
    published: false,
    sampleRate: SAMPLE_RATE,
    masterVolume: dbToVolume(0),
    autoPan: autoPan ?? { ...DEFAULT_AUTO_PAN_SETTINGS },
    exportSettings: normalizeExportSettings(exportSettings || {}),
    credits: {
      artist: [],
      compositionLyrics: [],
      productionEngineering: [],
      performers: [],
    },
    trackTree: [],
    tracks: [],
    loop: { enabled: false, startMs: 0, endMs: 0 },
  };
}

/**
 * Create a new track
 */
export function createTrack(name, role = TRACK_ROLES.OTHER) {
  return {
    id: createId(),
    type: 'audio',
    name,
    part: false,
    role,
    icon: getDefaultIconByRole(role),
    volume: dbToVolume(0),
    pan: 0,
    muted: false,
    soloed: false,
    clips: [],
  };
}

/**
 * Create a new clip
 */
export function createClip(blobId, timelineStartMs, sourceDurationMs) {
  return {
    id: createId(),
    blobId,
    timelineStartMs,
    sourceStartMs: 0,
    sourceDurationMs,
    cropStartMs: 0,
    cropEndMs: sourceDurationMs,
    gainDb: 0.0,
    muted: false,
  };
}
