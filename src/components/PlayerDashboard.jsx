import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronsLeftRightEllipsis,
  CircleUserRound,
  ChevronLeft,
  ChevronRight,
  Folder,
  HeadphoneOff,
  Headphones,
  Home,
  ListMusic,
  Loader2,
  Music,
  Metronome,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Repeat1,
  Repeat,
  Scale,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BrandWordmark } from './BrandLogo';
import { PlaybackDevicesSettingsPanel } from './SettingsPanels';
import {
  addPlayerPlaylistItem,
  bootstrapServerProject,
  createPlayerFolder,
  createPlayerPlaylist,
  createVirtualMix,
  deletePlayerPlaylistItem,
  deletePlayerFolder,
  deletePlayerPlaylist,
  deleteVirtualMix,
  downloadMediaBlob,
  fetchPlayerGlobalMixes,
  fetchPlayerMyDevice,
  fetchPlayerTuttiMixes,
  getProjectCredits,
  reorderPlayerPlaylistItems,
  updatePlayerFolder,
  updatePlayerPlaylist,
  updateVirtualMix,
} from '../lib/serverApi';
import {
  createEditableMixSource,
  EXPORT_PRESETS,
  PRACTICE_REALTIME_MODES,
  isGroupMixPresetId,
  isPracticeOmittedPresetId,
  isPracticePresetId,
  listPresetVariants,
  resolveAdvancedMixRealtimeTrackMix,
  resolvePracticeRealtimeTrackMix,
} from '../lib/exportEngine';
import { audioManager } from '../lib/audioManager';
import { getMediaBlob, storeMediaBlob } from '../lib/db';
import { getEffectiveTrackMix } from '../utils/trackTree';
import {
  createQueueItemFromMix,
  PLAYER_COLLECTION_TYPES,
  PLAYER_LOOP_MODES,
} from '../types/player';
import { TRACK_ROLE_METRONOME } from '../utils/trackRoles';
import { usePlaybackDeviceSettings } from '../hooks/usePlaybackDeviceSettings';
import { cacheRemoteBlobAsLocalWav } from '../lib/mediaEncoding';
import { reportUserError } from '../utils/errorReporter';
import { isTextEntryTarget } from '../utils/keyboard';
import {
  canResumePlayerPlayback,
  resolvePlayerSpaceAction,
} from '../utils/playerSpacePlayback';
import {
  computeSnapshotDurationMs,
  formatClock,
  formatDurationMs,
} from '../utils/playerTime';
import {
  ADVANCED_MIX_PRESET_ID,
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS,
  ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  isAdvancedMixPreset,
  normalizeAdvancedMixState,
} from '../utils/advancedMix';

const PRACTICE_FOCUS_STEPS = ADVANCED_MIX_PRACTICE_FOCUS_STEPS;
const PRACTICE_FOCUS_SLIDER_POSITIONS = ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS;
const PRACTICE_FOCUS_MIN_INDEX = ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX;
const PRACTICE_FOCUS_MAX_INDEX = ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX;
const PRACTICE_FOCUS_DEFAULT_INDEX = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
const PRACTICE_FOCUS_NUMERIC_STEPS = ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS;
const PAN_TRACK_WIDTH_PX = 160;
const PAN_INNER_TRACK_WIDTH_PX = 134;
const APP_SETTINGS_STORAGE_KEY = 'apollo.settings';
const DEFAULT_PLAYER_PLAYBACK_PREFERENCES = {
  practicePanRange: 100,
  practiceFocusControl: PRACTICE_FOCUS_DEFAULT_INDEX,
  metronomeMuted: false,
};

function normalizePlayerPlaybackPreferences(settings = {}) {
  const practicePanRange = Number(
    settings.playerPracticePanRange ?? settings.practicePanRange
  );
  const practiceFocusControl = Number(
    settings.playerPracticeFocusControl ?? settings.practiceFocusControl
  );
  return {
    practicePanRange: Number.isFinite(practicePanRange)
      ? Math.max(0, Math.min(200, Math.round(practicePanRange)))
      : DEFAULT_PLAYER_PLAYBACK_PREFERENCES.practicePanRange,
    practiceFocusControl: Number.isFinite(practiceFocusControl)
      ? Math.max(PRACTICE_FOCUS_MIN_INDEX, Math.min(PRACTICE_FOCUS_MAX_INDEX, Math.round(practiceFocusControl)))
      : DEFAULT_PLAYER_PLAYBACK_PREFERENCES.practiceFocusControl,
    metronomeMuted: settings.playerMetronomeMuted === true || settings.metronomeMuted === true,
  };
}

function pickRandomQueueIndex(currentIndex, totalCount) {
  if (totalCount <= 1) return currentIndex;
  let candidate = currentIndex;
  let guard = 0;
  while (candidate === currentIndex && guard < 20) {
    candidate = Math.floor(Math.random() * totalCount);
    guard += 1;
  }
  if (candidate === currentIndex) {
    candidate = (currentIndex + 1) % totalCount;
  }
  return candidate;
}

function isNoopPlaylistDropSlot(fromIndex, slotIndex) {
  return slotIndex === fromIndex || slotIndex === fromIndex + 1;
}

function reorderPlaylistItems(items, fromIndex, slotIndex) {
  if (!Array.isArray(items) || fromIndex < 0 || fromIndex >= items.length) {
    return Array.isArray(items) ? items : [];
  }
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) return items;
  const adjustedIndex = slotIndex > fromIndex ? slotIndex - 1 : slotIndex;
  const targetIndex = Math.max(0, Math.min(nextItems.length, adjustedIndex));
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems.map((item, index) => ({
    ...item,
    orderIndex: index,
  }));
}

function getSnapshotMetronomeTracks(snapshot) {
  return (snapshot?.tracks || []).filter((track) => track?.role === TRACK_ROLE_METRONOME);
}

function hasSnapshotMetronome(snapshot) {
  return getSnapshotMetronomeTracks(snapshot).length > 0;
}

function withSnapshotMetronomeMuted(snapshot, muted) {
  if (!snapshot || typeof snapshot !== 'object' || !hasSnapshotMetronome(snapshot)) {
    return snapshot;
  }
  return {
    ...snapshot,
    tracks: (snapshot.tracks || []).map((track) => (
      track?.role === TRACK_ROLE_METRONOME
        ? { ...track, muted: Boolean(muted) }
        : track
    )),
  };
}

function applyLiveMetronomeMix(snapshot) {
  const mix = getEffectiveTrackMix(snapshot);
  getSnapshotMetronomeTracks(snapshot).forEach((track) => {
    const state = mix.statesByTrackId.get(track.id);
    audioManager.updateTrackMix(
      track.id,
      state?.audible === true && Number.isFinite(state.effectiveGain) ? state.effectiveGain : 0,
      Number.isFinite(state?.effectivePan) ? state.effectivePan : 0
    );
  });
}

function selectFromPrompt(label, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const selectableOptions = [];
  const lines = options.map((option) => {
    if (option?.kind === 'header') {
      return `${option.label}`;
    }
    selectableOptions.push(option);
    return `${selectableOptions.length}. ${option.label} (${option.value})`;
  }).join('\n');
  const input = window.prompt(`${label}\n${lines}`, '1');
  if (input == null) return null;
  const trimmed = String(input).trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= selectableOptions.length) {
    return selectableOptions[numeric - 1].value;
  }
  const byValue = selectableOptions.find((option) => option.value === trimmed);
  return byValue ? byValue.value : null;
}

function createEphemeralMediaEntry(blobId, fileName, audioBuffer, blob) {
  return {
    blobId,
    fileName,
    sampleRate: audioBuffer.sampleRate,
    durationMs: audioBuffer.duration * 1000,
    channels: audioBuffer.numberOfChannels,
    blob,
    createdAt: Date.now(),
  };
}

function buildDefaultMixName(projectLike, mixLabel) {
  return `${projectLike?.musicalNumber ? `${projectLike.musicalNumber} - ` : ''}${projectLike?.name || projectLike?.projectName || 'Mix'}${mixLabel ? ` - ${mixLabel}` : ''}`;
}

function buildMixCategoryOptions(snapshot) {
  const groupMixOptions = buildGroupMixOptions(snapshot);
  const partMixSections = buildPartMixSections(snapshot);
  return [
    {
      id: 'tutti',
      label: 'Tutti',
    },
    groupMixOptions.length > 1 ? {
      id: 'group',
      label: 'Group-mix',
    } : null,
    partMixSections.length ? {
      id: 'part',
      label: 'Part-mix',
    } : null,
    {
      id: 'advanced',
      label: 'Advanced mix',
    },
  ].filter(Boolean);
}

function buildAdvancedPlaybackSnapshot(baseSnapshot, item) {
  if (!isAdvancedMixPreset(item?.presetId)) return baseSnapshot;
  const advancedState = normalizeAdvancedMixState(item?.advancedMix || {});
  const source = advancedState.snapshot && typeof advancedState.snapshot === 'object'
    ? advancedState.snapshot
    : baseSnapshot;
  return {
    ...source,
    projectId: baseSnapshot?.projectId || item?.projectId || source?.projectId,
    sourceProjectId: baseSnapshot?.projectId || item?.projectId || source?.sourceProjectId || null,
    projectName: item?.name || source?.projectName || baseSnapshot?.projectName || 'Advanced Mix',
    musicalNumber: baseSnapshot?.musicalNumber ?? source?.musicalNumber ?? '0.0',
    showId: baseSnapshot?.showId ?? source?.showId ?? null,
    showName: baseSnapshot?.showName ?? source?.showName ?? '',
  };
}

