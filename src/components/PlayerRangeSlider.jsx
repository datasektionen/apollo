import { useEffect, useState } from 'react';

function clamp(val, low, high) {
  return Math.max(low, Math.min(high, val));
}

export function PlayerRangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value = 0,
  percent,
  bipolar = false,
  showCenterTick = false,
  secondaryDotPercent = null,
  touch = false,
  disabled = false,
  isDragging = false,
  readOnly = false,
  onChange,
  onMouseDown,
  onDoubleClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  ariaLabel,
  title,
  className = 'w-full h-5',
}) {
  const [pointerDragging, setPointerDragging] = useState(false);

  useEffect(() => {
    if (!pointerDragging || typeof window === 'undefined') return undefined;
    const clearDrag = () => setPointerDragging(false);
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('mouseup', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('mouseup', clearDrag);
    };
  }, [pointerDragging]);

  const numericMin = Number(min);
  const numericMax = Number(max);
  const numericVal = Number(value);
  const span = numericMax - numericMin;
  const computedPct = Number.isFinite(percent)
    ? percent
    : (span > 0 && Number.isFinite(numericVal)
      ? ((numericVal - numericMin) / span) * 100
      : 0);
  const clampedPct = clamp(computedPct, 0, 100);

  const isBipolarNeutral = bipolar && Math.abs(clampedPct - 50) < 0.75;
  const shouldShowCenterTick = showCenterTick || bipolar;
  const fillLeft = bipolar ? `${Math.min(50, clampedPct)}%` : '0%';
  const fillWidth = bipolar ? `${Math.abs(clampedPct - 50)}%` : `${clampedPct}%`;
  const fillRadiusClass = bipolar
    ? (clampedPct > 50
      ? 'rounded-l-none rounded-r-full'
      : (clampedPct < 50 ? 'rounded-l-full rounded-r-none' : 'rounded-none'))
    : 'rounded-full';
  const hasSecondaryDot = secondaryDotPercent != null && !disabled && Number.isFinite(Number(secondaryDotPercent));
  const clampedDotPct = hasSecondaryDot ? clamp(Number(secondaryDotPercent), 0, 100) : 0;
  const activeDrag = Boolean(!disabled && (isDragging || pointerDragging));
  const inputModeClass = readOnly
    ? 'player-range-custom'
    : (touch ? 'player-range-native player-range-touch' : 'player-range-native');

  return (
    <div
      className={`player-slider-root relative flex items-center select-none overflow-visible ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
      data-dragging={activeDrag ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      onMouseDown={readOnly ? (event) => {
        if (!disabled) setPointerDragging(true);
        onMouseDown?.(event);
      } : undefined}
      onDoubleClick={readOnly ? onDoubleClick : undefined}
    >
      {/* Extended left/right edge hit pad for custom drag sliders so handles at 0%/100% can be grabbed comfortably */}
      {readOnly && !disabled ? (
        <div
          aria-hidden="true"
          data-slider-hitpad="true"
          className="absolute -left-2 -right-2 inset-y-0 z-20 cursor-pointer"
        />
      ) : null}

      {/* Unfilled base track */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--player-slider-track)]"
      />

      {/* Center detent tick (bipolar neutral origin pip or midpoint reference notch) */}
      {shouldShowCenterTick ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
            isBipolarNeutral
              ? 'player-slider-neutral-pip z-10 h-2.5 w-[2.5px] bg-[var(--player-slider-fill-rest)]'
              : 'z-10 h-2.5 w-[1.5px] bg-white/45'
          }`}
        />
      ) : null}

      {/* Active level bar: white at rest, metallic honey-gold on hover/drag */}
      <div
        aria-hidden="true"
        className={`player-slider-fill pointer-events-none absolute top-1/2 -translate-y-1/2 h-1 ${fillRadiusClass}`}
        style={{ left: fillLeft, width: fillWidth }}
      />

      {/* Secondary white dot (e.g. Practice Pan focus-axis indicator), shown on hover/drag */}
      {hasSecondaryDot ? (
        <div
          aria-hidden="true"
          className="player-slider-secondary-dot pointer-events-none absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm z-10"
          style={{ left: `${clampedDotPct}%` }}
        />
      ) : null}

      {/* Primary circular handle: hidden at rest, white & center-aligned on hover/drag */}
      <div
        aria-hidden="true"
        className={`player-slider-thumb pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm z-20 ${
          touch ? 'h-3.5 w-3.5' : 'h-3 w-3'
        }`}
        style={{ left: `${clampedPct}%` }}
      />

      {/* Transparent interactive range input mapped to exact visual track width */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        onChange={onChange}
        onMouseDown={readOnly ? undefined : (event) => {
          if (!disabled) setPointerDragging(true);
          onMouseDown?.(event);
        }}
        onDoubleClick={readOnly ? undefined : onDoubleClick}
        onPointerDown={readOnly ? undefined : (event) => {
          if (!disabled) setPointerDragging(true);
          onPointerDown?.(event);
        }}
        onPointerUp={readOnly ? undefined : (event) => {
          setPointerDragging(false);
          onPointerUp?.(event);
        }}
        onPointerCancel={readOnly ? undefined : (event) => {
          setPointerDragging(false);
          onPointerCancel?.(event);
        }}
        aria-label={ariaLabel}
        title={title}
        className={`player-range-overlay ${inputModeClass} absolute top-0 bottom-0 h-full z-30 ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        }`}
      />
    </div>
  );
}

export default PlayerRangeSlider;
