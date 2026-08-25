import { describe, expect, it } from 'vitest';
import {
  clampPlayerSeek,
  computeSnapshotDurationMs,
  formatClock,
  formatDurationMs,
  seekPreviewFromPointer,
  shouldCommitPlayingSeek,
} from '../playerTime';

describe('computeSnapshotDurationMs', () => {
  it('uses the furthest clip endpoint', () => {
    expect(computeSnapshotDurationMs({
      tracks: [
        {
          clips: [
            { timelineStartMs: 0, cropStartMs: 0, cropEndMs: 12_000 },
            { timelineStartMs: 10_000, cropStartMs: 0, cropEndMs: 8_000 },
          ],
        },
        {
          clips: [
            { timelineStartMs: 1_000, cropStartMs: 500, cropEndMs: 4_500 },
          ],
        },
      ],
    })).toBe(18_000);
  });

  it('keeps cropped clip length instead of the full source duration', () => {
    expect(computeSnapshotDurationMs({
      tracks: [
        {
          clips: [
            { timelineStartMs: 0, cropStartMs: 0, cropEndMs: 5_000, sourceDurationMs: 20_000 },
          ],
        },
      ],
    })).toBe(5_000);
  });

  it('falls back to sourceDurationMs when crop end is missing', () => {
    expect(computeSnapshotDurationMs({
      tracks: [
        {
          clips: [
            { timelineStartMs: 2_000, cropStartMs: 0, sourceDurationMs: 5_000 },
          ],
        },
      ],
    })).toBe(7_000);
  });

  it('includes muted clips so list duration matches the timeline', () => {
    expect(computeSnapshotDurationMs({
      tracks: [
        {
          clips: [
            { timelineStartMs: 0, cropStartMs: 0, cropEndMs: 1_000, muted: true },
            { timelineStartMs: 0, cropStartMs: 0, cropEndMs: 9_000 },
          ],
        },
      ],
    })).toBe(9_000);
  });
});

describe('formatClock', () => {
  it('formats minutes and seconds without padded minutes', () => {
    expect(formatClock(185)).toBe('3:05');
  });

  it('formats hours when needed and rejects non-finite values', () => {
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});

describe('clampPlayerSeek', () => {
  it('converts a clamped clock time to whole milliseconds', () => {
    expect(clampPlayerSeek(12.3456, 60)).toEqual({ timeSec: 12.3456, timeMs: 12346 });
    expect(clampPlayerSeek(-2, 60)).toEqual({ timeSec: 0, timeMs: 0 });
    expect(clampPlayerSeek(90, 12.5)).toEqual({ timeSec: 12.5, timeMs: 12500 });
  });
});

describe('shouldCommitPlayingSeek', () => {
  it('commits the first seek in a gesture and ignores the mouseup duplicate', () => {
    expect(shouldCommitPlayingSeek(null, 30_000)).toBe(true);
    expect(shouldCommitPlayingSeek(30_000, 30_000)).toBe(false);
    expect(shouldCommitPlayingSeek(30_000, 30_080)).toBe(true);
  });

  it('treats near-identical mouseup values as the same seek', () => {
    expect(shouldCommitPlayingSeek(30_000, 30_080, 100)).toBe(false);
    expect(shouldCommitPlayingSeek(30_000, 30_200, 100)).toBe(true);
  });
});

describe('seekPreviewFromPointer', () => {
  it('maps a click on the slider track to a clamped clock time', () => {
    expect(seekPreviewFromPointer(50, { left: 0, width: 100 }, 10)).toEqual({
      timeSec: 5,
      timeMs: 5000,
    });
    expect(seekPreviewFromPointer(-8, { left: 0, width: 100 }, 10)).toEqual({
      timeSec: 0,
      timeMs: 0,
    });
    expect(seekPreviewFromPointer(140, { left: 20, width: 100 }, 10)).toEqual({
      timeSec: 10,
      timeMs: 10000,
    });
  });
});

describe('formatDurationMs', () => {
  it('shows a placeholder when duration is unknown', () => {
    expect(formatDurationMs(0)).toBe('--:--');
    expect(formatDurationMs(null, 0)).toBe('--:--');
  });

  it('prefers mix duration and can fall back to the playing clock', () => {
    expect(formatDurationMs(125_000)).toBe('2:05');
    expect(formatDurationMs(0, 64)).toBe('1:04');
  });
});
