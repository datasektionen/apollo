import { prepareWaveformCanvas, waveformRasterBudget, WAVEFORM_OVERSCAN_PX } from './waveformRenderer';

/** Device columns per painted strip; visible work is re-prioritized between strips. */
export const WAVEFORM_STRIP_COLUMNS = 512;
/** Device columns moved per scratch copy when a canvas shifts onto itself. */
export const WAVEFORM_SHIFT_CHUNK_COLUMNS = 256;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bitmapDonors = new Set();

function cleanRanges(origin, columns, dirty) {
  let ranges = [[origin, origin + columns]];
  for (const [start, end] of dirty) ranges = subtractRange(ranges, start, end);
  return ranges;
}

/** A live clip canvas. A later view of the same source can copy it instead of redrawing. */
export function registerWaveformBitmap(donor) {
  bitmapDonors.add(donor);
  return () => bitmapDonors.delete(donor);
}

/**
 * Copies device columns from an earlier clip of the same source. The cut has to land on a device
 * pixel, otherwise the columns do not line up and the caller paints from samples as usual.
 * Returns how many columns were copied.
 */
export function adoptWaveformBitmap(surface, draw) {
  const target = surface?.bitmap?.();
  if (!target || !(draw?.pixelsPerMs > 0)) return 0;
  let copied = 0;
  for (const donorRef of bitmapDonors) {
    const donor = donorRef.read?.();
    if (!donor || donor.surface === surface || donor.blobId !== draw.blobId) continue;
    if (donor.dpr !== target.dpr || !(donor.pixelsPerMs > 0)) continue;
    // The two halves share a timeline zoom. Their stored scales can differ by a rounding ulp.
    if (Math.abs(donor.pixelsPerMs - draw.pixelsPerMs) > 1e-4 * donor.pixelsPerMs) continue;
    if (donor.height !== draw.height || donor.color !== draw.color || donor.displayMode !== draw.displayMode) continue;
    if (donor.showRms !== draw.showRms || donor.showClipping !== draw.showClipping || donor.showSamples !== draw.showSamples) continue;
    if (donor.globalPeakAmplitude !== draw.globalPeakAmplitude) continue;
    const shiftDevice = (draw.cropStartMs - donor.cropStartMs) * donor.pixelsPerMs * target.dpr;
    if (!(shiftDevice > 0.5)) continue;
    const shift = Math.round(shiftDevice);
    for (const [start, end] of cleanRanges(donor.origin, donor.columns, donor.dirty)) {
      copied += surface.adoptPainted(donor.canvas, start - donor.origin, start - shift, end - start);
    }
  }
  return copied;
}
const defaultCreateCanvas = () => document.createElement('canvas');
// One small scratch per canvas factory: production surfaces share one, test fakes stay apart.
const scratches = new WeakMap();

function scratchFor(createCanvas, rows) {
  let canvas = scratches.get(createCanvas);
  if (!canvas) {
    canvas = createCanvas();
    scratches.set(createCanvas, canvas);
  }
  if (canvas.width < WAVEFORM_SHIFT_CHUNK_COLUMNS || canvas.height < rows) {
    canvas.width = WAVEFORM_SHIFT_CHUNK_COLUMNS;
    canvas.height = Math.max(rows, canvas.height);
  }
  const context = canvas.getContext('2d');
  return context && { canvas, context };
}

/**
 * The part of a view a retained canvas covers: the viewport plus one viewport of margin on each
 * side, clamped to the view's extent. All values are view-local CSS px.
 */
export function getRetainedWindow({ extentPx, viewportLeftPx, viewportWidthPx }) {
  const extent = Math.max(0, finite(extentPx));
  const viewport = Math.max(0, finite(viewportWidthPx));
  const left = finite(viewportLeftPx) - viewport;
  if (!viewport || left + 3 * viewport <= 0 || left >= extent) return { leftPx: 0, widthPx: 0 };
  const widthPx = Math.min(extent, 3 * viewport);
  return { leftPx: Math.max(0, Math.min(extent - widthPx, left)), widthPx };
}

function addRange(ranges, start, end) {
  if (start >= end) return ranges;
  const result = [];
  for (const [a, b] of ranges) {
    if (b < start || a > end) result.push([a, b]);
    else { start = Math.min(start, a); end = Math.max(end, b); }
  }
  result.push([start, end]);
  return result.sort((x, y) => x[0] - y[0]);
}

