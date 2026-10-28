import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createWaveformBuilder } from '../../lib/waveformData';
import { waveformScheduler } from '../../lib/waveformScheduler';
import { waveformRasterBudget } from '../../lib/waveformRenderer';
import * as waveformRenderer from '../../lib/waveformRenderer';

const legacy = vi.hoisted(() => ({ create: vi.fn(), instances: [] }));
vi.mock('wavesurfer.js', () => ({ default: { create: legacy.create } }));
const service = vi.hoisted(() => ({ listeners: new Set(), sources: new Map(), ensureSource: vi.fn(), releaseSource: vi.fn(), pinSource: vi.fn(), pins: new Map() }));
const mediaCache = vi.hoisted(() => {
  const cache = new Map();
  cache.listeners = new Set();
  cache.subscribe = (listener) => { cache.listeners.add(listener); return () => cache.listeners.delete(listener); };
  return cache;
});
vi.mock('../../lib/audioManager', () => ({ audioManager: { mediaCache } }));
vi.mock('../../lib/waveformService', () => ({ waveformService: {
  ensureSource: service.ensureSource, releaseSource: service.releaseSource, pinSource: service.pinSource,
  getSource: (_id, buffer) => service.sources.get(buffer),
  subscribe: (listener) => { service.listeners.add(listener); return () => service.listeners.delete(listener); },
} }));
import Waveform from '../Waveform';
import GroupWaveform from '../GroupWaveform';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let frames;
let context;
let roots;
let resizeCallbacks;
let mediaListeners;
let rect;
let originalUrl;

function buffer(ready = true) {
  const pcm = Float32Array.from({ length: 4096 }, (_, i) => i % 2 ? -0.5 : 1.2);
  const audioBuffer = { sampleRate: 1000, length: pcm.length, numberOfChannels: 1, getChannelData: vi.fn(() => pcm) };
  if (ready) {
    const builder = createWaveformBuilder(audioBuffer);
    builder.append(0, 0, pcm);
    service.sources.set(audioBuffer, { status: 'ready', pyramid: builder.finish() });
  }
  return audioBuffer;
}
async function mount(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const view = { container, root, render: async (next) => { await act(async () => root.render(next)); } };
  roots.push(view);
  await view.render(element);
  return view;
}
async function flush() {
  for (let i = 0; frames.size && i < 1000; i += 1) {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    await act(async () => callback());
  }
  expect(frames.size).toBe(0);
}
async function publish(audioBuffer, state, blobId = 'blob') {
  service.sources.set(audioBuffer, state);
  await act(async () => { for (const listener of [...service.listeners]) listener({ type: state.status, blobIds: [blobId], source: state }); });
}
const geometry = { pixelsPerMs: 0.1, clipLeftPx: 0, clipWidthPx: 1e9, viewportLeftPx: 100, viewportWidthPx: 200 };

