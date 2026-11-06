import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { recordingManager } from '../lib/recordingManager';
import { createRecordingDrawJob } from '../lib/recordingWaveform';
import { getWaveformWindow, prepareWaveformCanvas, waveformRasterBudget } from '../lib/waveformRenderer';
import { waveformScheduler } from '../lib/waveformScheduler';

function framesOf(snapshot, geometry) {
  const rate = snapshot.sampleRate;
  const spp = rate / (1000 * geometry.pixelsPerMs);
  const base = snapshot.sourceStartFrame + (geometry.startTimeMs - snapshot.recordingStartMs) * rate / 1000;
  const dataEnd = Math.min(snapshot.sourceEndFrame,
    snapshot.sourceStartFrame + (geometry.endTimeMs - snapshot.recordingStartMs) * rate / 1000);
  return {
    spp, base, dataEnd,
    viewStart: base + geometry.view.leftPx * spp,
    viewEnd: base + (geometry.view.leftPx + geometry.view.widthPx) * spp,
  };
}

/** Keep already drawn device pixels when the visible window grows or slides. */
function shiftRecordingCanvas(canvas, painted, geometry) {
  const { view, height, dpr } = geometry;
  const ratio = () => waveformRasterBudget.getAllocation(canvas)?.dpr || dpr;
  if (Math.abs(view.leftPx - painted.leftPx) < 0.5 && Math.abs(view.widthPx - painted.widthPx) < 0.5) {
    const context = canvas.getContext('2d');
    context?.setTransform(ratio(), 0, 0, ratio(), 0, 0);
    return context;
  }
  const spare = document.createElement('canvas');
  spare.width = canvas.width;
  spare.height = canvas.height;
  spare.getContext('2d')?.drawImage?.(canvas, 0, 0);
  const context = prepareWaveformCanvas(canvas, view.widthPx, height, dpr);
  if (!context) {
    waveformRasterBudget.release(spare, false);
    return null;
  }
  if (context.drawImage && spare.width) {
    context.save?.();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(spare, Math.round((painted.leftPx - view.leftPx) * ratio()), 0);
    context.restore?.();
  }
  waveformRasterBudget.release(spare, false);
  context.setTransform(ratio(), 0, 0, ratio(), 0, 0);
  return context;
}

/**
 * Draws only the frames that are not locked yet. A finished picture stays until the take grows,
 * the window slides, or a loop overwrite reports an earlier dirty frame.
 */
