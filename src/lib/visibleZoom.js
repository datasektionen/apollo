import { waveformScheduler } from './waveformScheduler';
import { waveformService } from './waveformService';
import { createWaveformDrawJob, getWaveformWindow, prepareWaveformCanvas, waveformRasterBudget, WAVEFORM_OVERSCAN_PX } from './waveformRenderer';
import { boundedRange, intersectsViewport } from '../utils/timelineViewport';

const stored = new Map();

function place(startMs, durationMs, cropStartMs, segment, pixelsPerMs) {
  if (!(durationMs > 0)) return null;
  const range = boundedRange(startMs * pixelsPerMs, durationMs * pixelsPerMs, segment.origin, segment.width);
  if (!(range.width > 0)) return null;
  const crop = (cropStartMs || 0) + range.skipped / pixelsPerMs;
  return { shellLeft: range.left, shellWidth: range.width, cropStartMs: crop, cropEndMs: crop + range.width / pixelsPerMs };
}

function readiness(clip, getBuffer, pixelsPerMs, dpr) {
  const buffer = getBuffer?.(clip.blobId);
  if (!buffer) return 'missing';
  let source;
  try { source = waveformService.getSource?.(clip.blobId, buffer); } catch { source = undefined; }
  const detail = buffer.sampleRate / (1000 * pixelsPerMs * dpr) <= 1;
  if (!source?.pyramid && !detail) return 'pending';
  return { buffer, pyramid: source?.pyramid };
}

/** On-screen views that can be painted at the zoom the timeline has not switched to yet. */
export function visibleZoomViews({
  rows = [], rowTops = [], vertical, clipsByTrack, groupClipsByNode, segment, pixelsPerMs, viewportWidth, dpr = 1,
  display = {}, getBuffer,
} = {}) {
  if (!(vertical?.height > 0) || !(pixelsPerMs > 0) || !(viewportWidth > 0) || !segment) return [];
  const ratio = Math.max(1, dpr || 1);
  const missing = (id) => Boolean(display.missingIds?.has?.(id) || (Array.isArray(display.missingIds) && display.missingIds.includes(id)));
  const views = [];
  rows.forEach((row, index) => {
    const top = rowTops[index] ?? 0;
    if (!intersectsViewport(top, row.height || 0, vertical.top, vertical.height, 0)) return;
    const height = (row.height || 0) - 16;
    if (!(height > 0)) return;
    const paint = {
      height, pixelsPerMs, dpr: ratio,
      displayMode: display.displayMode || 'linear', showRms: Boolean(display.showRms),
      globalPeakAmplitude: display.globalPeakAmplitude || 1,
    };
    if (row.kind === 'group') {
      const source = groupClipsByNode?.get(row.nodeId);
      const lane = [];
      let waiting = false;
      for (const clip of (Array.isArray(source) ? source : source?.clips) || []) {
        const durationMs = clip.durationMs ?? Math.max(0, (clip.cropEndMs || 0) - (clip.cropStartMs || 0));
        const placed = place(clip.startMs, durationMs, clip.cropStartMs, segment, pixelsPerMs);
        if (!placed) continue;
        const laneLeft = segment.left - WAVEFORM_OVERSCAN_PX;
        const laneRight = segment.left + viewportWidth + WAVEFORM_OVERSCAN_PX;
        if (placed.shellLeft + placed.shellWidth <= laneLeft || placed.shellLeft >= laneRight) continue;
        const audio = readiness(clip, getBuffer, pixelsPerMs, ratio);
        if (audio === 'pending') waiting = true;
        if (!audio || audio === 'missing' || audio === 'pending') continue;
        lane.push({
          ...audio, blobId: clip.blobId, cropStartMs: placed.cropStartMs, cropEndMs: placed.cropEndMs,
          clipLeftPx: placed.shellLeft, clipWidthPx: placed.shellWidth,
          gainScale: clip.gainScale ?? 1,
          color: missing(clip.blobId) ? (display.groupMissingColor || display.missingColor) : display.groupColor,
        });
      }
      if (waiting || !lane.length) return;
      const leftPx = Math.max(0, segment.left - WAVEFORM_OVERSCAN_PX);
      const widthPx = segment.left + viewportWidth + WAVEFORM_OVERSCAN_PX - leftPx;
      if (widthPx > 0) views.push({ ...paint, key: `group:${row.nodeId}`, leftPx, widthPx, clips: lane });
      return;
    }
    const track = row.track;
    if (!track) return;
    for (const clip of clipsByTrack?.get(track.id) || track.clips || []) {
      const durationMs = Math.max(0, (clip.cropEndMs || 0) - (clip.cropStartMs || 0));
      const logicalLeft = (clip.timelineStartMs || 0) * pixelsPerMs;
      if (!intersectsViewport(logicalLeft, durationMs * pixelsPerMs, segment.logical, viewportWidth, 0)) continue;
      const placed = place(clip.timelineStartMs || 0, durationMs, clip.cropStartMs, segment, pixelsPerMs);
      if (!placed) continue;
      const audio = readiness(clip, getBuffer, pixelsPerMs, ratio);
      if (!audio || audio === 'missing' || audio === 'pending') continue;
      const window = getWaveformWindow({
        clipLeftPx: 0, clipWidthPx: placed.shellWidth,
        viewportLeftPx: segment.left - placed.shellLeft, viewportWidthPx: viewportWidth,
      });
      if (!(window.widthPx > 0)) continue;
      const trackGain = display.scaleWaveformsByGain !== false && display.getTrackGain ? display.getTrackGain(track.id) : 1;
      const clipGain = display.scaleWaveformsByGain !== false ? Math.pow(10, (clip.gainDb || 0) / 20) : 1;
      const gainScale = trackGain * clipGain;
      const viewKey = clip.bitmapKey || (display.scaleWaveformsByGain !== false ? `${clip.id}:${gainScale.toFixed(3)}` : clip.id);
      views.push({
        ...paint, key: viewKey, leftPx: window.leftPx, widthPx: window.widthPx, cropStartMs: placed.cropStartMs,
        clips: [{
          ...audio, blobId: clip.blobId, cropStartMs: placed.cropStartMs, cropEndMs: placed.cropEndMs,
          clipLeftPx: 0, clipWidthPx: placed.shellWidth,
          gainScale,
          color: missing(clip.blobId) ? display.missingColor : display.clipColor,
        }],
      });
    }
  });
  return views;
}

