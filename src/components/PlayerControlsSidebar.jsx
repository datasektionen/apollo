import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronsLeftRightEllipsis,
  Gauge,
  HeadphoneOff,
  Headphones,
  Metronome,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Scale,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CONTROLS_SIDEBAR,
  CONTROLS_SIDEBAR_MODES,
  PLAYBACK_SPEED_DRAG_BOUNDS,
  PLAYBACK_TRANSPOSE_BOUNDS,
  clampControlsSidebarWidth,
  commitControlsSidebarDrag,
  controlsSidebarProgress,
  formatPlaybackSpeed,
  formatPlaybackTranspose,
  getNextPlaybackSpeed,
  lerp,
  readControlsSidebarSettings,
  resolveControlsSidebarDrag,
  writeControlsSidebarSettings,
} from '../utils/playerControlsSidebar';

const HEADER_ICON_SIZE = 20;
const RESIZE_GAP_PX = 12;

function formatFocusReadout(step) {
  if (step === 'omitted') return 'Omitted';
  if (step === 'solo') return 'Solo';
  const numeric = Number(step);
  if (!Number.isFinite(numeric)) return '0 dB';
  if (numeric === 0) return '0 dB';
  return `${numeric > 0 ? '+' : ''}${numeric} dB`;
}

function HeaderToggleIcon({ progress, hovering, instant, animating }) {
  const showHover = hovering && !instant;
  const snap = instant;
  const minimized = progress <= 0;

  const slidersOpacity = snap
    ? (minimized ? 1 : 0.72)
    : (showHover ? 0 : Math.max(0.72, 1 - progress));
  const openOpacity = snap
    ? 0
    : (showHover ? 1 - progress : 0);
  const closeOpacity = snap
    ? 0
    : (showHover ? progress : 0);
  const iconMotion = snap || animating ? 'none' : 'opacity 150ms linear';

  return (
    <span className="relative h-5 w-5 shrink-0 overflow-hidden">
      <SlidersHorizontal
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: slidersOpacity, transition: iconMotion }}
      />
      <PanelRightOpen
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: openOpacity, transition: iconMotion }}
      />
      <PanelRightClose
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: closeOpacity, transition: iconMotion }}
      />
    </span>
  );
}

