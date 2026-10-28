import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  cache: new Map(), mediaListeners: new Set(), sourceListeners: new Set(), waveforms: new Map(), groups: [], recordings: [],
  stats: vi.fn(() => ({ sourcePeak: 2 })),
}));
vi.mock('../../lib/audioManager', () => ({ audioManager: { mediaCache: Object.assign(state.cache, {
  subscribe: (listener) => { state.mediaListeners.add(listener); return () => state.mediaListeners.delete(listener); },
}) } }));
vi.mock('../../lib/waveformService', () => ({ waveformService: {
  subscribe: (listener) => { state.sourceListeners.add(listener); return () => state.sourceListeners.delete(listener); },
  getSourceStats: state.stats,
} }));
vi.mock('../Waveform', () => ({ default: (props) => {
  state.waveforms.set(props.clipId, props);
  return <div data-waveform={props.clipId} data-mode={props.displayMode} data-loaded={Boolean(props.audioBuffer)} />;
} }));
vi.mock('../GroupWaveform', () => ({ default: (props) => {
  state.groups.push(props);
  return <div data-group-waveform="true" />;
} }));
vi.mock('../RecordingWaveform', () => ({ default: (props) => {
  state.recordings.push(props);
  return <div data-recording-waveform="true" />;
} }));
import { getWaveformWindow } from '../../lib/waveformRenderer';
import Timeline from '../Timeline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, frames, observers, current, props, width;
const makeClip = (id = 'clip', start = 0, length = 1000) => ({
  id, name: id, blobId: id, timelineStartMs: start, cropStartMs: 0, cropEndMs: length,
  sourceDurationMs: length + 500, gainDb: 0, muted: false,
});
const makeTrack = (id, clips) => ({ id, name: id, clips, gainDb: 0, pan: 0, muted: false, soloed: false });
const project = (tracks = [makeTrack('track', [makeClip()])]) => ({ projectId: 'project', tracks, loop: {}, lyrics: { lines: [] } });
const tracksElement = () => host.querySelector('[data-timeline-scroll]');
const range = () => host.querySelector('input[type=range]');
const clipElement = () => host.querySelector('[data-clip-id="clip"]');
async function render(extra = {}) {
  props = { ...props, ...extra };
  await act(async () => root.render(<Timeline {...props} project={current} />));
}
async function event(target, type, init = {}) {
  const EventClass = type === 'wheel' ? WheelEvent : type.startsWith('key') ? KeyboardEvent : type.startsWith('mouse') || type.startsWith('pointer') || type === 'click' ? MouseEvent : Event;
  const e = new EventClass(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => target.dispatchEvent(e));
  return e;
}
async function flush() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(100)));
}
function clickText(text) {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent === text);
  return event(button, 'click');
}
async function publish(kind = 'media') {
  await act(async () => [...(kind === 'media' ? state.mediaListeners : state.sourceListeners)].forEach((listener) => listener({ type: 'ready', blobIds: ['clip'] })));
}

