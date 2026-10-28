import { describe, expect, it, vi } from 'vitest';
import { createRecordingDrawJob, createRecordingWaveform, RECORDING_SUMMARY_SAMPLES_PER_TASK } from '../recordingWaveform';

function harness(options = {}) {
  const tasks = new Set();
  const capture = createRecordingWaveform({ sampleRate: 1000, ...options,
    scheduleTask: (callback) => { tasks.add(callback); return () => tasks.delete(callback); },
  });
  const tick = () => {
    const callback = tasks.values().next().value;
    tasks.delete(callback);
    const before = capture.getStats().samplesScanned;
    callback();
    expect(capture.getStats().samplesScanned - before).toBeLessThanOrEqual(RECORDING_SUMMARY_SAMPLES_PER_TASK);
  };
  const flush = () => { while (tasks.size) tick(); };
  return { capture, tasks, tick, flush };
}
function chunk(startFrame, ...channels) {
  return { startFrame, endFrame: startFrame + channels[0].length, channels: channels.map((pcm) => Float32Array.from(pcm)) };
}
function query(capture, channel, start, end) {
  const step = capture.createRangeQuery(channel, start, end);
  for (let i = 0; i < 100000; i += 1) {
    const result = step();
    expect(result.rawSamples).toBeLessThanOrEqual(128);
    if (result.done) return result.result;
  }
  throw new Error('Unbounded recording query');
}
function reference(pcm, start = 0, end = pcm.length) {
  const data = Array.from(pcm).slice(Math.floor(start), Math.ceil(end)).map((v) => Number.isFinite(v) ? v : 0);
  return data.length ? { min: Math.min(...data), max: Math.max(...data), sumSquares: data.reduce((sum, v) => sum + v * v, 0), count: data.length }
    : { min: 0, max: 0, sumSquares: 0, count: 0 };
}

