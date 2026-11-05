import { describe, expect, it, vi } from 'vitest';
import { createWaveformScheduler } from '../waveformScheduler';
import { createWaveformBuilder } from '../waveformData';
import { createWaveformDrawJob, WAVEFORM_CLOCK_CHECK_WORK } from '../waveformRenderer';

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
    // The clock is sampled every WAVEFORM_CLOCK_CHECK_WORK; this clock model charges 1 ms per 1024 reads.
    expect(reads).toBe(WAVEFORM_CLOCK_CHECK_WORK);
    expect(h.scheduler.getStats()).toMatchObject({ frames: 1, slices: 2, completed: 1, pending: 1, maxFrameMs: 4.5 });
    h.flush();
    expect(reads).toBe(2048);
    expect(h.scheduler.getStats()).toMatchObject({ frames: 2, completed: 2, pending: 0, maxFrameMs: 4.5 });
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

  it('runs background margin work only while no foreground view is waiting', () => {
    const h = harness();
    const order = [];
    let visibleSlices = 2;
    const cancelMargin = h.scheduler.schedule('margin', () => { order.push('margin'); h.spend(1); return true; }, { background: true });
    h.scheduler.schedule('visible', () => { order.push('visible'); h.spend(1); visibleSlices -= 1; return visibleSlices > 0; });
    expect(h.scheduler.getStats()).toMatchObject({ pending: 2, backgroundPending: 1 });
    h.flush();
    expect(order).toEqual(['visible', 'visible', 'margin', 'margin']);
    expect(h.scheduler.getStats()).toMatchObject({ pending: 1, backgroundPending: 1 });
    cancelMargin();
    expect(h.scheduler.getStats()).toMatchObject({ pending: 0, backgroundPending: 0, framePending: false });
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

  it('keeps frames to the interactive budget and refines settled views in bounded follow-up tasks', () => {
    const frames = [];
    const tasks = [];
    let clock = 100;
    let lastInput = 90;
    let pending = false;
    let remaining = Infinity;
    const scheduler = createWaveformScheduler({
      requestFrame: (callback) => frames.push(callback), cancelFrame: (id) => { frames[id - 1] = null; },
      now: () => clock, postTask: (callback) => tasks.push(callback),
      budgetMs: 4, idleBudgetMs: 12, interactionMs: 50, lastInputAt: () => lastInput, inputPending: () => pending,
    });
    let slices = 0;
    scheduler.schedule('draw', () => { slices += 1; clock += 1; remaining -= 1; return remaining > 0; });
    const run = (callback) => { const start = slices; callback(); return slices - start; };
    const frame = () => run(frames.findLast(Boolean));
    const task = () => run(tasks.shift());

    // Recent input: one 4 ms frame slice, nothing extra.
    expect(frame()).toBe(4);
    expect(tasks).toHaveLength(0);

    // Settled: each follow-up task gets at most 4 ms, until 12 ms after the frame started.
    clock = 200;
    expect(frame()).toBe(4);
    expect(task()).toBe(4);
    expect(task()).toBe(4);
    expect(tasks).toHaveLength(0);
    expect(scheduler.getStats()).toMatchObject({ idleTasks: 2, maxFrameMs: 4 });

    // Queued input stops follow-up work before it starts.
    clock = 300;
    expect(frame()).toBe(4);
    pending = true;
    expect(task()).toBe(0);
    expect(tasks).toHaveLength(0);
    pending = false;

    // Finishing in a follow-up task cancels the already requested frame.
    clock = 400;
    remaining = 6;
    expect(frame()).toBe(4);
    expect(scheduler.getStats().framePending).toBe(true);
    expect(task()).toBe(2);
    expect(scheduler.getStats()).toMatchObject({ pending: 0, framePending: false });
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
