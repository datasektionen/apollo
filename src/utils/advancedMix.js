import { normalizeTrackTree } from './trackTree';

export const ADVANCED_MIX_PRESET_ID = 'advanced_mix';

export const ADVANCED_MIX_FOCUS_MODES = {
  OMITTED: 'omitted',
  HIGHLIGHTED: 'highlighted',
  SOLOED: 'soloed',
};

export const ADVANCED_MIX_PRACTICE_FOCUS_STEPS = [
  'omitted',
  -15, -12, -9, -6, -3,
  0,
  3, 6, 9, 12, 15,
  'solo',
];
export const ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.filter((step) => typeof step === 'number');
const PRACTICE_FOCUS_NUMERIC_MIN = Math.min(...ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS);
const PRACTICE_FOCUS_NUMERIC_MAX = Math.max(...ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS);
const PRACTICE_FOCUS_NUMERIC_RANGE = PRACTICE_FOCUS_NUMERIC_MAX - PRACTICE_FOCUS_NUMERIC_MIN;

const PRACTICE_FOCUS_INNER_MIN = 8;
const PRACTICE_FOCUS_INNER_MAX = 92;
const PRACTICE_FOCUS_EXTREME_MIN = 0;
const PRACTICE_FOCUS_EXTREME_MAX = 100;
export const ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.map((step) => {
  if (step === 'omitted') return PRACTICE_FOCUS_EXTREME_MIN;
  if (step === 'solo') return PRACTICE_FOCUS_EXTREME_MAX;
  const normalized = PRACTICE_FOCUS_NUMERIC_RANGE > 0
    ? (Number(step) - PRACTICE_FOCUS_NUMERIC_MIN) / PRACTICE_FOCUS_NUMERIC_RANGE
    : 0.5;
  return PRACTICE_FOCUS_INNER_MIN + (normalized * (PRACTICE_FOCUS_INNER_MAX - PRACTICE_FOCUS_INNER_MIN));
});
export const ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX = 0;
export const ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.length - 1;
export const ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.findIndex((step) => step === 0);
export const ADVANCED_MIX_DEFAULT_CONTROLS = {
  practicePanRange: 100,
  practiceFocusControl: ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
};
export const ADVANCED_MIX_PLAYER_SETTINGS_STORAGE_KEY = 'apollo.settings';

const TRACK_FIELDS = [
  'name',
  'role',
  'icon',
  'part',
  'volume',
  'pan',
  'muted',
  'soloed',
];

const GROUP_FIELDS = [
  'name',
  'role',
  'part',
  'volume',
  'pan',
  'muted',
  'soloed',
];

function uniqueIds(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)));
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function stripTrackTreeViewState(trackTree = []) {
  return (Array.isArray(trackTree) ? trackTree : []).map((node) => {
    if (!node || typeof node !== 'object') return node;
    const { collapsed, ...rest } = node;
    return rest;
  });
}

function stripProjectViewState(project) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    trackTree: stripTrackTreeViewState(project.trackTree || []),
  };
}

function normalizeProjectForDeviationCompare(project) {
  return normalizeTrackTree(stripProjectViewState(project || {}));
}

function canonicalTrackTreeStructure(project) {
  const normalized = normalizeProjectForDeviationCompare(project);
  return (normalized.trackTree || []).map((node) => {
    if (node.kind === 'group') {
      return {
        id: node.id,
        kind: node.kind,
        parentId: node.parentId || null,
        order: Number(node.order || 0),
      };
    }
    return {
      id: node.id,
      kind: node.kind,
      parentId: node.parentId || null,
      order: Number(node.order || 0),
      trackId: node.trackId,
    };
  });
}

function getTrackMap(project) {
  return new Map((project?.tracks || [])
    .filter((track) => track?.id)
    .map((track) => [String(track.id), track]));
}

function getGroupMap(project) {
  return new Map((project?.trackTree || [])
    .filter((node) => node?.kind === 'group' && node?.id)
    .map((node) => [String(node.id), node]));
}

function getTrackName(project, trackId) {
  const track = (project?.tracks || []).find((entry) => String(entry?.id || '') === String(trackId || ''));
  return track?.name || 'Track';
}