function subtractRange(ranges, start, end) {
  const result = [];
  for (const [a, b] of ranges) {
    if (b <= start || a >= end) { result.push([a, b]); continue; }
    if (a < start) result.push([a, start]);
    if (b > end) result.push([end, b]);
  }
  return result;
}

function clipRanges(ranges, start, end) {
  return ranges.flatMap(([a, b]) => Math.max(a, start) < Math.min(b, end) ? [[Math.max(a, start), Math.min(b, end)]] : []);
}

/**
 * Retained raster for one waveform view. Geometry is view-local CSS px: [0, extentPx) is the clip or
 * lane, viewport lefts are in the same frame. The canvas spans the viewport plus one viewport on each
 * side. Scrolling inside that range touches no pixels; nearing its edge shifts the bitmap by whole
 * device pixels and only the exposed strip is repainted, nearest the viewport first.
 *
 * A second layer holds the window for one jump target (return to start). It is painted only after
 * the live canvas is complete, and adopted instead of repainting when the view jumps there.
 *
 * paint(context, { surfaceLeftPx, surfaceWidthPx, fromColumn, toColumn, dpr }) returns a resumable
 * job for those canvas device columns; the surface clears them first.
 */
export function createWaveformSurface({
  canvas, extentPx, viewportWidthPx, height, dpr, paint,
  budget = waveformRasterBudget, createCanvas = defaultCreateCanvas,
}) {
  let coveredPx = finite(extentPx);
  const widthPx = Math.min(coveredPx, 3 * finite(viewportWidthPx));
  if (!(widthPx > 0) || !(height > 0)) return null;
  const context = prepareWaveformCanvas(canvas, widthPx, height, dpr, budget);
  if (!context) return null;
  const ratio = budget.getAllocation(canvas).dpr;
  const columns = canvas.width;
  const rows = canvas.height;
  let extent = Math.ceil(coveredPx * ratio);
  const live = { canvas, context, origin: null, dirty: [] };
  let returned = null;
  let returnOrigin = null;
  let returnBlocked = false;
  let viewportLeft = 0;
  let current = null;
  let disposed = false;

  const originFor = (left) => Math.max(0, Math.min(extent - columns, Math.round((left - viewportWidthPx) * ratio)));
  const span = (margin) => [
    Math.max(0, Math.floor((viewportLeft - margin) * ratio)),
    Math.min(extent, Math.ceil((viewportLeft + viewportWidthPx + margin) * ratio)),
  ];
  const visible = () => span(WAVEFORM_OVERSCAN_PX);

  function deviceOp(layer, operation) {
    layer.context.save();
    try {
      layer.context.setTransform(1, 0, 0, 1, 0, 0);
      operation(layer.context);
    } finally { layer.context.restore(); }
  }

  /** Places source's pixels into target at origin. Returns the columns target must still paint. */
  function copyLayer(source, target, origin) {
    const start = source.origin === null ? origin : Math.max(source.origin, origin);
    const end = source.origin === null ? origin : Math.min(source.origin, origin) + columns;
    if (start >= end) {
      deviceOp(target, (ctx) => ctx.clearRect(0, 0, columns, rows));
      return [[origin, origin + columns]];
    }
    const dst = start - origin;
    const src = start - source.origin;
    const width = end - start;
    // The 'copy' operator is avoided: Chrome then rasterizes later fills on that canvas differently,
    // so repainted strips would not match their neighbours. Source-over onto cleared pixels is exact.
    if (source !== target) {
      deviceOp(target, (ctx) => {
        ctx.clearRect(0, 0, columns, rows);
        ctx.drawImage(source.canvas, src, 0, width, rows, dst, 0, width, rows);
      });
    } else if (src !== dst) {
      const scratch = scratchFor(createCanvas, rows);
      if (!scratch) {
        deviceOp(target, (ctx) => ctx.clearRect(0, 0, columns, rows));
        return [[origin, origin + columns]];
      }
      // Chunks go in memmove order, so no chunk overwrites source columns that are still unread.
      const step = WAVEFORM_SHIFT_CHUNK_COLUMNS;
      const offsets = [];
      for (let offset = 0; offset < width; offset += step) offsets.push(offset);
      if (dst > src) offsets.reverse();
      deviceOp(target, (ctx) => {
        for (const offset of offsets) {
          const chunk = Math.min(step, width - offset);
          scratch.context.clearRect(0, 0, chunk, rows);
          scratch.context.drawImage(target.canvas, src + offset, 0, chunk, rows, 0, 0, chunk, rows);
          ctx.clearRect(dst + offset, 0, chunk, rows);
          ctx.drawImage(scratch.canvas, 0, 0, chunk, rows, dst + offset, 0, chunk, rows);
        }
        if (dst > 0) ctx.clearRect(0, 0, dst, rows);
        if (dst + width < columns) ctx.clearRect(dst + width, 0, columns - dst - width, rows);
      });
    }
    let dirty = clipRanges(source.dirty, origin, origin + columns);
    // A strip next to kept pixels also repaints one kept column, so neither side's line edges are lost.
    if (start > origin) dirty = addRange(dirty, origin, start + 1);
    if (end < origin + columns) dirty = addRange(dirty, end - 1, origin + columns);
    return dirty;
  }

  function moveLive(origin) {
    current = null;
    const overlap = (layer) => {
      if (!layer || layer.origin === null) return -1;
      const start = Math.max(layer.origin, origin);
      const end = Math.min(layer.origin, origin) + columns;
      if (start >= end) return 0;
      return end - start - clipRanges(layer.dirty, start, end).reduce((sum, [a, b]) => sum + b - a, 0);
    };
    const source = returned?.seeded && overlap(returned) > overlap(live) ? returned : live;
    live.dirty = copyLayer(source, live, origin);
    live.origin = origin;
    canvas.style.left = `${origin / ratio}px`;
    canvas.style.width = `${columns / ratio}px`;
  }

  function ensureReturn() {
    if (returnOrigin === null || returnBlocked) return null;
    if (!returned) {
      const other = createCanvas();
      const otherContext = prepareWaveformCanvas(other, widthPx, height, dpr, budget);
      if (!otherContext || budget.getAllocation(other).dpr !== ratio || other.width !== columns) {
        if (otherContext) budget.release(other);
        returnBlocked = true;
        return null;
      }
      returned = { canvas: other, context: otherContext, origin: null, dirty: [], seeded: false };
    }
    if (!returned.seeded) {
      returned.dirty = copyLayer(live, returned, returnOrigin);
      returned.origin = returnOrigin;
      returned.seeded = true;
    }
    return returned;
  }

  function releaseReturn() {
    if (current?.layer === returned) current = null;
    if (returned) budget.release(returned.canvas);
    returned = null;
  }

  function nextStrip() {
    if (live.dirty.length) {
      const [start, end] = visible();
      for (const [a, b] of live.dirty) {
        const from = Math.max(a, start);
        const to = Math.min(b, end);
        if (from < to) return { layer: live, a: from, b: Math.min(to, from + WAVEFORM_STRIP_COLUMNS) };
      }
      let best;
      for (const [a, b] of live.dirty) {
        const distance = a >= end ? a - end : start - b;
        if (!best || distance < best.distance) {
          best = a >= end ? { a, b: Math.min(b, a + WAVEFORM_STRIP_COLUMNS) } : { a: Math.max(a, b - WAVEFORM_STRIP_COLUMNS), b };
          best.distance = distance;
        }
      }
      return { layer: live, a: best.a, b: best.b };
    }
    const layer = ensureReturn();
    if (!layer?.dirty.length) return null;
    const [a, b] = layer.dirty[0];
    return { layer, a, b: Math.min(b, a + WAVEFORM_STRIP_COLUMNS) };
  }

  const returnPending = () => returnOrigin !== null && !returnBlocked && (!returned?.seeded || returned.dirty.length > 0);

  return {
    canvas,
    dpr: ratio,
    /** Clip or lane length the retained window was built for, in CSS px. */
    get extentPx() { return coveredPx; },
    /** Grows the covered length. A larger canvas is allocated by the caller; this only extends the clamp. */
    setExtent(nextPx) {
      const next = finite(nextPx);
      if (!(next > coveredPx)) return false;
      coveredPx = next;
      extent = Math.ceil(coveredPx * ratio);
      return true;
    },
    /** Moves the viewport; returns true when this exposed pixels that need painting. */
    setViewport(left) {
      viewportLeft = finite(left);
      const [a, b] = span(viewportWidthPx / 2);
      if (live.origin !== null && (a >= b || (a >= live.origin && b <= live.origin + columns))) return false;
      const origin = originFor(viewportLeft);
      if (origin === live.origin) return false;
      moveLive(origin);
      return true;
    },
    /** The viewport left of the jump target, or null. Returns true when it needs painting. */
    setReturnViewport(left) {
      const origin = Number.isFinite(left) ? originFor(left) : null;
      if (origin === returnOrigin) return false;
      returnOrigin = origin;
      if (origin === null) { releaseReturn(); return false; }
      if (current?.layer === returned) current = null;
      if (returned) returned.seeded = false;
      return true;
    },
    /** View-local CSS px whose pixels must be repainted. */
    invalidate(fromPx, toPx) {
      const a = Math.floor(fromPx * ratio);
      const b = Math.ceil(toPx * ratio);
      for (const layer of [live, returned]) {
        if (layer?.origin != null) layer.dirty = addRange(layer.dirty, Math.max(a, layer.origin), Math.min(b, layer.origin + columns));
      }
      if (current && current.a < b && current.b > a) current = null;
    },
    /** Drops every retained pixel, for replaced sources. */
    clear() {
      current = null;
      if (live.origin !== null) {
        deviceOp(live, (ctx) => ctx.clearRect(0, 0, columns, rows));
        live.dirty = [[live.origin, live.origin + columns]];
      }
      if (returned) returned.seeded = false;
    },
    /** Live canvas in clip-local device columns, including ranges that are not painted yet. */
    bitmap() {
      if (disposed || live.origin === null) return null;
      return {
        canvas, dpr: ratio, origin: live.origin, columns,
        dirty: live.dirty.map((range) => range.slice()),
      };
    },
    /** Copies painted device columns into this canvas and keeps them. */
    adoptPainted(sourceCanvas, srcX, dstAbsolute, width) {
      if (disposed || live.origin === null || !(width >= 1)) return 0;
      const dst = Math.round(dstAbsolute);
      const src = Math.round(srcX);
      const wide = Math.round(width);
      const dstStart = Math.max(dst, live.origin);
      const dstEnd = Math.min(dst + wide, live.origin + columns);
      if (!(dstEnd - dstStart >= 1)) return 0;
      const srcStart = src + (dstStart - dst);
      deviceOp(live, (ctx) => {
        ctx.drawImage(sourceCanvas, srcStart, 0, dstEnd - dstStart, rows, dstStart - live.origin, 0, dstEnd - dstStart, rows);
      });
      live.dirty = subtractRange(live.dirty, dstStart, dstEnd);
      if (current && current.layer === live && current.a < dstEnd && current.b > dstStart) current = null;
      return dstEnd - dstStart;
    },
    /** View-local CSS px currently covered by the live canvas. */
    windowPx() {
      const origin = live.origin ?? originFor(viewportLeft);
      return { leftPx: origin / ratio, rightPx: (origin + columns) / ratio };
    },
    hasVisibleWork() {
      const [start, end] = visible();
      return live.origin === null || live.dirty.some(([a, b]) => a < end && b > start);
    },
    hasWork() {
      return live.origin === null || Boolean(current) || live.dirty.length > 0 || returnPending();
    },
    /** Paints one slice; returns true while work remains. */
    run(budget) {
      if (disposed) return false;
      if (live.origin === null) moveLive(originFor(viewportLeft));
      if (!current) {
        const strip = nextStrip();
        if (!strip) return false;
        const { layer, a, b } = strip;
        deviceOp(layer, (ctx) => ctx.clearRect(a - layer.origin, 0, b - a, rows));
        strip.job = paint(layer.context, {
          surfaceLeftPx: layer.origin / ratio, surfaceWidthPx: columns / ratio,
          fromColumn: a - layer.origin, toColumn: b - layer.origin, dpr: ratio,
        });
        current = strip;
      }
      const strip = current;
      let more;
      try { more = strip.job(budget) === true; } catch (error) { current = null; throw error; }
      if (!more && current === strip) {
        strip.layer.dirty = subtractRange(strip.layer.dirty, strip.a, strip.b);
        current = null;
      }
      return this.hasWork();
    },
    dispose() {
      disposed = true;
      current = null;
      releaseReturn();
      budget.release(canvas);
    },
  };
}