export function PlayerControlsSidebar({
  speedControlsEnabled = true,
  playbackSpeed = 1,
  onToggleSpeed,
  transposeControlsEnabled = false,
  playbackTranspose = 0,
  lastPlaybackTranspose = 1,
  onToggleTranspose,
  metronomeControlsEnabled = false,
  metronomeVolume = 80,
  isMetronomeMuted = false,
  onToggleMetronomeMute,
  practiceControlsEnabled = false,
  practiceFocusControl = 0,
  focusControlDisabled = false,
  focusStep = 0,
  focusSliderPosition = 50,
  onTogglePracticeFocus,
  onFocusSliderClick,
  practicePanRange = 100,
  panControlDisabled = false,
  showPanRangeHighlight = false,
  practicePanHighlightPixel = 0,
  practicePanKnobPixel = 0,
  showPanFocusAxisMarker = false,
  practicePanFocusAxisPixel = 0,
  onTogglePracticePanRange,
  isRendering = false,
  sliderDragTooltip = null,
  sliderEditTooltip = null,
  beginSliderDrag,
  openSliderEdit,
  commitSliderEdit,
  setSliderEditTooltip,
  formatSliderValue,
  playerTheme = 'dark-gold',
}) {
  const saved = useMemo(() => readControlsSidebarSettings(), []);
  const [mode, setMode] = useState(saved.mode);
  const [width, setWidth] = useState(saved.width);
  const [viewWidth, setViewWidth] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const [headerHover, setHeaderHover] = useState(false);
  const [flashSpeed, setFlashSpeed] = useState(null);
  const [flashFading, setFlashFading] = useState(false);
  const [flashTranspose, setFlashTranspose] = useState(null);
  const [flashTransposeFading, setFlashTransposeFading] = useState(false);

  const resizeRef = useRef(null);
  const animRef = useRef(null);
  const sidebarWidthRef = useRef(null);
  const sidebarRootRef = useRef(null);
  const resizingRef = useRef(false);
  const flashTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const flashTransposeTimerRef = useRef(null);
  const fadeTransposeTimerRef = useRef(null);

  const committedWidth = mode === CONTROLS_SIDEBAR_MODES.MINIMIZED
    ? CONTROLS_SIDEBAR.MINIMIZED_WIDTH
    : clampControlsSidebarWidth(width);
  const sidebarWidth = viewWidth ?? committedWidth;
  sidebarWidthRef.current = sidebarWidth;

  const progress = controlsSidebarProgress(sidebarWidth);
  const fullyMinimized = progress <= 0;
  const instantChrome = isResizing;
  const showResizeLine = isResizing || resizeHover;

  const stopAnimation = useCallback(() => {
    if (animRef.current != null) {
      window.cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setIsAnimating(false);
  }, []);

  const animateToWidth = useCallback((targetWidth, targetMode, { onComplete } = {}) => {
    stopAnimation();
    const from = sidebarWidthRef.current;
    const start = performance.now();
    setIsAnimating(true);
    const step = (now) => {
      const t = Math.min(1, (now - start) / CONTROLS_SIDEBAR.TOGGLE_ANIMATION_MS);
      setViewWidth(from + (targetWidth - from) * t);
      if (t < 1) {
        animRef.current = window.requestAnimationFrame(step);
        return;
      }
      animRef.current = null;
      setMode(targetMode);
      if (targetMode === CONTROLS_SIDEBAR_MODES.DEFAULT) {
        setWidth(clampControlsSidebarWidth(targetWidth));
      }
      setIsAnimating(false);
      onComplete?.(targetWidth, targetMode);
      if (!resizingRef.current) {
        setViewWidth(null);
      }
    };
    animRef.current = window.requestAnimationFrame(step);
  }, [stopAnimation]);

  useEffect(() => () => {
    if (animRef.current != null) window.cancelAnimationFrame(animRef.current);
    if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
    if (fadeTimerRef.current != null) clearTimeout(fadeTimerRef.current);
    if (flashTransposeTimerRef.current != null) clearTimeout(flashTransposeTimerRef.current);
    if (fadeTransposeTimerRef.current != null) clearTimeout(fadeTransposeTimerRef.current);
  }, []);

  const triggerSpeedFlash = useCallback((formattedValue) => {
    if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
    if (fadeTimerRef.current != null) clearTimeout(fadeTimerRef.current);

    setFlashSpeed(formattedValue);
    setFlashFading(false);

    flashTimerRef.current = setTimeout(() => {
      setFlashFading(true);
      fadeTimerRef.current = setTimeout(() => {
        setFlashSpeed(null);
        setFlashFading(false);
      }, 350);
    }, 650);
  }, []);

  const handleSpeedButtonClick = useCallback((event) => {
    if (isRendering) return;
    const nextSpeed = getNextPlaybackSpeed(playbackSpeed);
    triggerSpeedFlash(formatPlaybackSpeed(nextSpeed));
    onToggleSpeed?.(event);
  }, [isRendering, onToggleSpeed, playbackSpeed, triggerSpeedFlash]);

  const triggerTransposeFlash = useCallback((formattedValue) => {
    if (flashTransposeTimerRef.current != null) clearTimeout(flashTransposeTimerRef.current);
    if (fadeTransposeTimerRef.current != null) clearTimeout(fadeTransposeTimerRef.current);

    setFlashTranspose(formattedValue);
    setFlashTransposeFading(false);

    flashTransposeTimerRef.current = setTimeout(() => {
      setFlashTransposeFading(true);
      fadeTransposeTimerRef.current = setTimeout(() => {
        setFlashTranspose(null);
        setFlashTransposeFading(false);
      }, 350);
    }, 650);
  }, []);

  const handleTransposeButtonClick = useCallback((event) => {
    if (isRendering) return;
    const next = onToggleTranspose?.(event);
    const resolvedNext = next !== undefined
      ? next
      : (Math.abs(Number(playbackTranspose) || 0) > 1e-4 ? 0 : (lastPlaybackTranspose || 1));
    triggerTransposeFlash(formatPlaybackTranspose(resolvedNext));
  }, [isRendering, lastPlaybackTranspose, onToggleTranspose, playbackTranspose, triggerTransposeFlash]);

  useEffect(() => {
    if (isResizing || isAnimating) return;
    writeControlsSidebarSettings({ mode, width });
  }, [isAnimating, isResizing, mode, width]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const applyDragPosition = (clientX) => {
      const drag = resizeRef.current;
      if (!drag || drag.modeAnimating) return;
      const pointerWidth = drag.originRight - clientX - drag.grabOffset;
      const next = resolveControlsSidebarDrag({ pointerWidth });
      if (next.mode !== drag.mode) {
        const targetWidth = next.mode === CONTROLS_SIDEBAR_MODES.MINIMIZED
          ? CONTROLS_SIDEBAR.MINIMIZED_WIDTH
          : CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH;
        drag.modeAnimating = true;
        drag.last = { mode: next.mode, width: targetWidth };
        animateToWidth(targetWidth, next.mode, {
          onComplete: (finishedWidth, finishedMode) => {
            const active = resizeRef.current;
            if (!active) return;
            active.mode = finishedMode;
            active.modeAnimating = false;
            active.last = { mode: finishedMode, width: finishedWidth };
            if (resizingRef.current) {
              applyDragPosition(active.lastClientX);
            }
          },
        });
        return;
      }
      drag.last = next;
      setViewWidth(next.width);
      setMode(next.mode);
      if (next.mode === CONTROLS_SIDEBAR_MODES.DEFAULT) {
        setWidth(next.width);
      }
    };

    const handleMove = (event) => {
      const drag = resizeRef.current;
      if (!drag) return;
      drag.lastClientX = event.clientX;
      applyDragPosition(event.clientX);
    };

    const handleUp = () => {
      const drag = resizeRef.current;
      resizingRef.current = false;
      setIsResizing(false);
      if (drag?.modeAnimating) {
        return;
      }
      const next = drag?.last || {
        mode: drag?.mode,
        width: sidebarWidthRef.current,
      };
      const committed = commitControlsSidebarDrag({
        mode: next.mode,
        width: next.width,
      });
      setMode(committed.mode);
      if (committed.mode === CONTROLS_SIDEBAR_MODES.DEFAULT) {
        setWidth(committed.width);
      }
      setViewWidth(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [animateToWidth, isResizing]);

  const toggleMode = () => {
    if (fullyMinimized) {
      animateToWidth(clampControlsSidebarWidth(width), CONTROLS_SIDEBAR_MODES.DEFAULT);
      return;
    }
    animateToWidth(CONTROLS_SIDEBAR.MINIMIZED_WIDTH, CONTROLS_SIDEBAR_MODES.MINIMIZED);
  };

  const startResize = (event) => {
    event.preventDefault();
    stopAnimation();
    const startMode = fullyMinimized
      ? CONTROLS_SIDEBAR_MODES.MINIMIZED
      : CONTROLS_SIDEBAR_MODES.DEFAULT;
    const startWidth = fullyMinimized
      ? CONTROLS_SIDEBAR.MINIMIZED_WIDTH
      : Math.max(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH, sidebarWidth);
    const rect = sidebarRootRef.current?.getBoundingClientRect();
    const originRight = rect?.right ?? window.innerWidth;
    const grabOffset = (rect?.left ?? event.clientX) - event.clientX;
    resizingRef.current = true;
    resizeRef.current = {
      mode: startMode,
      originRight,
      grabOffset,
      lastClientX: event.clientX,
      modeAnimating: false,
      last: {
        mode: startMode,
        width: startWidth,
      },
    };
    setViewWidth(sidebarWidth);
    setIsResizing(true);
    setHeaderHover(false);
  };

  const FocusIcon = focusStep === 'omitted'
    ? HeadphoneOff
    : (focusStep === 'solo' ? Headphones : Scale);

  const speedFormatted = formatPlaybackSpeed(playbackSpeed);
  const nextSpeedFormatted = formatPlaybackSpeed(getNextPlaybackSpeed(playbackSpeed));
  const transposeFormatted = formatPlaybackTranspose(playbackTranspose);

  const rowPaddingLeft = lerp(15, 16, progress);
  const rowGap = lerp(0, 12, progress);
  const sliderWidth = fullyMinimized ? 0 : lerp(0, 160, progress);
  const sliderOpacity = Math.max(0, (progress - 0.25) / 0.75);

  const speedRangeValue = Math.max(
    PLAYBACK_SPEED_DRAG_BOUNDS.MIN,
    Math.min(PLAYBACK_SPEED_DRAG_BOUNDS.MAX, Number(playbackSpeed) || 1)
  );
  const transposeRangeValue = Math.max(
    PLAYBACK_TRANSPOSE_BOUNDS.MIN,
    Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, Number(playbackTranspose) || 0)
  );
  const isTransposeActive = Math.abs(Number(playbackTranspose) || 0) > 1e-4;
  const isSpeedActive = Math.abs((Number(playbackSpeed) || 1) - 1) > 0.005;
  const isFocusActive = focusStep === 'omitted' || focusStep === 'solo' || Number(focusStep) !== 0;
  const isPanActive = practicePanRange !== 100 && !panControlDisabled;
  const focusReadout = formatFocusReadout(focusStep);
  const labelRowHeight = fullyMinimized ? 0 : lerp(0, 18, progress);

  const metronomePct = Math.max(0, Math.min(100, Number(metronomeVolume) || 0));
  const speedPct = Math.max(
    0,
    Math.min(
      100,
      ((speedRangeValue - PLAYBACK_SPEED_DRAG_BOUNDS.MIN)
        / (PLAYBACK_SPEED_DRAG_BOUNDS.MAX - PLAYBACK_SPEED_DRAG_BOUNDS.MIN)) * 100
    )
  );
  const transposePct = Math.max(
    0,
    Math.min(
      100,
      ((transposeRangeValue - PLAYBACK_TRANSPOSE_BOUNDS.MIN)
        / (PLAYBACK_TRANSPOSE_BOUNDS.MAX - PLAYBACK_TRANSPOSE_BOUNDS.MIN)) * 100
    )
  );

  return (
    <div
      ref={sidebarRootRef}
      className="relative shrink-0 min-h-0"
      style={{ width: sidebarWidth }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)]">
        {/* Header */}
        <div className={`relative z-10 flex h-11 min-h-11 max-h-11 shrink-0 items-center border-b border-[var(--player-border-subtle)] ${
          fullyMinimized ? 'justify-center px-1' : 'pl-2 pr-[15px]'
        }`}>
          <button
            type="button"
            onClick={toggleMode}
            onMouseEnter={() => setHeaderHover(true)}
            onMouseLeave={() => setHeaderHover(false)}
            className={`group/toggle flex items-center rounded-md py-1 text-left text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors ${
              fullyMinimized ? 'h-8 w-8 justify-center px-0' : 'min-w-0 flex-1 justify-between pl-2 pr-1.5'
            }`}
            title={fullyMinimized ? 'Expand Controls' : 'Collapse Controls'}
            aria-label={fullyMinimized ? 'Expand Controls' : 'Collapse Controls'}
          >
            {fullyMinimized ? null : (
              <span
                className="truncate text-[15px] font-bold leading-none tracking-tight text-[var(--player-text-primary)]"
                style={{
                  opacity: progress,
                  maxWidth: lerp(0, 180, progress),
                  minWidth: 0,
                  flexGrow: 0,
                  flexShrink: 1,
                  overflow: 'hidden',
                }}
              >
                Controls
              </span>
            )}
            <HeaderToggleIcon
              progress={progress}
              hovering={headerHover}
              instant={instantChrome}
              animating={isAnimating}
            />
          </button>
        </div>

        {/* Content list */}
        <div className="relative z-30 flex-1 overflow-y-auto pt-3 pb-3 flex flex-col gap-3.5">
          {/* 1. Metronome */}
          {metronomeControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-[11px] font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Metronome</span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      isMetronomeMuted ? 'text-[var(--player-text-muted)]' : 'text-[var(--player-accent-text)]'
                    }`}
                  >
                    {isMetronomeMuted ? 'Muted' : `${Math.round(metronomeVolume)}%`}
                  </span>
                </div>
              ) : null}
              <div
                className="flex items-center h-8"
                style={{
                  paddingLeft: rowPaddingLeft,
                  gap: rowGap,
                }}
              >
                <button
                  type="button"
                  onClick={onToggleMetronomeMute}
                  disabled={isRendering}
                  data-active={isMetronomeMuted ? 'false' : 'true'}
                  className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                    isMetronomeMuted
                      ? 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-muted)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                      : 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)]'
                  }`}
                  title={isMetronomeMuted ? 'Unmute metronome' : 'Mute metronome'}
                  aria-label="Metronome"
                >
                  <Metronome size={20} />
                </button>

                <div
                  className="relative h-7 shrink-0 flex items-center"
                  style={{
                    width: sliderWidth,
                    maxWidth: 160,
                    opacity: sliderOpacity,
                    overflow: progress < 1 ? 'hidden' : 'visible',
                    pointerEvents: progress > 0.8 ? 'auto' : 'none',
                  }}
                >
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={metronomeVolume}
                    readOnly
                    onMouseDown={(event) => beginSliderDrag?.(event, {
                      kind: 'metronome',
                      value: metronomeVolume,
                      min: 0,
                      max: 100,
                      step: 1,
                      disabled: isRendering,
                    })}
                    onDoubleClick={() => openSliderEdit?.('metronome', metronomeVolume, isRendering)}
                    className="w-40 h-5 player-range cursor-pointer block"
                    style={{ '--player-range-pct': `${metronomePct}%` }}
                    title="Metronome level (double-click for numeric input)"
                  />
                {sliderDragTooltip?.kind === 'metronome' && (
                  <div
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50"
                    style={{ marginBottom: '2px' }}
                  >
                    {formatSliderValue?.('metronome', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {sliderEditTooltip?.kind === 'metronome' && (
                  <input
                    type="text"
                    value={sliderEditTooltip.text}
                    onChange={(event) => setSliderEditTooltip?.((previous) => (
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
                        setSliderEditTooltip?.(null);
                      }
                    }}
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs tabular-nums rounded text-center focus:outline-none z-50"
                    style={{ marginBottom: '2px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
            </div>
          ) : null}

          {/* 2. Practice Focus */}
          {practiceControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-[11px] font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Practice Focus</span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      isFocusActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
                    }`}
                  >
                    {focusReadout}
                  </span>
                </div>
              ) : null}
              <div
                className="flex items-center h-8"
                style={{
                  paddingLeft: rowPaddingLeft,
                  gap: rowGap,
                }}
              >
                <button
                  type="button"
                  onClick={onTogglePracticeFocus}
                  disabled={focusControlDisabled}
                  data-active={isFocusActive ? 'true' : 'false'}
                  className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isFocusActive
                      ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)]'
                      : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                  }`}
                  title="Cycle practice focus: stored dB → Solo → Omitted"
                  aria-label="Practice focus"
                >
                  <FocusIcon size={20} />
                </button>

                <div
                  className="relative h-7 shrink-0"
                  style={{
                    width: sliderWidth,
                    maxWidth: 160,
                    opacity: sliderOpacity,
                    overflow: progress < 1 ? 'hidden' : 'visible',
                    pointerEvents: progress > 0.8 ? 'auto' : 'none',
                  }}
                >
                  <div
                    className={`relative w-40 h-7 ${focusControlDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    onMouseDown={(event) => {
                      if (event.detail > 1) return;
                      if (focusControlDisabled) return;
                      onFocusSliderClick?.(event);
                    }}
                    onDoubleClick={() => openSliderEdit?.('focus', practiceFocusControl, focusControlDisabled)}
                    title="Practice focus"
                  >
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--player-slider-track)] pointer-events-none z-0" />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)] z-10"
                    />
                    <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none z-10">
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--player-accent)] transition-all"
                        style={{
                          left: `${Math.min(50, focusSliderPosition)}%`,
                          width: `${Math.abs(focusSliderPosition - 50)}%`,
                        }}
                      />
                    </div>
                    <div
                      className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none z-10 transition-colors ${
                        focusStep === 'omitted'
                          ? 'bg-[var(--player-accent)] ring-2 ring-[var(--player-focus-ring)]'
                          : 'bg-[var(--player-border-strong)]'
                      }`}
                    />
                    <div
                      className={`absolute right-0 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none z-10 transition-colors ${
                        focusStep === 'solo'
                          ? 'bg-[var(--player-accent)] ring-2 ring-[var(--player-focus-ring)]'
                          : 'bg-[var(--player-border-strong)]'
                      }`}
                    />
                    <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none z-20">
                      <div
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-slider-thumb)] shadow-sm transition-transform"
                        style={{ left: `${focusSliderPosition}%` }}
                      />
                    </div>
                  {sliderDragTooltip?.kind === 'focus' && (
                    <div
                      className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50"
                      style={{ marginBottom: '2px' }}
                    >
                      {formatSliderValue?.('focus', Number(sliderDragTooltip.value))}
                    </div>
                  )}
                  {sliderEditTooltip?.kind === 'focus' && (
                    <input
                      type="text"
                      value={sliderEditTooltip.text}
                      onChange={(event) => setSliderEditTooltip?.((previous) => (
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
                          setSliderEditTooltip?.(null);
                        }
                      }}
                      className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center focus:outline-none z-50"
                      style={{ marginBottom: '2px' }}
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </div>
            </div>
          ) : null}

          {/* 3. Transformed Pan Range */}
          {practiceControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-[11px] font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Choir Width</span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      isPanActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
                    }`}
                  >
                    {panControlDisabled ? 'Fixed' : `${Math.round(practicePanRange)}%`}
                  </span>
                </div>
              ) : null}
              <div
                className="flex items-center h-8"
                style={{
                  paddingLeft: rowPaddingLeft,
                  gap: rowGap,
                }}
              >
                <button
                  type="button"
                  onClick={onTogglePracticePanRange}
                  disabled={panControlDisabled || isRendering}
                  data-active={isPanActive ? 'true' : 'false'}
                  className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isPanActive
                      ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)]'
                      : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                  }`}
                  title="Jump transformed pan range to the farthest extreme"
                  aria-label="Transformed pan range"
                >
                  <ChevronsLeftRightEllipsis size={20} />
                </button>

              <div
                className={`relative h-7 shrink-0 ${panControlDisabled ? 'opacity-40' : ''}`}
                style={{
                  width: sliderWidth,
                  maxWidth: 160,
                  opacity: sliderOpacity,
                  overflow: progress < 1 ? 'hidden' : 'visible',
                  pointerEvents: progress > 0.8 && !panControlDisabled ? 'auto' : 'none',
                }}
              >
                <div
                  className={`relative w-40 h-7 ${panControlDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  onMouseDown={(event) => {
                    if (event.detail > 1) return;
                    if (panControlDisabled) return;
                    beginSliderDrag?.(event, {
                      kind: 'pan',
                      value: practicePanRange,
                      min: 0,
                      max: 200,
                      step: 1,
                      disabled: false,
                    });
                  }}
                  onDoubleClick={() => openSliderEdit?.('pan', practicePanRange, panControlDisabled)}
                  title={panControlDisabled ? 'Transformed pan range disabled for Omitted/Solo focus' : 'Transformed pan range'}
                >
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--player-slider-track)] overflow-hidden pointer-events-none" />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)] z-10"
                  />
                  <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none overflow-hidden">
                    {(() => {
                      const panPct = Math.max(0, Math.min(100, (Number(practicePanRange) || 0) / 2));
                      return (
                        <div
                          className={`absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--player-slider-fill)] transition-opacity ${
                            showPanRangeHighlight ? 'opacity-90' : 'opacity-65'
                          }`}
                          style={{
                            left: `${Math.min(50, panPct)}%`,
                            width: `${Math.abs(panPct - 50)}%`,
                          }}
                        />
                      );
                    })()}
                  </div>
                  <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none">
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[var(--player-slider-thumb)] shadow-sm z-20"
                      style={{ left: `${practicePanKnobPixel - 6}px` }}
                    />
                    {showPanFocusAxisMarker ? (
                      <div
                        className="absolute h-2 w-2 rounded-full bg-[var(--player-accent-hover)] z-30 pointer-events-none"
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
                      className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50"
                      style={{ marginBottom: '2px' }}
                    >
                      {formatSliderValue?.('pan', Number(sliderDragTooltip.value))}
                    </div>
                  )}
                  {sliderEditTooltip?.kind === 'pan' && (
                    <input
                      type="text"
                      value={sliderEditTooltip.text}
                      onChange={(event) => setSliderEditTooltip?.((previous) => (
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
                          setSliderEditTooltip?.(null);
                        }
                      }}
                      className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs tabular-nums rounded text-center focus:outline-none z-50"
                      style={{ marginBottom: '2px' }}
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </div>
            </div>
          ) : null}

          {/* 4. Playback Speed */}
          {speedControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-[11px] font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Playback Speed</span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      isSpeedActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
                    }`}
                  >
                    {speedFormatted}x
                  </span>
                </div>
              ) : null}
              <div
                className="flex items-center h-8"
                style={{
                  paddingLeft: rowPaddingLeft,
                  gap: rowGap,
                }}
              >
                <div className="relative flex items-center justify-center shrink-0">
                  <button
                    type="button"
                    onClick={handleSpeedButtonClick}
                    disabled={isRendering}
                    data-active={isSpeedActive ? 'true' : 'false'}
                    className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                      isSpeedActive
                        ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)]'
                        : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                    }`}
                    title={`Playback speed: ${speedFormatted} (click for ${nextSpeedFormatted})`}
                    aria-label="Playback speed"
                  >
                    <Gauge size={20} />
                  </button>
                  {Boolean(flashSpeed) && fullyMinimized && (
                    <div
                      data-testid="speed-flash-badge"
                      className={`player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none transition-all duration-300 ease-out ${
                        flashFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
                      }`}
                      style={{ marginBottom: '6px' }}
                    >
                      {flashSpeed}
                    </div>
                  )}
                </div>

                <div
                  className="relative h-7 shrink-0 flex items-center"
                  style={{
                    width: sliderWidth,
                    maxWidth: 160,
                    opacity: sliderOpacity,
                    overflow: progress < 1 ? 'hidden' : 'visible',
                    pointerEvents: progress > 0.8 ? 'auto' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
                  />
                  <input
                    type="range"
                    min={PLAYBACK_SPEED_DRAG_BOUNDS.MIN}
                    max={PLAYBACK_SPEED_DRAG_BOUNDS.MAX}
                    step={PLAYBACK_SPEED_DRAG_BOUNDS.STEP}
                    value={speedRangeValue}
                    readOnly
                    onMouseDown={(event) => beginSliderDrag?.(event, {
                      kind: 'speed',
                      value: speedRangeValue,
                      min: PLAYBACK_SPEED_DRAG_BOUNDS.MIN,
                      max: PLAYBACK_SPEED_DRAG_BOUNDS.MAX,
                      step: PLAYBACK_SPEED_DRAG_BOUNDS.STEP,
                      disabled: isRendering,
                    })}
                    onDoubleClick={() => openSliderEdit?.('speed', playbackSpeed, isRendering)}
                    className="relative z-10 w-40 h-5 player-range player-range-bipolar cursor-pointer block"
                    style={{
                      '--player-bipolar-start': `${Math.min(50, speedPct)}%`,
                      '--player-bipolar-end': `${Math.max(50, speedPct)}%`,
                    }}
                    title="Playback speed (double-click for numeric input)"
                  />
                {sliderDragTooltip?.kind === 'speed' && (
                  <div
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none"
                    style={{ marginBottom: '4px' }}
                  >
                    {formatSliderValue?.('speed', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {Boolean(flashSpeed) && !fullyMinimized && !sliderDragTooltip && !sliderEditTooltip && (
                  <div
                    data-testid="speed-flash-badge"
                    className={`player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none transition-all duration-300 ease-out ${
                      flashFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
                    }`}
                    style={{ marginBottom: '4px' }}
                  >
                    {flashSpeed}
                  </div>
                )}
                {sliderEditTooltip?.kind === 'speed' && (
                  <input
                    type="text"
                    value={sliderEditTooltip.text}
                    onChange={(event) => setSliderEditTooltip?.((previous) => (
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
                        setSliderEditTooltip?.(null);
                      }
                    }}
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs tabular-nums rounded text-center focus:outline-none z-50"
                    style={{ marginBottom: '4px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
            </div>
          ) : null}

          {/* 5. Pitch Transpose - shown alongside playback speed when enabled */}
          {transposeControlsEnabled && speedControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-[11px] font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Pitch Transpose</span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      isTransposeActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
                    }`}
                  >
                    {transposeFormatted}
                  </span>
                </div>
              ) : null}
              <div
                className="flex items-center h-8"
                style={{
                  paddingLeft: rowPaddingLeft,
                  gap: rowGap,
                }}
              >
                <div className="relative flex items-center justify-center shrink-0">
                  <button
                    type="button"
                    onClick={handleTransposeButtonClick}
                    disabled={isRendering}
                    data-active={isTransposeActive ? 'true' : 'false'}
                    className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                      isTransposeActive
                        ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)]'
                        : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                    }`}
                    title={isTransposeActive
                      ? `Pitch transpose: ${transposeFormatted}`
                      : `Pitch transpose: ${transposeFormatted} (click to restore ${formatPlaybackTranspose(lastPlaybackTranspose || 1)})`}
                    aria-label="Pitch transpose"
                  >
                    <Music2 size={20} />
                  </button>
                  {Boolean(flashTranspose) && fullyMinimized && (
                    <div
                      data-testid="transpose-flash-badge"
                      className={`player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none transition-all duration-300 ease-out ${
                        flashTransposeFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
                      }`}
                      style={{ marginBottom: '6px' }}
                    >
                      {flashTranspose}
                    </div>
                  )}
                </div>

                <div
                  className="relative h-7 shrink-0 flex items-center"
                  style={{
                    width: sliderWidth,
                    maxWidth: 160,
                    opacity: sliderOpacity,
                    overflow: progress < 1 ? 'hidden' : 'visible',
                    pointerEvents: progress > 0.8 ? 'auto' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-border-strong)]"
                  />
                  <input
                    type="range"
                    min={PLAYBACK_TRANSPOSE_BOUNDS.MIN}
                    max={PLAYBACK_TRANSPOSE_BOUNDS.MAX}
                    step={PLAYBACK_TRANSPOSE_BOUNDS.STEP}
                    value={transposeRangeValue}
                    readOnly
                    onMouseDown={(event) => beginSliderDrag?.(event, {
                      kind: 'transpose',
                      value: transposeRangeValue,
                      min: PLAYBACK_TRANSPOSE_BOUNDS.MIN,
                      max: PLAYBACK_TRANSPOSE_BOUNDS.MAX,
                      step: PLAYBACK_TRANSPOSE_BOUNDS.STEP,
                      disabled: isRendering,
                    })}
                    onDoubleClick={() => openSliderEdit?.('transpose', playbackTranspose, isRendering)}
                    className="relative z-10 w-40 h-5 player-range player-range-bipolar cursor-pointer block"
                    style={{
                      '--player-bipolar-start': `${Math.min(50, transposePct)}%`,
                      '--player-bipolar-end': `${Math.max(50, transposePct)}%`,
                    }}
                    title="Pitch transpose (double-click for numeric input)"
                  />
                {sliderDragTooltip?.kind === 'transpose' && (
                  <div
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none"
                    style={{ marginBottom: '4px' }}
                  >
                    {formatSliderValue?.('transpose', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {Boolean(flashTranspose) && !fullyMinimized && !sliderDragTooltip && !sliderEditTooltip && (
                  <div
                    data-testid="transpose-flash-badge"
                    className={`player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs tabular-nums rounded text-center z-50 pointer-events-none transition-all duration-300 ease-out ${
                      flashTransposeFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
                    }`}
                    style={{ marginBottom: '4px' }}
                  >
                    {flashTranspose}
                  </div>
                )}
                {sliderEditTooltip?.kind === 'transpose' && (
                  <input
                    type="text"
                    value={sliderEditTooltip.text}
                    onChange={(event) => setSliderEditTooltip?.((previous) => (
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
                        setSliderEditTooltip?.(null);
                      }
                    }}
                    className="player-menu absolute bottom-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs tabular-nums rounded text-center focus:outline-none z-50"
                    style={{ marginBottom: '4px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
            </div>
          ) : null}

          {speedControlsEnabled && !practiceControlsEnabled && !metronomeControlsEnabled && !fullyMinimized ? (
            <p
              className="mx-3 mt-1 border-t border-[var(--player-border-subtle)] pt-3 text-[11px] leading-relaxed text-[var(--player-text-muted)]"
              style={{ opacity: sliderOpacity }}
            >
              Play a rehearsal mix to unlock focus, width, and metronome controls.
            </p>
          ) : null}

        </div>
      </div>

      {/* Resize Handle on the LEFT edge of this right sidebar */}
      <div
        role="separator"
        aria-label="Resize controls sidebar"
        onMouseDown={startResize}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => setResizeHover(false)}
        className="absolute inset-y-0 z-30 cursor-col-resize"
        style={{ right: '100%', width: RESIZE_GAP_PX }}
      >
        <div
          className={`absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full transition-colors ${
            isResizing
              ? 'bg-[var(--player-accent)]'
              : showResizeLine
                ? 'bg-[var(--player-border-strong)]'
                : 'bg-transparent'
          }`}
        />
      </div>

      {isResizing && typeof document !== 'undefined' ? createPortal(
        <div className="player-theme fixed inset-0 z-[70] cursor-col-resize" data-player-theme={playerTheme} />,
        document.body
      ) : null}
    </div>
  );
}
