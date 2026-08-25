import {
  volumeToGain,
  dbToGain,
  gainToDb,
  msToSeconds,
  normalizePanLawDb,
  getPanLawCompensationGain,
  getPanLawHeadroomGain,
} from '../utils/audio';
import { Mp3Encoder } from '@breezystack/lamejs';
import {
  SAMPLE_RATE,
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
} from '../types/project';
import { applyChoirAutoPanToProject, normalizeAutoPanSettings } from '../utils/choirAutoPan';
import { getEffectiveTrackMix, getGroupDescendantTrackIdsByGroup } from '../utils/trackTree';
import {
  ADVANCED_MIX_PRESET_ID,
  ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
  expandAdvancedMixFocusTrackIds,
  getAdvancedMixPracticeFocusStep,
  normalizeAdvancedMixControls,
  normalizeAdvancedMixFocus,
  normalizeAdvancedMixState,
  isAdvancedMixPreset,
} from '../utils/advancedMix';
import {
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_METRONOME,
  toCategoryRole,
} from '../utils/trackRoles';

export const EXPORT_PRESETS = {
  TUTTI: 'tutti',
  ADVANCED_MIX: ADVANCED_MIX_PRESET_ID,
  ACAPELLA: 'acapella',
  NO_LEAD: 'no_lead',
  NO_CHOIR: 'no_choir',
  INSTRUMENTAL: 'instrumental',
  LEAD_ONLY: 'lead_only',
  CHOIR_ONLY: 'choir_only',
  INSTRUMENT_PARTS: 'instrument_parts',
  LEAD_PARTS: 'lead_parts',
  CHOIR_PARTS: 'choir_parts',
  INSTRUMENT_PARTS_OMITTED: 'instrument_parts_omitted',
  LEAD_PARTS_OMITTED: 'lead_parts_omitted',
  CHOIR_PARTS_OMITTED: 'choir_parts_omitted',
};

export const EXPORT_PRESET_DEFINITIONS = [
  { id: EXPORT_PRESETS.TUTTI, label: 'Tutti', description: 'All tracks, no adjustments' },
  { id: EXPORT_PRESETS.ADVANCED_MIX, label: 'Advanced Mix', description: 'Saved DAW mix snapshot' },
  { id: EXPORT_PRESETS.ACAPELLA, label: 'No Instruments', description: 'Lead + choir' },
  { id: EXPORT_PRESETS.NO_LEAD, label: 'No Leads', description: 'Instrument + choir' },
  { id: EXPORT_PRESETS.NO_CHOIR, label: 'No Choir', description: 'Instrument + lead' },
  { id: EXPORT_PRESETS.INSTRUMENTAL, label: 'Instruments Only', description: 'Instrument only' },
  { id: EXPORT_PRESETS.LEAD_ONLY, label: 'Lead Only', description: 'Lead only' },
  { id: EXPORT_PRESETS.CHOIR_ONLY, label: 'Choir Only', description: 'Choir only' },
  { id: EXPORT_PRESETS.INSTRUMENT_PARTS, label: 'Instruments Parts', description: 'Practice mix per instrument track' },
  { id: EXPORT_PRESETS.LEAD_PARTS, label: 'Leads Parts', description: 'Practice mix per lead track' },
  { id: EXPORT_PRESETS.CHOIR_PARTS, label: 'Choir Parts', description: 'Practice mix per choir track' },
  { id: EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED, label: 'Instrument Parts Omitted', description: 'One mix per instrument omitted' },
  { id: EXPORT_PRESETS.LEAD_PARTS_OMITTED, label: 'Lead Parts Omitted', description: 'One mix per lead omitted' },
  { id: EXPORT_PRESETS.CHOIR_PARTS_OMITTED, label: 'Choir Parts Omitted', description: 'One mix per choir omitted (remaining choir auto-pan)' },
];

const VALID_PRESETS = new Set(EXPORT_PRESET_DEFINITIONS.map((preset) => preset.id));
const PRACTICE_FOCUS_PEAK_DB = -1;
const SINGLE_OUTPUT_PRESETS = new Set([
  EXPORT_PRESETS.TUTTI,
  EXPORT_PRESETS.ADVANCED_MIX,
  EXPORT_PRESETS.ACAPELLA,
  EXPORT_PRESETS.NO_LEAD,
  EXPORT_PRESETS.NO_CHOIR,
  EXPORT_PRESETS.INSTRUMENTAL,
  EXPORT_PRESETS.LEAD_ONLY,
  EXPORT_PRESETS.CHOIR_ONLY,
]);

export const GROUP_MIX_PRESETS = new Set([
  EXPORT_PRESETS.ACAPELLA,
  EXPORT_PRESETS.NO_LEAD,
  EXPORT_PRESETS.NO_CHOIR,
  EXPORT_PRESETS.INSTRUMENTAL,
  EXPORT_PRESETS.LEAD_ONLY,
  EXPORT_PRESETS.CHOIR_ONLY,
]);

export const PRACTICE_NORMAL_PRESETS = new Set([
  EXPORT_PRESETS.INSTRUMENT_PARTS,
  EXPORT_PRESETS.LEAD_PARTS,
  EXPORT_PRESETS.CHOIR_PARTS,
]);

export const PRACTICE_OMITTED_PRESETS = new Set([
  EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED,
  EXPORT_PRESETS.LEAD_PARTS_OMITTED,
  EXPORT_PRESETS.CHOIR_PARTS_OMITTED,
]);

const PRACTICE_PRESETS = new Set([
  ...PRACTICE_NORMAL_PRESETS,
  ...PRACTICE_OMITTED_PRESETS,
]);

export const PRACTICE_REALTIME_MODES = {
  NORMAL: 'normal',
  OMITTED: 'omitted',
  SOLO: 'solo',
};

export function isPracticePresetId(presetId) {
  return PRACTICE_PRESETS.has(presetId);
}

export function isGroupMixPresetId(presetId) {
  return GROUP_MIX_PRESETS.has(presetId);
}

