import { describe, expect, it, vi } from 'vitest';
import { createWaveformPersistence, normalizeWaveformRevision, validatePersistedWaveform } from '../waveformPersistence';
import { waveformByteLength } from '../waveformData';
import { buildPyramid, generatedBuffer } from './waveformFixtures';

const fingerprint = 'a'.repeat(64);
function fixture() {
  const records = new Map();
  const storage = {
    get: vi.fn(async (key) => records.get(key)),
    put: vi.fn(async (row) => { records.set(row.key, structuredClone(row)); return true; }),
    delete: vi.fn(async (key) => records.delete(key)),
    touch: vi.fn(async () => {}),
  };
  const persistence = createWaveformPersistence({ storage, yieldControl: async () => {} });
  const pyramid = buildPyramid(generatedBuffer());
  return { records, storage, persistence, pyramid };
}

describe('waveform persistence validation and failure isolation', () => {
  it('round-trips only a verified version/content/layout match, with byte accounting', async () => {
    const { records, storage, persistence, pyramid } = fixture();
    expect(await persistence.save(fingerprint, pyramid)).toBe(true);
    expect([...records.values()][0].byteLength).toBe(waveformByteLength(pyramid));
    expect(await persistence.load(fingerprint, pyramid)).toEqual(structuredClone(pyramid));
    expect(storage.touch).toHaveBeenCalledOnce();
    expect(await persistence.load('b'.repeat(64), pyramid)).toBeUndefined();
    expect(await persistence.load(fingerprint, { ...pyramid, sampleRate: 96000 })).toBeUndefined();
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(persistence.getStats()).toMatchObject({ writes: 1, hits: 1, misses: 1, corrupt: 1 });
  });

  it.each(['schema', 'shape', 'bytes', 'nan', 'energy', 'parent', 'peak', 'fingerprint'])('discards corrupt %s data', async (kind) => {
    const { records, persistence, pyramid } = fixture();
    await persistence.save(fingerprint, pyramid);
    const row = [...records.values()][0];
    if (kind === 'schema') row.schemaVersion = 91;
    if (kind === 'shape') row.pyramid.channels[0].levels[0].min = new Float32Array(1);
    if (kind === 'bytes') row.byteLength -= 1;
    if (kind === 'nan') row.pyramid.channels[0].levels[0].min[0] = NaN;
    if (kind === 'energy') row.pyramid.channels[0].levels[0].sumSquares[0] = -1;
    if (kind === 'parent') row.pyramid.channels[0].levels[1].sumSquares[0] += 0.1;
    if (kind === 'peak') row.pyramid.channelPeaks[0] += 1;
    if (kind === 'fingerprint') row.fingerprint = 'c'.repeat(64);
    expect(await persistence.load(fingerprint, pyramid)).toBeUndefined();
    expect(records.size).toBe(0);
  });

  it('rejects missing content hashes, cancels reads/writes, and bounds disk size', async () => {
    const { storage, persistence, pyramid } = fixture();
    expect(await persistence.save('blob-id', pyramid)).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(await persistence.save(fingerprint, pyramid, { signal: controller.signal })).toBe(false);
    expect(await persistence.load(fingerprint, pyramid, { signal: controller.signal })).toBeUndefined();
    expect(storage.put).not.toHaveBeenCalled();
    const tiny = createWaveformPersistence({ storage, maxBytes: 10 });
    expect(await tiny.save(fingerprint, pyramid)).toBe(false);
  });

  it('yields and cancels deep validation instead of blocking on an entire persisted source', async () => {
    const pyramid = buildPyramid(generatedBuffer(600000, 1));
    const controller = new AbortController();
    const yieldControl = vi.fn(async () => controller.abort());
    expect(await validatePersistedWaveform(pyramid, { signal: controller.signal, yieldControl })).toBe(false);
    expect(yieldControl).toHaveBeenCalledOnce();
  });

  it('keys trusted revisions by source ID, revision/blob metadata, decoded metadata, base and schema', async () => {
    const { storage, persistence, pyramid } = fixture();
    const revision = { waveformRevision: 'v1', blobSize: 1234, blobType: 'audio/wav' };
    await persistence.saveRevision('media', revision, pyramid);
    expect(await persistence.loadRevision('media', revision, pyramid)).toEqual(structuredClone(pyramid));
    const misses = [
      ['other', revision, pyramid],
      ['media', { ...revision, waveformRevision: 'v2' }, pyramid],
      ['media', { ...revision, blobSize: 1235 }, pyramid],
      ['media', { ...revision, blobType: 'audio/flac' }, pyramid],
      ['media', revision, { ...pyramid, sampleRate: 96000 }],
      ['media', revision, { ...pyramid, length: 999 }],
      ['media', revision, { ...pyramid, numberOfChannels: 1 }],
      ['media', revision, { ...pyramid, baseBlockSize: 256 }],
    ];
    for (const args of misses) expect(await persistence.loadRevision(...args)).toBeUndefined();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each([
    undefined, 'blob-id', {}, { waveformRevision: 'x' },
    { waveformRevision: '', blobSize: 1, blobType: 'audio/wav' },
    { waveformRevision: NaN, blobSize: 1, blobType: 'audio/wav' },
    { createdAt: 0, blobSize: 1, blobType: 'audio/wav' },
    { createdAt: 10, blobSize: -1, blobType: 'audio/wav' },
  ])('does not authorize a cache hit from an invalid revision %j', async (revision) => {
    const { persistence, storage, pyramid } = fixture();
    expect(normalizeWaveformRevision(revision)).toBeUndefined();
    expect(await persistence.loadRevision('media', revision, pyramid)).toBeUndefined();
    expect(await persistence.saveRevision('media', revision, pyramid)).toBe(false);
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does not gate a valid read on a hung LRU timestamp write', async () => {
    const { persistence, storage, pyramid } = fixture();
    await persistence.save(fingerprint, pyramid);
    storage.touch.mockImplementation(() => new Promise(() => {}));
    expect(await persistence.load(fingerprint, pyramid)).toEqual(structuredClone(pyramid));
  });

  it('does not commit a write cancelled during its cooperative scheduling delay', async () => {
    const { storage, pyramid } = fixture();
    const controller = new AbortController();
    const persistence = createWaveformPersistence({ storage, yieldControl: async () => controller.abort() });
    expect(await persistence.saveRevision('media', { waveformRevision: 'v1', blobSize: 10, blobType: '' }, pyramid,
      { signal: controller.signal })).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('isolates unavailable IndexedDB, touch failures, and quota errors without write storms', async () => {
    const { storage, persistence, pyramid } = fixture();
    storage.get.mockRejectedValueOnce(new Error('private mode'));
    expect(await persistence.load(fingerprint, pyramid)).toBeUndefined();
    await persistence.save(fingerprint, pyramid);
    storage.touch.mockRejectedValueOnce(new Error('read-only'));
    expect(await persistence.load(fingerprint, pyramid)).toEqual(structuredClone(pyramid));
    storage.put.mockRejectedValueOnce(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    expect(await persistence.save(fingerprint, pyramid)).toBe(false);
    expect(await persistence.save(fingerprint, pyramid)).toBe(false);
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(persistence.getStats()).toMatchObject({ errors: 3, disabled: true });
    persistence.reset();
    expect(await persistence.save(fingerprint, pyramid)).toBe(true);
  });
});
