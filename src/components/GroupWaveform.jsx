import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audioManager } from '../lib/audioManager';
import { waveformScheduler } from '../lib/waveformScheduler';
import { waveformService } from '../lib/waveformService';
import { createWaveformDrawJob, getWaveformWindow, waveformRasterBudget, WAVEFORM_OVERSCAN_PX } from '../lib/waveformRenderer';
import { createWaveformSurface, getRetainedWindow, waveformPaintTier } from '../lib/waveformSurface';
import { hasZoomBitmap, takeZoomBitmap } from '../lib/visibleZoom';
import { getWaveformRenderer } from '../lib/waveformFeature';
import LegacyWaveform from './LegacyWaveform';
import { useSurfacePlacement, useWaveformSources, useWaveformViewport } from './Waveform';

const EMPTY_CLIPS = [];
const ACTIVITY_COLOR = 'rgba(123, 173, 255, 0.75)';
const MISSING_COLOR = 'rgba(248, 113, 113, 0.55)';
const flaggedMissing = (ids, id) => Boolean(ids?.has?.(id) || (Array.isArray(ids) && ids.includes(id)));
const CLIP_FIELDS = ['key', 'blobId', 'startMs', 'durationMs', 'cropStartMs', 'cropEndMs', 'sourceDurationMs', 'gainScale'];
// Segment clipping divides by the zoom, so equal clips are not always bit-identical.
const closeMs = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.05 || (a == null && b == null);
const closeGain = (a, b) => Math.abs((a ?? 1) - (b ?? 1)) < 1e-3;
const sameClip = (a, b) => CLIP_FIELDS.every((field) => {
  if (field === 'key' || field === 'blobId') return a[field] === b[field];
  if (field === 'gainScale') return closeGain(a[field], b[field]);
  return closeMs(a[field], b[field]);
});
const sameClips = (a, b) => a.length === b.length && a.every((clip, index) => sameClip(clip, b[index]));

/** CSS px that a clip-list edit must repaint. A pure split or its undo keeps the lane. */
function changedClipRanges(previous, next, pixelsPerMs) {
  if (!(pixelsPerMs > 0)) return [];
  const previousByKey = new Map(previous.map((clip) => [clip.key, clip]));
  const nextByKey = new Map(next.map((clip) => [clip.key, clip]));
  const ranges = [];
  const absorbed = new Set();
  const add = (clip) => ranges.push([clip.startMs * pixelsPerMs, (clip.startMs + clip.durationMs) * pixelsPerMs]);
  const abuts = (left, right, end) => left.blobId === right.blobId
    && closeMs(right.startMs, left.startMs + left.durationMs)
    && closeMs(right.cropStartMs, left.cropEndMs)
    && closeMs(right.startMs + right.durationMs, end);
  for (const clip of previous) {
    if (absorbed.has(clip.key)) continue;
    const other = nextByKey.get(clip.key);
    if (other && sameClip(clip, other)) continue;
    // Cut: this clip got shorter and a new half starts where it now ends.
    const splitRight = other && other.blobId === clip.blobId && closeMs(other.startMs, clip.startMs)
      && closeMs(other.cropStartMs, clip.cropStartMs) && other.durationMs < clip.durationMs - 0.05
      ? next.find((candidate) => !previousByKey.has(candidate.key) && abuts(other, candidate, clip.startMs + clip.durationMs))
      : null;
    if (splitRight) {
      absorbed.add(splitRight.key);
      continue;
    }
    // Undo: this clip grew back over a removed half of the same audio.
    const joinedRight = other && other.blobId === clip.blobId && closeMs(other.startMs, clip.startMs)
      && closeMs(other.cropStartMs, clip.cropStartMs) && other.durationMs > clip.durationMs + 0.05
      ? previous.find((candidate) => candidate.key !== clip.key && !nextByKey.has(candidate.key)
        && abuts(clip, candidate, other.startMs + other.durationMs))
      : null;
    if (joinedRight) {
      absorbed.add(joinedRight.key);
      continue;
    }
    // The removed half of an undo, seen before the clip that grows over it.
    if (!other && next.some((candidate) => {
      const host = previousByKey.get(candidate.key);
      return host && host.key !== clip.key && abuts(host, clip, candidate.startMs + candidate.durationMs)
        && closeMs(host.startMs, candidate.startMs) && closeMs(host.cropStartMs, candidate.cropStartMs)
        && candidate.durationMs > host.durationMs + 0.05;
    })) {
      absorbed.add(clip.key);
      continue;
    }
    add(clip);
    if (other) add(other);
  }
  for (const clip of next) if (!previousByKey.has(clip.key) && !absorbed.has(clip.key)) add(clip);
  return ranges;
}