export function isPracticeOmittedPresetId(presetId) {
  return PRACTICE_OMITTED_PRESETS.has(presetId);
}

/**
 * Tracks that live mix controls can still need after Play has started.
 * DAW and advanced mix keep every track (muted stems stay loaded so unmute works).
 * Tutti / part / group mixes keep currently audible tracks plus metronome, even if
 * the click is muted — practice focus, pan range, and metronome cannot unmute a
 * DAW-muted non-metronome stem.
 */
export function getLiveMixableTrackIds(project, options = {}) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const presetId = options?.presetId || null;
  const loadAllTracks = options?.scope === 'daw'
    || options?.scope === 'advanced-mix'
    || isAdvancedMixPreset(presetId);
  if (loadAllTracks) {
    return new Set(tracks.map((track) => track?.id).filter(Boolean));
  }

  const context = getExportContext(project);
  const trackIds = new Set(context.activeTracks.map((track) => track.id));
  context.allTracks.forEach((track) => {
    if (track?.id && isMetronomeTrack(track, context.effectiveRole)) {
      trackIds.add(track.id);
    }
  });
  return trackIds;
}

export function collectLiveMixBlobIds(project, options = {}) {
  const trackIds = getLiveMixableTrackIds(project, options);
  const blobIds = [];
  const seen = new Set();
  (project?.tracks || []).forEach((track) => {
    if (!trackIds.has(track?.id)) return;
    (track?.clips || []).forEach((clip) => {
      if (!clip?.blobId || seen.has(clip.blobId)) return;
      seen.add(clip.blobId);
      blobIds.push(clip.blobId);
    });
  });
  return blobIds;
}

function clampPan(pan) {
  return Math.max(-100, Math.min(100, Number(pan) || 0));
}

function getLeftRemapMax(transformedPanRange) {
  const control = Math.max(0, Math.min(200, Number(transformedPanRange) || 0));
  // 0 -> -100 (hard left), 100 -> 0 (left half), 200 -> 100 (identity)
  return control - 100;
}

function remapPanValue(value, oldMin, oldMax, newMin, newMax) {
  if (oldMax === oldMin) return (newMin + newMax) / 2;
  return newMin + ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin);
}

function remapPansToSide(trackIds, basePanByTrackId, direction, transformedPanRange) {
  if (!trackIds.length) return {};

  const leftMax = getLeftRemapMax(transformedPanRange);
  const rightMin = -leftMax;
  const oldValues = trackIds.map((trackId) => clampPan(basePanByTrackId[trackId]));
  const oldMin = Math.min(...oldValues);
  const oldMax = Math.max(...oldValues);
  const newMin = direction === 'left' ? -100 : rightMin;
  const newMax = direction === 'left' ? leftMax : 100;
  const fixedValue = direction === 'left' ? newMin : newMax;

  const mapped = {};
  for (const trackId of trackIds) {
    if (oldMax === oldMin) {
      mapped[trackId] = fixedValue;
      continue;
    }
    mapped[trackId] = clampPan(
      remapPanValue(clampPan(basePanByTrackId[trackId]), oldMin, oldMax, newMin, newMax)
    );
  }
  return mapped;
}

function buildPracticePanMap({
  tracks,
  targetTrackIds,
  basePanByTrackId,
  transformedPanRange,
}) {
  const targetSet = new Set(targetTrackIds || []);
  const trackIds = tracks.map((track) => track.id);
  const leftIds = trackIds.filter((trackId) => !targetSet.has(trackId));
  const leftMax = getLeftRemapMax(transformedPanRange);
  const transformedCenterOnLeft = remapPanValue(0, -100, 100, -100, leftMax);
  const targetPan = clampPan(-transformedCenterOnLeft);

  const panMap = {
    ...remapPansToSide(leftIds, basePanByTrackId, 'left', transformedPanRange),
  };
  for (const trackId of trackIds) {
    if (targetSet.has(trackId)) {
      panMap[trackId] = clampPan(targetPan);
    }
  }
  return panMap;
}

