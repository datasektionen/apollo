import { useEffect, useRef, useState } from 'react';
import { audioManager } from '../lib/audioManager';
import { waveformScheduler } from '../lib/waveformScheduler';
import { createWaveformDrawJob, getWaveformWindow, prepareWaveformCanvas, waveformRasterBudget, WAVEFORM_OVERSCAN_PX } from '../lib/waveformRenderer';
import { getWaveformRenderer } from '../lib/waveformFeature';
import LegacyWaveform from './LegacyWaveform';
import { useWaveformSources, useWaveformViewport } from './Waveform';

const EMPTY_CLIPS = [];
const ACTIVITY_COLOR = 'rgba(123, 173, 255, 0.55)';
const MISSING_COLOR = 'rgba(248, 113, 113, 0.55)';
const flaggedMissing = (ids, id) => Boolean(ids?.has?.(id) || (Array.isArray(ids) && ids.includes(id)));

/** Parent supplies mute-filtered/edit-preview clips. Layered source activity is NOT mixed output. */
function ModernGroupWaveform({
  clips = EMPTY_CLIPS, pixelsPerMs, viewportLeftPx = 0, viewportWidthPx = 0, height = 80,
  globalPeakAmplitude = 1, displayMode = 'linear', showRms = false, showClipping = false,
  missingMediaBlobIds,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const key = useRef({});
  const buffersRef = useRef([]);
  const buffers = clips.map((clip) => audioManager.mediaCache.get(clip.blobId));
  if (buffers.length !== buffersRef.current.length || buffers.some((buffer, index) => buffer !== buffersRef.current[index])) {
    buffersRef.current = buffers;
  }
  const mediaBuffers = buffersRef.current;
  const [status, setStatus] = useState('loading');
  const view = useWaveformViewport(containerRef, {
    clipLeftPx: 0, clipWidthPx: Math.max(0, viewportLeftPx + viewportWidthPx + WAVEFORM_OVERSCAN_PX),
    viewportLeftPx, viewportWidthPx,
  });
  const visible = view.widthPx > 0 ? clips.filter((clip) => clip.startMs * pixelsPerMs < view.leftPx + view.widthPx
    && (clip.startMs + clip.durationMs) * pixelsPerMs > view.leftPx) : EMPTY_CLIPS;
  const { observerRef, requestRef } = useWaveformSources(
    () => visible.map((clip) => ({ blobId: clip.blobId, audioBuffer: audioManager.mediaCache.get(clip.blobId) })),
    0, audioManager.mediaCache,
  );
  useEffect(() => {
    let cancel;
    let disposed = false;
    let context;
    let dpr;
    let index = 0;
    let draw;
    let pending = false;
    let failed = false;
    let missing = false;
    let complete = false;
    let refreshNeeded = false;
    let rasterBlocked = false;
    const canvas = canvasRef.current;
    const observer = observerRef.current;
    const reset = () => {
      context = undefined;
      index = 0;
      draw = undefined;
      pending = failed = missing = complete = refreshNeeded = false;
      waveformRasterBudget.release(canvas);
      setStatus('loading');
    };
    const run = (budget) => {
      if (disposed) return false;
      const update = observer.read();
      if (update.stale) reset();
      else if (update.changed && (context || complete)) refreshNeeded = true;
      // New summaries don't restart the current pass. Even a flood of ready notifications
      // lets every clip finish before one coalesced refresh. Replacements clear stale pixels.
      if (complete) {
        if (refreshNeeded) reset();
        else return observer.dirty;
      }
      if (!view.widthPx) return observer.dirty;
      if (!context) {
        context = prepareWaveformCanvas(canvas, view.widthPx, height, view.dpr);
        rasterBlocked = !context;
        if (!context) { setStatus('limited'); return false; }
        dpr = waveformRasterBudget.getAllocation(canvas).dpr;
      }
      if (draw) {
        if (draw(budget)) return true;
        draw = undefined;
        index += 1;
        return true;
      }
      if (index >= visible.length) {
        complete = true;
        setStatus(failed ? 'error' : pending ? 'loading' : missing ? 'missing' : 'ready');
        return refreshNeeded || observer.dirty;
      }
      const clip = visible[index];
      const { audioBuffer, source } = update.snapshots.get(clip.blobId) || {};
      const isMissing = flaggedMissing(missingMediaBlobIds, clip.blobId) || !audioBuffer;
      missing ||= isMissing;
      const left = Math.max(0, clip.startMs * pixelsPerMs - view.leftPx);
      const right = Math.min(view.widthPx, (clip.startMs + clip.durationMs) * pixelsPerMs - view.leftPx);
      if (!audioBuffer) {
        context.fillStyle = MISSING_COLOR;
        context.fillRect(left, height / 2 - 2, Math.max(0, right - left), 4);
        index += 1;
        return true;
      }
      const detail = audioBuffer.sampleRate / (1000 * pixelsPerMs * dpr) <= 1;
      if (!source?.pyramid && !detail) {
        failed ||= source?.status === 'error';
        pending ||= source?.status !== 'error';
        context.fillStyle = isMissing ? MISSING_COLOR : 'rgba(148, 163, 184, 0.35)';
        context.fillRect(left, height / 2, Math.max(0, right - left), 1);
        index += 1;
        return true;
      }
      draw = createWaveformDrawJob(context, {
        audioBuffer, pyramid: source?.pyramid, cropStartMs: clip.cropStartMs,
        cropEndMs: clip.cropEndMs ?? clip.sourceDurationMs,
        pixelsPerMs, clipLeftPx: clip.startMs * pixelsPerMs, clipWidthPx: clip.durationMs * pixelsPerMs,
        surfaceLeftPx: view.leftPx, surfaceWidthPx: view.widthPx, height, dpr,
        color: isMissing ? MISSING_COLOR : ACTIVITY_COLOR, displayMode, globalPeakAmplitude, showRms, showClipping,
      });
      return true;
    };
    const queue = () => { if (!disposed) cancel = waveformScheduler.schedule(key.current, run); };
    requestRef.current = queue;
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (rasterBlocked) queue(); });
    observer.invalidate();
    setStatus('loading');
    queue();
    return () => {
      disposed = true;
      requestRef.current = null;
      cancel?.();
      unsubscribeRaster();
      waveformRasterBudget.release(canvas);
    };
  }, [clips, mediaBuffers, pixelsPerMs, height, globalPeakAmplitude, displayMode, showRms, showClipping,
    missingMediaBlobIds, view.leftPx, view.widthPx, view.dpr]);

  const label = `Group activity overview (not mixed output)${status === 'missing' ? ', missing media' : status === 'error' ? ', waveform unavailable' : status === 'limited' ? ', raster memory limit' : status === 'loading' ? ', loading waveforms' : ''}${showClipping ? ', source over-range indicators' : ''}`;
  return (
    <div ref={containerRef} role="img" aria-label={label} aria-busy={status === 'loading'} data-waveform-status={status}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" draggable={false}
        style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, height, WebkitUserDrag: 'none' }} />
      {(status === 'loading' || status === 'error' || status === 'limited') && view.widthPx > 0 && <span aria-hidden="true"
        style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, overflow: 'hidden', fontSize: 10, opacity: 0.65 }}>
        {status === 'error' ? 'Group waveform unavailable' : status === 'limited' ? 'Group waveform hidden: raster memory limit' : 'Loading group activity'}
      </span>}
    </div>
  );
}

