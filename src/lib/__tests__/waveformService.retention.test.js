import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createWaveformService } from '../waveformService';
import { createWaveformPersistence } from '../waveformPersistence';
import { queryWaveformRange } from '../waveformData';
import { buildPyramid, generatedBuffer, referenceRange } from './waveformFixtures';

const services = [];
const revision = (token = 'media-v1') => ({ waveformRevision: token, blobSize: 123456, blobType: 'audio/wav' });
function makeService(options = {}) {
  const service = createWaveformService({ workerFactory: () => undefined, yieldControl: async () => {}, persistence: null, ...options });
  services.push(service);
  return service;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function settled(service, id, buffer) {
  await vi.waitFor(() => expect(service.getSource(id, buffer)?.status).toMatch(/ready|error/), { interval: 5 });
  return service.getSource(id, buffer);
}
async function ioIdle(service) {
  await vi.waitFor(() => expect(service.getStats()).toMatchObject({ activeJobs: 0, persistenceJobs: 0 }), { interval: 5 });
}
function persistenceFixture() {
  const rows = new Map();
  const storage = {
    get: vi.fn(async (key) => rows.get(key)),
    put: vi.fn(async (row) => { rows.set(row.key, structuredClone(row)); return true; }),
    touch: vi.fn(async () => {}), delete: vi.fn(async (key) => rows.delete(key)),
  };
  return { rows, storage, persistence: createWaveformPersistence({ storage, yieldControl: async () => {} }) };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.unstubAllGlobals();
});