function getGroupName(project, groupId) {
  const group = (project?.trackTree || []).find((entry) => String(entry?.id || '') === String(groupId || ''));
  return group?.name || 'Group';
}

function createProjectForMix(baseProject, mixId, mixName, savedSnapshot = null) {
  const source = savedSnapshot && typeof savedSnapshot === 'object' ? savedSnapshot : baseProject;
  const next = clone(source || {});
  const baseProjectId = baseProject?.projectId || baseProject?.id || next?.sourceProjectId || next?.projectId || '';
  next.projectId = `advanced-mix:${mixId || baseProjectId || 'draft'}`;
  next.sourceProjectId = baseProjectId;
  next.projectName = mixName || next.projectName || baseProject?.projectName || baseProject?.name || 'Advanced Mix';
  next.showId = baseProject?.showId ?? next.showId ?? null;
  next.showName = baseProject?.showName ?? next.showName ?? '';
  next.musicalNumber = baseProject?.musicalNumber ?? next.musicalNumber ?? '0.0';
  return next;
}

export function isAdvancedMixPreset(presetId) {
  return presetId === ADVANCED_MIX_PRESET_ID;
}

export function normalizeAdvancedMixFocus(value = {}) {
  const highlightedTrackIds = uniqueIds([
    ...uniqueIds(value?.highlightedTrackIds),
    ...uniqueIds(value?.omittedTrackIds),
    ...uniqueIds(value?.soloedTrackIds),
  ]);
  const highlightedGroupIds = uniqueIds([
    ...uniqueIds(value?.highlightedGroupIds),
    ...uniqueIds(value?.omittedGroupIds),
    ...uniqueIds(value?.soloedGroupIds),
  ]);
  return {
    omittedTrackIds: [],
    highlightedTrackIds,
    highlightedGroupIds,
    soloedTrackIds: [],
  };
}

export function normalizeAdvancedMixControls(value = {}) {
  const practicePanRange = Number(value?.practicePanRange);
  const practiceFocusControl = Number(value?.practiceFocusControl);
  return {
    practicePanRange: Number.isFinite(practicePanRange)
      ? Math.max(0, Math.min(200, Math.round(practicePanRange)))
      : ADVANCED_MIX_DEFAULT_CONTROLS.practicePanRange,
    practiceFocusControl: Number.isFinite(practiceFocusControl)
      ? Math.max(
        ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
        Math.min(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX, Math.round(practiceFocusControl))
      )
      : ADVANCED_MIX_DEFAULT_CONTROLS.practiceFocusControl,
  };
}

export function getAdvancedMixPracticeFocusStep(index) {
  const safeIndex = Math.max(
    ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
    Math.min(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0))
  );
  return ADVANCED_MIX_PRACTICE_FOCUS_STEPS[safeIndex];
}

export function getAdvancedMixPracticeFocusSliderPosition(index) {
  const safeIndex = Math.max(
    ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
    Math.min(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0))
  );
  return ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS[safeIndex];
}

export function resolveAdvancedMixPracticeFocusIndexFromSlider(sliderValue) {
  const numeric = Number(sliderValue);
  if (!Number.isFinite(numeric)) return ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
  let nearestIndex = 0;
  let nearestDistance = Math.abs(numeric - ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS[0]);
  ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS.forEach((position, index) => {
    const distance = Math.abs(numeric - position);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });
  return nearestIndex;
}

export function resolveAdvancedMixPracticeFocusDb(index) {
  const step = getAdvancedMixPracticeFocusStep(index);
  return typeof step === 'number' ? step : 0;
}

export function normalizeAdvancedMixState(value = {}) {
  return {
    snapshot: value?.snapshot && typeof value.snapshot === 'object' ? value.snapshot : null,
    focus: normalizeAdvancedMixFocus(value?.focus || value),
  };
}