function LegacyGroupWaveform({
  clips = EMPTY_CLIPS, pixelsPerMs, viewportLeftPx = 0, viewportWidthPx = 0,
  height = 80, globalPeakAmplitude = 1, missingMediaBlobIds,
}) {
  const [mediaVersion, setMediaVersion] = useState(0);
  const visible = pixelsPerMs > 0 ? clips.map((clip) => {
    const clipLeftPx = clip.startMs * pixelsPerMs;
    const window = getWaveformWindow({
      clipLeftPx, clipWidthPx: clip.durationMs * pixelsPerMs, viewportLeftPx, viewportWidthPx,
    });
    return { clip, clipLeftPx, ...window };
  }).filter(({ widthPx }) => widthPx > 0) : EMPTY_CLIPS;
  useEffect(() => {
    const ids = new Set(visible.map(({ clip }) => clip.blobId));
    return audioManager.mediaCache.subscribe?.((event) => {
      if (event?.blobId == null || ids.has(event.blobId)) setMediaVersion((version) => version + 1);
    });
  }, [clips, pixelsPerMs, viewportLeftPx, viewportWidthPx]);
  const missing = visible.some(({ clip }) => flaggedMissing(missingMediaBlobIds, clip.blobId)
    || !audioManager.mediaCache.has(clip.blobId));
  return (
    <div role="img" aria-label={`Legacy group activity overview (not mixed output)${missing ? ', missing media' : ''}`}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}>
      {visible.map(({ clip, clipLeftPx, leftPx, widthPx }) => {
        const audioBuffer = audioManager.mediaCache.get(clip.blobId);
        const isMissing = flaggedMissing(missingMediaBlobIds, clip.blobId) || !audioBuffer;
        const cropStartMs = (clip.cropStartMs ?? 0) + leftPx / pixelsPerMs;
        const cropEndMs = Math.min(
          clip.cropEndMs ?? clip.sourceDurationMs ?? (audioBuffer ? audioBuffer.length / audioBuffer.sampleRate * 1000 : Infinity),
          cropStartMs + widthPx / pixelsPerMs,
        );
        return (
          <div key={`${clip.key}:${mediaVersion}`} data-legacy-clip={clip.key}
            style={{ position: 'absolute', left: clipLeftPx + leftPx, width: widthPx, height,
              overflow: 'hidden', backgroundColor: isMissing && !audioBuffer ? MISSING_COLOR : undefined }}>
            {audioBuffer && <LegacyWaveform audioBuffer={audioBuffer} clipId={`group:${clip.key}`}
              cropStartMs={cropStartMs} cropEndMs={cropEndMs} sourceDurationMs={clip.sourceDurationMs}
              height={height} color={isMissing ? MISSING_COLOR : ACTIVITY_COLOR}
              globalPeakAmplitude={globalPeakAmplitude} />}
          </div>
        );
      })}
    </div>
  );
}

export default function GroupWaveform(props) {
  const Renderer = getWaveformRenderer() === 'legacy' ? LegacyGroupWaveform : ModernGroupWaveform;
  return <Renderer {...props} />;
}
