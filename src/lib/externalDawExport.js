import { renderTrackStem } from './exportEngine';
import { SAMPLE_RATE } from '../types/project';
import { normalizeProjectName } from '../utils/naming';
import {
  getEffectiveTrackMix,
  normalizeTrackTree,
  reorderTracksByTree,
} from '../utils/trackTree';
import { TRACK_ROLE_METRONOME } from '../utils/trackRoles';

export const EXTERNAL_DAW_EXPORT_FORMAT = 'wav';
export const EXTERNAL_DAW_MANIFEST_FILENAME = 'Apollo External DAW manifest.json';
export const EXTERNAL_DAW_TRACK_SCOPES = {
  AUDIBLE: 'audible',
  ALL: 'all',
  SELECTED: 'selected',
};
export const DEFAULT_EXTERNAL_DAW_MIX_SETTINGS = {
  trackVolume: false,
  trackPan: false,
  groupGain: false,
  groupPan: false,
  muteStates: false,
  masterSettings: false,
};

export function normalizeExternalDawMixSettings(settings = {}) {
  return Object.keys(DEFAULT_EXTERNAL_DAW_MIX_SETTINGS).reduce((normalized, key) => {
    normalized[key] = settings?.[key] === true;
    return normalized;
  }, { ...DEFAULT_EXTERNAL_DAW_MIX_SETTINGS });
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const PATH_SEPARATOR = ' - ';

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  throw error;
}

function sanitizeNamePart(value, fallback = 'Track') {
  const cleaned = String(value || '')
    .trim()
    .replace(INVALID_FILENAME_CHARS, PATH_SEPARATOR)
    .replace(/\s+/g, ' ')
    .replace(/(?:\s-\s)+/g, PATH_SEPARATOR)
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  return cleaned || fallback;
}

function getTrackPathParts(project, trackId) {
  const normalized = normalizeTrackTree(project);
  const nodeById = new Map((normalized.trackTree || []).map((node) => [node.id, node]));
  const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
  const track = trackById.get(trackId);
  const trackNode = (normalized.trackTree || []).find(
    (node) => node.kind === 'track' && node.trackId === trackId
  );

  if (!track) return [];

  const parts = [sanitizeNamePart(track.name)];
  const visited = new Set();
  let parentId = trackNode?.parentId || null;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent || parent.kind !== 'group') break;
    parts.unshift(sanitizeNamePart(parent.name, 'Group'));
    parentId = parent.parentId || null;
  }
  return parts;
}

function getProjectDurationMs(project) {
  return (project?.tracks || []).reduce((projectEnd, track) => {
    const trackEnd = (track?.clips || []).reduce((end, clip) => {
      const timelineStartMs = Number(clip?.timelineStartMs) || 0;
      const cropStartMs = Number(clip?.cropStartMs) || 0;
      const cropEndMs = Number(clip?.cropEndMs) || 0;
      return Math.max(end, timelineStartMs + Math.max(0, cropEndMs - cropStartMs));
    }, 0);
    return Math.max(projectEnd, trackEnd);
  }, 0);
}

