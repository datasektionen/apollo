import { describe, expect, it, vi } from 'vitest';
import {
  readCachedProjectSnapshot,
  resolvePlayerProjectSnapshot,
  writeCachedProjectSnapshot,
} from '../playerSnapshotCache';

describe('playerSnapshotCache', () => {
  it('stores and reads a snapshot by project id', () => {
    const cache = new Map();
    writeCachedProjectSnapshot(cache, 'proj-1', {
      latestSeq: 4,
      snapshot: { projectId: 'proj-1' },
    });
    expect(readCachedProjectSnapshot(cache, 'proj-1')).toEqual({
      latestSeq: 4,
      snapshot: { projectId: 'proj-1' },
    });
  });

  it('reuses a cached snapshot without waiting on bootstrap', async () => {
    const cache = new Map();
    const fetchBootstrap = vi.fn(async (knownSeq) => ({
      latestSeq: Number(knownSeq || 0) + 1,
      snapshot: { projectId: 'proj-1', seq: Number(knownSeq || 0) + 1 },
    }));

    const first = await resolvePlayerProjectSnapshot({
      projectId: 'proj-1',
      cache,
      fetchBootstrap,
    });
    expect(first.reused).toBe(false);
    expect(fetchBootstrap).toHaveBeenCalledTimes(1);
    expect(fetchBootstrap).toHaveBeenCalledWith(0);

    const second = await resolvePlayerProjectSnapshot({
      projectId: 'proj-1',
      cache,
      fetchBootstrap,
    });
    expect(second.reused).toBe(true);
    expect(second.snapshot).toEqual(first.snapshot);

    await vi.waitFor(() => {
      expect(fetchBootstrap).toHaveBeenCalledTimes(2);
    });
    expect(fetchBootstrap).toHaveBeenLastCalledWith(first.latestSeq);
  });

  it('fetches when the cache is empty', async () => {
    const fetchBootstrap = vi.fn(async () => ({
      latestSeq: 9,
      snapshot: { projectId: 'proj-2' },
    }));
    const result = await resolvePlayerProjectSnapshot({
      projectId: 'proj-2',
      cache: new Map(),
      fetchBootstrap,
    });
    expect(result).toEqual({
      snapshot: { projectId: 'proj-2' },
      latestSeq: 9,
      reused: false,
    });
  });
});
