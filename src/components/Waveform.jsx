import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { waveformService } from '../lib/waveformService';
import { waveformScheduler } from '../lib/waveformScheduler';
import { getWaveformRenderer } from '../lib/waveformFeature';
import LegacyWaveform from './LegacyWaveform';
import {
  createWaveformDrawJob, createWaveformSourceObserver, getWaveformWindow,
  prepareWaveformCanvas, waveformRasterBudget,
} from '../lib/waveformRenderer';

/** Legacy callers can omit geometry. Only this compatibility path measures ancestors. */
export function useWaveformViewport(containerRef, geometry) {
  const explicit = Object.values(geometry).every(Number.isFinite);
  const [measured, setMeasured] = useState({ clipLeftPx: 0, clipWidthPx: 0, viewportLeftPx: 0, viewportWidthPx: 0 });
  const [dpr, setDpr] = useState(() => Math.max(1, window.devicePixelRatio || 1));
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const key = {};
    let cancel;
    let media;
    const ancestors = [];
    for (let node = container.parentElement; node; node = node.parentElement) ancestors.push(node);
    const measure = () => {
      setDpr(Math.max(1, window.devicePixelRatio || 1));
      if (explicit) return;
      const bounds = container.getBoundingClientRect();
      let left = 0;
      let right = window.innerWidth;
      for (const node of ancestors) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX}`)) {
          const rect = node.getBoundingClientRect();
          left = Math.max(left, rect.left);
          right = Math.min(right, rect.left + node.clientWidth);
        }
      }
      const next = { clipLeftPx: bounds.left, clipWidthPx: bounds.width, viewportLeftPx: left, viewportWidthPx: Math.max(0, right - left) };
      setMeasured((previous) => Object.keys(next).every((name) => next[name] === previous[name]) ? previous : next);
    };
    const invalidate = () => { cancel?.(); cancel = waveformScheduler.schedule(key, measure, { priority: 2 }); };
    const watchDpr = () => {
      media?.removeEventListener?.('change', onDpr);
      media = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media?.addEventListener?.('change', onDpr);
    };
    const onDpr = () => { invalidate(); watchDpr(); };
    measure();
    watchDpr();
    window.addEventListener('resize', invalidate);
    let observer;
    if (!explicit) {
      window.addEventListener('scroll', invalidate, true);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(invalidate);
        observer.observe(container);
        ancestors.forEach((node) => observer.observe(node));
      }
    }
    return () => {
      cancel?.();
      observer?.disconnect();
      media?.removeEventListener?.('change', onDpr);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('scroll', invalidate, true);
    };
  }, [containerRef, explicit]);
  const resolved = explicit ? geometry : measured;
  return { ...resolved, ...getWaveformWindow(resolved), dpr };
}

/** Keep pins across appearance/geometry effects; refresh bindings in scheduled slices. */
export function useWaveformSources(getSources, priority, mediaCache) {
  const sourcesRef = useRef(getSources);
  sourcesRef.current = getSources;
  const observerRef = useRef(null);
  const requestRef = useRef(null);
  useLayoutEffect(() => {
    const observer = createWaveformSourceObserver({
      service: waveformService, getSources: () => sourcesRef.current(), priority,
      subscribeMedia: mediaCache?.subscribe ? (listener) => mediaCache.subscribe(listener) : undefined,
      onChange: () => requestRef.current?.(),
    });
    observerRef.current = observer;
    return () => { observerRef.current = null; observer.dispose(); };
  }, [priority, mediaCache]);
  return { observerRef, requestRef };
}

function ModernWaveform({
  audioBuffer, blobId, clipId, cropStartMs = 0, cropEndMs, sourceDurationMs,
  height = 80, color = '#4F8EF7', onReady, globalPeakAmplitude = 1,
  pixelsPerMs, clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx,
  displayMode = 'linear', showRms = false, showClipping = false, showSamples = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const key = useRef({});
  const readyRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [status, setStatus] = useState('loading');
  const view = useWaveformViewport(containerRef, { clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx });
  const endMs = cropEndMs ?? sourceDurationMs ?? (audioBuffer ? audioBuffer.length / audioBuffer.sampleRate * 1000 : 0);
  const scale = pixelsPerMs > 0 ? pixelsPerMs : view.clipWidthPx / (endMs - cropStartMs);
  const { observerRef, requestRef } = useWaveformSources(
    () => view.widthPx > 0 && audioBuffer ? [{ blobId, audioBuffer }] : [], 1,
  );
  useEffect(() => {
    let cancel;
    let disposed = false;
    let draw;
    let complete = false;
    let rasterBlocked = false;
    const canvas = canvasRef.current;
    const observer = observerRef.current;
    const run = (budget) => {
      if (disposed) return false;
      const update = observer.read();
      if (update.stale) {
        draw = undefined;
        complete = false;
        waveformRasterBudget.release(canvas);
        setStatus('loading');
      }
      if (complete) return observer.dirty;
      if (!audioBuffer) { setStatus('missing'); return false; }
      if (!view.widthPx) return observer.dirty;
      if (!draw) {
        const source = update.snapshots.get(blobId)?.source;
        const context = prepareWaveformCanvas(canvas, view.widthPx, height, view.dpr);
        rasterBlocked = !context;
        if (!context) { setStatus('limited'); return false; }
        const dpr = waveformRasterBudget.getAllocation(canvas).dpr;
        const detail = audioBuffer.sampleRate / (1000 * scale * dpr) <= 1;
        if (!source?.pyramid && !detail) {
          setStatus(source?.status === 'error' ? 'error' : 'loading');
          return observer.dirty;
        }
        draw = createWaveformDrawJob(context, {
          audioBuffer, pyramid: source?.pyramid, cropStartMs, cropEndMs: endMs,
          pixelsPerMs: scale, clipLeftPx: view.clipLeftPx, clipWidthPx: view.clipWidthPx,
          surfaceLeftPx: view.clipLeftPx + view.leftPx, surfaceWidthPx: view.widthPx,
          height, dpr, color, displayMode, globalPeakAmplitude, showRms, showClipping, showSamples,
        });
      }
      if (draw(budget)) return true;
      complete = true;
      setStatus('ready');
      if (readyRef.current?.buffer !== audioBuffer || readyRef.current?.clipId !== clipId) {
        readyRef.current = { buffer: audioBuffer, clipId };
        onReadyRef.current?.();
      }
      return observer.dirty;
    };
    const queue = () => { if (!disposed) cancel = waveformScheduler.schedule(key.current, run); };
    requestRef.current = queue;
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (rasterBlocked) queue(); });
    observer.invalidate();
    setStatus(audioBuffer ? 'loading' : 'missing');
    queue();
    return () => {
      disposed = true;
      requestRef.current = null;
      cancel?.();
      unsubscribeRaster();
      waveformRasterBudget.release(canvas);
    };
  }, [audioBuffer, blobId, clipId, cropStartMs, endMs, scale, height, color, displayMode,
    globalPeakAmplitude, showRms, showClipping, showSamples, view.leftPx, view.widthPx,
    view.clipLeftPx, view.clipWidthPx, view.dpr]);

  const label = status === 'ready' ? `Waveform, ${displayMode} amplitude${displayMode === 'db' ? ', -60 dB floor' : ''}${showClipping ? ', source over-range indicators' : ''}`
    : status === 'error' ? 'Waveform unavailable' : status === 'limited' ? 'Waveform hidden: raster memory limit' : status === 'missing' ? 'Audio unavailable' : 'Loading waveform';
  return (
    <div ref={containerRef} className="w-full" draggable={false} onDragStart={(event) => event.preventDefault()}
      role="img" aria-label={label} aria-busy={status === 'loading'} data-waveform-status={status}
      style={{ position: 'relative', height, pointerEvents: 'none', WebkitUserDrag: 'none' }}>
      <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" draggable={false}
        style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, height, WebkitUserDrag: 'none' }} />
      {status !== 'ready' && view.widthPx > 0 && <span aria-hidden="true"
        style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, overflow: 'hidden', fontSize: 10, opacity: 0.65 }}>{label}</span>}
    </div>
  );
}

export default function Waveform(props) {
  const Renderer = getWaveformRenderer() === 'legacy' ? LegacyWaveform : ModernWaveform;
  return <Renderer {...props} />;
}
