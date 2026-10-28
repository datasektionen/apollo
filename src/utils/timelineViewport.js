export const VIEWPORT_OVERSCAN_PX = 128;
export const MAX_SCROLL_SEGMENT_PX = 1_000_000;

// Rebase the native rail, not the time scale. The rail covers one segment;
// fit/zoom can navigate globally without exceeding browser CSS dimensions.
export function scrollSegment(logicalLeft, timelineWidth, viewportWidth, origin = 0) {
  const width = Math.min(timelineWidth, Math.max(MAX_SCROLL_SEGMENT_PX, viewportWidth * 8));
  const logical = Math.max(0, Math.min(timelineWidth - viewportWidth, logicalLeft));
  const local = logical - origin;
  const margin = viewportWidth * 2;
  if (origin > timelineWidth - width || local < margin || local > width - viewportWidth - margin) {
    origin = Math.max(0, Math.min(timelineWidth - width, logical - width / 2));
  }
  return { origin, left: logical - origin, logical, width };
}

export function boundedRange(left, width, origin, segmentWidth) {
  const start = Math.max(origin, left);
  const end = Math.min(origin + segmentWidth, left + width);
  return { left: Math.max(0, Math.min(segmentWidth, start - origin)), width: Math.max(0, end - start), skipped: Math.max(0, start - left) };
}

export function clampDuration(duration, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(duration) ? duration : maximum));
}

export function durationFromSlider(value, minimum, maximum) {
  return minimum * Math.pow(maximum / minimum, Math.max(0, Math.min(1, value)));
}

export function zoomAnchor(scrollLeft, width, pixelsPerMs, playheadMs, pointerX) {
  const playheadX = playheadMs * pixelsPerMs - scrollLeft;
  const x = Number.isFinite(pointerX) ? Math.max(0, Math.min(width, pointerX))
    : playheadX >= 0 && playheadX <= width ? playheadX : width / 2;
  return { timeMs: (scrollLeft + x) / pixelsPerMs, x };
}

export function anchoredScroll(anchor, pixelsPerMs, width, timelineWidth) {
  return Math.max(0, Math.min(Math.max(0, timelineWidth - width), anchor.timeMs * pixelsPerMs - anchor.x));
}

export function normalizeWheel(event, pageSize) {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;
  return { x: event.deltaX * factor, y: event.deltaY * factor };
}

export function rulerInterval(pixelsPerMs, targetPx = 80) {
  const desired = targetPx / pixelsPerMs;
  const power = Math.pow(10, Math.floor(Math.log10(desired)));
  return [1, 2, 5, 10].map((n) => n * power).find((n) => n >= desired) || power * 10;
}

export function visibleRulerTicks(left, width, pixelsPerMs, interval, duration) {
  const first = Math.max(0, Math.floor((left - VIEWPORT_OVERSCAN_PX) / pixelsPerMs / interval));
  const last = Math.min(Math.ceil(duration / interval), Math.ceil((left + width + VIEWPORT_OVERSCAN_PX) / pixelsPerMs / interval));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => (first + i) * interval);
}

export function rowOffsets(rows) {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1] + row.height);
  return offsets;
}

export function rowAtY(offsets, y) {
  if (y < 0 || y >= offsets[offsets.length - 1]) return -1;
  let low = 0;
  let high = offsets.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle] <= y) low = middle;
    else high = middle;
  }
  return low;
}

export function intersectsViewport(left, width, viewportLeft, viewportWidth, overscan = VIEWPORT_OVERSCAN_PX) {
  return left + width >= viewportLeft - overscan && left <= viewportLeft + viewportWidth + overscan;
}