function openView(view) {
  const canvas = document.createElement('canvas');
  const context = prepareWaveformCanvas(canvas, view.widthPx, view.height, view.dpr);
  if (!context) return null;
  const allocation = waveformRasterBudget.getAllocation(canvas);
  const isGroup = view.key.startsWith('group:');
  const paints = isGroup && view.clips.length > 1
    ? [createWaveformDrawJob(context, {
        clips: view.clips.map((clip) => ({
          audioBuffer: clip.buffer,
          pyramid: clip.pyramid,
          cropStartMs: clip.cropStartMs,
          cropEndMs: clip.cropEndMs,
          clipLeftPx: clip.clipLeftPx,
          clipWidthPx: clip.clipWidthPx,
          gainScale: clip.gainScale ?? 1,
          requestDetail: (start, end) => waveformService.requestDetail?.(clip.blobId, clip.buffer, start, end),
        })),
        pixelsPerMs: view.pixelsPerMs,
        surfaceLeftPx: view.leftPx, surfaceWidthPx: view.widthPx, height: view.height, dpr: allocation.dpr,
        color: view.clips[0].color, displayMode: view.displayMode, globalPeakAmplitude: view.globalPeakAmplitude,
        showRms: view.showRms,
        fromColumn: 0, toColumn: canvas.width,
      })]
    : view.clips.map((clip) => createWaveformDrawJob(context, {
        audioBuffer: clip.buffer, pyramid: clip.pyramid, cropStartMs: clip.cropStartMs, cropEndMs: clip.cropEndMs,
        pixelsPerMs: view.pixelsPerMs, clipLeftPx: clip.clipLeftPx, clipWidthPx: clip.clipWidthPx,
        surfaceLeftPx: view.leftPx, surfaceWidthPx: view.widthPx, height: view.height, dpr: allocation.dpr,
        color: clip.color, displayMode: view.displayMode, globalPeakAmplitude: view.globalPeakAmplitude,
        showRms: view.showRms,
        gainScale: clip.gainScale ?? 1,
        requestDetail: (start, end) => waveformService.requestDetail?.(clip.blobId, clip.buffer, start, end),
        fromColumn: 0, toColumn: canvas.width,
      }));
  let index = 0;
  let current = paints[0];
  return {
    canvas, key: view.key,
    bitmap: {
      canvas, dpr: allocation.dpr, leftPx: view.leftPx, widthPx: view.widthPx,
      pixelsPerMs: view.pixelsPerMs, cropStartMs: view.cropStartMs ?? null,
    },
    draw(budget) {
      while (current && current(budget) !== true) {
        index += 1;
        current = paints[index];
        if (current) return true;
      }
      return Boolean(current);
    },
  };
}

