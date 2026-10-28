import { useEffect, useRef, useState } from 'react';
import { recordingManager } from '../lib/recordingManager';
import { createRecordingDrawJob } from '../lib/recordingWaveform';
import { getWaveformWindow, prepareWaveformCanvas, waveformRasterBudget } from '../lib/waveformRenderer';
import { waveformScheduler } from '../lib/waveformScheduler';

/** Mount INSIDE a positioned recording clip/overlay container. Only the visible window is DOM
 * geometry or a canvas backing store. All geometry is timeline CSS px.
 * Preferred contract: {startTimeMs,endTimeMs,clipLeftPx,clipWidthPx,viewportLeftPx,
 * viewportWidthPx,pixelsPerMs,height}. Times map to the current segment's latency-correct source.
 * For a rebased shell, pass clipOffsetPx: the distance from the full clip start to the shell start.
 * This offset affects placement only; never restore the full origin with a negative DOM offset.
 * Shorthand: {recordingStartMs,currentTimeMs,...}; clipLeft = start * scale - originPx (default 0).
 * The parent owns REC styling/label, placement, clipping and track visibility; this view is pre-gain,
 * fixed +/-1 with linked channel lanes and never measures a full recording or copies its PCM.
 */
export default function RecordingWaveform({
  recordingStartMs, currentTimeMs, startTimeMs = recordingStartMs, endTimeMs = currentTimeMs,
  pixelsPerMs, viewportLeftPx, viewportWidthPx, height = 80, originPx = 0, clipOffsetPx = 0,
  clipLeftPx = startTimeMs * pixelsPerMs - originPx,
  clipWidthPx = Math.max(0, (endTimeMs - startTimeMs) * pixelsPerMs),
}) {
  const canvasRef = useRef(null);
  const key = useRef({});
  const [dpr, setDpr] = useState(() => Math.max(1, globalThis.devicePixelRatio || 1));
  const view = getWaveformWindow({ clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx });
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
    let dirty = true;
    let draw;
    let generation;
    let capture;
    let segmentStart;
    let channels;
    let blocked = false;
    const run = () => {
      if (disposed) return false;
      const snapshot = recordingManager.getWaveformSnapshot();
      if (snapshot?.generation !== generation || snapshot?.capture !== capture
        || snapshot?.sourceStartFrame !== segmentStart || snapshot?.numberOfChannels !== channels) {
        draw = undefined;
        dirty = true;
        generation = snapshot?.generation;
        capture = snapshot?.capture;
        segmentStart = snapshot?.sourceStartFrame;
        channels = snapshot?.numberOfChannels;
        waveformRasterBudget.release(canvas, false);
      }
      if (!snapshot || !view.widthPx || !(pixelsPerMs > 0) || !Number.isFinite(startTimeMs + endTimeMs)) return false;
      if (!draw && dirty) {
        dirty = false;
        const context = prepareWaveformCanvas(canvas, view.widthPx, height, dpr);
        blocked = !context;
        if (!context) return false;
        const effectiveDpr = waveformRasterBudget.getAllocation(canvas).dpr;
        const sourceStartFrame = snapshot.sourceStartFrame
          + (startTimeMs - snapshot.recordingStartMs) * snapshot.sampleRate / 1000;
        draw = createRecordingDrawJob(context, {
          ...snapshot, sourceStartFrame, sourceMinFrame: snapshot.sourceStartFrame,
          sourceEndFrame: Math.min(snapshot.sourceEndFrame,
            snapshot.sourceStartFrame + (endTimeMs - snapshot.recordingStartMs) * snapshot.sampleRate / 1000),
          pixelsPerMs, leftPx: view.leftPx, widthPx: view.widthPx, height, dpr: effectiveDpr,
        });
      }
      if (draw?.()) return true;
      draw = undefined;
      return dirty;
    };
    const queue = () => { if (!disposed) cancel = waveformScheduler.schedule(key.current, run, { priority: 2 }); };
    const unsubscribe = recordingManager.subscribeWaveform(() => { dirty = true; queue(); });
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (blocked) { dirty = true; queue(); } });
    queue();
    return () => {
      disposed = true;
      cancel?.();
      unsubscribe();
      unsubscribeRaster();
      waveformRasterBudget.release(canvas);
    };
  }, [startTimeMs, endTimeMs, pixelsPerMs, height, dpr, view.leftPx, view.widthPx]);
  return <div role="img" aria-label="Live recording waveform, linear source amplitude" style={{
    position: 'absolute', left: view.widthPx ? view.leftPx - clipOffsetPx : 0, top: 0,
    width: view.widthPx, height, overflow: 'hidden', pointerEvents: 'none',
  }}>
    <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" style={{
      position: 'absolute', left: 0, top: 0, width: view.widthPx, height,
    }} />
  </div>;
}
