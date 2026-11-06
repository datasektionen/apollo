import { describe, expect, it } from 'vitest';
import {
  anchoredScroll, boundedRange, centeredScroll, clampDuration, durationFromSlider, easeFollowScroll, formatRulerLabel,
  intersectsViewport, normalizeWheel, rowAtY, rowOffsets, rulerInterval, rulerScale, scrollSegment, visibleRulerTicks, zoomAnchor,
} from '../timelineViewport';

describe('timeline viewport geometry', () => {
  it('preserves pointer time, visible playhead position, or offscreen playhead center', () => {
    const pointer = zoomAnchor(1000, 800, 2, 0, 150);
    expect(pointer).toEqual({ timeMs: 575, x: 150 });
    expect(anchoredScroll(pointer, 4, 800, 10000)).toBe(2150);
    expect(zoomAnchor(1000, 800, 2, 600)).toEqual({ timeMs: 600, x: 200 });
    expect(zoomAnchor(1000, 800, 2, 0)).toEqual({ timeMs: 700, x: 400 });
    expect(anchoredScroll(pointer, 0.1, 800, 800)).toBe(0);
  });
  it('clamps both ends of logarithmic slider and duration changes', () => {
    expect(durationFromSlider(-1, 1, 10000)).toBe(1);
    expect(durationFromSlider(2, 1, 10000)).toBe(10000);
    expect(durationFromSlider(0.5, 1, 10000)).toBe(100);
    expect(clampDuration(0.1, 1, 10)).toBe(1);
    expect(clampDuration(100, 1, 10)).toBe(10);
    expect(clampDuration(NaN, 1, 10)).toBe(10);
  });
  it('eases an on-screen playhead toward center and jumps only when it is off screen', () => {
    expect(centeredScroll(2000, 800, 10000)).toBe(1600);
    expect(easeFollowScroll({ playheadPx: 2000, scrollLeft: 0, width: 800, timelineWidth: 10000 })).toBe(1600);
    const step = (playheadPx, scrollLeft, previousPlayheadPx = null) => easeFollowScroll({
      playheadPx, previousPlayheadPx, scrollLeft, width: 800, timelineWidth: 10000, dt: 1 / 60,
    });
    const settle = (playheadPx, frames) => {
      let scroll = 0;
      let previous = null;
      for (let i = 0; i < frames; i += 1) {
        scroll = step(playheadPx, scroll, previous);
        previous = playheadPx;
      }
      return scroll;
    };
    const near = settle(440, 90); // 40px from the clamped center
    const far = settle(800, 90); // 400px from the center
    expect(near / 40).toBeGreaterThan(far / 400);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(40);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(120);
    expect(step(600, 0)).toBeGreaterThan(0);
    expect(step(600, 0)).toBeLessThan(2);
    expect(step(2100, 1600, 2000)).toBeCloseTo(1700);
    expect(easeFollowScroll({ playheadPx: 9900, scrollLeft: 8000, width: 800, timelineWidth: 9800 })).toBe(9000);
    expect(step(100, 0, 0)).toBe(0);
  });
  it('switches ruler units with zoom the way a time ruler does', () => {
    const clock = rulerScale(80 / 30000);
    expect(clock.unit).toBe('clock');
    expect(clock.majorMs).toBe(30000);
    expect(formatRulerLabel(0, clock.majorMs, clock.unit)).toBe('0:00');
    expect(formatRulerLabel(90000, clock.majorMs, clock.unit)).toBe('1:30');
    expect(formatRulerLabel(3661000, clock.majorMs, clock.unit)).toBe('1:01:01');
    const seconds = rulerScale(80 / 200);
    expect(seconds.unit).toBe('seconds');
    expect(seconds.majorMs).toBe(200);
    expect(formatRulerLabel(1500, seconds.majorMs, seconds.unit)).toBe('1.5');
    const millis = rulerScale(80 / 2);
    expect(millis.unit).toBe('millis');
    expect(formatRulerLabel(5, millis.majorMs, millis.unit)).toBe('5 ms');
    const samples = rulerScale(192, { sampleRate: 48000 });
    expect(samples.unit).toBe('samples');
    expect(samples.majorMs * 48).toBeCloseTo(20);
    expect(formatRulerLabel(1000, samples.majorMs, samples.unit, 48000)).toBe('48000');
    expect(samples.subMinorMs).toBeLessThan(samples.majorMs);
    expect(clock.majorMs * (80 / 30000)).toBeGreaterThanOrEqual(79.999);
  });
  it('normalizes pixel, line and page wheel events', () => {
    expect(normalizeWheel({ deltaX: 1, deltaY: -2, deltaMode: 0 }, 900)).toEqual({ x: 1, y: -2 });
    expect(normalizeWheel({ deltaX: 1, deltaY: -2, deltaMode: 1 }, 900)).toEqual({ x: 16, y: -32 });
    expect(normalizeWheel({ deltaX: 1, deltaY: -2, deltaMode: 2 }, 900)).toEqual({ x: 900, y: -1800 });
  });
  it('indexes variable row heights with half-open boundaries', () => {
    const offsets = rowOffsets([{ height: 50 }, { height: 200 }, { height: 75 }]);
    expect(offsets).toEqual([0, 50, 250, 325]);
    expect([-1, 0, 49, 50, 249, 250, 325].map((y) => rowAtY(offsets, y))).toEqual([-1, 0, 0, 1, 1, 2, -1]);
    expect(rowAtY([0], 0)).toBe(-1);
    expect(intersectsViewport(0, 50, 1000, 200)).toBe(false);
  });
  it('generates viewport-bounded ticks at sample and multi-hour scales', () => {
    for (const scale of [0.0001, 1, 192]) {
      const interval = rulerInterval(scale);
      const ticks = visibleRulerTicks(1e9, 1200, scale, interval, 1e15);
      expect(ticks.length).toBeLessThan(23);
      expect(interval * scale).toBeGreaterThanOrEqual(79.999);
      expect(ticks[0] * scale).toBeGreaterThan(1e9 - 300);
    }
    expect(rulerInterval(192)).toBeLessThan(1);
  });
  it('rebases a bounded native rail without clamping logical time or scale', () => {
    const segment = scrollSegment(8e9, 1e10, 1200);
    expect(segment.width).toBe(1e6);
    expect(segment.origin + segment.left).toBe(8e9);
    expect(segment.left).toBe(500000);
    const next = scrollSegment(segment.origin + 999000, 1e10, 1200, segment.origin);
    expect(next.origin).toBeGreaterThan(segment.origin);
    expect(next.origin + next.left).toBe(segment.origin + 999000);
    const end = scrollSegment(1e10, 1e10, 1200);
    expect(end.origin + end.left).toBe(1e10 - 1200);
  });
  it('clips long visual shells while retaining exact skipped source distance', () => {
    expect(boundedRange(100, 1e10, 8e9, 1e6)).toEqual({ left: 0, width: 1e6, skipped: 8e9 - 100 });
    expect(boundedRange(8e9 + 500, 100, 8e9, 1e6)).toEqual({ left: 500, width: 100, skipped: 0 });
    expect(boundedRange(0, 100, 8e9, 1e6).width).toBe(0);
  });
});
