import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Plus, VolumeX } from 'lucide-react';
import {
  formatTime,
  msToSeconds,
  secondsToMs,
  clipGainDbToPosition,
  positionToClipGainDb,
} from '../utils/audio';
import { audioManager } from '../lib/audioManager';
import Waveform from './Waveform';
import GroupWaveform from './GroupWaveform';
import RecordingWaveform from './RecordingWaveform';
import { waveformService } from '../lib/waveformService';
import {
  hasZoomBitmap,
  mergeZoomBitmaps,
  prepareVisibleZoom,
  releaseStoredZoomBitmaps,
  releaseZoomBitmaps,
  storeZoomBitmaps,
  visibleZoomViews,
} from '../lib/visibleZoom';
import {
  anchoredScroll, boundedRange, centeredScroll, clampDuration, durationFromSlider, easeFollowScroll, followLanding,
  formatRulerLabel, intersectsViewport, normalizeWheel, rowAtY, rowOffsets, RULER_LABEL_HEIGHT, RULER_SEEK_HEIGHT,
  rulerInterval, rulerScale, scrollSegment, TIMELINE_RULER_HEIGHT, visibleRulerTicks, zoomAnchor,
} from '../utils/timelineViewport';
import { getEffectiveTrackMix, getGroupDescendantTrackIdsByGroup, getTrackHeight, normalizeTrackTree } from '../utils/trackTree';
import {
  applyClipPatches,
  constrainClipMove,
  constrainCropStart,
  constrainCropEnd,
  canAddClip,
  findSafePosition
} from '../utils/clipCollision';
import { isPrimaryModifierPressed } from '../utils/keyboard';
import { reportUserError } from '../utils/errorReporter';
import { createId } from '../utils/id';
import { isClipMediaMissing } from '../utils/mediaErrors';
import {
  calculateLyricStartMovePreview,
  getLyricLineEndMs,
  getLyricLineRange,
  getLyricPlacementPreviewStart,
  getPlacedLyricLines,
  pruneShortEmptyLyricLines,
} from '../utils/lyricTimeline';

const EMPTY_ROWS = [];
const TIMELINE_VIEWPORT_WIDTH = 1920; // Default viewport width (updated dynamically)
const MIN_VISIBLE_DURATION_MS = 8000; // Minimum duration to show when zoomed out
const MIN_CLIP_DURATION_MS = 100;
const MIN_CLIP_GAIN_DB = -24;
const MAX_CLIP_GAIN_DB = 24;
const CLIP_BACKGROUND_COLOR = 'rgba(79, 142, 247, 0.3)';
const CLIP_WAVEFORM_COLOR = 'rgba(79, 142, 247, 0.8)';
const MISSING_CLIP_BACKGROUND_COLOR = 'rgba(220, 38, 38, 0.55)';
const MISSING_CLIP_WAVEFORM_COLOR = 'rgba(248, 113, 113, 0.9)';

const REMOTE_CLIP_ANIMATION_MS = 800;


function easeInOutQuint(t) {
  if (t < 0.5) {
    return 16 * t * t * t * t * t;
  }
  return 1 - Math.pow(-2 * t + 2, 5) / 2;
}



/**
 * Timeline component
 * Displays tracks, clips, and waveforms with editing capabilities
 */
