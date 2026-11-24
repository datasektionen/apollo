import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  getAdvancedMixPracticeFocusStep,
} from '../utils/advancedMix';

// Locked geometry constants (in SVG user units at cy = 18, track height H = 8)
const TRACK_H = 8;
const TRACK_H2 = 4;
const HANDLE_R = 10;
const STROKE_W = 2;
const STROKE_W2 = 1;
const REST_GAP = 2.5;
const CY = 18;
const VIEWBOX_H = 36;
const PAD_SVG = 10;
const DX_SOCKET = Math.sqrt((HANDLE_R * HANDLE_R) - (TRACK_H2 * TRACK_H2));
const W_CENTER = 2 * DX_SOCKET;

const NUMERIC_MIN_DB = Math.min(...ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS);
const NUMERIC_MAX_DB = Math.max(...ADVANCED_MIX_PRACTICE_FOCUS_NUMERIC_STEPS);

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function formatFocusValueText(step) {
  if (step === 'omitted') return 'Omitted';
  if (step === 'solo') return 'Solo';
  const numeric = Number(step);
  if (!Number.isFinite(numeric) || numeric === 0) return '0 dB';
  return `${numeric > 0 ? '+' : ''}${numeric} dB`;
}

export function resolveFocusVisualState(valueIndex) {
  const safeIndex = clamp(
    Math.round(Number(valueIndex) || 0),
    ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
    ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX
  );
  const step = getAdvancedMixPracticeFocusStep(safeIndex);
  if (step === 'omitted') {
    return { safeIndex, step, state: 'MIN', continuousVal: -99 };
  }
  if (step === 'solo') {
    return { safeIndex, step, state: 'MAX', continuousVal: 99 };
  }
  const numeric = Number(step) || 0;
  if (Math.abs(numeric) < 1e-6) {
    return { safeIndex, step: 0, state: 'CENTER', continuousVal: 0 };
  }
  const maxAbsDb = Math.max(Math.abs(NUMERIC_MIN_DB), Math.abs(NUMERIC_MAX_DB)) || 15;
  const continuousVal = (numeric / maxAbsDb) * 99;
  return {
    safeIndex,
    step: numeric,
    state: continuousVal < 0 ? 'NEG' : 'POS',
    continuousVal,
  };
}

export function computeFocusGeometry(trackWidthPx, scale) {
  const safeScale = Math.max(0.4, Number(scale) || 0.7);
  const safeTrackWidthPx = Math.max(110, Number(trackWidthPx) || 160);
  const trackSpanSvg = safeTrackWidthPx / safeScale;
  const trackLeft = PAD_SVG;
  const trackRight = PAD_SVG + trackSpanSvg;
  const viewWidth = trackRight + PAD_SVG;
  // Center outer sockets so outer stroke edge (R + sw/2) sits flush inside [trackLeft, trackRight]
  const cxL = trackLeft + HANDLE_R + STROKE_W2;
  const cxR = trackRight - HANDLE_R - STROKE_W2;
  const cxM = (trackLeft + trackRight) / 2;
  const leftSegRight = cxL + DX_SOCKET - (REST_GAP / 2);
  const midLeft = cxL + DX_SOCKET + (REST_GAP / 2);
  const midRight = cxR - DX_SOCKET - (REST_GAP / 2);
  const rightSegLeft = cxR - DX_SOCKET + (REST_GAP / 2);
  // Align continuous handle travel ends directly with the unhovered rest bar ends
  const handleMinX = midLeft;
  const handleMaxX = midRight;

  return {
    trackLeft,
    trackRight,
    viewWidth,
    cxL,
    cxR,
    cxM,
    leftSegRight,
    midLeft,
    midRight,
    rightSegLeft,
    handleMinX,
    handleMaxX,
  };
}

