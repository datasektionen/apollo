import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWaveformBuilder, queryWaveformRange, validateWaveformPyramid } from '../waveformData';
import { createWaveformService } from '../waveformService';
import { createWaveformPersistence } from '../waveformPersistence';
import { buildPyramid, generatedBuffer, referenceRange } from './waveformFixtures';

const services = [];
function makeService(options = {}) {
  const service = createWaveformService({ persistence: null, workerFactory: () => undefined, yieldControl: async () => {}, ...options });
  services.push(service);
  return service;
}
afterEach(() => { for (const service of services.splice(0)) service.dispose(); });

async function appendBuffer(session, buffer, chunkSize) {
  for (let start = 0; start < buffer.length; start += chunkSize) {
    await session.append(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(start, start + chunkSize)));
  }
}

describe('capacity-bounded incremental recording summaries', () => {
  it.each([0, 1, 127, 128, 129, 513, 4096])('finalizes %i samples with exact carried-tail/weighted-energy math and zero final PCM reads', async (length) => {
    const service = makeService();
    const buffer = generatedBuffer(length);
    if (length > 128) buffer.getChannelData(0)[128] = -19;
    const session = service.createRecordingBuilder('recording', { sampleRate: buffer.sampleRate, numberOfChannels: 2, maxLength: 4096 });
    await appendBuffer(session, buffer, 37);
    const expected = buildPyramid(buffer, 17);
    const read = vi.spyOn(buffer, 'getChannelData');
    const result = await session.finish(buffer);
    expect(read).not.toHaveBeenCalled();
    expect(result.pyramid).toEqual(expected);
    expect(validateWaveformPyramid(result.pyramid)).toBe(true);
    expect(service.getSource('recording', buffer)).toBe(result);
    expect(session.getStats()).toMatchObject({ closed: true, reservedBytes: 0 });
    expect(service.getStats()).toMatchObject({ recordingBytes: 0, recordingBuilders: 0, fallbackJobs: 0, jobsStarted: 1, jobsCompleted: 1 });
    expect(service.getStats().samplesScanned).toBe(length * 2);
    if (length > 3) {
      const actual = queryWaveformRange(result.pyramid, 0, 2, length - 1, buffer);
      const reference = referenceRange(buffer, 0, 2, length - 1);
      expect(actual.min).toBe(reference.min);
      expect(actual.max).toBe(reference.max);
      expect(actual.sumSquares).toBeCloseTo(reference.sumSquares, 8);
    }
  });

  it('records in bounded tasks and rejects over-capacity, concurrent, and mismatching-channel appends', async () => {
    let release;
    let gated = false;
    const service = makeService({ yieldControl: () => gated ? new Promise((resolve) => { release = resolve; }) : Promise.resolve() });
    const buffer = generatedBuffer(33000, 1);
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 33000 });
    gated = true;
    const pending = session.append([buffer.getChannelData(0)]);
    await expect(session.append([new Float32Array(1)])).rejects.toThrow(/Await/);
    await expect(session.finish(buffer)).rejects.toThrow(/Await/);
    gated = false;
    release();
    await pending;
    expect(service.getStats().peakStagingBytes).toBe(16384 * 4);
    await expect(session.append([new Float32Array(1)])).rejects.toThrow(/capacity/);
    await expect(session.finish(generatedBuffer(2, 1))).rejects.toThrow(/metadata/);
    await session.finish(buffer);
    await expect(session.append([new Float32Array(1)])).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accounts recording capacity/finalization alongside pinned cache and active extraction', async () => {
    const service = makeService({ maxResidentBytes: 8192 });
    const pinned = generatedBuffer(1000, 1);
    const unpin = service.pinSource('pinned', pinned);
    await vi.waitFor(() => expect(service.getSource('pinned', pinned)?.status).toBe('ready'), { interval: 5 });
    const buffer = generatedBuffer(8000, 1);
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 10000 });
    expect(service.getStats().recordingBytes).toBeGreaterThan(0);
    expect(service.getStats().accountedBytes).toBeLessThanOrEqual(8192);
    await appendBuffer(session, buffer, 1023);
    const ready = await session.finish(buffer);
    expect(ready.pyramid.length).toBe(8000);
    expect(service.getSource('pinned', pinned).status).toBe('ready');
    expect(service.getStats().accountedBytes).toBeLessThanOrEqual(8192);
    unpin();
  });

  it('cancels recording append/finalization on clear without stale source publication or retained summaries', async () => {
    let release;
    let gated = false;
    const service = makeService({ yieldControl: () => gated ? new Promise((resolve) => { release = resolve; }) : Promise.resolve() });
    const buffer = generatedBuffer(129, 1);
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 1000 });
    await appendBuffer(session, buffer, 17);
    gated = true;
    const pending = session.finish(buffer);
    service.clear();
    // The finalizer's reservation stays counted until its cooperative cancellation check.
    expect(service.getStats().recordingBytes).toBeGreaterThan(0);
    gated = false;
    release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.getSource('r', buffer)).toBeUndefined();
    expect(service.getStats()).toMatchObject({ recordingBytes: 0, recordingBuilders: 0, accountedBytes: 0 });
  });

  it('can cancel a paused append, enforces builder count, and makes cancel idempotent', async () => {
    let release;
    const service = makeService({ maxRecordingBuilders: 1, yieldControl: () => new Promise((resolve) => { release = resolve; }) });
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 1000 });
    expect(() => service.createRecordingBuilder('r2', { sampleRate: 48000, numberOfChannels: 1, maxLength: 1000 })).toThrow(/Too many/);
    const pending = session.append([new Float32Array(129)]);
    session.cancel(); session.cancel();
    release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.getStats()).toMatchObject({ recordingBytes: 0, recordingBuilders: 0, jobsCancelled: 1 });
  });

  it('passes trusted final media revision to persistence, without requiring a recording hash pass', async () => {
    const saveRevision = vi.fn(async () => true);
    const service = makeService({ persistence: { saveRevision } });
    const buffer = generatedBuffer(129, 1);
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 1000 });
    await appendBuffer(session, buffer, 19);
    const revision = { waveformRevision: 'recording-final', blobSize: 1234, blobType: 'audio/wav' };
    const result = await session.finish(buffer, { revision });
    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledOnce(), { interval: 5 });
    expect(saveRevision.mock.calls[0].slice(0, 3)).toEqual(['r', revision, result.pyramid]);
  });

  it('warm-loads a capacity-adapted recording at a coarser base without reading finalized PCM', async () => {
    const rows = new Map();
    const persistence = createWaveformPersistence({
      storage: {
        get: async (key) => rows.get(key),
        put: async (row) => { rows.set(row.key, structuredClone(row)); return true; },
        touch: async () => {}, delete: async (key) => rows.delete(key),
      },
      yieldControl: async () => {},
    });
    const service = makeService({ persistence, maxResidentBytes: 8192 });
    const buffer = generatedBuffer(1000, 1);
    const session = service.createRecordingBuilder('r', { sampleRate: 48000, numberOfChannels: 1, maxLength: 100000 });
    await appendBuffer(session, buffer, 17);
    const revision = { waveformRevision: 'final', blobSize: 1234, blobType: 'audio/wav' };
    const original = await session.finish(buffer, { revision });
    expect(original.pyramid.baseBlockSize).toBeGreaterThan(128);
    await vi.waitFor(() => expect(service.getStats().persistenceJobs).toBe(0), { interval: 5 });
    service.clear();
    const decodedAgain = generatedBuffer(1000, 1);
    const reads = vi.spyOn(decodedAgain, 'getChannelData');
    service.ensureSource('r', decodedAgain, { revision });
    await vi.waitFor(() => expect(service.getSource('r', decodedAgain)?.status).toBe('ready'), { interval: 5 });
    expect(service.getSource('r', decodedAgain).stats.cacheHit).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    expect(service.getSource('r', decodedAgain).pyramid).toEqual(structuredClone(original.pyramid));
  });

  it('pure finishAt rejects incomplete channels and supports deterministic non-finite/silence tails', async () => {
    const builder = createWaveformBuilder({ sampleRate: 48000, length: 1000, numberOfChannels: 2 });
    builder.append(0, 0, new Float32Array([NaN, Infinity, -Infinity]));
    await expect(builder.finishAt(3)).rejects.toThrow(/Incomplete/);
    builder.append(1, 0, new Float32Array([0, 0, 0]));
    const result = await builder.finishAt(3, { yieldControl: async () => {} });
    expect(result.sourcePeak).toBe(0);
    expect(queryWaveformRange(result, 0, 0, 3)).toEqual({ min: 0, max: 0, count: 3, sumSquares: 0 });
  });
});
