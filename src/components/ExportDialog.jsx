import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, ChevronRight, ChevronDown } from 'lucide-react';
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_DEFINITIONS,
  exportProject,
} from '../lib/exportEngine';
import {
  exportExternalDawStems,
  DEFAULT_EXTERNAL_DAW_MIX_SETTINGS,
  EXTERNAL_DAW_TRACK_SCOPES,
  getExternalDawTrackDescriptors,
  normalizeExternalDawMixSettings,
} from '../lib/externalDawExport';
import { exportAsZIP, downloadFile } from '../lib/projectPortability';
import { loadExportDirectoryHandle, saveExportDirectoryHandle } from '../lib/db';
import { normalizeExportSettings } from '../types/project';
import { PAN_LAW_OPTIONS_DB } from '../utils/audio';
import { hasInvalidExportNameChars, normalizeExportName } from '../utils/naming';
import { reportUserError } from '../utils/errorReporter';
import { getEffectiveTrackMix } from '../utils/trackTree';
import {
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_METRONOME,
} from '../utils/trackRoles';

const PRESET_BY_ID = Object.fromEntries(
  EXPORT_PRESET_DEFINITIONS.map((preset) => [preset.id, preset])
);
const DEFAULT_EXPANDED_NODE_IDS = new Set(['all', 'practice']);
const EXPORT_TYPES = {
  RENDERED_MIXES: 'rendered-mixes',
  EXTERNAL_DAW: 'external-daw',
  INTERNAL_PROJECT: 'internal-project',
};
const EXPORT_DIALOG_PRESET_LABEL_OVERRIDES = {
  [EXPORT_PRESETS.ACAPELLA]: 'Instruments',
  [EXPORT_PRESETS.NO_LEAD]: 'Leads',
  [EXPORT_PRESETS.NO_CHOIR]: 'Choir',
  [EXPORT_PRESETS.INSTRUMENTAL]: 'Instruments',
  [EXPORT_PRESETS.LEAD_ONLY]: 'Lead',
  [EXPORT_PRESETS.CHOIR_ONLY]: 'Choir',
  [EXPORT_PRESETS.INSTRUMENT_PARTS]: 'Instruments',
  [EXPORT_PRESETS.LEAD_PARTS]: 'Leads',
  [EXPORT_PRESETS.CHOIR_PARTS]: 'Choir',
  [EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED]: 'Instruments',
  [EXPORT_PRESETS.LEAD_PARTS_OMITTED]: 'Leads',
  [EXPORT_PRESETS.CHOIR_PARTS_OMITTED]: 'Choir',
};
const EXTERNAL_DAW_MIX_OPTIONS = [
  ['trackVolume', 'Track volume', 'Apply Apollo track volume'],
  ['trackPan', 'Track pan', 'Apply Apollo track pan'],
  ['groupGain', 'Group gain', 'Apply Apollo group volume/gain'],
  ['groupPan', 'Group pan', 'Apply Apollo group pan'],
  ['muteStates', 'Mute/solo states', 'Apply Apollo mute and solo states'],
  ['masterSettings', 'Master settings', 'Apply Apollo master volume and output settings'],
];
function formatElapsedAdaptive(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  if (totalSeconds < 10) return `${totalSeconds}s`;
  if (totalSeconds < 60) return `${String(totalSeconds).padStart(2, '0')}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (minutes < 10) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatSecondsAsClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatEstimatedRemainingCustom(ms) {
  if (!Number.isFinite(ms)) return '...';
  const secondsRaw = Math.ceil(ms / 1000);
  if (secondsRaw < 0) return 'soon, i promise';

  if (secondsRaw <= 10) {
    return `${secondsRaw}s`;
  }

  if (secondsRaw <= 30) {
    const rounded = Math.round(secondsRaw / 5) * 5;
    return `${rounded}s`;
  }

  if (secondsRaw <= 120) {
    const rounded = Math.round(secondsRaw / 10) * 10;
    if (rounded > 60) return formatSecondsAsClock(rounded);
    return `${rounded}s`;
  }

  if (secondsRaw <= 300) {
    const rounded = Math.round(secondsRaw / 30) * 30;
    return formatSecondsAsClock(rounded);
  }

  const roundedMinutes = Math.round(secondsRaw / 60);
  return `${roundedMinutes} min`;
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
      });
    }
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
      });
    }
  }
  return Array.from(unitsById.values());
}

function buildPracticePartNodes(units, presetId, idPrefix) {
  return units.map((unit) => ({
    id: `${idPrefix}:${unit.unitId}`,
    label: unit.label,
    presetId,
    unitId: unit.unitId,
  }));
}

function buildAudioExportTree(instrumentUnits, leadUnits, choirUnits) {
  return {
    id: 'all',
    label: 'All',
    children: [
      { id: 'preset-tutti', presetId: EXPORT_PRESETS.TUTTI },
      {
        id: 'one-group-omitted',
        label: 'One Group Ommited',
        children: [
          { id: 'preset-acapella', presetId: EXPORT_PRESETS.ACAPELLA },
          { id: 'preset-no-lead', presetId: EXPORT_PRESETS.NO_LEAD },
          { id: 'preset-no-choir', presetId: EXPORT_PRESETS.NO_CHOIR },
        ],
      },
      {
        id: 'separated-groups',
        label: 'Separated Groups',
        children: [
          { id: 'preset-instrumental', presetId: EXPORT_PRESETS.INSTRUMENTAL },
          { id: 'preset-lead-only', presetId: EXPORT_PRESETS.LEAD_ONLY },
          { id: 'preset-choir-only', presetId: EXPORT_PRESETS.CHOIR_ONLY },
        ],
      },
      {
        id: 'practice',
        label: 'Practice',
        children: [
          {
            id: 'practice-normal',
            label: 'Normal',
            children: [
              {
                id: 'normal-instruments',
                label: 'Instruments',
                children: buildPracticePartNodes(
                  instrumentUnits,
                  EXPORT_PRESETS.INSTRUMENT_PARTS,
                  'part-normal-instrument'
                ),
              },
              {
                id: 'normal-leads',
                label: 'Leads',
                children: buildPracticePartNodes(
                  leadUnits,
                  EXPORT_PRESETS.LEAD_PARTS,
                  'part-normal-lead'
                ),
              },
              {
                id: 'normal-choir',
                label: 'Choir',
                children: buildPracticePartNodes(
                  choirUnits,
                  EXPORT_PRESETS.CHOIR_PARTS,
                  'part-normal-choir'
                ),
              },
            ],
          },
          {
            id: 'practice-omitted',
            label: 'Ommited',
            children: [
              {
                id: 'omitted-instruments',
                label: 'Instruments',
                children: buildPracticePartNodes(
                  instrumentUnits,
                  EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED,
                  'part-omitted-instrument'
                ),
              },
              {
                id: 'omitted-leads',
                label: 'Leads',
                children: buildPracticePartNodes(
                  leadUnits,
                  EXPORT_PRESETS.LEAD_PARTS_OMITTED,
                  'part-omitted-lead'
                ),
              },
              {
                id: 'omitted-choir',
                label: 'Choir',
                children: buildPracticePartNodes(
                  choirUnits,
                  EXPORT_PRESETS.CHOIR_PARTS_OMITTED,
                  'part-omitted-choir'
                ),
              },
            ],
          },
        ],
      },
    ],
  };
}

function TriStateCheckbox({ checked, indeterminate, disabled, onChange }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      className="shrink-0 h-4 w-4"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

async function hasWritePermission(handle) {
  if (!handle) return false;
  if (!handle.queryPermission) return true;
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (permission === 'prompt') {
      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    }
    return false;
  } catch (error) {
    reportUserError(
      'Failed while checking folder write permission.',
      error,
      { onceKey: 'export:check-write-permission' }
    );
    return false;
  }
}

async function getExportStartHandle(projectId) {
  try {
    const projectHandle = await loadExportDirectoryHandle(`project:${projectId}`);
    if (await hasWritePermission(projectHandle)) {
      return projectHandle;
    }
    const appHandle = await loadExportDirectoryHandle('global');
    if (await hasWritePermission(appHandle)) {
      return appHandle;
    }
  } catch (error) {
    reportUserError(
      'Failed to read remembered export folder. You may need to pick a folder again.',
      error,
      { onceKey: 'export:load-start-folder' }
    );
    return null;
  }
  return null;
}

async function pickExportDirectory(projectId) {
  if (!window.showDirectoryPicker) {
    throw new Error('Directory export is not supported in this browser.');
  }

  const startHandle = await getExportStartHandle(projectId);
  let directoryHandle = null;
  try {
    directoryHandle = startHandle
      ? await window.showDirectoryPicker({ mode: 'readwrite', startIn: startHandle })
      : await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    if (startHandle && (error?.name === 'TypeError' || error?.name === 'NotFoundError')) {
      directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } else {
      throw error;
    }
  }

  const canWrite = await hasWritePermission(directoryHandle);
  if (!canWrite) {
    throw new Error('No write permission for selected export folder.');
  }

  try {
    await saveExportDirectoryHandle(`project:${projectId}`, directoryHandle);
    await saveExportDirectoryHandle('global', directoryHandle);
  } catch (error) {
    reportUserError(
      'Could not save export folder preference. Export will still continue.',
      error,
      { onceKey: 'export:save-folder-handle' }
    );
  }
  return directoryHandle;
}

async function writeFileToDirectory(rootDirectoryHandle, relativePath, blob) {
  const segments = relativePath.split('/').filter(Boolean);
  const filename = segments.pop();
  let directory = rootDirectoryHandle;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function isDirectoryExportUnsupported(error) {
  return error?.name === 'NotSupportedError'
    || error?.message === 'Directory export is not supported in this browser.';
}

async function saveExportFiles(files, { directoryHandle = null, signal = null, onProgress = null } = {}) {
  let written = 0;
  for (const file of files) {
    if (signal?.aborted) {
      const abortError = new Error('Export cancelled');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (directoryHandle) {
      await writeFileToDirectory(directoryHandle, file.relativePath, file.blob);
    } else {
      // Browser downloads are saved to the user's configured default folder.
      downloadFile(file.blob, file.filename || file.relativePath);
    }

    written += 1;
    onProgress?.(written, files.length);
  }
}

function ExportDialog({ project, onClose, audioBuffers, mediaMap, onUpdateExportSettings }) {
  const abortControllerRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState(EXPORT_TYPES.RENDERED_MIXES);
  const [externalDawTrackScope, setExternalDawTrackScope] = useState(EXTERNAL_DAW_TRACK_SCOPES.AUDIBLE);
  const [externalDawIncludeMetronome, setExternalDawIncludeMetronome] = useState(false);
  const [externalDawMixSettings, setExternalDawMixSettings] = useState(
    { ...DEFAULT_EXTERNAL_DAW_MIX_SETTINGS }
  );
  const [externalDawSelectedTrackIds, setExternalDawSelectedTrackIds] = useState(new Set());
  const [selectedLeafNodeIds, setSelectedLeafNodeIds] = useState(new Set(['preset-tutti']));
  const [exportBaseName, setExportBaseName] = useState(project.musicalNumber || '0.0');
  const [fileFormat, setFileFormat] = useState('mp3');
  const [transformedPanRange, setTransformedPanRange] = useState(
    Number.isFinite(Number(project?.exportSettings?.transformedPanRange))
      ? Number(project.exportSettings.transformedPanRange)
      : 100
  );
  const [practiceFocusDiffDb, setPracticeFocusDiffDb] = useState(
    Number.isFinite(Number(project?.exportSettings?.practiceFocusDiffDb))
      ? Number(project.exportSettings.practiceFocusDiffDb)
      : 0
  );
  const [exportPanLawDb, setExportPanLawDb] = useState(
    Number.isFinite(Number(project?.exportSettings?.panLawDb))
      ? Number(project.exportSettings.panLawDb)
      : -3
  );
  const [exportForceMonoOutput, setExportForceMonoOutput] = useState(
    project?.exportSettings?.forceMonoOutput === true
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState(() => new Set(DEFAULT_EXPANDED_NODE_IDS));
  const [showProgressWindow, setShowProgressWindow] = useState(false);
  const [progressMode, setProgressMode] = useState(null);
  const [progressStatus, setProgressStatus] = useState('idle');
  const [progressMessage, setProgressMessage] = useState('');
  const [progressError, setProgressError] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [renderProgress, setRenderProgress] = useState({ completed: 0, total: 0 });
  const [writeProgress, setWriteProgress] = useState({ completed: 0, total: 0 });
  const [exportStartedAt, setExportStartedAt] = useState(null);
  const [exportCompletedAt, setExportCompletedAt] = useState(null);
  const [timeNow, setTimeNow] = useState(Date.now());
  const [remainingEstimateSnapshotMs, setRemainingEstimateSnapshotMs] = useState(null);
  const [remainingEstimateAnchorMs, setRemainingEstimateAnchorMs] = useState(null);
  const isRenderedMixExport = exportType === EXPORT_TYPES.RENDERED_MIXES;
  const isExternalDawExport = exportType === EXPORT_TYPES.EXTERNAL_DAW;
  const isInternalProjectExport = exportType === EXPORT_TYPES.INTERNAL_PROJECT;
  const practiceFocusDiffRatio = (Math.max(-6, Math.min(6, practiceFocusDiffDb)) + 6) / 12;
  const practiceFocusDiffLabelLeft = `calc(15px + ${practiceFocusDiffRatio} * (100% - 30px))`;

  useEffect(() => {
    const normalized = normalizeExportSettings(project?.exportSettings || {});
    setTransformedPanRange(normalized.transformedPanRange);
    setPracticeFocusDiffDb(normalized.practiceFocusDiffDb);
    setExportPanLawDb(normalized.panLawDb);
    setExportForceMonoOutput(normalized.forceMonoOutput);
  }, [project?.projectId, project?.exportSettings]);

  const { instrumentUnits, leadUnits, choirUnits } = useMemo(() => {
    const mix = getEffectiveTrackMix(project);
    const trackStateById = mix.statesByTrackId;
    const activeTracks = (project.tracks || []).filter((track) => trackStateById.get(track.id)?.audible);
    return {
      instrumentUnits: getRoleUnits(activeTracks, trackStateById, TRACK_ROLE_INSTRUMENT),
      leadUnits: getRoleUnits(activeTracks, trackStateById, TRACK_ROLE_LEAD),
      choirUnits: getChoirUnits(activeTracks, trackStateById),
    };
  }, [project]);

  const externalDawTrackDescriptors = useMemo(
    () => getExternalDawTrackDescriptors(project, {
      trackScope: EXTERNAL_DAW_TRACK_SCOPES.ALL,
      includeMetronome: true,
    }),
    [project]
  );
  const externalDawSelectableTrackDescriptors = useMemo(
    () => externalDawTrackDescriptors.filter(
      (descriptor) => externalDawIncludeMetronome || !descriptor.isMetronome
    ),
    [externalDawIncludeMetronome, externalDawTrackDescriptors]
  );
  const externalDawSelectedTrackCount = externalDawSelectableTrackDescriptors.reduce(
    (count, descriptor) => count + (externalDawSelectedTrackIds.has(descriptor.trackId) ? 1 : 0),
    0
  );
  const isExternalDawSelectionValid = externalDawTrackScope !== EXTERNAL_DAW_TRACK_SCOPES.SELECTED
    || externalDawSelectedTrackCount > 0;

  useEffect(() => {
    const descriptorIds = new Set(externalDawTrackDescriptors.map((descriptor) => descriptor.trackId));
    const defaultIds = new Set(
      externalDawTrackDescriptors
        .filter((descriptor) => descriptor.audible && !descriptor.isMetronome)
        .map((descriptor) => descriptor.trackId)
    );
    setExternalDawSelectedTrackIds((previous) => {
      const next = new Set([...previous].filter((trackId) => descriptorIds.has(trackId)));
      if (next.size === 0 && defaultIds.size > 0) return defaultIds;
      return next;
    });
  }, [externalDawTrackDescriptors]);

  const audioExportTree = useMemo(
    () => buildAudioExportTree(instrumentUnits, leadUnits, choirUnits),
    [instrumentUnits, leadUnits, choirUnits]
  );

  const leafNodeIdsByNodeId = useMemo(() => {
    const map = new Map();

    const walk = (node) => {
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      if (!hasChildren) {
        const ids = [node.id];
        map.set(node.id, ids);
        return ids;
      }
      const ids = (node.children || []).flatMap((child) => walk(child));
      map.set(node.id, ids);
      return ids;
    };

    walk(audioExportTree);
    return map;
  }, [audioExportTree]);

  const leafNodeById = useMemo(() => {
    const map = new Map();
    const walk = (node) => {
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      if (!hasChildren) {
        map.set(node.id, node);
        return;
      }
      node.children.forEach(walk);
    };
    walk(audioExportTree);
    return map;
  }, [audioExportTree]);

  useEffect(() => {
    setSelectedLeafNodeIds((prev) => {
      const valid = new Set();
      prev.forEach((id) => {
        if (leafNodeById.has(id)) valid.add(id);
      });
      if (valid.size === 0 && leafNodeById.has('preset-tutti')) {
        valid.add('preset-tutti');
      }
      return valid;
    });
  }, [leafNodeById]);

  const getNodeState = (nodeId) => {
    const leafIds = leafNodeIdsByNodeId.get(nodeId) || [];
    const selectedCount = leafIds.reduce(
      (count, id) => count + (selectedLeafNodeIds.has(id) ? 1 : 0),
      0
    );
    const checked = leafIds.length > 0 && selectedCount === leafIds.length;
    const indeterminate = selectedCount > 0 && selectedCount < leafIds.length;
    return { checked, indeterminate };
  };

  const toggleNode = (nodeId) => {
    const nodeLeafIds = leafNodeIdsByNodeId.get(nodeId) || [];
    setSelectedLeafNodeIds((prev) => {
      const next = new Set(prev);
      const allChecked = nodeLeafIds.length > 0 && nodeLeafIds.every((id) => next.has(id));
      if (allChecked) {
        nodeLeafIds.forEach((id) => next.delete(id));
      } else {
        nodeLeafIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectedPresetIds = useMemo(() => {
    const selectedPresetIdSet = new Set();
    selectedLeafNodeIds.forEach((leafId) => {
      const leaf = leafNodeById.get(leafId);
      if (leaf?.presetId) selectedPresetIdSet.add(leaf.presetId);
    });
    return Array.from(selectedPresetIdSet);
  }, [selectedLeafNodeIds, leafNodeById]);

  const selectedUnitIdsByPreset = useMemo(() => {
    const byPreset = {};
    selectedLeafNodeIds.forEach((leafId) => {
      const leaf = leafNodeById.get(leafId);
      if (!leaf?.presetId || !leaf.unitId) return;
      if (!byPreset[leaf.presetId]) byPreset[leaf.presetId] = [];
      byPreset[leaf.presetId].push(leaf.unitId);
    });
    return byPreset;
  }, [selectedLeafNodeIds, leafNodeById]);

  const toggleExternalDawTrack = (trackId) => {
    setExternalDawSelectedTrackIds((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleExternalDawIncludeMetronomeChange = (included) => {
    setExternalDawIncludeMetronome(included);
    if (!included) {
      setExternalDawSelectedTrackIds((previous) => new Set(
        [...previous].filter((trackId) => (
          !externalDawTrackDescriptors.find((descriptor) => descriptor.trackId === trackId)?.isMetronome
        ))
      ));
    }
  };

  const updateExternalDawMixSetting = (key, checked) => {
    setExternalDawMixSettings((previous) => normalizeExternalDawMixSettings({
      ...previous,
      [key]: checked,
    }));
  };

  const getNodeFileCountText = (nodeId) => {
    const leafIds = leafNodeIdsByNodeId.get(nodeId) || [];
    const total = leafIds.length;
    if (total === 0) return '0';
    const selected = leafIds.reduce(
      (count, leafId) => count + (selectedLeafNodeIds.has(leafId) ? 1 : 0),
      0
    );
    if (selected === 0 || selected === total) return `${total}`;
    return `${selected} / ${total}`;
  };

  useEffect(() => {
    if (!showProgressWindow || progressStatus !== 'running') return undefined;
    const interval = setInterval(() => setTimeNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [showProgressWindow, progressStatus]);

  const initializeProgress = (mode, initialMessage = 'Starting export...') => {
    setProgressMode(mode);
    setProgressStatus('running');
    setProgressMessage(initialMessage);
    setProgressError('');
    setProgressPercent(0);
    setRenderProgress({ completed: 0, total: 0 });
    setWriteProgress({ completed: 0, total: 0 });
    setExportStartedAt(Date.now());
    setExportCompletedAt(null);
    setTimeNow(Date.now());
    setRemainingEstimateSnapshotMs(null);
    setRemainingEstimateAnchorMs(null);
    setShowProgressWindow(true);
  };

  const markExportDone = (message = 'Export complete') => {
    setProgressStatus('done');
    setProgressMessage(message);
    setExportCompletedAt(Date.now());
    setProgressPercent(100);
  };

  const markExportError = (message) => {
    setProgressStatus('error');
    setProgressError(message || 'Export failed');
    setProgressMessage('Export failed');
    setExportCompletedAt(Date.now());
  };

  const totalElapsedMs = exportStartedAt
    ? ((progressStatus === 'running' ? timeNow : (exportCompletedAt || timeNow)) - exportStartedAt)
    : 0;
  const totalElapsed = formatElapsedAdaptive(totalElapsedMs);
  const formatExactPercent = (value) => `${Math.round(Math.max(0, Math.min(100, value)))}%`;

  const overallPercent = useMemo(() => {
    if (progressMode === 'audio') {
      const renderFraction = renderProgress.total > 0
        ? Math.max(0, Math.min(1, renderProgress.completed / renderProgress.total))
        : 0;
      const writeFraction = writeProgress.total > 0
        ? Math.max(0, Math.min(1, writeProgress.completed / writeProgress.total))
        : 0;
      return ((renderFraction * 0.99) + (writeFraction * 0.01)) * 100;
    }
    return Math.max(0, Math.min(100, progressPercent));
  }, [progressMode, renderProgress, writeProgress, progressPercent]);

  useEffect(() => {
    if (progressStatus !== 'running') return;
    const fraction = Math.max(0, Math.min(1, overallPercent / 100));
    if (!exportStartedAt || fraction <= 0) return;
    const now = Date.now();
    const elapsedMs = Math.max(0, now - exportStartedAt);
    const predictedTotalMs = elapsedMs / fraction;
    const nextRemaining = predictedTotalMs - elapsedMs;
    setRemainingEstimateSnapshotMs(nextRemaining);
    setRemainingEstimateAnchorMs(now);
  }, [progressStatus, overallPercent, exportStartedAt]);

  const estimatedRemaining = useMemo(() => {
    if (progressStatus !== 'running') return '';
    if (!Number.isFinite(remainingEstimateSnapshotMs) || !Number.isFinite(remainingEstimateAnchorMs)) {
      return '...';
    }
    const elapsedSinceAnchor = Math.max(0, timeNow - remainingEstimateAnchorMs);
    const tickingRemaining = remainingEstimateSnapshotMs - elapsedSinceAnchor;
    return formatEstimatedRemainingCustom(tickingRemaining);
  }, [
    progressStatus,
    remainingEstimateSnapshotMs,
    remainingEstimateAnchorMs,
    timeNow,
  ]);

  const currentStage = useMemo(() => {
    if (progressStatus === 'done') {
      return { label: '', detail: '', percent: 100 };
    }

    if (progressMode === 'audio') {
      const renderTotal = renderProgress.total;
      const renderDone = renderProgress.completed;
      const writeTotal = writeProgress.total;
      const writeDone = writeProgress.completed;

      if (renderTotal > 0 && renderDone < renderTotal) {
        return {
          label: 'Rendering/encoding',
          detail: `(${renderDone}/${renderTotal})`,
          percent: (renderDone / renderTotal) * 100,
        };
      }

      if (writeTotal > 0 && writeDone < writeTotal) {
        return {
          label: 'Writing files',
          detail: `(${writeDone}/${writeTotal})`,
          percent: (writeDone / writeTotal) * 100,
        };
      }

      if (renderTotal > 0 && writeTotal > 0 && writeDone >= writeTotal) {
        return {
          label: 'Writing files',
          detail: `(${writeTotal}/${writeTotal})`,
          percent: 100,
        };
      }

      return {
        label: 'Preparing',
        detail: '',
        percent: 0,
      };
    }

    return {
      label: progressMessage || 'Processing',
      detail: `${Math.round(progressPercent)}%`,
      percent: progressPercent,
    };
  }, [progressStatus, progressMode, renderProgress, writeProgress, progressMessage, progressPercent]);

  const isNodeExpanded = (nodeId) => expandedNodeIds.has(nodeId);
  const progressTitle = useMemo(() => {
    if (!showProgressWindow) return 'Export Options';
    if (progressMode === 'zip') {
      return progressStatus === 'done' ? 'Exported Project' : 'Exporting Project';
    }
    const count = Math.max(0, renderProgress.total || selectedLeafNodeIds.size || 0);
    const verb = progressStatus === 'done' ? 'Exported' : 'Exporting';
    const noun = isExternalDawExport ? 'stem' : 'file';
    return `${verb} ${count} ${noun}${count === 1 ? '' : 's'}`;
  }, [
    showProgressWindow,
    progressMode,
    progressStatus,
    renderProgress.total,
    selectedLeafNodeIds.size,
    isExternalDawExport,
  ]);

  const toggleNodeExpanded = (nodeId) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleExportAudio = async (format) => {
    if (!selectedPresetIds.length) {
      alert('Select at least one audio export option.');
      return;
    }
    const normalizedExportName = normalizeExportName(exportBaseName);
    if (!normalizedExportName) {
      alert('Export name cannot be empty.');
      return;
    }
    if (hasInvalidExportNameChars(normalizedExportName)) {
      alert('Export name cannot contain: \\ / : * ? " < > |');
      return;
    }

    setIsExporting(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let directoryHandle;
    let useBrowserDownloads = typeof window === 'undefined'
      || typeof window.showDirectoryPicker !== 'function';
    const exportSettingsForRun = normalizeExportSettings({
      ...(project.exportSettings || {}),
      transformedPanRange,
      practiceFocusDiffDb,
      panLawDb: exportPanLawDb,
      forceMonoOutput: exportForceMonoOutput,
    });

    try {
      // Must be called directly from the click gesture (Windows requires this).
      if (!useBrowserDownloads) {
        directoryHandle = await pickExportDirectory(project.projectId);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
      if (isDirectoryExportUnsupported(error)) {
        useBrowserDownloads = true;
        directoryHandle = null;
      } else {
        console.error('Export folder selection failed:', error);
        alert('Export failed: ' + error.message);
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
    }

    initializeProgress('audio', 'Preparing export...');
    setProgressMessage('Rendering/encoding...');

    try {
      const files = await exportProject(
        project,
        selectedPresetIds,
        audioBuffers,
        exportSettingsForRun,
        normalizedExportName,
        format,
        {
          selectedUnitIdsByPreset,
          signal: abortController.signal,
          onProgress: (info) => {
            if (abortController.signal.aborted) return;
            const fraction = Number.isFinite(info?.fraction) ? info.fraction : 0;
            const completed = Number.isFinite(info?.completed) ? info.completed : 0;
            const total = Number.isFinite(info?.total) ? info.total : 0;
            setRenderProgress({
              completed: Math.max(0, completed),
              total: Math.max(0, total),
            });
            const renderFraction = Math.max(0, Math.min(1, fraction));
            const writeFraction = writeProgress.total > 0
              ? Math.max(0, Math.min(1, writeProgress.completed / writeProgress.total))
              : 0;
            setProgressPercent(((renderFraction * 0.99) + (writeFraction * 0.01)) * 100);
          },
        }
      );
      setRenderProgress({
        completed: files.length,
        total: files.length,
      });

      if (!files.length) {
        throw new Error('No files produced by selected export options.');
      }

      setWriteProgress({ completed: 0, total: files.length });
      setProgressMessage(useBrowserDownloads ? 'Downloading files...' : 'Writing files...');
      await saveExportFiles(files, {
        directoryHandle: useBrowserDownloads ? null : directoryHandle,
        signal: abortController.signal,
        onProgress: (written, total) => {
          setWriteProgress({ completed: written, total });
          const writeFraction = total > 0 ? written / total : 1;
          setProgressPercent(((1 * 0.99) + (writeFraction * 0.01)) * 100);
        },
      });

      markExportDone(useBrowserDownloads ? 'Export downloaded' : 'Export complete');
      setIsExporting(false);
      abortControllerRef.current = null;
    } catch (error) {
      if (error?.name === 'AbortError') {
        markExportError('Export cancelled');
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
      console.error('Export failed:', error);
      markExportError(error?.message || 'Export failed');
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  };

  const handleExportExternalDaw = async () => {
    const normalizedExportName = normalizeExportName(exportBaseName);
    if (!normalizedExportName) {
      alert('Export name cannot be empty.');
      return;
    }
    if (hasInvalidExportNameChars(normalizedExportName)) {
      alert('Export name cannot contain: \\ / : * ? " < > |');
      return;
    }

    setIsExporting(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let directoryHandle;
    let useBrowserDownloads = typeof window === 'undefined'
      || typeof window.showDirectoryPicker !== 'function';

    try {
      // Must be called directly from the click gesture (Windows requires this).
      if (!useBrowserDownloads) {
        directoryHandle = await pickExportDirectory(project.projectId);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
      if (isDirectoryExportUnsupported(error)) {
        useBrowserDownloads = true;
        directoryHandle = null;
      } else {
        console.error('External DAW export folder selection failed:', error);
        alert('Export failed: ' + error.message);
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
    }

    initializeProgress('audio', 'Preparing External DAW stems...');
    setProgressMessage('Rendering/encoding...');

    try {
      const files = await exportExternalDawStems(
        project,
        audioBuffers,
        normalizedExportName,
        {
          signal: abortController.signal,
          trackScope: externalDawTrackScope,
          includeMetronome: externalDawIncludeMetronome,
          mixSettings: externalDawMixSettings,
          selectedTrackIds: externalDawTrackScope === EXTERNAL_DAW_TRACK_SCOPES.SELECTED
            ? [...externalDawSelectedTrackIds]
            : null,
          onProgress: (info) => {
            if (abortController.signal.aborted) return;
            const fraction = Number.isFinite(info?.fraction) ? info.fraction : 0;
            const completed = Number.isFinite(info?.completed) ? info.completed : 0;
            const total = Number.isFinite(info?.total) ? info.total : 0;
            setRenderProgress({
              completed: Math.max(0, completed),
              total: Math.max(0, total),
            });
            const renderFraction = Math.max(0, Math.min(1, fraction));
            const writeFraction = writeProgress.total > 0
              ? Math.max(0, Math.min(1, writeProgress.completed / writeProgress.total))
              : 0;
            setProgressPercent(((renderFraction * 0.99) + (writeFraction * 0.01)) * 100);
          },
        }
      );

      if (!files.length) {
        throw new Error('No files produced by the External DAW export.');
      }

      setRenderProgress({
        completed: Math.max(0, files.length - 1),
        total: Math.max(0, files.length - 1),
      });
      setWriteProgress({ completed: 0, total: files.length });
      setProgressMessage(useBrowserDownloads ? 'Downloading files...' : 'Writing files...');
      await saveExportFiles(files, {
        directoryHandle: useBrowserDownloads ? null : directoryHandle,
        signal: abortController.signal,
        onProgress: (written, total) => {
          setWriteProgress({ completed: written, total });
          const writeFraction = total > 0 ? written / total : 1;
          setProgressPercent(((1 * 0.99) + (writeFraction * 0.01)) * 100);
        },
      });

      markExportDone(useBrowserDownloads ? 'External DAW export downloaded' : 'External DAW export complete');
      setIsExporting(false);
      abortControllerRef.current = null;
    } catch (error) {
      if (error?.name === 'AbortError') {
        markExportError('Export cancelled');
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
      console.error('External DAW export failed:', error);
      markExportError(error?.message || 'Export failed');
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  };

  const handleExportProjectZIP = async () => {
    initializeProgress('zip', 'Creating ZIP archive');
    setIsExporting(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const normalizedExportName = normalizeExportName(exportBaseName);
      if (!normalizedExportName) {
        throw new Error('Export name cannot be empty.');
      }
      if (hasInvalidExportNameChars(normalizedExportName)) {
        throw new Error('Export name cannot contain: \\ / : * ? " < > |');
      }

      const { blob, filename } = await exportAsZIP(project, mediaMap, normalizedExportName, (info) => {
        if (typeof info?.message === 'string') {
          setProgressMessage(info.message);
        }
        if (Number.isFinite(info?.percent)) {
          setProgressPercent(Math.max(0, Math.min(100, info.percent)));
        }
      }, abortController.signal);
      setProgressMessage('Downloading ZIP');
      downloadFile(blob, filename);
      setProgressPercent(100);
      markExportDone('ZIP export complete');
      setIsExporting(false);
      abortControllerRef.current = null;
    } catch (error) {
      if (error?.name === 'AbortError') {
        markExportError('Export cancelled');
        setIsExporting(false);
        abortControllerRef.current = null;
        return;
      }
      console.error('Export project ZIP failed:', error);
      markExportError(error?.message || 'Export failed');
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  };

  const handleExport = async () => {
    if (isInternalProjectExport) {
      await handleExportProjectZIP();
      return;
    }
    if (isExternalDawExport) {
      await handleExportExternalDaw();
      return;
    }
    await handleExportAudio(fileFormat);
  };

  const handleUpdateExportSetting = (updates) => {
    const normalized = normalizeExportSettings({
      ...(project?.exportSettings || {}),
      transformedPanRange,
      practiceFocusDiffDb,
      panLawDb: exportPanLawDb,
      forceMonoOutput: exportForceMonoOutput,
      ...updates,
    });
    if (typeof updates.transformedPanRange !== 'undefined') {
      setTransformedPanRange(normalized.transformedPanRange);
    }
    if (typeof updates.practiceFocusDiffDb !== 'undefined') {
      setPracticeFocusDiffDb(normalized.practiceFocusDiffDb);
    }
    if (typeof updates.panLawDb !== 'undefined') {
      setExportPanLawDb(normalized.panLawDb);
    }
    if (typeof updates.forceMonoOutput !== 'undefined') {
      setExportForceMonoOutput(normalized.forceMonoOutput);
    }
    onUpdateExportSettings?.({
      transformedPanRange: normalized.transformedPanRange,
      practiceFocusDiffDb: normalized.practiceFocusDiffDb,
      panLawDb: normalized.panLawDb,
      forceMonoOutput: normalized.forceMonoOutput,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className={`bg-gray-800 rounded-lg w-full overflow-hidden flex flex-col ${
          showProgressWindow
            ? 'max-w-sm'
            : 'max-w-3xl h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)]'
        }`}
      >
        {showProgressWindow ? (
          <div className="px-3 py-3 flex items-center justify-center">
            <h2 className="text-xl font-semibold text-center">{progressTitle}</h2>
          </div>
        ) : (
          <div className="px-3 py-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{progressTitle}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
              disabled={isExporting}
            >
              <X size={24} />
            </button>
          </div>
        )}

        {!showProgressWindow ? (
          <div className="flex-1 min-h-0 overflow-hidden px-3 pt-0 pb-3 flex flex-col">
            <div className="grid grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[1fr_320px] lg:grid-rows-1 gap-4 flex-1 min-h-0">
              <div className="bg-gray-900 rounded-lg p-3 h-full overflow-auto min-h-0">
                {isRenderedMixExport ? (() => {
                  const renderNode = (node, depth = 0) => {
                    const preset = node.presetId ? PRESET_BY_ID[node.presetId] : null;
                    const label = node.label || (
                      preset ? (EXPORT_DIALOG_PRESET_LABEL_OVERRIDES[preset.id] || preset.label) : ''
                    );
                    const state = getNodeState(node.id);
                    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
                    const expanded = hasChildren ? isNodeExpanded(node.id) : false;
                    const fileCountText = hasChildren ? getNodeFileCountText(node.id) : null;

                    return (
                      <div key={node.id} className={depth > 0 ? 'mt-0' : ''}>
                        <label
                          className="flex h-[30px] items-center gap-1.5 rounded px-0 py-0 leading-none hover:bg-gray-800/60"
                          style={{ marginLeft: `${depth * 20}px` }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleNodeExpanded(node.id);
                              }}
                              className="w-3 h-4 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-200"
                              disabled={isExporting}
                            >
                              {expanded ? (
                                <ChevronDown className="w-full h-full" strokeWidth={2.5} />
                              ) : (
                                <ChevronRight className="w-full h-full" strokeWidth={2.5} />
                              )}
                            </button>
                          ) : (
                            <span className="w-3 h-4 shrink-0" />
                          )}
                          <TriStateCheckbox
                            checked={state.checked}
                            indeterminate={state.indeterminate}
                            onChange={() => toggleNode(node.id)}
                            disabled={isExporting}
                          />
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 truncate whitespace-nowrap font-medium text-[22.5px] text-gray-200">
                              {label}
                            </span>
                            {fileCountText && (
                              <span className="relative top-px shrink-0 text-[18px] text-gray-400 leading-none">{fileCountText}</span>
                            )}
                          </span>
                        </label>
                        {hasChildren && expanded && (
                          <div>
                            {node.children.map((child) => renderNode(child, depth + 1))}
                          </div>
                        )}
                      </div>
                    );
                  };
                  return renderNode(audioExportTree, 0);
                })() : (
                  <div className="h-full flex items-center justify-center text-center text-sm text-gray-400 px-6">
                    {isExternalDawExport
                      ? 'Exports one time-aligned stem per Apollo track. Group names are included in non-root track filenames.'
                      : 'Exports the Apollo project as an internal Apollo Project ZIP, including its project data and media.'}
                  </div>
                )}
              </div>
              <div className="p-0 h-auto lg:h-full min-h-0 overflow-y-auto pr-1 flex flex-col">
                <div className="mb-3">
                  <label className="block text-xs text-gray-400 mb-1">Export type</label>
                  <select
                    value={exportType}
                    onChange={(e) => setExportType(e.target.value)}
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    disabled={isExporting}
                  >
                    <option value={EXPORT_TYPES.RENDERED_MIXES}>Rendered Apollo Mixes</option>
                    <option value={EXPORT_TYPES.EXTERNAL_DAW}>External DAW</option>
                    <option value={EXPORT_TYPES.INTERNAL_PROJECT}>Internal Apollo Project</option>
                  </select>
                </div>
                {isRenderedMixExport && (
                  <>
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400 mb-1">File format</label>
                      <select
                        value={fileFormat}
                        onChange={(e) => setFileFormat(e.target.value)}
                        className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                        disabled={isExporting}
                      >
                        <option value="mp3">MP3</option>
                        <option value="wav">WAV</option>
                      </select>
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400 mb-1">Transformed pan range</label>
                      <input
                        type="number"
                        className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                        value={transformedPanRange}
                        onChange={(e) => handleUpdateExportSetting({ transformedPanRange: Number(e.target.value) })}
                        disabled={isExporting}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400">
                        Practice focus difference (dB)
                      </label>
                      <div className="relative px-2 pt-5">
                        <div
                          className="absolute top-1.5 text-[11px] tabular-nums whitespace-nowrap text-white font-medium leading-none pointer-events-none"
                          style={{
                            left: practiceFocusDiffLabelLeft,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          {practiceFocusDiffDb}
                        </div>
                        <div className="relative h-6">
                          <div className="absolute z-0 left-0 right-0 top-1/2 -translate-y-1/2 h-2 rounded-full border border-slate-700 bg-[#0b1528] pointer-events-none" />
                          <div
                            className="absolute z-10 left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-between pointer-events-none"
                            style={{ paddingLeft: '7px', paddingRight: '7px' }}
                          >
                            {Array.from({ length: 13 }, (_, idx) => (
                              <span
                                key={idx}
                                className={`block w-px ${idx % 2 === 0 ? 'h-3 bg-slate-400/90' : 'h-2 bg-slate-500/90'}`}
                              />
                            ))}
                          </div>
                          <input
                            type="range"
                            min={-6}
                            max={6}
                            step={1}
                            className="relative z-20 w-full practice-diff-slider cursor-pointer"
                            value={practiceFocusDiffDb}
                            onChange={(e) => handleUpdateExportSetting({ practiceFocusDiffDb: Number(e.target.value) })}
                            disabled={isExporting}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                          checked={exportForceMonoOutput}
                          onChange={(e) => handleUpdateExportSetting({ forceMonoOutput: e.target.checked })}
                          disabled={isExporting}
                        />
                        <span>Force mono export</span>
                      </label>
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400 mb-1">Panning law</label>
                      <select
                        value={String(exportForceMonoOutput ? 0 : exportPanLawDb)}
                        onChange={(e) => handleUpdateExportSetting({ panLawDb: Number(e.target.value) })}
                        className={`w-full rounded border px-3 py-2 text-sm focus:outline-none ${
                          exportForceMonoOutput
                            ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-gray-900 border-gray-700'
                        }`}
                        disabled={isExporting || exportForceMonoOutput}
                      >
                        {exportForceMonoOutput ? (
                          <option value="0">0 dB</option>
                        ) : (
                          PAN_LAW_OPTIONS_DB.map((value) => (
                            <option key={value} value={value}>
                              {`${value} dB`}
                            </option>
                          ))
                        )}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        {exportForceMonoOutput
                          ? 'Panning law is disabled while exporting mono.'
                          : 'Stereo export pan law'}
                      </p>
                    </div>
                  </>
                )}
                {isExternalDawExport && (
                  <div className="mb-3 rounded bg-gray-900 px-3 py-3 text-sm text-gray-300 space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Tracks</label>
                      <select
                        value={externalDawTrackScope}
                        onChange={(e) => setExternalDawTrackScope(e.target.value)}
                        className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                        disabled={isExporting}
                      >
                        <option value={EXTERNAL_DAW_TRACK_SCOPES.AUDIBLE}>All audible tracks</option>
                        <option value={EXTERNAL_DAW_TRACK_SCOPES.ALL}>All tracks, including muted</option>
                        <option value={EXTERNAL_DAW_TRACK_SCOPES.SELECTED}>Choose tracks...</option>
                      </select>
                    </div>

                    {externalDawTrackScope === EXTERNAL_DAW_TRACK_SCOPES.SELECTED && (
                      <div>
                        <div className="mb-1 text-xs text-gray-500">
                          {externalDawSelectedTrackCount} selected
                        </div>
                        <div className="max-h-40 overflow-auto rounded border border-gray-700 bg-gray-800 px-2 py-1">
                          {externalDawSelectableTrackDescriptors.map((descriptor) => (
                              <label
                                key={descriptor.trackId}
                                className="flex items-center gap-2 py-1 text-xs text-gray-300"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900"
                                  checked={externalDawSelectedTrackIds.has(descriptor.trackId)}
                                  onChange={() => toggleExternalDawTrack(descriptor.trackId)}
                                  disabled={isExporting}
                                />
                                <span className="truncate">{descriptor.pathLabel}</span>
                                {!descriptor.audible && (
                                  <span className="shrink-0 text-gray-500">(muted)</span>
                                )}
                              </label>
                            ))}
                          {externalDawSelectableTrackDescriptors.length === 0 && (
                            <div className="py-2 text-xs text-gray-500">No audio tracks available.</div>
                          )}
                        </div>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                        checked={externalDawIncludeMetronome}
                        onChange={(e) => handleExternalDawIncludeMetronomeChange(e.target.checked)}
                        disabled={isExporting}
                      />
                      <span>Include metronome</span>
                    </label>

                    <div>
                      <div className="mb-1 text-xs text-gray-400">Mix handling</div>
                      <div className="space-y-2">
                        {EXTERNAL_DAW_MIX_OPTIONS.map(([key, label, description]) => (
                          <label key={key} className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900"
                              checked={externalDawMixSettings[key]}
                              onChange={(e) => updateExternalDawMixSetting(key, e.target.checked)}
                              disabled={isExporting}
                            />
                            <span>
                              <span className="block text-sm text-gray-300">{label}</span>
                              <span className="block text-xs text-gray-500">{description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Clip edits are always applied.</p>
                    </div>
                  </div>
                )}
                {isInternalProjectExport && (
                  <div className="mb-3 rounded bg-gray-900 px-3 py-3 text-sm text-gray-300">
                    <div className="font-medium text-gray-200">Apollo Project ZIP</div>
                    <p className="mt-1 text-xs text-gray-500">
                      Includes the Apollo project data and source media for importing back into Apollo.
                    </p>
                  </div>
                )}
                <div className="mt-auto">
                  <div className="mb-3">
                    <label className="block text-xs text-gray-400 mb-1">Export name</label>
                    <input
                      type="text"
                      value={exportBaseName}
                      onChange={(e) => setExportBaseName(e.target.value)}
                      className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                      placeholder="Export base name"
                      disabled={isExporting}
                    />
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={
                      isExporting
                      || (isRenderedMixExport && selectedPresetIds.length === 0)
                      || (isExternalDawExport && !isExternalDawSelectionValid)
                    }
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload size={20} />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto px-3 pt-0 pb-3">
            <div className="bg-gray-900 rounded-lg p-4">
              {progressError && (
                <div className="mb-4 rounded border border-red-700 bg-red-900/20 px-3 py-2 text-sm text-red-300">
                  {progressError}
                </div>
              )}
              <div className="mb-2 text-sm text-gray-300">
                <div>
                  {`${currentStage.label}${currentStage.detail ? ` ${currentStage.detail}` : ''}`}
                </div>
              </div>
              <div className="h-2 w-full rounded bg-gray-800 border border-gray-700 overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${overallPercent}%` }}
                />
              </div>
              <div className="mt-3 space-y-1 text-xs text-gray-300">
                <div className="flex items-center justify-between">
                  <span>Progress</span>
                  <span>{formatExactPercent(overallPercent)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total elapsed</span>
                  <span>{totalElapsed}</span>
                </div>
                {progressStatus === 'running' && (
                  <div className="flex items-center justify-between">
                    <span>Est. time left</span>
                    <span>{estimatedRemaining}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showProgressWindow && (
          <div className="px-3 pt-0 pb-3 flex items-center justify-center">
            <button
              onClick={() => {
                if (progressStatus === 'done') {
                  onClose();
                  return;
                }
                abortControllerRef.current?.abort();
                setProgressMessage('Cancelling...');
              }}
              className={`px-6 py-2 rounded transition-colors ${
                progressStatus === 'done'
                  ? 'bg-gray-700 hover:bg-gray-600'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {progressStatus === 'done' ? 'Close' : 'Abort'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default ExportDialog;