function createUniqueFilename(baseName, usedNames) {
  const normalized = `${baseName || 'Track'}.${EXTERNAL_DAW_EXPORT_FORMAT}`;
  if (!usedNames.has(normalized.toLowerCase())) {
    usedNames.add(normalized.toLowerCase());
    return normalized;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName} (${suffix}).${EXTERNAL_DAW_EXPORT_FORMAT}`.toLowerCase())) {
    suffix += 1;
  }
  const filename = `${baseName} (${suffix}).${EXTERNAL_DAW_EXPORT_FORMAT}`;
  usedNames.add(filename.toLowerCase());
  return filename;
}

/**
 * Return the audio tracks that will be exported, in Apollo's track-tree order.
 * The path is flattened into the filename because GarageBand does not import
 * Apollo's group hierarchy from a folder or JSON manifest.
 */
export function getExternalDawTrackDescriptors(project, options = {}) {
  const orderedProject = reorderTracksByTree(project);
  const mix = getEffectiveTrackMix(orderedProject);
  const usedNames = new Set();
  const trackScope = options?.trackScope || EXTERNAL_DAW_TRACK_SCOPES.AUDIBLE;
  const includeMetronome = options?.includeMetronome === true;
  const selectedTrackIds = new Set(
    options?.selectedTrackIds instanceof Set
      ? options.selectedTrackIds
      : (Array.isArray(options?.selectedTrackIds) ? options.selectedTrackIds : [])
  );

  return (orderedProject.tracks || [])
    .filter((track) => (
      track?.type === 'audio'
      && (track.clips || []).some((clip) => clip?.blobId)
      && (includeMetronome || mix.statesByTrackId.get(track.id)?.effectiveRole !== TRACK_ROLE_METRONOME)
      && (
        trackScope === EXTERNAL_DAW_TRACK_SCOPES.ALL
        || (trackScope === EXTERNAL_DAW_TRACK_SCOPES.SELECTED && selectedTrackIds.has(track.id))
        || (trackScope !== EXTERNAL_DAW_TRACK_SCOPES.ALL
          && trackScope !== EXTERNAL_DAW_TRACK_SCOPES.SELECTED
          && mix.statesByTrackId.get(track.id)?.audible !== false)
      )
    ))
    .map((track) => {
      const pathParts = getTrackPathParts(orderedProject, track.id);
      const pathLabel = pathParts.join(PATH_SEPARATOR);
      const filename = createUniqueFilename(pathLabel, usedNames);
      const state = mix.statesByTrackId.get(track.id);
      return {
        track,
        trackId: track.id,
        name: track.name,
        role: state?.effectiveRole || track.role || 'other',
        audible: state?.audible !== false,
        isMetronome: state?.effectiveRole === TRACK_ROLE_METRONOME,
        pathParts,
        pathLabel,
        filename,
      };
    });
}

/**
 * Render an Apollo project as time-aligned WAV stems for an external DAW.
 * Clip edits are always printed into each stem; the caller can independently
 * choose which Apollo mix settings should also be printed.
 */
export async function exportExternalDawStems(
  project,
  audioBuffers,
  exportBaseName = null,
  options = {}
) {
  const signal = options?.signal || null;
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const orderedProject = reorderTracksByTree(project);
  const mix = getEffectiveTrackMix(orderedProject);
  const mixSettings = normalizeExternalDawMixSettings(options?.mixSettings);
  const descriptors = getExternalDawTrackDescriptors(orderedProject, {
    trackScope: options?.trackScope || EXTERNAL_DAW_TRACK_SCOPES.AUDIBLE,
    includeMetronome: options?.includeMetronome === true,
    selectedTrackIds: options?.selectedTrackIds,
  });
  const durationMs = getProjectDurationMs(orderedProject);
  const renderSettings = {
    ...(orderedProject.exportSettings || {}),
    ...(options?.renderSettings || {}),
  };
  const renderOptions = {
    applyTrackVolume: mixSettings.trackVolume,
    applyTrackPan: mixSettings.trackPan,
    applyGroupGain: mixSettings.groupGain,
    applyGroupPan: mixSettings.groupPan,
    applyMuteStates: mixSettings.muteStates,
    applyMasterSettings: mixSettings.masterSettings,
  };
  const files = [];

  const emitProgress = (completed, label = '') => {
    onProgress?.({
      phase: 'render',
      label,
      completed,
      total: descriptors.length,
      fraction: descriptors.length > 0 ? completed / descriptors.length : 1,
    });
  };

  if (descriptors.length === 0) {
    throw new Error('No audio tracks are available for the External DAW export.');
  }

  emitProgress(0);
  for (let index = 0; index < descriptors.length; index += 1) {
    throwIfAborted(signal);
    const descriptor = descriptors[index];
    const blob = await renderTrackStem(
      orderedProject,
      descriptor.track,
      audioBuffers,
      EXTERNAL_DAW_EXPORT_FORMAT,
      mix.statesByTrackId,
      renderSettings,
      durationMs,
      renderOptions
    );
    files.push({
      filename: descriptor.filename,
      relativePath: descriptor.filename,
      blob,
      trackId: descriptor.trackId,
    });
    emitProgress(index + 1, descriptor.pathLabel);
  }

  throwIfAborted(signal);
  const manifest = {
    format: 'apollo-external-daw',
    version: 1,
    mixSettings,
    trackScope: options?.trackScope || EXTERNAL_DAW_TRACK_SCOPES.AUDIBLE,
    includeMetronome: options?.includeMetronome === true,
    projectName: normalizeProjectName(exportBaseName || orderedProject.projectName) || 'project',
    sampleRate: SAMPLE_RATE,
    durationMs,
    tracks: descriptors.map((descriptor) => {
      const state = mix.statesByTrackId.get(descriptor.trackId);
      return {
        trackId: descriptor.trackId,
        name: descriptor.name,
        role: descriptor.role,
        path: descriptor.pathParts,
        filename: descriptor.filename,
        volume: orderedProject.tracks.find((track) => track.id === descriptor.trackId)?.volume ?? null,
        pan: orderedProject.tracks.find((track) => track.id === descriptor.trackId)?.pan ?? null,
        effectiveGain: state?.effectiveGain ?? null,
        effectivePan: state?.effectivePan ?? null,
      };
    }),
  };
  files.push({
    filename: EXTERNAL_DAW_MANIFEST_FILENAME,
    relativePath: EXTERNAL_DAW_MANIFEST_FILENAME,
    blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    trackId: null,
  });

  return files;
}