function getAudioBufferPeak(audioBuffer) {
  if (!audioBuffer) return 0;
  let peak = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

function getAudioBufferChannelPeak(audioBuffer, channelIndex) {
  if (!audioBuffer || channelIndex < 0 || channelIndex >= audioBuffer.numberOfChannels) {
    return 0;
  }
  let peak = 0;
  const data = audioBuffer.getChannelData(channelIndex);
  for (let i = 0; i < data.length; i += 1) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export async function measureTuttiPeak(project, audioBuffers) {
  const mix = getEffectiveTrackMix(project);
  const trackStateById = mix.statesByTrackId;
  const activeTracks = (project.tracks || []).filter((track) => trackStateById.get(track.id)?.audible);
  if (!activeTracks.length) {
    return { peak: 0, peakDbfs: -Infinity };
  }
  const rendered = await renderTracksToAudioBuffer(project, activeTracks, audioBuffers, {}, {}, trackStateById);
  const peak = getAudioBufferPeak(rendered);
  return {
    peak,
    peakDbfs: peak > 0 ? gainToDb(peak) : -Infinity,
  };
}

async function buildPracticePeakNormalizedGainMap({
  project,
  tracks,
  audioBuffers,
  panAdjustments,
  targetTrackIds,
  trackStateById,
  practiceFocusDiffDb,
  renderSettings = null,
}) {
  const gainMap = {};
  if (!tracks.length) return gainMap;

  const targetSet = new Set(targetTrackIds || []);
  const focusTracks = tracks.filter((track) => targetSet.has(track.id));
  const backingTracks = tracks.filter((track) => !targetSet.has(track.id));

  let focusScale = 1;
  let backingScale = 1;
  const diffDb = Math.max(-6, Math.min(6, Number(practiceFocusDiffDb) || 0));
  const backingTargetPeakDb = PRACTICE_FOCUS_PEAK_DB - diffDb;

  if (focusTracks.length) {
    const focusBuffer = await renderTracksToAudioBuffer(
      project,
      focusTracks,
      audioBuffers,
      {},
      panAdjustments,
      trackStateById,
      renderSettings
    );
    const focusPeak = renderSettings?.forceMonoOutput
      ? getAudioBufferPeak(focusBuffer)
      : getAudioBufferChannelPeak(focusBuffer, 1);
    if (focusPeak > 0) {
      focusScale = dbToGain(PRACTICE_FOCUS_PEAK_DB) / focusPeak;
    }
  }

  if (backingTracks.length) {
    const backingBuffer = await renderTracksToAudioBuffer(
      project,
      backingTracks,
      audioBuffers,
      {},
      panAdjustments,
      trackStateById,
      renderSettings
    );
    const backingPeak = renderSettings?.forceMonoOutput
      ? getAudioBufferPeak(backingBuffer)
      : getAudioBufferChannelPeak(backingBuffer, 0);
    if (backingPeak > 0) {
      backingScale = dbToGain(backingTargetPeakDb) / backingPeak;
    }
  }

  for (const track of tracks) {
    gainMap[track.id] = targetSet.has(track.id) ? focusScale : backingScale;
  }

  const mixedBuffer = await renderTracksToAudioBuffer(
    project,
    tracks,
    audioBuffers,
    gainMap,
    panAdjustments,
    trackStateById
  );
  const mixedPeak = getAudioBufferPeak(mixedBuffer);
  if (mixedPeak > 1) {
    const safetyScale = 1 / mixedPeak;
    for (const track of tracks) {
      gainMap[track.id] *= safetyScale;
    }
  }

  return gainMap;
}

function getAutoPannedChoirPanMap(project, choirTracks) {
  if (!choirTracks.length) return {};

  const tempProject = {
    ...project,
    autoPan: normalizeAutoPanSettings({
      ...project.autoPan,
      enabled: true,
    }),
    tracks: choirTracks.map((track) => ({ ...track, role: TRACK_ROLE_CHOIR })),
    trackTree: choirTracks.map((track, idx) => ({
      id: `auto-pan-${track.id}`,
      kind: 'track',
      parentId: null,
      order: idx,
      trackId: track.id,
    })),
  };

  const result = applyChoirAutoPanToProject(tempProject, { enabled: true });
  const mix = getEffectiveTrackMix(result.project);
  const panMap = {};
  for (const track of choirTracks) {
    const state = mix.statesByTrackId.get(track.id);
    panMap[track.id] = clampPan(Number.isFinite(state?.effectivePan) ? state.effectivePan : track.pan);
  }
  return panMap;
}

function createFileName(projectBase, label = '', format = 'wav') {
  const cleanLabel = (label || '').trim();
  return cleanLabel
    ? `${projectBase} - ${cleanLabel}.${format}`
    : `${projectBase}.${format}`;
}

function isMetronomeTrack(track, effectiveRole) {
  return effectiveRole(track) === TRACK_ROLE_METRONOME;
}

function getExportContext(project) {
  const allTracks = project?.tracks || [];
  const mix = getEffectiveTrackMix(project);
  const trackStateById = mix.statesByTrackId;
  const activeTracks = allTracks.filter((track) => trackStateById.get(track.id)?.audible);
  const effectiveRole = (track) => trackStateById.get(track.id)?.effectiveRole || toCategoryRole(track.role);
  const allPracticeTracks = allTracks.filter((track) => !isMetronomeTrack(track, effectiveRole));
  const practiceTracks = activeTracks.filter((track) => !isMetronomeTrack(track, effectiveRole));
  const metronomeTracks = activeTracks.filter((track) => isMetronomeTrack(track, effectiveRole));
  const instrumentTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_INSTRUMENT);
  const leadTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_LEAD);
  const choirTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_CHOIR);
  const instrumentUnits = getRoleUnits(practiceTracks, trackStateById, TRACK_ROLE_INSTRUMENT);
  const leadUnits = getRoleUnits(practiceTracks, trackStateById, TRACK_ROLE_LEAD);
  const choirUnits = getChoirUnits(practiceTracks, trackStateById);

  return {
    allTracks,
    trackStateById,
    activeTracks,
    allPracticeTracks,
    effectiveRole,
    practiceTracks,
    metronomeTracks,
    instrumentTracks,
    leadTracks,
    choirTracks,
    instrumentUnits,
    leadUnits,
    choirUnits,
  };
}