describe('absolute recording summaries', () => {
  it('enqueues without scanning, yields bounded tasks, and completes partial tails without rescanning history', () => {
    const onChange = vi.fn();
    const { capture, flush } = harness({ onChange });
    const data = Float32Array.from({ length: 4103 }, (_, i) => i % 37 === 0 ? -2 : 0.25);
    data[4102] = 3;
    data[201] = NaN;
    capture.append(chunk(9000, data));
    expect(capture.getStats().samplesScanned).toBe(0);
    flush();
    expect(capture.getStats().samplesScanned).toBe(data.length);
    expect(onChange).toHaveBeenCalledOnce();
    for (const [start, end] of [[0, 4103], [128, 4096], [129.5, 270.1], [4095, 4103]]) {
      expect(query(capture, 0, 9000 + start, 9000 + end)).toEqual(reference(data, start, end));
    }
    const previous = capture.getStats().samplesScanned;
    capture.append(chunk(13103, [-0.75, 4, 0.5]));
    flush();
    expect(capture.getStats().samplesScanned - previous).toBe(3);
    expect(query(capture, 0, 13102, 13106)).toEqual(reference([3, -0.75, 4, 0.5]));
  });

  it('matches extraction across gaps, channel changes, overlaps and nested replacement tails', () => {
    const { capture, flush } = harness();
    const chunks = [chunk(100, [1, 2, 3, 4, 5]), chunk(108, [6, 7, 8], [-6, -7, -8]),
      chunk(103, [-1]), chunk(109, [0.5, 0.75])];
    const outputs = [new Float32Array(15), new Float32Array(15)];
    for (const block of chunks) {
      capture.append(block);
      for (let c = 0; c < 2; c += 1) outputs[c].set(block.channels[Math.min(c, block.channels.length - 1)], block.startFrame - 98);
    }
    flush();
    expect(capture.channelCount(98, 113)).toBe(2);
    for (let c = 0; c < 2; c += 1) {
      expect(query(capture, c, 98, 113)).toEqual(reference(outputs[c]));
      for (let frame = 98; frame < 113; frame += 1) expect(capture.sampleAt(c, frame)).toBe(outputs[c][frame - 98]);
    }
    expect(query(capture, 1, 105, 108)).toEqual(reference([0, 0, 0]));
  });

  it('does not leak a cropped transient from a summarized bucket or an overwritten run', () => {
    const { capture, flush } = harness();
    const pcm = new Float32Array(2048).fill(0.25);
    pcm[127] = 8;
    pcm[1024] = -9;
    capture.append(chunk(500, pcm));
    capture.append(chunk(500 + 1024, [0.5]));
    flush();
    expect(query(capture, 0, 628, 1525)).toEqual(reference([...pcm.slice(128, 1024), 0.5]));
    expect(query(capture, 0, 1524, 1525).min).toBe(0.5);
    expect(query(capture, 0, 1525, 1526).min).toBe(0.25);
  });

  it('keeps summary memory bounded and falls back to bounded exact raw queries after eviction', () => {
    const { capture, flush } = harness({ maxBytes: 2000 });
    const pcm = Float32Array.from({ length: 2048 }, (_, i) => i % 2 ? -0.5 : 2);
    capture.append(chunk(0, pcm));
    capture.append(chunk(2048, pcm));
    flush();
    expect(capture.getStats().bytes).toBeGreaterThan(0);
    expect(capture.getStats().bytes).toBeLessThanOrEqual(2000);
    expect(query(capture, 0, 0, 2048)).toEqual(reference(pcm));
    capture.prune(2048);
    expect(capture.getStats().runs).toBe(1);
    expect(query(capture, 0, 0, 2048)).toEqual(reference(new Float32Array(2048)));
  });

  it('cancels partially processed and queued blocks without stale publication or retained PCM', () => {
    const onChange = vi.fn();
    const { capture, tasks, tick } = harness({ onChange });
    capture.append(chunk(0, new Float32Array(4096)));
    capture.append(chunk(4096, new Float32Array(4096)));
    tick();
    const stale = [...tasks][0];
    capture.cancel();
    stale();
    expect(tasks.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(capture.getStats()).toMatchObject({ bytes: 0, pending: 0, runs: 0 });
  });
});

describe('recording draw slices', () => {
  it('queries only the visible latency-correct absolute source range, with bounded work per slice', () => {
    const calls = [];
    const context = { fillRect: vi.fn() };
    const capture = { createRangeQuery: (_c, start, end) => {
      calls.push([start, end]);
      return () => ({ done: true, rawSamples: 0, result: { min: -0.5, max: 0.5, count: 10 } });
    } };
    const draw = createRecordingDrawJob(context, { capture, sourceStartFrame: 1200, sourceEndFrame: 5000,
      sampleRate: 1000, numberOfChannels: 2, pixelsPerMs: 0.1, leftPx: 100, widthPx: 50, height: 80, dpr: 2 });
    let slices = 0;
    let more;
    do {
      const before = calls.length;
      more = draw();
      expect(calls.length - before).toBeLessThanOrEqual(16);
      slices += 1;
    } while (more && slices < 100);
    expect(more).toBe(false);
    expect(calls[0]).toEqual([2200, 2205]);
    expect(calls).toHaveLength(200);
    expect(Math.max(...calls.map(([, end]) => end))).toBe(2700);
  });

  it('uses signed sample detail without allocating a contiguous recording copy', () => {
    const sampleAt = vi.fn((_channel, frame) => frame % 2 ? -0.5 : 0.5);
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
    const draw = createRecordingDrawJob(context, { capture: { sampleAt }, sourceStartFrame: 1000.5,
      sourceMinFrame: 1000, sourceEndFrame: 1100, sampleRate: 1000, numberOfChannels: 1,
      pixelsPerMs: 2, leftPx: 40, widthPx: 20, height: 40, dpr: 1 });
    expect(draw()).toBe(false);
    expect(sampleAt.mock.calls[0]).toEqual([0, 1020]);
    expect(sampleAt).toHaveBeenCalledTimes(11);
    expect(context.lineTo).toHaveBeenCalled();
  });
});
