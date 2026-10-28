import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waveformScheduler } from '../../lib/waveformScheduler';
import { waveformRasterBudget } from '../../lib/waveformRenderer';

const manager = vi.hoisted(() => ({ snapshot: null, listeners: new Set() }));
vi.mock('../../lib/recordingManager', () => ({ recordingManager: {
  getWaveformSnapshot: () => manager.snapshot,
  subscribeWaveform: (listener) => { manager.listeners.add(listener); return () => manager.listeners.delete(listener); },
} }));
import RecordingWaveform from '../RecordingWaveform';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
let frames;
let queries;
let mediaListeners;
let context;
const props = { startTimeMs: 5000, endTimeMs: 1e10, clipLeftPx: 500,
  clipWidthPx: 1e9, viewportLeftPx: 600, viewportWidthPx: 200, pixelsPerMs: 0.1, height: 80 };

async function flush() {
  for (let i = 0; frames.size && i < 1000; i += 1) {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    await act(async () => callback());
  }
  expect(frames.size).toBe(0);
}
function snapshot(generation = 1) {
  return { generation, sampleRate: 1000, numberOfChannels: 2, recordingStartMs: 5000,
    sourceStartFrame: generation * 1200, sourceEndFrame: 1e12, capture: {
      sampleAt: (channel, frame) => { queries.push([channel, frame, frame + 1]); return 0.5; },
      createRangeQuery: (channel, start, end) => {
        queries.push([channel, start, end]);
        return () => ({ done: true, rawSamples: 0, result: { min: -0.5, max: 0.5, count: 10 } });
      },
    } };
}
beforeEach(() => {
  frames = new Map(); queries = []; mediaListeners = new Set();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key) => frames.delete(key));
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('matchMedia', () => ({ addEventListener: (_event, fn) => mediaListeners.add(fn),
    removeEventListener: (_event, fn) => mediaListeners.delete(fn) }));
  context = Object.fromEntries(['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke']
    .map((name) => [name, vi.fn()]));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  manager.listeners.clear();
  manager.snapshot = snapshot();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(manager.listeners.size).toBe(0);
  expect(mediaListeners.size).toBe(0);
  expect(waveformScheduler.getStats().pending).toBe(0);
  expect(waveformRasterBudget.getStats()).toMatchObject({ surfaces: 0, bytes: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('positions inside the parent and allocates only the visible DPR-bounded window of a huge recording', async () => {
  await act(async () => root.render(<RecordingWaveform {...props} />));
  await flush();
  const canvas = container.querySelector('canvas');
  expect(container.firstChild.style.position).toBe('absolute');
  expect(container.firstChild.style.left).toBe('68px');
  expect(container.firstChild.style.width).toBe('264px');
  expect(canvas.style.left).toBe('0px');
  expect(canvas.style.width).toBe('264px');
  expect(canvas.width).toBe(528);
  expect(canvas.height).toBe(160);
  expect(queries[0]).toEqual([0, 1880, 1885]);
  expect(waveformRasterBudget.getStats().bytes).toBe(528 * 160 * 4);
});

it('supports recording-time shorthand and a floating timeline origin without changing source mapping', async () => {
  await act(async () => root.render(<RecordingWaveform recordingStartMs={5000} currentTimeMs={10000}
    pixelsPerMs={0.1} originPx={400} viewportLeftPx={200} viewportWidthPx={100} height={40} />));
  await flush();
  expect(container.firstChild.style.left).toBe('68px');
  expect(container.querySelector('canvas').style.left).toBe('0px');
  expect(queries[0]).toEqual([0, 1880, 1885]);
});

it('keeps DOM geometry bounded inside a rebased shell at sample zoom without rebasing source frames', async () => {
  const pixelsPerMs = 48;
  const startTimeMs = 6000;
  const clipLeftPx = startTimeMs * pixelsPerMs;
  const viewportLeftPx = 18_000_000 * pixelsPerMs;
  const clipOffsetPx = viewportLeftPx - clipLeftPx - 100;
  const render = (endTimeMs, offset = clipOffsetPx) => act(async () => root.render(<RecordingWaveform
    startTimeMs={startTimeMs} endTimeMs={endTimeMs} pixelsPerMs={pixelsPerMs}
    clipLeftPx={clipLeftPx} clipWidthPx={(endTimeMs - startTimeMs) * pixelsPerMs}
    clipOffsetPx={offset} viewportLeftPx={viewportLeftPx} viewportWidthPx={800} />));
  await render(36_000_000);
  await flush();
  const surface = container.firstChild;
  const canvas = container.querySelector('canvas');
  expect(surface.style.left).toBe('68px');
  expect(surface.style.width).toBe('864px');
  expect(canvas.style.left).toBe('0px');
  expect(canvas.width).toBe(1728);
  const firstFrame = Math.floor(manager.snapshot.sourceStartFrame + 18_000_000 - 5000 - 32 / pixelsPerMs);
  expect(queries[0][1]).toBeCloseTo(firstFrame);
  expect(queries[0][2] - queries[0][1]).toBe(1);
  expect(queries.find(([channel]) => channel === 1)?.[1]).toBeCloseTo(firstFrame);

  queries.length = 0;
  await render(36_000_000, clipOffsetPx + 25);
  await flush();
  expect(surface.style.left).toBe('43px');
  expect(canvas.width).toBe(1728);
  expect(queries).toHaveLength(0);

  await render(18_000_000 + 4);
  await flush();
  expect(surface.style.width).toBe('224px');
  expect(canvas.width).toBe(448);
  expect(queries[0][1]).toBeCloseTo(firstFrame);
  expect(Math.max(...queries.map(([, , end]) => end))).toBeLessThanOrEqual(
    manager.snapshot.sourceStartFrame + 18_000_000 + 4 - 5000);
});

it('culls offscreen surfaces and drops stale generations or cancellation before drawing', async () => {
  await act(async () => root.render(<RecordingWaveform {...props} viewportLeftPx={0} viewportWidthPx={100} />));
  await flush();
  expect(container.querySelector('canvas').width).toBe(0);
  expect(container.firstChild.style.left).toBe('0px');
  expect(container.firstChild.style.width).toBe('0px');
  expect(queries).toHaveLength(0);
  await act(async () => root.render(<RecordingWaveform {...props} />));
  manager.snapshot = snapshot(2);
  for (const listener of manager.listeners) listener();
  await flush();
  expect(queries[0]).toEqual([0, 3080, 3085]);
  manager.snapshot = null;
  for (const listener of manager.listeners) listener();
  await flush();
  expect(container.querySelector('canvas').width).toBe(0);
});

it('cancels an unfinished draw immediately at a loop split even when the capture and generation are shared', async () => {
  manager.snapshot.capture.createRangeQuery = (_channel, start, end) => {
    queries.push([start, end]);
    return () => ({ done: false, rawSamples: 0 });
  };
  const stepFrame = async () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    await act(async () => callback());
  };
  await act(async () => root.render(<RecordingWaveform {...props} />));
  await stepFrame();
  expect(queries[0]).toEqual([1880, 1885]);
  manager.snapshot = { ...manager.snapshot, sourceStartFrame: 2200 };
  for (const listener of manager.listeners) listener();
  await stepFrame();
  expect(queries[1]).toEqual([2880, 2885]);
  manager.snapshot = null;
  for (const listener of manager.listeners) listener();
  await flush();
  expect(container.querySelector('canvas').width).toBe(0);
});

it('uses effective allocator DPR and retries a denied allocation when capacity is released', async () => {
  const allocate = vi.spyOn(waveformRasterBudget, 'allocate');
  allocate.mockReturnValueOnce(undefined);
  await act(async () => root.render(<RecordingWaveform {...props} />));
  await flush();
  expect(container.querySelector('canvas').width).toBe(0);
  const other = document.createElement('canvas');
  waveformRasterBudget.allocate(other, 10, 10, 1);
  waveformRasterBudget.release(other);
  await flush();
  expect(container.querySelector('canvas').width).toBe(528);
  queries.length = 0;
  vi.stubGlobal('devicePixelRatio', 3);
  await act(async () => { for (const listener of [...mediaListeners]) listener(); });
  await flush();
  expect(container.querySelector('canvas').width).toBe(792);
  expect(queries[0][2] - queries[0][1]).toBeCloseTo(10 / 3);
});