function cloneSnapshot(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function getSelectedPresetUnit(context, presetId, presetVariantKey) {
  const meta = getPracticePresetMeta(presetId);
  if (!meta) return null;
  const units = getUnitsForPresetFromContext(context, meta.normalPresetId);
  const normalizedKey = presetVariantKey == null ? null : String(presetVariantKey);
  return units.find((unit) => String(unit.unitId) === normalizedKey) || null;
}

function getGroupDepthById(trackTree = []) {
  const parentById = new Map((trackTree || [])
    .filter((node) => node?.id)
    .map((node) => [node.id, node.parentId || null]));
  const depthById = new Map();
  const getDepth = (groupId) => {
    if (depthById.has(groupId)) return depthById.get(groupId);
    const parentId = parentById.get(groupId);
    const depth = parentId && parentById.has(parentId) ? getDepth(parentId) + 1 : 0;
    depthById.set(groupId, depth);
    return depth;
  };
  parentById.forEach((_, groupId) => getDepth(groupId));
  return depthById;
}

function isDescendantGroup(trackTree = [], groupId, ancestorGroupIds) {
  const parentById = new Map((trackTree || [])
    .filter((node) => node?.id)
    .map((node) => [node.id, node.parentId || null]));
  let parentId = parentById.get(groupId);
  while (parentId) {
    if (ancestorGroupIds.has(parentId)) return true;
    parentId = parentById.get(parentId);
  }
  return false;
}

function createHighlightedGroupMixSource(baseSnapshot, context, shouldHighlightTrack) {
  const selectedTrackIds = new Set(context.allPracticeTracks
    .filter((track) => shouldHighlightTrack(track))
    .map((track) => track.id));
  const descendantTrackIdsByGroup = getGroupDescendantTrackIdsByGroup(baseSnapshot);
  const practiceTrackIds = new Set(context.allPracticeTracks.map((track) => track.id));
  const depthByGroupId = getGroupDepthById(baseSnapshot.trackTree || []);
  const selectedGroupIds = [];
  const coveredTrackIds = new Set();

  Array.from(descendantTrackIdsByGroup.entries())
    .sort(([left], [right]) => (depthByGroupId.get(left) || 0) - (depthByGroupId.get(right) || 0))
    .forEach(([groupId, descendantTrackIds]) => {
      if (isDescendantGroup(baseSnapshot.trackTree || [], groupId, new Set(selectedGroupIds))) return;
      const groupPracticeTrackIds = descendantTrackIds.filter((trackId) => practiceTrackIds.has(trackId));
      if (!groupPracticeTrackIds.length) return;
      if (!groupPracticeTrackIds.every((trackId) => selectedTrackIds.has(trackId))) return;
      selectedGroupIds.push(groupId);
      groupPracticeTrackIds.forEach((trackId) => coveredTrackIds.add(trackId));
    });

  return {
    snapshot: baseSnapshot,
    focus: normalizeAdvancedMixFocus({
      highlightedGroupIds: selectedGroupIds,
      highlightedTrackIds: context.allPracticeTracks
        .filter((track) => selectedTrackIds.has(track.id) && !coveredTrackIds.has(track.id))
        .map((track) => track.id),
    }),
    controls: { practiceFocusControl: ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX },
  };
}

export function createEditableMixSource(project, mix) {
  const advancedState = normalizeAdvancedMixState(mix?.advancedMix || {});
  if (advancedState.snapshot) {
    return {
      snapshot: cloneSnapshot(advancedState.snapshot),
      focus: advancedState.focus,
      controls: null,
    };
  }

  const baseSnapshot = cloneSnapshot(project || {});
  const presetId = mix?.presetId || EXPORT_PRESETS.TUTTI;
  const context = getExportContext(baseSnapshot);
  const roleIs = (track, role) => context.effectiveRole(track) === role;

  if (presetId === EXPORT_PRESETS.ACAPELLA) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => !roleIs(track, TRACK_ROLE_INSTRUMENT));
  }

  if (presetId === EXPORT_PRESETS.NO_LEAD) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => !roleIs(track, TRACK_ROLE_LEAD));
  }

  if (presetId === EXPORT_PRESETS.NO_CHOIR) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => !roleIs(track, TRACK_ROLE_CHOIR));
  }

  if (presetId === EXPORT_PRESETS.INSTRUMENTAL) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => roleIs(track, TRACK_ROLE_INSTRUMENT));
  }

  if (presetId === EXPORT_PRESETS.LEAD_ONLY) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => roleIs(track, TRACK_ROLE_LEAD));
  }

  if (presetId === EXPORT_PRESETS.CHOIR_ONLY) {
    return createHighlightedGroupMixSource(baseSnapshot, context, (track) => roleIs(track, TRACK_ROLE_CHOIR));
  }

  if (isPracticePresetId(presetId)) {
    const selectedUnit = getSelectedPresetUnit(context, presetId, mix?.presetVariantKey);
    const focus = normalizeAdvancedMixFocus({
      highlightedTrackIds: selectedUnit?.trackIds || [],
    });
    const controls = isPracticeOmittedPresetId(presetId)
      ? { practiceFocusControl: ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX }
      : null;
    return {
      snapshot: baseSnapshot,
      focus,
      controls,
    };
  }

  return {
    snapshot: baseSnapshot,
    focus: normalizeAdvancedMixFocus(),
    controls: null,
  };
}

function getUnitsForPresetFromContext(context, presetId) {
  if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS || presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
    return context.instrumentUnits;
  }
  if (presetId === EXPORT_PRESETS.LEAD_PARTS || presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
    return context.leadUnits;
  }
  if (presetId === EXPORT_PRESETS.CHOIR_PARTS || presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
    return context.choirUnits;
  }
  return [];
}

export function listPresetVariants(project, presetId) {
  if (!VALID_PRESETS.has(presetId)) return [];
  if (SINGLE_OUTPUT_PRESETS.has(presetId)) {
    return [{ key: null, label: 'Default', presetId }];
  }

  const context = getExportContext(project);
  const units = getUnitsForPresetFromContext(context, presetId);
  return units.map((unit) => ({
    key: String(unit.unitId),
    label: unit.label,
    presetId,
  }));
}

export function resolvePresetVariantPlaybackPlan(project, presetId, presetVariantKey = null) {
  if (!VALID_PRESETS.has(presetId)) {
    throw new Error(`Unknown export preset: ${presetId}`);
  }
  if (SINGLE_OUTPUT_PRESETS.has(presetId)) {
    return {
      presetId,
      presetVariantKey: null,
      label: 'Default',
      selectedUnitIdsByPreset: {},
    };
  }

  const variants = listPresetVariants(project, presetId);
  const normalizedKey = presetVariantKey == null ? null : String(presetVariantKey);
  const resolved = variants.find((variant) => variant.key === normalizedKey);
  if (!resolved) {
    throw new Error('Preset variant is required for this preset.');
  }

  return {
    presetId,
    presetVariantKey: resolved.key,
    label: resolved.label,
    selectedUnitIdsByPreset: {
      [presetId]: [resolved.key],
    },
  };
}

