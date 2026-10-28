import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Timeline from '../src/components/Timeline';
import { audioManager } from '../src/lib/audioManager';
import { waveformService } from '../src/lib/waveformService';
import { waveformScheduler } from '../src/lib/waveformScheduler';
import { waveformRasterBudget } from '../src/lib/waveformRenderer';
import { getVisibleTimelineRows } from '../src/utils/trackTree';
import { createFixtureBuffers, createFixtureProject, describeFixture } from './waveformFixtures';
import '../src/index.css';

const host = document.getElementById('benchmark-host');
const status = document.getElementById('benchmark-status');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
const stats = () => ({ service: waveformService.getStats(), raster: waveformRasterBudget.getStats(), scheduler: waveformScheduler.getStats() });
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: values.length, min: sorted[0] ?? null, median: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null };
};
async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  throw Error(`Timed out after ${timeoutMs}ms: ${label}`);
}
const scroll = () => host.querySelector('[data-timeline-scroll]');
const zoom = () => host.querySelector('input[aria-label="Timeline zoom"]');
function button(text) {
  const element = [...host.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
  if (!element) throw Error(`Timeline action not found: ${text}`);
  element.click();
}
function setZoom(value) {
  const element = zoom();
  if (!element) throw Error('Timeline zoom range not mounted');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
async function settled() {
  await frame(); await frame();
  await waitFor(() => {
    const scheduler = waveformScheduler.getStats();
    return !scheduler.pending && !scheduler.framePending
      && !host.querySelector('[data-waveform-status="loading"]');
  }, 'visible waveforms and scheduler settle');
  await frame();
}

// Pixel reads happen only after settling, never inside the measured gesture loop.
function visualSnapshot(label) {
  const viewport = scroll().getBoundingClientRect();
  const canvases = [...host.querySelectorAll('canvas')].filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return canvas.width && canvas.height && rect.right > viewport.left && rect.left < viewport.right
      && rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  const measurements = canvases.map((canvas) => {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let nonzero = 0; let waveformPixels = 0; let topLanePixels = 0; let bottomLanePixels = 0;
    const quarterPixels = [0, 0, 0, 0];
    // The blue-gray zero line (148,163,184) must not count as blue waveform ink.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]) nonzero += 1;
      if (data[i + 3] && (data[i + 2] > data[i] + 60 || data[i] > data[i + 2] + 40)) {
        waveformPixels += 1;
        quarterPixels[Math.min(3, Math.floor(i / 4 / canvas.width / canvas.height * 4))] += 1;
        if (i / 4 / canvas.width < canvas.height / 2) topLanePixels += 1;
        else bottomLanePixels += 1;
      }
    }
    const rect = canvas.getBoundingClientRect();
    return {
      clipId: canvas.closest('[data-clip-id]')?.dataset.clipId ?? null,
      group: canvas.parentElement.getAttribute('aria-label')?.startsWith('Group activity'),
      width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height,
      effectiveDpr: canvas.width / rect.width, nonzero, waveformPixels, topLanePixels, bottomLanePixels, quarterPixels,
      boundedWidth: rect.width <= viewport.width + 66 && canvas.width <= 16384,
    };
  });
  return {
    label, viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio,
    visibleCanvases: measurements.length, inkCanvases: measurements.filter((item) => item.waveformPixels > 2).length,
    groupInkCanvases: measurements.filter((item) => item.group && item.waveformPixels > 2).length,
    canvasBackingBytes: [...host.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
    documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    geometryBounded: measurements.every((item) => item.boundedWidth && Number.isFinite(item.cssWidth + item.cssHeight)),
    measurements,
  };
}

let root; let context; let unsubscribe; let longTaskObserver; let restoreInstrumentation; let resourceSampler;
const errors = [];
window.addEventListener('error', (event) => errors.push({ kind: 'error', message: event.message }));
window.addEventListener('unhandledrejection', (event) => errors.push({ kind: 'unhandledrejection', message: String(event.reason?.stack || event.reason) }));
const api = window.__waveformBenchmark = { state: 'ready', progress: 'ready', result: null };
async function dispose() {
  if (root) { flushSync(() => root.unmount()); root = null; }
  unsubscribe?.(); unsubscribe = null;
  longTaskObserver?.disconnect(); clearInterval(resourceSampler);
  restoreInstrumentation?.(); restoreInstrumentation = null;
  audioManager.mediaCache.clear();
  if (context && context.state !== 'closed') await context.close();
  context = null;
}
api.dispose = dispose;
api.run = async ({ fixture: name = 'quick', coldTimeoutMs = 60000 } = {}) => {
  if (api.state !== 'ready') throw Error('This page runs once; use a fresh browser profile for another cold run');
  api.state = 'running';
  const result = api.result = {
    schemaVersion: 1, startedAt: new Date().toISOString(), fixture: describeFixture(name),
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
      physicalRefreshRateHz: null, refreshRateNote: 'Headless rAF cadence is measured below, not a physical 60/120 Hz display claim.' },
    checks: [], visual: [], lifecycle: [], errors, longTasks: [],
    limitations: ['Synthetic dispatched events are untrusted; wheel default scrolling is simulated explicitly.',
      'No audio playback, capture, undo/autosave, persistent-summary reload, GPU memory, or physical-display refresh assertion.',
      'Long-task attribution is not inferred from timing overlap; use a browser performance trace to attribute waveform work.',
      'Scheduler-job timing includes shared geometry/observer work; browser paint/compositor cost is in total frame intervals, not isolated draw timings.',
      'First visual response measures a real waveform Canvas fill/stroke submission after input, not presentation on a physical display.',
      '20 cycles check owned raster/scheduler/pin/listener resources, not browser heap garbage collection.'],
  };
  const check = (name, passed, detail) => result.checks.push({ name, passed: Boolean(passed), detail });
  const stage = (name) => {
    api.progress = status.textContent = name;
    performance.mark(`waveform-benchmark: ${name}`);
  };
  result.observedResourcePeaks = { sampleCount: 0, sampleIntervalMs: 100, queueDepth: 0, activeJobs: 0,
    serviceAccountedBytes: 0, stagingBytes: 0, rasterBytes: 0, jsHeapUsedBytes: null,
    caveat: 'Periodic observations, not exact peak process/GPU memory. Playback-owned PCM size is separately calculated from real AudioBuffer metadata.' };
  resourceSampler = setInterval(() => {
    const current = stats(); const peaks = result.observedResourcePeaks;
    peaks.sampleCount += 1;
    for (const [key, value] of Object.entries({ queueDepth: current.service.queueDepth, activeJobs: current.service.activeJobs,
      serviceAccountedBytes: current.service.accountedBytes, stagingBytes: current.service.stagingBytes, rasterBytes: current.raster.bytes })) {
      peaks[key] = Math.max(peaks[key], value);
    }
    if (performance.memory) peaks.jsHeapUsedBytes = Math.max(peaks.jsHeapUsedBytes || 0, performance.memory.usedJSHeapSize);
  }, 100);
  const started = performance.now();
  let phase = 'setup';
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) result.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name,
          attribution: entry.attribution?.map((item) => ({ name: item.name, containerType: item.containerType, containerSrc: item.containerSrc })) });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
    stage('generating real AudioBuffers');
    context = new AudioContext({ sampleRate: 48000 });
    const buffers = await createFixtureBuffers(context, result.fixture);
    result.fixtureCreationMs = performance.now() - started;
    let project = createFixtureProject(result.fixture);
    let render;
    const mount = () => {
      root = createRoot(host);
      render = () => flushSync(() => root.render(<Timeline project={project} rows={getVisibleTimelineRows(project)}
        currentTimeMs={0} isPlaying={false} isRecording={false} recordingSegments={[]} shortcutsEnabled
        onSeek={() => {}} updateProject={(update) => { project = typeof update === 'function' ? update(project) : update; render(); }} />));
      render();
    };
    const coldStart = performance.now();
    const inserted = new Map();
    result.coldSources = [];
    unsubscribe = waveformService.subscribe((event) => {
      if (event.type !== 'ready') return;
      for (const id of event.blobIds) {
        if (!inserted.has(id) || result.coldSources.some((source) => source.id === id)) continue;
        result.coldSources.push({ id, readyAfterCacheSetMs: performance.now() - inserted.get(id),
          stats: waveformService.getSourceStats(id, buffers.get(id)) });
      }
    });
    stage('cold worker extraction (bounded)'); phase = 'cold';
    for (const [id, buffer] of buffers) { inserted.set(id, performance.now()); audioManager.mediaCache.set(id, buffer); }
    mount();
    await waitFor(() => {
      for (const [id, buffer] of buffers) {
        const source = waveformService.getSource(id, buffer);
        if (source?.status === 'error') throw Error(`Cold source ${id}: ${source.error?.message}`);
        if (source?.status !== 'ready') return false;
      }
      return true;
    }, 'all real source jobs complete', Math.min(60000, coldTimeoutMs));
    await settled();
    if (scroll().clientHeight < 1) throw Error('Benchmark Timeline viewport has no height; raster and timing measurements would be invalid');
    result.coldReadyMs = performance.now() - coldStart;
    result.coldReadyDistributionMs = summary(result.coldSources.map((source) => source.readyAfterCacheSetMs));
    result.afterCold = stats();
    check('all cold source completions observed', result.coldSources.length === buffers.size, result.coldSources.length);
    check('one extraction per unique real source / worker used', result.afterCold.service.jobsStarted === buffers.size
      && result.afterCold.service.jobsCompleted === buffers.size && result.afterCold.service.fallbackJobs === 0, result.afterCold.service);
    check('PCM remains attached', [...buffers.values()].every((buffer) => buffer.getChannelData(0).length === buffer.length));
    unsubscribe(); unsubscribe = null;
    const initial = visualSnapshot('cold settled overview'); result.visual.push(initial);
    check('visible waveform ink exceeds zero-line baseline', initial.inkCanvases > 0, initial.inkCanvases);
    check('group activity contains waveform ink', initial.groupInkCanvases > 0, initial.groupInkCanvases);
    check('stereo lanes both contain ink', initial.measurements.some((item) => !item.group && item.topLanePixels > 2 && item.bottomLanePixels > 2));
    check('DPR 2 raster is exercised', initial.devicePixelRatio === 2 && initial.measurements.some((item) => Math.abs(item.effectiveDpr - 2) < 0.05));
        if (name === 'medium') check('at least 12 rows visible', initial.viewport.height >= 1200, initial.viewport);

    stage('idle rAF baseline'); phase = 'idle';
    const idle = []; let previous = await frame();
    for (let i = 0; i < 60; i += 1) { const now = await frame(); idle.push(now - previous); previous = now; }
    result.idleFrameIntervalMs = summary(idle);
    result.idleFrameIntervalsMs = idle;

    // Wrap the existing scheduling entry point without replacing the actual scheduler or renderer.
    let measuredJobMs = 0; const jobFrameMs = []; const responses = []; let awaitingInput;
    const originalSchedule = waveformScheduler.schedule;
    waveformScheduler.schedule = function (key, draw, options) {
      return originalSchedule.call(this, key, (budget) => {
        const start = performance.now();
        try { return draw(budget); } finally { measuredJobMs += performance.now() - start; }
      }, options);
    };
    const prototypes = CanvasRenderingContext2D.prototype;
    const originals = new Map();
    for (const method of ['fillRect', 'stroke', 'fill']) {
      const original = prototypes[method]; originals.set(method, original);
      prototypes[method] = function (...args) {
        const output = original.apply(this, args);
        // Exclude the renderer's neutral zero line and clears/placeholders.
        if (awaitingInput && !awaitingInput.submissionMs && host.contains(this.canvas) && (method === 'stroke' || method === 'fill' || this.fillStyle !== 'rgba(148, 163, 184, 0.35)')) {
          awaitingInput.submissionMs = performance.now();
        }
        return output;
      };
    }
    restoreInstrumentation = () => {
      waveformScheduler.schedule = originalSchedule;
      for (const [method, original] of originals) prototypes[method] = original;
    };
    const input = (kind, dispatch) => {
      if (awaitingInput) responses.push({ ...awaitingInput, responseMs: null, reason: 'superseded before observed frame' });
      awaitingInput = { kind, inputAt: performance.now() }; dispatch();
    };
    const warmBefore = stats(); const intervals = [];
    result.interactionWindow = { start: performance.now(), end: null };
    phase = 'warm'; stage('warm scroll / slider / modifier-wheel');
    setZoom(0.2); await settled();
    previous = await frame(); measuredJobMs = 0;
    for (let i = 0; i < 180; i += 1) {
      const now = await frame(); intervals.push(now - previous); previous = now;
      jobFrameMs.push(measuredJobMs); measuredJobMs = 0;
      if (awaitingInput?.submissionMs) {
        responses.push({ ...awaitingInput, responseMs: now - awaitingInput.inputAt }); awaitingInput = null;
      }
      if (i % 10 !== 0) continue;
      const target = scroll(); const rect = target.getBoundingClientRect();
      if (i % 30 === 0) input('native-range-input/change', () => setZoom(0.18 + (i % 60) / 300));
      else if (i % 30 === 10) input('ctrl-wheel', () => {
        target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          deltaY: i % 20 ? -35 : 35, deltaMode: 0, clientX: rect.left + rect.width * 0.4, clientY: rect.top + 60 }));
      });
      else input('horizontal/vertical-scroll', () => {
        target.scrollLeft = (i % 60) / 60 * Math.min(1500, target.scrollWidth - target.clientWidth);
        target.scrollTop = (i % 40) / 40 * Math.min(1000, target.scrollHeight - target.clientHeight);
        target.dispatchEvent(new Event('scroll', { bubbles: false }));
      });
    }
    await settled();
    if (awaitingInput) responses.push({ ...awaitingInput, responseMs: awaitingInput.submissionMs ? performance.now() - awaitingInput.inputAt : null });
    result.interactionWindow.end = performance.now();
    result.warmFrameIntervalMs = summary(intervals); result.warmFrameIntervalsMs = intervals;
    result.schedulerJobTimePerObservedFrameMs = summary(jobFrameMs); result.schedulerJobFrameSamplesMs = jobFrameMs;
    result.inputResponses = responses;
    result.inputToWaveformSubmissionFrameMs = summary(responses.map((item) => item.responseMs).filter(Number.isFinite));
        check('input response measurements include actual waveform submissions', result.inputToWaveformSubmissionFrameMs.count >= 10,
          { observed: result.inputToWaveformSubmissionFrameMs.count, dispatched: responses.length, missing: responses.filter((item) => item.responseMs === null).length });
    result.framesOver16_7Ms = intervals.filter((ms) => ms > 16.7).length;
    result.estimatedMissedIdleCadenceFrames = intervals.reduce((sum, ms) => sum + Math.max(0, Math.round(ms / result.idleFrameIntervalMs.median) - 1), 0);
    result.afterWarm = stats();
    check('warm gestures do not extract or copy full PCM', result.afterWarm.service.jobsStarted === warmBefore.service.jobsStarted
      && result.afterWarm.service.samplesScanned === warmBefore.service.samplesScanned
      && result.afterWarm.service.chunksCopied === warmBefore.service.chunksCopied);
    restoreInstrumentation(); restoreInstrumentation = null;

    stage('isolated zoom inputs to scheduler-idle refinement');
    result.refinementSamplesMs = [];
    for (let i = 0; i < 10; i += 1) {
      const inputAt = performance.now();
      setZoom(i % 2 ? 0.16 : 0.2);
      await settled();
      result.refinementSamplesMs.push(performance.now() - inputAt);
    }
    result.inputToSettledRefinementMs = summary(result.refinementSamplesMs);
    result.refinementCaveat = 'Conservative input-to-scheduler-idle/ready proxy, including React updates and settle-check rAF/poll overhead. Not measured physical presentation or a precision gesture-end timestamp.';

    stage('sample zoom, source crop, DPR 2 and container-only resize'); phase = 'visual';
    const overviewProject = project;
    if (name === 'reference') {
      // A real cropped source window: constant +0.3 left / -0.3 right,
      // excluding all of the deliberately over-range early boundary impulses.
      const stereo = result.fixture.sources.find((source) => source.channels === 2);
      project = { ...project, trackTree: [], tracks: [{ ...project.tracks[0], clips: [{
        ...project.tracks[0].clips[0], blobId: stereo.id, timelineStartMs: 0,
        cropStartMs: 130, cropEndMs: 190, sourceDurationMs: stereo.length / stereo.sampleRate * 1000,
      }] }] };
      render();
    }
    scroll().scrollTop = 0; scroll().dispatchEvent(new Event('scroll'));
    button('Fit project (0)'); await settled();
    button('Zoom to samples'); await settled();
    const sampleView = visualSnapshot(name === 'reference' ? 'sample zoom; signed DC stereo crop [130,190)ms' : 'sample zoom; 256-sample crop; inverted stereo'); result.visual.push(sampleView);
    check('sample zoom has real waveform ink', sampleView.inkCanvases > 0, sampleView.inkCanvases);
    check('sample zoom canvas width remains viewport bounded', sampleView.geometryBounded, sampleView.measurements);
        if (name === 'reference') {
          check('signed stereo DC crop renders left above / right below their zero lines; excluded impulses do not bleed',
            sampleView.measurements.some((item) => !item.group && item.quarterPixels[0] > 10 && item.quarterPixels[3] > 10
              && item.quarterPixels[1] === 0 && item.quarterPixels[2] === 0), sampleView.measurements);
        }
    if (name === 'stress') {
      const longClip = host.querySelector('[data-clip-id="clip-0"]');
      check('two-hour metadata clip retained at sample zoom without fake PCM', longClip && !audioManager.mediaCache.has(result.fixture.longSource.id), {
        shellWidth: longClip?.getBoundingClientRect().width, sourceDurationMs: 7200000, fullPCM: false,
        caveat: 'Geometry/missing-media check only, not two-hour extraction or long-source raster fidelity.',
      });
    }
    host.style.width = '1080px'; await settled();
    const resized = visualSnapshot('container-only resize to 1080 CSS px'); result.visual.push(resized);
    check('container ResizeObserver updates viewport without window resize', Math.abs(resized.viewport.width - 1080) <= 2, resized.viewport);
    host.style.width = '100%';
        project = overviewProject; render(); button('Fit project (0)'); await settled();

    stage('20 Timeline mount / unmount resource cycles'); phase = 'lifecycle';
    flushSync(() => root.unmount()); root = null; await frame(); await frame();
    const cleanBaseline = stats(); result.cleanupBaseline = cleanBaseline;
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      mount(); await settled();
      const mounted = stats();
      flushSync(() => root.unmount()); root = null; await frame(); await frame();
      result.lifecycle.push({ cycle, mounted, unmounted: stats() });
    }
    check('all 20 mounts exercise real raster surfaces and source pins', result.lifecycle.every(({ mounted }) =>
      mounted.raster.bytes > 0 && mounted.raster.surfaces > 0 && mounted.service.pins > 0));
    check('all 20 unmounts release raster surfaces / scheduled jobs / pins / view listeners', result.lifecycle.every(({ unmounted }) =>
      unmounted.raster.bytes === 0 && unmounted.raster.surfaces === 0 && unmounted.scheduler.pending === 0
      && !unmounted.scheduler.framePending && unmounted.service.pins === 0 && unmounted.service.listeners === cleanBaseline.service.listeners), result.lifecycle.at(-1));
    mount(); await settled();
    result.visual.push(visualSnapshot('final settled screenshot view'));
    result.finalStats = stats();
    check('all canvas geometry bounded and no document overflow', result.visual.every((view) => view.geometryBounded && !view.documentOverflow));
    check('raster / summary / staging byte budgets respected', result.finalStats.raster.bytes <= result.finalStats.raster.maxBytes
      && result.finalStats.service.accountedBytes <= result.finalStats.service.maxResidentBytes
      && result.finalStats.service.stagingBytes <= result.finalStats.service.maxStagingBytes, result.finalStats);
    check('service jobs complete with no queued/deferred sources', result.finalStats.service.activeJobs === 0
          && result.finalStats.service.queueDepth === 0 && result.finalStats.service.deferredSources === 0, result.finalStats.service);
        check('no scheduler errors or worker failures', result.finalStats.scheduler.errors === 0 && result.finalStats.service.workerFailures === 0);
    await pause(50); // Flush PerformanceObserver delivery before classifying long tasks.
    result.interactionLongTasks = result.longTasks.filter((task) => task.startTime < result.interactionWindow.end
      && task.startTime + task.duration > result.interactionWindow.start);
    result.waveformAttributableLongTasks = { count: null, reason: 'Long Tasks API does not attribute JavaScript stacks; inspect a browser trace. All overlapping interaction tasks are recorded, not claimed waveform-free.' };
    result.budgets = {
      warmFrameP95At60Hz: { targetMs: 16.7, observedMs: result.warmFrameIntervalMs.p95 },
      schedulerJobP95: { targetMs: 4, observedMs: result.schedulerJobTimePerObservedFrameMs.p95 },
      inputResponseP95: { targetMs: 33, observedMs: result.inputToWaveformSubmissionFrameMs.p95 },
      settledRefinementP95: { targetMs: 100, observedMs: result.inputToSettledRefinementMs.p95, caveat: result.refinementCaveat },
      coldThreeMinuteStereo: { targetMs: 2000, applicable: name === 'medium', observedMs: name === 'medium' ? result.coldReadyDistributionMs.p95 : null,
        caveat: 'Cache-set to ready includes serial worker queue wait, not isolated worker CPU time.' },
      interactionLongTasks: { targetCount: 0, observedCount: result.interactionLongTasks.length, attribution: 'unattributed' },
    };
    check('no uncaught browser errors', errors.length === 0, errors);
    result.passed = result.checks.every((item) => item.passed);
    api.state = 'done'; stage(result.passed ? 'complete' : 'complete with failed checks');
  } catch (error) {
    result.failure = { phase, message: String(error.stack || error), stats: stats() };
    result.passed = false; api.state = 'failed'; stage(`failed in ${phase}`);
  } finally {
    result.elapsedMs = performance.now() - started;
    result.finishedAt = new Date().toISOString();
    longTaskObserver?.disconnect(); clearInterval(resourceSampler);
    unsubscribe?.(); unsubscribe = null;
    restoreInstrumentation?.(); restoreInstrumentation = null;
  }
  return result;
};