function buildNearestNumericStepIndex(continuousVal) {
  const maxAbsDb = Math.max(Math.abs(NUMERIC_MIN_DB), Math.abs(NUMERIC_MAX_DB)) || 15;
  const targetDb = (continuousVal / 99) * maxAbsDb;
  const allowedIndices = [];
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS.forEach((step, idx) => {
    if (typeof step !== 'number') return;
    if (continuousVal < 0 && step < 0) allowedIndices.push(idx);
    if (continuousVal > 0 && step > 0) allowedIndices.push(idx);
  });
  if (!allowedIndices.length) return ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
  let bestIndex = allowedIndices[0];
  let bestDistance = Math.abs(ADVANCED_MIX_PRACTICE_FOCUS_STEPS[bestIndex] - targetDb);
  for (let i = 1; i < allowedIndices.length; i += 1) {
    const idx = allowedIndices[i];
    const dist = Math.abs(ADVANCED_MIX_PRACTICE_FOCUS_STEPS[idx] - targetDb);
    if (dist < bestDistance) {
      bestIndex = idx;
      bestDistance = dist;
    }
  }
  return bestIndex;
}

export function PracticeFocusSlider({
  valueIndex = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  disabled = false,
  touch = false,
  onChangeIndex,
  onDragIndexChange,
  onDoubleClick,
  ariaLabel = 'Practice focus slider',
  inputAriaLabel,
  title = 'Practice focus',
  className = 'w-full',
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dragPointerIdRef = useRef(null);
  const movedDuringDragRef = useRef(false);
  const startClientXRef = useRef(0);
  const pointerFocusingRef = useRef(false);
  const rawShadowId = useId();
  const shadowFilterId = useMemo(
    () => `player-focus-shadow-${rawShadowId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [rawShadowId]
  );

  const scale = touch ? 0.85 : 0.72;
  const fallbackWidthPx = touch ? 260 : 160;
  const [measuredWidthPx, setMeasuredWidthPx] = useState(fallbackWidthPx);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const measure = () => {
      const nextWidth = node.getBoundingClientRect().width;
      if (Number.isFinite(nextWidth) && nextWidth > 0) {
        setMeasuredWidthPx(nextWidth);
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(node);
      return () => ro.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    return undefined;
  }, []);

  const geometry = useMemo(
    () => computeFocusGeometry(measuredWidthPx, scale),
    [measuredWidthPx, scale]
  );
  const visual = useMemo(() => resolveFocusVisualState(valueIndex), [valueIndex]);

  const toSvgX = useCallback((clientX) => {
    const svg = svgRef.current;
    if (!svg) return geometry.cxM;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return geometry.cxM;
    return ((clientX - rect.left) / rect.width) * geometry.viewWidth;
  }, [geometry.cxM, geometry.viewWidth]);

  const resolveClickIndex = useCallback((svgX) => {
    if (svgX <= geometry.leftSegRight + (REST_GAP / 2)) {
      return ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX;
    }
    if (svgX >= geometry.rightSegLeft - (REST_GAP / 2)) {
      return ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX;
    }
    if (Math.abs(svgX - geometry.cxM) <= Math.max(5, W_CENTER / 2)) {
      return ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
    }
    if (svgX < geometry.cxM) {
      const halfSpan = Math.max(1, geometry.cxM - geometry.handleMinX);
      const val = -clamp(((geometry.cxM - svgX) / halfSpan) * 99, 1, 99);
      return buildNearestNumericStepIndex(val);
    }
    const halfSpan = Math.max(1, geometry.handleMaxX - geometry.cxM);
    const val = clamp(((svgX - geometry.cxM) / halfSpan) * 99, 1, 99);
    return buildNearestNumericStepIndex(val);
  }, [geometry]);

  const resolveDragIndex = useCallback((svgX) => {
    if (svgX <= geometry.cxL + 4) {
      return ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX;
    }
    if (svgX >= geometry.cxR - 4) {
      return ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX;
    }
    if (Math.abs(svgX - geometry.cxM) <= 5) {
      return ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
    }
    if (svgX < geometry.cxM) {
      const halfSpan = Math.max(1, geometry.cxM - geometry.handleMinX);
      const val = -clamp(((geometry.cxM - svgX) / halfSpan) * 99, 1, 99);
      return buildNearestNumericStepIndex(val);
    }
    const halfSpan = Math.max(1, geometry.handleMaxX - geometry.cxM);
    const val = clamp(((svgX - geometry.cxM) / halfSpan) * 99, 1, 99);
    return buildNearestNumericStepIndex(val);
  }, [geometry]);

  const emitChange = useCallback((nextIndex, notifyDrag = true) => {
    const safeNext = clamp(
      Math.round(Number(nextIndex) || 0),
      ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
      ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX
    );
    onChangeIndex?.(safeNext);
    if (notifyDrag) {
      onDragIndexChange?.(safeNext);
    }
  }, [onChangeIndex, onDragIndexChange]);

  const handlePointerDown = (event) => {
    if (disabled) return;
    if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.detail > 1) return;
    event.preventDefault();
    pointerFocusingRef.current = true;
    setFocusVisible(false);
    containerRef.current?.focus({ preventScroll: true });
    pointerFocusingRef.current = false;
    dragPointerIdRef.current = event.pointerId ?? 'mouse';
    movedDuringDragRef.current = false;
    startClientXRef.current = event.clientX;
    setDragging(true);
    try {
      svgRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore capture failure on synthetic test events
    }
    const svgX = toSvgX(event.clientX);
    emitChange(resolveClickIndex(svgX), true);
  };

  const handlePointerMove = (event) => {
    if (disabled || !dragging) return;
    if (Math.abs(event.clientX - startClientXRef.current) >= 2) {
      movedDuringDragRef.current = true;
    }
    const svgX = toSvgX(event.clientX);
    const nextIdx = movedDuringDragRef.current
      ? resolveDragIndex(svgX)
      : resolveClickIndex(svgX);
    emitChange(nextIdx, true);
  };

  const finishDrag = useCallback((event) => {
    if (!dragging) return;
    if (event?.pointerId != null) {
      try {
        svgRef.current?.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
    }
    dragPointerIdRef.current = null;
    setDragging(false);
    onDragIndexChange?.(null);
  }, [dragging, onDragIndexChange]);

  useEffect(() => {
    if (!dragging || typeof window === 'undefined') return undefined;
    const handleGlobalUp = () => finishDrag();
    window.addEventListener('pointerup', handleGlobalUp);
    window.addEventListener('pointercancel', handleGlobalUp);
    window.addEventListener('mouseup', handleGlobalUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalUp);
      window.removeEventListener('pointercancel', handleGlobalUp);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, [dragging, finishDrag]);

  const handleKeyDown = (event) => {
    if (disabled) return;
    const stepSize = event.shiftKey ? 3 : 1;
    let nextIndex = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextIndex = Math.max(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX, visual.safeIndex - stepSize);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextIndex = Math.min(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX, visual.safeIndex + stepSize);
    } else if (event.key === 'Home') {
      nextIndex = ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX;
    } else if (event.key === 'End') {
      nextIndex = ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX;
    } else if (event.key === '0') {
      nextIndex = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      emitChange(nextIndex, false);
    }
  };

  const isHoverLayerVisible = !disabled && (hovered || dragging || focusVisible);
  const svgHeightPx = Math.round(VIEWBOX_H * scale * 100) / 100;
  const padPx = Math.round(PAD_SVG * scale * 100) / 100;
  const transitionStyle = 'opacity 150ms cubic-bezier(0.2, 0.8, 0.2, 1)';

  // Rest geometry calculations
  const yTop = CY - TRACK_H2;
  const yBot = CY + TRACK_H2;
  const leftTipX = geometry.trackLeft + TRACK_H2;
  const rightTipX = geometry.trackRight - TRACK_H2;
  const leftCapPath = `M ${geometry.leftSegRight} ${yTop} L ${leftTipX} ${yTop} A ${TRACK_H2} ${TRACK_H2} 0 0 0 ${leftTipX} ${yBot} L ${geometry.leftSegRight} ${yBot} Z`;
  const rightCapPath = `M ${geometry.rightSegLeft} ${yTop} L ${rightTipX} ${yTop} A ${TRACK_H2} ${TRACK_H2} 0 0 1 ${rightTipX} ${yBot} L ${geometry.rightSegLeft} ${yBot} Z`;

  // Special MIN/MAX inset cap paths (1px inset on all 4 sides, sw = 2 miter)
  const insetYTop = CY - (TRACK_H2 - STROKE_W2);
  const insetYBot = CY + (TRACK_H2 - STROKE_W2);
  const insetArcR = TRACK_H2 - STROKE_W2;
  const leftActiveCapPath = `M ${geometry.leftSegRight - STROKE_W2} ${insetYTop} L ${leftTipX} ${insetYTop} A ${insetArcR} ${insetArcR} 0 0 0 ${leftTipX} ${insetYBot} L ${geometry.leftSegRight - STROKE_W2} ${insetYBot} Z`;
  const rightActiveCapPath = `M ${geometry.rightSegLeft + STROKE_W2} ${insetYTop} L ${rightTipX} ${insetYTop} A ${insetArcR} ${insetArcR} 0 0 1 ${rightTipX} ${insetYBot} L ${geometry.rightSegLeft + STROKE_W2} ${insetYBot} Z`;

  // Continuous rest fill rect
  let restFillRect = null;
  if (visual.state === 'NEG' || visual.state === 'POS') {
    const midHalfSpan = Math.max(1.5, (geometry.midRight - geometry.midLeft) / 2);
    const fillW = Math.max(1.5, (Math.abs(visual.continuousVal) / 99) * midHalfSpan);
    const fillX = visual.continuousVal < 0 ? geometry.cxM - fillW : geometry.cxM;
    restFillRect = { x: fillX, width: fillW };
  }

  // Hover handle X & gold fill rect
  let hoverHandleX = geometry.cxM;
  let hoverGoldRect = null;
  if (visual.state === 'MIN') {
    hoverHandleX = geometry.cxL;
  } else if (visual.state === 'MAX') {
    hoverHandleX = geometry.cxR;
  } else if (visual.state === 'NEG' || visual.state === 'POS') {
    const hoverHalfSpan = Math.max(1, (geometry.handleMaxX - geometry.handleMinX) / 2);
    hoverHandleX = geometry.cxM + ((visual.continuousVal / 99) * hoverHalfSpan);
    hoverGoldRect = {
      x: Math.min(geometry.cxM, hoverHandleX),
      width: Math.abs(hoverHandleX - geometry.cxM),
    };
  }

  const isSpecialState = visual.state === 'MIN' || visual.state === 'CENTER' || visual.state === 'MAX';

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX}
      aria-valuemax={ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX}
      aria-valuenow={visual.safeIndex}
      aria-valuetext={formatFocusValueText(visual.step)}
      aria-disabled={disabled ? 'true' : undefined}
      title={title}
      data-focus-state={visual.state}
      data-hovered={isHoverLayerVisible ? 'true' : 'false'}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        if (!disabled && !pointerFocusingRef.current) setFocusVisible(true);
      }}
      onBlur={() => setFocusVisible(false)}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => {
        if (!disabled) onDoubleClick?.();
      }}
      className={`relative flex items-center select-none overflow-visible focus:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      style={{ height: svgHeightPx }}
    >
      {inputAriaLabel ? (
        <input
          type="range"
          min={ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX}
          max={ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX}
          step={1}
          value={visual.safeIndex}
          disabled={disabled}
          onChange={(e) => emitChange(Number(e.target.value), false)}
          aria-label={inputAriaLabel}
          className="sr-only"
          tabIndex={-1}
        />
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${geometry.viewWidth} ${VIEWBOX_H}`}
        shapeRendering="geometricPrecision"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className="block overflow-visible"
        style={{
          position: 'relative',
          left: -padPx,
          width: `calc(100% + ${padPx * 2}px)`,
          height: svgHeightPx,
          flexShrink: 0,
        }}
      >
        <defs>
          <filter id={shadowFilterId} x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.6" floodColor="#000000" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* REST LAYER (cross-fades smoothly over 150ms) */}
        <g
          data-layer="rest"
          style={{
            opacity: isHoverLayerVisible ? 0 : 1,
            transition: transitionStyle,
            pointerEvents: 'none',
          }}
        >
          {/* Three unfilled base segments separated by exact 2.5px host background gaps */}
          <path d={leftCapPath} fill="var(--player-focus-track)" />
          <rect
            x={geometry.midLeft}
            y={yTop}
            width={Math.max(0, geometry.midRight - geometry.midLeft)}
            height={TRACK_H}
            fill="var(--player-focus-track)"
          />
          <path d={rightCapPath} fill="var(--player-focus-track)" />

          {/* Rest progress fill for continuous range */}
          {restFillRect ? (
            <rect
              x={restFillRect.x}
              y={yTop}
              width={restFillRect.width}
              height={TRACK_H}
              fill="var(--player-focus-fill-rest)"
            />
          ) : null}

          {/* Special MIN outer cap (white interior + 2px honey-gold outline) */}
          {visual.state === 'MIN' ? (
            <path
              d={leftActiveCapPath}
              fill="var(--player-focus-fill-rest)"
              stroke="var(--player-focus-accent)"
              strokeWidth={STROKE_W}
              strokeLinejoin="miter"
            />
          ) : null}

          {/* Special MAX outer cap */}
          {visual.state === 'MAX' ? (
            <path
              d={rightActiveCapPath}
              fill="var(--player-focus-fill-rest)"
              stroke="var(--player-focus-accent)"
              strokeWidth={STROKE_W}
              strokeLinejoin="miter"
            />
          ) : null}

          {/* Special CENTER 0% inset pill directly atop center track with zero gap */}
          {visual.state === 'CENTER' ? (
            <rect
              x={geometry.cxM - (W_CENTER / 2) + STROKE_W2}
              y={insetYTop}
              width={W_CENTER - STROKE_W}
              height={TRACK_H - STROKE_W}
              rx={3}
              ry={3}
              fill="var(--player-focus-fill-rest)"
              stroke="var(--player-focus-accent)"
              strokeWidth={STROKE_W}
            />
          ) : null}
        </g>

        {/* HOVER / DRAG LAYER (strict bottom-to-top Z-order) */}
        <g
          data-layer="hover"
          style={{
            opacity: isHoverLayerVisible ? 1 : 0,
            transition: transitionStyle,
            pointerEvents: 'none',
          }}
        >
          {/* 1. Continuous track base spanning [cxL, cxR] */}
          <rect
            x={geometry.cxL}
            y={yTop}
            width={Math.max(0, geometry.cxR - geometry.cxL)}
            height={TRACK_H}
            fill="var(--player-focus-track)"
          />

          {/* 2. Active gold progress line (ONLY in NEG / POS continuous range) */}
          {hoverGoldRect ? (
            <rect
              x={hoverGoldRect.x}
              y={yTop}
              width={hoverGoldRect.width}
              height={TRACK_H}
              fill="var(--player-focus-accent)"
            />
          ) : null}

          {/* 3. Left & right circular socket outlines (never at cxM, omit active MIN/MAX side) */}
          {visual.state !== 'MIN' ? (
            <circle
              cx={geometry.cxL}
              cy={CY}
              r={HANDLE_R}
              fill="var(--player-focus-surface)"
              stroke="var(--player-focus-socket-stroke)"
              strokeWidth={STROKE_W}
            />
          ) : null}
          {visual.state !== 'MAX' ? (
            <circle
              cx={geometry.cxR}
              cy={CY}
              r={HANDLE_R}
              fill="var(--player-focus-surface)"
              stroke="var(--player-focus-socket-stroke)"
              strokeWidth={STROKE_W}
            />
          ) : null}

          {/* 4. Active circular handle */}
          <circle
            cx={hoverHandleX}
            cy={CY}
            r={HANDLE_R}
            fill="var(--player-focus-fill-rest)"
            stroke={isSpecialState ? 'var(--player-focus-accent)' : 'none'}
            strokeWidth={isSpecialState ? STROKE_W : 0}
            filter={isSpecialState ? undefined : `url(#${shadowFilterId})`}
          />
        </g>
      </svg>
    </div>
  );
}

export default PracticeFocusSlider;