function getPracticePresetMeta(presetId) {
  if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS || presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
    return {
      role: TRACK_ROLE_INSTRUMENT,
      normalPresetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      omittedPresetId: EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED,
    };
  }
  if (presetId === EXPORT_PRESETS.LEAD_PARTS || presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
    return {
      role: TRACK_ROLE_LEAD,
      normalPresetId: EXPORT_PRESETS.LEAD_PARTS,
      omittedPresetId: EXPORT_PRESETS.LEAD_PARTS_OMITTED,
    };
  }
  if (presetId === EXPORT_PRESETS.CHOIR_PARTS || presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
    return {
      role: TRACK_ROLE_CHOIR,
      normalPresetId: EXPORT_PRESETS.CHOIR_PARTS,
      omittedPresetId: EXPORT_PRESETS.CHOIR_PARTS_OMITTED,
    };
  }
  return null;
}

function buildRealtimePracticeGainMap(tracks, targetTrackIds, practiceFocusDiffDb) {
  const targetSet = new Set(targetTrackIds || []);
  const diffDb = Math.max(-6, Math.min(6, Number(practiceFocusDiffDb) || 0));
  const focusScale = diffDb < 0 ? dbToGain(diffDb) : 1;
  const backingScale = diffDb > 0 ? dbToGain(-diffDb) : 1;
  const gainMap = {};
  for (const track of tracks) {
    gainMap[track.id] = targetSet.has(track.id) ? focusScale : backingScale;
  }
  return gainMap;
}

/**
 * Resolve per-track gain/pan values for realtime practice playback.
 * Returns `{ mode, targetTrackIds, trackMixByTrackId }` where each track entry
 * has shape `{ gain, pan }` in effective (post-group) units.
 */
export function resolvePracticeRealtimeTrackMix(
  project,
  presetId,
  presetVariantKey,
  exportSettingsOverride = null,
  mode = PRACTICE_REALTIME_MODES.NORMAL
) {
  const meta = getPracticePresetMeta(presetId);
  if (!meta) return null;

  const context = getExportContext(project);
  const {
    trackStateById,
    allTracks,
    activeTracks,
    allPracticeTracks,
    practiceTracks,
    choirTracks,
    effectiveRole,
  } = context;
  const normalizedKey = presetVariantKey == null ? null : String(presetVariantKey);
  if (!normalizedKey) {
    throw new Error('Preset variant is required for this preset.');
  }
  const units = getUnitsForPresetFromContext(context, meta.normalPresetId);
  const selectedUnit = units.find((unit) => String(unit.unitId) === normalizedKey);
  if (!selectedUnit) {
    throw new Error('Preset variant is required for this preset.');
  }

  const exportSettings = normalizeExportSettings({
    ...DEFAULT_EXPORT_SETTINGS,
    ...(project.exportSettings || {}),
    ...(exportSettingsOverride || {}),
  });
  const targetTrackIds = [...selectedUnit.trackIds];
  const targetSet = new Set(targetTrackIds);
  const basePanByTrackId = {};
  const baseGainByTrackId = {};
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    basePanByTrackId[track.id] = clampPan(Number.isFinite(state?.effectivePan) ? state.effectivePan : track.pan);
    baseGainByTrackId[track.id] = Number.isFinite(state?.effectiveGain)
      ? state.effectiveGain
      : volumeToGain(track.volume);
  }

  const normalizedMode = mode === PRACTICE_REALTIME_MODES.OMITTED
    ? PRACTICE_REALTIME_MODES.OMITTED
    : (mode === PRACTICE_REALTIME_MODES.SOLO ? PRACTICE_REALTIME_MODES.SOLO : PRACTICE_REALTIME_MODES.NORMAL);
  const trackMixByTrackId = {};

  if (normalizedMode === PRACTICE_REALTIME_MODES.OMITTED) {
    let panAdjustments = {};
    if (meta.role === TRACK_ROLE_CHOIR) {
      const remainingChoirTracks = choirTracks.filter((track) => !targetSet.has(track.id));
      panAdjustments = getAutoPannedChoirPanMap(project, remainingChoirTracks);
    }
    for (const track of activeTracks) {
      const passthrough = isMetronomeTrack(track, effectiveRole);
      trackMixByTrackId[track.id] = {
        gain: passthrough
          ? baseGainByTrackId[track.id]
          : (targetSet.has(track.id) ? 0 : baseGainByTrackId[track.id]),
        pan: !passthrough && panAdjustments[track.id] !== undefined
          ? panAdjustments[track.id]
          : basePanByTrackId[track.id],
      };
    }
    return {
      mode: normalizedMode,
      targetTrackIds,
      trackMixByTrackId,
    };
  }

  const panAdjustments = buildPracticePanMap({
    tracks: practiceTracks,
    targetTrackIds,
    basePanByTrackId,
    transformedPanRange: exportSettings.transformedPanRange,
  });
  const gainAdjustments = buildRealtimePracticeGainMap(
    practiceTracks,
    targetTrackIds,
    exportSettings.practiceFocusDiffDb
  );

  if (normalizedMode === PRACTICE_REALTIME_MODES.SOLO) {
    for (const track of activeTracks) {
      const passthrough = isMetronomeTrack(track, effectiveRole);
      trackMixByTrackId[track.id] = {
        gain: passthrough
          ? baseGainByTrackId[track.id]
          : (targetSet.has(track.id)
          ? baseGainByTrackId[track.id] * (gainAdjustments[track.id] || 1)
          : 0),
        pan: passthrough
          ? basePanByTrackId[track.id]
          : (targetSet.has(track.id) ? 0 : basePanByTrackId[track.id]),
      };
    }
    return {
      mode: normalizedMode,
      targetTrackIds,
      trackMixByTrackId,
    };
  }

  for (const track of activeTracks) {
    const passthrough = isMetronomeTrack(track, effectiveRole);
    trackMixByTrackId[track.id] = {
      gain: passthrough
        ? baseGainByTrackId[track.id]
        : (baseGainByTrackId[track.id] * (gainAdjustments[track.id] || 1)),
      pan: !passthrough && panAdjustments[track.id] !== undefined
        ? panAdjustments[track.id]
        : basePanByTrackId[track.id],
    };
  }

  return {
    mode: normalizedMode,
    targetTrackIds,
    trackMixByTrackId,
  };
}