function planRecordingPaint(canvas, snapshot, geometry, painted) {
  const map = framesOf(snapshot, geometry);
  const paintEnd = Math.min(map.viewEnd, map.dataEnd);
  const viewLeft = geometry.view.leftPx;
  const viewWidth = geometry.view.widthPx;
  if (!(paintEnd > map.viewStart) || !(viewWidth > 0)) return null;
  const placed = {
    generation: snapshot.generation, capture: snapshot.capture, segmentStart: snapshot.sourceStartFrame,
    channels: snapshot.numberOfChannels, dpr: geometry.dpr, height: geometry.height,
    pixelsPerMs: geometry.pixelsPerMs, startTimeMs: geometry.startTimeMs,
    leftPx: viewLeft, widthPx: viewWidth, viewStart: map.viewStart,
  };
  const preserve = painted?.stable
    && map.viewStart < painted.endFrame - 0.5
    && map.viewStart >= painted.viewStart - 0.5
    && paintEnd + 0.5 >= painted.endFrame
    && viewWidth + 0.5 >= painted.widthPx;
  if (!preserve) {
    const context = prepareWaveformCanvas(canvas, viewWidth, geometry.height, geometry.dpr);
    if (!context) return { blocked: true };
    const ratio = waveformRasterBudget.getAllocation(canvas).dpr;
    const sourceStartFrame = snapshot.sourceStartFrame
      + (geometry.startTimeMs - snapshot.recordingStartMs) * snapshot.sampleRate / 1000;
    return {
      draw: createRecordingDrawJob(context, {
        ...snapshot, sourceStartFrame, sourceMinFrame: snapshot.sourceStartFrame, sourceEndFrame: map.dataEnd,
        pixelsPerMs: geometry.pixelsPerMs, leftPx: viewLeft, widthPx: viewWidth, height: geometry.height, dpr: ratio,
        displayMode: geometry.displayMode, globalPeakAmplitude: geometry.globalPeakAmplitude,
      }),
      painted: { ...placed, endFrame: map.viewStart, pendingEnd: paintEnd, stable: false },
    };
  }
  const fromFrame = Math.max(map.viewStart, painted.endFrame);
  const context = shiftRecordingCanvas(canvas, painted, geometry);
  if (!context) return { blocked: true };
  if (!(paintEnd > fromFrame + 0.01)) {
    return { painted: { ...placed, endFrame: painted.endFrame, pendingEnd: painted.endFrame, stable: true } };
  }
  const jobLeft = (fromFrame - map.base) / map.spp;
  const jobWidth = (paintEnd - fromFrame) / map.spp;
  const ratio = waveformRasterBudget.getAllocation(canvas)?.dpr || geometry.dpr;
  context.clearRect(Math.max(0, jobLeft - viewLeft), 0, viewWidth, geometry.height);
  let undoTranslate;
  if (jobLeft > viewLeft + 0.01 && context.save && context.translate) {
    context.save();
    context.translate(jobLeft - viewLeft, 0);
    undoTranslate = () => context.restore?.();
  }
  return {
    undoTranslate,
    draw: createRecordingDrawJob(context, {
      ...snapshot, sourceStartFrame: map.base,
      sourceMinFrame: Math.max(snapshot.sourceStartFrame, Math.floor(fromFrame)),
      sourceEndFrame: map.dataEnd, pixelsPerMs: geometry.pixelsPerMs,
      leftPx: jobLeft, widthPx: jobWidth, height: geometry.height, dpr: ratio,
      displayMode: geometry.displayMode, globalPeakAmplitude: geometry.globalPeakAmplitude,
    }),
    painted: { ...placed, endFrame: fromFrame, pendingEnd: paintEnd, stable: false },
  };
}

/** Mount INSIDE a positioned recording clip/overlay container. Only the visible window is DOM
 * geometry or a canvas backing store. All geometry is timeline CSS px.
 * Preferred contract: {startTimeMs,endTimeMs,clipLeftPx,clipWidthPx,viewportLeftPx,
 * viewportWidthPx,pixelsPerMs,height}. Times map to the current segment's latency-correct source.
 * For a rebased shell, pass clipOffsetPx: the distance from the full clip start to the shell start.
 * This offset affects placement only; never restore the full origin with a negative DOM offset.
 * Shorthand: {recordingStartMs,currentTimeMs,...}; clipLeft = start * scale - originPx (default 0).
 * The parent owns REC styling/label, placement, clipping and track visibility. This view is pre-gain,
 * uses the DAW amplitude scale, links channel lanes, and never measures a full recording or copies its PCM.
 */
