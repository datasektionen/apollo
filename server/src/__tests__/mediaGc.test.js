import { describe, expect, it } from 'vitest';
import {
  classifyDatabaseHost,
  classifyFstype,
  classifyMediaStatus,
  classifyStorageLayout,
  collectSnapshotMediaIds,
  computeDeletesAt,
  fileNameFromStoredPath,
  getFollowingMediaGcRunAt,
  isLocalDatabaseUrl,
  parseMountInfo,
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
  it('classifies tombstoned blobs as quarantine even if a snapshot still mentions them', () => {
    expect(classifyMediaStatus({
      clipCount: 1,
      unreferencedAt: '2026-08-20T12:00:00.000Z',
    })).toBe('quarantine');
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

describe('storage layout', () => {
  it('classifies database hosts', () => {
    expect(classifyDatabaseHost('postgres://apollo:apollo@localhost:5432/apollo')).toBe('loopback');
    expect(classifyDatabaseHost('postgresql://apollo:apollo@127.0.0.1/apollo')).toBe('loopback');
    expect(classifyDatabaseHost('postgres://apollo:apollo@/apollo')).toBe('loopback');
    expect(classifyDatabaseHost('postgres://apollo:apollo@db:5432/apollo')).toBe('docker-internal');
    expect(classifyDatabaseHost('postgres://apollo:apollo@10.0.0.8:5432/apollo')).toBe('remote');
    expect(classifyDatabaseHost('postgres://apollo:apollo@db.example.com:5432/apollo')).toBe('remote');
    expect(isLocalDatabaseUrl('postgres://apollo:apollo@db:5432/apollo')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://apollo:apollo@db.example.com:5432/apollo')).toBe(false);
  });

  it('reads the closest mount from mountinfo', () => {
    const mountinfo = [
      '1 0 8:1 / / rw - ext4 /dev/sda1 rw',
      '2 1 0:75 / /data/media rw - virtiofs media rw',
    ].join('\n');
    expect(parseMountInfo(mountinfo, '/data/media/clip.wav')).toEqual({
      mountPoint: '/data/media',
      fstype: 'virtiofs',
    });
    expect(classifyFstype('virtiofs')).toBe('host-share');
    expect(classifyFstype('nfs4')).toBe('network');
    expect(classifyFstype('ext4')).toBe('local-disk');
  });

  it('combines when a visible local database directory is on the same device', () => {
    expect(classifyStorageLayout({
      mediaDevice: 16777232,
      databaseDevice: 16777232,
      databaseHostKind: 'loopback',
    })).toBe('combined');
  });

  it('splits when a visible local database directory is on another device', () => {
    expect(classifyStorageLayout({
      mediaDevice: 16777232,
      databaseDevice: 16777233,
      databaseHostKind: 'loopback',
      mediaMountKind: 'local-disk',
    })).toBe('split');
  });

  it('combines Docker Desktop host mounts even when device ids differ', () => {
    expect(classifyStorageLayout({
      mediaDevice: 40,
      databaseDevice: 99,
      databaseHostKind: 'docker-internal',
      mediaMountKind: 'host-share',
    })).toBe('combined');
    expect(classifyStorageLayout({
      mediaDevice: 40,
      databaseDevice: null,
      databaseHostKind: 'docker-internal',
      mediaMountKind: 'host-share',
    })).toBe('combined');
  });

  it('splits when media is a linux bind mount on another disk and postgres is not visible', () => {
    expect(classifyStorageLayout({
      mediaDevice: 8,
      databaseDevice: null,
      databaseHostKind: 'docker-internal',
      mediaMountKind: 'local-disk',
      rootDevice: 1,
    })).toBe('split');
  });

  it('combines a compose database when media lives on the container root disk', () => {
    expect(classifyStorageLayout({
      mediaDevice: 1,
      databaseDevice: null,
      databaseHostKind: 'docker-internal',
      mediaMountKind: 'local-disk',
      rootDevice: 1,
    })).toBe('combined');
  });

  it('splits remote postgres even if a local data directory happens to exist', () => {
    expect(classifyStorageLayout({
      mediaDevice: 16777232,
      databaseDevice: 16777232,
      databaseHostKind: 'remote',
    })).toBe('split');
  });
});