export function resolveAdvancedMixRealtimeTrackMix(project, focus, controls = null) {
  const context = getExportContext(project);
  const {
    trackStateById,
    activeTracks,
    practiceTracks,
    effectiveRole,
  } = context;
  const normalizedFocus = normalizeAdvancedMixFocus(focus);
  const normalizedControls = normalizeAdvancedMixControls(controls);
  const focusStep = getAdvancedMixPracticeFocusStep(normalizedControls.practiceFocusControl);
  const targetTrackIds = expandAdvancedMixFocusTrackIds(project, normalizedFocus);
  const omittedSet = new Set();
  const soloedSet = new Set();

  if (focusStep === 'omitted') {
    targetTrackIds.forEach((trackId) => omittedSet.add(trackId));
  } else if (focusStep === 'solo') {
    targetTrackIds.forEach((trackId) => soloedSet.add(trackId));
  }

  const basePanByTrackId = {};
  const baseGainByTrackId = {};
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    basePanByTrackId[track.id] = clampPan(Number.isFinite(state?.effectivePan) ? state.effectivePan : track.pan);
    baseGainByTrackId[track.id] = Number.isFinite(state?.effectiveGain)
      ? state.effectiveGain
      : volumeToGain(track.volume);
  }

  const numericFocus = typeof focusStep === 'number';
  const panAdjustments = numericFocus && targetTrackIds.length
    ? buildPracticePanMap({
      tracks: practiceTracks,
      targetTrackIds,
      basePanByTrackId,
      transformedPanRange: normalizedControls.practicePanRange,
    })
    : {};
  const gainAdjustments = numericFocus && targetTrackIds.length
    ? buildRealtimePracticeGainMap(practiceTracks, targetTrackIds, focusStep)
    : {};
  const hasSoloedFocus = soloedSet.size > 0;
  const trackMixByTrackId = {};

  for (const track of activeTracks) {
    const passthrough = isMetronomeTrack(track, effectiveRole);
    const omitted = !passthrough && omittedSet.has(track.id);
    const excludedBySolo = !passthrough && hasSoloedFocus && !soloedSet.has(track.id);
    const baseGain = baseGainByTrackId[track.id];
    const adjustedGain = !passthrough && gainAdjustments[track.id] !== undefined
      ? baseGain * gainAdjustments[track.id]
      : baseGain;
    const adjustedPan = !passthrough && panAdjustments[track.id] !== undefined
      ? panAdjustments[track.id]
      : basePanByTrackId[track.id];

    trackMixByTrackId[track.id] = {
      gain: omitted || excludedBySolo ? 0 : adjustedGain,
      pan: adjustedPan,
    };
  }

  return {
    mode: hasSoloedFocus ? PRACTICE_REALTIME_MODES.SOLO : PRACTICE_REALTIME_MODES.NORMAL,
    targetTrackIds,
    trackMixByTrackId,
  };
}

function getRoleUnits(activeTracks, trackStateById, role) {
  const unitsById = new Map();
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    if (state?.effectiveRole !== role) continue;
    const unitId = state.roleUnitId || `track:${track.id}`;
    if (!unitsById.has(unitId)) {
      unitsById.set(unitId, {
        unitId,
        label: state.roleUnitName || track.name,
        trackIds: [],
      });
    }
    unitsById.get(unitId).trackIds.push(track.id);
  }
  return Array.from(unitsById.values());
}

function getChoirUnits(activeTracks, trackStateById) {
  const unitsById = new Map();
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    if (state?.effectiveRole !== TRACK_ROLE_CHOIR) continue;
    const unitId = state.choirUnitId || state.roleUnitId || `track:${track.id}`;
    if (!unitsById.has(unitId)) {
      unitsById.set(unitId, {
        unitId,
        label: state.choirUnitName || state.roleUnitName || track.name,
        trackIds: [],
      });
    }
    unitsById.get(unitId).trackIds.push(track.id);
  }
  return Array.from(unitsById.values());
}

function withExportLayout(files) {
  const hasPracticeNormal = files.some((file) => file.branch === 'normal');
  const hasPracticeOmitted = files.some((file) => file.branch === 'omitted');

  return files.map((file) => {
    const segments = [];
    if (file.branch === 'normal') {
      segments.push('Practice');
      if (hasPracticeNormal && hasPracticeOmitted) {
        segments.push('Normal');
      }
      if (file.subgroup && file.subgroupCount > 1) {
        segments.push(file.subgroup);
      }
    } else if (file.branch === 'omitted') {
      segments.push('Practice');
      if (hasPracticeNormal && hasPracticeOmitted) {
        segments.push('Omitted');
      }
      if (file.subgroup && file.subgroupCount > 1) {
        segments.push(file.subgroup);
      }
    }

    return {
      filename: file.filename,
      relativePath: segments.length ? `${segments.join('/')}/${file.filename}` : file.filename,
      blob: file.blob,
      presetId: file.presetId,
    };
  });
}

/**
 * Main export function.
 * Returns array of `{ filename, relativePath, blob, presetId }`.
 */
