import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { waveformService } from '../lib/waveformService';
import { waveformScheduler } from '../lib/waveformScheduler';
import { getWaveformRenderer } from '../lib/waveformFeature';
import LegacyWaveform from './LegacyWaveform';
import {
  createWaveformDrawJob, createWaveformSourceObserver, getWaveformWindow, waveformRasterBudget,
} from '../lib/waveformRenderer';
import { adoptWaveformBitmap, createWaveformSurface, getRetainedWindow, registerWaveformBitmap, waveformPaintTier } from '../lib/waveformSurface';
import { hasZoomBitmap, takeZoomBitmap } from '../lib/visibleZoom';

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

/**
 * Hands scroll position to a retained surface without rebuilding it. Scrolling inside the retained
 * margin touches no pixels; a shift or a new jump target requests painting.
 */
export function useSurfacePlacement(surfaceRef, requestRef, viewportLeftPx, returnViewportLeftPx, onMove, prepareRef, revision) {
  const placementRef = useRef(null);
  placementRef.current = { left: viewportLeftPx, returnLeft: returnViewportLeftPx };
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const prepared = prepareRef?.current?.();
    // A zoom picture is already on the canvas, in the coordinates of the viewport it was painted for.
    if (prepared === 'prepared') {
      surface.setReturnViewport(placementRef.current.returnLeft);
      onMove?.();
      requestRef.current?.();
      return;
    }
    // A new picture is held aside before the viewport moves, so the old pixels are not shifted away.
    const replaced = prepared === true;
    const moved = surface.setViewport(placementRef.current.left);
    const retarget = surface.setReturnViewport(placementRef.current.returnLeft);
    if (replaced || (moved && !surface.presenting())) onMove?.();
    if (replaced || moved || retarget) requestRef.current?.();
  }, [surfaceRef, requestRef, viewportLeftPx, returnViewportLeftPx, onMove, prepareRef, revision]);
  return placementRef;
}