beforeEach(() => {
  originalUrl = window.location.pathname + window.location.search + window.location.hash;
  window.history.replaceState(null, '', window.location.pathname);
  vi.stubEnv('VITE_WAVEFORM_RENDERER', 'modern');
  legacy.instances = [];
  legacy.create.mockReset();
  legacy.create.mockImplementation((options) => {
    const instance = { options, destroy: vi.fn(), empty: vi.fn(), on: vi.fn((event, listener) => {
      if (event === 'ready') instance.ready = listener;
    }), load: vi.fn(async () => { instance.ready?.(); }) };
    legacy.instances.push(instance);
    return instance;
  });
  roots = []; frames = new Map(); resizeCallbacks = []; mediaListeners = new Set();
  rect = { left: 0, width: 400, right: 400 };
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key) => frames.delete(key));
  vi.stubGlobal('ResizeObserver', class { constructor(cb) { resizeCallbacks.push(cb); } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ addEventListener: (_type, listener) => mediaListeners.add(listener), removeEventListener: (_type, listener) => mediaListeners.delete(listener) }));
  vi.stubGlobal('devicePixelRatio', 2);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect);
  context = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'fillRect', 'moveTo', 'lineTo', 'stroke', 'setTransform', 'clearRect'].map((name) => [name, vi.fn()]));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  service.sources.clear(); service.listeners.clear(); mediaCache.clear(); mediaCache.listeners.clear();
  service.ensureSource.mockReset(); service.releaseSource.mockClear();
  service.pinSource.mockReset(); service.pins.clear();
  service.pinSource.mockImplementation((_id, audioBuffer) => {
    service.pins.set(audioBuffer, (service.pins.get(audioBuffer) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = service.pins.get(audioBuffer) - 1;
      if (remaining) service.pins.set(audioBuffer, remaining);
      else service.pins.delete(audioBuffer);
    };
  });
  service.ensureSource.mockImplementation((_id, audioBuffer) => {
    if (!service.sources.has(audioBuffer)) {
      const state = { status: 'loading' };
      service.sources.set(audioBuffer, state);
      for (const listener of [...service.listeners]) listener({ type: 'loading', blobIds: ['blob'], source: state });
    }
    return service.sources.get(audioBuffer);
  });
});
afterEach(async () => {
  for (const { root, container } of roots) { await act(async () => root.unmount()); container.remove(); }
  expect(waveformScheduler.getStats().pending).toBe(0);
  expect(service.listeners.size).toBe(0);
  expect(mediaCache.listeners.size).toBe(0);
  expect(mediaListeners.size).toBe(0);
  expect(service.pins.size).toBe(0);
  expect(waveformRasterBudget.getStats()).toMatchObject({ bytes: 0, surfaces: 0 });
  window.history.replaceState(null, '', originalUrl);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('Waveform', () => {
  it.each(['Waveform', 'GroupWaveform'])('forwards the current scheduler budget to %s draw continuations', async (component) => {
    const audioBuffer = buffer();
    mediaCache.set('blob', audioBuffer);
    const draw = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    vi.spyOn(waveformRenderer, 'createWaveformDrawJob').mockReturnValue(draw);
    let run;
    vi.spyOn(waveformScheduler, 'schedule').mockImplementation((_key, callback) => {
      run = callback;
      return vi.fn();
    });
    if (component === 'Waveform') {
      await mount(<Waveform audioBuffer={audioBuffer} blobId="blob" clipId="clip" cropEndMs={4096} {...geometry} />);
    } else {
      const clips = [{ key: 'a', blobId: 'blob', startMs: 0, durationMs: 4096, cropStartMs: 0, cropEndMs: 4096 }];
      await mount(<GroupWaveform clips={clips} pixelsPerMs={0.1} viewportWidthPx={200} />);
      await act(async () => { expect(run({ now: () => 0, deadline: 4 })).toBe(true); });
      expect(draw).not.toHaveBeenCalled();
    }
    const firstBudget = { now: () => 3.5, deadline: 4 };
    const nextBudget = { now: () => 16, deadline: 20 };
    await act(async () => { expect(run(firstBudget)).toBe(true); });
    await act(async () => { run(nextBudget); });
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[0][0]).toBe(firstBudget);
    expect(draw.mock.calls[1][0]).toBe(nextBudget);
  });

  it('allocates only the visible window at DPR, calls ready, and scales without extraction', async () => {
    const audioBuffer = buffer();
    const onReady = vi.fn();
    const props = { audioBuffer, blobId: 'blob', clipId: 'clip', cropEndMs: 4096, ...geometry, onReady };
    const view = await mount(<Waveform {...props} />);
    await flush();
    const canvas = view.container.querySelector('canvas');
    expect(legacy.create).not.toHaveBeenCalled();
    expect(canvas.style.left).toBe('68px');
    expect(canvas.style.width).toBe('264px');
    expect(canvas.width).toBe(528);
    expect(canvas.height).toBe(160);
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    expect(onReady).toHaveBeenCalledOnce();
    expect(service.pinSource).toHaveBeenCalledOnce();
    service.ensureSource.mockClear();
    await view.render(<Waveform {...props} displayMode="normalized" globalPeakAmplitude={0.5} showRms showClipping />);
    await flush();
    expect(service.ensureSource).not.toHaveBeenCalled();
    expect(service.pinSource).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalled();
    expect(service.releaseSource).not.toHaveBeenCalled();
  });

  it('shows accessible loading/error placeholders and updates from real subscriptions', async () => {
    const audioBuffer = buffer(false);
    const props = { audioBuffer, blobId: 'blob', cropEndMs: 4096, ...geometry };
    const view = await mount(<Waveform {...props} />);
    await flush();
    expect(view.container.firstChild.getAttribute('aria-busy')).toBe('true');
    expect(audioBuffer.getChannelData).not.toHaveBeenCalled();
    await publish(audioBuffer, { status: 'error', error: new Error('worker') });
    await flush();
    expect(view.container.firstChild.getAttribute('aria-label')).toBe('Waveform unavailable');
    const ready = buffer();
    await publish(audioBuffer, service.sources.get(ready));
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
  });

  it('cancels stale source/geometry work and unsubscribes without releasing shared sources', async () => {
    const first = buffer();
    const second = buffer();
    const onReady = vi.fn();
    const view = await mount(<Waveform audioBuffer={first} onReady={onReady} {...geometry} />);
    await view.render(<Waveform audioBuffer={second} onReady={onReady} {...geometry} viewportLeftPx={200} />);
    await flush();
    expect(first.getChannelData).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
    expect(view.container.querySelector('canvas').style.left).toBe('168px');
    await view.render(null);
    expect(service.listeners.size).toBe(0);
    expect(service.releaseSource).not.toHaveBeenCalled();
  });

  it('re-pins in-place source revisions, drops stale pixels, and unpins when leaving the viewport', async () => {
    const audioBuffer = buffer();
    const props = { audioBuffer, blobId: 'blob', cropEndMs: 4096, ...geometry };
    const view = await mount(<Waveform {...props} />);
    await flush();
    const previous = service.sources.get(audioBuffer);
    const loading = { status: 'loading' };
    service.sources.set(audioBuffer, loading);
    await act(async () => {
      for (const listener of [...service.listeners]) listener({ type: 'replaced', blobIds: ['blob'], source: previous });
    });
    await flush();
    expect(service.pinSource).toHaveBeenCalledTimes(2);
    expect(service.pins.get(audioBuffer)).toBe(1);
    expect(service.pinSource.mock.calls.every((call) => call.length === 2)).toBe(true);
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('loading');
    const ready = service.sources.get(buffer());
    await publish(audioBuffer, ready);
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    await view.render(<Waveform {...props} clipLeftPx={10000} clipWidthPx={100} />);
    await flush();
    expect(service.pins.size).toBe(0);
    expect(view.container.querySelector('canvas').width).toBe(0);
    expect(waveformRasterBudget.getStats().bytes).toBe(0);
    expect(service.releaseSource).not.toHaveBeenCalled();
  });

  it('clears an unfinished raster generation immediately on a geometry change', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => { clock += 4; return clock; });
    const audioBuffer = buffer();
    const onReady = vi.fn();
    const props = { audioBuffer, blobId: 'blob', cropEndMs: 4096, ...geometry, onReady };
    const view = await mount(<Waveform {...props} />);
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    await act(async () => callback());
    const canvas = view.container.querySelector('canvas');
    expect(canvas.width).toBeGreaterThan(0);
    expect(onReady).not.toHaveBeenCalled();
    await view.render(<Waveform {...props} cropStartMs={100} />);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    await flush();
    expect(onReady).toHaveBeenCalledOnce();
    expect(service.pinSource).toHaveBeenCalledOnce();
  });

  it('measures legacy parent geometry, observes container resize, and redraws on DPR change', async () => {
    const view = await mount(<Waveform audioBuffer={buffer()} cropStartMs={0} cropEndMs={4096} />);
    await flush();
    expect(view.container.querySelector('canvas').style.width).toBe('400px');
    expect(resizeCallbacks.length).toBe(1);
    rect = { left: 0, width: 300, right: 300 };
    await act(async () => resizeCallbacks[0]());
    await flush();
    expect(view.container.querySelector('canvas').width).toBe(600);
    vi.stubGlobal('devicePixelRatio', 3);
    await act(async () => { for (const listener of [...mediaListeners]) listener(); });
    await flush();
    expect(view.container.querySelector('canvas').width).toBe(900);
  });

  it('does not create a retry loop when Canvas 2D is unavailable', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
    const view = await mount(<Waveform audioBuffer={buffer()} {...geometry} />);
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('limited');
    expect(waveformRasterBudget.getStats().bytes).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('bounds total backing bytes and retries blocked surfaces when other views unmount', async () => {
    const audioBuffer = buffer();
    const render = (start) => Array.from({ length: 20 - start }, (_, offset) => {
      const id = start + offset;
      return <Waveform key={id} clipId={id} audioBuffer={audioBuffer} {...geometry}
        viewportLeftPx={0} viewportWidthPx={2000} height={1000} />;
    });
    const view = await mount(render(0));
    await flush();
    expect(waveformRasterBudget.getStats().bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(view.container.querySelectorAll('[data-waveform-status="limited"]').length).toBeGreaterThan(0);
    const canvases = [...view.container.querySelectorAll('canvas')];
    expect(canvases.some((canvas) => canvas.width > 0 && canvas.width < 4064)).toBe(true);
    await view.render(render(16));
    await flush();
    expect(view.container.querySelectorAll('[data-waveform-status="limited"]')).toHaveLength(0);
    expect(view.container.querySelectorAll('[data-waveform-status="ready"]')).toHaveLength(4);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  });

  it('does not register or allocate offscreen sources', async () => {
    const audioBuffer = buffer(false);
    const view = await mount(<Waveform audioBuffer={audioBuffer} {...geometry} clipLeftPx={10000} clipWidthPx={100} />);
    await flush();
    expect(view.container.querySelector('canvas').width).toBe(0);
    expect(service.ensureSource).not.toHaveBeenCalled();
    expect(service.pinSource).not.toHaveBeenCalled();
  });
});

describe('renderer rollout', () => {
  it('mounts only the recovered legacy renderer for the URL opt-in and filters modern DOM props', async () => {
    window.history.replaceState(null, '', '?waveformRenderer=legacy');
    const onReady = vi.fn();
    const audioBuffer = buffer();
    const view = await mount(<Waveform audioBuffer={audioBuffer} blobId="blob" clipId="clip"
      cropStartMs={0} cropEndMs={4096} onReady={onReady} {...geometry}
      displayMode="db" showRms showClipping showSamples />);
    await flush();
    expect(legacy.create).toHaveBeenCalledOnce();
    expect(legacy.instances[0].load).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    expect(service.pinSource).not.toHaveBeenCalled();
    expect(service.ensureSource).not.toHaveBeenCalled();
    expect(service.listeners.size).toBe(0);
    expect(view.container.querySelector('canvas')).toBeNull();
    for (const name of ['pixelsperms', 'clipleftpx', 'displaymode', 'showrms', 'blobid', 'onready']) {
      expect(view.container.firstChild.hasAttribute(name)).toBe(false);
    }
    await view.render(null);
    expect(legacy.instances[0].destroy).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('honors a legacy build and permits the modern URL override', async () => {
    vi.stubEnv('VITE_WAVEFORM_RENDERER', 'legacy');
    const props = { audioBuffer: buffer(), cropStartMs: 0, cropEndMs: 4096, ...geometry };
    const view = await mount(<Waveform {...props} />);
    await flush();
    expect(legacy.create).toHaveBeenCalledOnce();
    expect(service.pinSource).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '?waveformRenderer=modern');
    await view.render(<Waveform {...props} />);
    await flush();
    expect(legacy.instances[0].destroy).toHaveBeenCalledOnce();
    expect(legacy.create).toHaveBeenCalledOnce();
    expect(service.pinSource).toHaveBeenCalledOnce();
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    const modernCanvas = view.container.querySelector('canvas');
    window.history.replaceState(null, '', '?waveformRenderer=legacy');
    await view.render(<Waveform {...props} />);
    expect(modernCanvas.width).toBe(0);
    expect(service.pins.size).toBe(0);
    expect(service.listeners.size).toBe(0);
    expect(waveformRasterBudget.getStats().bytes).toBe(0);
    await flush();
    expect(legacy.create).toHaveBeenCalledTimes(2);
  });

  it('culls and positions bounded legacy group children without mounting modern source observers', async () => {
    window.history.replaceState(null, '', '?waveformRenderer=legacy');
    mediaCache.set('blob', buffer());
    const clips = [
      { key: 'a', blobId: 'blob', startMs: 50, durationMs: 200, cropStartMs: 10, cropEndMs: 210 },
      { key: 'b', blobId: 'blob', startMs: 1000, durationMs: 100, cropStartMs: 0, cropEndMs: 100 },
      { key: 'missing', blobId: 'missing', startMs: 110, durationMs: 10, cropStartMs: 0, cropEndMs: 10 },
    ];
    const props = { clips, pixelsPerMs: 1, viewportLeftPx: 100, viewportWidthPx: 100, height: 50 };
    const view = await mount(<GroupWaveform {...props} displayMode="db" showClipping showRms />);
    await flush();
    expect(legacy.create).toHaveBeenCalledOnce();
    const a = view.container.querySelector('[data-legacy-clip="a"]');
    expect(a.style.left).toBe('68px');
    expect(a.style.width).toBe('164px');
    expect(legacy.instances[0].load.mock.calls[0][2]).toBeCloseTo(0.164);
    expect(view.container.querySelector('[data-legacy-clip="b"]')).toBeNull();
    expect(view.container.firstChild.getAttribute('aria-label')).toContain('missing media');
    expect(view.container.querySelector('[data-legacy-clip="missing"]').style.backgroundColor).toBe('rgba(248, 113, 113, 0.55)');
    expect(service.pinSource).not.toHaveBeenCalled();
    expect(service.listeners.size).toBe(0);
    expect(waveformRasterBudget.getStats().surfaces).toBe(0);
    await view.render(<GroupWaveform {...props} viewportLeftPx={1000} />);
    await flush();
    expect(legacy.instances[0].destroy).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[data-legacy-clip="a"]')).toBeNull();
    expect(view.container.querySelector('[data-legacy-clip="b"]').style.left).toBe('1000px');
    expect(legacy.create).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (const listener of mediaCache.listeners) listener({ type: 'revision', blobId: 'blob' });
    });
    await flush();
    expect(legacy.create).toHaveBeenCalledTimes(3);
    expect(legacy.instances[1].destroy).toHaveBeenCalledOnce();
  });
});