export async function exportProject(
  project,
  selectedPresets,
  audioBuffers,
  exportSettingsOverride = null,
  exportBaseName = null,
  format = 'wav',
  selectionOptions = null
) {
  const signal = selectionOptions?.signal || null;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const error = new Error('Export cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };

  const outputFormat = format === 'mp3' ? 'mp3' : 'wav';
  const presetIds = Array.isArray(selectedPresets)
    ? [...new Set(selectedPresets.filter((id) => VALID_PRESETS.has(id)))]
    : (VALID_PRESETS.has(selectedPresets) ? [selectedPresets] : []);

  if (!presetIds.length) {
    throw new Error('No export presets selected.');
  }

  const exportSettings = normalizeExportSettings({
    ...DEFAULT_EXPORT_SETTINGS,
    ...(project.exportSettings || {}),
    ...(exportSettingsOverride || {}),
  });

  const {
    trackStateById,
    activeTracks,
    effectiveRole,
    practiceTracks,
    metronomeTracks,
    instrumentTracks,
    leadTracks,
    choirTracks,
    instrumentUnits,
    leadUnits,
    choirUnits,
  } = getExportContext(project);
  const projectBase = exportBaseName || project.projectName || 'project';
  const files = [];
  const selectedUnitIdsByPreset = selectionOptions?.selectedUnitIdsByPreset || {};
  const onProgress = typeof selectionOptions?.onProgress === 'function' ? selectionOptions.onProgress : null;
  const selectUnits = (units, presetId) => {
    const ids = selectedUnitIdsByPreset[presetId];
    if (!Array.isArray(ids) || ids.length === 0) return units;
    const allowed = new Set(ids);
    return units.filter((unit) => allowed.has(unit.unitId));
  };

  const countPresetFiles = (presetId) => {
    if (
      presetId === EXPORT_PRESETS.TUTTI ||
      presetId === EXPORT_PRESETS.ADVANCED_MIX ||
      presetId === EXPORT_PRESETS.ACAPELLA ||
      presetId === EXPORT_PRESETS.NO_LEAD ||
      presetId === EXPORT_PRESETS.NO_CHOIR ||
      presetId === EXPORT_PRESETS.INSTRUMENTAL ||
      presetId === EXPORT_PRESETS.LEAD_ONLY ||
      presetId === EXPORT_PRESETS.CHOIR_ONLY
    ) {
      return 1;
    }
    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS) {
      return selectUnits(instrumentUnits, presetId).length;
    }
    if (presetId === EXPORT_PRESETS.LEAD_PARTS) {
      return selectUnits(leadUnits, presetId).length;
    }
    if (presetId === EXPORT_PRESETS.CHOIR_PARTS) {
      return selectUnits(choirUnits, presetId).length;
    }
    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
      return selectUnits(instrumentUnits, presetId).length;
    }
    if (presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
      return selectUnits(leadUnits, presetId).length;
    }
    if (presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
      return selectUnits(choirUnits, presetId).length;
    }
    return 0;
  };

  const totalRenderTasks = presetIds.reduce((count, presetId) => count + countPresetFiles(presetId), 0);
  let completedRenderTasks = 0;
  const emitProgress = (label = '') => {
    if (!onProgress) return;
    onProgress({
      phase: 'render',
      label,
      completed: completedRenderTasks,
      total: totalRenderTasks,
      fraction: totalRenderTasks > 0 ? completedRenderTasks / totalRenderTasks : 1,
    });
  };
  emitProgress();

  const advanceProgress = (label = '') => {
    completedRenderTasks += 1;
    emitProgress(label);
  };

  for (const presetId of presetIds) {
    throwIfAborted();
    if (presetId === EXPORT_PRESETS.TUTTI || presetId === EXPORT_PRESETS.ADVANCED_MIX) {
      const label = presetId === EXPORT_PRESETS.ADVANCED_MIX ? 'Advanced Mix' : 'Tutti';
      emitProgress(label);
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, presetId === EXPORT_PRESETS.ADVANCED_MIX ? 'Advanced Mix' : '', outputFormat),
        blob: await renderTracks(project, activeTracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress(label);
      continue;
    }

    if (presetId === EXPORT_PRESETS.ACAPELLA) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_LEAD
        || effectiveRole(track) === TRACK_ROLE_CHOIR
        || effectiveRole(track) === TRACK_ROLE_METRONOME
      ));
      emitProgress('No Instruments');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'No Instruments', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('No Instruments');
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_LEAD) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_INSTRUMENT
        || effectiveRole(track) === TRACK_ROLE_CHOIR
        || effectiveRole(track) === TRACK_ROLE_METRONOME
      ));
      emitProgress('No Leads');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'No Leads', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('No Leads');
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_CHOIR) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_INSTRUMENT
        || effectiveRole(track) === TRACK_ROLE_LEAD
        || effectiveRole(track) === TRACK_ROLE_METRONOME
      ));
      emitProgress('No Choir');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'No Choir', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('No Choir');
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENTAL) {
      emitProgress('Instruments Only');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Instruments Only', outputFormat),
        blob: await renderTracks(project, [...instrumentTracks, ...metronomeTracks], audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('Instruments Only');
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_ONLY) {
      emitProgress('Lead Only');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Leads Only', outputFormat),
        blob: await renderTracks(project, [...leadTracks, ...metronomeTracks], audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('Lead Only');
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_ONLY) {
      emitProgress('Choir Only');
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Choir Only', outputFormat),
        blob: await renderTracks(project, [...choirTracks, ...metronomeTracks], audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
      });
      advanceProgress('Choir Only');
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS) {
      const selectedUnits = selectUnits(instrumentUnits, presetId);
      for (const targetUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(targetUnit.label);
        const targetTrackIds = targetUnit.trackIds;
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: practiceTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: practiceTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
          renderSettings: exportSettings,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Instruments',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(targetUnit.label);
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS) {
      const selectedUnits = selectUnits(leadUnits, presetId);
      for (const targetUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(targetUnit.label);
        const targetTrackIds = targetUnit.trackIds;
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: practiceTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: practiceTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
          renderSettings: exportSettings,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Leads',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(targetUnit.label);
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS) {
      const selectedUnits = selectUnits(choirUnits, presetId);
      for (const targetUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(targetUnit.label);
        const targetTrackIds = targetUnit.trackIds;
        const otherChoirTracks = choirTracks.filter((track) => !targetTrackIds.includes(track.id));
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, otherChoirTracks);
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        Object.assign(basePanByTrackId, autoPannedChoirMap);

        const panAdjustments = buildPracticePanMap({
          tracks: practiceTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: practiceTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
          renderSettings: exportSettings,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Choir',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(targetUnit.label);
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
      const selectedUnits = selectUnits(instrumentUnits, presetId);
      for (const omittedUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(`${omittedUnit.label} Omitted`);
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Instruments',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(`${omittedUnit.label} Omitted`);
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
      const selectedUnits = selectUnits(leadUnits, presetId);
      for (const omittedUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(`${omittedUnit.label} Omitted`);
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Leads',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(`${omittedUnit.label} Omitted`);
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
      const selectedUnits = selectUnits(choirUnits, presetId);
      for (const omittedUnit of selectedUnits) {
        throwIfAborted();
        emitProgress(`${omittedUnit.label} Omitted`);
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        const remainingChoirTracks = choirTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, remainingChoirTracks);
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Choir',
          subgroupCount: selectedUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, autoPannedChoirMap, outputFormat, trackStateById, exportSettings),
        });
        advanceProgress(`${omittedUnit.label} Omitted`);
      }
    }
  }

  return withExportLayout(files);
}

export async function renderPresetVariant(
  project,
  presetId,
  presetVariantKey,
  audioBuffers,
  exportSettingsOverride = null,
  exportBaseName = null,
  format = 'wav',
  selectionOptions = null
) {
  const plan = resolvePresetVariantPlaybackPlan(project, presetId, presetVariantKey);
  const files = await exportProject(
    project,
    [presetId],
    audioBuffers,
    exportSettingsOverride,
    exportBaseName,
    format,
    {
      ...(selectionOptions || {}),
      selectedUnitIdsByPreset: {
        ...(selectionOptions?.selectedUnitIdsByPreset || {}),
        ...(plan.selectedUnitIdsByPreset || {}),
      },
    }
  );
  return files[0] || null;
}

async function renderTracksToAudioBuffer(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}, trackStateById = null, renderSettings = null) {
  let maxDurationMs = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
      maxDurationMs = Math.max(maxDurationMs, clipEnd);
    }
  }

  // Render exactly to the last clip end (no extra tail padding).
  const length = Math.max(1, Math.ceil(msToSeconds(maxDurationMs) * SAMPLE_RATE));
  const normalizedRenderSettings = normalizeExportSettings({
    ...(project?.exportSettings || {}),
    ...(renderSettings || {}),
  });
  const forceMonoOutput = normalizedRenderSettings.forceMonoOutput === true;
  const outputChannelCount = forceMonoOutput ? 1 : 2;
  const panLawDb = normalizePanLawDb(normalizedRenderSettings.panLawDb);
  const offlineContext = new OfflineAudioContext(outputChannelCount, length, SAMPLE_RATE);

  const masterGain = offlineContext.createGain();
  masterGain.gain.value = volumeToGain(project.masterVolume) * (forceMonoOutput ? 1 : getPanLawHeadroomGain(panLawDb));
  masterGain.connect(offlineContext.destination);

  for (const track of tracks) {
    const effective = trackStateById?.get(track.id) || null;
    if (effective && !effective.audible) continue;

    const baseGain = Number.isFinite(effective?.effectiveGain)
      ? effective.effectiveGain
      : volumeToGain(track.volume);
    const adjustmentGain = gainAdjustments[track.id] || 1.0;
    const totalGain = baseGain * adjustmentGain;
    const rawPan = clampPan(
      panAdjustments[track.id] !== undefined
        ? panAdjustments[track.id]
        : (Number.isFinite(effective?.effectivePan) ? effective.effectivePan : track.pan)
    );
    const totalPan = forceMonoOutput ? 0 : rawPan;
    const panLawCompensationGain = forceMonoOutput ? 1 : getPanLawCompensationGain(totalPan, panLawDb);

    for (const clip of track.clips) {
      if (clip.muted) continue;

      const audioBuffer = audioBuffers.get(clip.blobId);
      if (!audioBuffer) continue;

      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = offlineContext.createGain();
      gainNode.gain.value = totalGain * dbToGain(clip.gainDb) * panLawCompensationGain;
      source.connect(gainNode);
      if (forceMonoOutput) {
        gainNode.connect(masterGain);
      } else {
        const panNode = offlineContext.createStereoPanner();
        panNode.pan.value = totalPan / 100;
        gainNode.connect(panNode);
        panNode.connect(masterGain);
      }

      source.start(
        msToSeconds(clip.timelineStartMs),
        msToSeconds(clip.cropStartMs),
        msToSeconds(clip.cropEndMs - clip.cropStartMs)
      );
    }
  }

  return await offlineContext.startRendering();
}