function ModernWaveform({
  audioBuffer, blobId, clipId, cropStartMs = 0, cropEndMs, sourceDurationMs,
  height = 80, color = '#4F8EF7', onReady, globalPeakAmplitude = 1,
  pixelsPerMs, clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx, returnViewportLeftPx,
  displayMode = 'linear', showRms = false, showSamples = false,
  scheduleTier = 0, bitmapKey, stereo = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const key = useRef({});
  const readyRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [status, setStatus] = useState(() => (
    hasZoomBitmap(bitmapKey || clipId, pixelsPerMs, cropStartMs) ? 'ready' : 'loading'
  ));
  const [showLoadingPlaceholder, setShowLoadingPlaceholder] = useState(false);
  useEffect(() => {
    if (status !== 'loading') {
      setShowLoadingPlaceholder(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setShowLoadingPlaceholder(true);
    }, 150);
    return () => clearTimeout(timer);
  }, [status]);
  const view = useWaveformViewport(containerRef, { clipLeftPx, clipWidthPx, viewportLeftPx, viewportWidthPx });
  const viewRef = useRef(view);
  viewRef.current = view;
  const audioRef = useRef(audioBuffer);
  audioRef.current = audioBuffer;
  const tierRef = useRef(scheduleTier);
  tierRef.current = scheduleTier;
  const endMs = cropEndMs ?? sourceDurationMs ?? (audioBuffer ? audioBuffer.length / audioBuffer.sampleRate * 1000 : 0);
  const measuredScale = pixelsPerMs > 0 ? pixelsPerMs : view.clipWidthPx / (endMs - cropStartMs);
  // Width / duration is the same zoom after a cut, but the division can differ by a rounding ulp.
  const scaleRef = useRef(measuredScale);
  if (!(scaleRef.current > 0) || Math.abs(measuredScale - scaleRef.current) > 1e-4 * measuredScale) scaleRef.current = measuredScale;
  const scale = scaleRef.current;
  const localLeft = view.viewportLeftPx - view.clipLeftPx;
  const localReturn = Number.isFinite(returnViewportLeftPx) ? returnViewportLeftPx - view.clipLeftPx : null;
  const retained = (left) => getRetainedWindow({ extentPx: view.clipWidthPx, viewportLeftPx: left, viewportWidthPx: view.viewportWidthPx }).widthPx > 0;
  const near = retained(localLeft) || (localReturn !== null && retained(localReturn));
  const { observerRef, requestRef } = useWaveformSources(
    () => near && audioRef.current ? [{
      blobId,
      audioBuffer: audioRef.current,
      ...(stereo ? { channels: audioRef.current.numberOfChannels } : {}),
    }] : [], 1,
  );
  // Appearance and zoom share one picture. A change redraws offscreen instead of rebuilding the canvas.
  const picture = `${scale}|${height}|${color}|${displayMode}|${globalPeakAmplitude}|${showRms}|${showSamples}|${view.dpr}|${cropStartMs}|${stereo}`;
  const pictureRef = useRef(picture);
  const prepareRef = useRef(() => false);
  prepareRef.current = () => {
    const surface = surfaceRef.current;
    if (!surface) return false;
    const prepared = takeZoomBitmap(bitmapKey || clipId, scale, cropStartMs);
    if (prepared) {
      pictureRef.current = picture;
      surface.setViewport(localLeft);
      const placed = surface.showPrepared({
        extentPx: view.clipWidthPx, viewportWidthPx: view.viewportWidthPx, height, dpr: view.dpr, bitmap: prepared,
      });
      waveformRasterBudget.release(prepared.canvas);
      return placed ? 'prepared' : false;
    }
    const replace = pictureRef.current !== picture;
    pictureRef.current = picture;
    return surface.revise({
      extentPx: view.clipWidthPx, viewportWidthPx: view.viewportWidthPx, height, dpr: view.dpr, replace,
    }) ? true : false;
  };
  const placementRef = useSurfacePlacement(
    surfaceRef, requestRef, localLeft, localReturn, undefined, prepareRef,
    `${picture}|${view.clipWidthPx}|${view.viewportWidthPx}`,
  );
  // Read at paint time, so a shorter end reuses the canvas instead of rebuilding it.
  const drawRef = useRef(null);
  drawRef.current = {
    cropStartMs, endMs, scale, clipWidthPx: view.clipWidthPx, height, color, displayMode,
    globalPeakAmplitude, showRms, showSamples, stereo,
  };
  const donorRef = useRef(null);
  if (!donorRef.current) donorRef.current = { read: () => null };
  donorRef.current.read = () => {
    const bitmap = surfaceRef.current?.bitmap?.();
    const draw = drawRef.current;
    if (!bitmap) return null;
    return {
      surface: surfaceRef.current, blobId, cropStartMs: draw.cropStartMs, pixelsPerMs: draw.scale,
      height: draw.height, color: draw.color, displayMode: draw.displayMode,
      showRms: draw.showRms, showSamples: draw.showSamples,
      globalPeakAmplitude: draw.globalPeakAmplitude, stereo: draw.stereo, ...bitmap,
    };
  };
  useEffect(() => registerWaveformBitmap(donorRef.current), []);
  // Layout, not a later frame: a new half must be copied onto the canvas before the browser paints.
  useLayoutEffect(() => {
    let cancel;
    let disposed = false;
    let surface = null;
    let source;
    let scheduledTier = 0;
    let ready = false;
    let reused = false;
    let rasterBlocked = false;
    const canvas = canvasRef.current;
    const observer = observerRef.current;
    const drop = () => {
      surface?.dispose();
      surface = surfaceRef.current = null;
    };
    // Clip-local coordinates: the clip starts at 0 whatever its timeline position.
    const paint = (context, strip) => {
      const draw = drawRef.current;
      return createWaveformDrawJob(context, {
        audioBuffer: audioRef.current, pyramid: source?.pyramid, cropStartMs: draw.cropStartMs, cropEndMs: draw.endMs,
        pixelsPerMs: draw.scale, clipLeftPx: 0, clipWidthPx: draw.clipWidthPx, ...strip,
        height: draw.height, color: draw.color, displayMode: draw.displayMode,
        globalPeakAmplitude: draw.globalPeakAmplitude, showRms: draw.showRms,
        showSamples: draw.showSamples, stereo: draw.stereo,
        requestDetail: (start, end) => waveformService.requestDetail(blobId, audioRef.current, start, end),
      });
    };
    const run = (budget) => {
      if (disposed) return false;
      const update = observer.read();
      const buffer = audioRef.current;
      if (update.stale && surface) {
        surface.clear();
        ready = false;
        setStatus('loading');
      }
      if (!buffer) { setStatus('missing'); return false; }
      if (!near) return observer.dirty;
      source = update.snapshots.get(blobId)?.source;
      if (!ensureSurface()) return false;
      const detail = buffer.sampleRate / (1000 * drawRef.current.scale * surface.dpr) <= 1;
      if (!source?.pyramid && !detail) {
        if (!reused) setStatus(source?.status === 'error' ? 'error' : 'loading');
        return observer.dirty;
      }
      const more = surface.run(budget);
      if (!ready && !surface.hasVisibleWork()) {
        ready = true;
        setStatus('ready');
        if (readyRef.current?.buffer !== buffer || readyRef.current?.clipId !== clipId) {
          readyRef.current = { buffer, clipId };
          onReadyRef.current?.();
        }
      }
      if (!more) return observer.dirty;
      if (waveformPaintTier(surface, tierRef.current) !== scheduledTier) { queue(); return false; }
      return true;
    };
    function queue() {
      if (disposed) return;
      scheduledTier = waveformPaintTier(surface, tierRef.current);
      cancel = waveformScheduler.schedule(key.current, run, { tier: scheduledTier });
    }
    function ensureSurface() {
      if (surface || !canvas) return Boolean(surface);
      const draw = drawRef.current;
      const measured = viewRef.current;
      surface = createWaveformSurface({ canvas, extentPx: draw.clipWidthPx, viewportWidthPx: measured.viewportWidthPx,
        height: draw.height, dpr: measured.dpr, paint });
      rasterBlocked = !surface;
      if (!surface) { setStatus('limited'); return false; }
      surfaceRef.current = surface;
      surface.setViewport(placementRef.current.left);
      surface.setReturnViewport(placementRef.current.returnLeft);
      const prepared = takeZoomBitmap(bitmapKey || clipId, draw.scale, draw.cropStartMs);
      if (prepared) {
        surface.showPrepared({
          extentPx: draw.clipWidthPx, viewportWidthPx: measured.viewportWidthPx,
          height: draw.height, dpr: measured.dpr, bitmap: prepared,
        });
        waveformRasterBudget.release(prepared.canvas);
        reused = !surface.hasVisibleWork();
      } else {
        // The other half of a cut already drew these columns. Copy them and paint only the gap.
        reused = adoptWaveformBitmap(surface, { ...drawRef.current, blobId, pixelsPerMs: drawRef.current.scale }) > 0;
      }
      return true;
    }
    requestRef.current = queue;
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (rasterBlocked) queue(); });
    observer.invalidate();
    if (!audioRef.current) setStatus('missing');
    else if (near && ensureSurface()) setStatus(!reused && surface.hasVisibleWork() ? 'loading' : 'ready');
    else if (near) setStatus('loading');
    queue();
    return () => {
      disposed = true;
      requestRef.current = null;
      cancel?.();
      unsubscribeRaster();
      drop();
    };
    // Zoom, crop, color, size and resolution retarget this surface. They must not dispose the picture on screen.
  }, [blobId, clipId, near]);

  const label = status === 'ready' ? `Waveform, ${displayMode} amplitude${displayMode === 'db' ? ', -60 dB floor' : ''}`
    : status === 'error' ? 'Waveform unavailable' : status === 'limited' ? 'Waveform hidden: raster memory limit' : status === 'missing' ? 'Audio unavailable' : 'Loading waveform';
  return (
    <div ref={containerRef} className="w-full" draggable={false} onDragStart={(event) => event.preventDefault()}
      role="img" aria-label={label} aria-busy={status === 'loading'} data-waveform-status={status}
      style={{ position: 'relative', height, pointerEvents: 'none', WebkitUserDrag: 'none' }}>
      {/* The retained surface positions and sizes the canvas; React must not reset left/width on scroll. */}
      <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" draggable={false}
        style={{ position: 'absolute', height, WebkitUserDrag: 'none' }} />
      {status !== 'ready' && view.widthPx > 0 && (status !== 'loading' || showLoadingPlaceholder) && (
        <span aria-hidden="true"
          style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, overflow: 'hidden', fontSize: 10, opacity: 0.65 }}>{label}</span>
      )}
    </div>
  );
}

export default function Waveform(props) {
  const Renderer = getWaveformRenderer() === 'legacy' ? LegacyWaveform : ModernWaveform;
  return <Renderer {...props} />;
}
