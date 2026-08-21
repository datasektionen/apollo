import { describe, expect, it } from 'vitest';
import {
  computeSnapshotDurationMs,
  formatClock,
  formatDurationMs,
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
