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
import PlayerRangeSlider from './PlayerRangeSlider';
import PracticeFocusSlider from './PracticeFocusSlider';

const HEADER_ICON_SIZE = 20;
const RESIZE_GAP_PX = 10;

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
  onSetPracticeFocusControl,
  onFocusSliderClick,
  onFocusDragTooltipChange,
  practicePanRange = 100,
  visualPanRangeValue,
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
  const labelRowHeight = fullyMinimized ? 0 : lerp(0, 20, progress);

  const metronomePct = Math.max(0, Math.min(100, Number(metronomeVolume) || 0));
  const effectivePanRange = sliderDragTooltip?.kind === 'pan'
    ? Math.max(0, Math.min(200, Number(sliderDragTooltip.value) || 0))
    : Math.max(0, Math.min(200, Number(visualPanRangeValue ?? practicePanRange) || 0));
  const panPct = (effectivePanRange / 200) * 100;
  const panFocusAxisPct = ((200 - (effectivePanRange / 2)) / 200) * 100;
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
  const iconButtonClass = 'h-8 w-8 shrink-0 flex items-center justify-center text-[var(--player-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

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
                  className="flex items-center justify-between gap-2 overflow-hidden text-xs font-medium"
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
                  className={iconButtonClass}
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
                  <PlayerRangeSlider
                    min={0}
                    max={100}
                    step={1}
                    value={metronomeVolume}
                    percent={metronomePct}
                    disabled={isRendering}
                    isDragging={sliderDragTooltip?.kind === 'metronome'}
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
                    title="Metronome level (double-click for numeric input)"
                    className="w-40 h-5"
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
                  className="flex items-center justify-between gap-2 overflow-hidden text-xs font-medium"
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
                  className={iconButtonClass}
                  title="Cycle practice focus: stored dB → Solo → Omitted"
                  aria-label="Practice focus"
                >
                  <FocusIcon size={20} />
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
                  <div className="relative w-40 h-7 flex items-center">
                    <PracticeFocusSlider
                      valueIndex={practiceFocusControl}
                      disabled={focusControlDisabled}
                      onChangeIndex={onSetPracticeFocusControl}
                      onDragIndexChange={onFocusDragTooltipChange}
                      onDoubleClick={() => openSliderEdit?.('focus', practiceFocusControl, focusControlDisabled)}
                      title="Practice focus (double-click for numeric input)"
                      className="w-40"
                    />
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
                  className="flex items-center justify-between gap-2 overflow-hidden text-xs font-medium"
                  style={{
                    paddingLeft: rowPaddingLeft,
                    paddingRight: 16,
                    height: labelRowHeight,
                    opacity: sliderOpacity,
                  }}
                >
                  <span className="truncate text-[var(--player-text-secondary)]">Practice Pan</span>
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
                  className={iconButtonClass}
                  title="Jump transformed pan range to the farthest extreme"
                  aria-label="Transformed pan range"
                >
                  <ChevronsLeftRightEllipsis size={20} />
                </button>

                <div
                  className="relative h-7 shrink-0 flex items-center"
                  style={{
                    width: sliderWidth,
                    maxWidth: 160,
                    opacity: sliderOpacity,
                    overflow: progress < 1 ? 'hidden' : 'visible',
                    pointerEvents: progress > 0.8 && !panControlDisabled ? 'auto' : 'none',
                  }}
                >
                  <PlayerRangeSlider
                    min={0}
                    max={200}
                    step={1}
                    value={effectivePanRange}
                    percent={panPct}
                    bipolar
                    secondaryDotPercent={panControlDisabled ? null : panFocusAxisPct}
                    disabled={panControlDisabled}
                    isDragging={sliderDragTooltip?.kind === 'pan'}
                    readOnly
                    onMouseDown={(event) => {
                      if (event.detail > 1 || panControlDisabled) return;
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
                    title={panControlDisabled ? 'Transformed pan range disabled for Omitted/Solo focus' : 'Transformed pan range (double-click for numeric input)'}
                    className="w-40 h-5"
                  />
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
          ) : null}

          {/* 4. Playback Speed */}
          {speedControlsEnabled ? (
            <div className="flex flex-col">
              {!fullyMinimized ? (
                <div
                  className="flex items-center justify-between gap-2 overflow-hidden text-xs font-medium"
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
                    className={iconButtonClass}
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
                  <PlayerRangeSlider
                    min={PLAYBACK_SPEED_DRAG_BOUNDS.MIN}
                    max={PLAYBACK_SPEED_DRAG_BOUNDS.MAX}
                    step={PLAYBACK_SPEED_DRAG_BOUNDS.STEP}
                    value={speedRangeValue}
                    percent={speedPct}
                    bipolar
                    disabled={isRendering}
                    isDragging={sliderDragTooltip?.kind === 'speed'}
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
                    title="Playback speed (double-click for numeric input)"
                    className="w-40 h-5"
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
                  className="flex items-center justify-between gap-2 overflow-hidden text-xs font-medium"
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
                    className={iconButtonClass}
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
                  <PlayerRangeSlider
                    min={PLAYBACK_TRANSPOSE_BOUNDS.MIN}
                    max={PLAYBACK_TRANSPOSE_BOUNDS.MAX}
                    step={PLAYBACK_TRANSPOSE_BOUNDS.STEP}
                    value={transposeRangeValue}
                    percent={transposePct}
                    bipolar
                    disabled={isRendering}
                    isDragging={sliderDragTooltip?.kind === 'transpose'}
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
                    title="Pitch transpose (double-click for numeric input)"
                    className="w-40 h-5"
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

          {!metronomeControlsEnabled && !practiceControlsEnabled && !fullyMinimized ? (
            <div
              className="mx-4 mt-2 rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3.5 py-4 text-center"
              style={{ opacity: sliderOpacity }}
            >
              <SlidersHorizontal size={16} className="mx-auto mb-2 text-[var(--player-text-secondary)] opacity-80" />
              <p className="text-xs font-semibold text-[var(--player-text-primary)]">Track controls</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--player-text-secondary)]">
                Select a track to adjust Metronome, Practice Focus, and Pan.
              </p>
            </div>
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