async function renderTracks(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}, format = 'wav', trackStateById = null, renderSettings = null) {
  const renderedBuffer = await renderTracksToAudioBuffer(
    project,
    tracks,
    audioBuffers,
    gainAdjustments,
    panAdjustments,
    trackStateById,
    renderSettings
  );
  return audioBufferToBlob(renderedBuffer, format === 'mp3' ? 'mp3' : 'wav');
}

function audioBufferToBlob(audioBuffer, format = 'wav') {
  if (format === 'mp3') {
    return audioBufferToMp3(audioBuffer);
  }
  return audioBufferToWav(audioBuffer);
}

function floatTo16BitPCM(floatArray) {
  const pcm = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatArray[i]));
    pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return pcm;
}

function audioBufferToMp3(audioBuffer, bitrateKbps = 192) {
  const channelCount = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new Mp3Encoder(channelCount, sampleRate, bitrateKbps);
  const blockSize = 1152;
  const mp3Chunks = [];

  if (channelCount === 1) {
    const mono = floatTo16BitPCM(audioBuffer.getChannelData(0));
    for (let i = 0; i < mono.length; i += blockSize) {
      const mp3buf = encoder.encodeBuffer(mono.subarray(i, i + blockSize));
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }
  } else {
    const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
    const right = floatTo16BitPCM(audioBuffer.getChannelData(1));
    for (let i = 0; i < left.length; i += blockSize) {
      const mp3buf = encoder.encodeBuffer(
        left.subarray(i, i + blockSize),
        right.subarray(i, i + blockSize)
      );
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    mp3Chunks.push(new Uint8Array(end));
  }

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const dataSize = numberOfChannels * length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  let offset = 0;

  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, bufferSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      let sample = audioBuffer.getChannelData(channel)[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
