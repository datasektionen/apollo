import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Loader2,
  MicVocal,
  Sliders,
  Info,
  Gauge,
  Music,
  Volume2,
  VolumeX,
  Metronome,
  ChevronsLeftRightEllipsis,
  Scale,
} from 'lucide-react';
import { formatClock, formatDurationMs } from '../../utils/playerTime';
import { PLAYER_LOOP_MODES } from '../../types/player';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
} from '../../utils/advancedMix';
import {
  PLAYBACK_SPEED_DRAG_BOUNDS,
  PLAYBACK_TRANSPOSE_BOUNDS,
  formatPlaybackSpeed,
  formatPlaybackTranspose,
} from '../../utils/playerControlsSidebar';
import { getPlacedLyricLines } from '../../utils/lyricTimeline';
import { getProjectCredits } from '../../lib/serverApi';
import PlayerLyricsView from '../PlayerLyricsView';

function formatFocusBadge(step) {
  if (step === 'omitted') return 'Omitted';
  if (step === 'solo') return 'Solo';
  const numeric = Number(step);
  if (!Number.isFinite(numeric)) return '0 dB';
  if (numeric === 0) return '0 dB';
  return `${numeric > 0 ? '+' : ''}${numeric} dB`;
}

function getBipolarTrackStyle(pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 50));
  return {
    '--player-bipolar-start': `${Math.min(50, clamped)}%`,
    '--player-bipolar-end': `${Math.max(50, clamped)}%`,
  };
}