export function buildAdvancedPlaybackSnapshot(baseSnapshot, item) {
  if (!isAdvancedMixPreset(item?.presetId)) return baseSnapshot;
  const advancedState = normalizeAdvancedMixState(item?.advancedMix || {});
  const source = advancedState.snapshot && typeof advancedState.snapshot === 'object'
    ? advancedState.snapshot
    : baseSnapshot;
  return {
    ...source,
    lyrics: baseSnapshot?.lyrics ?? null,
    projectId: baseSnapshot?.projectId || item?.projectId || source?.projectId,
    sourceProjectId: baseSnapshot?.projectId || item?.projectId || source?.sourceProjectId || null,
    projectName: item?.name || source?.projectName || baseSnapshot?.projectName || 'Advanced Mix',
    musicalNumber: baseSnapshot?.musicalNumber ?? source?.musicalNumber ?? '0.0',
    showId: baseSnapshot?.showId ?? source?.showId ?? null,
    showName: baseSnapshot?.showName ?? source?.showName ?? '',
  };
}

export function createAdvancedMixEditorProject(baseProject, mix) {
  const state = normalizeAdvancedMixState(mix?.advancedMix || {});
  return createProjectForMix(baseProject, mix?.id, mix?.name, state.snapshot);
}

export function createAdvancedMixSavePayload(project, focus, sourceProjectId = null) {
  const snapshot = stripProjectViewState(clone(project || {}));
  if (snapshot) {
    snapshot.sourceProjectId = sourceProjectId || snapshot.sourceProjectId || snapshot.projectId || null;
  }
  return {
    snapshot,
    focus: normalizeAdvancedMixFocus(focus),
  };
}

export function getAdvancedMixFocusMode(focus, trackId) {
  const normalized = normalizeAdvancedMixFocus(focus);
  const id = String(trackId || '');
  if (normalized.highlightedTrackIds.includes(id)) return ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED;
  return null;
}

export function getAdvancedMixGroupFocusMode(focus, groupId) {
  const normalized = normalizeAdvancedMixFocus(focus);
  const id = String(groupId || '');
  if (normalized.highlightedGroupIds.includes(id)) return ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED;
  return null;
}

export function toggleAdvancedMixFocus(focus, trackId) {
  const id = String(trackId || '').trim();
  const normalized = normalizeAdvancedMixFocus(focus);
  if (!id) return normalized;

  const key = 'highlightedTrackIds';

  const next = {
    omittedTrackIds: new Set(normalized.omittedTrackIds),
    highlightedTrackIds: new Set(normalized.highlightedTrackIds),
    highlightedGroupIds: new Set(normalized.highlightedGroupIds),
    soloedTrackIds: new Set(normalized.soloedTrackIds),
  };
  const targetSet = next[key];
  if (targetSet.has(id)) {
    targetSet.delete(id);
  } else {
    targetSet.add(id);
    Object.entries(next).forEach(([candidateKey, candidateSet]) => {
      if (candidateKey !== key) candidateSet.delete(id);
    });
  }

  return {
    omittedTrackIds: Array.from(next.omittedTrackIds),
    highlightedTrackIds: Array.from(next.highlightedTrackIds),
    highlightedGroupIds: Array.from(next.highlightedGroupIds),
    soloedTrackIds: Array.from(next.soloedTrackIds),
  };
}

function getGroupDescendantTrackIds(project, groupId) {
  if (!project || !groupId) return [];
  const childrenByParentId = new Map();
  (project.trackTree || []).forEach((node) => {
    const parentId = node?.parentId || null;
    if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
    childrenByParentId.get(parentId).push(node);
  });
  const trackIds = [];
  const walk = (parentId) => {
    (childrenByParentId.get(parentId) || []).forEach((node) => {
      if (node.kind === 'track' && node.trackId) {
        trackIds.push(String(node.trackId));
      } else if (node.kind === 'group') {
        walk(node.id);
      }
    });
  };
  walk(groupId);
  return Array.from(new Set(trackIds));
}

export function expandAdvancedMixFocusTrackIds(project, focus) {
  const normalized = normalizeAdvancedMixFocus(focus);
  const trackIds = new Set(normalized.highlightedTrackIds);
  normalized.highlightedGroupIds.forEach((groupId) => {
    getGroupDescendantTrackIds(project, groupId).forEach((trackId) => trackIds.add(trackId));
  });
  return Array.from(trackIds);
}

