import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronsLeftRightEllipsis,
  Gauge,
  HeadphoneOff,
  Headphones,
  Metronome,
  PanelRightClose,
  PanelRightOpen,
  Scale,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CONTROLS_SIDEBAR,
  CONTROLS_SIDEBAR_MODES,
  PLAYBACK_SPEED_DRAG_BOUNDS,
  clampControlsSidebarWidth,
  commitControlsSidebarDrag,
  controlsSidebarProgress,
  formatPlaybackSpeed,
  getNextPlaybackSpeed,
  lerp,
  readControlsSidebarSettings,
  resolveControlsSidebarDrag,
  writeControlsSidebarSettings,
} from '../utils/playerControlsSidebar';

const HEADER_ICON_SIZE = 20;
const RESIZE_GAP_PX = 12;

function HeaderToggleIcon({ progress, hovering, instant, animating }) {
  const showHover = hovering && !instant;
  const snap = instant;
  const minimized = progress <= 0;

  const slidersOpacity = snap
    ? (minimized ? 1 : 0)
    : (showHover ? 0 : 1 - progress);
  const openOpacity = snap
    ? 0
    : (showHover ? 1 - progress : 0);
  const closeOpacity = snap
    ? 0
    : (showHover ? progress : 0);
  const slotOpen = snap ? minimized : (progress < 1 || showHover);
  const iconMotion = snap || animating ? 'none' : 'opacity 150ms linear';
  const slotMotion = snap || animating ? 'none' : 'width 150ms linear, margin 150ms linear';

  return (
    <span
      className="relative h-5 shrink-0 overflow-hidden"
      style={{
        width: slotOpen ? HEADER_ICON_SIZE : 0,
        marginLeft: slotOpen && progress > 0 ? 6 : 0,
        transition: slotMotion,
      }}
    >
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

  const resizeRef = useRef(null);
  const animRef = useRef(null);
  const sidebarWidthRef = useRef(null);
  const sidebarRootRef = useRef(null);
  const resizingRef = useRef(false);
  const flashTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);

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

  const rowPaddingLeft = lerp(15, 16, progress);
  const rowGap = lerp(0, 12, progress);
  const sliderWidth = fullyMinimized ? 0 : lerp(0, 160, progress);
  const sliderOpacity = Math.max(0, (progress - 0.25) / 0.75);

  const speedRangeValue = Math.max(
    PLAYBACK_SPEED_DRAG_BOUNDS.MIN,
    Math.min(PLAYBACK_SPEED_DRAG_BOUNDS.MAX, Number(playbackSpeed) || 1)
  );

  return (
    <div
      ref={sidebarRootRef}
      className="relative shrink-0 min-h-0"
      style={{ width: sidebarWidth }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800/80">
        {/* Header */}
        <div className={`relative z-10 flex h-11 min-h-11 max-h-11 shrink-0 items-center border-b border-gray-700 ${
          fullyMinimized ? 'justify-center px-1' : 'justify-between px-3'
        }`}>
          {fullyMinimized ? null : (
            <span
              className="truncate text-base font-semibold leading-none text-gray-200"
              style={{
                opacity: progress,
                maxWidth: lerp(0, 180, progress),
                overflow: 'hidden',
              }}
            >
              Controls
            </span>
          )}

          <button
            type="button"
            onClick={toggleMode}
            onMouseEnter={() => setHeaderHover(true)}
            onMouseLeave={() => setHeaderHover(false)}
            className={`flex items-center rounded-md py-1 text-left hover:bg-gray-700 ${
              fullyMinimized ? 'h-8 w-8 justify-center px-0' : 'p-1.5'
            }`}
            title={fullyMinimized ? 'Expand Controls' : 'Collapse Controls'}
            aria-label={fullyMinimized ? 'Expand Controls' : 'Collapse Controls'}
          >
            <HeaderToggleIcon
              progress={progress}
              hovering={headerHover}
              instant={instantChrome}
              animating={isAnimating}
            />
          </button>
        </div>

        {/* Content list: Horizontal rows with Icon to the left of the slider, no numbers displayed */}
        <div className="relative z-30 flex-1 pt-2.5 pb-3 flex flex-col gap-3">
          {/* 1. Playback Speed */}
          {speedControlsEnabled ? (
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
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors disabled:opacity-50"
                  title={`Playback speed: ${speedFormatted} (click for ${nextSpeedFormatted})`}
                  aria-label="Playback speed"
                >
                  <Gauge size={20} />
                </button>
                {Boolean(flashSpeed) && fullyMinimized && (
                  <div
                    data-testid="speed-flash-badge"
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50 pointer-events-none shadow-md transition-all duration-300 ease-out ${
                      flashFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
                    }`}
                    style={{ marginBottom: '6px' }}
                  >
                    {flashSpeed}
                  </div>
                )}
              </div>

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
                  className="w-40 h-7 volume-slider volume-slider-lg cursor-pointer block"
                  title="Playback speed (double-click for numeric input)"
                />
                {sliderDragTooltip?.kind === 'speed' && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50 pointer-events-none shadow-xl"
                    style={{ marginBottom: '4px' }}
                  >
                    {formatSliderValue?.('speed', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {Boolean(flashSpeed) && !fullyMinimized && !sliderDragTooltip && !sliderEditTooltip && (
                  <div
                    data-testid="speed-flash-badge"
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50 pointer-events-none shadow-xl transition-all duration-300 ease-out ${
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
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50 shadow-xl"
                    style={{ marginBottom: '4px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
          ) : null}

          {/* 2. Metronome */}
          {metronomeControlsEnabled ? (
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
                className={`h-8 w-8 shrink-0 flex items-center justify-center rounded transition-colors disabled:opacity-50 hover:bg-gray-700/60 ${
                  isMetronomeMuted ? 'text-gray-500' : 'text-gray-400 hover:text-gray-200'
                }`}
                title={isMetronomeMuted ? 'Unmute metronome' : 'Mute metronome'}
                aria-label="Metronome"
              >
                <Metronome size={20} />
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
                  className="w-40 h-7 volume-slider volume-slider-lg cursor-pointer block"
                  title="Metronome level (double-click for numeric input)"
                />
                {sliderDragTooltip?.kind === 'metronome' && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                    style={{ marginBottom: '1px' }}
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
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                    style={{ marginBottom: '1px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
          ) : null}

          {/* 3. Practice Focus */}
          {practiceControlsEnabled ? (
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
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                      className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                      style={{ marginBottom: '1px' }}
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* 4. Transformed Pan Range */}
          {practiceControlsEnabled ? (
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
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[26px] rounded-full bg-gray-800 border border-gray-600 overflow-hidden pointer-events-none" />
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
            isResizing ? 'bg-white/75' : showResizeLine ? 'bg-white/45' : 'bg-transparent'
          }`}
        />
      </div>

      {isResizing && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[70] cursor-col-resize" />,
        document.body
      ) : null}
    </div>
  );
}
