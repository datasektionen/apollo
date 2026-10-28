import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  createWaveformBuilder, createWaveformFingerprint, queryWaveformRange, validateWaveformPyramid,
  chooseWaveformBlockSize, waveformByteLength, estimateWaveformBytes, WAVEFORM_CHUNK_SAMPLES, yieldWaveformTask,
} from '../waveformData';
import { audioBuffer, buildPyramid, generatedBuffer, referenceRange } from './waveformFixtures';

function expectRange(actual, expected) {
  expect(actual.min).toBe(expected.min);
  expect(actual.max).toBe(expected.max);
  expect(actual.count).toBe(expected.count);
  expect(Math.abs(actual.sumSquares - expected.sumSquares)).toBeLessThanOrEqual(Math.max(1, expected.sumSquares) * 1e-12);
}

describe('waveform pyramid math and exact range queries', () => {
  it('yields to a real task without synchronously continuing a PCM/cache chunk', async () => {
    let completed = false;
    const pending = yieldWaveformTask().then(() => { completed = true; });
    expect(completed).toBe(false);
    await Promise.resolve();
    expect(completed).toBe(false);
    await pending;
    expect(completed).toBe(true);
  });
  it.each([44100, 48000, 96000])('matches a deterministic PCM reference at %i Hz', (sampleRate) => {
    const buffer = generatedBuffer(2053, 2, sampleRate);
    const pyramid = buildPyramid(buffer, 37);
    expect(validateWaveformPyramid(pyramid)).toBe(true);
    expect(waveformByteLength(pyramid)).toBe(estimateWaveformBytes(buffer.length, 2));
    for (let c = 0; c < 2; c += 1) {
      for (let start = 0; start < buffer.length; start += 31) {
        for (const width of [1, 3, 127, 128, 129, 511, 1400]) {
          expectRange(queryWaveformRange(pyramid, c, start, start + width, buffer), referenceRange(buffer, c, start, start + width));
        }
      }
    }
    expectRange(queryWaveformRange(pyramid, 1, -100, Infinity, buffer), referenceRange(buffer, 1, 0, buffer.length));
    expectRange(queryWaveformRange(pyramid, 0, 1.2, 30.7, buffer), referenceRange(buffer, 0, 1.2, 30.7));
  });

  it('does not leak impulses just outside crop edges and preserves both signed extrema', () => {
    const pcm = new Float32Array(513).fill(0.25);
    pcm[126] = -9;
    pcm[385] = 12;
    const buffer = audioBuffer([pcm]);
    const pyramid = buildPyramid(buffer, 19);
    expect(queryWaveformRange(pyramid, 0, 127, 385, buffer)).toEqual({ min: 0.25, max: 0.25, sumSquares: 258 / 16, count: 258 });
    expect(pyramid.sourcePeak).toBe(12);
    expectRange(queryWaveformRange(pyramid, 0, 126, 386, buffer), referenceRange(buffer, 0, 126, 386));
  });

  it.each([
    [0, 0, 0], [0.5, 0.5, 0.5], [-0.5, -0.25, -0.75], [NaN, Infinity, -Infinity], [3, -4, 0],
  ])('handles silence/DC/asymmetry/non-finite/over-range samples: %j', (...samples) => {
    const buffer = audioBuffer([samples, samples.map((x) => -x)]);
    const pyramid = buildPyramid(buffer, 1);
    for (let c = 0; c < 2; c += 1) expectRange(queryWaveformRange(pyramid, c, 0, 3, buffer), referenceRange(buffer, c, 0, 3));
  });

  it('adds energy and weights a partial final bucket by its actual sample count', () => {
    const buffer = audioBuffer([Array(128).fill(1).concat([3])]);
    const pyramid = buildPyramid(buffer);
    const result = queryWaveformRange(pyramid, 0, 0, 129);
    expect(result).toEqual({ min: 1, max: 3, sumSquares: 137, count: 129 });
    expect(Math.sqrt(result.sumSquares / result.count)).not.toBe((1 + 3) / 2);
    expect(pyramid.channels[0].levels[1].sumSquares[0]).toBe(137);
  });

  it('produces identical levels independently of chunk boundaries and channel interleaving', () => {
    const buffer = generatedBuffer(1031);
    const a = buildPyramid(buffer, 1);
    const b = buildPyramid(buffer, 139);
    expect(a).toEqual(b);
    const builder = createWaveformBuilder(buffer);
    for (let pos = 0; pos < buffer.length; pos += 17) {
      for (let c = 0; c < 2; c += 1) builder.append(c, pos, buffer.getChannelData(c).slice(pos, pos + 17));
    }
    expect(builder.finish()).toEqual(a);
    expect(() => builder.append(0, 0, new Float32Array(1))).toThrow(/Out-of-order/);
    expect(() => createWaveformBuilder(buffer).finish()).toThrow(/Incomplete/);
  });

  it('uses no raw PCM for aligned queries, and reads only boundary windows otherwise', () => {
    const buffer = generatedBuffer(10000);
    const pyramid = buildPyramid(buffer);
    expectRange(queryWaveformRange(pyramid, 0, 128, 9984), referenceRange(buffer, 0, 128, 9984));
    expect(() => queryWaveformRange(pyramid, 0, 129, 9984)).toThrow(/PCM/);
    expectRange(queryWaveformRange(undefined, 0, 30, 35, buffer), referenceRange(buffer, 0, 30, 35));
  });

  it('has safe empty/invalid range behavior and supports zero-length sources', () => {
    const buffer = audioBuffer([[]]);
    const pyramid = buildPyramid(buffer);
    expect(validateWaveformPyramid(pyramid)).toBe(true);
    for (const [c, a, b] of [[0, 0, 0], [0, NaN, 4], [-1, 0, 2], [2, 0, 2], [0, 8, 1]]) {
      expect(queryWaveformRange(pyramid, c, a, b, buffer)).toEqual({ min: 0, max: 0, sumSquares: 0, count: 0 });
    }
  });

  it('rejects invalid schemas/level lengths and adapts long-source memory without PCM allocation', () => {
    const p = buildPyramid(generatedBuffer());
    expect(validateWaveformPyramid({ ...p, schemaVersion: 999 })).toBe(false);
    expect(validateWaveformPyramid({ ...p, channelPeaks: [0, 0] })).toBe(false);
    const broken = buildPyramid(generatedBuffer());
    broken.channels[0].levels[0].min = new Float32Array(1);
    expect(validateWaveformPyramid(broken)).toBe(false);
    const oversizedBacking = buildPyramid(generatedBuffer());
    const level = oversizedBacking.channels[0].levels[0];
    level.min = new Float32Array(new ArrayBuffer(1024 * 1024), 0, level.min.length);
    expect(validateWaveformPyramid(oversizedBacking)).toBe(false);
    const length = 2 * 60 * 60 * 96000;
    const block = chooseWaveformBlockSize(length, 2, 32 * 1024 * 1024);
    expect(block).toBeGreaterThan(128);
    expect(estimateWaveformBytes(length, 2, block)).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(() => chooseWaveformBlockSize(1000, 2, 1)).toThrow(/budget/);
  });
});