describe('trusted revision fast path', () => {
  it('loads and validates a persisted revision before worker construction or ANY PCM read', async () => {
    const { persistence } = persistenceFixture();
    const source = generatedBuffer(2053);
    const expected = buildPyramid(source);
    await persistence.saveRevision('media', revision(), expected);
    const workerFactory = vi.fn();
    const service = makeService({ persistence, workerFactory });
    const decodedAgain = generatedBuffer(2053);
    const read = vi.spyOn(decodedAgain, 'getChannelData').mockImplementation(() => { throw new Error('Warm load must not read PCM'); });
    service.ensureSource('media', decodedAgain, { revision: revision() });
    const ready = await settled(service, 'media', decodedAgain);
    expect(ready.status).toBe('ready');
    expect(ready.pyramid).toEqual(structuredClone(expected));
    expect(ready.stats.cacheHit).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(service.getStats()).toMatchObject({ trustedCacheHits: 1, samplesScanned: 0, chunksCopied: 0, fallbackJobs: 0 });
    // An ensure without options must preserve the caller's already trusted revision.
    expect(service.ensureSource('media', decodedAgain)).toBe(ready);
  });

  it('persists a cold extraction, warm-loads a fresh object, and invalidates changed same-shaped revisions', async () => {
    const { persistence } = persistenceFixture();
    const service = makeService({ persistence });
    const a = generatedBuffer(1000, 1);
    service.ensureSource('same', a, { revision: revision() });
    expect((await settled(service, 'same', a)).stats.cacheHit).toBe(false);
    await ioIdle(service);
    service.clear();
    const b = generatedBuffer(1000, 1);
    const reads = vi.spyOn(b, 'getChannelData');
    service.ensureSource('same', b, { revision: revision() });
    expect((await settled(service, 'same', b)).stats.cacheHit).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    const c = generatedBuffer(1000, 1);
    c.getChannelData(0)[998] = 17;
    service.ensureSource('same', c, { revision: revision('media-v2') });
    const changed = await settled(service, 'same', c);
    expect(changed.stats).toMatchObject({ cacheHit: false, sourcePeak: 17 });
    expect(service.getSource('same', b)).toBeUndefined();
    expect(service.getStats().samplesScanned).toBe(2000);
  });

  it('invalidates a changed revision even on the SAME decoded object', async () => {
    const service = makeService();
    const buffer = generatedBuffer(1000, 1);
    service.ensureSource('same', buffer, { revision: revision() });
    const first = await settled(service, 'same', buffer);
    buffer.getChannelData(0)[6] = -21;
    service.ensureSource('same', buffer, { revision: revision('new-revision') });
    const second = await settled(service, 'same', buffer);
    expect(second).not.toBe(first);
    expect(second.stats.sourcePeak).toBe(21);
    expect(second.stats.revision.waveformRevision).toBe('new-revision');
  });

  it.each([
    { createdAt: 10001, blobSize: 10, blobType: 'audio/wav' },
    { waveformRevision: 2, blobSize: 10, blobType: '' },
  ])('supports the documented durable revision variant %j', async (trusted) => {
    const { persistence } = persistenceFixture();
    const source = generatedBuffer(100, 1);
    await persistence.saveRevision('same', trusted, buildPyramid(source));
    const service = makeService({ persistence });
    const read = vi.spyOn(source, 'getChannelData');
    service.ensureSource('same', source, { revision: trusted });
    expect((await settled(service, 'same', source)).stats.cacheHit).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('does not trust incomplete revision metadata and rejects a mismatching cached decoded layout', async () => {
    const source = generatedBuffer(1000, 1);
    const wrong = buildPyramid(generatedBuffer(1000, 1, 96000));
    const persistence = { loadRevision: vi.fn(async () => wrong), saveRevision: vi.fn(async () => true), save: vi.fn(async () => true) };
    const service = makeService({ persistence });
    service.ensureSource('same', source, { revision: { waveformRevision: 'missing-blob-metadata' } });
    expect((await settled(service, 'same', source)).status).toBe('ready');
    expect(persistence.loadRevision).not.toHaveBeenCalled();
    await ioIdle(service);
    service.ensureSource('same', source, { revision: revision() });
    const result = await settled(service, 'same', source);
    expect(result.stats.cacheHit).toBe(false);
    expect(result.pyramid.sampleRate).toBe(48000);
    expect(service.getStats().trustedCacheHits).toBe(0);
  });
});

describe('passive source statistics', () => {
  it('does not restart evicted jobs when global normalization scans three sources under a 4 KiB budget', async () => {
    const service = makeService({ maxResidentBytes: 4096 });
    const sources = Array.from({ length: 3 }, (_, index) => ({ id: `source-${index}`, buffer: generatedBuffer(10000, 1) }));
    const stats = [];
    let scans = 0;
    const scan = () => {
      scans += 1;
      return sources.map(({ id }) => service.getSourceStats(id));
    };
    // Mirror Timeline: every source event recomputes peaks over all referenced IDs.
    const listener = vi.fn(scan);
    service.subscribe(listener);
    for (const { id, buffer } of sources) {
      service.ensureSource(id, buffer);
      const ready = await settled(service, id, buffer);
      stats.push(ready.stats);
    }
    await ioIdle(service);
    expect(service.getStats()).toMatchObject({ jobsStarted: 3, jobsCompleted: 3, evictions: 1 });
    expect(scan()).toEqual(stats);
    const before = service.getStats();
    const eventCount = listener.mock.calls.length;
    const timer = setInterval(scan, 1);
    try {
      for (let i = 0; i < 1000; i += 1) scan();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally { clearInterval(timer); }
    expect(scans).toBeGreaterThan(1000);
    expect(scan()).toEqual(stats);
    expect(service.getStats()).toEqual(before);
    expect(listener).toHaveBeenCalledTimes(eventCount);
  });

  it('retains lightweight peaks after metadata eviction without admission, PCM reads, events or LRU touches', async () => {
    const service = makeService({ maxSources: 2 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const c = generatedBuffer(100, 1);
    service.ensureSource('a', a);
    const statsA = (await settled(service, 'a', a)).stats;
    service.ensureSource('b', b);
    await settled(service, 'b', b);
    const read = vi.spyOn(a, 'getChannelData');
    const events = [];
    service.subscribe((event) => events.push(event));
    for (let i = 0; i < 100; i += 1) expect(service.getSourceStats('a')).toBe(statsA);
    expect(events).toHaveLength(0);
    service.ensureSource('c', c);
    await settled(service, 'c', c);
    expect(events.filter((event) => event.type === 'evicted').map((event) => event.blobIds)).toEqual([['a']]);
    const before = service.getStats();
    const eventCount = events.length;
    for (let i = 0; i < 100; i += 1) {
      expect(service.getSourceStats('a', a)).toBe(statsA);
      expect(service.getSourceStats('a')).toBe(statsA);
    }
    expect(service.getStats()).toEqual(before);
    expect(events).toHaveLength(eventCount);
    expect(read).not.toHaveBeenCalled();
    expect(statsA).not.toHaveProperty('pyramid');
  });

  it('does not make a stats-only admission denial an observed retry candidate', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    expect(service.ensureSource('b', b).error.code).toBe('WAVEFORM_CAPACITY');
    const listener = vi.fn();
    service.subscribe(listener);
    for (let i = 0; i < 100; i += 1) expect(service.getSourceStats('b', b)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    unpinA();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(service.getStats()).toMatchObject({ jobsStarted: 1, jobsCompleted: 1, evictions: 0 });
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['unpinned']);
    // A real waveform request is still active demand and can admit the source.
    expect((await settled(service, 'b', b)).status).toBe('ready');
  });

  it('invalidates cached peaks on replacement, explicit retry, release and clear', async () => {
    const service = makeService();
    const old = generatedBuffer(100, 1);
    const next = generatedBuffer(100, 1);
    service.ensureSource('same', old);
    await settled(service, 'same', old);
    expect(service.getSourceStats('same', old)?.sourcePeak).toBeGreaterThan(0);
    service.ensureSource('same', next);
    expect(service.getSourceStats('same', old)).toBeUndefined();
    expect(service.getSourceStats('same', next)).toBeUndefined();
    await settled(service, 'same', next);
    service.retrySource('same', next);
    expect(service.getSourceStats('same', next)).toBeUndefined();
    await settled(service, 'same', next);
    service.releaseSource('same', next);
    expect(service.getSourceStats('same', next)).toBeUndefined();
    service.ensureSource('same', next);
    await settled(service, 'same', next);
    service.clear();
    expect(service.getSourceStats('same', next)).toBeUndefined();
  });
});

describe('pinned LRU and bounded demand/retry', () => {
  it('never evicts mounted sources, reports stable overload, and automatically retries after unpin', async () => {
    const service = makeService({ maxResidentBytes: 2048 });
    const a = generatedBuffer(1000, 1);
    const b = generatedBuffer(1000, 1);
    const c = generatedBuffer(1000, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    const unpinB = service.pinSource('b', b);
    await settled(service, 'b', b);
    const unpinC = service.pinSource('c', c);
    const overloaded = await settled(service, 'c', c);
    expect(overloaded.error?.code).toBe('WAVEFORM_CAPACITY');
    const started = service.getStats().jobsStarted;
    for (let i = 0; i < 100; i += 1) {
      expect(service.ensureSource('c', c)).toBe(overloaded);
      expect(service.getSource('c', c)).toBe(overloaded);
      expect(service.getSource('a', a).status).toBe('ready');
      expect(service.getSource('b', b).status).toBe('ready');
    }
    expect(service.getStats().jobsStarted).toBe(started);
    expect(service.getStats()).toMatchObject({ evictions: 0, pinnedSources: 3, pins: 3 });
    unpinA();
    unpinA();
    expect((await settled(service, 'c', c)).status).toBe('ready');
    expect(service.getSource('b', b).status).toBe('ready');
    expect(service.getStats().accountedBytes).toBeLessThanOrEqual(2048);
    unpinB(); unpinC();
    expect(service.getStats().pins).toBe(0);
  });

  it('keeps accounting correct if a ready listener immediately requests a retry', async () => {
    const service = makeService();
    const buffer = generatedBuffer(1000, 1);
    let retried = false;
    service.subscribe((event) => {
      if (event.type === 'ready' && !retried) {
        retried = true;
        service.retrySource('a', buffer, { priority: 1 });
      }
    });
    service.ensureSource('a', buffer, { revision: revision() });
    await vi.waitFor(() => expect(service.getStats().jobsCompleted).toBe(2), { interval: 5 });
    const ready = service.getSource('a', buffer);
    expect(service.getStats().residentBytes).toBe(ready.stats.byteLength);
    expect(service.getStats().accountedBytes).toBe(ready.stats.byteLength);
  });

  it('shares pin counts across aliases and does not treat a view disposer as source release', async () => {
    const service = makeService();
    const buffer = generatedBuffer(100, 1);
    service.ensureSource('alias1', buffer);
    service.ensureSource('alias2', buffer);
    const first = service.pinSource('alias1', buffer);
    const second = service.pinSource('alias2', buffer);
    await settled(service, 'alias1', buffer);
    first(); first();
    expect(service.getStats()).toMatchObject({ sources: 1, pins: 1, pinnedSources: 1 });
    expect(service.getSource('alias1', buffer).status).toBe('ready');
    second();
    expect(service.getSource('alias2', buffer).status).toBe('ready');
  });

  it('bounds source metadata without losing rejected mounted demand or evicting existing pins', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    const unpinB = service.pinSource('b', b);
    const rejected = service.getSource('b', b);
    expect(rejected.error.code).toBe('WAVEFORM_CAPACITY');
    for (let i = 0; i < 20; i += 1) expect(service.ensureSource('b', b)).toBe(rejected);
    expect(service.getStats()).toMatchObject({ sources: 1, evictions: 0, jobsStarted: 1 });
    unpinA();
    // Demand retries admission when capacity changes; callers need not re-ensure.
    expect((await settled(service, 'b', b)).status).toBe('ready');
    expect(service.getStats()).toMatchObject({ sources: 1, jobsStarted: 2, pins: 1 });
    unpinB();
  });

  it('wakes an admission-denied observed source without polling getSource or handling unpinned events', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    const readyB = vi.fn();
    const capacityB = vi.fn();
    service.subscribe((event) => {
      if (event.type === 'ready' && event.blobIds.includes('b')) readyB(event.source);
      if (event.type === 'capacity' && event.blobIds.includes('b')) capacityB(event.source);
    });
    const unpinB = service.pinSource('b', b);
    expect(service.getSource('b', b).error.code).toBe('WAVEFORM_CAPACITY');
    unpinA();
    // Deliberately do not read getSource(): a renderer waiting for ready events must recover too.
    await vi.waitFor(() => expect(readyB).toHaveBeenCalledOnce(), { interval: 5 });
    expect(readyB.mock.calls[0][0].status).toBe('ready');
    expect(capacityB).toHaveBeenCalledOnce();
    expect(capacityB.mock.calls[0][0].status).toBe('loading');
    expect(service.getStats()).toMatchObject({ sources: 1, jobsStarted: 2, jobsCompleted: 2, pins: 1 });
    unpinB();
  });

  it.each(['ready', 'error', 'capacity'])('retries denied admission when an unpinned active job completes with %s', async (outcome) => {
    const gate = deferred();
    let paused = false;
    const service = makeService({ maxSources: 1, yieldControl: async () => {
      if (!paused) {
        paused = true;
        await gate.promise;
        if (outcome !== 'ready') throw Object.assign(new Error('Active source failed'), {
          code: outcome === 'capacity' ? 'WAVEFORM_CAPACITY' : 'PCM_ERROR',
        });
      }
    } });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await vi.waitFor(() => expect(paused).toBe(true), { interval: 5 });
    const unpinB = service.pinSource('b', b);
    const readyB = vi.fn();
    service.subscribe((event) => {
      if (event.type === 'ready' && event.blobIds.includes('b')) readyB();
    });
    unpinA();
    // The first capacity scan cannot evict A while it is still extracting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readyB).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() => expect(readyB).toHaveBeenCalledOnce(), { interval: 5 });
    expect(service.getStats()).toMatchObject({ sources: 1, jobsStarted: 2, jobsCompleted: outcome === 'ready' ? 2 : 1 });
    unpinB();
  });

  it('recovers an unpinned explicitly observed denial and cancels denied demand on release/clear', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const c = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    service.ensureSource('b', b);
    expect(service.getSource('b', b).error.code).toBe('WAVEFORM_CAPACITY');
    const ready = [];
    service.subscribe((event) => { if (event.type === 'ready') ready.push(event.blobIds[0]); });
    service.ensureSource('c', c);
    service.getSource('c', c);
    service.releaseSource('c', c);
    unpinA();
    await vi.waitFor(() => expect(ready).toEqual(['b']), { interval: 5 });
    service.clear();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ready).toEqual(['b']);
    expect(service.getSource('b', b)).toBeUndefined();
    expect(service.getSource('c', c)).toBeUndefined();
    expect(service.getStats().sources).toBe(0);
  });

  it('cancels an already scheduled denied-source recovery on clear', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    const unpinB = service.pinSource('b', b);
    const readyB = vi.fn();
    service.subscribe((event) => {
      if (event.type === 'ready' && event.blobIds.includes('b')) readyB();
    });
    unpinA();
    service.clear();
    unpinB();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(readyB).not.toHaveBeenCalled();
    expect(service.getStats()).toMatchObject({ sources: 0, jobsStarted: 1, jobsCompleted: 1, accountedBytes: 0 });
    expect(service.getSourceStats('a', a)).toBeUndefined();
    expect(service.getSource('b', b)).toBeUndefined();
  });

  it('does not rotate denied pinned sources endlessly when only one can be admitted', async () => {
    const service = makeService({ maxSources: 1, maxPendingSources: 2 });
    const a = generatedBuffer(100, 1);
    const unpinA = service.pinSource('a', a);
    await settled(service, 'a', a);
    const ready = [];
    service.subscribe((event) => { if (event.type === 'ready') ready.push(event.blobIds[0]); });
    const denied = Array.from({ length: 16 }, (_, i) => ({ id: `denied-${i}`, buffer: generatedBuffer(100, 1) }));
    const unpins = denied.map(({ id, buffer }) => service.pinSource(id, buffer));
    unpinA();
    await vi.waitFor(() => expect(ready).toHaveLength(1), { interval: 5 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(service.getStats()).toMatchObject({ sources: 1, jobsStarted: 2, jobsCompleted: 2, evictions: 1 });
    expect(ready).toEqual(['denied-0']);
    unpins[0]();
    await vi.waitFor(() => expect(ready).toEqual(['denied-0', 'denied-1']), { interval: 5 });
    expect(service.getStats()).toMatchObject({ sources: 1, jobsStarted: 3, jobsCompleted: 3, evictions: 2 });
    for (const unpin of unpins) unpin();
  });

  it('keeps queue-overflow aliases and eventually processes deferred sources without re-ensure', async () => {
    const gate = deferred();
    let first = true;
    const service = makeService({ maxPendingSources: 1, yieldControl: async () => {
      if (first) { first = false; await gate.promise; }
    } });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    const c = generatedBuffer(100, 1);
    service.ensureSource('a', a);
    await vi.waitFor(() => expect(first).toBe(false), { interval: 5 });
    service.ensureSource('b', b);
    service.ensureSource('c', c);
    expect(service.getSource('b', b).status).toBe('loading');
    expect(service.getSource('c', c).status).toBe('loading');
    expect(service.getStats()).toMatchObject({ sources: 3, deferredSources: 2 });
    service.releaseSource('b', b);
    gate.resolve();
    expect((await settled(service, 'c', c)).status).toBe('ready');
    expect(service.getStats().jobsCompleted).toBe(2);
    expect(service.getSource('b', b)).toBeUndefined();
  });

  it('can demand-reload metadata-evicted sources, but clear invalidates ALL weak eviction descriptors', async () => {
    const service = makeService({ maxSources: 1 });
    const a = generatedBuffer(100, 1);
    const b = generatedBuffer(100, 1);
    service.ensureSource('a', a);
    await settled(service, 'a', a);
    service.ensureSource('b', b);
    await settled(service, 'b', b);
    expect(service.getSource('a', a).status).toBe('loading');
    await settled(service, 'a', a);
    service.clear();
    expect(service.getSource('a', a)).toBeUndefined();
    expect(service.getSource('b', b)).toBeUndefined();
    expect(service.getStats()).toMatchObject({ sources: 0, residentBytes: 0 });
  });

  it('does not resurrect an old object if its alias is replaced AFTER metadata eviction', async () => {
    const service = makeService({ maxSources: 1 });
    const old = generatedBuffer(100, 1);
    const other = generatedBuffer(100, 1);
    const replacement = generatedBuffer(100, 1);
    service.ensureSource('same', old);
    await settled(service, 'same', old);
    service.ensureSource('other', other);
    await settled(service, 'other', other);
    service.ensureSource('same', replacement);
    await settled(service, 'same', replacement);
    expect(service.getSource('same', old)).toBeUndefined();
    service.ensureSource('other', other);
    await settled(service, 'other', other);
    expect(service.getSource('same', old)).toBeUndefined();
    expect(service.getSource('same', replacement).status).toBe('loading');
    await settled(service, 'same', replacement);
  });

  it('caps adaptive raw-edge work rather than silently choosing enormous detail buckets', async () => {
    const service = makeService({ maxResidentBytes: 2048, maxBaseBlockSize: 128 });
    const buffer = generatedBuffer(10000, 1);
    const read = vi.spyOn(buffer, 'getChannelData');
    service.ensureSource('long', buffer);
    expect((await settled(service, 'long', buffer)).error.code).toBe('WAVEFORM_CAPACITY');
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().maxRawEdgeSamples).toBe(256);
    const adaptive = makeService({ maxResidentBytes: 2048 });
    adaptive.ensureSource('long', buffer);
    const ready = await settled(adaptive, 'long', buffer);
    expect(ready.pyramid.baseBlockSize).toBeLessThanOrEqual(4096);
    expect(queryWaveformRange(ready.pyramid, 0, 3, 9001, buffer).count).toBe(referenceRange(buffer, 0, 3, 9001).count);
    expect(adaptive.getStats().accountedBytes).toBeLessThanOrEqual(2048);
  });
});

describe('bounded, cancellation-safe persistence lane', () => {
  it('times out a stuck cache read, extracts visibly, and retains/account its outstanding reservation', async () => {
    const gate = deferred();
    const loadRevision = vi.fn(() => gate.promise);
    const service = makeService({ persistence: { loadRevision }, cacheReadTimeoutMs: 5 });
    const a = generatedBuffer(1000, 1);
    service.ensureSource('a', a, { revision: revision() });
    expect((await settled(service, 'a', a)).stats.cacheHit).toBe(false);
    expect(service.getStats()).toMatchObject({ cacheReadTimeouts: 1, activeJobs: 0, persistenceJobs: 1 });
    expect(service.getStats().persistenceBytes).toBeGreaterThan(0);
    expect(loadRevision.mock.calls[0][3].signal.aborted).toBe(true);
    const b = generatedBuffer(1000, 1);
    service.ensureSource('b', b, { revision: revision() });
    expect((await settled(service, 'b', b)).status).toBe('ready');
    expect(loadRevision).toHaveBeenCalledOnce();
    expect(service.getStats().accountedBytes).toBeLessThanOrEqual(service.getStats().maxResidentBytes);
    gate.resolve(buildPyramid(a));
    await ioIdle(service);
    expect(service.getStats().trustedCacheHits).toBe(0);
  });

  it('clear cancels visible cache waiting immediately and a late result cannot publish into a new generation', async () => {
    const gate = deferred();
    const loadRevision = vi.fn(() => gate.promise);
    const service = makeService({ persistence: { loadRevision }, cacheReadTimeoutMs: 10000 });
    const old = generatedBuffer(1000, 1);
    const events = [];
    service.subscribe((event) => events.push(event));
    service.ensureSource('same', old, { revision: revision() });
    await vi.waitFor(() => expect(loadRevision).toHaveBeenCalledOnce(), { interval: 5 });
    service.clear();
    await vi.waitFor(() => expect(service.getStats().activeJobs).toBe(0), { interval: 5 });
    expect(service.getSource('same', old)).toBeUndefined();
    expect(loadRevision.mock.calls[0][3].signal.aborted).toBe(true);
    expect(service.getStats().persistenceBytes).toBeGreaterThan(0);
    const next = generatedBuffer(1000, 1);
    next.getChannelData(0)[0] = 33;
    service.ensureSource('same', next, { revision: revision('new') });
    expect((await settled(service, 'same', next)).stats.sourcePeak).toBe(33);
    gate.resolve(buildPyramid(old));
    await ioIdle(service);
    expect(events.filter((event) => event.type === 'ready')).toHaveLength(1);
    expect(service.getSource('same', next).stats.sourcePeak).toBe(33);
  });

  it('never waits for a stuck write to publish or extract another source; released write-held data stays accounted', async () => {
    const gate = deferred();
    const saveRevision = vi.fn(() => gate.promise);
    const service = makeService({ persistence: { saveRevision }, maxResidentBytes: 4096 });
    const a = generatedBuffer(1000, 1);
    service.ensureSource('a', a, { revision: revision() });
    expect((await settled(service, 'a', a)).status).toBe('ready');
    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledOnce(), { interval: 5 });
    service.releaseSource('a', a);
    expect(saveRevision.mock.calls[0][3].signal.aborted).toBe(true);
    expect(service.getStats()).toMatchObject({ residentBytes: 0, persistenceJobs: 1 });
    expect(service.getStats().persistenceBytes).toBeGreaterThan(0);
    const b = generatedBuffer(1000, 1);
    service.ensureSource('b', b, { revision: revision('other') });
    expect((await settled(service, 'b', b)).status).toBe('ready');
    expect(saveRevision).toHaveBeenCalledOnce();
    expect(service.getStats().accountedBytes).toBeLessThanOrEqual(4096);
    service.clear();
    gate.resolve(true);
    await ioIdle(service);
    expect(service.getStats()).toMatchObject({ residentBytes: 0, persistenceBytes: 0, accountedBytes: 0 });
  });
});
