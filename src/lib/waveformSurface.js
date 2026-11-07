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
    if (donor.showRms !== draw.showRms || donor.showSamples !== draw.showSamples) continue;
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
 * Which scheduler tier a view should use. On-screen work stays at `floor` (0 for a row on screen,
 * 2 for a row above or below). After that window is painted, horizontal margins are tier 1 unless
 * the row itself is waiting, and the return-to-start window is tier 3.
 */
export function waveformPaintTier(surface, floor = 0) {
  if (!surface || surface.hasVisibleWork()) return floor;
  if (surface.hasMarginWork()) return Math.max(floor, 1);
  if (surface.hasReturnWork()) return 3;
  return floor;
}

/**
 * Retained raster for one waveform view. Geometry is view-local CSS px: [0, extentPx) is the clip or
 * lane, viewport lefts are in the same frame. The canvas spans the viewport plus one viewport on each
 * side. Scrolling inside that range touches no pixels; nearing its edge shifts the bitmap by whole
 * device pixels and only the exposed strip is repainted, nearest the viewport first.
 *
 * A replacement of an existing picture is drawn on an offscreen canvas. The canvas on screen keeps
 * its pixels until the new visible window is finished, then swaps in one step. Margins paint after
 * that swap. An empty first paint and a scroll-exposed edge still paint directly.
 *
 * A second layer holds the window for one jump target (return to start). It is painted only after
 * the live canvas is complete, and adopted instead of repainting when the view jumps there.
 *
 * paint(context, { surfaceLeftPx, surfaceWidthPx, fromColumn, toColumn, dpr }) returns a resumable
 * job for those canvas device columns. The paint target's strip is cleared when the job starts.
 */