export function MobileNowPlayingModal({
  isOpen,
  onClose,
  activeQueueItem,
  isPlaying,
  isRendering,
  currentTimeSec,
  durationSec,
  volume = 80,
  onSetVolume,
  loopMode,
  shuffleEnabled,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  beginTimelineScrub,
  endTimelineScrub,
  onCycleLoopMode,
  onToggleShuffle,
  // Choir stem controls
  playbackSpeed = 1,
  onSetPlaybackSpeed,
  playbackTranspose = 0,
  onSetPlaybackTranspose,
  practiceFocusControl = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  onSetPracticeFocusControl,
  practicePanRange = 100,
  onSetPracticePanRange,
  hasRealtimeMetronome = false,
  metronomeVolume = 80,
  onSetMetronomeVolume,
  // Lyrics & Session
  currentPlaybackLyrics,
  hasCurrentLyrics,
  session,
}) {
  const [isMuted, setIsMuted] = useState(false);
  const previousVolumeRef = useRef(volume);
  const [creditsState, setCreditsState] = useState({ status: 'idle', data: null, error: '' });
  const [activeSection, setActiveSection] = useState('practice');
  const practiceSectionRef = useRef(null);
  const lyricsSectionRef = useRef(null);
  const creditsSectionRef = useRef(null);

  // Load credits automatically for the active project
  useEffect(() => {
    if (!activeQueueItem?.projectId) {
      setCreditsState({ status: 'idle', data: null, error: '' });
      return;
    }
    let cancelled = false;
    setCreditsState({ status: 'loading', data: null, error: '' });
    getProjectCredits(activeQueueItem.projectId, session)
      .then((data) => {
        if (!cancelled) {
          setCreditsState({ status: 'ready', data, error: '' });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCreditsState({
            status: 'error',
            data: null,
            error: err.message || 'Failed to load credits',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeQueueItem?.projectId, session]);

  const currentTimeMs = Math.max(0, Number(currentTimeSec || 0) * 1000);
  const lyricPreview = useMemo(() => {
    const rawLines = Array.isArray(currentPlaybackLyrics?.lines) ? currentPlaybackLyrics.lines : [];
    const placed = getPlacedLyricLines(rawLines).filter(
      (entry) => String(entry.line?.text ?? '').trim().length > 0
    );
    if (placed.length > 0) {
      let activeIndex = -1;
      for (let i = 0; i < placed.length; i += 1) {
        if (placed[i].startMs <= currentTimeMs) {
          activeIndex = i;
        } else {
          break;
        }
      }
      if (activeIndex >= 0) {
        return {
          mode: 'synced',
          primary: String(placed[activeIndex].line.text).trim(),
          secondary: placed[activeIndex + 1] ? String(placed[activeIndex + 1].line.text).trim() : '',
          eyebrow: 'Live Lyric',
        };
      }
      return {
        mode: 'intro',
        primary: String(placed[0].line.text).trim(),
        secondary: placed[1] ? String(placed[1].line.text).trim() : '',
        eyebrow: 'Up Next',
      };
    }

    const staticTexts = rawLines
      .map((line) => String(line?.text ?? '').trim())
      .filter(Boolean);
    if (staticTexts.length > 0) {
      return {
        mode: 'static',
        primary: staticTexts[0],
        secondary: staticTexts[1] || '',
        eyebrow: 'Lyrics',
      };
    }
    return null;
  }, [currentPlaybackLyrics, currentTimeMs]);

  if (!isOpen || !activeQueueItem) return null;

  const title = activeQueueItem.name || activeQueueItem.title || 'Untitled Track';
  const subtitle = activeQueueItem.showName || activeQueueItem.artist || activeQueueItem.projectName || 'Apollo Choir';
  const musicalNumber = activeQueueItem.musicalNumber || '';
  const collectionName = activeQueueItem.collectionName || activeQueueItem.showName || 'Queue';
  const totalDurationLabel = formatDurationMs(
    activeQueueItem.durationMs ?? (durationSec > 0 ? durationSec * 1000 : 0)
  );

  const isLoopOne = loopMode === PLAYER_LOOP_MODES.ONE;
  const isLoopAll = loopMode === PLAYER_LOOP_MODES.ALL;

  const focusSteps = ADVANCED_MIX_PRACTICE_FOCUS_STEPS;
  const clampedFocusIdx = Math.max(
    0,
    Math.min(
      focusSteps.length - 1,
      Number.isFinite(Number(practiceFocusControl))
        ? Number(practiceFocusControl)
        : ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX
    )
  );
  const focusLabel = formatFocusBadge(focusSteps[clampedFocusIdx]);
  const focusPct = focusSteps.length > 1 ? (clampedFocusIdx / (focusSteps.length - 1)) * 100 : 50;
  const focusQuickOptions = [
    { idx: 0, label: 'Omit' },
    { idx: 4, label: '-6 dB' },
    { idx: ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX, label: '0 dB' },
    { idx: 8, label: '+6 dB' },
    { idx: focusSteps.length - 1, label: 'Solo' },
  ];

  const speedQuickOptions = [0.8, 0.9, 1.0, 1.1, 1.2];
  const clampedSpeed = Math.max(
    PLAYBACK_SPEED_DRAG_BOUNDS.MIN,
    Math.min(PLAYBACK_SPEED_DRAG_BOUNDS.MAX, Number(playbackSpeed) || 1)
  );
  const speedPct =
    ((clampedSpeed - PLAYBACK_SPEED_DRAG_BOUNDS.MIN) /
      (PLAYBACK_SPEED_DRAG_BOUNDS.MAX - PLAYBACK_SPEED_DRAG_BOUNDS.MIN)) *
    100;

  const clampedTranspose = Math.max(
    PLAYBACK_TRANSPOSE_BOUNDS.MIN,
    Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, Number(playbackTranspose) || 0)
  );
  const transposePct =
    ((clampedTranspose - PLAYBACK_TRANSPOSE_BOUNDS.MIN) /
      (PLAYBACK_TRANSPOSE_BOUNDS.MAX - PLAYBACK_TRANSPOSE_BOUNDS.MIN)) *
    100;

  const clampedPan = Math.max(0, Math.min(200, Number(practicePanRange) ?? 100));
  const panPct = (clampedPan / 200) * 100;

  const effectiveVolume = isMuted ? 0 : Math.max(0, Math.min(100, Number(volume) || 0));
  const seekMax = Math.max(durationSec, 0.001);
  const seekVal = Math.min(currentTimeSec, durationSec || 0);
  const seekPct = durationSec > 0 ? Math.min(100, Math.max(0, (seekVal / durationSec) * 100)) : 0;

  const handleToggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      onSetVolume?.(previousVolumeRef.current || 80);
    } else {
      previousVolumeRef.current = volume;
      setIsMuted(true);
      onSetVolume?.(0);
    }
  };

  const scrollToSection = (sectionId, ref) => {
    setActiveSection(sectionId);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)] pt-safe pb-safe select-none animate-in fade-in slide-in-from-bottom-8 duration-200 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between px-4 bg-[var(--player-bg-canvas-translucent)] backdrop-blur-md border-b border-[var(--player-border-subtle)] shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 transition-all"
          aria-label="Collapse player"
        >
          <ChevronDown size={24} />
        </button>

        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
            Playing from
          </div>
          <div className="truncate text-xs font-semibold text-[var(--player-text-primary)]">
            {collectionName}
          </div>
        </div>

        <div className="w-10" />
      </header>

      {/* Main View Area */}
      <div className="px-5 pt-4 pb-16 space-y-7 max-w-lg mx-auto w-full">
        {/* ============================================================ */}
        {/* 1. TOP FOLD: Editorial Stage, Track Info, Scrubber, Transport */}
        {/* ============================================================ */}
        <section className="space-y-5">
          {/* Typographic & Live-Lyric Song Stage (zero fake album art box) */}
          <div className="player-hero-surface relative overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] px-5 py-5 min-h-[188px] flex flex-col justify-between shadow-[var(--player-shadow-elevated)]">
            <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.14em]">
              <span className="text-[var(--player-accent-text)]">
                {lyricPreview ? lyricPreview.eyebrow : (musicalNumber ? `No. ${musicalNumber}` : 'Choir Practice')}
              </span>
              {lyricPreview && (lyricPreview.mode === 'synced' || lyricPreview.mode === 'intro') ? (
                <span className="rounded-full border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--player-accent-text)]">
                  Synced
                </span>
              ) : totalDurationLabel ? (
                <span className="font-mono text-[var(--player-text-muted)] tabular-nums">
                  {totalDurationLabel}
                </span>
              ) : null}
            </div>

            {lyricPreview ? (
              <div className="my-4 space-y-2">
                <p
                  className={`border-l-2 pl-3.5 text-lg font-bold leading-snug line-clamp-3 ${
                    lyricPreview.mode === 'synced'
                      ? 'border-[var(--player-accent)] text-[var(--player-text-primary)]'
                      : 'border-[var(--player-border-strong)] text-[var(--player-lyric-upcoming)]'
                  }`}
                >
                  {lyricPreview.primary}
                </p>
                {lyricPreview.secondary ? (
                  <p className="pl-4 text-xs font-medium leading-snug text-[var(--player-lyric-past)] line-clamp-2">
                    {lyricPreview.secondary}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="my-4 space-y-2.5">
                <div className="text-4xl font-extrabold tracking-tight text-[var(--player-text-primary)] tabular-nums">
                  {musicalNumber || 'APOLLO'}
                </div>
                <div className="h-[2px] w-10 rounded-full bg-[var(--player-accent)]" aria-hidden="true" />
                <div className="text-xs font-medium text-[var(--player-text-secondary)] truncate">
                  {subtitle}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--player-text-muted)]">
              <span>{focusLabel === '0 dB' ? 'Balanced Mix' : `Focus ${focusLabel}`}</span>
              <span>
                {formatPlaybackSpeed(playbackSpeed)}x · {formatPlaybackTranspose(playbackTranspose)}
              </span>
            </div>
          </div>

          {/* Track Info */}
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--player-text-primary)] line-clamp-2">
              {title}
            </h1>
            <p className="mt-1 text-sm font-medium text-[var(--player-text-secondary)] truncate tabular-nums">
              {[musicalNumber ? `No. ${musicalNumber}` : null, subtitle].filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* Scrubber / Progress Bar */}
          <div className="space-y-1.5">
            <input
              type="range"
              min="0"
              max={seekMax}
              step="0.01"
              value={seekVal}
              onPointerDown={beginTimelineScrub}
              onPointerUp={endTimelineScrub}
              onPointerCancel={endTimelineScrub}
              onChange={(e) => onSeek?.(Number(e.target.value))}
              style={{ '--player-range-pct': `${seekPct}%` }}
              className="player-range player-range-touch w-full cursor-pointer block"
              aria-label="Seek track position"
            />
            <div className="flex justify-between text-[11px] font-medium text-[var(--player-text-secondary)] tabular-nums">
              <span>{formatClock(currentTimeSec)}</span>
              <span>{formatClock(durationSec)}</span>
            </div>
          </div>

          {/* Media Transport Controls */}
          <div className="flex items-center justify-between px-1">
            {/* Shuffle */}
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-pressed={shuffleEnabled}
              className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-90 ${
                shuffleEnabled
                  ? 'text-[var(--player-accent-text)]'
                  : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
              }`}
              aria-label={shuffleEnabled ? 'Shuffle enabled' : 'Shuffle disabled'}
            >
              <Shuffle size={20} />
              {shuffleEnabled ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[var(--player-accent)]"
                />
              ) : null}
            </button>

            {/* Previous */}
            <button
              type="button"
              onClick={onPrevious}
              className="flex h-12 w-12 items-center justify-center text-[var(--player-text-primary)] hover:text-[var(--player-accent-text)] active:scale-90 transition-all"
              aria-label="Previous track"
            >
              <SkipBack size={30} className="fill-current" />
            </button>

            {/* Primary Apollo Gold Play/Pause CTA */}
            <button
              type="button"
              onClick={onTogglePlay}
              className="player-play-cta flex h-16 w-16 items-center justify-center rounded-full"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isRendering ? (
                <Loader2 size={28} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={30} className="fill-current" />
              ) : (
                <Play size={30} className="fill-current translate-x-0.5" />
              )}
            </button>

            {/* Next */}
            <button
              type="button"
              onClick={onNext}
              className="flex h-12 w-12 items-center justify-center text-[var(--player-text-primary)] hover:text-[var(--player-accent-text)] active:scale-90 transition-all"
              aria-label="Next track"
            >
              <SkipForward size={30} className="fill-current" />
            </button>

            {/* Loop Mode */}
            <button
              type="button"
              onClick={onCycleLoopMode}
              className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-90 ${
                isLoopAll || isLoopOne
                  ? 'text-[var(--player-accent-text)]'
                  : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
              }`}
              aria-label={`Loop mode: ${loopMode}`}
            >
              {isLoopOne ? <Repeat1 size={20} /> : <Repeat size={20} />}
              {isLoopAll || isLoopOne ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[var(--player-accent)]"
                />
              ) : null}
            </button>
          </div>

          {/* Interactive Section Segmented Switch */}
          <div className="rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)] p-1 grid grid-cols-3 gap-1">
            {[
              { id: 'practice', label: 'Practice', Icon: Sliders, ref: practiceSectionRef },
              { id: 'lyrics', label: 'Lyrics', Icon: MicVocal, ref: lyricsSectionRef },
              { id: 'credits', label: 'Credits', Icon: Info, ref: creditsSectionRef },
            ].map(({ id, label, Icon, ref }) => {
              const selected = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => scrollToSection(id, ref)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors active:scale-[0.98] ${
                    selected
                      ? 'bg-[var(--player-bg-active-segment)] text-[var(--player-text-primary)]'
                      : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  <Icon
                    size={13}
                    className={selected ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-muted)]'}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ============================================================ */}
        {/* 2. SCROLL SECTION: Choir Practice & Sound Controls           */}
        {/* ============================================================ */}
        <section
          ref={practiceSectionRef}
          className="space-y-5 rounded-2xl bg-[var(--player-bg-surface)] border border-[var(--player-border-subtle)] p-5 scroll-mt-16"
        >
          <div className="flex items-center gap-2 border-b border-[var(--player-border-subtle)] pb-3">
            <Sliders size={17} className="shrink-0 text-[var(--player-accent-text)]" />
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--player-text-primary)] whitespace-nowrap">
              Choir Practice & Sound Controls
            </h2>
          </div>

          {/* 1. Practice Focus Slider (full 13-step desktop parity) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <Scale size={14} className="text-[var(--player-accent-text)]" />
                <span>Practice Focus</span>
              </span>
              <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                {focusLabel}
              </span>
            </div>
            <div className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
              />
              <input
                type="range"
                min="0"
                max={focusSteps.length - 1}
                step="1"
                value={clampedFocusIdx}
                onChange={(e) => onSetPracticeFocusControl?.(Number(e.target.value))}
                style={getBipolarTrackStyle(focusPct)}
                className="player-range player-range-bipolar player-range-touch relative z-10 w-full cursor-pointer"
                aria-label="Practice Focus Slider"
              />
            </div>
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {focusQuickOptions.map((opt) => {
                const active = clampedFocusIdx === opt.idx;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onSetPracticeFocusControl?.(opt.idx)}
                    aria-pressed={active}
                    className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--player-accent-soft)] border-[var(--player-accent-border)] text-[var(--player-accent-text)]'
                        : 'bg-[var(--player-bg-elevated)] border-[var(--player-border-subtle)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Choir Width Slider (0 - 200%) */}
          <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-4">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <ChevronsLeftRightEllipsis size={14} className="text-[var(--player-accent-text)]" />
                <span>Choir Width</span>
              </span>
              <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                {clampedPan}%
              </span>
            </div>
            <div className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
              />
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={clampedPan}
                onChange={(e) => onSetPracticePanRange?.(Number(e.target.value))}
                style={getBipolarTrackStyle(panPct)}
                className="player-range player-range-bipolar player-range-touch relative z-10 w-full cursor-pointer"
                aria-label="Practice Pan Range Slider"
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--player-text-muted)] font-medium pt-0.5 pb-1">
              <span>0% Mono</span>
              <span>100% Stereo</span>
              <span>200% Wide</span>
            </div>
          </div>

          {/* 3. Playback Speed Slider & Quick Buttons */}
          <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-4">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <Gauge size={14} className="text-[var(--player-accent-text)]" />
                <span>Playback Speed</span>
              </span>
              <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                {formatPlaybackSpeed(playbackSpeed)}x
              </span>
            </div>
            <div className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
              />
              <input
                type="range"
                min={PLAYBACK_SPEED_DRAG_BOUNDS.MIN}
                max={PLAYBACK_SPEED_DRAG_BOUNDS.MAX}
                step={PLAYBACK_SPEED_DRAG_BOUNDS.STEP}
                value={clampedSpeed}
                onChange={(e) => onSetPlaybackSpeed?.(Number(e.target.value))}
                style={getBipolarTrackStyle(speedPct)}
                className="player-range player-range-bipolar player-range-touch relative z-10 w-full cursor-pointer"
                aria-label="Playback Speed Slider"
              />
            </div>
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {speedQuickOptions.map((s) => {
                const active = Math.abs(Number(playbackSpeed) - s) < 0.01;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSetPlaybackSpeed?.(s)}
                    aria-pressed={active}
                    className={`py-1.5 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                      active
                        ? 'bg-[var(--player-accent)] border-[var(--player-accent)] text-[var(--player-accent-foreground)] font-bold'
                        : 'bg-[var(--player-bg-elevated)] border-[var(--player-border-subtle)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                    }`}
                  >
                    {s}x
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Pitch Transpose Slider */}
          <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-4">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <Music size={14} className="text-[var(--player-accent-text)]" />
                <span>Pitch Transposition</span>
              </span>
              <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                {formatPlaybackTranspose(playbackTranspose)}
              </span>
            </div>
            <div className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
              />
              <input
                type="range"
                min={PLAYBACK_TRANSPOSE_BOUNDS.MIN}
                max={PLAYBACK_TRANSPOSE_BOUNDS.MAX}
                step={PLAYBACK_TRANSPOSE_BOUNDS.STEP}
                value={clampedTranspose}
                onChange={(e) => onSetPlaybackTranspose?.(Number(e.target.value))}
                style={getBipolarTrackStyle(transposePct)}
                className="player-range player-range-bipolar player-range-touch relative z-10 w-full cursor-pointer"
                aria-label="Pitch Transpose Slider"
              />
            </div>
            <div className="flex justify-between items-center text-[11px] text-[var(--player-text-muted)] pt-1 tabular-nums">
              <span>{PLAYBACK_TRANSPOSE_BOUNDS.MIN} st</span>
              <button
                type="button"
                onClick={() => onSetPlaybackTranspose?.(0)}
                className="px-3 py-1 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 font-semibold"
              >
                Reset to Original
              </button>
              <span>+{PLAYBACK_TRANSPOSE_BOUNDS.MAX} st</span>
            </div>
          </div>

          {/* 5. Master Volume Slider with Mute */}
          <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-4">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={isMuted || volume === 0 ? 'Unmute master volume' : 'Mute master volume'}
                  className="hover:text-[var(--player-text-primary)] transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX size={16} className="text-[var(--player-danger)]" />
                  ) : (
                    <Volume2 size={16} className="text-[var(--player-text-secondary)]" />
                  )}
                </button>
                <span>Master Volume</span>
              </span>
              <span className="text-[var(--player-text-primary)] font-bold tabular-nums">
                {isMuted ? 'Muted' : `${volume}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={effectiveVolume}
              onChange={(e) => {
                setIsMuted(false);
                onSetVolume?.(Number(e.target.value));
              }}
              style={{ '--player-range-pct': `${effectiveVolume}%` }}
              className="player-range player-range-touch w-full cursor-pointer"
              aria-label="Master Volume Slider"
            />
          </div>

          {/* 6. Metronome Click Volume (if snapshot has metronome) */}
          {hasRealtimeMetronome && (
            <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-4">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                  <Metronome size={14} className="text-[var(--player-accent-text)]" />
                  <span>Metronome Click</span>
                </span>
                <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                  {metronomeVolume}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={metronomeVolume}
                onChange={(e) => onSetMetronomeVolume?.(Number(e.target.value))}
                style={{ '--player-range-pct': `${metronomeVolume}%` }}
                className="player-range player-range-touch w-full cursor-pointer"
                aria-label="Metronome Volume Slider"
              />
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* 3. SCROLL SECTION: Synchronized Lyrics                       */}
        {/* ============================================================ */}
        <section
          ref={lyricsSectionRef}
          className="space-y-3 rounded-2xl bg-[var(--player-bg-surface)] border border-[var(--player-border-subtle)] p-5 scroll-mt-16"
        >
          <div className="flex items-center gap-2 border-b border-[var(--player-border-subtle)] pb-3">
            <MicVocal size={17} className="shrink-0 text-[var(--player-accent-text)]" />
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--player-text-primary)]">
              Lyrics
            </h2>
          </div>

          {hasCurrentLyrics ? (
            <div className="h-[380px] flex flex-col overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-canvas)]">
              <PlayerLyricsView
                lyrics={currentPlaybackLyrics}
                currentTimeMs={currentTimeSec * 1000}
                durationMs={durationSec * 1000}
                songTitle={title}
                showHeader={false}
                onSeek={onSeek}
              />
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-[var(--player-text-muted)]">
              No lyrics available for this song.
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* 4. SCROLL SECTION: Credits                                   */}
        {/* ============================================================ */}
        <section
          ref={creditsSectionRef}
          className="space-y-4 rounded-2xl bg-[var(--player-bg-surface)] border border-[var(--player-border-subtle)] p-5 scroll-mt-16"
        >
          <div className="flex items-center gap-2 border-b border-[var(--player-border-subtle)] pb-3">
            <Info size={17} className="shrink-0 text-[var(--player-accent-text)]" />
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--player-text-primary)]">
              Credits
            </h2>
          </div>

          {creditsState.status === 'loading' ? (
            <div className="py-8 flex items-center justify-center gap-2 text-sm text-[var(--player-text-secondary)]">
              <Loader2 size={18} className="animate-spin text-[var(--player-accent-text)]" />
              <span>Loading credits...</span>
            </div>
          ) : creditsState.error ? (
            <div className="rounded-lg border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] p-3 text-xs text-[var(--player-danger)]">
              {creditsState.error}
            </div>
          ) : creditsState.data ? (
            <div className="space-y-4 text-sm">
              {/* Show Header */}
              {creditsState.data.show ? (
                <div className="rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] p-3.5 space-y-1">
                  <div className="font-bold text-[var(--player-text-primary)]">
                    {creditsState.data.show.name}
                  </div>
                  {creditsState.data.show.description && (
                    <p className="text-xs text-[var(--player-text-secondary)] leading-relaxed">
                      {creditsState.data.show.description}
                    </p>
                  )}
                </div>
              ) : null}

              {/* Composition & Lyrics */}
              {creditsState.data.credits?.compositionLyrics?.length ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--player-text-muted)]">
                    Composition & Lyrics
                  </div>
                  <div className="divide-y divide-[var(--player-border-subtle)] rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3">
                    {creditsState.data.credits.compositionLyrics.map((item, idx) => (
                      <div key={idx} className="py-2.5 flex justify-between items-center gap-3">
                        <span className="font-medium text-[var(--player-text-primary)]">
                          {item.artist?.name || item.name}
                        </span>
                        <span className="text-xs text-[var(--player-text-secondary)]">
                          {item.role || 'Writer'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Performers */}
              {creditsState.data.credits?.performers?.length ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--player-text-muted)]">
                    Performers & Choir
                  </div>
                  <div className="divide-y divide-[var(--player-border-subtle)] rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3 max-h-60 overflow-y-auto">
                    {creditsState.data.credits.performers.map((item, idx) => (
                      <div key={idx} className="py-2.5 flex justify-between items-center gap-3">
                        <span className="font-medium text-[var(--player-text-primary)]">
                          {item.artist?.name || item.name}
                        </span>
                        <span className="text-xs text-[var(--player-accent-text)] font-mono">
                          {item.role || 'Performer'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Production */}
              {creditsState.data.credits?.productionEngineering?.length ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--player-text-muted)]">
                    Production & Engineering
                  </div>
                  <div className="divide-y divide-[var(--player-border-subtle)] rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3">
                    {creditsState.data.credits.productionEngineering.map((item, idx) => (
                      <div key={idx} className="py-2.5 flex justify-between items-center gap-3">
                        <span className="font-medium text-[var(--player-text-primary)]">
                          {item.artist?.name || item.name}
                        </span>
                        <span className="text-xs text-[var(--player-text-secondary)]">
                          {item.role || 'Engineer'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-[var(--player-text-muted)]">
              No credits recorded for this project.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default MobileNowPlayingModal;
