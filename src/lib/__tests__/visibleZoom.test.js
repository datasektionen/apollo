import { afterEach, expect, it, vi } from 'vitest';
import { createWaveformBuilder } from '../waveformData';
import { waveformRasterBudget } from '../waveformRenderer';
import { waveformScheduler } from '../waveformScheduler';
import { prepareVisibleZoom, releaseZoomBitmaps } from '../visibleZoom';

let frames;
afterEach(() => {
  frames?.clear();
  vi.unstubAllGlobals();
  expect(waveformScheduler.getStats().pending).toBe(0);
  expect(waveformRasterBudget.getStats()).toMatchObject({ surfaces: 0, bytes: 0 });
});

function installFrame() {
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key) => frames.delete(key));
  const context = new Proxy({}, { get: (target, prop) => target[prop] || (target[prop] = () => {}) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
}

async function flush() {
  for (let i = 0; frames.size && i < 50; i += 1) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  }
  expect(frames.size).toBe(0);
}

it('commits immediately when nothing on screen can be painted', () => {
  const ready = vi.fn();
  const cancel = prepareVisibleZoom({
    rows: [{ kind: 'track', height: 80, track: { id: 'track', clips: [] } }],
    rowTops: [0], vertical: { top: 0, height: 0 }, segment: { origin: 0, left: 0, logical: 0, width: 800 },
    pixelsPerMs: 0.2, viewportWidth: 800, onReady: ready,
  });
  expect(ready).toHaveBeenCalledWith(null);
  cancel();
});

it('holds the zoom until the visible window has been painted', async () => {
  installFrame();
  const pcm = new Float32Array(1024).fill(0.25);
  const pyramid = createWaveformBuilder({ sampleRate: 8000, length: 1024, numberOfChannels: 1 });
  pyramid.append(0, 0, pcm);
  const ready = vi.fn();
  const cancel = prepareVisibleZoom({
    views: [{
      key: 'clip', leftPx: 0, widthPx: 32, height: 8, pixelsPerMs: 1, dpr: 1, cropStartMs: 0,
      displayMode: 'linear', showRms: false, globalPeakAmplitude: 1,
      clips: [{
        buffer: { sampleRate: 8000, length: 1024, numberOfChannels: 1, getChannelData: () => pcm },
        pyramid: pyramid.finish(), blobId: 'clip', cropStartMs: 0, cropEndMs: 128,
        clipLeftPx: 0, clipWidthPx: 32, color: '#fff',
      }],
    }],
    onReady: ready,
  });
  expect(ready).not.toHaveBeenCalled();
  await flush();
  expect(ready).toHaveBeenCalledTimes(1);
  const bitmaps = ready.mock.calls[0][0];
  expect(bitmaps.get('clip').canvas.width).toBeGreaterThan(0);
  expect(bitmaps.get('clip').leftPx).toBe(0);
  releaseZoomBitmaps(bitmaps);
  cancel();
});
