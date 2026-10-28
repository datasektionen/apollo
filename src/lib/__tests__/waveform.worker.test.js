import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createWaveformWorkerHandler } from '../waveform.worker';
import { createWaveformFingerprint, WAVEFORM_CHUNK_SAMPLES } from '../waveformData';
import { buildPyramid, generatedBuffer } from './waveformFixtures';

describe('waveform worker protocol', () => {
  it('uses exactly the fallback math and canonical fingerprint, transferring only result arrays', async () => {
    const messages = [];
    const handler = createWaveformWorkerHandler((data, transfers = []) => messages.push({ data, transfers }), { subtle: webcrypto.subtle });
    const buffer = generatedBuffer(33001);
    const fingerprint = createWaveformFingerprint(buffer, webcrypto.subtle);
    let requestId = 0;
    const send = (type, payload = {}) => handler({ data: { type, jobId: 4, requestId: ++requestId, ...payload } });
    await send('start', { metadata: buffer });
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      for (let start = 0; start < buffer.length; start += WAVEFORM_CHUNK_SAMPLES) {
        const samples = buffer.getChannelData(c).slice(start, start + WAVEFORM_CHUNK_SAMPLES);
        await fingerprint.append(samples);
        await send('chunk', { channelIndex: c, startSample: start, samples });
      }
    }
    await send('finish');
    const { data, transfers } = messages.at(-1);
    expect(data.type).toBe('result');
    expect(data.pyramid).toEqual(buildPyramid(buffer));
    expect(data.fingerprint).toBe(await fingerprint.finish());
    expect(transfers.length).toBe(data.pyramid.channels.reduce((sum, c) => sum + c.levels.length * 3, 0));
    expect(transfers).not.toContain(buffer.getChannelData(0).buffer);
    expect(transfers).not.toContain(buffer.getChannelData(1).buffer);
  });

  it('rejects out-of-order chunks and stale/cancelled jobs', async () => {
    const messages = [];
    const handler = createWaveformWorkerHandler((data) => messages.push(data), { subtle: null });
    const buffer = generatedBuffer(17);
    await handler({ data: { type: 'start', jobId: 1, metadata: buffer } });
    await handler({ data: { type: 'chunk', jobId: 1, channelIndex: 0, startSample: 1, samples: new Float32Array(2) } });
    expect(messages.at(-1)).toMatchObject({ type: 'error', error: 'Out-of-order waveform chunk' });
    await handler({ data: { type: 'start', jobId: 2, metadata: buffer } });
    await handler({ data: { type: 'cancel', jobId: 2 } });
    await handler({ data: { type: 'finish', jobId: 2 } });
    expect(messages.at(-1)).toMatchObject({ type: 'error', error: 'Stale waveform worker job' });
  });

  it('does not publish an async hash completion after cancellation', async () => {
    let resolve;
    const messages = [];
    const handler = createWaveformWorkerHandler((data) => messages.push(data), {
      subtle: { digest: () => new Promise((done) => { resolve = done; }) },
    });
    await handler({ data: { type: 'start', jobId: 1, metadata: generatedBuffer(1, 1) } });
    const chunk = handler({ data: { type: 'chunk', jobId: 1, channelIndex: 0, startSample: 0, samples: new Float32Array(1) } });
    await handler({ data: { type: 'cancel', jobId: 1 } });
    resolve(new ArrayBuffer(32));
    // append hashes twice: allow the second digest to settle too.
    await Promise.resolve();
    resolve(new ArrayBuffer(32));
    await chunk;
    expect(messages.map((m) => m.type)).toEqual(['ack', 'ack']);
  });
});
