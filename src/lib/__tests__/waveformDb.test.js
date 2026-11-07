import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, getWaveformCache, putWaveformCache, deleteWaveformCache, touchWaveformCache } from '../db';

afterEach(() => vi.restoreAllMocks());

describe('waveform derived-data database store', () => {
  it('adds v5 without replacing existing project/media stores', () => {
    expect(db.verno).toBe(5);
    for (const name of ['projects', 'media', 'undo', 'exportDirs', 'localProjectState', 'remoteProjects', 'syncQueue', 'waveformCache']) {
      expect(db.table(name)).toBeDefined();
    }
    expect(db.waveformCache.schema.primKey.name).toBe('key');
    expect(db.waveformCache.schema.indexes.some((index) => index.name === '[lastAccess+key+byteLength]')).toBe(true);
  });

  it('gets/deletes/touches by derived-data key only', async () => {
    const get = vi.spyOn(db.waveformCache, 'get').mockResolvedValue({ key: 'k' });
    const remove = vi.spyOn(db.waveformCache, 'delete').mockResolvedValue();
    const update = vi.spyOn(db.waveformCache, 'update').mockResolvedValue(1);
    expect(await getWaveformCache('k')).toEqual({ key: 'k' });
    await deleteWaveformCache('k');
    await touchWaveformCache('k', 123);
    expect(get).toHaveBeenCalledWith('k');
    expect(remove).toHaveBeenCalledWith('k');
    expect(update).toHaveBeenCalledWith('k', { lastAccess: 123 });
  });

  it('does not open or write a cache transaction when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const transaction = vi.spyOn(db, 'transaction');
    expect(await getWaveformCache('k', { signal: controller.signal })).toBeUndefined();
    expect(await putWaveformCache({ key: 'k', byteLength: 10 }, 100, { signal: controller.signal })).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rechecks cancellation after waiting for a transaction to open', async () => {
    const controller = new AbortController();
    vi.spyOn(db, 'transaction').mockImplementation(async (...args) => {
      controller.abort();
      return args.at(-1)();
    });
    const get = vi.spyOn(db.waveformCache, 'get');
    const put = vi.spyOn(db.waveformCache, 'put');
    expect(await getWaveformCache('k', { signal: controller.signal })).toBeUndefined();
    expect(await putWaveformCache({ key: 'k', byteLength: 10 }, 100, { signal: controller.signal })).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('enforces disk LRU atomically using only indexed metadata, not full pyramid rows', async () => {
    vi.spyOn(db, 'transaction').mockImplementation(async (...args) => args.at(-1)());
    const put = vi.spyOn(db.waveformCache, 'put').mockResolvedValue('new');
    const bulkDelete = vi.spyOn(db.waveformCache, 'bulkDelete').mockResolvedValue();
    const eachKey = vi.fn(async (visit) => {
      for (const key of [[30, 'new', 60], [20, 'recent', 30], [10, 'old', 40]]) visit(key);
    });
    const orderBy = vi.spyOn(db.waveformCache, 'orderBy').mockReturnValue({ reverse: () => ({ eachKey }) });
    expect(await putWaveformCache({ key: 'new', byteLength: 60 }, 100)).toBe(true);
    expect(put).toHaveBeenCalledOnce();
    expect(orderBy).toHaveBeenCalledWith('[lastAccess+key+byteLength]');
    expect(bulkDelete).toHaveBeenCalledWith(['old']);
    expect(await putWaveformCache({ key: 'huge', byteLength: 101 }, 100)).toBe(false);
    expect(put).toHaveBeenCalledOnce();
  });
});