/**
 * Paints the next zoom's on-screen waveforms offscreen. Calls onReady(null) immediately when
 * nothing on screen can be painted, so the timeline can move in the same turn.
 */
export function prepareVisibleZoom(model) {
  const onReady = model?.onReady || (() => {});
  const views = model?.views || visibleZoomViews(model);
  if (!views.length) {
    onReady(null);
    return () => {};
  }
  const bitmaps = new Map();
  let active = null;
  let viewIndex = 0;
  let cancelled = false;
  let settled = false;
  const finish = () => {
    if (cancelled || settled) return;
    settled = true;
    const ready = new Map(bitmaps);
    bitmaps.clear();
    active = null;
    onReady(ready.size ? ready : null);
  };
  const run = (budget) => {
    if (cancelled || settled) return false;
    try {
      while (viewIndex < views.length) {
        if (!active) {
          active = openView(views[viewIndex]);
          if (!active) { viewIndex += 1; continue; }
        }
        if (active.draw(budget) === true) return true;
        bitmaps.set(active.key, active.bitmap);
        active = null;
        viewIndex += 1;
      }
      finish();
      return false;
    } catch (error) {
      console.error('Waveform zoom prepare failed', error);
      finish();
      return false;
    }
  };
  const cancelSchedule = waveformScheduler.schedule({}, run, {
    tier: model?.tier ?? 0,
    priority: model?.priority ?? 4,
  });
  return () => {
    if (settled) return;
    cancelled = true;
    cancelSchedule();
    if (active?.canvas) waveformRasterBudget.release(active.canvas);
    active = null;
    releaseZoomBitmaps(bitmaps);
    bitmaps.clear();
  };
}

export function releaseZoomBitmaps(bitmaps) {
  if (!bitmaps) return;
  for (const bitmap of bitmaps.values()) waveformRasterBudget.release(bitmap?.canvas);
}

export function storeZoomBitmaps(bitmaps) {
  releaseZoomBitmaps(stored);
  stored.clear();
  if (!bitmaps) return;
  for (const [key, bitmap] of bitmaps) stored.set(key, bitmap);
}

export function mergeZoomBitmaps(bitmaps) {
  if (!bitmaps) return;
  for (const [key, bitmap] of bitmaps) {
    if (stored.has(key)) {
      waveformRasterBudget.release(stored.get(key)?.canvas);
    }
    stored.set(key, bitmap);
  }
}

export function hasZoomBitmap(key, pixelsPerMs, cropStartMs) {
  const bitmap = stored.get(key);
  if (!bitmap) return false;
  const scale = Math.max(bitmap.pixelsPerMs, pixelsPerMs || 0);
  const scaleOk = pixelsPerMs > 0 && Math.abs(bitmap.pixelsPerMs - pixelsPerMs) <= 1e-4 * scale;
  const cropOk = cropStartMs == null || bitmap.cropStartMs == null || Math.abs(bitmap.cropStartMs - cropStartMs) <= 0.05;
  return scaleOk && cropOk;
}

export function releaseStoredZoomBitmaps() {
  releaseZoomBitmaps(stored);
  stored.clear();
}

/** Hands a prepared picture to the view that is about to show this zoom. */
export function takeZoomBitmap(key, pixelsPerMs, cropStartMs) {
  const bitmap = stored.get(key);
  if (!bitmap) return null;
  stored.delete(key);
  const scale = Math.max(bitmap.pixelsPerMs, pixelsPerMs || 0);
  const scaleOk = pixelsPerMs > 0 && Math.abs(bitmap.pixelsPerMs - pixelsPerMs) <= 1e-4 * scale;
  const cropOk = cropStartMs == null || bitmap.cropStartMs == null || Math.abs(bitmap.cropStartMs - cropStartMs) <= 0.05;
  if (!scaleOk || !cropOk) {
    waveformRasterBudget.release(bitmap.canvas);
    return null;
  }
  return bitmap;
}