describe('GroupWaveform', () => {
  it('draws one bounded activity surface for repeated clips and preserves flagged missing color', async () => {
    const audioBuffer = buffer();
    mediaCache.set('blob', audioBuffer);
    const clips = [0, 1, 2].map((i) => ({ key: i, blobId: 'blob', startMs: i * 200, durationMs: 1000, cropStartMs: 0, cropEndMs: 1000, sourceDurationMs: 4096 }));
    const colors = [];
    context.fillRect.mockImplementation(() => colors.push(context.fillStyle));
    const view = await mount(<GroupWaveform clips={clips} pixelsPerMs={0.1} viewportLeftPx={0} viewportWidthPx={200} missingMediaBlobIds={new Set(['blob'])} />);
    await flush();
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    expect(view.container.querySelector('canvas').width).toBeLessThanOrEqual(528);
    expect(view.container.firstChild.getAttribute('aria-label')).toContain('not mixed output');
    expect(view.container.firstChild.getAttribute('aria-label')).toContain('missing media');
    expect(colors).toContain('rgba(248, 113, 113, 0.55)');
    expect(service.releaseSource).not.toHaveBeenCalled();
    expect(service.pinSource).toHaveBeenCalledOnce();
    expect(service.pins.get(audioBuffer)).toBe(1);
  });

  it('resolves newly available media on parent rerender even with the same clips array', async () => {
    const clips = [{ key: 'a', blobId: 'blob', startMs: 0, durationMs: 1000, cropStartMs: 0, cropEndMs: 1000 }];
    const props = { clips, pixelsPerMs: 0.1, viewportWidthPx: 200 };
    const view = await mount(<GroupWaveform {...props} />);
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('missing');
    mediaCache.set('blob', buffer());
    await view.render(<GroupWaveform {...props} />);
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('handles media-cache arrivals/replacements without parent rerenders or revision overrides', async () => {
    const clips = [{ key: 'a', blobId: 'blob', startMs: 0, durationMs: 1000, cropStartMs: 0, cropEndMs: 1000 }];
    const view = await mount(<GroupWaveform clips={clips} pixelsPerMs={0.1} viewportWidthPx={200} />);
    await flush();
    const first = buffer(false);
    await act(async () => {
      mediaCache.set('blob', first);
      for (const listener of mediaCache.listeners) listener({ type: 'set', blobId: 'blob' });
    });
    await flush();
    expect(service.ensureSource).toHaveBeenCalledWith('blob', first, { priority: 0 });
    expect(service.pins.get(first)).toBe(1);
    const second = buffer();
    await act(async () => {
      mediaCache.set('blob', second);
      for (const listener of mediaCache.listeners) listener({ type: 'set', blobId: 'blob' });
    });
    await flush();
    expect(service.pins.has(first)).toBe(false);
    expect(service.pins.get(second)).toBe(1);
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    expect(service.ensureSource.mock.calls.every((call) => !Object.hasOwn(call[2], 'revision'))).toBe(true);
  });

  it('coalesces ready notifications without restarting active group continuations', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => { clock += 0.125; return clock; });
    context.clearRect.mockImplementation(() => { clock += 4; });
    context.restore.mockImplementation(() => { clock += 4; });
    const first = buffer();
    const second = buffer(false);
    mediaCache.set('a', first); mediaCache.set('b', second);
    const clips = ['a', 'b'].map((blobId) => ({ key: blobId, blobId, startMs: 0, durationMs: 4096, cropStartMs: 0, cropEndMs: 4096 }));
    const view = await mount(<GroupWaveform clips={clips} pixelsPerMs={0.1} viewportWidthPx={500} />);
    const nextFrame = async () => {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      await act(async () => callback());
    };
    await nextFrame(); // Initialize the first pass; only one scheduler slice fits each frame.
    const ready = service.sources.get(buffer());
    await publish(second, ready, 'b');
    for (let i = 0; i < 5; i += 1) {
      await publish(second, { ...ready }, 'b');
      await nextFrame();
    }
    expect(context.clearRect).toHaveBeenCalledOnce();
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });

  it('handles a cold summary event without stale draw publication or polling', async () => {
    const audioBuffer = buffer(false);
    mediaCache.set('blob', audioBuffer);
    const clips = [{ key: 'a', blobId: 'blob', startMs: 0, durationMs: 1000, cropStartMs: 0, cropEndMs: 1000 }];
    const view = await mount(<GroupWaveform clips={clips} pixelsPerMs={0.1} viewportWidthPx={200} />);
    await flush();
    expect(view.container.firstChild.getAttribute('aria-busy')).toBe('true');
    const ready = buffer();
    await publish(audioBuffer, service.sources.get(ready));
    await flush();
    expect(view.container.firstChild.getAttribute('data-waveform-status')).toBe('ready');
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  });
});
