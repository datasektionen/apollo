import { describe, expect, it } from 'vitest';
import { createWaveformRasterBudget } from '../waveformRenderer';
import { createWaveformSurface, getRetainedWindow, WAVEFORM_STRIP_COLUMNS } from '../waveformSurface';

/** A canvas whose pixels are one value per device column. */
function columnCanvas() {
  const canvas = { width: 0, height: 0, style: {}, columns: [] };
  let scale = 1;
  let clip = null;
  let path = null;
  const stack = [];
  const context = {
    canvas,
    globalCompositeOperation: 'source-over',
    save() { stack.push({ scale, clip, operation: context.globalCompositeOperation }); },
    restore() { ({ scale, clip, operation: context.globalCompositeOperation } = stack.pop()); },
    setTransform(a) { scale = a; },
    beginPath() { path = null; },
    rect(x, _y, width) { path = [x * scale, (x + width) * scale]; },
    clip() { clip = path; },
    clearRect(x, _y, width) {
      for (let column = Math.round(x * scale); column < Math.round((x + width) * scale); column += 1) canvas.columns[column] = undefined;
    },
    // Source-over: an empty source column leaves the destination as it was.
    drawImage(source, sx, _sy, width, _sh, dx) {
      if (context.globalCompositeOperation !== 'source-over') throw new Error('surfaces only composite source-over');
      const copied = Array.from({ length: width }, (_, i) => source.columns[sx + i]);
      copied.forEach((value, i) => {
        const column = dx + i;
        if (value !== undefined && (!clip || (column >= clip[0] && column < clip[1]))) canvas.columns[column] = value;
      });
    },
  };
  canvas.getContext = () => context;
  return canvas;
}

function harness({ extentPx = 10000, viewportWidthPx = 100, dpr = 1 } = {}) {
  const budget = createWaveformRasterBudget(1 << 30);
  const strips = [];
  const canvas = columnCanvas();
  const surface = createWaveformSurface({
    canvas, extentPx, viewportWidthPx, height: 10, dpr, budget, createCanvas: columnCanvas,
    // Each column records the global device column it shows.
    paint: (context, { surfaceLeftPx, fromColumn, toColumn, dpr: ratio }) => {
      const origin = Math.round(surfaceLeftPx * ratio);
      strips.push({ canvas: context.canvas, from: origin + fromColumn, to: origin + toColumn });
      return () => {
        for (let column = fromColumn; column < toColumn; column += 1) context.canvas.columns[column] = origin + column;
        return false;
      };
    },
  });
  const settle = () => { for (let i = 0; i < 1000; i += 1) if (!surface.run({})) return; throw new Error('surface did not settle'); };
  const origin = () => Math.round(Number.parseFloat(canvas.style.left) * surface.dpr);
  const exact = () => canvas.columns.length === canvas.width
    && canvas.columns.every((value, column) => value === origin() + column);
  return { budget, canvas, surface, strips, settle, origin, exact };
}

