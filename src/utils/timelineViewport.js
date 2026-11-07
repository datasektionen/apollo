const VIEWPORT_OVERSCAN_PX = 128;
const MAX_SCROLL_SEGMENT_PX = 1_000_000;

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

const FOLLOW_LEAD = 0.1;
// Per second. A small offset takes a couple of seconds to settle.
const FOLLOW_EASE_RATE = 0.6;
// Caps the centering speed. A playhead farther from the center takes longer to arrive.
const FOLLOW_MAX_CATCHUP_PX_PER_SEC = 48;

/** The logical scroll that puts the playhead FOLLOW_LEAD into the viewport. Used when playback stops. */
export function followLanding(playheadPx, width, timelineWidth) {
  return Math.max(0, Math.min(Math.max(0, timelineWidth - width), playheadPx - width * FOLLOW_LEAD));
}

/** The logical scroll that puts the playhead in the middle of the viewport. */
export function centeredScroll(playheadPx, width, timelineWidth) {
  return Math.max(0, Math.min(Math.max(0, timelineWidth - width), playheadPx - width / 2));
}

/**
 * Continuous follow. A playhead that is completely off screen lands in the center.
 * One that is on screen eases toward the center. Playback motion is tracked immediately;
 * only the centering error eases, and a speed cap makes a farther playhead take longer.
 */
export function easeFollowScroll({
  playheadPx, previousPlayheadPx = null, scrollLeft, width, timelineWidth, dt = 1 / 60,
}) {
  const desired = centeredScroll(playheadPx, width, timelineWidth);
  const onScreen = playheadPx >= scrollLeft && playheadPx <= scrollLeft + width;
  if (!onScreen) return desired;
  const previousDesired = previousPlayheadPx == null
    ? desired
    : centeredScroll(previousPlayheadPx, width, timelineWidth);
  const desiredMotion = desired - previousDesired;
  const residual = desired - (scrollLeft + desiredMotion);
  const step = Math.max(0, dt);
  const alpha = 1 - Math.exp(-FOLLOW_EASE_RATE * step);
  let correction = residual * alpha;
  const maxStep = FOLLOW_MAX_CATCHUP_PX_PER_SEC * step;
  if (Math.abs(correction) > maxStep) correction = Math.sign(correction) * maxStep;
  const next = scrollLeft + desiredMotion + correction;
  const maxScroll = Math.max(0, timelineWidth - width);
  const clamped = Math.max(0, Math.min(maxScroll, next));
  return Math.abs(desired - clamped) < 0.25 ? desired : clamped;
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

export const RULER_LABEL_HEIGHT = 22;
export const RULER_SEEK_HEIGHT = 16;
export const TIMELINE_RULER_HEIGHT = RULER_LABEL_HEIGHT + RULER_SEEK_HEIGHT;

// Clock-friendly steps (15s, 30s, minutes) sit alongside the 1-2-5 zoom ladder.
const RULER_MAJOR_LADDER_MS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1000, 2000, 5000, 10000, 15000, 30000,
  60000, 120000, 300000, 600000, 900000, 1800000, 3600000,
];
const RULER_SAMPLE_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/**
 * Major labels switch unit the way Audacity's time ruler does:
 * clock (m:ss, or h:mm:ss past an hour) at 1s and above, decimal seconds down to 10ms,
 * milliseconds until samples are far enough apart to read, then sample indexes.
 */
export function rulerScale(pixelsPerMs, { sampleRate = 48000, minMajorPx = 80 } = {}) {
  const safePpm = Math.max(pixelsPerMs, 1e-12);
  const minMs = minMajorPx / safePpm;
  let majorMs = RULER_MAJOR_LADDER_MS[RULER_MAJOR_LADDER_MS.length - 1];
  for (const step of RULER_MAJOR_LADDER_MS) {
    if (step >= minMs - 1e-9) { majorMs = step; break; }
  }
  while (majorMs < minMs) majorMs *= 2;
  const sampleMs = 1000 / Math.max(1, sampleRate);
  let unit = 'clock';
  if (majorMs >= 1000) unit = 'clock';
  else if (majorMs >= 10) unit = 'seconds';
  else if (majorMs > sampleMs * 40) unit = 'millis';
  else {
    unit = 'samples';
    const minSamples = Math.max(1, minMs / sampleMs);
    const snapped = RULER_SAMPLE_LADDER.find((count) => count >= minSamples - 1e-6) || Math.ceil(minSamples);
    majorMs = snapped * sampleMs;
  }
  let divisions = 10;
  let minorMs = majorMs / divisions;
  while (divisions > 1 && minorMs * safePpm < 5) {
    divisions /= 2;
    minorMs = majorMs / divisions;
  }
  const subMinorMs = minorMs / 2 * safePpm >= 4 ? minorMs / 2 : minorMs;
  return { majorMs, minorMs, subMinorMs, unit };
}

export function formatRulerLabel(ms, stepMs, unit, sampleRate = 48000) {
  const sign = ms < -0.0001 ? '-' : '';
  const abs = Math.abs(ms);
  if (unit === 'samples') return `${sign}${Math.round(abs * sampleRate / 1000)}`;
  if (unit === 'millis') {
    const digits = stepMs >= 1 ? 0 : stepMs >= 0.1 ? 1 : stepMs >= 0.01 ? 2 : 3;
    return `${sign}${Number(abs.toFixed(digits))} ms`;
  }
  if (unit === 'seconds') {
    const digits = stepMs >= 100 ? 1 : stepMs >= 10 ? 2 : 3;
    return `${sign}${(abs / 1000).toFixed(digits)}`;
  }
  const totalSeconds = Math.round(abs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0 || stepMs >= 3600000) {
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
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