function CreditsDialog({ state, onClose }) {
  if (!state) return null;
  const data = state.data || null;
  const renderArtists = (artists = []) => (
    <div className="flex flex-wrap gap-1.5">
      {artists.map((artist) => (
        <span
          key={`${artist.type}:${artist.id}`}
          className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-100"
          title={artist.description || undefined}
        >
          {artist.name}
        </span>
      ))}
      {!artists.length ? <span className="text-sm text-gray-500">-</span> : null}
    </div>
  );
  const renderCategory = (title, rows = []) => (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{title}</h3>
      {!rows.length ? (
        <div className="text-sm text-gray-500">No credits.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={`${title}:${row.roleKey || row.partName}`}
              className="grid gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 sm:grid-cols-[150px,1fr]"
            >
              <div className="text-sm font-medium text-gray-300">{row.roleLabel || row.partName}</div>
              {renderArtists(row.artists)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
  const renderPerformerRow = (row, nested = false) => {
    const artist = row.artist || row.artists?.[0] || null;
    const contributionLabel = row.contributionLabel || row.contributionNames?.join(' · ') || row.roleLabel || row.partName || '';
    return (
      <div
        key={`${nested ? 'member' : 'performer'}:${artist?.type || 'unknown'}:${artist?.id || contributionLabel}`}
        className={`${nested ? 'ml-5 border-l border-gray-800 pl-4' : 'rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2'}`}
      >
        <div className="text-sm font-semibold text-gray-100" title={artist?.description || undefined}>
          {artist?.name || '-'}
        </div>
        {contributionLabel ? (
          <div className="mt-0.5 text-xs text-gray-400">{contributionLabel}</div>
        ) : null}
        {row.members?.length ? (
          <div className="mt-2 space-y-2">
            {row.members.map((member) => renderPerformerRow(member, true))}
          </div>
        ) : null}
      </div>
    );
  };
  const renderPerformers = (rows = []) => (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Performers</h3>
      {!rows.length ? (
        <div className="text-sm text-gray-500">No credits.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => renderPerformerRow(row))}
        </div>
      )}
    </section>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close credits" />
      <div className="relative max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-5 py-4">
          <div>
            <div className="text-lg font-semibold">Credits</div>
            <div className="text-sm text-gray-400">{state.title || data?.project?.name || 'Musical number'}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800">
            Close
          </button>
        </div>
        <div className="max-h-[calc(86vh-76px)] overflow-auto px-5 py-4">
          {state.status === 'loading' ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading credits...</div>
          ) : state.error ? (
            <div className="rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{state.error}</div>
          ) : (
            <div className="space-y-5">
              {data?.show ? (
                <section className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3">
                  <div className="text-sm font-semibold text-gray-100">{data.show.name}</div>
                  {data.show.description ? (
                    <p className="mt-2 text-sm leading-6 text-gray-300">{data.show.description}</p>
                  ) : null}
                  {data.show.producers?.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[110px,1fr]">
                      <div className="text-sm font-medium text-gray-400">Producer</div>
                      {renderArtists(data.show.producers)}
                    </div>
                  ) : null}
                </section>
              ) : null}
              {renderCategory('Artist', data?.credits?.artist || [])}
              {renderCategory('Composition & Lyrics', data?.credits?.compositionLyrics || [])}
              {renderCategory('Production & Engineering', data?.credits?.productionEngineering || [])}
              {renderPerformers(data?.credits?.performers || [])}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildGroupMixOptions(snapshot) {
  const options = [];
  if (listPresetVariants(snapshot, EXPORT_PRESETS.INSTRUMENT_PARTS).length) {
    options.push({
      value: 'instruments',
      label: 'Instruments',
      onlyPresetId: EXPORT_PRESETS.INSTRUMENTAL,
      omittedPresetId: EXPORT_PRESETS.ACAPELLA,
    });
  }
  if (listPresetVariants(snapshot, EXPORT_PRESETS.LEAD_PARTS).length) {
    options.push({
      value: 'leads',
      label: 'Leads',
      onlyPresetId: EXPORT_PRESETS.LEAD_ONLY,
      omittedPresetId: EXPORT_PRESETS.NO_LEAD,
    });
  }
  if (listPresetVariants(snapshot, EXPORT_PRESETS.CHOIR_PARTS).length) {
    options.push({
      value: 'choirs',
      label: 'Choirs',
      onlyPresetId: EXPORT_PRESETS.CHOIR_ONLY,
      omittedPresetId: EXPORT_PRESETS.NO_CHOIR,
    });
  }
  return options;
}

function buildPartMixSections(snapshot) {
  const instrumentParts = listPresetVariants(snapshot, EXPORT_PRESETS.INSTRUMENT_PARTS);
  const leadParts = listPresetVariants(snapshot, EXPORT_PRESETS.LEAD_PARTS);
  const choirParts = listPresetVariants(snapshot, EXPORT_PRESETS.CHOIR_PARTS);
  const sections = [];

  if (instrumentParts.length) {
    sections.push({
      label: 'Instruments',
      options: instrumentParts.map((variant) => ({
        value: `${EXPORT_PRESETS.INSTRUMENT_PARTS}:${variant.key}`,
        label: variant.label,
        presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
        presetVariantKey: variant.key,
      })),
    });
  }
  if (leadParts.length) {
    sections.push({
      label: 'Leads',
      options: leadParts.map((variant) => ({
        value: `${EXPORT_PRESETS.LEAD_PARTS}:${variant.key}`,
        label: variant.label,
        presetId: EXPORT_PRESETS.LEAD_PARTS,
        presetVariantKey: variant.key,
      })),
    });
  }
  if (choirParts.length) {
    sections.push({
      label: 'Choirs',
      options: choirParts.map((variant) => ({
        value: `${EXPORT_PRESETS.CHOIR_PARTS}:${variant.key}`,
        label: variant.label,
        presetId: EXPORT_PRESETS.CHOIR_PARTS,
        presetVariantKey: variant.key,
      })),
    });
  }

  return sections;
}

function resolveGroupMixSelection(groupMixOptions, selectedGroupIds) {
  const normalizedSelection = Array.isArray(selectedGroupIds)
    ? selectedGroupIds.filter(Boolean)
    : [];
  if (!normalizedSelection.length) return null;

  if (normalizedSelection.length === 1) {
    const selectedGroup = groupMixOptions.find((option) => option.value === normalizedSelection[0]);
    if (!selectedGroup) return null;
    return {
      presetId: selectedGroup.onlyPresetId,
      mixLabel: selectedGroup.label,
    };
  }

  if (normalizedSelection.length === 2 && groupMixOptions.length === 3) {
    const selectedSet = new Set(normalizedSelection);
    const omittedGroup = groupMixOptions.find((option) => !selectedSet.has(option.value));
    const selectedLabels = groupMixOptions
      .filter((option) => selectedSet.has(option.value))
      .map((option) => option.label);
    if (!omittedGroup || selectedLabels.length !== 2) return null;
    return {
      presetId: omittedGroup.omittedPresetId,
      mixLabel: selectedLabels.join(' + '),
    };
  }

  return null;
}

function PlayerDashboard({
  session,
  onLogout,
  onSwitchToDawDashboard,
  onOpenAdvancedMix = null,
  onOpenAdmin = null,
  onOpenProfile = null,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [folders, setFolders] = useState([]);
  const [myMixes, setMyMixes] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [playlistItemsByPlaylistId, setPlaylistItemsByPlaylistId] = useState({});
  const [tuttiMixes, setTuttiMixes] = useState([]);
  const [globalMixes, setGlobalMixes] = useState([]);

  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [activeCollectionType, setActiveCollectionType] = useState(PLAYER_COLLECTION_TYPES.TUTTI);
  const [activeCollectionId, setActiveCollectionId] = useState('tutti');
  const [activeIndex, setActiveIndex] = useState(-1);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolume] = useState(80);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [loopMode, setLoopMode] = useState(PLAYER_LOOP_MODES.OFF);
  const [nowPlayingLabel, setNowPlayingLabel] = useState('');
  const [practicePanRange, setPracticePanRange] = useState(DEFAULT_PLAYER_PLAYBACK_PREFERENCES.practicePanRange);
  const [practiceFocusControl, setPracticeFocusControl] = useState(DEFAULT_PLAYER_PLAYBACK_PREFERENCES.practiceFocusControl);
  const [hasRealtimeMetronome, setHasRealtimeMetronome] = useState(false);
  const [isRealtimeMetronomeMuted, setIsRealtimeMetronomeMuted] = useState(DEFAULT_PLAYER_PLAYBACK_PREFERENCES.metronomeMuted);
  const [preferredMetronomeMuted, setPreferredMetronomeMuted] = useState(DEFAULT_PLAYER_PLAYBACK_PREFERENCES.metronomeMuted);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mainPanelView, setMainPanelView] = useState('library');
  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false);
  const [libraryScopeFolderId, setLibraryScopeFolderId] = useState(null);
  const [libraryCreateMenuOpen, setLibraryCreateMenuOpen] = useState(false);
  const [libraryContextMenu, setLibraryContextMenu] = useState(null);
  const [projectContextMenu, setProjectContextMenu] = useState(null);
  const [creditsDialog, setCreditsDialog] = useState(null);
  const [sliderDragTooltip, setSliderDragTooltip] = useState(null);
  const [sliderEditTooltip, setSliderEditTooltip] = useState(null);
  const [mixDialog, setMixDialog] = useState(null);
  const [playlistDragState, setPlaylistDragState] = useState(null);
  const [playlistReorderPendingId, setPlaylistReorderPendingId] = useState(null);
  const showNoAccessMessage = Boolean(session?.accessSummary?.showNoAccessMessage);
  const noAccessMessage = String(
    session?.accessSummary?.emptyAccessMessage
    || 'You do not currently have any permissions. Please contact an admin if you should.'
  );

  const activeQueueRef = useRef([]);
  const activeIndexRef = useRef(-1);
  const loopModeRef = useRef(loopMode);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  const realtimePlaybackRef = useRef({
    project: null,
    item: null,
    durationMs: 0,
  });
  const realtimeEndInFlightRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(5, volume));
  const playQueueItemRef = useRef(null);
  const preferredMetronomeMutedRef = useRef(DEFAULT_PLAYER_PLAYBACK_PREFERENCES.metronomeMuted);
  const hasHydratedPlayerPlaybackPreferencesRef = useRef(false);
  const profileMenuRef = useRef(null);
  const libraryCreateMenuRef = useRef(null);
  const libraryContextMenuRef = useRef(null);
  const projectContextMenuRef = useRef(null);
  const sliderDragRef = useRef(null);
  const {
    audioInputs,
    audioOutputs,
    audioSettings,
    outputChannelCount,
    playbackPanLawDb,
    refreshAudioDevices,
    setAudioSettings,
  } = usePlaybackDeviceSettings({
    errorPrefix: 'player-dashboard',
  });

  const monoOutputActive = audioSettings.forceMonoOutput === true || outputChannelCount <= 1;
  const showNoAccessBanner = (
    showNoAccessMessage
    && !loading
    && !error
    && folders.length === 0
    && myMixes.length === 0
    && playlists.length === 0
    && tuttiMixes.length === 0
    && globalMixes.length === 0
  );

  const applyPlaybackOutputConfig = useCallback(async () => {
    await audioManager.setPlaybackOutputConfig({
      outputDeviceId: audioSettings.outputDeviceId,
      outputChannelCount,
      forceMonoOutput: audioSettings.forceMonoOutput,
      panLawDb: playbackPanLawDb,
    });
  }, [
    audioSettings.forceMonoOutput,
    audioSettings.outputDeviceId,
    outputChannelCount,
    playbackPanLawDb,
  ]);

  const refreshPlayerData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const [myDevice, tutti, global] = await Promise.all([
        fetchPlayerMyDevice(session),
        fetchPlayerTuttiMixes(session),
        fetchPlayerGlobalMixes(session),
      ]);
      setFolders(myDevice.folders || []);
      setMyMixes(myDevice.mixes || []);
      setPlaylists(myDevice.playlists || []);
      setPlaylistItemsByPlaylistId(myDevice.playlistItemsByPlaylistId || {});
      setTuttiMixes(tutti || []);
      setGlobalMixes(global || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load player library');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refreshPlayerData();
  }, [refreshPlayerData]);

  useEffect(() => {
    if (!mixDialog) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && mixDialog.status !== 'saving') {
        setMixDialog(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mixDialog]);

  useEffect(() => {
    if (mainPanelView !== 'settings') return;
    refreshAudioDevices();
  }, [mainPanelView, refreshAudioDevices]);

  const getPracticeFocusStep = useCallback(
    (index) => PRACTICE_FOCUS_STEPS[Math.max(PRACTICE_FOCUS_MIN_INDEX, Math.min(PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0)))],
    []
  );

  const getPracticeFocusSliderPosition = useCallback(
    (index) => PRACTICE_FOCUS_SLIDER_POSITIONS[
      Math.max(PRACTICE_FOCUS_MIN_INDEX, Math.min(PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0)))
    ],
    []
  );

  const resolvePracticeFocusIndexFromSlider = useCallback((sliderValue) => {
    const numeric = Number(sliderValue);
    if (!Number.isFinite(numeric)) return PRACTICE_FOCUS_DEFAULT_INDEX;
    let nearestIndex = 0;
    let nearestDistance = Math.abs(numeric - PRACTICE_FOCUS_SLIDER_POSITIONS[0]);
    PRACTICE_FOCUS_SLIDER_POSITIONS.forEach((position, index) => {
      const distance = Math.abs(numeric - position);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    return nearestIndex;
  }, []);

  const resolvePracticeFocusDb = useCallback((index) => {
    const step = getPracticeFocusStep(index);
    return typeof step === 'number' ? step : 0;
  }, [getPracticeFocusStep]);

  const resolvePracticePlaybackMode = useCallback((presetId) => {
    const step = getPracticeFocusStep(practiceFocusControl);
    if (step === 'omitted') return PRACTICE_REALTIME_MODES.OMITTED;
    if (step === 'solo') return PRACTICE_REALTIME_MODES.SOLO;
    return isPracticeOmittedPresetId(presetId)
      ? PRACTICE_REALTIME_MODES.OMITTED
      : PRACTICE_REALTIME_MODES.NORMAL;
  }, [getPracticeFocusStep, practiceFocusControl]);

  const applyRealtimePracticeSettings = useCallback((snapshot, item) => {
    if (!snapshot || !item || !isPracticePresetId(item.presetId)) return false;
    const focusDb = resolvePracticeFocusDb(practiceFocusControl);
    const mixState = resolvePracticeRealtimeTrackMix(
      snapshot,
      item.presetId,
      item.presetVariantKey,
      {
        transformedPanRange: practicePanRange,
        practiceFocusDiffDb: focusDb,
      },
      resolvePracticePlaybackMode(item.presetId)
    );
    if (!mixState?.trackMixByTrackId) return false;
    Object.entries(mixState.trackMixByTrackId).forEach(([trackId, trackMix]) => {
      audioManager.updateTrackMix(trackId, trackMix.gain, trackMix.pan);
    });
    return true;
  }, [practiceFocusControl, practicePanRange, resolvePracticeFocusDb, resolvePracticePlaybackMode]);

  const applyRealtimeAdvancedMixSettings = useCallback((snapshot, item) => {
    if (!snapshot || !item || !isAdvancedMixPreset(item.presetId)) return false;
    const advancedState = normalizeAdvancedMixState(item.advancedMix || {});
    const mixState = resolveAdvancedMixRealtimeTrackMix(
      snapshot,
      advancedState.focus,
      {
        practicePanRange,
        practiceFocusControl,
      }
    );
    if (!mixState?.trackMixByTrackId) return false;
    Object.entries(mixState.trackMixByTrackId).forEach(([trackId, trackMix]) => {
      audioManager.updateTrackMix(trackId, trackMix.gain, trackMix.pan);
    });
    return true;
  }, [practiceFocusControl, practicePanRange]);

  const applyRealtimeGroupMixSettings = useCallback((snapshot, item, controlOverrides = null) => {
    if (!snapshot || !item || !isGroupMixPresetId(item.presetId)) return false;
    const editableSource = createEditableMixSource(snapshot, item);
    const mixState = resolveAdvancedMixRealtimeTrackMix(
      editableSource.snapshot || snapshot,
      editableSource.focus,
      {
        practicePanRange,
        practiceFocusControl,
        ...(controlOverrides || {}),
      }
    );
    if (!mixState?.trackMixByTrackId) return false;
    Object.entries(mixState.trackMixByTrackId).forEach(([trackId, trackMix]) => {
      audioManager.updateTrackMix(trackId, trackMix.gain, trackMix.pan);
    });
    return true;
  }, [practiceFocusControl, practicePanRange]);

  const applyRealtimeMixSettings = useCallback((snapshot, item, controlOverrides = null) => (
    applyRealtimePracticeSettings(snapshot, item)
      || applyRealtimeAdvancedMixSettings(snapshot, item)
      || applyRealtimeGroupMixSettings(snapshot, item, controlOverrides)
  ), [applyRealtimeAdvancedMixSettings, applyRealtimeGroupMixSettings, applyRealtimePracticeSettings]);

  const handlePlaybackEnded = useCallback(async () => {
    const queue = activeQueueRef.current || [];
    const currentIdx = activeIndexRef.current;
    const mode = loopModeRef.current;
    const shuffle = shuffleEnabledRef.current;
    if (!queue.length || currentIdx < 0) {
      setIsPlaying(false);
      return;
    }

    if (mode === PLAYER_LOOP_MODES.ONE) {
      if (typeof playQueueItemRef.current === 'function') {
        await playQueueItemRef.current(currentIdx);
      }
      return;
    }

    if (shuffle && queue.length > 1) {
      const randomIndex = pickRandomQueueIndex(currentIdx, queue.length);
      if (typeof playQueueItemRef.current === 'function') {
        await playQueueItemRef.current(randomIndex);
      }
      return;
    }

    let nextIndex = currentIdx + 1;
    if (nextIndex >= queue.length) {
      if (mode === PLAYER_LOOP_MODES.ALL) {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }

    if (typeof playQueueItemRef.current === 'function') {
      await playQueueItemRef.current(nextIndex);
    }
  }, []);

  useEffect(() => {
    return () => {
      audioManager.stop();
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
    };
  }, []);

  useEffect(() => {
    audioManager.setMasterVolumeCurve('unity');
    audioManager.setMasterHeadroomEnabled(false);
    return () => {
      audioManager.setMasterHeadroomEnabled(true);
      audioManager.setMasterVolumeCurve('legacy');
    };
  }, []);

  useEffect(() => {
    void applyPlaybackOutputConfig();
  }, [applyPlaybackOutputConfig]);

  useEffect(() => {
    audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
  }, [volume]);

  useEffect(() => {
    preferredMetronomeMutedRef.current = preferredMetronomeMuted;
  }, [preferredMetronomeMuted]);

  useEffect(() => {
    const saved = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!saved) {
      hasHydratedPlayerPlaybackPreferencesRef.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      const normalized = normalizePlayerPlaybackPreferences(parsed);
      setPracticePanRange(normalized.practicePanRange);
      setPracticeFocusControl(normalized.practiceFocusControl);
      setPreferredMetronomeMuted(normalized.metronomeMuted);
      setIsRealtimeMetronomeMuted(normalized.metronomeMuted);
    } catch (error) {
      reportUserError(
        'Failed to read player playback preferences from local storage. Defaults will be used.',
        error,
        { onceKey: 'player-dashboard:playback-preferences-parse' }
      );
    } finally {
      hasHydratedPlayerPlaybackPreferencesRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasHydratedPlayerPlaybackPreferencesRef.current) return;

    let existing = {};
    try {
      existing = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) || '{}');
    } catch (error) {
      reportUserError(
        'Failed to parse existing player playback preferences from local storage. They will be replaced.',
        error,
        { onceKey: 'player-dashboard:playback-preferences-merge-parse' }
      );
      existing = {};
    }

    const normalized = normalizePlayerPlaybackPreferences({
      playerPracticePanRange: practicePanRange,
      playerPracticeFocusControl: practiceFocusControl,
      playerMetronomeMuted: preferredMetronomeMuted,
    });

    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({
      ...existing,
      playerPracticePanRange: normalized.practicePanRange,
      playerPracticeFocusControl: normalized.practiceFocusControl,
      playerMetronomeMuted: normalized.metronomeMuted,
    }));
  }, [practiceFocusControl, practicePanRange, preferredMetronomeMuted]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!libraryCreateMenuRef.current?.contains(event.target)) {
        setLibraryCreateMenuOpen(false);
      }
      if (!libraryContextMenuRef.current?.contains(event.target)) {
        setLibraryContextMenu(null);
      }
      if (!projectContextMenuRef.current?.contains(event.target)) {
        setProjectContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = Math.max(5, Number(volume) || 5);
    }
  }, [volume]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!sliderDragRef.current) return;
      const {
        startX,
        startValue,
        width,
        moved,
        min,
        max,
        step,
        kind,
      } = sliderDragRef.current;
      const deltaX = event.clientX - startX;
      if (!moved) {
        if (Math.abs(deltaX) < 2) return;
        sliderDragRef.current.moved = true;
        setSliderEditTooltip(null);
      }
      let next = startValue + (deltaX / Math.max(1, width)) * (max - min);
      next = Math.max(min, Math.min(max, next));
      if (step >= 1) {
        next = Math.round(next);
      }
      if (Math.abs(next - sliderDragRef.current.lastValue) < 1e-6) {
        if (kind === 'focus') {
          setSliderDragTooltip({ kind, value: resolvePracticeFocusIndexFromSlider(next) });
        } else {
          setSliderDragTooltip({ kind, value: next });
        }
        return;
      }
      sliderDragRef.current.lastValue = next;
      if (kind === 'master') {
        setVolume(next);
      } else if (kind === 'focus') {
        const nextFocusIndex = resolvePracticeFocusIndexFromSlider(next);
        setPracticeFocusControl(nextFocusIndex);
        setSliderDragTooltip({ kind, value: nextFocusIndex });
        return;
      } else if (kind === 'pan') {
        setPracticePanRange(next);
      }
      setSliderDragTooltip({ kind, value: next });
    };

    const handleUp = () => {
      sliderDragRef.current = null;
      setSliderDragTooltip(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resolvePracticeFocusIndexFromSlider]);

  const myDeviceMixesInFolder = useMemo(() => (
    myMixes.filter((mix) => {
      const folderId = mix.folderId || null;
      return folderId === selectedFolderId;
    })
  ), [myMixes, selectedFolderId]);

  const selectedPlaylistItems = useMemo(() => {
    if (!selectedPlaylistId) return [];
    return playlistItemsByPlaylistId[selectedPlaylistId] || [];
  }, [playlistItemsByPlaylistId, selectedPlaylistId]);

  const myDeviceQueue = useMemo(() => (
    myDeviceMixesInFolder
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES,
        selectedFolderId || 'root'
      ))
      .filter(Boolean)
  ), [myDeviceMixesInFolder, selectedFolderId]);

  const playlistQueue = useMemo(() => (
    selectedPlaylistItems
      .filter((item) => !item.unavailable && item.mix)
      .map((item) => {
        const queueItem = createQueueItemFromMix(
          item.mix,
          PLAYER_COLLECTION_TYPES.PLAYLIST,
          selectedPlaylistId
        );
        return queueItem
          ? { ...queueItem, playlistItemId: String(item.id) }
          : null;
      })
      .filter(Boolean)
  ), [selectedPlaylistItems, selectedPlaylistId]);

  const tuttiShows = useMemo(() => {
    const groups = new Map();
    (tuttiMixes || []).forEach((mix) => {
      const showId = String(mix.showId || 'unknown-show');
      if (!groups.has(showId)) {
        groups.set(showId, {
          id: showId,
          name: mix.showName || 'Unknown show',
          orderIndex: Number(mix.showOrderIndex || 0),
          mixes: [],
        });
      }
      groups.get(showId).mixes.push(mix);
    });
    return Array.from(groups.values())
      .map((show) => ({
        ...show,
        mixes: show.mixes.slice().sort((left, right) => (
          String(left.musicalNumber || '').localeCompare(String(right.musicalNumber || ''), undefined, { numeric: true, sensitivity: 'base' })
        )),
      }))
      .sort((left, right) => (
        left.orderIndex - right.orderIndex
        || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      ));
  }, [tuttiMixes]);

  const activeTuttiShowId = activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
    && String(activeCollectionId || '').startsWith('show:')
    ? String(activeCollectionId).slice('show:'.length)
    : (tuttiShows[0]?.id || '');
  const activeTuttiShow = tuttiShows.find((show) => show.id === activeTuttiShowId) || tuttiShows[0] || null;
  const activeTuttiMixes = activeTuttiShow?.mixes || [];

  const tuttiQueue = useMemo(() => (
    (activeTuttiMixes || [])
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.TUTTI,
        activeTuttiShow ? `show:${activeTuttiShow.id}` : 'tutti'
      ))
      .filter(Boolean)
  ), [activeTuttiMixes, activeTuttiShow]);

  const globalQueue = useMemo(() => (
    (globalMixes || [])
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.GLOBAL,
        'global'
      ))
      .filter(Boolean)
  ), [globalMixes]);

  const activeQueueItems = useMemo(() => {
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES) return myDeviceQueue;
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST) return playlistQueue;
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.GLOBAL) return globalQueue;
    return tuttiQueue;
  }, [activeCollectionType, myDeviceQueue, playlistQueue, globalQueue, tuttiQueue]);

  useEffect(() => {
    activeQueueRef.current = activeQueueItems;
  }, [activeQueueItems]);

  useEffect(() => {
    if (
      activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
      && activeCollectionId === 'tutti'
      && tuttiShows[0]?.id
    ) {
      setActiveCollectionId(`show:${tuttiShows[0].id}`);
      setActiveIndex(-1);
    }
  }, [activeCollectionId, activeCollectionType, tuttiShows]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
  }, [shuffleEnabled]);

  useEffect(() => {
    if (!activeQueueItems.length) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex >= activeQueueItems.length) {
      setActiveIndex(-1);
    }
  }, [activeQueueItems, activeIndex]);

  const ensureSnapshotAudioBuffers = useCallback(async (snapshot) => {
    const blobIds = new Set();
    (snapshot?.tracks || []).forEach((track) => {
      (track?.clips || []).forEach((clip) => {
        if (clip?.blobId) blobIds.add(clip.blobId);
      });
    });

    const audioBuffers = new Map();
    for (const blobId of blobIds) {
      if (!audioManager.mediaCache.has(blobId)) {
        let media = null;
        try {
          media = await getMediaBlob(blobId);
        } catch {
          const remoteBlob = await downloadMediaBlob(blobId, session, {
            projectId: snapshot?.projectId || realtimePlaybackRef.current?.item?.projectId || null,
          });
          const cachedRemoteMedia = await cacheRemoteBlobAsLocalWav({
            blobId,
            remoteBlob,
            decodeAudioFile: audioManager.decodeAudioFile.bind(audioManager),
            storeMediaBlob,
            fileName: `${blobId}.wav`,
          });
          audioManager.mediaCache.set(blobId, cachedRemoteMedia.audioBuffer);
          media = cachedRemoteMedia.storedLocally
            ? await getMediaBlob(blobId)
            : createEphemeralMediaEntry(
              blobId,
              cachedRemoteMedia.localCacheFileName,
              cachedRemoteMedia.audioBuffer,
              cachedRemoteMedia.fallbackBlob
            );
        }
        await audioManager.loadAudioBuffer(blobId, media.blob);
      }
      const cached = audioManager.mediaCache.get(blobId);
      if (cached) {
        audioBuffers.set(blobId, cached);
      }
    }
    return audioBuffers;
  }, [session]);

  const playMixItem = useCallback(async (item, indexForState = null) => {
    if (!session) return;
    if (!item?.projectId || !item?.presetId) return;

    setIsRendering(true);
    setError('');
    try {
      const payload = await bootstrapServerProject(item.projectId, session, 0, { purpose: 'player' });
      const snapshot = payload?.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Project snapshot missing');
      }
      audioManager.stop();
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
      realtimeEndInFlightRef.current = false;

      setCurrentTimeSec(0);
      setDurationSec(Math.max(0, Number(item.durationMs || 0) / 1000));
      if (typeof indexForState === 'number' && indexForState >= 0) {
        setActiveIndex(indexForState);
      }
      setNowPlayingLabel(item.name || item.projectName || 'Mix');

      const mixSnapshot = buildAdvancedPlaybackSnapshot(snapshot, item);
      const snapshotHasMetronome = hasSnapshotMetronome(mixSnapshot);
      const metronomeMuted = snapshotHasMetronome ? preferredMetronomeMutedRef.current : false;
      const playbackSnapshot = withSnapshotMetronomeMuted(mixSnapshot, metronomeMuted);
      const durationMs = computeSnapshotDurationMs(playbackSnapshot);
      setDurationSec(Math.max(0, durationMs / 1000));
      await ensureSnapshotAudioBuffers(playbackSnapshot);
      setHasRealtimeMetronome(snapshotHasMetronome);
      setIsRealtimeMetronomeMuted(snapshotHasMetronome ? metronomeMuted : false);

      const realtimeControlOverrides = isGroupMixPresetId(item.presetId)
        ? createEditableMixSource(playbackSnapshot, item).controls
        : null;
      if (Number.isFinite(realtimeControlOverrides?.practiceFocusControl)) {
        setPracticeFocusControl(realtimeControlOverrides.practiceFocusControl);
      }

      await applyPlaybackOutputConfig();
      audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
      await audioManager.play(playbackSnapshot, 0, { useProjectMasterVolume: false });
      applyRealtimeMixSettings(playbackSnapshot, item, realtimeControlOverrides);
      if (snapshotHasMetronome) {
        applyLiveMetronomeMix(playbackSnapshot);
      }
      realtimePlaybackRef.current = {
        project: playbackSnapshot,
        item,
        durationMs,
      };
      setIsPlaying(true);
    } catch (playError) {
      audioManager.stop();
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
      setHasRealtimeMetronome(false);
      setIsRealtimeMetronomeMuted(false);
      setIsPlaying(false);
      setError(playError.message || 'Playback failed');
    } finally {
      setIsRendering(false);
    }
  }, [applyPlaybackOutputConfig, applyRealtimeMixSettings, ensureSnapshotAudioBuffers, session, volume]);

  const playQueueItem = useCallback(async (index) => {
    if (index < 0 || index >= activeQueueItems.length) return;
    const item = activeQueueItems[index];
    await playMixItem(item, index);
  }, [activeQueueItems, playMixItem]);

  useEffect(() => {
    playQueueItemRef.current = playQueueItem;
  }, [playQueueItem]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const interval = setInterval(() => {
      const currentMs = Math.max(0, Number(audioManager.getCurrentTime() || 0));
      setCurrentTimeSec(currentMs / 1000);

      const durationMs = Number(realtimePlaybackRef.current?.durationMs || 0);
      if (durationMs <= 0 || currentMs < durationMs) {
        return;
      }
      if (realtimeEndInFlightRef.current) {
        return;
      }
      realtimeEndInFlightRef.current = true;
      audioManager.stop();
      setCurrentTimeSec(durationMs / 1000);
      setIsPlaying(false);
      void handlePlaybackEnded().finally(() => {
        realtimeEndInFlightRef.current = false;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [handlePlaybackEnded, isPlaying]);

  useEffect(() => {
    const current = realtimePlaybackRef.current;
    if (!current?.project || !current?.item) return;
    try {
      applyRealtimeMixSettings(current.project, current.item);
    } catch (applyError) {
      setError(applyError.message || 'Failed to apply practice mix settings');
    }
  }, [applyRealtimeMixSettings]);

  const handleSelectCollection = useCallback((type, id = null) => {
    setMainPanelView('library');
    setActiveCollectionType(type);
    setActiveCollectionId(id || type);
  }, []);

  const handleSelectItem = useCallback((type, collectionId, index) => {
    setMainPanelView('library');
    setActiveCollectionType(type);
    setActiveCollectionId(collectionId || type);
    setActiveIndex(index);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      const currentMs = Math.max(0, Math.round((Number(currentTimeSec) || 0) * 1000));
      await audioManager.pause(currentMs);
      setIsPlaying(false);
      return;
    }

    if (!activeQueueItems.length) return;

    if (
      realtimePlaybackRef.current?.project
      && realtimePlaybackRef.current?.item
      && currentTimeSec < Math.max(0, durationSec - 0.01)
    ) {
      const resumeMs = Math.max(0, Math.round((Number(currentTimeSec) || 0) * 1000));
      const current = realtimePlaybackRef.current;
      await applyPlaybackOutputConfig();
      audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
      await audioManager.play(current.project, resumeMs, { useProjectMasterVolume: false });
      applyRealtimeMixSettings(current.project, current.item);
      setIsPlaying(true);
      return;
    }

    const startIndex = activeIndex >= 0 ? activeIndex : 0;
    await playQueueItem(startIndex);
  }, [activeIndex, activeQueueItems.length, applyPlaybackOutputConfig, applyRealtimeMixSettings, currentTimeSec, durationSec, isPlaying, playQueueItem, volume]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code !== 'Space') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntryTarget(event)) return;
      event.preventDefault();
      if (event.repeat || isRendering) return;

      const action = resolvePlayerSpaceAction({
        isPlaying,
        canResumeCurrent: canResumePlayerPlayback({
          currentTimeSec,
          durationSec,
          hasRealtimeItem: Boolean(
            realtimePlaybackRef.current?.project && realtimePlaybackRef.current?.item
          ),
        }),
        highlightedIndex: activeIndex,
      });

      if (action === 'toggle-current') {
        void handleTogglePlay();
        return;
      }
      if (action === 'play-highlighted' && activeIndex >= 0) {
        void playQueueItem(activeIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeIndex,
    currentTimeSec,
    durationSec,
    handleTogglePlay,
    isPlaying,
    isRendering,
    playQueueItem,
  ]);

  const handleNext = useCallback(async () => {
    if (!activeQueueItems.length) return;
    if (shuffleEnabled && activeQueueItems.length > 1) {
      const randomIndex = pickRandomQueueIndex(activeIndex, activeQueueItems.length);
      await playQueueItem(randomIndex);
      return;
    }
    let nextIndex = activeIndex + 1;
    if (nextIndex >= activeQueueItems.length) {
      if (loopMode === PLAYER_LOOP_MODES.ALL) {
        nextIndex = 0;
      } else {
        return;
      }
    }
    await playQueueItem(nextIndex);
  }, [activeIndex, activeQueueItems.length, loopMode, playQueueItem, shuffleEnabled]);

  const handlePrevious = useCallback(async () => {
    if (!activeQueueItems.length) return;
    if (currentTimeSec > 3 && realtimePlaybackRef.current?.project && realtimePlaybackRef.current?.item) {
      const current = realtimePlaybackRef.current;
      if (isPlaying) {
        await audioManager.pause(0);
        await applyPlaybackOutputConfig();
        audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
        await audioManager.play(current.project, 0, { useProjectMasterVolume: false });
        applyRealtimeMixSettings(current.project, current.item);
        setIsPlaying(true);
      } else {
        await audioManager.pause(0);
      }
      setCurrentTimeSec(0);
      return;
    }
    let previousIndex = activeIndex - 1;
    if (previousIndex < 0) {
      previousIndex = loopMode === PLAYER_LOOP_MODES.ALL
        ? activeQueueItems.length - 1
        : 0;
    }
    await playQueueItem(previousIndex);
  }, [activeIndex, activeQueueItems.length, applyPlaybackOutputConfig, applyRealtimeMixSettings, currentTimeSec, isPlaying, loopMode, playQueueItem, volume]);

  const handleSeek = useCallback(async (nextTimeSec) => {
    const safe = Math.max(0, Math.min(Number(nextTimeSec || 0), Number(durationSec || 0)));
    if (!realtimePlaybackRef.current?.project || !realtimePlaybackRef.current?.item) {
      setCurrentTimeSec(safe);
      return;
    }
    try {
      const seekMs = Math.max(0, Math.round(safe * 1000));
      const current = realtimePlaybackRef.current;
      if (isPlaying) {
        await audioManager.pause(seekMs);
        await applyPlaybackOutputConfig();
        audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
        await audioManager.play(current.project, seekMs, { useProjectMasterVolume: false });
        applyRealtimeMixSettings(current.project, current.item);
        setIsPlaying(true);
      } else {
        await audioManager.pause(seekMs);
      }
    } catch (seekError) {
      setError(seekError.message || 'Seek failed');
    }
    setCurrentTimeSec(safe);
  }, [applyPlaybackOutputConfig, applyRealtimeMixSettings, durationSec, isPlaying, volume]);

  const handleToggleMute = useCallback(() => {
    setVolume((previous) => {
      const numeric = Number(previous) || 0;
      if (numeric <= 0) {
        return Math.max(5, Number(lastNonZeroVolumeRef.current) || 5);
      }
      lastNonZeroVolumeRef.current = Math.max(5, numeric);
      return 0;
    });
  }, []);

  const handleToggleMetronomeMute = useCallback(() => {
    const current = realtimePlaybackRef.current;
    if (!current?.project || !current?.item || !hasSnapshotMetronome(current.project)) return;

    const nextMuted = !isRealtimeMetronomeMuted;
    const nextProject = withSnapshotMetronomeMuted(current.project, nextMuted);
    realtimePlaybackRef.current = {
      ...current,
      project: nextProject,
    };
    setPreferredMetronomeMuted(nextMuted);
    setIsRealtimeMetronomeMuted(nextMuted);

    applyRealtimeMixSettings(nextProject, current.item);
    applyLiveMetronomeMix(nextProject);
  }, [applyRealtimeMixSettings, isRealtimeMetronomeMuted]);

  const beginSliderDrag = useCallback((event, config) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const {
      kind,
      value,
      min,
      max,
      step,
      disabled,
    } = config;
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    sliderDragRef.current = {
      startX: event.clientX,
      startValue: Number(value),
      lastValue: Number(value),
      width: rect.width,
      moved: false,
      min: Number(min),
      max: Number(max),
      step: Number(step || 1),
      kind,
    };
    if (kind === 'focus') {
      setSliderDragTooltip({ kind, value: resolvePracticeFocusIndexFromSlider(Number(value)) });
    } else {
      setSliderDragTooltip({ kind, value: Number(value) });
    }
    setSliderEditTooltip(null);
  }, [resolvePracticeFocusIndexFromSlider]);

  const formatSliderValue = useCallback((kind, value) => {
    if (kind === 'master') {
      return `${Math.round(Math.max(0, Math.min(100, value)))}`;
    }
    if (kind === 'focus') {
      const step = getPracticeFocusStep(value);
      if (step === 'omitted') return 'Omitted';
      if (step === 'solo') return 'Solo';
      return `${step > 0 ? '+' : ''}${step}`;
    }
    return `${Math.round(value)}`;
  }, [getPracticeFocusStep]);

  const parseSliderInput = useCallback((kind, rawText) => {
    const text = String(rawText || '').trim();
    if (kind === 'master') {
      if (!text) return null;
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    if (!text) return null;
    if (kind === 'focus') {
      const normalized = text.toLowerCase();
      if (normalized === 'omitted') return PRACTICE_FOCUS_MIN_INDEX;
      if (normalized === 'solo') return PRACTICE_FOCUS_MAX_INDEX;
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) return null;
      let nearest = PRACTICE_FOCUS_NUMERIC_STEPS[0];
      let nearestDistance = Math.abs(parsed - nearest);
      PRACTICE_FOCUS_NUMERIC_STEPS.forEach((candidate) => {
        const distance = Math.abs(parsed - candidate);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return PRACTICE_FOCUS_STEPS.findIndex((step) => step === nearest);
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(200, Math.round(parsed)));
  }, []);

  const openSliderEdit = useCallback((kind, value, disabled) => {
    if (disabled) return;
    setSliderEditTooltip({
      kind,
      text: formatSliderValue(kind, value),
    });
  }, [formatSliderValue]);

  const commitSliderEdit = useCallback(() => {
    if (!sliderEditTooltip) return;
    const nextValue = parseSliderInput(sliderEditTooltip.kind, sliderEditTooltip.text);
    if (nextValue !== null) {
      if (sliderEditTooltip.kind === 'master') setVolume(nextValue);
      if (sliderEditTooltip.kind === 'focus') setPracticeFocusControl(nextValue);
      if (sliderEditTooltip.kind === 'pan') setPracticePanRange(nextValue);
    }
    setSliderEditTooltip(null);
  }, [parseSliderInput, sliderEditTooltip]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
      await createPlayerFolder({ name: normalized, parentFolderId: libraryScopeFolderId || null }, session);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create folder');
    }
  }, [libraryScopeFolderId, refreshPlayerData, session]);

  const handleRenameFolder = useCallback(async (folder) => {
    const name = window.prompt('Rename folder', folder?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === folder?.name) return;
    try {
      await updatePlayerFolder(folder.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename folder');
    }
  }, [refreshPlayerData, session]);

  const handleDeleteFolder = useCallback(async (folder) => {
    if (!window.confirm(`Delete folder "${folder?.name}"? Folder must be empty.`)) return;
    try {
      await deletePlayerFolder(folder.id, session);
      if (selectedFolderId === folder.id) {
        setSelectedFolderId(null);
      }
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete folder');
    }
  }, [refreshPlayerData, selectedFolderId, session]);

  const handleCreatePlaylist = useCallback(async () => {
    const name = window.prompt('Playlist name');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
      const playlist = await createPlayerPlaylist({ name: normalized, folderId: libraryScopeFolderId || null }, session);
      setSelectedPlaylistId(playlist?.id || null);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create playlist');
    }
  }, [libraryScopeFolderId, refreshPlayerData, session]);

  const handleRenamePlaylist = useCallback(async (playlist) => {
    const name = window.prompt('Rename playlist', playlist?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === playlist?.name) return;
    try {
      await updatePlayerPlaylist(playlist.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename playlist');
    }
  }, [refreshPlayerData, session]);

  const handleDeletePlaylist = useCallback(async (playlist) => {
    if (!window.confirm(`Delete playlist "${playlist?.name}"?`)) return;
    try {
      await deletePlayerPlaylist(playlist.id, session);
      if (selectedPlaylistId === playlist.id) {
        setSelectedPlaylistId(null);
      }
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete playlist');
    }
  }, [refreshPlayerData, selectedPlaylistId, session]);

  const groupMixOptions = useMemo(() => (
    mixDialog?.snapshot ? buildGroupMixOptions(mixDialog.snapshot) : []
  ), [mixDialog]);

  const partMixSections = useMemo(() => (
    mixDialog?.snapshot ? buildPartMixSections(mixDialog.snapshot) : []
  ), [mixDialog]);

  const mixTypeOptions = useMemo(() => (
    mixDialog?.snapshot ? buildMixCategoryOptions(mixDialog.snapshot) : []
  ), [mixDialog]);

  const mixPlacementOptions = useMemo(() => ([
    { value: '__root__', label: 'My Library' },
    ...playlists.map((playlist) => ({ value: `playlist:${playlist.id}`, label: playlist.name })),
  ]), [playlists]);

  const mixDialogStep = useMemo(() => {
    if (!mixDialog) return null;
    if (mixDialog.status === 'loading') return 'loading';
    if (mixDialog.status === 'saving') return 'saving';
    if (!mixDialog.mixTypeId) return 'type';
    if (mixDialog.mixTypeId === 'group' && !mixDialog.presetId) return 'group';
    if (mixDialog.mixTypeId === 'part' && !mixDialog.presetId) return 'part';
    return 'details';
  }, [mixDialog]);

  const promptCreateMixFromProject = useCallback(async (projectLike) => {
    const projectId = String(projectLike?.projectId || projectLike?.id || '').trim();
    if (!projectId) return;
    if (projectLike?.canCreateMixes === false) {
      throw new Error('You cannot create mixes from this project');
    }
    setMixDialog({
        status: 'loading',
        projectId,
        projectLike,
        snapshot: null,
        mixTypeId: null,
        groupIds: [],
        presetId: null,
        presetVariantKey: null,
        mixLabel: '',
        placement: '__root__',
        name: '',
    });
    try {
      const payload = await bootstrapServerProject(projectId, session, 0, { purpose: 'player' });
      const snapshot = payload?.snapshot || {};
      const availableMixTypes = buildMixCategoryOptions(snapshot);
      if (!availableMixTypes.length) {
        throw new Error('No mix options are available for this project.');
      }
      setMixDialog({
        status: 'ready',
        projectId,
        projectLike,
        snapshot,
        mixTypeId: null,
        groupIds: [],
        presetId: null,
        presetVariantKey: null,
        mixLabel: '',
        placement: '__root__',
        name: '',
      });
    } catch (mixError) {
      setMixDialog(null);
      throw mixError;
    }
  }, [session]);

  const handleSelectMixType = useCallback((mixTypeId) => {
    setMixDialog((previous) => {
      if (!previous || previous.status !== 'ready') return previous;
      if (mixTypeId === 'tutti') {
        const mixLabel = 'Tutti';
        return {
          ...previous,
          mixTypeId,
          groupIds: [],
          presetId: EXPORT_PRESETS.TUTTI,
          presetVariantKey: null,
          mixLabel,
          name: buildDefaultMixName(previous.projectLike, mixLabel),
        };
      }
      return {
        ...previous,
        mixTypeId,
        groupIds: [],
        presetId: null,
        presetVariantKey: null,
        mixLabel: '',
        name: '',
      };
    });
  }, []);

  const handleCreateAdvancedMixFromDialog = useCallback(async () => {
    if (!mixDialog || mixDialog.status !== 'ready') return;
    const name = buildDefaultMixName(mixDialog.projectLike, 'Advanced Mix');
    setError('');
    setMixDialog((previous) => (previous ? { ...previous, status: 'saving' } : previous));
    try {
      const createdMix = await createVirtualMix({
        projectId: mixDialog.projectId,
        name,
        presetId: ADVANCED_MIX_PRESET_ID,
        presetVariantKey: null,
        advancedMix: {},
        folderId: null,
      }, session);
      setMixDialog(null);
      await refreshPlayerData();
      if (typeof onOpenAdvancedMix === 'function') {
        await onOpenAdvancedMix(createdMix);
      }
    } catch (createError) {
      setError(createError.message || 'Failed to create advanced mix');
      setMixDialog((previous) => (previous ? { ...previous, status: 'ready' } : previous));
    }
  }, [mixDialog, onOpenAdvancedMix, refreshPlayerData, session]);

  const handleToggleMixGroup = useCallback((groupId) => {
    setMixDialog((previous) => {
      if (!previous || previous.status !== 'ready') return previous;
      const maxSelection = groupMixOptions.length === 3 ? 2 : 1;
      const currentSelection = Array.isArray(previous.groupIds) ? previous.groupIds : [];
      const isSelected = currentSelection.includes(groupId);
      let nextGroupIds = currentSelection;
      if (isSelected) {
        nextGroupIds = currentSelection.filter((candidate) => candidate !== groupId);
      } else if (currentSelection.length < maxSelection) {
        nextGroupIds = [...currentSelection, groupId];
      } else {
        nextGroupIds = [groupId];
      }
      return {
        ...previous,
        groupIds: nextGroupIds,
        presetId: null,
        presetVariantKey: null,
        mixLabel: '',
        name: '',
      };
    });
  }, [groupMixOptions.length]);

  const handleConfirmGroupSelection = useCallback(() => {
    setMixDialog((previous) => {
      if (!previous || previous.status !== 'ready') return previous;
      const resolved = resolveGroupMixSelection(groupMixOptions, previous.groupIds);
      if (!resolved) return previous;
      return {
        ...previous,
        presetId: resolved.presetId,
        presetVariantKey: null,
        mixLabel: resolved.mixLabel,
        name: buildDefaultMixName(previous.projectLike, resolved.mixLabel),
      };
    });
  }, [groupMixOptions]);

  const handleSelectPartPreset = useCallback((partOption) => {
    if (!partOption) return;
    setMixDialog((previous) => {
      if (!previous || previous.status !== 'ready') return previous;
      return {
        ...previous,
        presetId: partOption.presetId,
        presetVariantKey: partOption.presetVariantKey,
        mixLabel: partOption.label,
        name: buildDefaultMixName(previous.projectLike, partOption.label),
      };
    });
  }, []);

  const handleMixDialogBack = useCallback(() => {
    setMixDialog((previous) => {
      if (!previous || previous.status !== 'ready') return previous;
      if (previous.mixTypeId === 'group' && previous.presetId) {
        return {
          ...previous,
          presetId: null,
          presetVariantKey: null,
          mixLabel: '',
          name: '',
        };
      }
      if (previous.mixTypeId === 'part' && previous.presetId) {
        return {
          ...previous,
          presetId: null,
          presetVariantKey: null,
          mixLabel: '',
          name: '',
        };
      }
      return {
        ...previous,
        mixTypeId: null,
        groupIds: [],
        presetId: null,
        presetVariantKey: null,
        mixLabel: '',
        name: '',
      };
    });
  }, []);

  const handleCreateMixFromDialog = useCallback(async () => {
    if (!mixDialog || mixDialog.status !== 'ready' || !mixDialog.presetId) return;
    const normalizedMixName = String(mixDialog.name || '').trim();
    if (!normalizedMixName) {
      setError('Mix name is required.');
      return;
    }
    setError('');
    setMixDialog((previous) => (previous ? { ...previous, status: 'saving' } : previous));
    try {
      const createdMix = await createVirtualMix({
        projectId: mixDialog.projectId,
        name: normalizedMixName,
        presetId: mixDialog.presetId,
        presetVariantKey: mixDialog.presetVariantKey,
        folderId: null,
      }, session);
      if (String(mixDialog.placement).startsWith('playlist:')) {
        const playlistId = String(mixDialog.placement).slice('playlist:'.length);
        if (playlistId) {
          await addPlayerPlaylistItem(playlistId, createdMix.id, session);
        }
      }
      setMixDialog(null);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create mix');
      setMixDialog((previous) => (previous ? { ...previous, status: 'ready' } : previous));
    }
  }, [mixDialog, refreshPlayerData, session]);

  const handleDeleteMix = useCallback(async (mix) => {
    if (!window.confirm(`Delete mix "${mix?.name}"?`)) return;
    try {
      await deleteVirtualMix(mix.id, session);
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete mix');
    }
  }, [refreshPlayerData, session]);

  const handleRenameMix = useCallback(async (mix) => {
    const name = window.prompt('Rename mix', mix?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === mix?.name) return;
    try {
      await updateVirtualMix(mix.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename mix');
    }
  }, [refreshPlayerData, session]);

  const activeQueueItem = activeQueueItems[activeIndex] || null;
  const defaultTuttiCollectionId = tuttiShows[0]?.id ? `show:${tuttiShows[0].id}` : 'tutti';
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const currentLibraryFolder = folders.find((folder) => folder.id === libraryScopeFolderId) || null;
  const libraryVisibleItems = useMemo(() => {
    if (libraryScopeFolderId) {
      const scopedFolders = folders
        .filter((folder) => (folder.parentFolderId || null) === libraryScopeFolderId)
        .map((folder) => ({
          id: `folder:${folder.id}`,
          kind: 'folder',
          name: folder.name,
          folder,
        }));
      const scopedPlaylists = playlists
        .filter((playlist) => (playlist.folderId || null) === libraryScopeFolderId)
        .map((playlist) => ({
          id: `playlist:${playlist.id}`,
          kind: 'playlist',
          name: playlist.name,
          playlist,
        }));
      return [...scopedFolders, ...scopedPlaylists];
    }
    const playlistMixIds = new Set(
      Object.values(playlistItemsByPlaylistId || {})
        .flat()
        .map((item) => item?.mixId)
        .filter(Boolean)
        .map((mixId) => String(mixId))
    );
    const rootMixes = myMixes
      .filter((mix) => (mix.folderId || null) === null)
      .filter((mix) => !playlistMixIds.has(String(mix.id)))
      .map((mix) => ({
        id: `mix:${mix.id}`,
        kind: 'mix',
        name: mix.name || mix.projectName || 'Untitled mix',
        mix,
      }));
    const foldersFlat = folders.map((folder) => ({
      id: `folder:${folder.id}`,
      kind: 'folder',
      name: folder.name,
      folder,
    }));
    const playlistsFlat = playlists
      .filter((playlist) => (playlist.folderId || null) === null)
      .map((playlist) => ({
      id: `playlist:${playlist.id}`,
      kind: 'playlist',
      name: playlist.name,
      playlist,
    }));
    return [...foldersFlat, ...playlistsFlat, ...rootMixes];
  }, [folders, libraryScopeFolderId, myMixes, playlistItemsByPlaylistId, playlists]);
  const loopLabel = loopMode === PLAYER_LOOP_MODES.OFF
    ? 'Loop off'
    : (loopMode === PLAYER_LOOP_MODES.ALL ? 'Loop all' : 'Loop one');
  const LoopIcon = loopMode === PLAYER_LOOP_MODES.ONE ? Repeat1 : Repeat;
  const loopButtonClass = loopMode === PLAYER_LOOP_MODES.OFF
    ? 'text-gray-400'
    : 'text-blue-300';
  const shuffleButtonClass = shuffleEnabled ? 'text-blue-300' : 'text-gray-400';
  const metronomeButtonClass = isRealtimeMetronomeMuted ? 'text-gray-400' : 'text-blue-300';
  const isMuted = volume <= 0;
  const VolumeIcon = isMuted ? VolumeX : Volume2;
  const practiceControlItem = realtimePlaybackRef.current?.item;
  const practiceControlsEnabled = isPracticePresetId(practiceControlItem?.presetId)
    || isAdvancedMixPreset(practiceControlItem?.presetId)
    || isGroupMixPresetId(practiceControlItem?.presetId);
  const metronomeControlsEnabled = hasRealtimeMetronome;
  const focusControlDisabled = !practiceControlsEnabled || isRendering;
  const focusStep = getPracticeFocusStep(practiceFocusControl);
  const focusSliderPosition = getPracticeFocusSliderPosition(practiceFocusControl);
  const panControlDisabled = !practiceControlsEnabled
    || isRendering
    || focusStep === 'omitted'
    || focusStep === 'solo';
  const visualPanRangeValue = sliderDragTooltip?.kind === 'pan'
    ? Math.max(0, Math.min(200, Number(sliderDragTooltip.value) || 0))
    : Math.max(0, Math.min(200, Number(practicePanRange) || 0));
  const practicePanRangePercent = (visualPanRangeValue / 200) * 100;
  const practicePanFocusAxisValue = 200 - (visualPanRangeValue / 2);
  const practicePanFocusAxisPercent = (practicePanFocusAxisValue / 200) * 100;
  const practicePanKnobPixel = Math.max(
    0,
    Math.min(PAN_INNER_TRACK_WIDTH_PX, Math.round((practicePanRangePercent / 100) * PAN_INNER_TRACK_WIDTH_PX))
  );
  const practicePanFocusAxisPixel = Math.max(
    0,
    Math.min(PAN_INNER_TRACK_WIDTH_PX, Math.round((practicePanFocusAxisPercent / 100) * PAN_INNER_TRACK_WIDTH_PX))
  );
  const PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT = 8.125;
  const PAN_HIGHLIGHT_INNER_SPAN_PERCENT = 100 - (2 * PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT);
  const practicePanHighlightPercent = Math.max(
    0,
    Math.min(
      100,
      PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT
        + (practicePanRangePercent * (PAN_HIGHLIGHT_INNER_SPAN_PERCENT / 100))
    )
  );
  const practicePanHighlightPixel = Math.max(
    0,
    Math.min(PAN_TRACK_WIDTH_PX, Math.round((practicePanHighlightPercent / 100) * PAN_TRACK_WIDTH_PX))
  );
  const showPanRangeHighlight = sliderDragTooltip?.kind === 'pan' && !panControlDisabled;
  const showPanFocusAxisMarker = sliderDragTooltip?.kind === 'pan' && !panControlDisabled;
  const FocusIcon = focusStep === 'omitted'
    ? HeadphoneOff
    : (focusStep === 'solo' ? Headphones : Scale);

  useEffect(() => {
    if (panControlDisabled && sliderDragTooltip?.kind === 'pan') {
      setSliderDragTooltip(null);
    }
  }, [panControlDisabled, sliderDragTooltip]);

  useEffect(() => {
    setPlaylistDragState(null);
  }, [selectedPlaylistId]);

  const handleCycleLoopMode = useCallback(() => {
    setLoopMode((previous) => {
      if (previous === PLAYER_LOOP_MODES.OFF) return PLAYER_LOOP_MODES.ALL;
      if (previous === PLAYER_LOOP_MODES.ALL) return PLAYER_LOOP_MODES.ONE;
      return PLAYER_LOOP_MODES.OFF;
    });
  }, []);

  const handleSelectLibraryEntry = useCallback((entry) => {
    if (!entry) return;
    setMainPanelView('library');
    if (entry.kind === 'folder') {
      const folderId = entry.folder?.id || null;
      setLibraryScopeFolderId(folderId);
      setSelectedFolderId(folderId);
      setSelectedPlaylistId(null);
      setActiveIndex(-1);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, folderId || 'root');
      return;
    }
    if (entry.kind === 'playlist' && entry.playlist?.id) {
      setSelectedPlaylistId(entry.playlist.id);
      setSelectedFolderId(null);
      setActiveIndex(-1);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.PLAYLIST, entry.playlist.id);
      return;
    }
    if (entry.kind === 'mix' && entry.mix) {
      const queue = myDeviceQueue;
      const queueIndex = queue.findIndex((candidate) => String(candidate.mixId || '') === String(entry.mix.id));
      setSelectedFolderId(null);
      setSelectedPlaylistId(null);
      if (queueIndex >= 0) {
        handleSelectItem(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, 'root', queueIndex);
      } else {
        handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, 'root');
      }
    }
  }, [handleSelectCollection, handleSelectItem, myDeviceQueue]);

  const openCreditsForMix = useCallback(async (mix) => {
    if (!mix?.projectId) return;
    const title = `${mix.musicalNumber ? `${mix.musicalNumber} - ` : ''}${mix.projectName || mix.name || 'Musical number'}`;
    setLibraryContextMenu(null);
    setProjectContextMenu(null);
    setCreditsDialog({ status: 'loading', title, data: null, error: '' });
    try {
      const data = await getProjectCredits(mix.projectId, session);
      setCreditsDialog({ status: 'ready', title, data, error: '' });
    } catch (creditsError) {
      setCreditsDialog({ status: 'error', title, data: null, error: creditsError.message || 'Failed to load credits' });
    }
  }, [session]);

  const handleLibraryContextAction = useCallback(async (action) => {
    const entry = libraryContextMenu?.entry;
    setLibraryContextMenu(null);
    if (!entry) return;
    try {
      if (entry.kind === 'folder' && entry.folder) {
        if (action === 'rename') {
          await handleRenameFolder(entry.folder);
          return;
        }
        if (action === 'delete') {
          await handleDeleteFolder(entry.folder);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move folder "${entry.folder.name}" to`,
            [
              { value: '__root__', label: 'Root' },
              ...folders
                .filter((folder) => folder.id !== entry.folder.id)
                .map((folder) => ({ value: folder.id, label: folder.name })),
            ]
          );
          if (destination == null) return;
          await updatePlayerFolder(entry.folder.id, { parentFolderId: destination === '__root__' ? null : destination }, session);
          await refreshPlayerData();
        }
        return;
      }

      if (entry.kind === 'playlist' && entry.playlist) {
        if (action === 'rename') {
          await handleRenamePlaylist(entry.playlist);
          return;
        }
        if (action === 'delete') {
          await handleDeletePlaylist(entry.playlist);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move playlist "${entry.playlist.name}" to`,
            [
              { value: '__root__', label: 'Root' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]
          );
          if (destination == null) return;
          await updatePlayerPlaylist(entry.playlist.id, { folderId: destination === '__root__' ? null : destination }, session);
          await refreshPlayerData();
        }
      }

      if (entry.kind === 'mix' && entry.mix) {
        if (action === 'credits') {
          await openCreditsForMix(entry.mix);
          return;
        }
        if (action === 'rename') {
          await handleRenameMix(entry.mix);
          return;
        }
        if (action === 'delete') {
          await handleDeleteMix(entry.mix);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move mix "${entry.mix.name}" to`,
            [
              { value: '__root__', label: 'My Library (Root)' },
              ...playlists.map((playlist) => ({ value: `playlist:${playlist.id}`, label: `Playlist: ${playlist.name}` })),
            ]
          );
          if (destination == null) return;
          const sourcePlaylistId = entry.sourcePlaylistId || null;
          const sourcePlaylistItemId = entry.sourcePlaylistItemId || null;
          const destinationPlaylistId = String(destination).startsWith('playlist:')
            ? String(destination).slice('playlist:'.length)
            : null;
          if (sourcePlaylistId && destinationPlaylistId === sourcePlaylistId) {
            return;
          }
          if (sourcePlaylistId && sourcePlaylistItemId) {
            await deletePlayerPlaylistItem(sourcePlaylistId, sourcePlaylistItemId, session);
          }
          if (String(destination).startsWith('playlist:')) {
            const playlistId = destinationPlaylistId;
            if (!playlistId) return;
            const existingItems = playlistItemsByPlaylistId?.[playlistId] || [];
            const alreadyExists = existingItems.some((item) => String(item?.mixId || '') === String(entry.mix.id));
            if (alreadyExists) {
              setError('Mix already exists in selected playlist.');
              return;
            }
            await addPlayerPlaylistItem(playlistId, entry.mix.id, session);
          }
          await refreshPlayerData();
          return;
        }
        if (action === 'duplicate') {
          const duplicated = await createVirtualMix({
            projectId: entry.mix.projectId,
            name: `${entry.mix.name || 'Mix'} (Copy)`,
            presetId: entry.mix.presetId,
            presetVariantKey: entry.mix.presetVariantKey ?? null,
            advancedMix: entry.mix.advancedMix || {},
            folderId: null,
          }, session);
          if (entry.sourcePlaylistId) {
            await addPlayerPlaylistItem(entry.sourcePlaylistId, duplicated.id, session);
          }
          await refreshPlayerData();
          return;
        }
        if (action === 'edit_mix') {
          if (typeof onOpenAdvancedMix === 'function') {
            await onOpenAdvancedMix(entry.mix);
          }
          return;
        }
        if (action === 'new_from_project') {
          await promptCreateMixFromProject(entry.mix);
        }
      }
    } catch (contextError) {
      setError(contextError.message || 'Library action failed');
    }
  }, [
    folders,
    handleDeleteFolder,
    handleDeleteMix,
    handleDeletePlaylist,
    handleRenameFolder,
    handleRenameMix,
    handleRenamePlaylist,
    libraryContextMenu,
    openCreditsForMix,
    onOpenAdvancedMix,
    playlistItemsByPlaylistId,
    playlists,
    promptCreateMixFromProject,
    refreshPlayerData,
    session,
  ]);

  const projectContextMenuStyle = useMemo(() => {
    if (!projectContextMenu) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const x = Math.max(8, Math.min(projectContextMenu.x, viewportWidth - 172));
    const y = Math.max(8, Math.min(projectContextMenu.y, viewportHeight - 96));
    return { left: `${x}px`, top: `${y}px` };
  }, [projectContextMenu]);

  const libraryContextMenuStyle = useMemo(() => {
    if (!libraryContextMenu) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const x = Math.max(8, Math.min(libraryContextMenu.x, viewportWidth - 172));
    const y = Math.max(8, Math.min(libraryContextMenu.y, viewportHeight - 240));
    return { left: `${x}px`, top: `${y}px` };
  }, [libraryContextMenu]);

  const handleCreateMixFromContextMenu = useCallback(async () => {
    const target = projectContextMenu?.mix;
    setProjectContextMenu(null);
    if (!target) return;
    try {
      await promptCreateMixFromProject(target);
    } catch (saveError) {
      setError(saveError.message || 'Failed to create mix');
    }
  }, [projectContextMenu, promptCreateMixFromProject]);

  const handleShowCreditsFromContextMenu = useCallback(async () => {
    const target = projectContextMenu?.mix;
    await openCreditsForMix(target);
  }, [openCreditsForMix, projectContextMenu]);

  const activePlaylistRows = useMemo(() => {
    if (!selectedPlaylist) return [];
    const playableItems = selectedPlaylistItems.filter((candidate) => !candidate.unavailable && candidate.mix);
    return selectedPlaylistItems.map((item) => ({
      id: item.id,
      unavailable: Boolean(item.unavailable || !item.mix),
      mix: item.mix || null,
      queueIndex: playableItems.findIndex((candidate) => candidate.id === item.id),
    }));
  }, [selectedPlaylist, selectedPlaylistItems]);

  const handlePlaylistDropHover = useCallback((event, slotIndex) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setPlaylistDragState((previous) => {
      if (!previous) return previous;
      if (isNoopPlaylistDropSlot(previous.fromIndex, slotIndex)) {
        return previous.overSlotIndex === null
          ? previous
          : { ...previous, overSlotIndex: null };
      }
      return previous.overSlotIndex === slotIndex
        ? previous
        : { ...previous, overSlotIndex: slotIndex };
    });
  }, []);

  const handleCommitPlaylistDrop = useCallback(async (slotIndex) => {
    if (!selectedPlaylist?.id) {
      setPlaylistDragState(null);
      return;
    }
    if (playlistReorderPendingId === selectedPlaylist.id) {
      setPlaylistDragState(null);
      return;
    }

    const dragState = playlistDragState;
    if (!dragState || dragState.playlistId !== selectedPlaylist.id) return;
    if (isNoopPlaylistDropSlot(dragState.fromIndex, slotIndex)) {
      setPlaylistDragState(null);
      return;
    }

    const currentItems = selectedPlaylistItems;
    const nextItems = reorderPlaylistItems(currentItems, dragState.fromIndex, slotIndex);
    const nextItemIds = nextItems.map((item) => String(item.id));
    const currentOrderKey = currentItems.map((item) => String(item.id)).join('|');
    const nextOrderKey = nextItemIds.join('|');

    setPlaylistDragState(null);
    if (!nextItems.length || currentOrderKey === nextOrderKey) {
      return;
    }

    const activePlaylistItemId = (
      activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
      && activeCollectionId === selectedPlaylist.id
    )
      ? String(playlistQueue[activeIndex]?.playlistItemId || '')
      : '';
    const previousActiveIndex = activeIndex;
    const nextPlayableItems = nextItems.filter((item) => !item.unavailable && item.mix);
    const nextActiveIndex = activePlaylistItemId
      ? nextPlayableItems.findIndex((item) => String(item.id) === activePlaylistItemId)
      : previousActiveIndex;

    setPlaylistItemsByPlaylistId((previous) => ({
      ...previous,
      [selectedPlaylist.id]: nextItems,
    }));
    if (activePlaylistItemId) {
      setActiveIndex(nextActiveIndex);
    }
    setPlaylistReorderPendingId(selectedPlaylist.id);

    try {
      await reorderPlayerPlaylistItems(selectedPlaylist.id, nextItemIds, session);
    } catch (reorderError) {
      setPlaylistItemsByPlaylistId((previous) => ({
        ...previous,
        [selectedPlaylist.id]: currentItems,
      }));
      if (activePlaylistItemId) {
        setActiveIndex(previousActiveIndex);
      }
      setError(reorderError.message || 'Failed to reorder playlist items');
    } finally {
      setPlaylistReorderPendingId(null);
    }
  }, [
    activeCollectionId,
    activeCollectionType,
    activeIndex,
    playlistDragState,
    playlistQueue,
    playlistReorderPendingId,
    selectedPlaylist,
    selectedPlaylistItems,
    session,
  ]);

  const handlePlayPlaylistRow = useCallback(async (row) => {
    if (!selectedPlaylist || !row || row.unavailable || row.queueIndex < 0 || !row.mix) return;
    setSelectedPlaylistId(selectedPlaylist.id);
    setSelectedFolderId(null);
    setActiveCollectionType(PLAYER_COLLECTION_TYPES.PLAYLIST);
    setActiveCollectionId(selectedPlaylist.id);
    setActiveIndex(row.queueIndex);
    const queueItem = createQueueItemFromMix(row.mix, PLAYER_COLLECTION_TYPES.PLAYLIST, selectedPlaylist.id);
    if (!queueItem) return;
    await playMixItem(queueItem, row.queueIndex);
  }, [playMixItem, selectedPlaylist]);

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 leading-none">
            <BrandWordmark className="h-9" />
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-gray-700 p-0.5">
            <button
              type="button"
              disabled
              className="rounded-md px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white cursor-default"
              title="Current mode"
            >Player</button>
            <button
              onClick={onSwitchToDawDashboard}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              title="Switch to DAW mode"
            >
              DAW
            </button>
          </div>

          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen((previous) => !previous)}
              className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-2 flex items-center justify-center transition-colors"
              title="User menu"
            >
              <CircleUserRound size={18} />
            </button>
            {profileMenuOpen ? (
              <div className="absolute right-0 top-full mt-2 min-w-32 rounded-md border border-gray-700 bg-gray-800 shadow-lg z-30 overflow-hidden">
                {onOpenProfile ? (
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    My Profile
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setMainPanelView('settings');
                    setProfileMenuOpen(false);
                    refreshAudioDevices();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  Settings
                </button>
                {session?.user?.isAdmin ? (
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onOpenAdmin?.();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Admin
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <div className="h-full flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMainPanelView('library');
                setLibraryScopeFolderId(null);
                setSelectedPlaylistId(null);
                setSelectedFolderId(null);
                setActiveCollectionType(PLAYER_COLLECTION_TYPES.TUTTI);
                setActiveCollectionId(defaultTuttiCollectionId);
                setActiveIndex(-1);
              }}
              className="rounded-md bg-gray-800 border border-gray-700 p-2 text-gray-200 hover:bg-gray-700 transition-colors"
              title="Home"
            >
              <Home size={16} />
            </button>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search"
                className="w-full rounded-md bg-gray-800 border border-gray-700 pl-9 pr-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>

          {showNoAccessBanner ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-4 py-3 text-sm text-amber-100">
              {noAccessMessage}
            </div>
          ) : null}

          <div className="flex-1 min-h-0 flex gap-3">
            <div className={`${isLibraryCollapsed ? 'w-14' : 'w-80'} shrink-0 rounded-lg border border-gray-700 bg-gray-800/80 flex flex-col transition-all duration-200`}>
              {!isLibraryCollapsed ? (
                <div className="border-b border-gray-700 p-2">
                  <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Show tutti
                  </div>
                  <div className="space-y-1">
                    {tuttiShows.map((show) => {
                      const collectionId = `show:${show.id}`;
                      const active = activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
                        && activeCollectionId === collectionId;
                      return (
                        <button
                          key={show.id}
                          type="button"
                          onClick={() => {
                            setMainPanelView('library');
                            setSelectedPlaylistId(null);
                            setSelectedFolderId(null);
                            setActiveCollectionType(PLAYER_COLLECTION_TYPES.TUTTI);
                            setActiveCollectionId(collectionId);
                            setActiveIndex(-1);
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                            active ? 'bg-blue-700/30 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                          }`}
                        >
                          <span className="truncate">{show.name}</span>
                          <span className="ml-2 shrink-0 text-xs text-gray-500">{show.mixes.length}</span>
                        </button>
                      );
                    })}
                    {!tuttiShows.length ? (
                      <div className="px-2 py-1.5 text-xs text-gray-500">No tutti playlists.</div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="border-b border-gray-700 p-2 text-center text-xs font-semibold text-gray-400">T</div>
              )}
              <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
                {!isLibraryCollapsed ? (
                  libraryScopeFolderId ? (
                    <button
                      onClick={() => setLibraryScopeFolderId(null)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold hover:bg-gray-700"
                      title="Back to full library"
                    >
                      <ChevronLeft size={13} />
                      {currentLibraryFolder?.name || 'My Library'}
                    </button>
                  ) : (
                    <h2 className="text-sm font-semibold">My Library</h2>
                  )
                ) : (
                  <span className="text-sm font-semibold">L</span>
                )}
                <div className="flex items-center gap-1">
                  {!isLibraryCollapsed ? (
                    <div className="relative" ref={libraryCreateMenuRef}>
                      <button
                        onClick={() => setLibraryCreateMenuOpen((previous) => !previous)}
                        className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                        title="Create"
                      >
                        <Plus size={13} />
                      </button>
                      {libraryCreateMenuOpen ? (
                        <div className="absolute right-0 top-full mt-1 min-w-36 rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden z-30">
                          <button
                            onClick={async () => {
                              setLibraryCreateMenuOpen(false);
                              await handleCreateFolder();
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                          >
                            Create Folder
                          </button>
                          <button
                            onClick={async () => {
                              setLibraryCreateMenuOpen(false);
                              await handleCreatePlaylist();
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                          >
                            Create Playlist
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    onClick={() => setIsLibraryCollapsed((previous) => !previous)}
                    className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                    title={isLibraryCollapsed ? 'Expand library' : 'Collapse library'}
                  >
                    {isLibraryCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                  </button>
                </div>
              </div>

              {!isLibraryCollapsed ? (
                <div className="flex-1 overflow-auto p-2 space-y-1">
                  {libraryVisibleItems.map((entry) => {
                    const isActive = entry.kind === 'folder'
                      ? (
                        activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                        && activeCollectionId === (entry.folder?.id || 'root')
                      )
                      : (
                        entry.kind === 'playlist'
                          ? (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
                            && activeCollectionId === entry.playlist?.id
                          )
                          : (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                            && activeCollectionId === 'root'
                            && String(activeQueueItem?.mixId || '') === String(entry.mix?.id || '')
                          )
                      );
                    const EntryIcon = entry.kind === 'folder'
                      ? Folder
                      : (entry.kind === 'playlist' ? ListMusic : Play);
                    const subtitle = entry.kind === 'playlist'
                      ? 'Playlist'
                      : (entry.kind === 'mix' ? `${entry.mix?.musicalNumber || '0.0'} - Mix` : 'Folder');
                    return (
                      <div
                        key={entry.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setLibraryContextMenu({ entry, x: event.clientX, y: event.clientY });
                        }}
                        className={`group flex items-center gap-1 rounded-md pr-1 transition-colors ${
                          isActive ? 'bg-blue-700/30' : 'hover:bg-gray-700'
                        }`}
                      >
                        <button
                          onClick={() => handleSelectLibraryEntry(entry)}
                          onDoubleClick={async () => {
                            if (entry.kind === 'mix' && entry.mix) {
                              const queue = myDeviceQueue;
                              const queueIndex = queue.findIndex((candidate) => String(candidate.mixId || '') === String(entry.mix.id));
                              if (queueIndex >= 0) {
                                setSelectedFolderId(null);
                                setSelectedPlaylistId(null);
                                setActiveCollectionType(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES);
                                setActiveCollectionId('root');
                                setActiveIndex(queueIndex);
                                await playQueueItem(queueIndex);
                              }
                            }
                          }}
                          className="flex-1 min-w-0 text-left px-2 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <EntryIcon size={13} className="text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm truncate">{entry.name}</div>
                              <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  {!libraryVisibleItems.length ? (
                    <div className="text-xs text-gray-500 px-2 py-2">No library items here.</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 min-w-0 rounded-lg border border-gray-700 bg-gray-800/80 flex flex-col overflow-hidden">
              {mainPanelView === 'settings' ? (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <div>
                      <h2 className="text-sm font-semibold">Settings</h2>
                      <p className="text-xs text-gray-400 mt-0.5">Playback and device options for the player.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMainPanelView('library')}
                      className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <PlaybackDevicesSettingsPanel
                      audioSettings={audioSettings}
                      setAudioSettings={setAudioSettings}
                      audioInputs={audioInputs}
                      audioOutputs={audioOutputs}
                      monoOutputActive={monoOutputActive}
                      onRefreshDevices={refreshAudioDevices}
                      outputChannelCount={outputChannelCount}
                      playbackPanLawDb={playbackPanLawDb}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-gray-700">
                    <h2 className="text-sm font-semibold">
                      {selectedPlaylist && activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
                        ? selectedPlaylist.name
                        : "This Year's Musical Numbers"}
                    </h2>
                  </div>
                  <div className="grid grid-cols-[56px_minmax(0,1fr)_96px_34px] px-4 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-gray-700">
                    <div>#</div>
                    <div>Title</div>
                    <div className="text-right">Total Time</div>
                    <div />
                  </div>
                  <div className="flex-1 overflow-auto">
                    {selectedPlaylist && activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST ? (
                      <>
                        {(() => {
                          const activeDrag = playlistDragState?.playlistId === selectedPlaylist.id
                            ? playlistDragState
                            : null;
                          const playlistRowDragEnabled = activePlaylistRows.length > 1
                            && playlistReorderPendingId !== selectedPlaylist.id;
                          return (
                            <>
                        {activePlaylistRows.map((row, index) => {
                          const rowTitle = row.unavailable
                            ? '[Unavailable]'
                            : `${row.mix?.name || row.mix?.projectName || 'Mix'}`;
                          const isActive = !row.unavailable && row.queueIndex >= 0 && activeIndex === row.queueIndex;
                          const isDraggedRow = activeDrag?.itemId === row.id;
                          const slotIndexBeforeRow = index;
                          const beforeSlotActive = (
                            activeDrag
                            && !isNoopPlaylistDropSlot(activeDrag.fromIndex, slotIndexBeforeRow)
                            && activeDrag.overSlotIndex === slotIndexBeforeRow
                          );
                          const bottomSlotActive = (
                            activeDrag
                            && index === activePlaylistRows.length - 1
                            && !isNoopPlaylistDropSlot(activeDrag.fromIndex, activePlaylistRows.length)
                            && activeDrag.overSlotIndex === activePlaylistRows.length
                          );
                          return (
                            <div
                              key={row.id}
                              className="relative"
                            >
                              {beforeSlotActive ? (
                                <div className="pointer-events-none absolute left-4 right-4 top-0 z-20 h-px bg-blue-400 shadow-[0_0_0_1px_rgba(96,165,250,0.28)]" />
                              ) : null}
                              {bottomSlotActive ? (
                                <div className="pointer-events-none absolute left-4 right-4 bottom-0 z-20 h-px bg-blue-400 shadow-[0_0_0_1px_rgba(96,165,250,0.28)]" />
                              ) : null}
                              <div
                                draggable={playlistRowDragEnabled}
                                onDragStart={(event) => {
                                  if (!playlistRowDragEnabled) return;
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', row.id);
                                  setLibraryContextMenu(null);
                                  setProjectContextMenu(null);
                                  setPlaylistDragState({
                                    playlistId: selectedPlaylist.id,
                                    itemId: row.id,
                                    fromIndex: index,
                                    overSlotIndex: null,
                                  });
                                }}
                                onDragEnd={() => {
                                  setPlaylistDragState((previous) => (
                                    previous?.playlistId === selectedPlaylist.id ? null : previous
                                  ));
                                }}
                                onDragOver={(event) => {
                                  if (!playlistRowDragEnabled || !activeDrag) return;
                                  event.preventDefault();
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const slotIndex = event.clientY < rect.top + (rect.height / 2)
                                    ? index
                                    : index + 1;
                                  handlePlaylistDropHover(event, slotIndex);
                                }}
                                onDrop={(event) => {
                                  if (!playlistRowDragEnabled || !activeDrag) return;
                                  event.preventDefault();
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const slotIndex = event.clientY < rect.top + (rect.height / 2)
                                    ? index
                                    : index + 1;
                                  void handleCommitPlaylistDrop(slotIndex);
                                }}
                                onContextMenu={(event) => {
                                  if (row.unavailable || !row.mix) return;
                                  event.preventDefault();
                                  setLibraryContextMenu({
                                    entry: {
                                      kind: 'mix',
                                      mix: row.mix,
                                      sourcePlaylistId: selectedPlaylist.id,
                                      sourcePlaylistItemId: row.id,
                                    },
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                onClick={() => {
                                  if (row.unavailable || row.queueIndex < 0) return;
                                  handleSelectItem(PLAYER_COLLECTION_TYPES.PLAYLIST, selectedPlaylist.id, row.queueIndex);
                                }}
                                onDoubleClick={async () => {
                                  await handlePlayPlaylistRow(row);
                                }}
                                className={`group relative grid grid-cols-[56px_minmax(0,1fr)_96px_34px] items-center px-4 py-2.5 text-sm transition-colors ${
                                  row.unavailable
                                    ? 'text-gray-500'
                                    : (isActive ? 'bg-blue-700/20' : 'hover:bg-gray-700/60')
                                } ${
                                  playlistRowDragEnabled ? 'cursor-grab active:cursor-grabbing' : ''
                                } ${
                                  isDraggedRow ? 'opacity-40' : ''
                                }`}
                              >
                                <div className="flex items-center pl-0.5 text-gray-300">
                                  <span className="group-hover:hidden">{index + 1}</span>
                                  {!row.unavailable ? (
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={async (event) => {
                                        event.stopPropagation();
                                        await handlePlayPlaylistRow(row);
                                      }}
                                      className="hidden group-hover:flex items-center justify-center rounded text-gray-300 hover:text-white focus:text-white"
                                      title={`Play ${rowTitle}`}
                                    >
                                      <Play size={14} />
                                    </button>
                                  ) : null}
                                </div>
                                <div className="truncate">{rowTitle}</div>
                                <div className="text-right text-gray-400 tabular-nums">
                                  {formatDurationMs(row.mix?.durationMs, isActive ? durationSec : 0)}
                                </div>
                                <div className="flex justify-end">
                                  {!row.unavailable && row.mix ? (
                                    <button
                                      draggable={false}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setLibraryContextMenu({
                                          entry: {
                                            kind: 'mix',
                                            mix: row.mix,
                                            sourcePlaylistId: selectedPlaylist.id,
                                            sourcePlaylistItemId: row.id,
                                          },
                                          x: rect.right,
                                          y: rect.bottom + 4,
                                        });
                                      }}
                                      className="rounded p-1 text-gray-400 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                      title="Options"
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                            </>
                          );
                        })()}
                        {!activePlaylistRows.length ? (
                          <div className="text-xs text-gray-500 px-4 py-3">No playlist items.</div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {activeTuttiShow ? (
                          <div className="border-b border-gray-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {activeTuttiShow.name} tutti
                          </div>
                        ) : null}
                        {(activeTuttiMixes || []).map((mix, index) => {
                          const collectionId = activeTuttiShow ? `show:${activeTuttiShow.id}` : 'tutti';
                          const isActive = (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
                            && activeCollectionId === collectionId
                            && activeIndex === index
                          );
                          const listTitle = `${mix.musicalNumber || '0.0'} - ${mix.projectName || mix.name || 'Untitled Project'}`;
                          return (
                            <div
                              key={mix.id}
                              onClick={() => handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, collectionId, index)}
                              onDoubleClick={async () => {
                                await playQueueItem(index);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, collectionId, index);
                                setProjectContextMenu({ mix, x: event.clientX, y: event.clientY });
                              }}
                              className={`group grid grid-cols-[56px_minmax(0,1fr)_96px_34px] items-center px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                                isActive ? 'bg-blue-700/20' : 'hover:bg-gray-700/60'
                              }`}
                            >
                              <div className="flex items-center pl-0.5 text-gray-300">
                                <span className="group-hover:hidden">{index + 1}</span>
                                <button
                                  type="button"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    await playQueueItem(index);
                                  }}
                                  className="hidden group-hover:flex items-center justify-center rounded text-gray-300 hover:text-white focus:text-white"
                                  title={`Play ${listTitle}`}
                                >
                                  <Play size={14} />
                                </button>
                              </div>
                              <div className="truncate text-gray-100">{listTitle}</div>
                              <div className="text-right text-gray-400 tabular-nums">
                                {formatDurationMs(mix.durationMs, isActive ? durationSec : 0)}
                              </div>
                              <div className="flex justify-end">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setProjectContextMenu({ mix, x: rect.right, y: rect.bottom + 4 });
                                  }}
                                  className="rounded p-1 text-gray-400 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                  title="Options"
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {!activeTuttiMixes.length ? (
                          <div className="text-xs text-gray-500 px-4 py-3">No readable projects found.</div>
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {libraryContextMenu ? (
        <div
          ref={libraryContextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden"
          style={libraryContextMenuStyle || undefined}
        >
          {libraryContextMenu.entry?.kind === 'mix' ? (
            <>
              <button
                onClick={async () => handleLibraryContextAction('credits')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Show Credits
              </button>
              <button
                onClick={async () => handleLibraryContextAction('rename')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Rename
              </button>
              <button
                onClick={async () => handleLibraryContextAction('move')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Move
              </button>
	              <button
	                onClick={async () => handleLibraryContextAction('duplicate')}
	                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
	              >
	                Create duplicate
	              </button>
	              <button
	                onClick={async () => handleLibraryContextAction('edit_mix')}
	                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
	              >
	                Edit mix
	              </button>
	              <button
	                onClick={async () => handleLibraryContextAction('delete')}
	                className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-gray-700"
              >
                Delete
              </button>
              <button
                onClick={async () => handleLibraryContextAction('new_from_project')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Create new mix from this project
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => handleLibraryContextAction('rename')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Rename
              </button>
              <button
                onClick={async () => handleLibraryContextAction('move')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Move
              </button>
              <button
                onClick={async () => handleLibraryContextAction('delete')}
                className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-gray-700"
              >
                Delete
              </button>
            </>
          )}
        </div>
      ) : null}

      {projectContextMenu ? (
        <div
          ref={projectContextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden"
          style={projectContextMenuStyle || undefined}
        >
          <button
            onClick={handleShowCreditsFromContextMenu}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
          >
            Show Credits
          </button>
          {projectContextMenu.mix?.canCreateMixes !== false ? (
            <button
              onClick={handleCreateMixFromContextMenu}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
            >
              Create mix
            </button>
          ) : null}
        </div>
      ) : null}

      <CreditsDialog
        state={creditsDialog}
        onClose={() => setCreditsDialog(null)}
      />

      {mixDialog ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onClick={() => {
            if (mixDialog.status === 'saving') return;
            setMixDialog(null);
          }}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-gray-100">Create Mix</div>
                <div className="text-sm text-gray-400">
                  {mixDialog.projectLike?.musicalNumber ? `${mixDialog.projectLike.musicalNumber} - ` : ''}
                  {mixDialog.projectLike?.name || mixDialog.projectLike?.projectName || 'Project'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {mixDialogStep !== 'type' && mixDialogStep !== 'loading' && mixDialogStep !== 'saving' ? (
                  <button
                    type="button"
                    onClick={handleMixDialogBack}
                    className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMixDialog(null)}
                  disabled={mixDialog.status === 'saving'}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="px-6 py-5">
              {mixDialogStep === 'loading' ? (
                <div className="flex min-h-48 items-center justify-center gap-3 text-gray-300">
                  <Loader2 size={20} className="animate-spin" />
                  <span>Loading mix options...</span>
                </div>
              ) : null}

              {mixDialogStep === 'saving' ? (
                <div className="flex min-h-48 items-center justify-center gap-3 text-gray-300">
                  <Loader2 size={20} className="animate-spin" />
                  <span>Creating mix...</span>
                </div>
              ) : null}

              {mixDialogStep === 'type' ? (
                <div className="space-y-3 text-center">
                  <div className="text-sm font-medium text-gray-300">Choose mix type</div>
	                  <div className="grid gap-3 sm:grid-cols-4">
	                    {mixTypeOptions.map((option) => (
	                      <button
	                        key={option.id}
	                        type="button"
	                        onClick={() => {
	                          if (option.id === 'advanced') {
	                            handleCreateAdvancedMixFromDialog();
	                            return;
	                          }
	                          handleSelectMixType(option.id);
	                        }}
	                        className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-5 text-center text-base font-medium text-gray-100 transition-colors hover:border-gray-500 hover:bg-gray-750"
	                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {mixDialogStep === 'group' ? (
                <div className="space-y-4 text-center">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-gray-300">Choose group</div>
                    <div className="text-xs text-gray-500">
                      {groupMixOptions.length === 3 ? 'Select one or two groups' : 'Select one group'}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {groupMixOptions.map((option) => {
                      const isSelected = (mixDialog?.groupIds || []).includes(option.value);
                      return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleToggleMixGroup(option.value)}
                        className={`rounded-xl border px-4 py-5 text-center text-base font-medium transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                            : 'border-gray-700 bg-gray-800 text-gray-100 hover:border-gray-500 hover:bg-gray-750'
                        }`}
                      >
                        {option.label}
                      </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleConfirmGroupSelection}
                      disabled={!resolveGroupMixSelection(groupMixOptions, mixDialog?.groupIds)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {mixDialogStep === 'part' ? (
                <div className="space-y-4 text-center">
                  <div className="text-sm font-medium text-gray-300">Choose part</div>
                  <div className="space-y-4">
                    {partMixSections.map((section) => (
                      <div key={section.label} className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                          {section.label}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                          {section.options.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => handleSelectPartPreset(option)}
                              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-center text-sm font-medium text-gray-100 transition-colors hover:border-gray-500 hover:bg-gray-750"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {mixDialogStep === 'details' ? (
                <div className="space-y-5">
                  <div>
                    <div className="text-center text-sm font-medium text-gray-300">Name</div>
                    <input
                      type="text"
                      value={mixDialog.name}
                      onChange={(event) => setMixDialog((previous) => (
                        previous ? { ...previous, name: event.target.value } : previous
                      ))}
                      className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-gray-100 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
                      placeholder="Mix name"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-3 text-center">
                    <div className="text-sm font-medium text-gray-300">Place in</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {mixPlacementOptions.map((option) => {
                        const isSelected = mixDialog.placement === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setMixDialog((previous) => (
                              previous ? { ...previous, placement: option.value } : previous
                            ))}
                            className={`rounded-xl border px-4 py-3 text-center text-base font-medium transition-colors ${
                              isSelected
                                ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                                : 'border-gray-700 bg-gray-800 text-gray-100 hover:border-gray-500 hover:bg-gray-750'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreateMixFromDialog}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
                    >
                      Create Mix
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-gray-850 border-t border-gray-800 px-6 py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(380px,760px)_minmax(0,1fr)] items-center gap-4">
          <div className="min-w-0 text-lg font-semibold text-gray-200">
            <div className="truncate" title={nowPlayingLabel || activeQueueItem?.name || ''}>
              {nowPlayingLabel || activeQueueItem?.name || 'No mix playing'}
            </div>
          </div>

	          <div className="w-full">
	            <div className="flex items-center justify-center gap-4 flex-wrap">
	              <div className="flex items-center justify-center gap-3">
	                <button
	                  onClick={() => setShuffleEnabled((previous) => !previous)}
	                  className={`rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50 ${shuffleButtonClass}`}
	                  disabled={!activeQueueItems.length || isRendering}
	                  title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
	                >
	                  <Shuffle size={20} />
	                </button>
	                <button
	                  onClick={handlePrevious}
	                  className="rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title="Previous"
	                >
	                  <SkipBack size={20} />
	                </button>
	                <button
	                  onClick={handleTogglePlay}
	                  className="rounded bg-blue-600 hover:bg-blue-700 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title={isRendering ? 'Loading mix...' : (isPlaying ? 'Pause' : 'Play')}
	                >
	                  {isRendering ? <Loader2 size={20} className="animate-spin" /> : (isPlaying ? <Pause size={20} /> : <Play size={20} />)}
	                </button>
	                <button
	                  onClick={handleNext}
	                  className="rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title="Next"
	                >
	                  <SkipForward size={20} />
	                </button>
	                <button
	                  onClick={handleCycleLoopMode}
	                  className={`rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50 ${loopButtonClass}`}
	                  title={`${loopLabel} (click to cycle off -> all -> one)`}
	                  disabled={!activeQueueItems.length || isRendering}
	                >
	                  <LoopIcon size={20} />
	                </button>
	              </div>
	            </div>

            <div className="mt-3 flex items-center gap-3 w-full">
              <span className="text-sm text-gray-300 tabular-nums">{formatClock(currentTimeSec)}</span>
              <input
                type="range"
                min="0"
                max={Math.max(durationSec, 0.001)}
                step="0.01"
                value={Math.min(currentTimeSec, durationSec || 0)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="flex-1 volume-slider volume-slider-lg cursor-pointer block"
              />
              <span className="text-sm text-gray-300 tabular-nums">{formatClock(durationSec)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {practiceControlsEnabled || metronomeControlsEnabled ? (
              <div className="flex items-center gap-3">
                {metronomeControlsEnabled ? (
                  <button
                    onClick={handleToggleMetronomeMute}
                    disabled={isRendering}
                    className={`rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50 ${metronomeButtonClass}`}
                    title={isRealtimeMetronomeMuted ? 'Unmute metronome' : 'Mute metronome'}
                  >
                    <Metronome size={20} />
                  </button>
                ) : null}

                {practiceControlsEnabled ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400" title="Practice focus">
                        <FocusIcon size={20} />
                      </span>
                      <div
                        className={`relative w-40 h-7 ${focusControlDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        onMouseDown={(event) => {
                          if (event.detail > 1) return;
                          if (focusControlDisabled) return;
                          const rect = event.currentTarget.getBoundingClientRect();
                          const relative = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
                          const clamped = Math.max(0, Math.min(100, relative));
                          const nextFocusIndex = resolvePracticeFocusIndexFromSlider(clamped);
                          setPracticeFocusControl(nextFocusIndex);
                          beginSliderDrag(event, {
                            kind: 'focus',
                            value: getPracticeFocusSliderPosition(nextFocusIndex),
                            min: 0,
                            max: 100,
                            step: 1,
                            disabled: false,
                          });
                        }}
                        onDoubleClick={() => openSliderEdit('focus', practiceFocusControl, focusControlDisabled)}
                        title="Practice focus"
                      >
                        <div className="absolute left-[13px] right-[13px] top-1/2 -translate-y-1/2 h-[26px] rounded-full bg-gray-800 border border-gray-600 pointer-events-none z-0" />
                        <div
                          className={`absolute left-0 top-1/2 -translate-y-1/2 h-[26px] w-[26px] rounded-full bg-gray-800 border pointer-events-none z-10 ${
                            focusStep === 'omitted' ? 'border-blue-400' : 'border-gray-600'
                          }`}
                        />
                        <div
                          className={`absolute right-0 top-1/2 -translate-y-1/2 h-[26px] w-[26px] rounded-full bg-gray-800 border pointer-events-none z-10 ${
                            focusStep === 'solo' ? 'border-blue-400' : 'border-gray-600'
                          }`}
                        />
                        <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none z-20">
                          <div
                            className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-600"
                            style={{ left: `${focusSliderPosition}%` }}
                          />
                        </div>
                        {sliderDragTooltip?.kind === 'focus' && (
                          <div
                            className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                            style={{ marginBottom: '1px' }}
                          >
                            {formatSliderValue('focus', Number(sliderDragTooltip.value))}
                          </div>
                        )}
                        {sliderEditTooltip?.kind === 'focus' && (
                          <input
                            type="text"
                            value={sliderEditTooltip.text}
                            onChange={(event) => setSliderEditTooltip((previous) => (
                              previous ? { ...previous, text: event.target.value } : previous
                            ))}
                            onFocus={(event) => event.target.select()}
                            onBlur={commitSliderEdit}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setSliderEditTooltip(null);
                              }
                            }}
                            className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                            style={{ marginBottom: '1px' }}
                            autoFocus
                          />
                        )}
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 ${panControlDisabled ? 'opacity-40' : ''}`}>
                      <span className="text-gray-400" title="Transformed pan range">
                        <ChevronsLeftRightEllipsis size={20} />
                      </span>
                      <div
                        className={`relative w-40 h-7 ${panControlDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        onMouseDown={(event) => {
                          if (event.detail > 1) return;
                          if (panControlDisabled) return;
                          beginSliderDrag(event, {
                            kind: 'pan',
                            value: practicePanRange,
                            min: 0,
                            max: 200,
                            step: 1,
                            disabled: false,
                          });
                        }}
                        onDoubleClick={() => openSliderEdit('pan', practicePanRange, panControlDisabled)}
                        title={panControlDisabled ? 'Transformed pan range disabled for Omitted/Solo focus' : 'Transformed pan range'}
                      >
                        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[26px] rounded-full bg-gray-800 border border-gray-600 overflow-hidden pointer-events-none">
                        </div>
                        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[26px] rounded-full overflow-hidden pointer-events-none">
                          <div
                            className={`absolute left-0 top-0 bottom-0 bg-gray-600 ${showPanRangeHighlight ? 'opacity-70' : 'opacity-0'}`}
                            style={{ width: `${practicePanHighlightPixel}px` }}
                          />
                        </div>
                        <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none">
                          <div
                            className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-600 z-20"
                            style={{ left: `${practicePanKnobPixel - 12}px` }}
                          />
                          {showPanFocusAxisMarker ? (
                            <div
                              className="absolute h-[10px] w-[10px] rounded-full bg-gray-200 z-30 pointer-events-none"
                              style={{
                                left: `${practicePanFocusAxisPixel}px`,
                                top: '50%',
                                transform: 'translate3d(-50%, -50%, 0)',
                                backfaceVisibility: 'hidden',
                                willChange: 'left',
                              }}
                            />
                          ) : null}
                        </div>
                        {sliderDragTooltip?.kind === 'pan' && (
                          <div
                            className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                            style={{ marginBottom: '1px' }}
                          >
                            {formatSliderValue('pan', Number(sliderDragTooltip.value))}
                          </div>
                        )}
                        {sliderEditTooltip?.kind === 'pan' && (
                          <input
                            type="text"
                            value={sliderEditTooltip.text}
                            onChange={(event) => setSliderEditTooltip((previous) => (
                              previous ? { ...previous, text: event.target.value } : previous
                            ))}
                            onFocus={(event) => event.target.select()}
                            onBlur={commitSliderEdit}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setSliderEditTooltip(null);
                              }
                            }}
                            className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                            style={{ marginBottom: '1px' }}
                            autoFocus
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-0">
              <button
                onClick={handleToggleMute}
                className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                <VolumeIcon size={20} />
              </button>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  readOnly
                  onMouseDown={(event) => beginSliderDrag(event, {
                    kind: 'master',
                    value: volume,
                    min: 0,
                    max: 100,
                    step: 1,
                    disabled: isRendering,
                  })}
                  onDoubleClick={() => openSliderEdit('master', volume, isRendering)}
                  className="w-32 volume-slider volume-slider-lg cursor-pointer block"
                  title="Master Volume (double-click for numeric input)"
                />
                {sliderDragTooltip?.kind === 'master' && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                    style={{ marginBottom: '1px' }}
                  >
                    {formatSliderValue('master', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {sliderEditTooltip?.kind === 'master' && (
                  <input
                    type="text"
                    value={sliderEditTooltip.text}
                    onChange={(event) => setSliderEditTooltip((previous) => (
                      previous ? { ...previous, text: event.target.value } : previous
                    ))}
                    onFocus={(event) => event.target.select()}
                    onBlur={commitSliderEdit}
                    onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                      setSliderEditTooltip(null);
                    }
                  }}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                    style={{ marginBottom: '1px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        {error ? (
          <div className="mt-1 text-xs text-red-300 text-center">{error}</div>
        ) : null}
        {loading ? (
          <div className="mt-1 text-xs text-gray-400 text-center">Loading player data...</div>
        ) : null}
      </div>
    </div>
  );
}

export default PlayerDashboard;