beforeEach(async () => {
  width = 800;
  frames = new Map(); observers = []; let frame = 0;
  state.cache.clear(); state.waveforms.clear(); state.groups.length = 0; state.recordings.length = 0;
  state.stats.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.set(++frame, cb); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const parent = this.closest('[data-shared-scroller]');
    const top = this.hasAttribute('data-shared-scroller') ? 0 : -(parent?.scrollTop || 0);
    return { left: 0, right: width, top, bottom: top + 240, width, height: 240 };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  current = project();
  props = {
    currentTimeMs: 3000, onSeek: vi.fn(), shortcutsEnabled: true,
    updateProject: vi.fn((updater) => { current = updater(current); }),
  };
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(state.mediaListeners.size).toBe(0);
  expect(state.sourceListeners.size).toBe(0);
  expect(frames.size).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Timeline integration', () => {
  it('passes source identity, viewport and fixed-scale defaults to the renderer', () => {
    const view = state.waveforms.get('clip');
    expect(view).toMatchObject({ blobId: 'clip', clipLeftPx: 0, clipWidthPx: 100, viewportLeftPx: 0,
      viewportWidthPx: 800, pixelsPerMs: 0.1, displayMode: 'linear', showSamples: true });
    expect(range().getAttribute('aria-label')).toBe('Timeline zoom');
    expect(range().getAttribute('aria-valuetext')).toContain('visible');
  });
  it('reacts to media replacement/removal and cached peak readiness without PCM reads or polling', async () => {
    const pcm = vi.fn(() => { throw Error('must not scan PCM'); });
    state.cache.set('clip', { sampleRate: 48000, getChannelData: pcm }); await publish();
    expect(host.querySelector('[data-waveform]').dataset.loaded).toBe('true');
    state.cache.set('clip', { sampleRate: 96000, getChannelData: pcm }); await publish();
    expect(state.waveforms.get('clip').audioBuffer.sampleRate).toBe(96000);
    state.stats.mockReturnValueOnce({ sourcePeak: 3 }); await publish('source');
    expect(state.waveforms.get('clip').globalPeakAmplitude).toBe(3);
    state.cache.delete('clip'); await publish();
    expect(host.querySelector('[data-waveform]').dataset.loaded).toBe('false');
    expect(pcm).not.toHaveBeenCalled();
  });
  it('supports normalized/dB, RMS, source-over-range and sample options', async () => {
    const select = host.querySelector('select');
    select.value = 'normalized'; await event(select, 'change');
    expect(state.waveforms.get('clip').displayMode).toBe('normalized');
    select.value = 'db'; await event(select, 'change');
    const checks = host.querySelectorAll('input[type=checkbox]');
    await event(checks[0], 'click'); await event(checks[1], 'click'); await event(checks[2], 'click');
    expect(state.waveforms.get('clip')).toMatchObject({ displayMode: 'db', showRms: true, showClipping: true, showSamples: false });
  });
  it('has one wheel owner, normalizes line input and accumulates a burst around the pointer', async () => {
    const scroll = tracksElement();
    const e = await event(scroll, 'wheel', { ctrlKey: true, clientX: 200, deltaY: -1, deltaMode: 1 });
    await event(scroll, 'wheel', { ctrlKey: true, clientX: 200, deltaY: -1, deltaMode: 1 });
    expect(e.defaultPrevented).toBe(true);
    await flush();
    const scale = state.waveforms.get('clip').pixelsPerMs;
    expect(scale).toBeCloseTo(0.1 * Math.exp(0.064), 10);
    expect(scroll.scrollLeft).toBeCloseTo(2000 * scale - 200, 8);
    expect(host.querySelector('.ruler-scrollbar-hidden').scrollLeft).toBeCloseTo(scroll.scrollLeft);
    const normal = await event(scroll, 'wheel', { deltaY: 20 });
    expect(normal.defaultPrevented).toBe(false);
  });
  it('preserves visible playhead screen position for keyboard zoom and exposes fit/sample actions', async () => {
    await event(window, 'keydown', { key: '+' });
    const scale = state.waveforms.get('clip').pixelsPerMs;
    expect(tracksElement().scrollLeft).toBeCloseTo(3000 * scale - 300);
    await clickText('Fit project (0)');
    expect(tracksElement().scrollLeft).toBe(0);
    await clickText('Zoom to samples');
    expect(host.querySelectorAll('[data-ruler-tick]').length).toBeLessThan(25);
    expect(Number(range().value)).toBeGreaterThan(0.8);
    expect(Number.parseFloat(tracksElement().firstElementChild.style.width)).toBeLessThanOrEqual(1000000);
    expect(Number.parseFloat(clipElement().style.width)).toBeLessThanOrEqual(1000000);
  });
  it('keeps an offscreen playhead out of manual zoom anchoring', async () => {
    await render({ currentTimeMs: 100000 });
    await event(window, 'keydown', { key: '+' });
    const scroll = tracksElement().scrollLeft;
    const duration = Number(range().getAttribute('aria-valuetext').split('s')[0]);
    expect(scroll).toBeGreaterThan(0);
    expect(scroll).toBeLessThan(2000);
    expect(duration).toBeGreaterThan(0);
  });
  it('fits selected clips and preserves their center', async () => {
    await event(clipElement(), 'click', { clientX: 50 });
    await clickText('Fit selected clips');
    const view = state.waveforms.get('clip');
    expect(view.pixelsPerMs).toBeCloseTo(800 / 1100);
    expect(view.viewportLeftPx).toBe(0);
  });
  it('maps source crops and release coordinates correctly after a deep-zoom rebase', async () => {
    current = project([makeTrack('track', [makeClip('clip', 0, 36_000_000)])]);
    await render({ currentTimeMs: 18_000_000 });
    await clickText('Fit project (0)');
    const previousPlayheadX = 18_000_000 * state.waveforms.get('clip').pixelsPerMs;
    await clickText('Zoom to samples');
    const view = state.waveforms.get('clip');
    expect(view.pixelsPerMs).toBe(48);
    expect(view.clipWidthPx).toBe(1e6);
    expect(view.cropStartMs).toBeGreaterThan(17_000_000);
    const pointerTime = view.cropStartMs + (view.viewportLeftPx + 400 - view.clipLeftPx) / view.pixelsPerMs;
    expect(pointerTime).toBeCloseTo(18_000_000 + (400 - previousPlayheadX) / 48, 5);
    const before = view.cropStartMs + view.viewportLeftPx / view.pixelsPerMs;
    await event(clipElement(), 'mousedown', { button: 0, clientX: 400, clientY: 30 });
    await event(tracksElement(), 'wheel', { shiftKey: true, deltaY: 48 });
    await event(window, 'mouseup', { clientX: 400, clientY: 30 });
    expect(current.tracks[0].clips[0].timelineStartMs).toBeCloseTo(1);
    expect(before).toBeGreaterThan(1e6);
  });
  it('mounts the current live recording inside REC with global geometry and source times', async () => {
    await render({ isRecording: true, selectedTrackId: 'track', currentTimeMs: 1800,
      recordingSegments: [{ startTimeMs: 0 }, { startTimeMs: 1000 }] });
    const recording = host.querySelector('[data-recording-waveform]');
    expect(recording.closest('[data-recording-overlay]').textContent).toContain('REC (2)');
    expect(state.recordings.at(-1)).toMatchObject({
      startTimeMs: 1000, endTimeMs: 1800, clipLeftPx: 100, clipWidthPx: 80,
      viewportLeftPx: 0, viewportWidthPx: 800, pixelsPerMs: 0.1,
    });
    expect(state.recordings.at(-1).height).toBeGreaterThan(0);
    expect(recording.parentElement.style.left).toBe('0px');
    await render({ isRecording: false });
    expect(host.querySelector('[data-recording-waveform]')).toBeNull();
  });
  it('keeps recording placement bounded inside a rebased clipped REC shell', async () => {
    current = project([makeTrack('track', [makeClip('clip', 0, 36_000_000)])]);
    await render({ currentTimeMs: 18_000_000 });
    await clickText('Fit project (0)');
    await clickText('Zoom to samples');
    await render({ isRecording: true, selectedTrackId: 'track',
      recordingSegments: [{ startTimeMs: 1000 }] });
    const view = state.recordings.at(-1);
    const recording = host.querySelector('[data-recording-waveform]');
    const shell = recording.closest('[data-recording-overlay]');
    expect(view).toMatchObject({ startTimeMs: 1000, endTimeMs: 18_000_000,
      clipLeftPx: 48000, clipWidthPx: (18_000_000 - 1000) * 48, pixelsPerMs: 48, viewportWidthPx: 800 });
    expect(view.viewportLeftPx).toBeGreaterThan(800_000_000);
    const origin = view.viewportLeftPx - tracksElement().scrollLeft;
    const skipped = origin - view.clipLeftPx;
    expect(skipped).toBeGreaterThan(0);
    expect(Number.parseFloat(recording.parentElement.style.left)).toBe(0);
    expect(view.clipOffsetPx).toBeCloseTo(skipped);
    expect(Number.parseFloat(shell.style.left)).toBe(0);
    expect(Number.parseFloat(shell.style.width)).toBeLessThanOrEqual(1e6);
    const canvas = getWaveformWindow(view);
    const screenLeft = Number.parseFloat(shell.style.left) + Number.parseFloat(recording.parentElement.style.left)
      + canvas.leftPx - view.clipOffsetPx - tracksElement().scrollLeft;
    expect(screenLeft).toBeCloseTo(-32);
    expect((canvas.leftPx + 32) / view.pixelsPerMs + view.startTimeMs).toBeCloseTo(view.viewportLeftPx / view.pixelsPerMs);
    await render({ selectedTrackId: 'not-recording-track' });
    expect(host.querySelector('[data-recording-waveform]')).toBeNull();
  });
  it('culls live recording surfaces outside the visible rows', async () => {
    const track = current.tracks[0];
    await render({ isRecording: true, selectedTrackId: track.id, recordingSegments: [{ startTimeMs: 0 }],
      rows: [{ kind: 'group', nodeId: 'spacer', height: 1000 }, { kind: 'track', trackId: track.id, track, height: 80 }] });
    expect(host.querySelector('[data-recording-overlay]')).not.toBeNull();
    expect(host.querySelector('[data-recording-waveform]')).toBeNull();
  });
  it('observes container-only resizing', async () => {
    width = 1200;
    await act(async () => observers.forEach((callback) => callback())); await flush();
    expect(state.waveforms.get('clip').viewportWidthPx).toBe(1200);
    expect(state.waveforms.get('clip').pixelsPerMs).toBe(0.15);
  });
  it('culls surfaces using the true shared vertical scroller and variable row offsets', async () => {
    current = project(Array.from({ length: 12 }, (_, i) => makeTrack(`track${i}`, [makeClip(`clip${i}`)])));
    const rows = current.tracks.map((track, i) => ({ kind: 'track', trackId: track.id, track, height: i === 0 ? 300 : 80 }));
    await render({ sharedVerticalScroll: true, rows, children: ({ header, tracks, zoomOverlay }) => <>{header}{zoomOverlay}<div data-shared-scroller style={{ overflowY: 'auto', height: 240 }}>{tracks}</div></> });
    const shared = host.querySelector('[data-shared-scroller]');
    expect(host.querySelector('[data-waveform="clip0"]')).not.toBeNull();
    expect(host.querySelector('[data-waveform="clip8"]')).toBeNull();
    shared.scrollTop = 800; await event(shared, 'scroll'); await flush();
    expect(host.querySelector('[data-waveform="clip0"]')).toBeNull();
    expect(host.querySelector('[data-waveform="clip8"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-clip-id]').length).toBe(12);
  });
  it('updates group activity from local drag previews without invalidating on playhead-only changes', async () => {
    current.trackTree = [{ id: 'g', kind: 'group', name: 'Group', parentId: null, order: 0 },
      { id: 'n', kind: 'track', trackId: 'track', parentId: 'g', order: 0 }];
    const rows = [{ kind: 'group', nodeId: 'g', height: 80 },
      { kind: 'track', trackId: 'track', track: current.tracks[0], height: 80 }];
    await render({ rows });
    const clips = state.groups.at(-1).clips;
    await render({ currentTimeMs: 3100 });
    expect(state.groups.at(-1).clips).toBe(clips);
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 110 });
    await event(window, 'mousemove', { clientX: 80, clientY: 110 }); await flush();
    expect(state.groups.at(-1).clips[0].startMs).toBeCloseTo(300);
    expect(props.updateProject).not.toHaveBeenCalled();
    await event(window, 'keydown', { key: 'Escape' });
  });
  it('uses one activity surface per group row with muted descendants excluded', async () => {
    current = project([makeTrack('a', [makeClip('a')]), { ...makeTrack('b', [makeClip('b')]), muted: true }]);
    current.trackTree = [{ id: 'g', kind: 'group', name: 'Group', parentId: null, order: 0, muted: true },
      { id: 'na', kind: 'track', trackId: 'a', parentId: 'g', order: 0 },
      { id: 'nb', kind: 'track', trackId: 'b', parentId: 'g', order: 1 }];
    await render({ rows: [{ kind: 'group', nodeId: 'g', height: 80 }] });
    expect(host.querySelectorAll('[data-group-waveform]').length).toBe(1);
    expect(host.querySelectorAll('[data-waveform]').length).toBe(0);
    expect(state.groups.at(-1).clips.map((clip) => clip.blobId)).toEqual(['a']);
  });
});