/** Parent supplies mute-filtered/edit-preview clips. Layered source activity is NOT mixed output. */
function ModernGroupWaveform({
  clips: clipsProp = EMPTY_CLIPS, pixelsPerMs, viewportLeftPx = 0, viewportWidthPx = 0, returnViewportLeftPx, height = 80,
  globalPeakAmplitude = 1, displayMode = 'linear', showRms = false,
  missingMediaBlobIds, scheduleTier = 0, bitmapKey, stereo = false,
}) {
  // Parents rebuild clip lists on unrelated project changes (loop toggles, track tree normalization);
  // equal content keeps the retained surface instead of repainting the lane.
  const clipsRef = useRef(clipsProp);
  if (clipsProp !== clipsRef.current && !sameClips(clipsProp, clipsRef.current)) clipsRef.current = clipsProp;
  const clips = clipsRef.current;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const key = useRef({});
  const buffersRef = useRef([]);
  const buffers = clips.map((clip) => audioManager.mediaCache.get(clip.blobId));
  if (buffers.length !== buffersRef.current.length || buffers.some((buffer, index) => buffer !== buffersRef.current[index])) {
    buffersRef.current = buffers;
  }
  const mediaBuffers = buffersRef.current;
  const [status, setStatus] = useState(() => (
    (bitmapKey && hasZoomBitmap(bitmapKey, pixelsPerMs)) ? 'ready' : 'loading'
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
  const view = useWaveformViewport(containerRef, {
    clipLeftPx: 0, clipWidthPx: Math.max(0, viewportLeftPx + viewportWidthPx + WAVEFORM_OVERSCAN_PX),
    viewportLeftPx, viewportWidthPx,
  });
  const measuredExtentPx = clips.reduce((end, clip) => Math.max(end, (clip.startMs + clip.durationMs) * pixelsPerMs), 0);
  // Fit-to-project zoom can change by a rounding ulp when a clip is split. That is not a new picture.
  const zoomRef = useRef(pixelsPerMs);
  const zoomChanged = !(zoomRef.current > 0) || Math.abs(pixelsPerMs - zoomRef.current) > 1e-4 * Math.max(pixelsPerMs, zoomRef.current);
  if (zoomChanged) zoomRef.current = pixelsPerMs;
  const zoom = zoomRef.current;
  // A split keeps the same lane length. A new zoom starts from the lane that zoom will show.
  const extentRef = useRef(0);
  if (zoomChanged || !(extentRef.current > 0) || measuredExtentPx > extentRef.current + 0.5) extentRef.current = measuredExtentPx;
  const extentPx = extentRef.current;
  const viewportRef = useRef(viewportWidthPx);
  if (Math.abs(viewportWidthPx - viewportRef.current) > 0.5) viewportRef.current = viewportWidthPx;
  const viewportPx = viewportRef.current;
  const drawRef = useRef(null);
  drawRef.current = {
    pixelsPerMs, height, globalPeakAmplitude, displayMode, showRms, missingMediaBlobIds, extentPx, stereo,
  };
  const localReturn = Number.isFinite(returnViewportLeftPx) ? returnViewportLeftPx : null;
  // Sources are pinned for every clip on the retained canvas, margins included.
  const windowClips = () => {
    const window = surfaceRef.current?.windowPx() ?? (({ leftPx, widthPx }) => ({ leftPx, rightPx: leftPx + widthPx }))(
      getRetainedWindow({ extentPx, viewportLeftPx: placementRef.current.left, viewportWidthPx }));
    return clips.filter((clip) => clip.startMs * pixelsPerMs < window.rightPx
      && (clip.startMs + clip.durationMs) * pixelsPerMs > window.leftPx);
  };
  const { observerRef, requestRef } = useWaveformSources(
    () => windowClips().map((clip) => ({
      blobId: clip.blobId,
      audioBuffer: audioManager.mediaCache.get(clip.blobId),
      ...(stereo ? { channels: 2 } : {}),
    })),
    0, audioManager.mediaCache,
  );
  const repin = useCallback(() => observerRef.current?.invalidate(), [observerRef]);
  const tierRef = useRef(scheduleTier);
  tierRef.current = scheduleTier;
  const viewRef = useRef(view);
  viewRef.current = view;
  const missingKey = missingMediaBlobIds ? [...missingMediaBlobIds].sort().join(',') : '';
  const picture = `${zoom}|${height}|${globalPeakAmplitude}|${displayMode}|${showRms}|${view.dpr}|${missingKey}|${stereo}`;
  const pictureRef = useRef(picture);
  const prepareRef = useRef(() => false);
  prepareRef.current = () => {
    const surface = surfaceRef.current;
    if (!surface) return false;
    const prepared = takeZoomBitmap(bitmapKey, zoom);
    if (prepared) {
      pictureRef.current = picture;
      surface.setViewport(viewportLeftPx);
      const placed = surface.showPrepared({
        extentPx, viewportWidthPx: viewportPx, height, dpr: view.dpr, bitmap: prepared,
      });
      waveformRasterBudget.release(prepared.canvas);
      return placed ? 'prepared' : false;
    }
    const replace = pictureRef.current !== picture;
    pictureRef.current = picture;
    return surface.revise({
      extentPx, viewportWidthPx: viewportPx, height, dpr: view.dpr, replace,
    }) ? true : false;
  };
  const placementRef = useSurfacePlacement(
    surfaceRef, requestRef, viewportLeftPx, localReturn, repin, prepareRef,
    `${picture}|${extentPx}|${viewportPx}`,
  );
  const appliedClipsRef = useRef(clips);
  const appliedBuffersRef = useRef(new Map());
  // Clip edits patch the retained lane. They do not rebuild it or show the loading label.
  useLayoutEffect(() => {
    const nextBuffers = new Map(clips.map((clip) => [clip.blobId, audioManager.mediaCache.get(clip.blobId)]));
    const previous = appliedClipsRef.current;
    const previousBuffers = appliedBuffersRef.current;
    const surface = surfaceRef.current;
    if (!surface || (previous === clips && [...nextBuffers].every(([id, buffer]) => previousBuffers.get(id) === buffer))) {
      appliedClipsRef.current = clips;
      appliedBuffersRef.current = nextBuffers;
      return;
    }
    const ranges = changedClipRanges(previous, clips, pixelsPerMs);
    for (const clip of clips) {
      if (previousBuffers.get(clip.blobId) !== nextBuffers.get(clip.blobId)) {
        ranges.push([clip.startMs * pixelsPerMs, (clip.startMs + clip.durationMs) * pixelsPerMs]);
      }
    }
    appliedClipsRef.current = clips;
    appliedBuffersRef.current = nextBuffers;
    for (const range of ranges) surface.invalidate(...range);
    if (ranges.length) {
      observerRef.current?.invalidate();
      requestRef.current?.();
    }
  }, [clips, mediaBuffers, pixelsPerMs]);
  useLayoutEffect(() => {
    let cancel;
    let disposed = false;
    let surface = null;
    let snapshots = new Map();
    let scheduledTier = 0;
    let rasterBlocked = false;
    let seenReady = false;
    const canvas = canvasRef.current;
    const clipList = () => clipsRef.current;
    const observer = observerRef.current;
    const clipRange = (clip) => {
      const scale = drawRef.current.pixelsPerMs;
      return [clip.startMs * scale, (clip.startMs + clip.durationMs) * scale];
    };
    const sameSnapshot = (a, b) => a?.audioBuffer === b?.audioBuffer && a?.source?.status === b?.source?.status
      && a?.source?.pyramid === b?.source?.pyramid;
    // Draws a composite single-pass group envelope across the strip.
    const paint = (context, strip) => {
      const { surfaceLeftPx, fromColumn, toColumn, dpr } = strip;
      const stripLeft = surfaceLeftPx + fromColumn / dpr;
      const stripRight = surfaceLeftPx + toColumn / dpr;
      const list = clipList().filter((clip) => {
        const [start, end] = clipRange(clip);
        return start < stripRight && end > stripLeft;
      });

      const drawState = drawRef.current;
      const readyClips = [];

      for (let i = 0; i < list.length; i += 1) {
        const clip = list[i];
        const { audioBuffer, source } = snapshots.get(clip.blobId) || {};
        const isMissing = flaggedMissing(drawState.missingMediaBlobIds, clip.blobId) || !audioBuffer;
        const [start, end] = clipRange(clip);
        const left = Math.max(start, stripLeft) - surfaceLeftPx;
        const width = Math.max(0, Math.min(end, stripRight) - surfaceLeftPx - left);
        if (!audioBuffer) {
          context.fillStyle = MISSING_COLOR;
          context.fillRect(left, drawState.height / 2 - 2, width, 4);
          continue;
        }
        const detail = audioBuffer.sampleRate / (1000 * drawState.pixelsPerMs * dpr) <= 1;
        if (!source?.pyramid && !detail) {
          context.fillStyle = isMissing ? MISSING_COLOR : 'rgba(148, 163, 184, 0.35)';
          context.fillRect(left, drawState.height / 2, width, 1);
          continue;
        }
        readyClips.push({
          audioBuffer,
          pyramid: source?.pyramid,
          cropStartMs: clip.cropStartMs,
          cropEndMs: clip.cropEndMs ?? clip.sourceDurationMs,
          clipLeftPx: start,
          clipWidthPx: end - start,
          gainScale: clip.gainScale ?? 1,
          requestDetail: (from, to) => waveformService.requestDetail(clip.blobId, audioBuffer, from, to),
        });
      }

      if (!readyClips.length) return () => false;

      let draw;
      return (budget) => {
        if (!draw) {
          draw = createWaveformDrawJob(context, {
            clips: readyClips,
            audioBuffer: readyClips[0].audioBuffer,
            pyramid: readyClips[0].pyramid,
            cropStartMs: readyClips[0].cropStartMs,
            cropEndMs: readyClips[0].cropEndMs,
            pixelsPerMs: drawState.pixelsPerMs,
            clipLeftPx: Math.min(...readyClips.map((c) => c.clipLeftPx)),
            clipWidthPx: Math.max(...readyClips.map((c) => c.clipLeftPx + c.clipWidthPx)) - Math.min(...readyClips.map((c) => c.clipLeftPx)),
            ...strip,
            height: drawState.height,
            color: drawState.missingMediaBlobIds?.size ? MISSING_COLOR : ACTIVITY_COLOR,
            displayMode: drawState.displayMode,
            globalPeakAmplitude: drawState.globalPeakAmplitude,
            showRms: drawState.showRms,
            stereo: drawState.stereo,
          });
          return true;
        }
        return draw(budget);
      };
    };
    function ensureSurface() {
      if (surface || !canvas) return Boolean(surface);
      const drawState = drawRef.current;
      const measured = viewRef.current;
      if (!(drawState.extentPx > 0)) return false;
      surface = createWaveformSurface({
        canvas, extentPx: drawState.extentPx, viewportWidthPx: measured.viewportWidthPx, height: drawState.height, dpr: measured.dpr, paint,
      });
      rasterBlocked = !surface;
      if (!surface) { setStatus('limited'); return false; }
      surfaceRef.current = surface;
      surface.setViewport(placementRef.current.left);
      surface.setReturnViewport(placementRef.current.returnLeft);
      const prepared = takeZoomBitmap(bitmapKey, drawRef.current.pixelsPerMs);
      if (prepared) {
        surface.showPrepared({
          extentPx: drawState.extentPx, viewportWidthPx: measured.viewportWidthPx,
          height: drawState.height, dpr: measured.dpr, bitmap: prepared,
        });
        waveformRasterBudget.release(prepared.canvas);
        seenReady = true;
      }
      return true;
    }
    const statusOf = () => {
      let pending = false;
      let failed = false;
      let missing = false;
      for (const clip of clipList().filter((clip) => {
        const [start, end] = clipRange(clip);
        const window = surface.windowPx();
        return start < window.rightPx && end > window.leftPx;
      })) {
        const drawState = drawRef.current;
        const { audioBuffer, source } = snapshots.get(clip.blobId) || {};
        missing ||= flaggedMissing(drawState.missingMediaBlobIds, clip.blobId) || !audioBuffer;
        if (!audioBuffer || source?.pyramid || audioBuffer.sampleRate / (1000 * drawState.pixelsPerMs * surface.dpr) <= 1) continue;
        failed ||= source?.status === 'error';
        pending ||= source?.status !== 'error';
      }
      return failed ? 'error' : pending ? 'loading' : missing ? 'missing' : 'ready';
    };
    const run = (budget) => {
      if (disposed) return false;
      const update = observer.read();
      const drawState = drawRef.current;
      if (!(drawState.extentPx > 0)) { setStatus('ready'); return observer.dirty; }
      if (!ensureSurface()) return false;
      if (update.stale) {
        // Replacements clear stale pixels at once; new summaries repaint only their clips.
        surface.clear();
        seenReady = false;
      } else if (update.changed) {
        for (const clip of clipList()) {
          if (sameSnapshot(snapshots.get(clip.blobId), update.snapshots.get(clip.blobId))) continue;
          surface.invalidate(...clipRange(clip));
        }
      }
      snapshots = update.snapshots;
      const more = surface.run(budget);
      const visibleWork = surface.hasVisibleWork();
      if (!visibleWork) seenReady = true;
      setStatus(!seenReady && visibleWork ? 'loading' : statusOf());
      if (!more) return observer.dirty;
      if (waveformPaintTier(surface, tierRef.current) !== scheduledTier) { queue(); return false; }
      return true;
    };
    function queue() {
      if (disposed) return;
      scheduledTier = waveformPaintTier(surface, tierRef.current);
      cancel = waveformScheduler.schedule(key.current, run, { tier: scheduledTier });
    }
    requestRef.current = queue;
    const unsubscribeRaster = waveformRasterBudget.subscribe(() => { if (rasterBlocked) queue(); });
    observer.invalidate();
    if (ensureSurface() && seenReady) setStatus('ready');
    else setStatus('loading');
    queue();
    return () => {
      disposed = true;
      requestRef.current = null;
      cancel?.();
      unsubscribeRaster();
      surface?.dispose();
      surfaceRef.current = null;
    };
    // Zoom and display changes retarget the lane. Restarting this effect would blank it and show the loading label.
  }, []);

  const label = `Group activity overview (not mixed output)${status === 'missing' ? ', missing media' : status === 'error' ? ', waveform unavailable' : status === 'limited' ? ', raster memory limit' : status === 'loading' ? ', loading waveforms' : ''}`;
  return (
    <div ref={containerRef} role="img" aria-label={label} aria-busy={status === 'loading'} data-waveform-status={status}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} width={0} height={0} aria-hidden="true" draggable={false}
        style={{ position: 'absolute', height, WebkitUserDrag: 'none' }} />
      {((status === 'error' || status === 'limited') || (status === 'loading' && showLoadingPlaceholder)) && view.widthPx > 0 && (
        <span aria-hidden="true"
          style={{ position: 'absolute', left: view.leftPx, width: view.widthPx, overflow: 'hidden', fontSize: 10, opacity: 0.65 }}>
          {status === 'error' ? 'Group waveform unavailable' : status === 'limited' ? 'Group waveform hidden: raster memory limit' : 'Loading group activity'}
        </span>
      )}
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