function Timeline({
  project,
  rows = EMPTY_ROWS,
  remoteAnimation = null,
  currentTimeMs,
  isPlaying,
  isRecording,
  recordingSegments,
  selectedTrackId,
  selectedNodeId = null,
  selectedRowKind = null,
  onUpdateClip,
  onSelectRow,
  onSelectTrack,
  onSeek,
  onVerticalScroll,
  scrollContainerRef,
  updateProject,
  onUpdateLoop,
  shortcutsEnabled = false,
  deleteClipShortcutEnabled = false,
  onDeleteTrackShortcut = null,
  advancedMixLocked = false,
  canSoloTracks = true,
  canEditTrack = null,
  explainTrackAccess = null,
  sharedVerticalScroll = false,
  missingMediaBlobIds = null,
  onReloadMissingMedia = null,
  onAddLyricLine = null,
  showLyricsLane = false,
  canEditLyrics = false,
  lyricsSyncActive = false,
  returnToStartToken = 0,
  displayMode = 'linear',
  showRms = false,
  showClipping = false,
  stereo = false,
  onAddTrack = null,
  onToggleGroupCollapse = null,
  children,
}) {
  const timelineRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const rulerViewportRef = useRef(null);
  const rulerPlayheadRef = useRef(null);
  const tracksPlayheadRef = useRef(null);
  const lyricsPlayheadRef = useRef(null);
  const playheadHoldRef = useRef(null);
  const tracksScrollRef = useRef(null);
  const fallbackScrollRef = useRef(null);
  const internalScrollRef = scrollContainerRef || fallbackScrollRef;
  const verticalScrollRef = useRef(null);
  const [verticalViewport, setVerticalViewport] = useState({ top: 0, height: 0 });
  // Keeps a keyboard-focused clip shell mounted while it is scrolled out of view.
  const [focusedClipId, setFocusedClipId] = useState(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  // Manual navigation pauses follow until the playhead is on screen again.
  const followEnabledRef = useRef(true);
  const followingRef = useRef(false);
  const scrollLeftRef = useRef(0);
  const pixelsPerMsRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const timelineWidthRef = useRef(0);
  const timeRef = useRef(0);
  const blockFollowRef = useRef(false);
  const setLogicalScrollRef = useRef(() => {});
  const noteUserScrollRef = useRef(() => {});
  const lastLogicalScrollRef = useRef(0);
  const zoomCommitRef = useRef({ token: 0, anchor: null });
  const cancelZoomRef = useRef(null);
  const cancelledGestureRef = useRef(false);
  const [visibleDurationMs, setVisibleDurationMs] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [originPx, setOriginPx] = useState(0);
  const originRef = useRef(0);
  const [dragState, setDragState] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [selectedClipHistory, setSelectedClipHistory] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [selectedLyricLineIds, setSelectedLyricLineIds] = useState([]);
  const [focusedLyricLineId, setFocusedLyricLineId] = useState(null);
  const [lyricPreview, setLyricPreview] = useState(null);
  const [editingLyricLineId, setEditingLyricLineId] = useState(null);
  const [editingLyricText, setEditingLyricText] = useState('');
  const [clipboardClip, setClipboardClip] = useState(null);
  const [rulerDragState, setRulerDragState] = useState(null);
  const [loopMarkerDragState, setLoopMarkerDragState] = useState(null);
  const [seekDragState, setSeekDragState] = useState(false);
  const [followEnabled, setFollowEnabled] = useState(true);
  const [timelineSelectionState, setTimelineSelectionState] = useState(null);
  const rightClickDragRef = useRef(false);
  const dragPreviewRef = useRef(null);
  const dragMoveRafRef = useRef(null);
  const dragMovePointRef = useRef(null);
  const lyricDragRef = useRef(null);
  const lyricTextEditCancelledRef = useRef(false);
  const lyricSelectionAnchorRef = useRef(null);
  const suppressLyricClickRef = useRef(false);
  const timelineSelectionRef = useRef(null);
  const timelineSelectionRafRef = useRef(null);
  const timelineSelectionPointRef = useRef(null);
  const timelineSelectionSuppressClickRef = useRef(false);
  const selectionClickResetRafRef = useRef(null);
  const prevProjectDurationRef = useRef(null);
  const pendingZoomAnchorRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(TIMELINE_VIEWPORT_WIDTH);

  const [animatedClipLayoutById, setAnimatedClipLayoutById] = useState({});
  const errorBeepContextRef = useRef(null);
  const animatedClipLayoutByIdRef = useRef({});
  const clipAnimationFrameRef = useRef(null);
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const cancelGestures = useCallback(() => {
    cancelledGestureRef.current = true;
    if (dragMoveRafRef.current !== null) cancelAnimationFrame(dragMoveRafRef.current);
    if (timelineSelectionRafRef.current !== null) cancelAnimationFrame(timelineSelectionRafRef.current);
    if (selectionClickResetRafRef.current !== null) cancelAnimationFrame(selectionClickResetRafRef.current);
    selectionClickResetRafRef.current = null;
    timelineSelectionSuppressClickRef.current = false;
    dragMoveRafRef.current = timelineSelectionRafRef.current = null;
    dragMovePointRef.current = timelineSelectionPointRef.current = null;
    dragPreviewRef.current = timelineSelectionRef.current = lyricDragRef.current = null;
    rightClickDragRef.current = false;
    setDragState(null);
    setDragPreview(null);
    setTimelineSelectionState(null);
    setRulerDragState(null);
    setLoopMarkerDragState(null);
    setLyricPreview(null);
  }, []);
  useLayoutEffect(() => {
    cancelGestures();
    return cancelGestures;
  }, [project.projectId, cancelGestures]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') cancelGestures(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancelGestures);
    window.addEventListener('pointercancel', cancelGestures);
    window.addEventListener('lostpointercapture', cancelGestures);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancelGestures);
      window.removeEventListener('pointercancel', cancelGestures);
      window.removeEventListener('lostpointercapture', cancelGestures);
    };
  }, [cancelGestures]);

  useEffect(() => {
    setSelectedLyricLineIds([]);
    setFocusedLyricLineId(null);
    setEditingLyricLineId(null);
    setLyricPreview(null);
    lyricSelectionAnchorRef.current = null;
    lyricDragRef.current = null;
  }, [project.projectId]);

  useEffect(() => {
    if (showLyricsLane && lyricsSyncActive) return;
    setSelectedLyricLineIds([]);
    setFocusedLyricLineId(null);
    setEditingLyricLineId(null);
    setLyricPreview(null);
    lyricSelectionAnchorRef.current = null;
    lyricDragRef.current = null;
  }, [showLyricsLane, lyricsSyncActive]);
  // Per-track permission gate (hosted projects). Clips on locked tracks can be
  // selected and inspected but not dragged, cropped or gain-edited.
  const isTrackEditable = useCallback(
    (trackId) => (typeof canEditTrack === 'function' ? Boolean(canEditTrack(trackId)) : true),
    [canEditTrack]
  );
  const trackAccessTitle = useCallback((trackId) => (
    (typeof explainTrackAccess === 'function' && explainTrackAccess(trackId))
      || 'You do not have permission to edit this track'
  ), [explainTrackAccess]);

  const updateLoop = useCallback((updater, description) => {
    if (typeof onUpdateLoop === 'function') {
      onUpdateLoop(updater);
      return;
    }
    updateProject((proj) => ({
      ...proj,
      loop: typeof updater === 'function' ? updater(proj.loop || {}) : updater,
    }), description);
  }, [onUpdateLoop, updateProject]);

  const playErrorBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!errorBeepContextRef.current) {
        errorBeepContextRef.current = new AudioCtx();
      }
      const ctx = errorBeepContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (error) {
      reportUserError(
        'Failed to play error beep.',
        error,
        { onceKey: 'timeline:error-beep' }
      );
    }
  };

  // The editor owns the vertical scroller; the inner element owns horizontal scroll.
  useLayoutEffect(() => {
    const horizontal = tracksScrollRef.current;
    if (!horizontal) return;
    let vertical = horizontal;
    if (sharedVerticalScroll) {
      for (let node = horizontal.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) { vertical = node; break; }
      }
    }
    verticalScrollRef.current = vertical;
    let frame;
    const measure = () => {
      frame = null;
      const width = horizontal.clientWidth;
      if (width > 0) setContainerWidth(width);
      const top = vertical === horizontal ? horizontal.scrollTop
        : vertical.getBoundingClientRect().top - horizontal.getBoundingClientRect().top;
      const height = vertical.clientHeight;
      setVerticalViewport((previous) => previous.top === top && previous.height === height ? previous : { top, height });
    };
    const invalidate = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
    observer?.observe(horizontal);
    if (vertical !== horizontal) observer?.observe(vertical);
    vertical.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    measure();
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      observer?.disconnect();
      vertical.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
      verticalScrollRef.current = null;
    };
  }, [sharedVerticalScroll, showLyricsLane]);

  // Media readiness is independent of summary readiness. No PCM scans or polling.
  useEffect(() => {
    const invalidate = () => setMediaRevision((revision) => revision + 1);
    const unsubscribeMedia = audioManager.mediaCache.subscribe?.(invalidate);
    const unsubscribeSource = waveformService.subscribe(invalidate);
    return () => { unsubscribeMedia?.(); unsubscribeSource(); };
  }, [project.projectId]);


  const globalPeakAmplitude = useMemo(() => {
    let peak = 0;
    for (const id of new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.blobId)))) {
      const stats = waveformService.getSourceStats(id, audioManager.mediaCache.get(id));
      if (Number.isFinite(stats?.sourcePeak)) peak = Math.max(peak, stats.sourcePeak);
    }
    return peak || 1;
  }, [project.tracks, mediaRevision]);

  const timelineRows = useMemo(() => rows && rows.length
    ? rows
    : (project.tracks || []).map((track) => ({
      kind: 'track',
      trackId: track.id,
      track,
      depth: 0,
      height: getTrackHeight(track),
    })), [rows, project.tracks]);
  const rowTops = useMemo(() => rowOffsets(timelineRows), [timelineRows]);

  useEffect(() => {
    if (!dragState) return;
    const sourceChanged = dragState.mediaBuffers?.some(([id, buffer]) => audioManager.mediaCache.get(id) !== buffer);
    const invalidSelection = Object.entries(dragState.initialByClipId || {}).some(([id, initial]) => {
      const clip = project.tracks.find((track) => track.id === initial.trackId)?.clips.find((entry) => entry.id === id);
      return !clip || clip.blobId !== initial.blobId || !isTrackEditable(initial.trackId);
    });
    if (sourceChanged || invalidSelection) cancelGestures();
  }, [mediaRevision, dragState, project.tracks, isTrackEditable, cancelGestures]);

  const effectiveMix = useMemo(() => getEffectiveTrackMix(project), [project]);
  const trackStateById = effectiveMix.statesByTrackId;

  const trackRowByTrackId = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(row.trackId, row);
      }
    });
    return map;
  }, [timelineRows]);

  const clipLocationById = useMemo(() => {
    const map = new Map();
    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        map.set(clip.id, { trackId: track.id, clip });
      });
    });
    return map;
  }, [project.tracks]);

  const renderedClipsByTrackId = useMemo(() => {
    const map = new Map();
    project.tracks.forEach((track) => {
      map.set(track.id, []);
    });

    if (!dragPreview?.clipPatchesById || Object.keys(dragPreview.clipPatchesById).length === 0) {
      project.tracks.forEach((track) => {
        map.set(track.id, track.clips);
      });
      return map;
    }

    const clipPatchesById = dragPreview.clipPatchesById;
    const targetTrackIdByClipId = dragPreview.targetTrackIdByClipId || {};

    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        const patch = clipPatchesById[clip.id];
        if (!patch) {
          map.get(track.id).push(clip);
          return;
        }
        const targetTrackId = targetTrackIdByClipId[clip.id] || track.id;
        if (!map.has(targetTrackId)) {
          map.set(targetTrackId, []);
        }
        map.get(targetTrackId).push({ ...clip, ...patch });
      });
    });

    map.forEach((clips, trackId) => {
      if (!Array.isArray(clips)) return;
      clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id));
      map.set(trackId, clips);
    });

    return map;
  }, [project.tracks, dragPreview]);

  const visibleTrackIndexByTrackId = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row, idx) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(row.trackId, idx);
      }
    });
    return map;
  }, [timelineRows]);

  const visibleTrackIdByRowIndex = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row, idx) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(idx, row.trackId);
      }
    });
    return map;
  }, [timelineRows]);

  const selectRow = (row) => {
    if (!row) return;
    onSelectRow?.(row);
    if (row.kind === 'track' && row.trackId) {
      onSelectTrack?.(row.trackId);
    }
  };

  const clearSelectedClips = () => {
    setSelectedClipIds([]);
    setSelectedClipHistory([]);
    setSelectedClipId(null);
  };

  const clearSelectedLyrics = () => {
    setSelectedLyricLineIds([]);
    setFocusedLyricLineId(null);
    setEditingLyricLineId(null);
    lyricSelectionAnchorRef.current = null;
  };

  useEffect(() => {
    if (selectedClipIds.length === 0 && !selectedClipId) return;
    if (selectedLyricLineIds.length > 0 || focusedLyricLineId || editingLyricLineId) {
      clearSelectedLyrics();
    }
  }, [selectedClipIds, selectedClipId, selectedLyricLineIds, focusedLyricLineId, editingLyricLineId]);

  const getLastSelectedFromHistory = (selectedIds, history) => {
    const selectedSet = new Set(selectedIds);
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (selectedSet.has(history[i])) {
        return history[i];
      }
    }
    return null;
  };

  const getShiftRangeSelection = (anchorClipId, targetClipId) => {
    const anchor = clipLocationById.get(anchorClipId);
    const target = clipLocationById.get(targetClipId);
    if (!anchor || !target) return [targetClipId];

    const anchorTrackIndex = visibleTrackIndexByTrackId.get(anchor.trackId);
    const targetTrackIndex = visibleTrackIndexByTrackId.get(target.trackId);
    if (anchorTrackIndex === undefined || targetTrackIndex === undefined) {
      return [targetClipId];
    }

    const minTrackIndex = Math.min(anchorTrackIndex, targetTrackIndex);
    const maxTrackIndex = Math.max(anchorTrackIndex, targetTrackIndex);
    const anchorStartMs = anchor.clip.timelineStartMs;
    const targetStartMs = target.clip.timelineStartMs;
    const anchorEndMs = anchor.clip.timelineStartMs + (anchor.clip.cropEndMs - anchor.clip.cropStartMs);
    const targetEndMs = target.clip.timelineStartMs + (target.clip.cropEndMs - target.clip.cropStartMs);
    const minTimeMs = Math.min(anchorStartMs, targetStartMs);
    const maxTimeMs = Math.max(anchorEndMs, targetEndMs);

    const selection = [];
    project.tracks.forEach((track) => {
      const trackIndex = visibleTrackIndexByTrackId.get(track.id);
      if (trackIndex === undefined || trackIndex < minTrackIndex || trackIndex > maxTrackIndex) {
        return;
      }
      track.clips.forEach((clip) => {
        const clipStartMs = clip.timelineStartMs;
        const clipEndMs = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
        if (clipStartMs >= minTimeMs && clipEndMs <= maxTimeMs) {
          selection.push(clip.id);
        }
      });
    });

    if (!selection.includes(anchorClipId)) selection.push(anchorClipId);
    if (!selection.includes(targetClipId)) selection.push(targetClipId);
    return selection;
  };

  const getClipDurationMs = (clip) => clip.cropEndMs - clip.cropStartMs;

  const getSelectedClipEntries = (clipIds = selectedClipIds) => {
    const entries = [];
    project.tracks.forEach((track) => {
      const rowIndex = visibleTrackIndexByTrackId.get(track.id);
      if (rowIndex === undefined) return;
      track.clips.forEach((clip) => {
        if (!clipIds.includes(clip.id)) return;
        entries.push({
          trackId: track.id,
          trackRowIndex: rowIndex,
          clip,
        });
      });
    });
    entries.sort((a, b) => (
      a.trackRowIndex - b.trackRowIndex ||
      a.clip.timelineStartMs - b.clip.timelineStartMs ||
      a.clip.id.localeCompare(b.clip.id)
    ));
    return entries;
  };

  const getActiveSelectionForClip = (clipId) => (
    selectedClipIdSet.has(clipId) && selectedClipIds.length > 0 ? selectedClipIds : [clipId]
  );

  const buildClipboardPayload = (clipIds = selectedClipIds) => {
    const entries = getSelectedClipEntries(clipIds);
    if (!entries.length) return null;

    const anchor = entries[0];
    const anchorTrackIndex = anchor.trackRowIndex;
    const anchorStartMs = anchor.clip.timelineStartMs;

    if (entries.length === 1) {
      return {
        type: 'single',
        clip: { ...anchor.clip },
      };
    }

    return {
      type: 'multi',
      items: entries.map((entry) => ({
        clip: { ...entry.clip },
        trackOffset: entry.trackRowIndex - anchorTrackIndex,
        startOffsetMs: entry.clip.timelineStartMs - anchorStartMs,
      })),
    };
  };

  // Calculate total timeline height based on rendered rows
  const totalTimelineHeight = rowTops[rowTops.length - 1];

  const groupTimelinePreviewByNodeId = useMemo(() => {
    const normalized = normalizeTrackTree(project);
    const groupTrackIdsByNodeId = getGroupDescendantTrackIdsByGroup(normalized);
    const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
    const nodeById = new Map((normalized.trackTree || []).map((node) => [node.id, node]));
    const trackNodeByTrackId = new Map(
      (normalized.trackTree || [])
        .filter((node) => node.kind === 'track')
        .map((node) => [node.trackId, node])
    );
    const byGroupNodeId = new Map();

    for (const [groupNodeId, trackIds] of groupTrackIdsByNodeId.entries()) {
      const clips = [];
      for (const trackId of trackIds) {
        const track = trackById.get(trackId);
        if (!track?.clips?.length) continue;
        // Group preview should ignore this group's own mute flag, but respect muted descendants.
        let mutedByDescendantPath = false;
        const trackNode = trackNodeByTrackId.get(trackId);
        let currentParentId = trackNode?.parentId ?? null;
        while (currentParentId && currentParentId !== groupNodeId) {
          const parentNode = nodeById.get(currentParentId);
          if (!parentNode) break;
          if (parentNode.muted) {
            mutedByDescendantPath = true;
            break;
          }
          currentParentId = parentNode.parentId ?? null;
        }
        if (mutedByDescendantPath) continue;
        if (track.muted) continue;
        for (const clip of renderedClipsByTrackId.get(trackId) || track.clips) {
          if (clip?.muted) continue;
          const durationMs = Math.max(0, (clip.cropEndMs || 0) - (clip.cropStartMs || 0));
          if (durationMs <= 0) continue;
          clips.push({
            key: `${trackId}:${clip.id}`,
            startMs: clip.timelineStartMs,
            durationMs,
            cropStartMs: clip.cropStartMs,
            cropEndMs: clip.cropEndMs,
            sourceDurationMs: clip.sourceDurationMs,
            blobId: clip.blobId,
          });
        }
      }

      clips.sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

      const activeSegments = [];
      for (const clip of clips) {
        const clipStart = clip.startMs;
        const clipEnd = clip.startMs + clip.durationMs;
        const previous = activeSegments[activeSegments.length - 1];
        if (!previous || clipStart > previous.endMs) {
          activeSegments.push({ startMs: clipStart, endMs: clipEnd });
        } else if (clipEnd > previous.endMs) {
          previous.endMs = clipEnd;
        }
      }

      byGroupNodeId.set(groupNodeId, {
        clips,
        activeSegments,
      });
    }

    return byGroupNodeId;
  }, [project, renderedClipsByTrackId]);

  // Calculate total timeline duration (in ms) based on furthest clip endpoint
  const rawProjectDurationMs = project.tracks.reduce((max, track) => {
    const trackEnd = track.clips.reduce((tMax, clip) => {
      const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
      return Math.max(tMax, clipEnd);
    }, 0);
    return Math.max(max, trackEnd);
  }, 0);

  const calculatePaddedDuration = (durationMs, intervalMs) => {
    if (durationMs === 0) return 0;
    const paddingMs = Math.max(intervalMs, durationMs * 0.1);
    const paddedDuration = durationMs + paddingMs;
    return Math.ceil(paddedDuration / intervalMs) * intervalMs;
  };

  const tempMinZoomDurationMs = Math.max(rawProjectDurationMs, MIN_VISIBLE_DURATION_MS);
  const tempPixelsPerMs = containerWidth / (visibleDurationMs || tempMinZoomDurationMs);
  const tempRulerIntervalMs = rulerInterval(tempPixelsPerMs);

  const projectDurationMs = calculatePaddedDuration(rawProjectDurationMs, tempRulerIntervalMs);
  const minZoomDurationMs = Math.max(projectDurationMs, MIN_VISIBLE_DURATION_MS);
  const sampleRate = useMemo(() => {
    let rate = 0;
    for (const track of project.tracks) for (const clip of track.clips) {
      rate = Math.max(rate, audioManager.mediaCache.get(clip.blobId)?.sampleRate || 0);
    }
    return rate || 48000;
  }, [project.tracks, mediaRevision]);
  // Four CSS pixels per sample at maximum zoom; trimming keeps its 100ms minimum.
  const maxZoomDurationMs = containerWidth * 1000 / (sampleRate * 4);
  const currentVisibleMs = visibleDurationMs === null ? minZoomDurationMs : visibleDurationMs;
  const clampedVisibleMs = clampDuration(currentVisibleMs, maxZoomDurationMs, minZoomDurationMs);
  useEffect(() => {
    if (visibleDurationMs !== null && visibleDurationMs !== clampedVisibleMs) setVisibleDurationMs(clampedVisibleMs);
  }, [visibleDurationMs, clampedVisibleMs]);
  const pixelsPerMs = containerWidth / clampedVisibleMs;
  const timelineWidthPx = Math.max(projectDurationMs, minZoomDurationMs) * pixelsPerMs;
  const segmentWidthPx = scrollSegment(scrollLeft, timelineWidthPx, containerWidth, originPx).width;
  const logicalScrollLeft = () => originRef.current + (tracksScrollRef.current?.scrollLeft || 0);
  const setLogicalScroll = (left, native) => {
    const segment = scrollSegment(left, timelineWidthPx, containerWidth, originRef.current);
    lastLogicalScrollRef.current = segment.logical;
    scrollLeftRef.current = segment.logical;
    originRef.current = segment.origin;
    setOriginPx(segment.origin);
    setScrollLeft(segment.logical);
    for (const element of [tracksScrollRef.current, rulerScrollRef.current]) {
      if (element && !(element === native?.element && native.left === segment.left)) element.scrollLeft = segment.left;
    }
  };
  setLogicalScrollRef.current = setLogicalScroll;
  /** Native scroll events also echo our own writes; only a different position is user navigation. */
  const handleNativeScroll = (element) => {
    const left = element.scrollLeft;
    const logical = originRef.current + left;
    if (Math.abs(logical - lastLogicalScrollRef.current) > 1) noteUserScrollRef.current();
    setLogicalScroll(logical, { element, left });
  };
  const segmentRange = (left, width) => boundedRange(left, width, originPx, segmentWidthPx);
  // Off-segment markers stay offscreen without introducing enormous CSS offsets.
  const localPosition = (logical) => Math.max(-100, Math.min(segmentWidthPx + 100, logical - originPx));
  const groupSurfaceClipsByNodeId = useMemo(() => new Map([...groupTimelinePreviewByNodeId].map(([id, preview]) => [id,
    preview.clips.flatMap((clip) => {
      const range = boundedRange(clip.startMs * pixelsPerMs, clip.durationMs * pixelsPerMs, originPx, segmentWidthPx);
      if (!range.width) return [];
      const cropStartMs = clip.cropStartMs + range.skipped / pixelsPerMs;
      return [{ ...clip, startMs: range.left / pixelsPerMs, durationMs: range.width / pixelsPerMs,
        cropStartMs, cropEndMs: cropStartMs + range.width / pixelsPerMs }];
    }),
  ])), [groupTimelinePreviewByNodeId, pixelsPerMs, originPx, segmentWidthPx]);
  useLayoutEffect(() => {
    setLogicalScroll(Math.min(scrollLeft, Math.max(0, timelineWidthPx - containerWidth)));
  }, [timelineWidthPx, containerWidth]);

  const beginLyricDrag = (event, line) => {
    if (!canEditLyrics || event.button !== 0) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    clearSelectedClips();
    const alreadySelected = selectedLyricLineIds.includes(line.id);
    const selectedIds = alreadySelected ? selectedLyricLineIds : [line.id];
    setSelectedLyricLineIds(selectedIds);
    if (!alreadySelected) {
      lyricSelectionAnchorRef.current = line.id;
      setFocusedLyricLineId(line.id);
    }
    cancelledGestureRef.current = false;
    const initial = {
      projectId: project.projectId,
      lineIds: selectedIds,
      pointerId: event.pointerId,
      clientX: event.clientX,
      startTimeMs: (event.clientX - tracksScrollRef.current.getBoundingClientRect().left + logicalScrollLeft()) / pixelsPerMs,
      baselineLines: (project.lyrics?.lines || []).map((candidate) => ({ ...candidate })),
      previewByLineId: null,
    };
    lyricDragRef.current = initial;
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      const drag = lyricDragRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId != null && drag.pointerId !== event.pointerId)) return;
      const element = tracksScrollRef.current;
      const deltaMs = Math.round((event.clientX - element.getBoundingClientRect().left + logicalScrollLeft()) / pixelsPerMs - drag.startTimeMs);
      const previewByLineId = calculateLyricStartMovePreview(
        drag.baselineLines,
        drag.lineIds,
        deltaMs,
        rawProjectDurationMs,
      );
      if (!previewByLineId) return;
      drag.previewByLineId = previewByLineId;
      setLyricPreview({ byLineId: previewByLineId });
    };

    const handlePointerUp = (event) => {
      const drag = lyricDragRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId != null && drag.pointerId !== event.pointerId)) return;
      if (cancelledGestureRef.current || !canEditLyrics) return;
      handlePointerMove(event);
      const previewByLineId = drag.previewByLineId;
      lyricDragRef.current = null;
      setLyricPreview(null);
      const changedLineIds = new Set(Object.entries(previewByLineId || {})
        .filter(([lineId, placement]) => {
          const original = drag.baselineLines.find((line) => line.id === lineId);
          return original && placement.startMs !== original.startMs;
        })
        .map(([lineId]) => lineId));
      suppressLyricClickRef.current = changedLineIds.size > 0;
      if (changedLineIds.size > 0) {
        const movedLines = drag.baselineLines.map((line) => {
          const placement = previewByLineId?.[line.id];
          return placement && changedLineIds.has(line.id)
            ? { id: line.id, text: line.text, startMs: placement.startMs }
            : line;
        });
        const nextLines = pruneShortEmptyLyricLines(movedLines, rawProjectDurationMs);
        const remainingIds = new Set(nextLines.map((line) => line.id));
        setSelectedLyricLineIds((current) => current.filter((lineId) => remainingIds.has(lineId)));
        if (focusedLyricLineId && !remainingIds.has(focusedLyricLineId)) {
          const nextFocus = selectedLyricLineIds.find((lineId) => remainingIds.has(lineId)) || null;
          setFocusedLyricLineId(nextFocus);
          lyricSelectionAnchorRef.current = nextFocus;
        }
        updateProject((current) => {
          if (!canEditLyrics || current.projectId !== drag.projectId || [...changedLineIds].some((id) => {
            const baseline = drag.baselineLines.find((line) => line.id === id);
            const latest = current.lyrics?.lines?.find((line) => line.id === id);
            return !latest || latest.startMs !== baseline?.startMs;
          })) return current;
          const currentLines = (current.lyrics?.lines || []).map((line) => {
            const placement = previewByLineId?.[line.id];
            return placement && changedLineIds.has(line.id)
              ? { id: line.id, text: line.text, startMs: placement.startMs }
              : line;
          });
          return {
            ...current,
            lyrics: {
              ...(current.lyrics || {}),
              lines: pruneShortEmptyLyricLines(currentLines, rawProjectDurationMs),
            },
          };
        }, changedLineIds.size > 1 ? 'Move lyric lines' : 'Move lyric line');
      }
    };

    const handlePointerCancel = (event) => {
      const drag = lyricDragRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId != null && drag.pointerId !== event.pointerId)) return;
      lyricDragRef.current = null;
      setLyricPreview(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [focusedLyricLineId, pixelsPerMs, project, rawProjectDurationMs, selectedLyricLineIds, updateProject, canEditLyrics]);

  const deleteSelectedLyricLines = () => {
    if (!canEditLyrics || selectedLyricLineIds.length === 0) return;
    const selected = new Set(selectedLyricLineIds);
    updateProject((current) => ({
      ...current,
      lyrics: {
        ...(current.lyrics || {}),
        lines: (current.lyrics?.lines || []).filter((line) => !selected.has(line.id)),
      },
    }), selected.size > 1 ? 'Delete lyric lines' : 'Delete lyric line');
    setSelectedLyricLineIds([]);
    setFocusedLyricLineId(null);
    lyricSelectionAnchorRef.current = null;
  };

  const selectLyricLine = (event, lineId) => {
    event.stopPropagation();
    clearSelectedClips();
    if (suppressLyricClickRef.current) {
      suppressLyricClickRef.current = false;
      return;
    }
    if (event.shiftKey) {
      const anchorId = lyricSelectionAnchorRef.current || focusedLyricLineId || lineId;
      lyricSelectionAnchorRef.current = anchorId;
      setSelectedLyricLineIds(getLyricLineRange(project.lyrics?.lines || [], anchorId, lineId));
    } else {
      lyricSelectionAnchorRef.current = lineId;
      setSelectedLyricLineIds([lineId]);
    }
    setFocusedLyricLineId(lineId);
  };

  const navigateLyricSelection = (direction, extendRange = false) => {
    const orderedIds = getPlacedLyricLines(project.lyrics?.lines || []).map(({ line }) => line.id);
    if (!orderedIds.length) return false;
    const currentId = focusedLyricLineId || selectedLyricLineIds[selectedLyricLineIds.length - 1];
    const currentIndex = orderedIds.indexOf(currentId);
    if (currentIndex < 0) return false;
    const targetIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + direction));
    const targetId = orderedIds[targetIndex];
    clearSelectedClips();
    if (extendRange) {
      const anchorId = lyricSelectionAnchorRef.current || currentId;
      lyricSelectionAnchorRef.current = anchorId;
      setSelectedLyricLineIds(getLyricLineRange(project.lyrics?.lines || [], anchorId, targetId));
    } else {
      lyricSelectionAnchorRef.current = targetId;
      setSelectedLyricLineIds([targetId]);
    }
    setFocusedLyricLineId(targetId);
    return true;
  };

  const saveLyricText = (lineId) => {
    const existingLines = project.lyrics?.lines || [];
    const line = existingLines.find((candidate) => candidate.id === lineId);
    if (line) {
      const editedLines = existingLines.map((candidate) => candidate.id === lineId
        ? { id: candidate.id, text: editingLyricText, startMs: candidate.startMs ?? null }
        : candidate);
      const nextLines = pruneShortEmptyLyricLines(editedLines, rawProjectDurationMs);
      const changed = nextLines.length !== existingLines.length || nextLines.some((candidate, index) => (
        candidate.id !== existingLines[index]?.id
        || candidate.text !== existingLines[index]?.text
        || candidate.startMs !== existingLines[index]?.startMs
      ));
      if (changed) {
        updateProject((current) => ({
          ...current,
          lyrics: {
            ...(current.lyrics || {}),
            lines: pruneShortEmptyLyricLines((current.lyrics?.lines || []).map((candidate) => candidate.id === lineId
              ? { id: candidate.id, text: editingLyricText, startMs: candidate.startMs ?? null }
              : candidate), rawProjectDurationMs),
          },
        }), 'Edit lyric line');
      }
    }
    setEditingLyricLineId(null);
  };

  const startLyricTextEdit = (line) => {
    if (!canEditLyrics) return;
    clearSelectedClips();
    lyricSelectionAnchorRef.current = line.id;
    setSelectedLyricLineIds([line.id]);
    setFocusedLyricLineId(line.id);
    lyricTextEditCancelledRef.current = false;
    setEditingLyricLineId(line.id);
    setEditingLyricText(line.text || '');
  };

  const editLyricText = (event, line) => {
    event.preventDefault();
    event.stopPropagation();
    startLyricTextEdit(line);
  };

  const lyricStartAtClientX = (clientX, target) => {
    const lane = target?.closest?.('[aria-label="Lyrics timeline lane"]');
    if (!lane) return 0;
    const positionPx = clientX - lane.getBoundingClientRect().left + logicalScrollLeft();
    return Math.max(0, Math.min(rawProjectDurationMs, Math.round(positionPx / pixelsPerMs)));
  };

  const insertLyricAtPointer = (event) => {
    const lineId = onAddLyricLine?.(lyricStartAtClientX(event.clientX, event.currentTarget));
    if (lineId) startLyricTextEdit({ id: lineId, text: '' });
  };

  const handleLyricBarDoubleClick = (event, line) => {
    if (!canEditLyrics) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      insertLyricAtPointer(event);
      return;
    }
    editLyricText(event, line);
  };

  const zoomSliderValue = minZoomDurationMs > maxZoomDurationMs
    ? Math.log(clampedVisibleMs / maxZoomDurationMs) / Math.log(minZoomDurationMs / maxZoomDurationMs)
    : 0;
  // UI direction: left = zoomed out, right = zoomed in.
  const zoomSliderUiValue = 1 - zoomSliderValue;

  const sliderValueToDuration = (value) => {
    return durationFromSlider(value, maxZoomDurationMs, minZoomDurationMs);
  };

  // Predict the render that follows a zoom, including the ruler padding that depends on the new scale.
  const zoomMetrics = (nextVisibleDurationMs) => {
    const measure = (stateDuration) => {
      const tempMin = Math.max(rawProjectDurationMs, MIN_VISIBLE_DURATION_MS);
      const basis = stateDuration == null ? tempMin : stateDuration;
      const projectDuration = calculatePaddedDuration(rawProjectDurationMs, rulerInterval(containerWidth / basis));
      const minZoom = Math.max(projectDuration, MIN_VISIBLE_DURATION_MS);
      const maxZoom = containerWidth * 1000 / ((sampleRate || 48000) * 4);
      const visible = stateDuration == null ? minZoom : clampDuration(stateDuration, maxZoom, minZoom);
      const ppm = containerWidth / visible;
      return {
        durationState: stateDuration == null ? null : visible, ppm,
        timelineWidth: Math.max(projectDuration, minZoom) * ppm,
      };
    };
    // Clamping can change the duration the next render uses to pad the ruler. Follow that pass.
    let metrics = measure(nextVisibleDurationMs);
    for (let pass = 0; pass < 3 && metrics.durationState != null && Math.abs(metrics.durationState - (nextVisibleDurationMs || 0)) > 1e-4; pass += 1) {
      const settled = measure(metrics.durationState);
      nextVisibleDurationMs = metrics.durationState;
      if (Math.abs(settled.ppm - metrics.ppm) <= 1e-6 * metrics.ppm) return settled;
      metrics = settled;
    }
    return metrics;
  };
  const commitZoom = (metrics) => {
    const anchor = zoomCommitRef.current.anchor;
    pendingZoomAnchorRef.current = anchor;
    if (anchor && containerWidth > 0 && metrics.ppm > 0) {
      const targetScroll = anchoredScroll(anchor, metrics.ppm, containerWidth, metrics.timelineWidth);
      const segment = scrollSegment(targetScroll, metrics.timelineWidth, containerWidth, originRef.current);
      originRef.current = segment.origin;
      lastLogicalScrollRef.current = segment.logical;
      setOriginPx(segment.origin);
      setScrollLeft(segment.logical);
    }
    setVisibleDurationMs(metrics.durationState);
  };
  // The timeline scale stays where it is until the on-screen waveforms for the new scale are painted.
  const applyZoomDuration = (nextVisibleDurationMs, pointerX, anchorOverride) => {
    if (dragState || lyricDragRef.current || rulerDragState || loopMarkerDragState || timelineSelectionRef.current) return false;
    const metrics = zoomMetrics(nextVisibleDurationMs);
    const anchor = anchorOverride || zoomAnchor(logicalScrollLeft(), containerWidth, pixelsPerMs, currentTimeMs, pointerX);
    const token = ++zoomCommitRef.current.token;
    zoomCommitRef.current.anchor = anchor;
    cancelZoomRef.current?.();
    cancelZoomRef.current = null;
    const sameZoom = Math.abs(metrics.ppm - pixelsPerMs) <= 1e-4 * Math.max(metrics.ppm, pixelsPerMs);
    if (!(containerWidth > 0) || !(metrics.ppm > 0) || sameZoom) {
      if (sameZoom) pendingZoomAnchorRef.current = anchor;
      else commitZoom(metrics);
      return true;
    }
    const targetScroll = anchoredScroll(anchor, metrics.ppm, containerWidth, metrics.timelineWidth);
    const segment = scrollSegment(targetScroll, metrics.timelineWidth, containerWidth, originRef.current);
    cancelZoomRef.current = prepareVisibleZoom({
      rows: timelineRows, rowTops, vertical: verticalViewport, clipsByTrack: renderedClipsByTrackId,
      groupClipsByNode: groupTimelinePreviewByNodeId, segment, pixelsPerMs: metrics.ppm, viewportWidth: containerWidth,
      dpr: Math.max(1, globalThis.devicePixelRatio || 1),
      display: {
        displayMode, showRms, showClipping, globalPeakAmplitude,
        clipColor: CLIP_WAVEFORM_COLOR, missingColor: MISSING_CLIP_WAVEFORM_COLOR,
        groupColor: 'rgba(123, 173, 255, 0.75)', groupMissingColor: 'rgba(248, 113, 113, 0.55)',
        missingIds: missingMediaBlobIds,
      },
      getBuffer: (id) => audioManager.mediaCache.get(id),
      onReady: (bitmaps) => {
        if (zoomCommitRef.current.token !== token) {
          releaseZoomBitmaps(bitmaps);
          return;
        }
        cancelZoomRef.current = null;
        storeZoomBitmaps(bitmaps);
        commitZoom(metrics);
      },
    });
    return true;
  };
  useEffect(() => () => cancelZoomRef.current?.(), []);
  useEffect(() => () => releaseStoredZoomBitmaps(), [pixelsPerMs]);

  const [pendingGroupCollapseId, setPendingGroupCollapseId] = useState(null);
  const pendingGroupCollapseIdRef = useRef(null);
  const activePreloadRef = useRef(null);
  const pendingTimeoutRef = useRef(null);

  const getChildViewsForGroup = useCallback((groupNodeId) => {
    if (!project?.trackTree || !project?.tracks || !(containerWidth > 0) || !(pixelsPerMs > 0)) {
      return { views: [], expectedCount: 0 };
    }
    const descendantIds = getGroupDescendantTrackIdsByGroup(project).get(groupNodeId) || [];
    if (!descendantIds.length) return { views: [], expectedCount: 0 };
    const trackMap = new Map((project.tracks || []).map((t) => [t.id, t]));
    const childRows = descendantIds
      .map((tId) => trackMap.get(tId))
      .filter(Boolean)
      .map((track) => ({
        kind: 'track',
        trackId: track.id,
        track,
        height: getTrackHeight(track),
      }));
    if (!childRows.length) return { views: [], expectedCount: 0 };

    const segment = scrollSegment(scrollLeft, timelineWidthPx, containerWidth, originRef.current);
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);

    let expectedCount = 0;
    for (const row of childRows) {
      const clips = renderedClipsByTrackId.get(row.trackId) || row.track.clips || [];
      for (const clip of clips) {
        const durationMs = Math.max(0, (clip.cropEndMs || 0) - (clip.cropStartMs || 0));
        const logicalLeft = (clip.timelineStartMs || 0) * pixelsPerMs;
        if (intersectsViewport(logicalLeft, durationMs * pixelsPerMs, segment.logical, containerWidth, 0)) {
          expectedCount += 1;
        }
      }
    }

    const groupNode = (project.trackTree || []).find((node) => node.kind === 'group' && node.id === groupNodeId);
    const groupRows = groupNode ? [{ kind: 'group', nodeId: groupNodeId, height: 80 }] : [];
    const allRows = [...groupRows, ...childRows];

    const views = visibleZoomViews({
      rows: allRows,
      rowTops: allRows.map((_, i) => i * 100),
      vertical: { top: 0, height: 100000 },
      clipsByTrack: renderedClipsByTrackId,
      groupClipsByNode: groupTimelinePreviewByNodeId,
      segment,
      pixelsPerMs,
      viewportWidth: containerWidth,
      dpr,
      display: {
        displayMode,
        showRms,
        showClipping,
        globalPeakAmplitude,
        clipColor: CLIP_WAVEFORM_COLOR,
        missingColor: MISSING_CLIP_WAVEFORM_COLOR,
        groupColor: 'rgba(123, 173, 255, 0.75)',
        groupMissingColor: 'rgba(248, 113, 113, 0.55)',
        missingIds: missingMediaBlobIds,
      },
      getBuffer: (id) => audioManager.mediaCache.get(id),
    });

    return { views, expectedCount };
  }, [project, containerWidth, pixelsPerMs, scrollLeft, timelineWidthPx, renderedClipsByTrackId, groupTimelinePreviewByNodeId, displayMode, showRms, showClipping, globalPeakAmplitude, missingMediaBlobIds, mediaRevision]);

  const areChildViewsReady = useCallback((childState) => {
    if (!childState) return true;
    const { views = [], expectedCount = 0 } = Array.isArray(childState)
      ? { views: childState, expectedCount: childState.length }
      : childState;
    if (expectedCount > 0 && views.length < expectedCount) return false;
    if (!views.length) return true;
    return views.every((v) => hasZoomBitmap(v.key, pixelsPerMs, v.cropStartMs));
  }, [pixelsPerMs]);

  const handlePreloadGroupCollapse = useCallback((groupNodeId, onDone) => {
    const childState = getChildViewsForGroup(groupNodeId);
    if (areChildViewsReady(childState)) {
      onDone?.();
      return () => {};
    }
    const views = childState?.views || [];
    if (!views.length) {
      return () => {};
    }

    if (activePreloadRef.current?.groupNodeId === groupNodeId) {
      if (onDone) {
        activePreloadRef.current.callbacks.add(onDone);
      }
      return () => {
        if (onDone) activePreloadRef.current?.callbacks?.delete(onDone);
      };
    }

    activePreloadRef.current?.cancel?.();

    const callbacks = new Set();
    if (onDone) callbacks.add(onDone);

    const cancel = prepareVisibleZoom({
      views,
      tier: 0,
      priority: 5,
      onReady: (bitmaps) => {
        if (bitmaps) mergeZoomBitmaps(bitmaps);
        if (activePreloadRef.current?.cancel === cancel) {
          activePreloadRef.current = null;
        }
        callbacks.forEach((cb) => {
          try { cb(); } catch (err) { console.error(err); }
        });
      },
    });

    activePreloadRef.current = { groupNodeId, cancel, callbacks };
    return () => {
      if (onDone) callbacks.delete(onDone);
    };
  }, [getChildViewsForGroup, areChildViewsReady]);

  const handleToggleGroupCollapseWithPreload = useCallback((groupNodeId) => {
    const targetGroup = (project?.trackTree || []).find(
      (node) => node.kind === 'group' && node.id === groupNodeId
    );
    const willCollapse = !Boolean(targetGroup?.collapsed);
    if (willCollapse) {
      if (pendingGroupCollapseIdRef.current === groupNodeId) {
        pendingGroupCollapseIdRef.current = null;
        setPendingGroupCollapseId(null);
        clearTimeout(pendingTimeoutRef.current);
      }
      onToggleGroupCollapse?.(groupNodeId);
      // Immediately queue background preload of child views so the next expand is preloaded and instant!
      handlePreloadGroupCollapse(groupNodeId);
      return;
    }

    if (pendingGroupCollapseIdRef.current === groupNodeId) {
      // A click is already pending expand for this group; do not reset timeout or cancel running job
      return;
    }

    const childState = getChildViewsForGroup(groupNodeId);
    if (areChildViewsReady(childState)) {
      pendingGroupCollapseIdRef.current = null;
      setPendingGroupCollapseId(null);
      clearTimeout(pendingTimeoutRef.current);
      onToggleGroupCollapse?.(groupNodeId);
      return;
    }

    pendingGroupCollapseIdRef.current = groupNodeId;
    setPendingGroupCollapseId(groupNodeId);
    clearTimeout(pendingTimeoutRef.current);
    pendingTimeoutRef.current = setTimeout(() => {
      if (pendingGroupCollapseIdRef.current === groupNodeId) {
        pendingGroupCollapseIdRef.current = null;
        setPendingGroupCollapseId(null);
        onToggleGroupCollapse?.(groupNodeId);
      }
    }, 1500);

    handlePreloadGroupCollapse(groupNodeId, () => {
      if (pendingGroupCollapseIdRef.current === groupNodeId) {
        clearTimeout(pendingTimeoutRef.current);
        pendingGroupCollapseIdRef.current = null;
        setPendingGroupCollapseId(null);
        onToggleGroupCollapse?.(groupNodeId);
      }
    });
  }, [project, onToggleGroupCollapse, getChildViewsForGroup, areChildViewsReady, handlePreloadGroupCollapse]);

  useEffect(() => {
    if (!pendingGroupCollapseId) return;
    const childState = getChildViewsForGroup(pendingGroupCollapseId);
    if (areChildViewsReady(childState)) {
      clearTimeout(pendingTimeoutRef.current);
      pendingGroupCollapseIdRef.current = null;
      setPendingGroupCollapseId(null);
      onToggleGroupCollapse?.(pendingGroupCollapseId);
    }
  }, [pendingGroupCollapseId, getChildViewsForGroup, areChildViewsReady, onToggleGroupCollapse]);

  useEffect(() => () => {
    clearTimeout(pendingTimeoutRef.current);
    activePreloadRef.current?.cancel?.();
  }, []);
  const applyZoomRef = useRef(applyZoomDuration);
  applyZoomRef.current = applyZoomDuration;
  const wheelZoomRef = useRef({ frame: null, duration: undefined, pointerX: 0, pending: false });
  useEffect(() => () => {
    if (wheelZoomRef.current.frame != null) cancelAnimationFrame(wheelZoomRef.current.frame);
  }, []);

  const following = Boolean(isPlaying || isRecording);
  const followActive = followEnabled && following;
  scrollLeftRef.current = scrollLeft;
  pixelsPerMsRef.current = pixelsPerMs;
  viewportWidthRef.current = containerWidth;
  timelineWidthRef.current = timelineWidthPx;
  timeRef.current = currentTimeMs;
  followingRef.current = following;
  followEnabledRef.current = followEnabled;
  blockFollowRef.current = Boolean(dragState || rulerDragState || loopMarkerDragState || seekDragState);
  noteUserScrollRef.current = () => {
    if (!followingRef.current || !followEnabledRef.current) return;
    followEnabledRef.current = false;
    setFollowEnabled(false);
  };
  // Off screen: put the playhead in the center on this frame. On screen: the animation eases there.
  useLayoutEffect(() => {
    if (!followActive) return;
    if (pendingZoomAnchorRef.current || blockFollowRef.current || lyricDragRef.current || timelineSelectionRef.current) return;
    const liveMs = typeof audioManager.getCurrentTime === 'function' ? Number(audioManager.getCurrentTime()) : NaN;
    const playhead = (Number.isFinite(liveMs) ? liveMs : timeRef.current) * pixelsPerMsRef.current;
    const width = viewportWidthRef.current;
    if (width <= 0) return;
    if (playhead < scrollLeftRef.current || playhead > scrollLeftRef.current + width) {
      const target = centeredScroll(playhead, width, timelineWidthRef.current);
      if (Math.abs(target - scrollLeftRef.current) >= 0.5) setLogicalScrollRef.current(target);
    }
  }, [followActive, currentTimeMs, pixelsPerMs, scrollLeft, containerWidth, timelineWidthPx]);
  const readLivePlayheadMs = () => {
    if (followingRef.current && typeof audioManager.getCurrentTime === 'function') {
      const live = Number(audioManager.getCurrentTime());
      if (Number.isFinite(live)) return live;
    }
    return timeRef.current;
  };
  // The transport publishes time in coarse steps. The playhead paints from the audio clock
  // every frame so it glides instead of jumping by those steps.
  useEffect(() => {
    if (!following) return undefined;
    let frame = 0;
    let last = null;
    let previousPlayhead = null;
    const tick = (now) => {
      const elapsed = last == null ? 1 / 60 : (now - last) / 1000;
      const dt = elapsed > 0 ? Math.min(0.05, elapsed) : 1 / 60;
      last = now;
      const playhead = readLivePlayheadMs() * pixelsPerMsRef.current;
      const width = viewportWidthRef.current;
      const blocked = pendingZoomAnchorRef.current || blockFollowRef.current
        || lyricDragRef.current || timelineSelectionRef.current;
      if (followEnabledRef.current && !blocked && width > 0) {
        const next = easeFollowScroll({
          playheadPx: playhead,
          previousPlayheadPx: previousPlayhead,
          scrollLeft: scrollLeftRef.current,
          width,
          timelineWidth: timelineWidthRef.current,
          dt,
        });
        if (Math.abs(next - scrollLeftRef.current) >= 0.25) setLogicalScrollRef.current(next);
      }
      const left = `${playhead - scrollLeftRef.current}px`;
      playheadHoldRef.current = left;
      for (const node of [rulerPlayheadRef.current, tracksPlayheadRef.current, lyricsPlayheadRef.current]) {
        if (node) node.style.left = left;
      }
      previousPlayhead = playhead;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [following]);

  // Stop and playback end return to the loop start, or the song start. That window is painted
  // only after a zoom or a loop change, and only once the visible rows and their margins are done.
  const returnTimeMs = project.loop?.enabled && Number.isFinite(project.loop.startMs) ? project.loop.startMs : 0;
  const returnScrollLeft = followLanding(returnTimeMs * pixelsPerMs, containerWidth, timelineWidthPx);
  const loopKey = `${project.loop?.enabled ? 1 : 0}:${project.loop?.startMs ?? ''}`;
  const zoomWatchRef = useRef(pixelsPerMs);
  const loopWatchRef = useRef(loopKey);
  const [paintStart, setPaintStart] = useState(false);
  if (Math.abs(pixelsPerMs - zoomWatchRef.current) > 1e-4 * Math.max(pixelsPerMs, zoomWatchRef.current)
    || loopKey !== loopWatchRef.current) {
    zoomWatchRef.current = pixelsPerMs;
    loopWatchRef.current = loopKey;
    if (!paintStart) setPaintStart(true);
  }
  const startViewportLeftPx = paintStart ? returnScrollLeft - originPx : undefined;
  useLayoutEffect(() => {
    if (!returnToStartToken) return;
    const x = returnTimeMs * pixelsPerMs - scrollLeft;
    if (x < 0 || x > containerWidth) setLogicalScroll(returnScrollLeft);
  }, [returnToStartToken]);

  const formatVisibleDuration = (durationMs) => {
    const seconds = durationMs / 1000;
    if (seconds < 1) return `${Number(durationMs.toPrecision(3))}ms`;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  };

  const ruler = rulerScale(pixelsPerMs, { sampleRate });
  const rulerTicks = visibleRulerTicks(scrollLeft, containerWidth, pixelsPerMs, ruler.majorMs, minZoomDurationMs);
  const rulerFractions = visibleRulerTicks(scrollLeft, containerWidth, pixelsPerMs, ruler.subMinorMs, minZoomDurationMs);
  const viewportX = (timeMs) => timeMs * pixelsPerMs - scrollLeft;
  const playheadLeft = `${viewportX(currentTimeMs)}px`;
  if (!following || playheadHoldRef.current == null) playheadHoldRef.current = playheadLeft;
  const shownPlayheadLeft = following ? playheadHoldRef.current : playheadLeft;

  useLayoutEffect(() => {
    if (!pendingZoomAnchorRef.current) return;
    const tracksElement = tracksScrollRef.current;
    if (!tracksElement) return;

    const targetScrollLeft = anchoredScroll(pendingZoomAnchorRef.current, pixelsPerMs, containerWidth, timelineWidthPx);

    setLogicalScroll(targetScrollLeft);
    pendingZoomAnchorRef.current = null;
  }, [pixelsPerMs, timelineWidthPx, containerWidth, currentTimeMs]);

  useEffect(() => {
    if (visibleDurationMs === null && prevProjectDurationRef.current !== null) {
      const prevDuration = prevProjectDurationRef.current;
      const currentDuration = projectDurationMs;

      if (prevDuration !== currentDuration) {
        const preservedDuration = Math.max(prevDuration, MIN_VISIBLE_DURATION_MS);
        setVisibleDurationMs(preservedDuration);
      }
    }

    prevProjectDurationRef.current = projectDurationMs;
  }, [projectDurationMs, visibleDurationMs]);

  useEffect(() => {
    animatedClipLayoutByIdRef.current = animatedClipLayoutById;
  }, [animatedClipLayoutById]);

  const startClipLayoutAnimation = useCallback((entries, durationMs = REMOTE_CLIP_ANIMATION_MS) => {
    const normalizedEntries = (entries || [])
      .map((entry) => ({
        clipId: entry?.clipId,
        fromLeft: Number(entry?.fromLeft),
        toLeft: Number(entry?.toLeft),
        fromWidth: Number(entry?.fromWidth),
        toWidth: Number(entry?.toWidth),
      }))
      .filter((entry) => (
        typeof entry.clipId === 'string'
        && Number.isFinite(entry.fromLeft)
        && Number.isFinite(entry.toLeft)
        && Number.isFinite(entry.fromWidth)
        && Number.isFinite(entry.toWidth)
        && (Math.abs(entry.fromLeft - entry.toLeft) > 0.01 || Math.abs(entry.fromWidth - entry.toWidth) > 0.01)
      ));

    if (!normalizedEntries.length) return undefined;

    if (clipAnimationFrameRef.current) {
      cancelAnimationFrame(clipAnimationFrameRef.current);
      clipAnimationFrameRef.current = null;
    }

    setAnimatedClipLayoutById((previous) => {
      const next = { ...previous };
      normalizedEntries.forEach((entry) => {
        next[entry.clipId] = {
          left: entry.fromLeft,
          width: entry.fromWidth,
        };
      });
      return next;
    });

    const startAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startAt) / durationMs);
      const eased = easeInOutQuint(progress);

      setAnimatedClipLayoutById((previous) => {
        const next = { ...previous };
        normalizedEntries.forEach((entry) => {
          next[entry.clipId] = {
            left: entry.fromLeft + ((entry.toLeft - entry.fromLeft) * eased),
            width: entry.fromWidth + ((entry.toWidth - entry.fromWidth) * eased),
          };
        });
        return next;
      });

      if (progress < 1) {
        clipAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }

      clipAnimationFrameRef.current = null;
      setAnimatedClipLayoutById((previous) => {
        const next = { ...previous };
        normalizedEntries.forEach((entry) => {
          delete next[entry.clipId];
        });
        return next;
      });
    };

    clipAnimationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (clipAnimationFrameRef.current) {
        cancelAnimationFrame(clipAnimationFrameRef.current);
        clipAnimationFrameRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!remoteAnimation?.token) return;

    const clipValueById = remoteAnimation?.clipValueById || {};
    const durationMs = Number(remoteAnimation.durationMs || REMOTE_CLIP_ANIMATION_MS);
    const entries = [];

    Object.entries(clipValueById).forEach(([clipId, values]) => {
      const fromWidthMs = Math.max(0, Number(values?.fromCropEndMs || 0) - Number(values?.fromCropStartMs || 0));
      const toWidthMs = Math.max(0, Number(values?.toCropEndMs || 0) - Number(values?.toCropStartMs || 0));
      const inFlight = animatedClipLayoutByIdRef.current[clipId];
      const fromLeft = Number.isFinite(inFlight?.left)
        ? inFlight.left
        : (Number(values?.fromTimelineStartMs || 0) * pixelsPerMs);
      const fromWidth = Number.isFinite(inFlight?.width)
        ? inFlight.width
        : (fromWidthMs * pixelsPerMs);
      const toLeft = Number(values?.toTimelineStartMs || 0) * pixelsPerMs;
      const toWidth = toWidthMs * pixelsPerMs;
      if (Math.abs(fromLeft - toLeft) <= 0.01 && Math.abs(fromWidth - toWidth) <= 0.01) {
        return;
      }
      entries.push({
        clipId,
        fromLeft,
        toLeft,
        fromWidth,
        toWidth,
      });
    });

    if (!entries.length) return;
    return startClipLayoutAnimation(entries, durationMs);
  }, [remoteAnimation?.token, pixelsPerMs, startClipLayoutAnimation]);

  useEffect(() => () => {
    if (clipAnimationFrameRef.current) {
      cancelAnimationFrame(clipAnimationFrameRef.current);
      clipAnimationFrameRef.current = null;
    }
  }, []);

  const getTimelineContentPoint = (clientX, clientY) => {
    const scrollElement = tracksScrollRef.current;
    if (!scrollElement) return null;
    const rect = scrollElement.getBoundingClientRect();
    return {
      x: clientX - rect.left + logicalScrollLeft(),
      y: clientY - rect.top + scrollElement.scrollTop,
    };
  };

  const getSelectionRect = (state) => {
    const left = Math.min(state.startX, state.currentX);
    const right = Math.max(state.startX, state.currentX);
    const top = Math.min(state.startY, state.currentY);
    const bottom = Math.max(state.startY, state.currentY);
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  };

  const getClipIdsInSelectionRect = (selectionRect) => {
    const selectedIds = [];
    timelineRows.forEach((row, rowIndex) => {
      if (row.kind !== 'track' || !row.track) return;
      const trackY = rowTops[rowIndex];
      const clipPadding = 8;
      const clipTop = trackY + clipPadding;
      const clipBottom = clipTop + Math.max(0, row.height - (clipPadding * 2));
      if (clipBottom < selectionRect.top || clipTop > selectionRect.bottom) return;

      row.track.clips.forEach((clip) => {
        const clipLeft = clip.timelineStartMs * pixelsPerMs;
        const clipRight = clipLeft + (getClipDurationMs(clip) * pixelsPerMs);
        const intersects = (
          clipRight >= selectionRect.left &&
          clipLeft <= selectionRect.right &&
          clipBottom >= selectionRect.top &&
          clipTop <= selectionRect.bottom
        );
        if (intersects) {
          selectedIds.push(clip.id);
        }
      });
    });
    return selectedIds;
  };

  const handleNativeDragStart = (e) => {
    e.preventDefault();
  };

  const handleTimelineMouseDown = (e) => {
    if (e.button !== 0 || dragState) return;
    clearSelectedLyrics();
    e.preventDefault();
    const point = getTimelineContentPoint(e.clientX, e.clientY);
    if (!point) return;

    cancelledGestureRef.current = false;
    const nextState = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false,
    };
    timelineSelectionRef.current = nextState;
    setTimelineSelectionState(nextState);
  };

  const handleClipClick = (e, clip, trackId) => {
    e.stopPropagation();
    clearSelectedLyrics();
    const clipId = clip.id;
    const isToggleSelect = isPrimaryModifierPressed(e) && !e.shiftKey;
    const isRangeSelect = e.shiftKey;

    if (isRangeSelect) {
      const anchorClipId = getLastSelectedFromHistory(selectedClipIds, selectedClipHistory) || selectedClipId || clipId;
      const rangeSelected = getShiftRangeSelection(anchorClipId, clipId);
      const nextSelected = Array.from(new Set([...selectedClipIds, ...rangeSelected]));
      const nextHistory = [
        ...selectedClipHistory.filter((id) => nextSelected.includes(id) && id !== clipId),
        ...rangeSelected.filter((id) => id !== clipId && !selectedClipHistory.includes(id)),
        clipId,
      ];
      setSelectedClipIds(nextSelected);
      setSelectedClipHistory(nextHistory);
      setSelectedClipId(clipId);
    } else if (isToggleSelect) {
      const isSelected = selectedClipIds.includes(clipId);
      const nextSelected = isSelected
        ? selectedClipIds.filter((id) => id !== clipId)
        : [...selectedClipIds, clipId];
      const nextHistory = isSelected
        ? selectedClipHistory.filter((id) => id !== clipId)
        : [...selectedClipHistory.filter((id) => id !== clipId), clipId];
      setSelectedClipIds(nextSelected);
      setSelectedClipHistory(nextHistory);
      setSelectedClipId(getLastSelectedFromHistory(nextSelected, nextHistory));
    } else {
      setSelectedClipIds([clipId]);
      setSelectedClipHistory([clipId]);
      setSelectedClipId(clipId);
    }

    const row = trackRowByTrackId.get(trackId);
    if (row) {
      selectRow(row);
    } else {
      onSelectTrack(trackId);
    }

    if (
      typeof onReloadMissingMedia === 'function'
      && isClipMediaMissing(clip, missingMediaBlobIds, audioManager.mediaCache)
    ) {
      onReloadMissingMedia(clip.blobId);
    }
  };

  const handleClipKeyDown = (event, clip, trackId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      handleClipClick(event, clip, trackId);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || advancedMixLocked || !isTrackEditable(trackId)) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (!event.altKey && event.shiftKey ? 10 : 1);
    const patchFor = (current) => event.altKey
      ? event.shiftKey ? { cropEndMs: current.cropEndMs + delta }
        : { cropStartMs: current.cropStartMs + delta, timelineStartMs: current.timelineStartMs + delta }
      : { timelineStartMs: current.timelineStartMs + delta };
    if (applyClipPatches(project, { [clip.id]: patchFor(clip) }, {}, { canEditTrack: isTrackEditable }) === project) return;
    updateProject((current) => {
      if (current.projectId !== project.projectId) return current;
      const latest = current.tracks.find((track) => track.id === trackId)?.clips.find((entry) => entry.id === clip.id);
      return latest ? applyClipPatches(current, { [clip.id]: patchFor(latest) }, {}, { canEditTrack: isTrackEditable }) : current;
    }, event.altKey ? 'Trim clip with keyboard' : 'Move clip with keyboard');
  };

  const handleClipRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClipMouseDown = (e, clip, track) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 0) clearSelectedLyrics();

    if (e.button === 0 && (e.shiftKey || isPrimaryModifierPressed(e))) {
      const row = trackRowByTrackId.get(track.id);
      if (row) {
        selectRow(row);
      } else {
        onSelectTrack(track.id);
      }
      return;
    }

    const selectClickedClip = () => {
      if (!selectedClipIdSet.has(clip.id)) {
        setSelectedClipIds([clip.id]);
        setSelectedClipHistory([clip.id]);
        setSelectedClipId(clip.id);
      }
      const row = trackRowByTrackId.get(track.id);
      if (row) {
        selectRow(row);
      } else {
        onSelectTrack(track.id);
      }
    };

    if (advancedMixLocked && e.button !== 2) {
      selectClickedClip();
      return;
    }
    if (!isTrackEditable(track.id)) {
      selectClickedClip();
      return;
    }

    const rect = tracksScrollRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left + logicalScrollLeft() - clip.timelineStartMs * pixelsPerMs;
    const clipWidthPx = (clip.cropEndMs - clip.cropStartMs) * pixelsPerMs;

    const edgeThreshold = 12; // Match the w-3 (12px) hover zone width
    let dragType = 'move';

    const isOnLeftEdge = offsetX < edgeThreshold;
    const isOnRightEdge = offsetX > clipWidthPx - edgeThreshold;
    const isOnEdge = isOnLeftEdge || isOnRightEdge;

    if (advancedMixLocked && e.button === 2) {
      dragType = 'gain';
      rightClickDragRef.current = false;
    } else if (isOnEdge && e.button !== 0) {
      // Cropping requires left-click on edges. Right-click on edges does nothing.
      return;
    } else if (isOnLeftEdge) {
      dragType = 'crop-start';
    } else if (isOnRightEdge) {
      dragType = 'crop-end';
    } else if (e.button === 2) {
      dragType = 'gain';
      rightClickDragRef.current = false;
    }

    const activeClipIds = getActiveSelectionForClip(clip.id);
    const activeEntries = getSelectedClipEntries(activeClipIds);
    const initialByClipId = {};
    const initialTrackRowByClipId = {};
    activeEntries.forEach((entry) => {
      initialByClipId[entry.clip.id] = {
        trackId: entry.trackId,
        timelineStartMs: entry.clip.timelineStartMs,
        cropStartMs: entry.clip.cropStartMs,
        cropEndMs: entry.clip.cropEndMs,
        sourceDurationMs: entry.clip.sourceDurationMs,
        blobId: entry.clip.blobId,
        gainDb: entry.clip.gainDb,
      };
      initialTrackRowByClipId[entry.clip.id] = entry.trackRowIndex;
    });
    const clickedRowIndex = visibleTrackIndexByTrackId.get(track.id) ?? 0;

    cancelledGestureRef.current = false;
    setDragState({
      projectId: project.projectId,
      startTimeMs: (e.clientX - tracksScrollRef.current.getBoundingClientRect().left + logicalScrollLeft()) / pixelsPerMs,
      type: dragType,
      clipId: clip.id,
      trackId: track.id,
      startX: e.clientX,
      startY: e.clientY,
      initialTimelineStartMs: clip.timelineStartMs,
      initialCropStartMs: clip.cropStartMs,
      initialCropEndMs: clip.cropEndMs,
      initialGainDb: clip.gainDb,
      initialGainPosition: clipGainDbToPosition(clip.gainDb),
      activeClipIds,
      mediaBuffers: activeEntries.map(({ clip: entryClip }) => [entryClip.blobId, audioManager.mediaCache.get(entryClip.blobId)]),
      initialByClipId,
      initialTrackRowByClipId,
      clickedRowIndex,
      trackRowOffset: 0,
      sourceDurationMs: clip.sourceDurationMs,  // Store for validation during drag
    });
    setDragPreview(null);
    dragPreviewRef.current = null;

    selectClickedClip();
  };

  const getTrackRowAtClientY = (clientY) => {
    const timelineElement = timelineRef.current;
    const scrollElement = tracksScrollRef.current;
    if (!timelineElement || !scrollElement) return null;

    const rect = scrollElement.getBoundingClientRect();
    const yWithinContent = clientY - rect.top + scrollElement.scrollTop;
    if (yWithinContent < 0) return null;

    const row = timelineRows[rowAtY(rowTops, yWithinContent)];
    return row?.kind === 'track' ? row : null;
  };

  const getDragActionLabel = (state) => {
    const count = state?.activeClipIds?.length || 1;
    if (state?.type === 'move') return count > 1 ? 'Move clips' : 'Move clip';
    if (state?.type === 'crop-start') return count > 1 ? 'Crop clips start' : 'Crop clip start';
    if (state?.type === 'crop-end') return count > 1 ? 'Crop clips end' : 'Crop clip end';
    if (state?.type === 'gain') return count > 1 ? 'Adjust clip gains' : 'Adjust clip gain';
    return 'Update clips';
  };

  const buildDragPreviewAtPointer = (state, clientX, clientY) => {
    if (advancedMixLocked && state?.type !== 'gain') return null;

    const deltaY = clientY - state.startY;
    const element = tracksScrollRef.current;
    const pointerTimeMs = (clientX - element.getBoundingClientRect().left + logicalScrollLeft()) / pixelsPerMs;
    const deltaMs = pointerTimeMs - state.startTimeMs;

    const track = project.tracks.find((t) => t.id === state.trackId);
    if (!track) return null;

    const currentClip = track.clips.find((c) => c.id === state.clipId);
    if (!currentClip) return null;

    const activeClipIds = state.activeClipIds?.length ? state.activeClipIds : [state.clipId];
    const activeClipIdSet = new Set(activeClipIds);
    const initialByClipId = state.initialByClipId || {
      [state.clipId]: {
        trackId: state.trackId,
        timelineStartMs: state.initialTimelineStartMs,
        cropStartMs: state.initialCropStartMs,
        cropEndMs: state.initialCropEndMs,
        sourceDurationMs: state.sourceDurationMs,
        gainDb: state.initialGainDb,
      },
    };

    const preview = {
      type: state.type,
      clipPatchesById: {},
      targetTrackIdByClipId: {},
      clickedTargetTrackId: state.trackId,
    };

    if (state.type === 'move') {
      const desiredDeltaMs = deltaMs;

      const computeCandidatesForOffset = (rowOffset) => {
        const candidates = [];
        for (const clipId of activeClipIds) {
          const initial = initialByClipId[clipId];
          const current = clipLocationById.get(clipId);
          if (!initial || !current) return null;
          const initialRowIndex = state.initialTrackRowByClipId?.[clipId];
          if (initialRowIndex === undefined) return null;
          const targetRowIndex = initialRowIndex + rowOffset;
          const targetTrackId = visibleTrackIdByRowIndex.get(targetRowIndex);
          if (!targetTrackId) return null;
          candidates.push({
            clipId,
            targetTrackId,
            clip: {
              ...current.clip,
              timelineStartMs: initial.timelineStartMs + desiredDeltaMs,
            },
          });
        }
        return candidates;
      };

      let desiredRowOffset = dragPreviewRef.current?.trackRowOffset ?? state.trackRowOffset ?? 0;
      const hoveredRow = getTrackRowAtClientY(clientY);
      if (hoveredRow?.trackId) {
        const hoveredIndex = visibleTrackIndexByTrackId.get(hoveredRow.trackId);
        if (hoveredIndex !== undefined) {
          desiredRowOffset = hoveredIndex - (state.clickedRowIndex ?? 0);
        }
      }

      let candidateEntries = computeCandidatesForOffset(desiredRowOffset);
      let appliedRowOffset = desiredRowOffset;
      if (!candidateEntries) {
        appliedRowOffset = dragPreviewRef.current?.trackRowOffset ?? state.trackRowOffset ?? 0;
        candidateEntries = computeCandidatesForOffset(appliedRowOffset);
      }
      if (!candidateEntries) return null;

      const staticClipsByTrack = new Map();
      project.tracks.forEach((candidateTrack) => {
        staticClipsByTrack.set(
          candidateTrack.id,
          candidateTrack.clips.filter((clip) => !activeClipIdSet.has(clip.id))
        );
      });

      const candidateByTrack = new Map();
      candidateEntries.forEach((entry) => {
        if (!candidateByTrack.has(entry.targetTrackId)) {
          candidateByTrack.set(entry.targetTrackId, []);
        }
        candidateByTrack.get(entry.targetTrackId).push(entry.clip);
      });

      let valid = true;
      for (const entry of candidateEntries) {
        if (entry.clip.timelineStartMs < 0) {
          valid = false;
          break;
        }
      }

      if (valid) {
        for (const [targetTrackId, movingClips] of candidateByTrack.entries()) {
          const sortedMoving = [...movingClips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
          for (let i = 1; i < sortedMoving.length; i += 1) {
            const previous = sortedMoving[i - 1];
            const current = sortedMoving[i];
            const previousEnd = previous.timelineStartMs + getClipDurationMs(previous);
            if (current.timelineStartMs < previousEnd) {
              valid = false;
              break;
            }
          }
          if (!valid) break;

          const staticClips = staticClipsByTrack.get(targetTrackId) || [];
          for (const movingClip of movingClips) {
            if (!canAddClip(movingClip, staticClips)) {
              valid = false;
              break;
            }
          }
          if (!valid) break;
        }
      }

      if (!valid) return null;

      candidateEntries.forEach((entry) => {
        preview.clipPatchesById[entry.clipId] = {
          timelineStartMs: entry.clip.timelineStartMs,
        };
        preview.targetTrackIdByClipId[entry.clipId] = entry.targetTrackId;
      });

      const clickedCandidate = candidateEntries.find((entry) => entry.clipId === state.clipId);
      if (clickedCandidate) {
        preview.clickedTargetTrackId = clickedCandidate.targetTrackId;
      }
      preview.trackRowOffset = appliedRowOffset;
      return preview;
    }

    if (state.type === 'crop-start') {
      if (activeClipIds.length > 1) {
        const desiredDeltaMs = deltaMs;
        let minAllowedDelta = -Infinity;
        let maxAllowedDelta = Infinity;
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          minAllowedDelta = Math.max(minAllowedDelta, -initial.cropStartMs, -initial.timelineStartMs);
          maxAllowedDelta = Math.min(
            maxAllowedDelta,
            initial.cropEndMs - MIN_CLIP_DURATION_MS - initial.cropStartMs
          );
        });
        const appliedDeltaMs = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, desiredDeltaMs));
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          preview.clipPatchesById[clipId] = {
            cropStartMs: initial.cropStartMs + appliedDeltaMs,
            timelineStartMs: initial.timelineStartMs + appliedDeltaMs,
          };
          preview.targetTrackIdByClipId[clipId] = initial.trackId;
        });
        return preview;
      }

      const proposedCropStartMs = state.initialCropStartMs + deltaMs;
      const constrainedCropStartMs = constrainCropStart(
        { ...currentClip, cropStartMs: state.initialCropStartMs },
        proposedCropStartMs,
        track.clips
      );
      const cropDelta = constrainedCropStartMs - state.initialCropStartMs;
      preview.clipPatchesById[state.clipId] = {
        cropStartMs: constrainedCropStartMs,
        timelineStartMs: state.initialTimelineStartMs + cropDelta,
      };
      preview.targetTrackIdByClipId[state.clipId] = state.trackId;
      return preview;
    }

    if (state.type === 'crop-end') {
      if (activeClipIds.length > 1) {
        const desiredDeltaMs = deltaMs;
        let minAllowedDelta = -Infinity;
        let maxAllowedDelta = Infinity;
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          minAllowedDelta = Math.max(
            minAllowedDelta,
            initial.cropStartMs + MIN_CLIP_DURATION_MS - initial.cropEndMs
          );
          maxAllowedDelta = Math.min(maxAllowedDelta, initial.sourceDurationMs - initial.cropEndMs);
        });
        const appliedDeltaMs = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, desiredDeltaMs));
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          preview.clipPatchesById[clipId] = {
            cropEndMs: initial.cropEndMs + appliedDeltaMs,
          };
          preview.targetTrackIdByClipId[clipId] = initial.trackId;
        });
        return preview;
      }

      const proposedCropEndMs = state.initialCropEndMs + deltaMs;
      const constrainedCropEndMs = constrainCropEnd(
        { ...currentClip, cropEndMs: state.initialCropEndMs, sourceDurationMs: state.sourceDurationMs },
        proposedCropEndMs,
        track.clips
      );
      preview.clipPatchesById[state.clipId] = {
        cropEndMs: constrainedCropEndMs,
      };
      preview.targetTrackIdByClipId[state.clipId] = state.trackId;
      return preview;
    }

    if (state.type === 'gain') {
      const gainDragPixels = 300;
      const distance = Math.min(1, Math.abs(deltaY) / gainDragPixels);
      const shaped = distance * distance * distance;
      const deltaPosition = Math.sign(-deltaY) * shaped;
      const nextPosition = Math.max(
        0,
        Math.min(1, state.initialGainPosition + deltaPosition)
      );
      const nextGainDb = positionToClipGainDb(nextPosition);

      if (activeClipIds.length > 1) {
        const clickedInitial = initialByClipId[state.clipId]?.gainDb ?? state.initialGainDb;
        const desiredDeltaDb = nextGainDb - clickedInitial;
        let minAllowedDeltaDb = -Infinity;
        let maxAllowedDeltaDb = Infinity;
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          minAllowedDeltaDb = Math.max(minAllowedDeltaDb, MIN_CLIP_GAIN_DB - initial.gainDb);
          maxAllowedDeltaDb = Math.min(maxAllowedDeltaDb, MAX_CLIP_GAIN_DB - initial.gainDb);
        });
        const appliedDeltaDb = Math.max(minAllowedDeltaDb, Math.min(maxAllowedDeltaDb, desiredDeltaDb));
        activeClipIds.forEach((clipId) => {
          const initial = initialByClipId[clipId];
          if (!initial) return;
          const nextDb = Math.max(MIN_CLIP_GAIN_DB, Math.min(MAX_CLIP_GAIN_DB, initial.gainDb + appliedDeltaDb));
          preview.clipPatchesById[clipId] = {
            gainDb: Math.abs(nextDb) < 0.1 ? 0 : nextDb,
          };
          preview.targetTrackIdByClipId[clipId] = initial.trackId;
        });
        return preview;
      }

      const clippedDb = Math.max(MIN_CLIP_GAIN_DB, Math.min(MAX_CLIP_GAIN_DB, nextGainDb));
      preview.clipPatchesById[state.clipId] = {
        gainDb: Math.abs(clippedDb) < 0.1 ? 0 : clippedDb,
      };
      preview.targetTrackIdByClipId[state.clipId] = state.trackId;
      return preview;
    }

    return null;
  };

  const commitDragPreview = (state, preview) => {
    if (!state || !preview || !preview.clipPatchesById || cancelledGestureRef.current || state.projectId !== project.projectId) return;
    if (advancedMixLocked && state.type !== 'gain') return;
    if (state.mediaBuffers?.some(([id, buffer]) => audioManager.mediaCache.get(id) !== buffer)) return;
    const clipPatchesById = preview.clipPatchesById;
    const targetTrackIdByClipId = preview.targetTrackIdByClipId || {};
    const hasChanges = Object.keys(clipPatchesById).length > 0;
    if (!hasChanges) return;

    const options = { baseline: state.initialByClipId, canEditTrack: isTrackEditable, minimumDurationMs: MIN_CLIP_DURATION_MS };
    // Avoid even calling history/autosave for an unchanged or already invalid preview.
    if (applyClipPatches(project, clipPatchesById, targetTrackIdByClipId, options) === project) return;
    updateProject((proj) => proj.projectId !== state.projectId ? proj
      : applyClipPatches(proj, clipPatchesById, targetTrackIdByClipId, options), getDragActionLabel(state));

    if (preview.clickedTargetTrackId) {
      const row = trackRowByTrackId.get(preview.clickedTargetTrackId);
      if (row) selectRow(row);
    }
  };

  useEffect(() => {
    if (!dragState) return;

    const processDragPointerMove = () => {
      dragMoveRafRef.current = null;
      const point = dragMovePointRef.current;
      if (!point) return;

      if (dragState.type === 'gain') {
        const dx = point.clientX - dragState.startX;
        const dy = point.clientY - dragState.startY;
        if (dx !== 0 || dy !== 0) {
          rightClickDragRef.current = true;
        }
      }

      const preview = buildDragPreviewAtPointer(dragState, point.clientX, point.clientY);
      if (!preview) return;
      dragPreviewRef.current = preview;
      setDragPreview(preview);
    };

    const handleMouseMove = (e) => {
      dragMovePointRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = window.requestAnimationFrame(processDragPointerMove);
    };

    const handleMouseUp = (event) => {
      if (cancelledGestureRef.current || dragState.projectId !== project.projectId) return;
      if (dragState.mediaBuffers?.some(([id, buffer]) => audioManager.mediaCache.get(id) !== buffer)) { cancelGestures(); return; }
      if (dragMoveRafRef.current !== null) cancelAnimationFrame(dragMoveRafRef.current);
      dragMovePointRef.current = { clientX: event.clientX, clientY: event.clientY };
      processDragPointerMove();
      if (dragState.type === 'gain') {
        if (!rightClickDragRef.current) {
          const targetClipIds = dragState.activeClipIds?.length
            ? dragState.activeClipIds
            : [dragState.clipId];
          const targetClipIdSet = new Set(targetClipIds);
          const targetClips = [];
          project.tracks.forEach((candidateTrack) => {
            candidateTrack.clips.forEach((candidateClip) => {
              if (targetClipIdSet.has(candidateClip.id)) {
                targetClips.push(candidateClip);
              }
            });
          });
          const shouldMute = !targetClips.every((candidateClip) => candidateClip.muted);
          const patches = Object.fromEntries(targetClipIds.map((id) => [id, { muted: shouldMute }]));
          updateProject((proj) => proj.projectId !== dragState.projectId ? proj : applyClipPatches(proj, patches, {}, {
            baseline: dragState.initialByClipId, canEditTrack: isTrackEditable,
          }), shouldMute ? 'Mute clips' : 'Unmute clips');
        } else {
          commitDragPreview(dragState, dragPreviewRef.current);
        }
        rightClickDragRef.current = false;
      } else {
        commitDragPreview(dragState, dragPreviewRef.current);
      }
      dragPreviewRef.current = null;
      setDragPreview(null);
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      if (dragMoveRafRef.current !== null) {
        window.cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      dragMovePointRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dragState,
    pixelsPerMs,
    project.tracks,
    clipLocationById,
    visibleTrackIdByRowIndex,
    visibleTrackIndexByTrackId,
    trackRowByTrackId,
    timelineRows,
    updateProject,
    isTrackEditable,
    advancedMixLocked,
    project.projectId,
  ]);

  useEffect(() => {
    if (!timelineSelectionState) return;

    const processSelectionPointerMove = () => {
      timelineSelectionRafRef.current = null;
      const pointer = timelineSelectionPointRef.current;
      if (!pointer) return;

      const current = timelineSelectionRef.current;
      if (!current) return;
      const point = getTimelineContentPoint(pointer.clientX, pointer.clientY);
      if (!point) return;

      const movedNow = (
        pointer.clientX !== current.startClientX ||
        pointer.clientY !== current.startClientY
      );
      const next = {
        ...current,
        currentClientX: pointer.clientX,
        currentClientY: pointer.clientY,
        currentX: point.x,
        currentY: point.y,
        moved: current.moved || movedNow,
      };
      if (next.moved) {
        timelineSelectionSuppressClickRef.current = true;
      }
      timelineSelectionRef.current = next;
      setTimelineSelectionState(next);

      if (!next.moved) return;
      const selectionRect = getSelectionRect(next);
      const selectedIds = getClipIdsInSelectionRect(selectionRect);
      setSelectedClipIds(selectedIds);
      setSelectedClipHistory(selectedIds);
      setSelectedClipId(selectedIds[selectedIds.length - 1] || null);
    };

    const handleMouseMove = (e) => {
      timelineSelectionPointRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (timelineSelectionRafRef.current !== null) return;
      timelineSelectionRafRef.current = window.requestAnimationFrame(processSelectionPointerMove);
    };

    const handleMouseUp = (e) => {
      if (cancelledGestureRef.current) return;
      if (timelineSelectionRafRef.current !== null) cancelAnimationFrame(timelineSelectionRafRef.current);
      timelineSelectionPointRef.current = { clientX: e.clientX, clientY: e.clientY };
      processSelectionPointerMove();
      const current = timelineSelectionRef.current;
      if (!current) return;

      const noMovement = (
        !current.moved &&
        e.clientX === current.startClientX &&
        e.clientY === current.startClientY
      );

      if (noMovement) {
        const point = getTimelineContentPoint(e.clientX, e.clientY);
        if (point) {
          const timeMs = point.x / pixelsPerMs;
          if (timeMs >= 0 && timeMs <= (projectDurationMs || minZoomDurationMs)) {
            onSeek(timeMs);
          }
        }
        clearSelectedClips();
      } else {
        timelineSelectionSuppressClickRef.current = true;
      }

      timelineSelectionRef.current = null;
      setTimelineSelectionState(null);
      selectionClickResetRafRef.current = window.requestAnimationFrame(() => {
        selectionClickResetRafRef.current = null;
        timelineSelectionSuppressClickRef.current = false;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      if (timelineSelectionRafRef.current !== null) {
        window.cancelAnimationFrame(timelineSelectionRafRef.current);
        timelineSelectionRafRef.current = null;
      }
      timelineSelectionPointRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    timelineSelectionState,
    timelineRows,
    pixelsPerMs,
    projectDurationMs,
    minZoomDurationMs,
    onSeek,
  ]);

  useEffect(() => {
    if (selectedRowKind === 'group') {
      clearSelectedClips();
    }
  }, [selectedRowKind]);

  useEffect(() => {
    if (!dragState && dragPreviewRef.current) {
      dragPreviewRef.current = null;
      setDragPreview(null);
    }
  }, [dragState]);

  useEffect(() => {
    const validClipIds = new Set();
    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => validClipIds.add(clip.id));
    });

    const nextSelected = selectedClipIds.filter((id) => validClipIds.has(id));
    const nextHistory = selectedClipHistory.filter((id) => validClipIds.has(id));

    if (nextSelected.length !== selectedClipIds.length) {
      setSelectedClipIds(nextSelected);
    }
    if (nextHistory.length !== selectedClipHistory.length) {
      setSelectedClipHistory(nextHistory);
    }

    const fallbackSelectedClipId = getLastSelectedFromHistory(nextSelected, nextHistory);
    if (selectedClipId && !validClipIds.has(selectedClipId)) {
      setSelectedClipId(fallbackSelectedClipId);
      return;
    }
    if (selectedClipId && !nextSelected.includes(selectedClipId)) {
      setSelectedClipId(fallbackSelectedClipId);
    }
  }, [selectedClipId, selectedClipIds, selectedClipHistory, project.tracks]);

  useEffect(() => {
    if (!shortcutsEnabled && !deleteClipShortcutEnabled && !(canEditLyrics && selectedLyricLineIds.length > 0)) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      const hasTrackSelection = selectedRowKind !== 'group' && Boolean(selectedTrackId);
      const selectedTrack = hasTrackSelection ? project.tracks.find(t => t.id === selectedTrackId) : null;
      const selectedEntries = getSelectedClipEntries(selectedClipIds);
      const hasSelectedClips = selectedEntries.length > 0;
      const focusedSelectedEntry = selectedClipId
        ? selectedEntries.find((entry) => entry.clip.id === selectedClipId)
        : null;
      const selectedClip = focusedSelectedEntry?.clip
        || (selectedTrack ? selectedTrack.clips.find(c => c.id === selectedClipId) : null);

      if (canEditLyrics && selectedLyricLineIds.length > 0
        && !e.ctrlKey && !e.metaKey && !e.altKey
        && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault();
        e.stopPropagation();
        navigateLyricSelection(e.code === 'ArrowRight' ? 1 : -1, e.shiftKey);
        return;
      }

      if (canEditLyrics && selectedLyricLineIds.length > 0
        && e.code === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const lineId = focusedLyricLineId || selectedLyricLineIds[selectedLyricLineIds.length - 1];
        const line = (project.lyrics?.lines || []).find((candidate) => candidate.id === lineId);
        if (line) {
          e.preventDefault();
          e.stopPropagation();
          startLyricTextEdit(line);
          return;
        }
      }

      if (!advancedMixLocked && canEditLyrics && selectedLyricLineIds.length > 0
        && (e.code === 'Delete' || e.code === 'Backspace')) {
        e.preventDefault();
        deleteSelectedLyricLines();
        return;
      }

      if (advancedMixLocked && (e.code === 'Delete' || e.code === 'Backspace') && (hasSelectedClips || hasTrackSelection)) {
        e.preventDefault();
        return;
      }

      if (!advancedMixLocked && deleteClipShortcutEnabled && (e.code === 'Delete' || e.code === 'Backspace') && hasSelectedClips) {
        e.preventDefault();
        const selectedIdSet = new Set(selectedClipIds);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.filter((candidateClip) => !selectedIdSet.has(candidateClip.id)),
          })),
        }), 'Delete clips');
        clearSelectedClips();
        return;
      }

      if (!advancedMixLocked && deleteClipShortcutEnabled && (e.code === 'Delete' || e.code === 'Backspace') && !hasSelectedClips && hasTrackSelection) {
        e.preventDefault();
        onDeleteTrackShortcut?.(selectedTrackId);
        return;
      }

      if (!advancedMixLocked && e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && hasSelectedClips) {
        e.preventDefault();
        const selectedIdSet = new Set(selectedClipIds);
        const rightClipIds = [];

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.flatMap((candidateClip) => {
              if (!selectedIdSet.has(candidateClip.id)) return [candidateClip];
              const clipStartMs = candidateClip.timelineStartMs;
              const clipEndMs = candidateClip.timelineStartMs + getClipDurationMs(candidateClip);
              if (currentTimeMs <= clipStartMs || currentTimeMs >= clipEndMs) return [candidateClip];

              const splitOffsetMs = currentTimeMs - clipStartMs;
              const splitCropMs = candidateClip.cropStartMs + splitOffsetMs;
              // The left half keeps its id, so its waveform stays mounted and keeps its pixels.
              const leftClip = {
                ...candidateClip,
                timelineStartMs: clipStartMs,
                cropStartMs: candidateClip.cropStartMs,
                cropEndMs: splitCropMs,
              };
              const rightClip = {
                ...candidateClip,
                id: createId(),
                timelineStartMs: currentTimeMs,
                cropStartMs: splitCropMs,
                cropEndMs: candidateClip.cropEndMs,
              };
              rightClipIds.push(rightClip.id);
              return [leftClip, rightClip];
            }),
          })),
        }), 'Split clips');

        if (rightClipIds.length > 0) {
          setSelectedClipIds(rightClipIds);
          setSelectedClipHistory(rightClipIds);
          setSelectedClipId(rightClipIds[rightClipIds.length - 1]);
        }
        return;
      }

      if (e.code === 'KeyM' && hasTrackSelection) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        if (!isTrackEditable(selectedTrackId)) {
          playErrorBeep();
          return;
        }
        onSelectTrack(selectedTrackId);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map(t =>
            t.id === selectedTrackId ? { ...t, muted: !t.muted } : t
          ),
        }), 'Toggle mute');
        return;
      }

      if (e.code === 'KeyS' && hasTrackSelection) {
        e.preventDefault();
        if (!canSoloTracks || !isTrackEditable(selectedTrackId)) {
          playErrorBeep();
          return;
        }
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        onSelectTrack(selectedTrackId);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map(t =>
            t.id === selectedTrackId ? { ...t, soloed: !t.soloed } : t
          ),
        }), 'Toggle solo');
        return;
      }

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        if (!timelineRows.length) return;
        const currentIndex = selectedNodeId
          ? timelineRows.findIndex((row) => row.nodeId === selectedNodeId)
          : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(
                timelineRows.length - 1,
                Math.max(0, currentIndex + (e.code === 'ArrowDown' ? 1 : -1))
              );
        const nextRow = timelineRows[nextIndex];
        if (nextRow) {
          selectRow(nextRow);
          clearSelectedClips();
        }
        return;
      }

      if (!shortcutsEnabled) return;

      if (advancedMixLocked) {
        if (
          (e.code === 'KeyX' || e.code === 'KeyV' || e.code === 'KeyD')
          && isPrimaryModifierPressed(e)
        ) {
          e.preventDefault();
        }
        return;
      }

      if (e.code === 'KeyX' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const clipIdsToCut = hasSelectedClips
          ? selectedClipIds
          : (selectedClip ? [selectedClip.id] : []);
        const payload = buildClipboardPayload(clipIdsToCut);
        if (!payload) return;
        setClipboardClip(payload);

        const cutIdSet = new Set(clipIdsToCut);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.filter((candidateClip) => !cutIdSet.has(candidateClip.id)),
          })),
        }), 'Cut clips');
        clearSelectedClips();
        return;
      }

      if (e.code === 'KeyC' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const clipIdsToCopy = hasSelectedClips
          ? selectedClipIds
          : (selectedClip ? [selectedClip.id] : []);
        const payload = buildClipboardPayload(clipIdsToCopy);
        if (payload) {
          setClipboardClip(payload);
        }
      }

      if (e.code === 'KeyV' && isPrimaryModifierPressed(e) && clipboardClip && hasTrackSelection) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;

        if (clipboardClip.type === 'single' || clipboardClip.blobId) {
          const singleClip = clipboardClip.type === 'single' ? clipboardClip.clip : clipboardClip;
          const newClip = {
            ...singleClip,
            id: createId(),
            timelineStartMs: currentTimeMs,
          };
          const safePosition = findSafePosition(newClip, track.clips, currentTimeMs);
          if (safePosition !== null) {
            newClip.timelineStartMs = safePosition;
            onUpdateClip(selectedTrackId, null, newClip, 'add');
            setSelectedClipIds([newClip.id]);
            setSelectedClipHistory([newClip.id]);
            setSelectedClipId(newClip.id);
          } else {
            playErrorBeep();
            console.warn('Cannot paste: no space available on track');
          }
          return;
        }

        const anchorTrackIndex = visibleTrackIndexByTrackId.get(selectedTrackId);
        if (anchorTrackIndex === undefined || !Array.isArray(clipboardClip.items)) {
          playErrorBeep();
          return;
        }

        const candidatesByTrack = new Map();
        const pastedIds = [];
        let valid = true;
        for (const item of clipboardClip.items) {
          const targetTrackIndex = anchorTrackIndex + item.trackOffset;
          const targetTrackId = visibleTrackIdByRowIndex.get(targetTrackIndex);
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === targetTrackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const timelineStartMs = currentTimeMs + item.startOffsetMs;
          if (timelineStartMs < 0) {
            valid = false;
            break;
          }
          const newClip = {
            ...item.clip,
            id: createId(),
            timelineStartMs,
          };
          pastedIds.push(newClip.id);
          if (!candidatesByTrack.has(targetTrack.id)) {
            candidatesByTrack.set(targetTrack.id, []);
          }
          candidatesByTrack.get(targetTrack.id).push(newClip);
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        for (const [trackId, newClips] of candidatesByTrack.entries()) {
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === trackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const simulated = [...targetTrack.clips];
          for (const newClip of newClips) {
            if (!canAddClip(newClip, simulated)) {
              valid = false;
              break;
            }
            simulated.push(newClip);
          }
          if (!valid) break;
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => {
            const additions = candidatesByTrack.get(candidateTrack.id) || [];
            if (!additions.length) return candidateTrack;
            return {
              ...candidateTrack,
              clips: [...candidateTrack.clips, ...additions],
            };
          }),
        }), 'Paste clips');
        setSelectedClipIds(pastedIds);
        setSelectedClipHistory(pastedIds);
        setSelectedClipId(pastedIds[pastedIds.length - 1] || null);
        return;
      }

      if (e.code === 'KeyD' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const entries = hasSelectedClips
          ? selectedEntries
          : (selectedClip ? [{ trackId: selectedTrackId, clip: selectedClip }] : []);
        if (!entries.length) return;

        const duplicatesByTrack = new Map();
        const duplicateIds = [];
        let valid = true;
        entries.forEach((entry) => {
          const durationMs = getClipDurationMs(entry.clip);
          const duplicate = {
            ...entry.clip,
            id: createId(),
            timelineStartMs: entry.clip.timelineStartMs + durationMs,
          };
          duplicateIds.push(duplicate.id);
          if (!duplicatesByTrack.has(entry.trackId)) {
            duplicatesByTrack.set(entry.trackId, []);
          }
          duplicatesByTrack.get(entry.trackId).push(duplicate);
        });

        for (const [trackId, duplicates] of duplicatesByTrack.entries()) {
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === trackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const simulated = [...targetTrack.clips];
          for (const duplicate of duplicates) {
            if (!canAddClip(duplicate, simulated)) {
              valid = false;
              break;
            }
            simulated.push(duplicate);
          }
          if (!valid) break;
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => {
            const additions = duplicatesByTrack.get(candidateTrack.id) || [];
            if (!additions.length) return candidateTrack;
            return {
              ...candidateTrack,
              clips: [...candidateTrack.clips, ...additions],
            };
          }),
        }), 'Duplicate clips');
        setSelectedClipIds(duplicateIds);
        setSelectedClipHistory(duplicateIds);
        setSelectedClipId(duplicateIds[duplicateIds.length - 1] || null);
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    shortcutsEnabled,
    deleteClipShortcutEnabled,
    canEditLyrics,
    selectedLyricLineIds,
    focusedLyricLineId,
    advancedMixLocked,
    canSoloTracks,
    isTrackEditable,
    selectedClipId,
    selectedClipIds,
    selectedTrackId,
    selectedNodeId,
    selectedRowKind,
    clipboardClip,
    currentTimeMs,
    project.tracks,
    onUpdateClip,
    onSelectTrack,
    onDeleteTrackShortcut,
    updateProject,
    timelineRows,
    visibleTrackIndexByTrackId,
    visibleTrackIdByRowIndex,
    getSelectedClipEntries,
    buildClipboardPayload,
    clearSelectedClips,
    getClipDurationMs,
    playErrorBeep,
  ]);

  const handleContextMenu = (e) => {
    e.preventDefault();
  };

  const timeFromRulerClientX = (clientX) => {
    const rect = rulerScrollRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollLeftRef.current;
    return Math.max(0, Math.min(x / pixelsPerMs, projectDurationMs || minZoomDurationMs));
  };

  const handleRulerMouseDown = (e) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();

    const timeMs = timeFromRulerClientX(e.clientX);
    const hasLoop = project.loop.startMs !== undefined && project.loop.endMs !== undefined;
    const clickedLoop = hasLoop && timeMs >= project.loop.startMs && timeMs <= project.loop.endMs;

    cancelledGestureRef.current = false;
    setRulerDragState({
      startTimeMs: timeMs,
      startX: e.clientX,
      isDragging: false,
      clickedLoop,
      currentStartMs: timeMs,
      currentEndMs: timeMs,
    });
  };

  const handleLoopMarkerMouseDown = (e, markerType) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return; // Only left click

    cancelledGestureRef.current = false;
    setLoopMarkerDragState({
      markerType, // 'start' or 'end'
      initialStartMs: project.loop.startMs,
      initialEndMs: project.loop.endMs,
    });
  };

  const handleSeekBarMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    cancelledGestureRef.current = false;
    onSeek(timeFromRulerClientX(e.clientX));
    setSeekDragState(true);
  };

  useEffect(() => {
    if (!rulerDragState) return;

    const handleMouseMove = (e) => {
      const pointerMs = timeFromRulerClientX(e.clientX);
      const startMs = Math.min(rulerDragState.startTimeMs, pointerMs);
      const endMs = Math.max(rulerDragState.startTimeMs, pointerMs);
      setRulerDragState((prev) => ({
        ...prev,
        isDragging: prev.isDragging || Math.abs(e.clientX - prev.startX) > 5,
        currentStartMs: startMs,
        currentEndMs: endMs,
      }));
    };

    const handleMouseUp = (e) => {
      if (cancelledGestureRef.current) return;
      const releaseTimeMs = timeFromRulerClientX(e.clientX);
      if (rulerDragState.isDragging || Math.abs(e.clientX - rulerDragState.startX) > 5) {
        const startMs = Math.min(rulerDragState.startTimeMs, releaseTimeMs);
        const endMs = Math.max(rulerDragState.startTimeMs, releaseTimeMs);
        if (endMs - startMs >= 100) {
          updateLoop(() => ({
            enabled: true,
            startMs,
            endMs,
          }), 'Set loop region');
        }
      } else if (rulerDragState.clickedLoop) {
        updateLoop((loop) => ({
          ...loop,
          enabled: !loop.enabled,
        }), 'Toggle loop');
      } else {
        onSeek(rulerDragState.startTimeMs);
      }

      setRulerDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [rulerDragState, pixelsPerMs, scrollLeft, projectDurationMs, minZoomDurationMs, updateLoop]);

  // Handle loop marker dragging
  useEffect(() => {
    if (!loopMarkerDragState) return;

    const handleMouseMove = (e) => {
      const timeMs = timeFromRulerClientX(e.clientX);

      let newStartMs = loopMarkerDragState.initialStartMs;
      let newEndMs = loopMarkerDragState.initialEndMs;

      if (loopMarkerDragState.markerType === 'start') {
        // Dragging start marker - allow crossing past end
        newStartMs = timeMs;
      } else {
        // Dragging end marker - allow crossing past start
        newEndMs = timeMs;
      }

      // Update the drag state to store current values for visual update
      setLoopMarkerDragState(prev => ({
        ...prev,
        currentStartMs: newStartMs,
        currentEndMs: newEndMs,
      }));
    };

    const handleMouseUp = (event) => {
      if (cancelledGestureRef.current) return;
      const timeMs = timeFromRulerClientX(event.clientX);
      const rawStartMs = loopMarkerDragState.markerType === 'start' ? timeMs : loopMarkerDragState.initialStartMs;
      const rawEndMs = loopMarkerDragState.markerType === 'end' ? timeMs : loopMarkerDragState.initialEndMs;
      const finalStartMs = Math.min(rawStartMs, rawEndMs);
      const finalEndMs = Math.max(rawStartMs, rawEndMs);

      // Only create undo entry if values actually changed
      if (finalStartMs !== loopMarkerDragState.initialStartMs ||
          finalEndMs !== loopMarkerDragState.initialEndMs) {
        updateLoop((loop) => ({
          ...loop,
          startMs: finalStartMs,
          endMs: finalEndMs,
        }), 'Adjust loop region');
      }
      setLoopMarkerDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [loopMarkerDragState, pixelsPerMs, scrollLeft, projectDurationMs, minZoomDurationMs, updateLoop]);

  useEffect(() => {
    if (!seekDragState) return undefined;
    const handleMouseMove = (event) => {
      if (!cancelledGestureRef.current) onSeek(timeFromRulerClientX(event.clientX));
    };
    const handleMouseUp = () => setSeekDragState(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [seekDragState, pixelsPerMs, scrollLeft, projectDurationMs, minZoomDurationMs, onSeek]);

  // One listener per disjoint viewport, never on both a child and its ancestor.
  useEffect(() => {
    // The accumulated target outlives re-subscription only while a coalesced update is still queued.
    const wheel = wheelZoomRef.current;
    if (!wheel.pending) wheel.duration = undefined;
    const apply = (zoom) => {
      wheel.pending = false;
      if (!zoom(wheel.duration, wheel.pointerX)) wheel.duration = undefined;
    };
    const flush = () => {
      wheel.frame = null;
      if (wheel.pending) apply(applyZoomRef.current);
    };
    const handleWheel = (event) => {
      const delta = normalizeWheel(event, containerWidth);
      if (isPrimaryModifierPressed(event) || event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        if (dragState || lyricDragRef.current || rulerDragState || loopMarkerDragState) return;
        wheel.pointerX = event.clientX - tracksScrollRef.current.getBoundingClientRect().left;
        wheel.duration = clampDuration((wheel.duration ?? clampedVisibleMs) * Math.exp(delta.y * 0.002), maxZoomDurationMs, minZoomDurationMs);
        // Browsers deliver about one wheel event per frame: render it now, as for discrete input,
        // and coalesce any further events in this frame into one update on the next.
        if (wheel.frame != null) wheel.pending = true;
        else {
          flushSync(() => apply(applyZoomDuration));
          wheel.frame = requestAnimationFrame(flush);
        }
      } else if (event.shiftKey || Math.abs(delta.x) > Math.abs(delta.y)) {
        event.preventDefault();
        event.stopPropagation();
        noteUserScrollRef.current();
        setLogicalScroll(logicalScrollLeft() + (event.shiftKey ? delta.y : delta.x));
      }
    };
    const elements = [tracksScrollRef.current, rulerViewportRef.current].filter(Boolean);
    elements.forEach((element) => element.addEventListener('wheel', handleWheel, { passive: false }));
    return () => elements.forEach((element) => element.removeEventListener('wheel', handleWheel));
  }, [clampedVisibleMs, pixelsPerMs, containerWidth, minZoomDurationMs, maxZoomDurationMs, currentTimeMs,
    dragState, rulerDragState, loopMarkerDragState]);

  const fitProject = () => {
    if (!applyZoomDuration(null, undefined, { timeMs: 0, x: 0 })) return;
    zoomCommitRef.current.anchor = { timeMs: 0, x: 0 };
    pendingZoomAnchorRef.current = { timeMs: 0, x: 0 };
    if (visibleDurationMs === null) setLogicalScroll(0);
  };

  const handleZoomIn = () => {
    const newSliderValue = Math.max(0, zoomSliderValue - 0.1);
    const newDuration = sliderValueToDuration(newSliderValue);
    applyZoomDuration(newDuration);
  };

  const handleZoomOut = () => {
    const newSliderValue = Math.min(1, zoomSliderValue + 0.1);
    if (newSliderValue >= 0.99) {
      applyZoomDuration(null);
    } else {
      const newDuration = sliderValueToDuration(newSliderValue);
      if (newDuration >= minZoomDurationMs * 0.95) {
        applyZoomDuration(null);
      } else {
        applyZoomDuration(newDuration);
      }
    }
  };

  const handleSliderChange = (e) => {
    const uiValue = parseFloat(e.target.value);
    const value = 1 - uiValue;
    if (value >= 0.99) {
      applyZoomDuration(null);
    } else {
      const newDuration = sliderValueToDuration(value);
      if (newDuration >= minZoomDurationMs * 0.95) {
        applyZoomDuration(null);
      } else {
        applyZoomDuration(newDuration);
      }
    }
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!shortcutsEnabled || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); handleZoomIn(); }
      else if (event.key === '-') { event.preventDefault(); handleZoomOut(); }
      else if (event.key === '0') { event.preventDefault(); fitProject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const zoomOverlay = (
    <div className="zoom-minimal-overlay" onMouseDown={(event) => event.stopPropagation()} title="At deep zoom the native scroll rail covers a local segment. Press 0 to fit the project.">
      <div className="zoom-minimal-shell">
        <div className="zoom-minimal-stick" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={zoomSliderUiValue}
          onChange={handleSliderChange}
          className="zoom-minimal-slider"
          title="Timeline zoom"
          aria-label="Timeline zoom"
          aria-valuetext={`${formatVisibleDuration(clampedVisibleMs)} visible`}
        />
      </div>
    </div>
  );

  const lyricsLane = showLyricsLane ? (
    <div
      className="relative h-11 w-full overflow-hidden border-b border-gray-700 bg-gray-900"
      aria-label="Lyrics timeline lane"
      onDoubleClick={(event) => {
        if (!event.shiftKey || !canEditLyrics) return;
        event.preventDefault();
        insertLyricAtPointer(event);
      }}
    >
      <div
        className="absolute inset-y-0"
        style={{ left: `${originPx - scrollLeft}px`, width: `${segmentWidthPx}px` }}
      >
        <div className="absolute inset-0 bg-gray-800/40" />
        {(() => {
          const lyricLines = project.lyrics?.lines || [];
          const placedLines = getPlacedLyricLines(lyricLines);
          const pendingIndex = lyricsSyncActive && canEditLyrics
            ? lyricLines.findIndex((line) => line.startMs == null || line.startMs === '' || !Number.isFinite(Number(line.startMs)))
            : -1;
          const pendingLine = pendingIndex >= 0 ? lyricLines[pendingIndex] : null;
          const pendingStartMs = pendingLine
            ? getLyricPlacementPreviewStart(lyricLines, pendingIndex, currentTimeMs, rawProjectDurationMs)
            : null;
          const displayedPlacedLines = (lyricsSyncActive ? placedLines : [])
            .map((entry) => ({
              ...entry,
              startMs: lyricPreview?.byLineId?.[entry.line.id]?.startMs ?? entry.startMs,
            }))
            .sort((left, right) => left.startMs - right.startMs);
          return (
            <>
              {displayedPlacedLines.map(({ line, startMs }) => {
                const endMs = getLyricLineEndMs(displayedPlacedLines, line.id, rawProjectDurationMs);
                const range = segmentRange(startMs * pixelsPerMs, Math.max(2, (endMs - startMs) * pixelsPerMs));
                const leftPx = range.left;
                const widthPx = range.width;
                const selected = selectedLyricLineIds.includes(line.id);
                const isEditing = editingLyricLineId === line.id;
                return (
                  <div
                    key={line.id}
                    data-lyric-line="true"
                    className={`absolute top-[5px] box-border h-[34px] overflow-hidden rounded border border-indigo-400 bg-indigo-900/80 text-xs shadow-sm ${selected ? 'ring-1 ring-white/80' : ''} ${canEditLyrics ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px`, visibility: widthPx > 0 ? undefined : 'hidden' }}
                    title={line.text || '(empty lyric line)'}
                    onPointerDown={(event) => beginLyricDrag(event, line)}
                    onClick={(event) => selectLyricLine(event, line.id)}
                    onDoubleClick={(event) => handleLyricBarDoubleClick(event, line)}
                  >
                    <div className="flex h-full min-w-0 items-center overflow-hidden px-1.5">
                      {isEditing ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingLyricText}
                          aria-label={`Lyrics for ${line.text || 'lyric line'}`}
                          className="h-full w-full min-w-0 bg-transparent text-xs text-white outline-none"
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onChange={(event) => setEditingLyricText(event.target.value)}
                          onBlur={() => {
                            if (lyricTextEditCancelledRef.current) {
                              lyricTextEditCancelledRef.current = false;
                              setEditingLyricLineId(null);
                              return;
                            }
                            saveLyricText(line.id);
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                              lyricTextEditCancelledRef.current = true;
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-medium"
                          style={{
                            maskImage: 'linear-gradient(to right, black 0, black calc(100% - 14px), transparent 100%)',
                            WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 14px), transparent 100%)',
                          }}
                        >{line.text || <span className="italic opacity-60">Empty line</span>}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {pendingLine && pendingStartMs != null ? (() => {
                const nextPlacedStart = displayedPlacedLines
                  .map((entry) => entry.startMs)
                  .filter((startMs) => startMs > pendingStartMs)
                  .sort((left, right) => left - right)[0] ?? rawProjectDurationMs;
                const endMs = Math.max(pendingStartMs, nextPlacedStart);
                return (
                  <div
                    key="lyrics-placement-preview"
                    className="absolute top-[5px] box-border h-[34px] overflow-hidden rounded border border-dashed border-indigo-200 bg-indigo-950 text-xs text-indigo-100"
                    style={{ left: segmentRange(pendingStartMs * pixelsPerMs, (endMs - pendingStartMs) * pixelsPerMs).left,
                      width: segmentRange(pendingStartMs * pixelsPerMs, (endMs - pendingStartMs) * pixelsPerMs).width }}
                    title={'press "P" to place this line at playhead'}
                  >
                    <div className="flex h-full items-center overflow-hidden px-1.5">
                      <span
                        className="overflow-hidden whitespace-nowrap font-medium"
                        style={{
                          maskImage: 'linear-gradient(to right, black 0, black calc(100% - 14px), transparent 100%)',
                          WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 14px), transparent 100%)',
                        }}
                      >{pendingLine.text || 'Next lyric'}</span>
                    </div>
                  </div>
                );
              })() : null}
            </>
          );
        })()}
      </div>
        <div
          ref={lyricsPlayheadRef}
          data-playhead="lyrics"
          className="pointer-events-none absolute top-0 z-20 h-full w-px bg-gray-200"
          style={{ left: shownPlayheadLeft }}
        />
    </div>
  ) : null;

  const onRulerStep = (timeMs, stepMs) => Math.abs(timeMs - Math.round(timeMs / stepMs) * stepMs) <= stepMs * 0.02;
  const loopRange = (() => {
    if (rulerDragState?.isDragging && rulerDragState.currentStartMs !== undefined && rulerDragState.currentEndMs !== undefined) {
      return { startMs: rulerDragState.currentStartMs, endMs: rulerDragState.currentEndMs, enabled: true };
    }
    if (project.loop.startMs === undefined || project.loop.endMs === undefined) return null;
    return {
      startMs: loopMarkerDragState?.currentStartMs ?? project.loop.startMs,
      endMs: loopMarkerDragState?.currentEndMs ?? project.loop.endMs,
      enabled: Boolean(project.loop.enabled),
    };
  })();
  const loopBandStyle = (startMs, endMs) => {
    const left = viewportX(Math.min(startMs, endMs));
    const right = viewportX(Math.max(startMs, endMs));
    const clippedLeft = Math.max(-2, left);
    const clippedRight = Math.min(containerWidth + 2, right);
    if (clippedRight - clippedLeft <= 0) {
      if (left < -2 || left > containerWidth) return null;
      return { left: `${Math.max(0, Math.min(containerWidth - 2, left))}px`, width: '2px' };
    }
    return { left: `${clippedLeft}px`, width: `${clippedRight - clippedLeft}px` };
  };
  const loopBand = loopRange ? loopBandStyle(loopRange.startMs, loopRange.endMs) : null;

  const rulerTools = (
    <div className="flex h-full w-full items-center justify-between px-1.5">
      <button
        type="button"
        aria-label="Add track"
        title="Add track"
        disabled={!onAddTrack}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-200 hover:bg-gray-700 disabled:invisible"
        onClick={() => onAddTrack?.()}
      >
        <Plus size={16} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        aria-label="Follow playhead"
        title="Follow playhead"
        aria-pressed={followEnabled}
        className={`flex h-6 w-6 items-center justify-center rounded ${followEnabled ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
        onClick={() => setFollowEnabled((enabled) => {
          followEnabledRef.current = !enabled;
          return !enabled;
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.25v11.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4.25 5.2 1.7 8l2.55 2.8M11.75 5.2 14.3 8l-2.55 2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );

  const header = (
    <div ref={rulerViewportRef} className="relative w-full min-w-0 overflow-hidden bg-gray-800" style={{ height: TIMELINE_RULER_HEIGHT }}>
      <div
        ref={rulerScrollRef}
        className="ruler-scrollbar-hidden absolute inset-0 overflow-x-scroll overflow-y-hidden"
        onScroll={(event) => handleNativeScroll(event.currentTarget)}
      >
        <div style={{ width: `${segmentWidthPx}px`, height: 1 }} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gray-800" style={{ height: RULER_LABEL_HEIGHT }} />
      <div
        className="pointer-events-none absolute inset-x-0 bg-gray-900/80"
        style={{ top: RULER_LABEL_HEIGHT, height: RULER_SEEK_HEIGHT }}
      />
      {loopBand ? (
        <div
          className={`pointer-events-none absolute top-0 ${loopRange.enabled ? 'bg-yellow-600' : 'bg-[#121a28]'}`}
          style={{ ...loopBand, height: RULER_LABEL_HEIGHT }}
        />
      ) : null}
      {rulerTicks.map((timeMs) => (
        <div
          key={timeMs}
          data-ruler-tick={timeMs}
          className="pointer-events-none absolute top-0 z-[1] w-px bg-gray-500"
          style={{ left: `${viewportX(timeMs)}px`, height: RULER_LABEL_HEIGHT + 14 }}
        >
          <span className="absolute left-1 top-2 select-none whitespace-nowrap text-[11px] leading-none text-gray-200" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.9)' }}>
            {formatRulerLabel(timeMs, ruler.majorMs, ruler.unit, sampleRate)}
          </span>
        </div>
      ))}
      {rulerFractions.map((timeMs) => (
        onRulerStep(timeMs, ruler.majorMs) ? null : (
          <div
            key={timeMs}
            data-ruler-fraction={timeMs}
            className="pointer-events-none absolute z-[1] w-px bg-gray-500"
            style={{
              left: `${viewportX(timeMs)}px`,
              top: RULER_LABEL_HEIGHT,
              height: onRulerStep(timeMs, ruler.minorMs) ? 8 : 4,
              opacity: 0.7,
            }}
          />
        )
      ))}
      <div
        ref={rulerPlayheadRef}
        data-playhead="ruler"
        className="pointer-events-none absolute z-10 w-px"
        style={{
          left: shownPlayheadLeft,
          top: RULER_LABEL_HEIGHT,
          height: RULER_SEEK_HEIGHT,
        }}
      >
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2"
          style={{ left: '0.5px', width: 15, height: 16 }}
        >
          <svg
            width="15"
            height="16"
            viewBox="0 0 15 16"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}
          >
            <polygon
              points="0.5,0.5 14.5,0.5 14.5,8.5 7.5,15.5 0.5,8.5"
              fill="#e5e7eb"
              stroke="#374151"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="h-full w-px bg-gray-200" />
      </div>
      <div
        data-ruler-labels
        data-ruler-unit={ruler.unit}
        className="absolute inset-x-0 top-0 cursor-pointer"
        style={{ height: RULER_LABEL_HEIGHT }}
        onMouseDown={handleRulerMouseDown}
        onDragStart={handleNativeDragStart}
      >
        {rulerDragState?.isDragging && rulerDragState.currentStartMs !== undefined ? (
          <div
            data-loop-preview="start"
            className="pointer-events-none absolute top-0 h-px w-px"
            style={{ left: `${viewportX(rulerDragState.currentStartMs)}px` }}
          />
        ) : null}
        {rulerDragState?.isDragging && rulerDragState.currentEndMs !== undefined ? (
          <div
            data-loop-preview="end"
            className="pointer-events-none absolute top-0 h-px w-px"
            style={{ left: `${viewportX(rulerDragState.currentEndMs)}px` }}
          />
        ) : null}
        {!rulerDragState?.isDragging && project.loop.startMs !== undefined && project.loop.endMs !== undefined ? (
          <>
            <div
              className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-ew-resize bg-transparent"
              style={{ left: `${viewportX(loopMarkerDragState?.currentStartMs ?? project.loop.startMs)}px` }}
              data-loop-marker="start"
              aria-label="Loop start marker"
              onMouseDown={(e) => handleLoopMarkerMouseDown(e, 'start')}
            />
            <div
              className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-ew-resize bg-transparent"
              style={{ left: `${viewportX(loopMarkerDragState?.currentEndMs ?? project.loop.endMs)}px` }}
              data-loop-marker="end"
              aria-label="Loop end marker"
              onMouseDown={(e) => handleLoopMarkerMouseDown(e, 'end')}
            />
          </>
        ) : null}
      </div>
      <div
        data-ruler-seek
        className="absolute inset-x-0 cursor-pointer"
        style={{ top: RULER_LABEL_HEIGHT, height: RULER_SEEK_HEIGHT }}
        onMouseDown={handleSeekBarMouseDown}
      />
    </div>
  );

  const tracks = (
    <div
      ref={timelineRef}
      className={`${sharedVerticalScroll ? 'relative' : 'flex-1 overflow-hidden relative'} h-full bg-gray-900 w-full min-w-0`}
      onMouseDown={handleTimelineMouseDown}
      onDragStart={handleNativeDragStart}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={(el) => {
          tracksScrollRef.current = el;
          if (internalScrollRef) {
            internalScrollRef.current = el;
          }
        }}
        data-timeline-scroll="true"
        aria-label="Timeline tracks"
        className={`${sharedVerticalScroll ? 'h-full overflow-x-auto overflow-y-hidden' : 'absolute inset-0 overflow-auto'} scrollbar-hidden w-full min-w-0 overscroll-none`}
        style={{ overscrollBehavior: 'none', overscrollBehaviorY: 'none' }}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 0) {
            event.currentTarget.scrollTop = 0;
          }
          handleNativeScroll(event.currentTarget);
          if (!sharedVerticalScroll) onVerticalScroll?.(event.currentTarget.scrollTop);
        }}
      >
        <div style={{ width: `${segmentWidthPx}px`, height: `${totalTimelineHeight}px`, minHeight: '100%', position: 'relative', overflow: 'clip' }}>
              {timelineSelectionState?.moved && (() => {
                const selectionRect = getSelectionRect(timelineSelectionState);
                return (
                  <div
                    className="absolute pointer-events-none z-40 border border-blue-400 bg-blue-500/20"
                    style={{
                      left: segmentRange(selectionRect.left, selectionRect.width).left,
                      top: `${selectionRect.top}px`,
                      width: segmentRange(selectionRect.left, selectionRect.width).width,
                      height: `${selectionRect.height}px`,
                    }}
                  />
                );
              })()}
              {timelineRows.map((row, rowIndex) => {
                const trackY = rowTops[rowIndex];
                const measuredRows = verticalViewport.height > 0;
                const rowVisible = measuredRows && intersectsViewport(trackY, row.height, verticalViewport.top, verticalViewport.height);
                const rowOnScreen = measuredRows && intersectsViewport(trackY, row.height, verticalViewport.top, verticalViewport.height, 0);
                // Shells are mounted one viewport beyond each edge; an unmeasured viewport mounts every row.
                const rowNear = !measuredRows
                  || intersectsViewport(trackY, row.height, verticalViewport.top, verticalViewport.height, verticalViewport.height);
                const shellNear = (left, width) => rowNear && intersectsViewport(left, width, scrollLeft, containerWidth, containerWidth);
                // Clips around the return-to-start view stay mounted so their waveforms are painted before the jump.
                const returnNear = (left, width) => intersectsViewport(left, width, returnScrollLeft, containerWidth, containerWidth);
                if (row.kind === 'group') {
                  const groupPreview = groupTimelinePreviewByNodeId.get(row.nodeId);
                  const rowPadding = 8;
                  const rowInternalHeight = Math.max(0, row.height - (rowPadding * 2));
                  return (
                    <div
                      key={row.nodeId}
                      className="border-b border-gray-700 relative bg-gray-900/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (timelineSelectionSuppressClickRef.current) return;
                        selectRow(row);
                        clearSelectedClips();
                      }}
                      style={{
                        height: `${row.height}px`,
                        top: `${trackY}px`,
                        position: 'absolute',
                        width: '100%',
                      }}
                    >
                      {groupPreview?.activeSegments?.map((segment, idx) => {
                        if (!shellNear(segment.startMs * pixelsPerMs, (segment.endMs - segment.startMs) * pixelsPerMs)) return null;
                        const range = segmentRange(segment.startMs * pixelsPerMs, (segment.endMs - segment.startMs) * pixelsPerMs);
                        const leftPx = range.left;
                        const widthPx = range.width;
                        if (!widthPx) return null;
                        return (
                          <div
                            key={`group-segment-${row.nodeId}-${idx}`}
                            className="absolute rounded pointer-events-none"
                            style={{
                              left: `${leftPx}px`,
                              top: `${rowPadding}px`,
                              width: `${widthPx}px`,
                              height: `${rowInternalHeight}px`,
                              backgroundColor: 'rgba(79, 142, 247, 0.18)',
                            }}
                          />
                        );
                      })}

                      {measuredRows && (rowOnScreen || rowNear) && <div className="absolute inset-x-0 pointer-events-none" style={{ top: rowPadding }}>
                        <GroupWaveform clips={groupSurfaceClipsByNodeId.get(row.nodeId)} pixelsPerMs={pixelsPerMs}
                          bitmapKey={`group:${row.nodeId}`}
                          viewportLeftPx={scrollLeft - originPx} viewportWidthPx={containerWidth} height={rowInternalHeight}
                          returnViewportLeftPx={startViewportLeftPx} scheduleTier={rowOnScreen ? 0 : 2}
                          globalPeakAmplitude={globalPeakAmplitude} displayMode={displayMode}
                          showRms={showRms} showClipping={showClipping} stereo={stereo} missingMediaBlobIds={missingMediaBlobIds} />
                      </div>}

                    </div>
                  );
                }

                const track = row.track;
                const trackHeight = row.height;
                const trackState = trackStateById.get(track.id);
                const trackClips = renderedClipsByTrackId.get(track.id) || track.clips;
                const hasAnyAudibleClip = trackClips.some((clip) => !clip.muted);
                const trackInactive = Boolean(
                  !trackState?.audible || (trackClips.length > 0 && !hasAnyAudibleClip)
                );

                return (
                  <div
                    key={track.id}
                    className={`border-b border-gray-700 relative ${trackInactive ? 'bg-gray-850' : ''}`}
                    style={{
                      height: `${trackHeight}px`,
                      top: `${trackY}px`,
                      position: 'absolute',
                      width: '100%'
                    }}
                  >
                    {trackClips.map(clip => {
                      const clipDurationMs = clip.cropEndMs - clip.cropStartMs;
                      const animatedClipLayout = (!dragState && !dragPreview)
                        ? animatedClipLayoutById[clip.id]
                        : null;
                      const clipWidthPx = Number.isFinite(animatedClipLayout?.width)
                        ? animatedClipLayout.width
                        : (clipDurationMs * pixelsPerMs);
                      const clipLeftPx = Number.isFinite(animatedClipLayout?.left)
                        ? animatedClipLayout.left
                        : (clip.timelineStartMs * pixelsPerMs);
                      if (!shellNear(clipLeftPx, clipWidthPx) && !(rowNear && returnNear(clipLeftPx, clipWidthPx))
                        && clip.id !== focusedClipId && clip.id !== dragState?.clipId) return null;
                      const shell = segmentRange(clipLeftPx, clipWidthPx);
                      const drawScale = clipWidthPx / clipDurationMs;
                      const drawCropStartMs = clip.cropStartMs + shell.skipped / drawScale;
                      const audioBuffer = audioManager.mediaCache.get(clip.blobId);
                      const missingMedia = isClipMediaMissing(clip, missingMediaBlobIds, audioManager.mediaCache);
                      const clipPadding = 8;
                      const clipInternalHeight = trackHeight - (clipPadding * 2);
                      const labelPadding = 8;
                      const gainLabelText = `${clip.gainDb > 0 ? '+' : ''}${clip.gainDb.toFixed(1)} dB`;
                      const estimatedLabelWidth = gainLabelText.length * 7;
                      const clipRightPx = clipLeftPx + clipWidthPx;
                      const visibleLeftPx = Math.max(clipLeftPx, scrollLeft);
                      const visibleRightPx = Math.min(clipRightPx, scrollLeft + containerWidth);
                      const visibleWidthPx = Math.max(0, visibleRightPx - visibleLeftPx);
                      const labelFits = visibleWidthPx >= estimatedLabelWidth + (labelPadding * 2);
                      const clipOnScreen = rowOnScreen && intersectsViewport(clipLeftPx, clipWidthPx, scrollLeft, containerWidth, 0);
                      const clipSide = intersectsViewport(clipLeftPx, clipWidthPx, scrollLeft, containerWidth, containerWidth);
                      const waveformTier = clipOnScreen ? 0 : rowOnScreen && clipSide ? 1 : clipSide ? 2 : 3;

                      return (
                        <div
                          key={clip.id}
                          data-clip-id={clip.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Audio clip ${clip.name || clip.id}. Arrow keys move by 1ms, Shift by 10ms; Alt trims start, Alt Shift trims end.`}
                          aria-pressed={selectedClipIdSet.has(clip.id)}
                          onKeyDown={(event) => handleClipKeyDown(event, clip, track.id)}
                          onFocus={() => setFocusedClipId(clip.id)}
                          onBlur={() => setFocusedClipId((id) => (id === clip.id ? null : id))}
                          title={
                            missingMedia
                              ? 'Missing media — click to reload'
                              : (!advancedMixLocked && !isTrackEditable(track.id) ? trackAccessTitle(track.id) : undefined)
                          }
                          className={`absolute rounded overflow-clip ${
                            selectedClipIds.includes(clip.id)
                              ? (missingMedia ? 'ring-2 ring-red-500' : 'ring-2 ring-blue-500')
                              : (missingMedia ? 'hover:ring-2 hover:ring-red-400' : 'hover:ring-2 hover:ring-gray-500')
                          }`}
                          style={{
                            display: shell.width > 0 ? undefined : 'none',
                            left: `${shell.left}px`,
                            top: `${clipPadding}px`,
                            width: `${shell.width}px`,
                            height: `${clipInternalHeight}px`,
                            backgroundColor: missingMedia ? MISSING_CLIP_BACKGROUND_COLOR : CLIP_BACKGROUND_COLOR,
                          }}
                          onClick={(e) => handleClipClick(e, clip, track.id)}
                          onMouseDown={(e) => handleClipMouseDown(e, clip, track)}
                          onDragStart={handleNativeDragStart}
                          onContextMenu={handleClipRightClick}
                        >
                          <div
                            className={`absolute inset-0 ${advancedMixLocked || !isTrackEditable(track.id) ? 'cursor-default' : 'cursor-move'}`}
                            style={{
                              pointerEvents: 'none',
                              zIndex: 1,
                            }}
                          />
                          {/* On-screen clips first, then one viewport left and right, then rows above and below.
                              The start view stays mounted and is painted last, after a zoom or a loop change. */}
                          {measuredRows && (rowOnScreen || rowNear) && (intersectsViewport(clipLeftPx, clipWidthPx, scrollLeft, containerWidth, containerWidth)
                            || returnNear(clipLeftPx, clipWidthPx)) && (
                            <Waveform
                              audioBuffer={audioBuffer}
                              blobId={clip.blobId}
                              pixelsPerMs={drawScale}
                              clipLeftPx={shell.left}
                              clipWidthPx={shell.width}
                              viewportLeftPx={scrollLeft - originPx}
                              viewportWidthPx={containerWidth}
                              returnViewportLeftPx={startViewportLeftPx}
                              scheduleTier={waveformTier}
                              displayMode={displayMode}
                              showRms={showRms}
                              showClipping={showClipping}
                              stereo={stereo}
                              clipId={clip.id}
                              bitmapKey={clip.id}
                              cropStartMs={drawCropStartMs}
                              cropEndMs={drawCropStartMs + shell.width / drawScale}
                              sourceDurationMs={clip.sourceDurationMs}
                              height={clipInternalHeight}
                              color={missingMedia ? MISSING_CLIP_WAVEFORM_COLOR : CLIP_WAVEFORM_COLOR}
                              globalPeakAmplitude={globalPeakAmplitude}
                            />
                          )}

                          {missingMedia && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[2]">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-red-100/90">
                                Missing
                              </span>
                            </div>
                          )}

                          {labelFits && (clip.muted || Math.abs(clip.gainDb) >= 0.1) && (
                            // Sticks to the tracks scroller's left edge; the clip's overflow: clip is not a scroll container.
                            <div className="absolute top-1 left-0 right-0 text-xs font-medium pointer-events-none"
                              style={{ paddingLeft: labelPadding, paddingRight: labelPadding }}>
                              <span
                                className="sticky text-yellow-400 whitespace-nowrap overflow-hidden text-ellipsis inline-flex items-center max-w-full"
                                style={{ left: labelPadding }}
                              >
                                {clip.muted ? <VolumeX size={12} /> : Math.abs(clip.gainDb) >= 0.1 ? gainLabelText : null}
                              </span>
                            </div>
                          )}

                          {!advancedMixLocked && isTrackEditable(track.id) && (
                          <>
                            <div
                              className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize group"
                              aria-label="Trim clip start"
                              style={{
                                display: shell.skipped > 0 ? 'none' : undefined,
                                zIndex: 10,
                              }}
                            >
                              <div className={`absolute left-0 top-0 bottom-0 w-1 ${missingMedia ? 'bg-red-400' : 'bg-blue-400'} opacity-0 group-hover:opacity-70 transition-opacity`}></div>
                            </div>
                            <div
                              className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize group"
                              aria-label="Trim clip end"
                              style={{
                                display: shell.skipped + shell.width < clipWidthPx ? 'none' : undefined,
                                zIndex: 10,
                              }}
                            >
                              <div className={`absolute right-0 top-0 bottom-0 w-1 ${missingMedia ? 'bg-red-400' : 'bg-blue-400'} opacity-0 group-hover:opacity-70 transition-opacity`}></div>
                            </div>
                          </>
                          )}
                        </div>
                      );
                    })}

                    {isRecording && recordingSegments && recordingSegments.length > 0 && selectedTrackId === track.id && (() => {
                      const currentSegment = recordingSegments[recordingSegments.length - 1];
                      const recordingStartMs = currentSegment.startTimeMs;
                      const effectiveEndMs = Math.max(recordingStartMs, currentTimeMs);
                      const recordingDurationMs = Math.max(0, effectiveEndMs - recordingStartMs);
                      const recordingWidthPx = recordingDurationMs * pixelsPerMs;
                      const recordingLeftPx = recordingStartMs * pixelsPerMs;
                      const recordingRange = segmentRange(recordingLeftPx, recordingWidthPx);
                      const clipPadding = 8;
                      const clipInternalHeight = trackHeight - (clipPadding * 2);

                      return (
                        <div
                          key="recording-clip"
                          className="absolute rounded overflow-hidden pointer-events-none"
                          data-recording-overlay="true"
                          style={{
                            left: `${recordingRange.left}px`,
                            top: `${clipPadding}px`,
                            width: `${recordingRange.width}px`,
                            height: `${clipInternalHeight}px`,
                            backgroundColor: 'rgba(239, 68, 68, 0.3)',
                            boxShadow: 'inset 0 0 0 2px rgb(239, 68, 68)',
                        }}
                      >
                          {rowVisible && recordingRange.width > 0
                            && intersectsViewport(recordingLeftPx, recordingWidthPx, scrollLeft, containerWidth) && (
                            // Rebase DOM placement to the shell without changing source time.
                            <div style={{ position: 'absolute', left: 0, top: 0 }}>
                              <RecordingWaveform
                                startTimeMs={recordingStartMs}
                                endTimeMs={effectiveEndMs}
                                clipLeftPx={recordingLeftPx}
                                clipWidthPx={recordingWidthPx}
                                clipOffsetPx={recordingRange.skipped}
                                viewportLeftPx={scrollLeft}
                                viewportWidthPx={containerWidth}
                                pixelsPerMs={pixelsPerMs}
                                height={clipInternalHeight}
                                displayMode={displayMode}
                                globalPeakAmplitude={globalPeakAmplitude}
                              />
                            </div>
                          )}
                          <div className="absolute top-1 left-2 text-xs text-red-500 font-bold pointer-events-none flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            REC {recordingSegments.length > 1 && `(${recordingSegments.length})`}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          ref={tracksPlayheadRef}
          data-playhead="tracks"
          className="absolute top-0 bottom-0 w-px bg-gray-200"
          style={{ left: shownPlayheadLeft }}
        />
      </div>
    </div>
  );

  if (typeof children === 'function') {
    return children({
      header,
      tracks,
      zoomOverlay,
      lyricsLane,
      rulerTools,
      onToggleGroupCollapse: handleToggleGroupCollapseWithPreload,
      onPreloadGroupCollapse: handlePreloadGroupCollapse,
      pendingGroupCollapseId,
    });
  }

  return (
    <div className={`${sharedVerticalScroll ? '' : 'flex-1'} flex flex-col bg-gray-900 ${sharedVerticalScroll ? '' : 'overflow-hidden'} relative`} style={{ minWidth: 0 }}>
      <div className="absolute right-3 z-50 -translate-y-1/2" style={{ top: `${TIMELINE_RULER_HEIGHT / 2}px` }}>{zoomOverlay}</div>
      {header}
      {lyricsLane}
      {tracks}
    </div>
  );
}

export default Timeline;