export function buildAdvancedMixDeviationItems(baseProject, mixProject, focus) {
  if (!baseProject || !mixProject) return [];
  const items = [];
  const baseCompareProject = normalizeProjectForDeviationCompare(baseProject);
  const mixCompareProject = normalizeProjectForDeviationCompare(mixProject);
  const normalizedFocus = normalizeAdvancedMixFocus(focus);
  const addFocusItems = (ids, mode, label) => {
    ids.forEach((trackId) => {
      items.push({
        id: `focus:${mode}:${trackId}`,
        kind: 'focus',
        mode,
        trackId,
        title: `${getTrackName(mixProject, trackId)} ${label}`,
        detail: 'Track focus',
      });
    });
  };
  const addGroupFocusItems = (ids, mode, label) => {
    ids.forEach((groupId) => {
      items.push({
        id: `focus:${mode}:group:${groupId}`,
        kind: 'focus',
        mode,
        groupId,
        title: `${getGroupName(mixProject, groupId)} ${label}`,
        detail: 'Group focus',
      });
    });
  };
  addFocusItems(normalizedFocus.omittedTrackIds, ADVANCED_MIX_FOCUS_MODES.OMITTED, 'omitted');
  addFocusItems(normalizedFocus.highlightedTrackIds, ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED, 'highlighted');
  addGroupFocusItems(normalizedFocus.highlightedGroupIds, ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED, 'highlighted');
  addFocusItems(normalizedFocus.soloedTrackIds, ADVANCED_MIX_FOCUS_MODES.SOLOED, 'soloed');

  if (Number(baseProject.masterVolume ?? 100) !== Number(mixProject.masterVolume ?? 100)) {
    items.push({
      id: 'project:masterVolume',
      kind: 'projectField',
      field: 'masterVolume',
      title: 'Master volume changed',
      detail: `${mixProject.masterVolume ?? 100}`,
    });
  }

  const baseTracks = getTrackMap(baseProject);
  const mixTracks = getTrackMap(mixProject);
  mixTracks.forEach((track, trackId) => {
    const baseTrack = baseTracks.get(trackId);
    if (!baseTrack) {
      items.push({
        id: `track:${trackId}:added`,
        kind: 'trackAdded',
        trackId,
        title: `${track.name || 'Track'} added`,
        detail: 'Track exists only in this mix',
      });
      return;
    }
    TRACK_FIELDS.forEach((field) => {
      if (stableJson(baseTrack[field]) === stableJson(track[field])) return;
      items.push({
        id: `track:${trackId}:${field}`,
        kind: 'trackField',
        trackId,
        field,
        title: `${track.name || baseTrack.name || 'Track'} ${field} changed`,
        detail: String(track[field] ?? ''),
      });
    });
    if (stableJson(baseTrack.clips || []) !== stableJson(track.clips || [])) {
      items.push({
        id: `track:${trackId}:clips`,
        kind: 'trackClips',
        trackId,
        title: `${track.name || baseTrack.name || 'Track'} clips changed`,
        detail: 'Timeline audio edits',
      });
    }
  });
  baseTracks.forEach((track, trackId) => {
    if (mixTracks.has(trackId)) return;
    items.push({
      id: `track:${trackId}:removed`,
      kind: 'trackRemoved',
      trackId,
      title: `${track.name || 'Track'} removed`,
      detail: 'Track is hidden from this mix snapshot',
    });
  });

  const baseGroups = getGroupMap(baseCompareProject);
  const mixGroups = getGroupMap(mixCompareProject);
  mixGroups.forEach((group, groupId) => {
    const baseGroup = baseGroups.get(groupId);
    if (!baseGroup) return;
    GROUP_FIELDS.forEach((field) => {
      if (stableJson(baseGroup[field]) === stableJson(group[field])) return;
      items.push({
        id: `group:${groupId}:${field}`,
        kind: 'groupField',
        groupId,
        field,
        title: `${group.name || baseGroup.name || 'Group'} ${field} changed`,
        detail: String(group[field] ?? ''),
      });
    });
  });

  if (stableJson(canonicalTrackTreeStructure(baseCompareProject)) !== stableJson(canonicalTrackTreeStructure(mixCompareProject))) {
    items.push({
      id: 'project:trackTree',
      kind: 'trackTree',
      title: 'Track layout changed',
      detail: 'Group/order structure',
    });
  }

  return items;
}

