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
  Headphones,
  HeadphoneOff,
  Scale,
} from 'lucide-react';
import { formatClock, formatDurationMs } from '../../utils/playerTime';
import { formatMusicalNumberForDisplay } from '../../utils/naming';
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
  getNextPlaybackSpeed,
} from '../../utils/playerControlsSidebar';
import { getPlacedLyricLines } from '../../utils/lyricTimeline';
import { getProjectCredits } from '../../lib/serverApi';
import PlayerLyricsView from '../PlayerLyricsView';
import PlayerRangeSlider from '../PlayerRangeSlider';
import PracticeFocusSlider from '../PracticeFocusSlider';

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

function MobileSliderControl({
  label,
  readout,
  active = false,
  danger = false,
  icon: Icon,
  iconLabel,
  onIconClick,
  children,
  divider = false,
}) {
  return (
    <div className={`space-y-1.5 ${divider ? 'border-t border-[var(--player-border-subtle)] pt-3.5' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="text-[var(--player-text-secondary)]">{label}</span>
        <span
          className={`tabular-nums font-bold ${
            danger
              ? 'text-[var(--player-danger)]'
              : active
                ? 'text-[var(--player-accent-text)]'
                : 'text-[var(--player-text-primary)]'
          }`}
        >
          {readout}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onIconClick}
          aria-label={iconLabel}
          title={iconLabel}
          className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--player-text-secondary)] active:scale-95 transition-transform"
        >
          <Icon size={18} />
        </button>
        <div className="relative flex min-w-0 flex-1 items-center">
          {children}
        </div>
      </div>
    </div>
  );
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
  onToggleSpeed,
  playbackTranspose = 0,
  onSetPlaybackTranspose,
  onToggleTranspose,
  practiceFocusControl = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  onSetPracticeFocusControl,
  onTogglePracticeFocus,
  practicePanRange = 100,
  onSetPracticePanRange,
  onTogglePracticePanRange,
  hasRealtimeMetronome = false,
  metronomeVolume = 80,
  onSetMetronomeVolume,
  onToggleMetronomeMute,
  // Lyrics & Session
  currentPlaybackLyrics,
  hasCurrentLyrics,
  session,
}) {
  const [isMuted, setIsMuted] = useState(false);
  const previousVolumeRef = useRef(volume);
  const previousMetronomeRef = useRef(metronomeVolume || 80);
  const previousTransposeRef = useRef(1);
  const previousNumericFocusRef = useRef(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);
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
  const musicalNumber = formatMusicalNumberForDisplay(activeQueueItem.musicalNumber || '');
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
  const focusStep = focusSteps[clampedFocusIdx];
  const focusLabel = formatFocusBadge(focusStep);
  const focusPct = focusSteps.length > 1 ? (clampedFocusIdx / (focusSteps.length - 1)) * 100 : 50;
  const FocusIcon = focusStep === 'omitted'
    ? HeadphoneOff
    : (focusStep === 'solo' ? Headphones : Scale);

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
  const panFocusAxisPct = ((200 - (clampedPan / 2)) / 200) * 100;

  const isFocusActive = focusStep === 'omitted' || focusStep === 'solo' || Number(focusStep) !== 0;
  const isPanActive = clampedPan !== 100;
  const isSpeedActive = Math.abs((Number(playbackSpeed) || 1) - 1) > 0.005;
  const isTransposeActive = Math.abs(Number(playbackTranspose) || 0) > 1e-4;
  const effectiveMetronome = Math.max(0, Math.min(100, Number(metronomeVolume) || 0));
  const isMetronomeMuted = effectiveMetronome <= 0;

  const effectiveVolume = isMuted ? 0 : Math.max(0, Math.min(100, Number(volume) || 0));
  const seekMax = Math.max(durationSec, 0.001);
  const seekVal = Math.min(currentTimeSec, durationSec || 0);
  const seekPct = durationSec > 0 ? Math.min(100, Math.max(0, (seekVal / durationSec) * 100)) : 0;

  const handleToggleMute = () => {
    if (isMuted || effectiveVolume <= 0) {
      setIsMuted(false);
      onSetVolume?.(previousVolumeRef.current || 80);
    } else {
      previousVolumeRef.current = volume;
      setIsMuted(true);
      onSetVolume?.(0);
    }
  };

  const handleFocusIconClick = () => {
    if (onTogglePracticeFocus) {
      onTogglePracticeFocus();
      return;
    }
    if (typeof focusStep === 'number') {
      previousNumericFocusRef.current = clampedFocusIdx;
      onSetPracticeFocusControl?.(focusSteps.length - 1);
      return;
    }
    if (focusStep === 'solo') {
      onSetPracticeFocusControl?.(0);
      return;
    }
    onSetPracticeFocusControl?.(previousNumericFocusRef.current ?? ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);
  };

  const handlePanIconClick = () => {
    if (onTogglePracticePanRange) {
      onTogglePracticePanRange();
      return;
    }
    const distToMax = 200 - clampedPan;
    onSetPracticePanRange?.(distToMax >= clampedPan ? 200 : 0);
  };

  const handleSpeedIconClick = () => {
    if (onToggleSpeed) {
      onToggleSpeed();
      return;
    }
    onSetPlaybackSpeed?.(getNextPlaybackSpeed(playbackSpeed));
  };

  const handleTransposeIconClick = () => {
    if (onToggleTranspose) {
      onToggleTranspose();
      return;
    }
    const current = Number(playbackTranspose) || 0;
    if (Math.abs(current) > 1e-4) {
      previousTransposeRef.current = current;
      onSetPlaybackTranspose?.(0);
    } else {
      onSetPlaybackTranspose?.(previousTransposeRef.current || 1);
    }
  };

  const handleMetronomeIconClick = () => {
    if (onToggleMetronomeMute) {
      onToggleMetronomeMute();
      return;
    }
    if (isMetronomeMuted) {
      onSetMetronomeVolume?.(previousMetronomeRef.current || 80);
    } else {
      previousMetronomeRef.current = effectiveMetronome;
      onSetMetronomeVolume?.(0);
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
                  className={`text-lg font-bold leading-snug line-clamp-3 ${
                    lyricPreview.mode === 'synced'
                      ? 'text-[var(--player-text-primary)]'
                      : 'text-[var(--player-lyric-upcoming)]'
                  }`}
                >
                  {lyricPreview.primary}
                </p>
                {lyricPreview.secondary ? (
                  <p className="text-xs font-medium leading-snug text-[var(--player-text-secondary)] line-clamp-2">
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

            <div className="flex items-center justify-between border-t border-[var(--player-border-subtle)] pt-2.5 text-[11px] font-medium text-[var(--player-text-secondary)]">
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
            <PlayerRangeSlider
              touch
              min={0}
              max={seekMax}
              step={0.01}
              value={seekVal}
              percent={seekPct}
              onPointerDown={beginTimelineScrub}
              onPointerUp={endTimelineScrub}
              onPointerCancel={endTimelineScrub}
              onChange={(e) => onSeek?.(Number(e.target.value))}
              ariaLabel="Seek track position"
              className="w-full h-6"
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
          className="space-y-4 rounded-2xl bg-[var(--player-bg-surface)] border border-[var(--player-border-subtle)] p-5 scroll-mt-16"
        >
          <div className="flex items-center gap-2 border-b border-[var(--player-border-subtle)] pb-3">
            <Sliders size={17} className="shrink-0 text-[var(--player-accent-text)]" />
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--player-text-primary)] whitespace-nowrap">
              Choir Practice & Sound Controls
            </h2>
          </div>

          {hasRealtimeMetronome && (
            <MobileSliderControl
              label="Metronome"
              readout={isMetronomeMuted ? 'Muted' : `${Math.round(effectiveMetronome)}%`}
              active={!isMetronomeMuted}
              icon={Metronome}
              iconLabel={isMetronomeMuted ? 'Unmute metronome' : 'Mute metronome'}
              onIconClick={handleMetronomeIconClick}
            >
              <PlayerRangeSlider
                touch
                min={0}
                max={100}
                step={1}
                value={effectiveMetronome}
                percent={effectiveMetronome}
                onChange={(e) => onSetMetronomeVolume?.(Number(e.target.value))}
                ariaLabel="Metronome Volume Slider"
                className="w-full h-6"
              />
            </MobileSliderControl>
          )}

          <MobileSliderControl
            divider={hasRealtimeMetronome}
            label="Practice Focus"
            readout={focusLabel}
            active={isFocusActive}
            icon={FocusIcon}
            iconLabel="Cycle practice focus"
            onIconClick={handleFocusIconClick}
          >
            <PracticeFocusSlider
              touch
              valueIndex={clampedFocusIdx}
              onChangeIndex={(idx) => onSetPracticeFocusControl?.(idx)}
              ariaLabel="Practice Focus"
              inputAriaLabel="Practice Focus Slider"
              className="w-full"
            />
          </MobileSliderControl>

          <MobileSliderControl
            divider
            label="Practice Pan"
            readout={`${clampedPan}%`}
            active={isPanActive}
            icon={ChevronsLeftRightEllipsis}
            iconLabel="Jump practice pan to extreme"
            onIconClick={handlePanIconClick}
          >
            <PlayerRangeSlider
              touch
              bipolar
              min={0}
              max={200}
              step={5}
              value={clampedPan}
              percent={panPct}
              secondaryDotPercent={focusStep === 'omitted' || focusStep === 'solo' ? null : panFocusAxisPct}
              onChange={(e) => onSetPracticePanRange?.(Number(e.target.value))}
              ariaLabel="Practice Pan Range Slider"
              className="w-full h-6"
            />
          </MobileSliderControl>

          <MobileSliderControl
            divider
            label="Playback Speed"
            readout={`${formatPlaybackSpeed(playbackSpeed)}x`}
            active={isSpeedActive}
            icon={Gauge}
            iconLabel="Step playback speed"
            onIconClick={handleSpeedIconClick}
          >
            <PlayerRangeSlider
              touch
              bipolar
              min={PLAYBACK_SPEED_DRAG_BOUNDS.MIN}
              max={PLAYBACK_SPEED_DRAG_BOUNDS.MAX}
              step={PLAYBACK_SPEED_DRAG_BOUNDS.STEP}
              value={clampedSpeed}
              percent={speedPct}
              onChange={(e) => onSetPlaybackSpeed?.(Number(e.target.value))}
              ariaLabel="Playback Speed Slider"
              className="w-full h-6"
            />
          </MobileSliderControl>

          <MobileSliderControl
            divider
            label="Pitch Transpose"
            readout={formatPlaybackTranspose(playbackTranspose)}
            active={isTransposeActive}
            icon={Music}
            iconLabel={isTransposeActive ? 'Reset pitch transpose to 0 st' : 'Restore previous pitch transpose'}
            onIconClick={handleTransposeIconClick}
          >
            <PlayerRangeSlider
              touch
              bipolar
              min={PLAYBACK_TRANSPOSE_BOUNDS.MIN}
              max={PLAYBACK_TRANSPOSE_BOUNDS.MAX}
              step={PLAYBACK_TRANSPOSE_BOUNDS.STEP}
              value={clampedTranspose}
              percent={transposePct}
              onChange={(e) => onSetPlaybackTranspose?.(Number(e.target.value))}
              ariaLabel="Pitch Transpose Slider"
              className="w-full h-6"
            />
          </MobileSliderControl>

          <MobileSliderControl
            divider
            label="Master Volume"
            readout={isMuted || effectiveVolume === 0 ? 'Muted' : `${effectiveVolume}%`}
            active={!isMuted && effectiveVolume > 0}
            danger={isMuted || effectiveVolume === 0}
            icon={isMuted || effectiveVolume === 0 ? VolumeX : Volume2}
            iconLabel={isMuted || effectiveVolume === 0 ? 'Unmute master volume' : 'Mute master volume'}
            onIconClick={handleToggleMute}
          >
            <PlayerRangeSlider
              touch
              min={0}
              max={100}
              step={1}
              value={effectiveVolume}
              percent={effectiveVolume}
              onChange={(e) => {
                setIsMuted(false);
                onSetVolume?.(Number(e.target.value));
              }}
              ariaLabel="Master Volume Slider"
              className="w-full h-6"
            />
          </MobileSliderControl>
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
            <div className="h-[380px] flex flex-col overflow-hidden">
              <PlayerLyricsView
                lyrics={currentPlaybackLyrics}
                currentTimeMs={currentTimeSec * 1000}
                durationMs={durationSec * 1000}
                songTitle={title}
                showHeader={false}
                contentClassName="px-0"
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