export function createWaveformSurface({
  canvas, extentPx, viewportWidthPx, height, dpr, paint,
  budget = waveformRasterBudget, createCanvas = defaultCreateCanvas,
}) {
  let coveredPx = finite(extentPx);
  let viewportWidth = finite(viewportWidthPx);
  let cssHeight = height;
  let requestedDpr = dpr;
  let returned = null;
  let returnOrigin = null;
  let returnBlocked = false;
  let viewportLeft = 0;
  let current = null;
  let disposed = false;
  let holding = false;

  function allocate(target, cssWidth, layerHeight, layerDpr) {
    if (!(cssWidth > 0) || !(layerHeight > 0)) return null;
    const context = prepareWaveformCanvas(target, cssWidth, layerHeight, layerDpr, budget);
    if (!context) return null;
    const allocation = budget.getAllocation(target);
    return {
      canvas: target, context, origin: null, dirty: [],
      ratio: allocation.dpr, columns: target.width, rows: target.height,
      widthPx: cssWidth, height: layerHeight,
    };
  }

  const initialWidth = Math.min(coveredPx, 3 * viewportWidth);
  let shown = allocate(canvas, initialWidth, cssHeight, requestedDpr);
  if (!shown) return null;
  let live = shown;

  const extentDevice = () => Math.ceil(coveredPx * live.ratio);
  const originFor = (left) => {
    const extent = extentDevice();
    return Math.max(0, Math.min(Math.max(0, extent - live.columns), Math.round((left - viewportWidth) * live.ratio)));
  };
  const span = (margin) => {
    const extent = extentDevice();
    return [
      Math.max(0, Math.floor((viewportLeft - margin) * live.ratio)),
      Math.min(extent, Math.ceil((viewportLeft + viewportWidth + margin) * live.ratio)),
    ];
  };
  const visible = () => span(WAVEFORM_OVERSCAN_PX);

  function deviceOp(layer, operation) {
    layer.context.save();
    try {
      layer.context.setTransform(1, 0, 0, 1, 0, 0);
      operation(layer.context);
    } finally { layer.context.restore(); }
  }

  function placeShown() {
    if (shown.origin === null) return;
    canvas.style.left = `${shown.origin / shown.ratio}px`;
    canvas.style.width = `${shown.columns / shown.ratio}px`;
  }

  function cleanColumns(layer) {
    if (!layer || layer.origin === null) return 0;
    const dirty = layer.dirty.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, layer.origin + layer.columns) - Math.max(a, layer.origin)), 0);
    return layer.columns - dirty;
  }

  /** Places source's pixels into target at origin. Returns the columns target must still paint. */
  function copyLayer(source, target, origin) {
    const { columns, rows } = target;
    const compatible = source.columns === columns && source.rows === rows && source.ratio === target.ratio;
    const start = !compatible || source.origin === null ? origin : Math.max(source.origin, origin);
    const end = !compatible || source.origin === null ? origin : Math.min(source.origin, origin) + columns;
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
    if (live.origin === null) {
      live.origin = origin;
      live.dirty = [[origin, origin + live.columns]];
      if (!holding) placeShown();
      return;
    }
    const overlap = (layer) => {
      if (!layer || layer.origin === null || layer.columns !== live.columns || layer.ratio !== live.ratio) return -1;
      const start = Math.max(layer.origin, origin);
      const end = Math.min(layer.origin, origin) + live.columns;
      if (start >= end) return 0;
      return end - start - clipRanges(layer.dirty, start, end).reduce((sum, [a, b]) => sum + b - a, 0);
    };
    // A replacement draft is a new picture. It does not adopt the image still on screen.
    const source = !holding && returned?.seeded && overlap(returned) > overlap(live) ? returned : live;
    live.dirty = copyLayer(source, live, origin);
    live.origin = origin;
    if (!holding) placeShown();
  }

  /** Draws the next picture offscreen. The canvas on screen is left untouched. */
  function beginHold({ blank, widthPx, height: layerHeight, dpr: layerDpr }) {
    if (live !== shown) {
      if (current?.layer === live) current = null;
      budget.release(live.canvas);
      live = shown;
      holding = false;
    }
    const draft = allocate(createCanvas(), widthPx, layerHeight, layerDpr);
    if (!draft) return false;
    const same = shown.origin !== null && draft.columns === shown.columns && draft.rows === shown.rows && draft.ratio === shown.ratio;
    if (same && !blank) {
      draft.dirty = copyLayer(shown, draft, shown.origin);
      draft.origin = shown.origin;
    } else if (same) {
      draft.origin = shown.origin;
      draft.dirty = [[shown.origin, shown.origin + draft.columns]];
    }
    if (current?.layer === shown) current = null;
    live = draft;
    holding = true;
    return true;
  }

  /** Copies a finished visible window onto the canvas on screen, then paints margins there. */
  function commitHold() {
    if (!holding) return;
    const [start, end] = visible();
    if (live.origin === null || live.dirty.some(([a, b]) => a < end && b > start)) return;
    if (live !== shown) {
      if (shown.columns !== live.columns || shown.rows !== live.rows || shown.ratio !== live.ratio) {
        const next = allocate(canvas, live.widthPx, live.height, requestedDpr);
        if (!next) { holding = false; return; }
        shown = next;
      }
      const width = Math.min(shown.columns, live.columns);
      const heightPx = Math.min(shown.rows, live.rows);
      deviceOp(shown, (ctx) => {
        ctx.clearRect(0, 0, shown.columns, shown.rows);
        ctx.drawImage(live.canvas, 0, 0, width, heightPx, 0, 0, width, heightPx);
      });
      shown.origin = live.origin;
      shown.dirty = live.dirty.map((range) => range.slice());
      if (current?.layer === live) current = null;
      budget.release(live.canvas);
      live = shown;
    }
    holding = false;
    placeShown();
  }

  function ensureReturn() {
    if (returnOrigin === null || returnBlocked || holding) return null;
    if (!returned) {
      const other = createCanvas();
      const otherContext = prepareWaveformCanvas(other, live.widthPx, live.height, requestedDpr, budget);
      if (!otherContext || budget.getAllocation(other).dpr !== live.ratio || other.width !== live.columns) {
        if (otherContext) budget.release(other);
        returnBlocked = true;
        return null;
      }
      returned = {
        canvas: other, context: otherContext, origin: null, dirty: [], seeded: false,
        ratio: live.ratio, columns: other.width, rows: other.height, widthPx: live.widthPx, height: live.height,
      };
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
    get dpr() { return live.ratio; },
    /** Clip or lane length the retained window was built for, in CSS px. */
    get extentPx() { return coveredPx; },
    /** True while the canvas on screen is still the previous picture. */
    presenting() { return holding; },
    /** Grows the covered length. A larger canvas is allocated by the caller; this only extends the clamp. */
    setExtent(nextPx) {
      const next = finite(nextPx);
      if (!(next > coveredPx)) return false;
      coveredPx = next;
      return true;
    },
    /**
     * Starts a new picture when `replace` is set or the canvas must grow. An existing picture stays
     * on screen until the new visible window is painted. A shorter clip keeps the canvas it has.
     */
    revise({ extentPx: nextExtent = coveredPx, viewportWidthPx: nextViewport = viewportWidth, height: nextHeight = cssHeight, dpr: nextDpr = requestedDpr, replace = false } = {}) {
      if (disposed) return false;
      const nextCovered = Math.max(0, finite(nextExtent));
      const nextView = Math.max(0, finite(nextViewport));
      const cap = 3 * nextView;
      const nextWidth = Math.min(nextCovered, cap);
      // A shorter clip keeps the pixels it already has. The canvas shrinks only when the
      // margin cap, the height, or the resolution does, or when the picture is replaced.
      const resized = nextWidth > shown.widthPx + 0.5 || cap + 0.5 < shown.widthPx
        || nextHeight !== shown.height || nextDpr !== requestedDpr;
      if (!replace && !resized) {
        if (nextCovered > coveredPx + 0.5) coveredPx = nextCovered;
        if (Math.abs(nextView - viewportWidth) > 0.5) viewportWidth = nextView;
        return false;
      }
      coveredPx = replace ? nextCovered : Math.max(coveredPx, nextCovered);
      viewportWidth = nextView;
      cssHeight = nextHeight;
      requestedDpr = nextDpr;
      releaseReturn();
      returnBlocked = false;
      const widthPx = Math.min(coveredPx, 3 * viewportWidth);
      if (!(widthPx > 0) || !(nextHeight > 0)) return false;
      if (cleanColumns(shown) > 0 && beginHold({ blank: true, widthPx, height: nextHeight, dpr: nextDpr })) return true;
      if (resized || shown.widthPx !== widthPx || shown.height !== nextHeight) {
        const next = allocate(canvas, widthPx, nextHeight, nextDpr);
        if (!next) return false;
        shown = live = next;
        holding = false;
        return true;
      }
      if (live.origin !== null) {
        deviceOp(live, (ctx) => ctx.clearRect(0, 0, live.columns, live.rows));
        live.dirty = [[live.origin, live.origin + live.columns]];
      }
      return true;
    },
    /**
     * Swaps in a picture painted for a zoom that has not been shown yet. The visible window is
     * copied now, before the browser paints; the margins stay dirty and fill in afterwards.
     */
    showPrepared({ extentPx: nextExtent, viewportWidthPx: nextViewport, height: nextHeight, dpr: nextDpr, bitmap }) {
      if (disposed || !bitmap?.canvas) return false;
      if (live !== shown) {
        if (current?.layer === live) current = null;
        budget.release(live.canvas);
        live = shown;
        holding = false;
      }
      coveredPx = Math.max(0, finite(nextExtent));
      viewportWidth = Math.max(0, finite(nextViewport));
      cssHeight = nextHeight;
      requestedDpr = nextDpr;
      releaseReturn();
      returnBlocked = false;
      const widthPx = Math.min(coveredPx, 3 * viewportWidth);
      if (!(widthPx > 0) || !(nextHeight > 0)) return false;
      const next = allocate(canvas, widthPx, nextHeight, nextDpr);
      if (!next) return false;
      shown = live = next;
      holding = false;
      current = null;
      moveLive(originFor(viewportLeft));
      const srcW = bitmap.canvas.width;
      const dst = Math.round(bitmap.leftPx * live.ratio);
      const dstW = Math.max(1, Math.round((bitmap.widthPx || 0) * live.ratio));
      const dstStart = Math.max(dst, live.origin ?? dst);
      const dstEnd = Math.min(dst + dstW, (live.origin ?? dst) + live.columns);
      if (srcW > 0 && dstEnd - dstStart >= 1 && live.origin !== null) {
        const srcStart = (dstStart - dst) * srcW / dstW;
        const srcWidth = (dstEnd - dstStart) * srcW / dstW;
        deviceOp(live, (ctx) => {
          ctx.drawImage(bitmap.canvas, srcStart, 0, srcWidth, bitmap.canvas.height || live.rows,
            dstStart - live.origin, 0, dstEnd - dstStart, live.rows);
        });
        live.dirty = subtractRange(live.dirty, dstStart, dstEnd);
      }
      return true;
    },
    /** Moves the viewport; returns true when this exposed pixels that need painting. */
    setViewport(left) {
      viewportLeft = finite(left);
      const [a, b] = span(viewportWidth / 2);
      if (live.origin !== null && (a >= b || (a >= live.origin && b <= live.origin + live.columns))) return false;
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
      const ratio = live.ratio;
      const a = Math.floor(fromPx * ratio);
      const b = Math.ceil(toPx * ratio);
      const [start, end] = visible();
      if (!holding && cleanColumns(shown) > 0 && a < end && b > start) {
        beginHold({ blank: false, widthPx: shown.widthPx, height: shown.height, dpr: requestedDpr });
      }
      for (const layer of [live, returned]) {
        if (layer?.origin != null) layer.dirty = addRange(layer.dirty, Math.max(a, layer.origin), Math.min(b, layer.origin + layer.columns));
      }
      if (current && current.a < b && current.b > a) current = null;
    },
    /** Drops every retained pixel, for replaced sources. The picture on screen stays until the new one is ready. */
    clear() {
      current = null;
      if (returned) returned.seeded = false;
      if (cleanColumns(shown) > 0 && beginHold({ blank: true, widthPx: shown.widthPx, height: shown.height, dpr: requestedDpr })) return;
      if (live.origin !== null) {
        deviceOp(live, (ctx) => ctx.clearRect(0, 0, live.columns, live.rows));
        live.dirty = [[live.origin, live.origin + live.columns]];
      }
    },
    /** Displayed canvas in clip-local device columns, including ranges that are not painted yet. */
    bitmap() {
      const layer = shown;
      if (disposed || layer.origin === null) return null;
      return {
        canvas: layer.canvas, dpr: layer.ratio, origin: layer.origin, columns: layer.columns,
        dirty: layer.dirty.map((range) => range.slice()),
      };
    },
    /** Copies painted device columns into this canvas and keeps them. */
    adoptPainted(sourceCanvas, srcX, dstAbsolute, width) {
      if (disposed || live.origin === null || !(width >= 1) || holding) return 0;
      const dst = Math.round(dstAbsolute);
      const src = Math.round(srcX);
      const wide = Math.round(width);
      const dstStart = Math.max(dst, live.origin);
      const dstEnd = Math.min(dst + wide, live.origin + live.columns);
      if (!(dstEnd - dstStart >= 1)) return 0;
      const srcStart = src + (dstStart - dst);
      deviceOp(live, (ctx) => {
        ctx.drawImage(sourceCanvas, srcStart, 0, dstEnd - dstStart, live.rows, dstStart - live.origin, 0, dstEnd - dstStart, live.rows);
      });
      live.dirty = subtractRange(live.dirty, dstStart, dstEnd);
      if (current && current.layer === live && current.a < dstEnd && current.b > dstStart) current = null;
      return dstEnd - dstStart;
    },
    /** View-local CSS px currently covered by the paint target. */
    windowPx() {
      const origin = live.origin ?? originFor(viewportLeft);
      return { leftPx: origin / live.ratio, rightPx: (origin + live.columns) / live.ratio };
    },
    hasVisibleWork() {
      const [start, end] = visible();
      return live.origin === null || live.dirty.some(([a, b]) => a < end && b > start);
    },
    hasMarginWork() {
      if (live.origin === null) return false;
      const [start, end] = visible();
      return live.dirty.some(([a, b]) => a < start || b > end);
    },
    hasReturnWork() { return returnPending(); },
    hasWork() {
      return live.origin === null || Boolean(current) || live.dirty.length > 0 || returnPending();
    },
    /** Paints one slice; returns true while work remains. */
    run(runBudget) {
      if (disposed) return false;
      if (live.origin === null) moveLive(originFor(viewportLeft));
      if (!current) {
        const strip = nextStrip();
        if (!strip) return false;
        const { layer, a, b } = strip;
        deviceOp(layer, (ctx) => ctx.clearRect(a - layer.origin, 0, b - a, layer.rows));
        strip.job = paint(layer.context, {
          surfaceLeftPx: layer.origin / layer.ratio, surfaceWidthPx: layer.columns / layer.ratio,
          fromColumn: a - layer.origin, toColumn: b - layer.origin, dpr: layer.ratio,
        });
        current = strip;
      }
      const strip = current;
      let more;
      try { more = strip.job(runBudget) === true; } catch (error) { current = null; throw error; }
      if (!more && current === strip) {
        strip.layer.dirty = subtractRange(strip.layer.dirty, strip.a, strip.b);
        current = null;
        if (holding && strip.layer === live) commitHold();
      }
      return this.hasWork();
    },
    dispose() {
      disposed = true;
      current = null;
      releaseReturn();
      if (live !== shown) budget.release(live.canvas);
      budget.release(shown.canvas);
    },
  };
}
