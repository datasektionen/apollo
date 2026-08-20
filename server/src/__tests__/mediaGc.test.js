import { describe, expect, it } from 'vitest';
import {
  classifyMediaStatus,
  collectSnapshotMediaIds,
  computeDeletesAt,
  fileNameFromStoredPath,
  getFollowingMediaGcRunAt,
} from '../mediaGc.js';

describe('collectSnapshotMediaIds', () => {
  it('collects unique clip blob ids from a snapshot', () => {
    expect(collectSnapshotMediaIds({
      tracks: [
        { clips: [{ blobId: 'a' }, { blobId: 'b' }, { blobId: 'a' }] },
        { clips: [{ blobId: 'c' }, { id: 'clip-without-blob' }] },
      ],
    })).toEqual(['a', 'b', 'c']);
  });

  it('ignores missing tracks, clips, and non-string blob ids', () => {
    expect(collectSnapshotMediaIds(null)).toEqual([]);
    expect(collectSnapshotMediaIds({ tracks: [{ clips: [{ blobId: 12 }] }] })).toEqual([]);
    expect(collectSnapshotMediaIds({ tracks: 'nope' })).toEqual([]);
  });
});

describe('fileNameFromStoredPath', () => {
  it('strips the media id prefix from stored paths', () => {
    expect(fileNameFromStoredPath('abc', '/data/media/abc_take-1.flac')).toBe('take-1.flac');
  });

  it('falls back to the basename when the prefix is missing', () => {
    expect(fileNameFromStoredPath('abc', '/data/media/orphan.wav')).toBe('orphan.wav');
    expect(fileNameFromStoredPath('abc', '')).toBe('abc');
  });
});

describe('computeDeletesAt', () => {
  it('adds the configured TTL hours to the tombstone time', () => {
    expect(computeDeletesAt('2026-08-20T12:00:00.000Z', 168)).toBe('2026-08-27T12:00:00.000Z');
  });

  it('returns null without a tombstone timestamp', () => {
    expect(computeDeletesAt(null, 168)).toBeNull();
  });
});

describe('classifyMediaStatus', () => {
  it('treats blobs still present in a live snapshot as in use even if a tombstone exists', () => {
    expect(classifyMediaStatus({
      clipCount: 1,
      unreferencedAt: '2026-08-20T12:00:00.000Z',
    })).toBe('in_use');
  });

  it('classifies unreferenced tombstones as quarantine', () => {
    expect(classifyMediaStatus({
      clipCount: 0,
      unreferencedAt: '2026-08-20T12:00:00.000Z',
    })).toBe('quarantine');
  });

  it('classifies never-referenced blobs as unused until they enter quarantine', () => {
    expect(classifyMediaStatus({ clipCount: 0, unreferencedAt: null })).toBe('unused');
  });
});

describe('media GC schedule', () => {
  it('schedules the next 04:00 run after the current time', () => {
    const next = getFollowingMediaGcRunAt(new Date(2026, 7, 20, 10, 15, 0), { hour: 4 });
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(21);
    expect(next.getHours()).toBe(4);
    expect(next.getMinutes()).toBe(0);
  });

  it('uses tomorrow when 04:00 has already passed', () => {
    const next = getFollowingMediaGcRunAt(new Date(2026, 7, 20, 4, 0, 1), { hour: 4 });
    expect(next.getDate()).toBe(21);
    expect(next.getHours()).toBe(4);
  });
});