describe('verified content fingerprints', () => {
  async function fingerprint(buffer) {
    const hash = createWaveformFingerprint(buffer, webcrypto.subtle);
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      for (let i = 0; i < buffer.length; i += WAVEFORM_CHUNK_SAMPLES) {
        await hash.append(buffer.getChannelData(c).slice(i, i + WAVEFORM_CHUNK_SAMPLES));
      }
    }
    return hash.finish();
  }
  it('is deterministic and distinguishes same-shaped content, channel order, and sample rate', async () => {
    const a = generatedBuffer(17000);
    const b = generatedBuffer(17000);
    expect(await fingerprint(a)).toBe(await fingerprint(b));
    b.getChannelData(1)[16789] += 0.01;
    expect(await fingerprint(a)).not.toBe(await fingerprint(b));
    expect(await fingerprint(a)).not.toBe(await fingerprint(audioBuffer([a.getChannelData(1), a.getChannelData(0)])));
    expect(await fingerprint(a)).not.toBe(await fingerprint(audioBuffer([a.getChannelData(0), a.getChannelData(1)], 96000)));
  });
  it('disables persistence identity when crypto is unavailable rather than using a weak ID', async () => {
    const hash = createWaveformFingerprint(generatedBuffer(), null);
    await hash.append(new Float32Array([1, 2]));
    expect(await hash.finish()).toBeUndefined();
  });
});