export function removeAdvancedMixDeviation(project, focus, baseProject, item) {
  if (!project || !item) {
    return {
      project,
      focus: normalizeAdvancedMixFocus(focus),
    };
  }
  let nextProject = project;
  let nextFocus = normalizeAdvancedMixFocus(focus);

  if (item.kind === 'focus') {
    nextFocus = {
      omittedTrackIds: nextFocus.omittedTrackIds.filter((id) => id !== item.trackId),
      highlightedTrackIds: nextFocus.highlightedTrackIds.filter((id) => id !== item.trackId),
      highlightedGroupIds: nextFocus.highlightedGroupIds.filter((id) => id !== item.groupId),
      soloedTrackIds: nextFocus.soloedTrackIds.filter((id) => id !== item.trackId),
    };
  } else if (item.kind === 'projectField') {
    nextProject = {
      ...nextProject,
      [item.field]: baseProject?.[item.field],
    };
  } else if (item.kind === 'trackField' || item.kind === 'trackClips') {
    const baseTrack = getTrackMap(baseProject).get(item.trackId);
    if (baseTrack) {
      nextProject = {
        ...nextProject,
        tracks: (nextProject.tracks || []).map((track) => {
          if (track.id !== item.trackId) return track;
          if (item.kind === 'trackClips') return { ...track, clips: clone(baseTrack.clips || []) };
          return { ...track, [item.field]: clone(baseTrack[item.field]) };
        }),
      };
    }
  } else if (item.kind === 'trackAdded') {
    nextProject = {
      ...nextProject,
      tracks: (nextProject.tracks || []).filter((track) => track.id !== item.trackId),
      trackTree: (nextProject.trackTree || []).filter((node) => node.trackId !== item.trackId && node.id !== item.trackId),
    };
  } else if (item.kind === 'trackRemoved') {
    const baseTrack = getTrackMap(baseProject).get(item.trackId);
    if (baseTrack) {
      const exists = (nextProject.tracks || []).some((track) => track.id === item.trackId);
      nextProject = {
        ...nextProject,
        tracks: exists ? nextProject.tracks : [...(nextProject.tracks || []), clone(baseTrack)],
      };
    }
  } else if (item.kind === 'groupField') {
    const baseGroup = getGroupMap(baseProject).get(item.groupId);
    if (baseGroup) {
      nextProject = {
        ...nextProject,
        trackTree: (nextProject.trackTree || []).map((node) => (
          node.id === item.groupId ? { ...node, [item.field]: clone(baseGroup[item.field]) } : node
        )),
      };
    }
  } else if (item.kind === 'trackTree') {
    nextProject = {
      ...nextProject,
      trackTree: clone(baseProject?.trackTree || []),
    };
  }

  return { project: nextProject, focus: nextFocus };
}

export function loadAdvancedMixPlayerControls() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeAdvancedMixControls();
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ADVANCED_MIX_PLAYER_SETTINGS_STORAGE_KEY) || '{}');
    return normalizeAdvancedMixControls({
      practicePanRange: parsed.playerPracticePanRange ?? parsed.practicePanRange,
      practiceFocusControl: parsed.playerPracticeFocusControl ?? parsed.practiceFocusControl,
    });
  } catch {
    return normalizeAdvancedMixControls();
  }
}

export function saveAdvancedMixPlayerControls(controls) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = normalizeAdvancedMixControls(controls);
  let existing = {};
  try {
    existing = JSON.parse(window.localStorage.getItem(ADVANCED_MIX_PLAYER_SETTINGS_STORAGE_KEY) || '{}');
  } catch {
    existing = {};
  }
  window.localStorage.setItem(ADVANCED_MIX_PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify({
    ...existing,
    playerPracticePanRange: normalized.practicePanRange,
    playerPracticeFocusControl: normalized.practiceFocusControl,
  }));
}