describe('Timeline gesture completion', () => {
  it('flushes the release coordinate without waiting for the queued rAF and commits once', async () => {
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    await event(window, 'mousemove', { clientX: 60, clientY: 30 });
    await event(window, 'mouseup', { clientX: 80, clientY: 30 });
    expect(props.updateProject).toHaveBeenCalledTimes(1);
    expect(current.tracks[0].clips[0].timelineStartMs).toBeCloseTo(300);
    expect(frames.size).toBe(0);
  });
  it('suppresses a no-op release', async () => {
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    await event(window, 'mouseup', { clientX: 50, clientY: 30 });
    expect(props.updateProject).not.toHaveBeenCalled();
  });
  it.each(['Escape', 'blur', 'pointercancel'])('cancels a pending drag on %s', async (type) => {
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    await event(window, 'mousemove', { clientX: 80, clientY: 30 });
    await event(window, type === 'Escape' ? 'keydown' : type, { key: type });
    await event(window, 'mouseup', { clientX: 90, clientY: 30 });
    expect(props.updateProject).not.toHaveBeenCalled();
  });
  it('cancels pending work on project switch', async () => {
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    await event(window, 'mousemove', { clientX: 80, clientY: 30 });
    current = { ...current, projectId: 'other' }; await render();
    await event(window, 'mouseup', { clientX: 90, clientY: 30 });
    expect(props.updateProject).not.toHaveBeenCalled();
  });
  it('revalidates a collision introduced after preview against current updater state', async () => {
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    current = { ...current, tracks: [{ ...current.tracks[0], clips: [...current.tracks[0].clips, makeClip('remote', 1100)] }] };
    await event(window, 'mouseup', { clientX: 80, clientY: 30 });
    expect(current.tracks[0].clips[0].timelineStartMs).toBe(0);
    expect(current.tracks[0].clips).toHaveLength(2);
  });
  it('aborts a gesture when media is replaced or permissions are revoked', async () => {
    state.cache.set('clip', { sampleRate: 48000 }); await publish();
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    state.cache.set('clip', { sampleRate: 48000 }); await publish();
    await event(window, 'mouseup', { clientX: 80, clientY: 30 });
    expect(props.updateProject).not.toHaveBeenCalled();
    await event(clipElement(), 'mousedown', { button: 0, clientX: 50, clientY: 30 });
    await render({ canEditTrack: () => false });
    await event(window, 'mouseup', { clientX: 80, clientY: 30 });
    expect(props.updateProject).not.toHaveBeenCalled();
  });
  it('flushes box selection at release before its animation frame', async () => {
    await event(tracksElement(), 'mousedown', { button: 0, clientX: 0, clientY: 0 });
    await event(window, 'mousemove', { clientX: 20, clientY: 20 });
    await event(window, 'mouseup', { clientX: 150, clientY: 70 });
    expect(clipElement().getAttribute('aria-pressed')).toBe('true');
    expect(props.updateProject).not.toHaveBeenCalled();
    await flush();
  });
  it('flushes lyric release coordinates even without pointermove', async () => {
    current.lyrics = { lines: [{ id: 'line', text: 'words', startMs: 0 }] };
    await render({ showLyricsLane: true, canEditLyrics: true, lyricsSyncActive: true });
    await event(host.querySelector('[data-lyric-line]'), 'pointerdown', { button: 0, clientX: 50 });
    await event(window, 'pointerup', { clientX: 60 });
    expect(current.lyrics.lines[0].startMs).toBe(100);
    expect(props.updateProject).toHaveBeenCalledTimes(1);
  });
  it('uses final release coordinates for loop creation, moving and crossing a marker', async () => {
    current = project([makeTrack('track', [makeClip('clip', 0, 5000)])]);
    await render();
    const ruler = host.querySelector('.ruler-scrollbar-hidden > div');
    await event(ruler, 'mousedown', { button: 0, clientX: 100 });
    await event(window, 'mouseup', { clientX: 200 });
    expect(current.loop).toMatchObject({ startMs: 1000, endMs: 2000 });
    await render();
    await event(ruler, 'mousedown', { button: 0, clientX: 150 });
    await event(window, 'mouseup', { clientX: 250 });
    expect(current.loop).toMatchObject({ startMs: 2000, endMs: 3000 });
    await render();
    await event(host.querySelector('[data-loop-marker="start"]'), 'mousedown', { button: 0, clientX: 200 });
    await event(window, 'mouseup', { clientX: 400 });
    expect(current.loop).toMatchObject({ startMs: 3000, endMs: 4000 });
  });
  it('keeps both loop drag preview markers local after rebasing', async () => {
    current = project([makeTrack('track', [makeClip('clip', 0, 36_000_000)])]);
    await render({ currentTimeMs: 18_000_000 });
    await clickText('Fit project (0)');
    await clickText('Zoom to samples');
    const ruler = host.querySelector('.ruler-scrollbar-hidden > div');
    await event(ruler, 'mousedown', { button: 0, clientX: 100 });
    await event(window, 'mousemove', { clientX: 120 });
    await event(window, 'mousemove', { clientX: 300 });
    const markers = [...ruler.children].filter((node) => node.classList.contains('bg-yellow-500')
      && node.classList.contains('pointer-events-none'));
    expect(markers).toHaveLength(2);
    const left = host.querySelector('.ruler-scrollbar-hidden').scrollLeft;
    expect(Number.parseFloat(markers[0].style.left)).toBeCloseTo(left + 100);
    expect(Number.parseFloat(markers[1].style.left)).toBeCloseTo(left + 300);
    expect(Number.parseFloat(markers[1].style.left)).toBeLessThan(Number.parseFloat(ruler.style.width));
    await event(window, 'keydown', { key: 'Escape' });
  });
  it('allows gain, mute and move edits of an existing short split fragment', async () => {
    current = project([makeTrack('track', [makeClip('clip', 0, 50)])]);
    await render({ advancedMixLocked: true });
    await event(clipElement(), 'mousedown', { button: 2, clientX: 2, clientY: 30 });
    await event(window, 'mouseup', { button: 2, clientX: 2, clientY: 30 });
    expect(current.tracks[0].clips[0].muted).toBe(true);
    await render();
    await event(clipElement(), 'mousedown', { button: 2, clientX: 2, clientY: 30 });
    await event(window, 'mouseup', { button: 2, clientX: 2, clientY: -50 });
    expect(current.tracks[0].clips[0].gainDb).not.toBe(0);
    await render({ advancedMixLocked: false });
    await event(clipElement(), 'keydown', { key: 'ArrowRight' });
    expect(current.tracks[0].clips[0].timelineStartMs).toBe(1);
    expect(current.tracks[0].clips[0].cropEndMs - current.tracks[0].clips[0].cropStartMs).toBe(50);
    expect(props.updateProject).toHaveBeenCalledTimes(3);
  });
  it('provides keyboard clip movement and trim without bubbling into track navigation', async () => {
    await event(clipElement(), 'keydown', { key: 'ArrowRight' });
    expect(current.tracks[0].clips[0].timelineStartMs).toBe(1); await render();
    await event(clipElement(), 'keydown', { key: 'ArrowRight', altKey: true });
    expect(current.tracks[0].clips[0].cropStartMs).toBe(1);
    expect(current.tracks[0].clips[0].timelineStartMs).toBe(2);
  });
});