describe('retained waveform surface', () => {
  it('covers the viewport plus one viewport on each side, clamped to the extent', () => {
    expect(getRetainedWindow({ extentPx: 10000, viewportLeftPx: 1000, viewportWidthPx: 100 })).toEqual({ leftPx: 900, widthPx: 300 });
    expect(getRetainedWindow({ extentPx: 10000, viewportLeftPx: 50, viewportWidthPx: 100 })).toEqual({ leftPx: 0, widthPx: 300 });
    expect(getRetainedWindow({ extentPx: 120, viewportLeftPx: -150, viewportWidthPx: 100 })).toEqual({ leftPx: 0, widthPx: 120 });
    expect(getRetainedWindow({ extentPx: 120, viewportLeftPx: 250, viewportWidthPx: 100 })).toEqual({ leftPx: 0, widthPx: 0 });
  });

  it('paints the viewport first, then the margins, and touches nothing while scrolling inside them', () => {
    const h = harness();
    h.surface.setViewport(1000);
    expect(h.surface.hasVisibleWork()).toBe(true);
    h.surface.run({});
    expect(h.strips[0]).toMatchObject({ from: 968 });
    expect(h.surface.hasVisibleWork()).toBe(false);
    h.settle();
    expect(h.origin()).toBe(900);
    expect(h.exact()).toBe(true);
    h.strips.length = 0;
    for (const left of [1040, 960, 1049]) expect(h.surface.setViewport(left)).toBe(false);
    expect(h.surface.run({})).toBe(false);
    expect(h.strips).toEqual([]);
  });

  it('shifts by whole device columns and repaints only the exposed strip and one seam column', () => {
    const h = harness({ dpr: 2 });
    h.surface.setViewport(1000);
    h.settle();
    h.strips.length = 0;
    expect(h.surface.setViewport(1060.3)).toBe(true);
    // round((1060.3 - 100) * 2) = 1921: the kept 479 columns move, the new 121 plus a seam column repaint.
    expect(h.origin()).toBe(1921);
    expect(h.surface.hasVisibleWork()).toBe(false);
    h.settle();
    expect(h.strips.map(({ from, to }) => [from, to])).toEqual([[2399, 2521]]);
    expect(h.exact()).toBe(true);
  });

  it('shifts right through the scratch in reverse chunks when scrolling back', () => {
    const h = harness({ viewportWidthPx: 400 });
    h.surface.setViewport(1000);
    h.settle();
    h.strips.length = 0;
    expect(h.surface.setViewport(780)).toBe(true);
    // The 980 kept columns span several scratch chunks; a forward copy would read overwritten columns.
    expect(h.origin()).toBe(380);
    expect(h.canvas.columns.slice(220).every((value, i) => value === 600 + i)).toBe(true);
    h.settle();
    expect(h.strips.map(({ from, to }) => [from, to])).toEqual([[380, 601]]);
    expect(h.exact()).toBe(true);
  });

  it('paints a jump beyond the margin from the viewport outward in bounded strips', () => {
    const h = harness({ viewportWidthPx: 1000 });
    h.surface.setViewport(1000);
    h.settle();
    h.strips.length = 0;
    h.surface.setViewport(6000);
    h.settle();
    expect(h.strips[0].from).toBe(5968);
    expect(h.strips.every(({ from, to }) => to - from <= WAVEFORM_STRIP_COLUMNS)).toBe(true);
    expect(h.strips.reduce((sum, { from, to }) => sum + to - from, 0)).toBe(3000);
    expect(h.exact()).toBe(true);
  });

  it('keeps the return-to-start window painted and adopts it after the jump without repainting', () => {
    const h = harness();
    h.surface.setViewport(5000);
    h.surface.setReturnViewport(0);
    h.settle();
    const returnStrips = h.strips.filter(({ canvas }) => canvas !== h.canvas);
    expect(returnStrips.reduce((sum, { from, to }) => sum + to - from, 0)).toBe(300);
    expect(h.budget.getStats().surfaces).toBe(2);
    h.strips.length = 0;
    expect(h.surface.setViewport(0)).toBe(true);
    expect(h.origin()).toBe(0);
    expect(h.exact()).toBe(true);
    expect(h.surface.hasVisibleWork()).toBe(false);
    h.settle();
    expect(h.strips).toEqual([]);
  });

  it('reseeds a moved return window from overlapping live pixels and drops it when unset', () => {
    const h = harness();
    h.surface.setViewport(1000);
    h.surface.setReturnViewport(1050);
    h.settle();
    // Live covers [900, 1200); the return window [950, 1250) only paints what live lacks, plus a seam.
    expect(h.strips.filter(({ canvas }) => canvas !== h.canvas).map(({ from, to }) => [from, to])).toEqual([[1199, 1250]]);
    h.strips.length = 0;
    expect(h.surface.setReturnViewport(1100)).toBe(true);
    h.settle();
    expect(h.strips.map(({ from, to }) => [from, to])).toEqual([[1199, 1300]]);
    h.strips.length = 0;
    h.surface.setViewport(1100);
    expect(h.exact()).toBe(true);
    h.settle();
    expect(h.strips).toEqual([]);
    h.surface.setReturnViewport(null);
    expect(h.budget.getStats().surfaces).toBe(1);
    h.surface.dispose();
    expect(h.budget.getStats()).toMatchObject({ surfaces: 0, bytes: 0 });
  });

  it('repaints invalidated columns in both layers and clears everything for replaced sources', () => {
    const h = harness();
    h.surface.setViewport(1000);
    h.surface.setReturnViewport(1050);
    h.settle();
    h.strips.length = 0;
    const kept = h.canvas.columns.slice();
    h.surface.invalidate(1100, 1110);
    expect(h.surface.presenting()).toBe(true);
    expect(h.canvas.columns).toEqual(kept);
    h.settle();
    expect(h.surface.presenting()).toBe(false);
    expect(h.strips.map(({ from, to }) => [from, to])).toEqual([[1100, 1110], [1100, 1110]]);
    h.strips.length = 0;
    h.surface.clear();
    expect(h.surface.presenting()).toBe(true);
    expect(h.canvas.columns.every((value, column) => value === h.origin() + column)).toBe(true);
    expect(h.surface.hasVisibleWork()).toBe(true);
    h.settle();
    expect(h.surface.presenting()).toBe(false);
    expect(h.exact()).toBe(true);
    h.surface.dispose();
  });

  it('keeps the displayed picture until a replacement visible window is painted', () => {
    const h = harness();
    h.surface.setViewport(1000);
    h.settle();
    const kept = h.canvas.columns.slice();
    expect(h.surface.revise({ extentPx: 10000, viewportWidthPx: 100, height: 10, dpr: 1, replace: true })).toBe(true);
    expect(h.surface.presenting()).toBe(true);
    expect(h.canvas.columns).toEqual(kept);
    h.surface.run({});
    expect(h.surface.presenting()).toBe(false);
    expect(h.surface.hasVisibleWork()).toBe(false);
    h.settle();
    expect(h.exact()).toBe(true);
    expect(h.budget.getStats().surfaces).toBe(1);
    h.surface.dispose();
  });

  it('installs a prepared zoom picture in the visible window and leaves the margins dirty', () => {
    const h = harness();
    h.surface.setViewport(1000);
    h.settle();
    const bitmap = columnCanvas();
    const width = 164;
    bitmap.width = width;
    bitmap.height = 10;
    bitmap.columns = Array.from({ length: width }, () => 7);
    h.surface.setViewport(1000);
    expect(h.surface.showPrepared({
      extentPx: 10000, viewportWidthPx: 100, height: 10, dpr: 1,
      bitmap: { canvas: bitmap, dpr: 1, leftPx: 968, widthPx: width },
    })).toBe(true);
    expect(h.surface.presenting()).toBe(false);
    expect(h.surface.hasVisibleWork()).toBe(false);
    expect(h.surface.hasMarginWork()).toBe(true);
    const origin = h.origin();
    expect(h.canvas.columns.slice(968 - origin, 968 - origin + width).every((value) => value === 7)).toBe(true);
    h.surface.dispose();
  });

  it('copies painted columns from an earlier clip and draws only the uncovered tail', () => {
    const donor = harness({ extentPx: 1000, viewportWidthPx: 200, dpr: 2 });
    donor.surface.setViewport(0);
    donor.settle();
    const next = harness({ extentPx: 800, viewportWidthPx: 200, dpr: 2 });
    next.surface.setViewport(0);
    const bitmap = donor.surface.bitmap();
    const shift = 200;
    const copied = next.surface.adoptPainted(bitmap.canvas, shift, 0, bitmap.columns - shift);
    expect(copied).toBe(bitmap.columns - shift);
    expect(next.canvas.columns.slice(0, copied).every((value, column) => value === shift + column)).toBe(true);
    next.strips.length = 0;
    next.settle();
    expect(next.strips.length).toBeGreaterThan(0);
    expect(next.strips.every(({ from }) => from >= copied)).toBe(true);
    expect(next.canvas.columns.slice(0, copied).every((value, column) => value === shift + column)).toBe(true);
    donor.surface.dispose();
    next.surface.dispose();
  });
});
