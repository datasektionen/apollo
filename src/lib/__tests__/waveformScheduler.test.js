import { describe, expect, it, vi } from 'vitest';
import { createWaveformScheduler } from '../waveformScheduler';
import { createWaveformBuilder } from '../waveformData';
import { createWaveformDrawJob } from '../waveformRenderer';

function harness() {
  const frames = new Map();
  let id = 0;
  let clock = 0;
  const scheduler = createWaveformScheduler({
    requestFrame: (callback) => { frames.set(++id, callback); return id; },
    cancelFrame: (key) => frames.delete(key), now: () => clock, budgetMs: 4,
  });
  return { scheduler, frames, spend: (ms) => { clock += ms; }, flush() {
    const [key, callback] = frames.entries().next().value;
    frames.delete(key);
    callback();
  } };
}

describe('shared waveform scheduler', () => {
  it('batches 54 stereo overview draws without spending hundreds of idle frames on tiny slices', () => {
    const h = harness();
    const pcm = Float32Array.from({ length: 144000 }, (_, i) => Math.sin(i) * 0.5);
    const buffer = { sampleRate: 48000, length: pcm.length, numberOfChannels: 2, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 4096 });
    builder.append(0, 0, pcm);
    builder.append(1, 0, pcm);
    const pyramid = builder.finish();
    let bars = 0;
    const context = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip'].map((name) => [name, () => {}]));
    context.fillRect = () => { bars += 1; };
    for (let i = 0; i < 54; i += 1) {
      h.scheduler.schedule(i, createWaveformDrawJob(context, {
        audioBuffer: buffer, pyramid, cropEndMs: 3000, pixelsPerMs: 1440 / 3000,
        clipWidthPx: 1440, surfaceLeftPx: 0, surfaceWidthPx: 1440, height: 24, dpr: 2,
      }));
    }
    while (h.frames.size && h.scheduler.getStats().frames < 1000) h.flush();
    expect(h.scheduler.getStats()).toMatchObject({ pending: 0, completed: 54, errors: 0 });
    expect(bars).toBe(54 * 2 * (2880 + 1));
    expect(h.scheduler.getStats().slices).toBeLessThanOrEqual(2200);
    expect(h.scheduler.getStats().frames).toBeLessThanOrEqual(18);
  });

  it('coalesces repeated invalidations and all views into one rAF', () => {
    const h = harness();
    const stale = vi.fn();
    const latest = vi.fn();
    const other = vi.fn();
    h.scheduler.schedule('clip', stale);
    h.scheduler.schedule('clip', latest);
    h.scheduler.schedule('group', other);
    expect(h.frames.size).toBe(1);
    h.flush();
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
    expect(h.scheduler.getStats()).toMatchObject({ pending: 0, cancelled: 1, completed: 2 });
  });

  it('shares the remaining 4 ms frame budget with batched exact draws', () => {
    const h = harness();
    let reads = 0;
    const pcm = new Proxy({}, { get: () => { reads += 1; h.spend(1 / 1024); return 0.5; } });
    const context = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'fillRect'].map((name) => [name, () => {}]));
    h.scheduler.schedule('other', () => { h.spend(3.5); });
    h.scheduler.schedule('draw', createWaveformDrawJob(context, {
      audioBuffer: { sampleRate: 1000, length: 2048, numberOfChannels: 1, getChannelData: () => pcm },
      cropEndMs: 2048, pixelsPerMs: 1 / 2048,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 24,
    }));
    h.flush();
    expect(reads).toBe(512);
    expect(h.scheduler.getStats()).toMatchObject({ frames: 1, slices: 2, completed: 1, pending: 1, maxFrameMs: 4 });
    h.flush();
    expect(reads).toBe(2048);
    expect(h.scheduler.getStats()).toMatchObject({ frames: 2, completed: 2, pending: 0, maxFrameMs: 4 });
  });

  it('yields at budget, prioritizes work, and rotates equal-priority continuations', () => {
    const h = harness();
    const order = [];
    const work = (name) => () => { order.push(name); h.spend(4); return true; };
    const cancelA = h.scheduler.schedule('a', work('a'));
    const cancelB = h.scheduler.schedule('b', work('b'));
    const cancelEdit = h.scheduler.schedule('edit', work('edit'), { priority: 2 });
    h.flush();
    expect(order).toEqual(['edit']);
    cancelEdit();
    h.flush();
    h.flush();
    expect(order).toEqual(['edit', 'a', 'b']);
    cancelA(); cancelB();
    expect(h.frames.size).toBe(0);
    expect(h.scheduler.getStats()).toMatchObject({ pending: 0, frames: 3, slices: 3, maxFrameMs: 4 });
  });

  it('ages continuations past an endless high-priority self-notification stream', () => {
    const h = harness();
    let lowRuns = 0;
    let cancelHigh;
    const high = () => {
      cancelHigh = h.scheduler.schedule('high', high, { priority: 1e9 });
      h.spend(4);
      return true;
    };
    cancelHigh = h.scheduler.schedule('high', high, { priority: 1e9 });
    const cancelLow = h.scheduler.schedule('low', () => { lowRuns += 1; h.spend(4); return true; });
    for (let i = 0; i < 30; i += 1) h.flush();
    expect(lowRuns).toBeGreaterThanOrEqual(2);
    expect(h.scheduler.getStats().maxWaitSlices).toBeLessThanOrEqual(10);
    cancelHigh(); cancelLow();
    expect(h.frames.size).toBe(0);
  });

  it('keeps queue age through repeated notifications and bounds zero-cost continuations', () => {
    const h = harness();
    const notification = vi.fn(() => { h.spend(4); });
    const cancelHigh = h.scheduler.schedule('busy', () => { h.spend(4); return true; }, { priority: 4 });
    let cancelNotification;
    for (let i = 0; i < 12; i += 1) {
      cancelNotification = h.scheduler.schedule('notification', notification);
      h.flush();
    }
    expect(notification).toHaveBeenCalled();
    cancelHigh(); cancelNotification();
    const spinning = h.scheduler.schedule('spin', () => true);
    h.flush();
    expect(h.scheduler.getStats().pending).toBe(1);
    spinning();
    expect(h.frames.size).toBe(0);
  });

  it('does not revive a cancelled slice or overwrite its replacement', () => {
    const h = harness();
    const replacement = vi.fn();
    let cancel;
    cancel = h.scheduler.schedule('a', () => {
      cancel();
      h.scheduler.schedule('a', replacement);
      h.spend(4);
      return true;
    });
    h.flush();
    h.flush();
    expect(replacement).toHaveBeenCalledOnce();
    expect(h.scheduler.getStats().pending).toBe(0);
  });
});