export default function RecordingWaveform({
  recordingStartMs, currentTimeMs, startTimeMs = recordingStartMs, endTimeMs = currentTimeMs,
  pixelsPerMs, viewportLeftPx, viewportWidthPx, height = 80, originPx = 0, clipOffsetPx = 0,
  displayMode = 'linear', globalPeakAmplitude = 1,
  clipLeftPx = startTimeMs * pixelsPerMs - originPx,
  clipWidthPx = Math.max(0, (endTimeMs - startTimeMs) * pixelsPerMs),
}) {
  const canvasRef = useRef(null);
  const key = useRef({});
  const requestRef = useRef(null);
  const [dpr, setDpr] = useState(() => Math.max(1, globalThis.devicePixelRatio || 1));
  const view = getWaveformWindow({ clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx });
  const geometryRef = useRef(null);
  geometryRef.current = { view, startTimeMs, endTimeMs, pixelsPerMs, height, dpr, displayMode, globalPeakAmplitude };
  useEffect(() => {
    let media;
    const watch = () => {
      media?.removeEventListener?.('change', change);
      media = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media?.addEventListener?.('change', change);
    };
    const change = () => { setDpr(Math.max(1, window.devicePixelRatio || 1)); watch(); };
    watch();
    window.addEventListener('resize', change);
    return () => { media?.removeEventListener?.('change', change); window.removeEventListener('resize', change); };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    let cancel;
    let disposed = false;
    let draw;
    let undoTranslate;
    let blocked = false;
    let painted = null;
    let rewindTo = Infinity;
    const release = () => {
      undoTranslate?.();
      undoTranslate = undefined;
      draw = undefined;
      painted = null;
      waveformRasterBudget.release(canvas, false);
    };
    const run = () => {
      if (disposed) return false;
      const snapshot = recordingManager.getWaveformSnapshot();
      const geometry = geometryRef.current;
      const identityChanged = painted && (snapshot?.generation !== painted.generation || snapshot?.capture !== painted.capture
        || snapshot?.sourceStartFrame !== painted.segmentStart || snapshot?.numberOfChannels !== painted.channels
        || geometry.dpr !== painted.dpr || geometry.height !== painted.height || geometry.pixelsPerMs !== painted.pixelsPerMs
        || geometry.startTimeMs !== painted.startTimeMs);
      if (identityChanged) release();
      if (!snapshot || !geometry.view.widthPx || !(geometry.pixelsPerMs > 0)
        || !Number.isFinite(geometry.startTimeMs + geometry.endTimeMs)) {
        if (!snapshot) release();
        return false;
      }
      if (painted && rewindTo < painted.endFrame) {
        undoTranslate?.();
        undoTranslate = undefined;
        draw = undefined;
        if (!painted.stable || rewindTo <= framesOf(snapshot, geometry).viewStart + 0.5) painted = null;
        else painted.endFrame = rewindTo;
      }
      rewindTo = Infinity;
      if (!draw) {
        const plan = planRecordingPaint(canvas, snapshot, geometry, painted);
        blocked = Boolean(plan?.blocked);
        if (!plan || plan.blocked) return false;
        if (!plan.draw) {
          painted = plan.painted;
          return false;
        }
        draw = plan.draw;
        undoTranslate = plan.undoTranslate;
        painted = plan.painted;
      }
      if (draw()) return true;
      undoTranslate?.();
      undoTranslate = undefined;
      draw = undefined;
      if (painted) {
        painted.endFrame = painted.pendingEnd;
        painted.stable = true;
      }
      return false;
    };
    const queue = () => { if (!disposed) cancel = waveformScheduler.schedule(key.current, run, { priority: 2 }); };
    requestRef.current = queue;
    const unsubscribe = recordingManager.subscribeWaveform(() => {
      const frame = recordingManager.getWaveformSnapshot()?.dirtyFromFrame;
      if (Number.isFinite(frame)) rewindTo = Math.min(rewindTo, frame);
      queue();
    });
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (blocked) queue(); });
    queue();
    return () => {
      disposed = true;
      requestRef.current = null;
      cancel?.();
      unsubscribe();
      unsubscribeRaster();
      waveformRasterBudget.release(canvas);
    };
    // The visible window and the growing take are read from geometryRef. Restarting here would
    // clear audio that has already been drawn.
  }, [startTimeMs, pixelsPerMs, height, dpr, displayMode, globalPeakAmplitude]);
  useLayoutEffect(() => { requestRef.current?.(); }, [view.leftPx, view.widthPx, endTimeMs]);
  const amplitudeLabel = displayMode === 'db' ? 'decibel amplitude, -60 dB floor' : displayMode === 'normalized' ? 'project-normalized amplitude' : 'linear amplitude';
  return <div role="img" aria-label={`Live recording waveform, ${amplitudeLabel}`} style={{
    position: 'absolute', left: view.widthPx ? view.leftPx - clipOffsetPx : 0, top: 0,
    width: view.widthPx, height, overflow: 'hidden', pointerEvents: 'none',
  }}>
    <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" style={{
      position: 'absolute', left: 0, top: 0, width: view.widthPx, height,
    }} />
  </div>;
}
