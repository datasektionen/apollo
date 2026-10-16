import { describe, expect, it } from 'vitest';
import {
  coarseSearchBoundsMs,
  createLogSweep,
  createSweepTrain,
  estimateDelaySamples,
  estimateRoundTrip,
  failureForEstimation,
  formatOutputLatencyLog,
  foldDelaySamples,
  getSweepOffsetsSamples,
  refineSearchHalfWindowMs,
  WIDE_MAX_COUNT,
  WIDE_MAX_SIGMA_MS,
  WIDE_MIN_COUNT,
  calibrationSchedule,
  calibrationScheduleForDevices,
  wideSampleTarget,
} from '../recordingLatencyCalibration';

const SAMPLE_RATE = 48000;

function seededNoise(length, amplitude, seed = 1) {
  let state = seed;
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    noise[i] = ((state / 4294967296) * 2 - 1) * amplitude;
  }
  return noise;
}

function placeSweep(capture, sweep, at, gain) {
  for (let i = 0; i < sweep.length; i += 1) {
    const index = at + i;
    if (index >= 0 && index < capture.length) capture[index] += sweep[i] * gain;
  }
}

/** One-pole lowpass, the sort of dulling a headphone-to-mic path applies. */
function lowpass(samples, keep = 0.7) {
  const filtered = new Float32Array(samples.length);
  let state = 0;
  for (let i = 0; i < samples.length; i += 1) {
    state = state * (1 - keep) + samples[i] * keep;
    filtered[i] = state;
  }
  return filtered;
}

function roundTrip(capture, sweep, offsets, lead) {
  return estimateRoundTrip({
    capture,
    sampleRate: SAMPLE_RATE,
    sweep,
    sweepOffsetsInCapture: offsets.map((offset) => lead + offset),
    maxLagSamples: Math.round(0.6 * SAMPLE_RATE),
  });
}

describe('recording latency calibration', () => {
  const sweep = createLogSweep(SAMPLE_RATE);
  const offsets = getSweepOffsetsSamples(SAMPLE_RATE);

  it('recovers a known delay from one sweep to a fraction of a sample', () => {
    const delay = 3123;
    const lead = 500;
    const capture = new Float32Array(lead + delay + sweep.length + 1000);
    placeSweep(capture, sweep, lead + delay, 1);

    const estimate = estimateDelaySamples(capture, sweep, {
      expectedOffset: lead,
      maxLag: Math.round(0.6 * SAMPLE_RATE),
    });

    expect(estimate.confident).toBe(true);
    expect(Math.abs(estimate.lag - delay)).toBeLessThan(0.5);
  });

  it('medians several sweeps into one delay in noise', () => {
    const delay = Math.round(0.0634 * SAMPLE_RATE);
    const lead = 2400;
    const train = createSweepTrain(sweep, offsets);
    const length = lead + delay + train.length + Math.round(0.6 * SAMPLE_RATE);
    let capture = seededNoise(length, 0.02, 3);
    placeSweep(capture, train, lead + delay, 0.25);
    capture = lowpass(capture, 0.7);

    const result = roundTrip(capture, sweep, offsets, lead);

    expect(result.status).toBe('ok');
    expect(result.validCount).toBe(offsets.length);
    expect(Math.abs(result.roundTripMs - 63.4)).toBeLessThan(0.5);
    expect(result.spreadMs).toBeLessThan(1);
  });

  it('follows the direct sound when a later echo is louder', () => {
    const delay = Math.round(0.05 * SAMPLE_RATE);
    const echo = Math.round(0.04 * SAMPLE_RATE);
    const lead = 2000;
    const train = createSweepTrain(sweep, offsets);
    const length = lead + delay + echo + train.length + Math.round(0.6 * SAMPLE_RATE);
    const capture = seededNoise(length, 0.005, 5);
    placeSweep(capture, train, lead + delay, 0.2);
    placeSweep(capture, train, lead + delay + echo, 0.55);

    const result = roundTrip(capture, sweep, offsets, lead);

    expect(result.status).toBe('ok');
    expect(Math.abs(result.roundTripMs - (delay / SAMPLE_RATE) * 1000)).toBeLessThan(1);
  });

  it('treats a silent room as no signal, even though random matches disagree by hundreds of ms', () => {
    const lead = 1000;
    const train = createSweepTrain(sweep, offsets);
    const capture = seededNoise(lead + train.length + Math.round(0.6 * SAMPLE_RATE), 0.05, 7);

    const result = roundTrip(capture, sweep, offsets, lead);

    expect(result.status).toBe('no-signal');
    expect(result.validCount).toBeLessThan(3);
    const failure = failureForEstimation(result);
    expect(failure.code).toBe('no-signal');
    expect(failure.message).not.toMatch(/varied/i);
  });

  it('reports a real disagreement when the sweeps were heard at different times', () => {
    const lead = 2000;
    const trainLength = offsets[offsets.length - 1] + sweep.length;
    const capture = new Float32Array(lead + trainLength + Math.round(0.6 * SAMPLE_RATE));
    offsets.forEach((offset, index) => {
      const delay = Math.round((index < 2 ? 0.03 : 0.09) * SAMPLE_RATE);
      placeSweep(capture, sweep, lead + offset + delay, 0.5);
    });

    const result = roundTrip(capture, sweep, offsets, lead);
    const failure = failureForEstimation(result);

    expect(result.status).toBe('inconsistent');
    expect(failure.code).toBe('inconsistent');
    expect(failure.message).toMatch(/disagreed by \d+ ms/);
  });

  it('still finds a sweep after the path has heavily colored it', () => {
    const delay = Math.round(0.08 * SAMPLE_RATE);
    const lead = 1500;
    const dry = new Float32Array(lead + delay + sweep.length + Math.round(0.6 * SAMPLE_RATE));
    placeSweep(dry, sweep, lead + delay, 0.8);
    // A long smoother stands in for a small speaker and microphone: the
    // recorded shape no longer matches the sweep, but the timing is unchanged.
    const capture = new Float32Array(dry.length);
    let state = 0;
    for (let i = 0; i < dry.length; i += 1) {
      state = state * 0.97 + dry[i] * 0.03;
      capture[i] = state;
    }

    const estimate = estimateDelaySamples(capture, sweep, {
      expectedOffset: lead,
      maxLag: Math.round(0.6 * SAMPLE_RATE),
    });

    expect(estimate.confident).toBe(true);
    expect(Math.abs(estimate.lag - delay)).toBeLessThan(SAMPLE_RATE * 0.005);
  });
});

describe('adaptive round-trip reduction', () => {
  it('prints outputLatency even when the browser has no figure', () => {
    expect(formatOutputLatencyLog(42.06, 10)).toBe('outputLatency: 42.1 ms (baseLatency: 10.0 ms)');
    expect(formatOutputLatencyLog(null, null)).toBe('outputLatency: unavailable (baseLatency: unavailable)');
  });

  it('does not treat the output-latency hint as a hard minimum', () => {
    const trusted = coarseSearchBoundsMs({ outputLatencyMs: 90, baseLatencyMs: 20 });
    expect(trusted.reliable).toBe(true);
    expect(trusted.minMs).toBeLessThan(90);
    expect(trusted.maxMs).toBeGreaterThan(90);
    expect(trusted.maxMs).toBeLessThan(400);

    const wireless = coarseSearchBoundsMs({ outputLatencyMs: 90, baseLatencyMs: 20, wireless: true });
    expect(wireless.reliable).toBe(true);
    expect(wireless.maxMs).toBeGreaterThan(trusted.maxMs);
    expect(wireless.maxMs).toBeLessThan(1200);

    // A hint smaller than the context buffer is not believable, so the search
    // starts at zero and covers the long-delay range.
    const bogus = coarseSearchBoundsMs({ outputLatencyMs: 8, baseLatencyMs: 40 });
    expect(bogus.reliable).toBe(false);
    expect(bogus.minMs).toBe(0);
    expect(bogus.maxMs).toBeGreaterThanOrEqual(1200);

    const missing = coarseSearchBoundsMs({});
    expect(missing.minMs).toBe(0);
  });

  it('settles on the median of the agreeing sweeps and ignores one echo', () => {
    const sweeps = [41.0, 41.4, 41.1, 41.2, 78.0, 41.3];
    const folded = foldDelaySamples(sweeps);
    expect(folded.status).toBe('certain');
    expect(folded.count).toBe(5);
    expect(Math.abs(folded.roundTripMs - 41.2)).toBeLessThan(0.2);
    expect(folded.spreadMs).toBeLessThan(1);
    // Tight fit keeps the median, including when it is not the mean.
    expect(foldDelaySamples([41, 41, 41, 41, 42]).roundTripMs).toBe(41);

    expect(foldDelaySamples([40]).status).toBe('approximate');
    expect(foldDelaySamples([]).status).toBe('none');
  });

  it('does not treat a late plateau in a drifting run as a tight fit', () => {
    const drifting = [];
    for (let index = 0; index < 40; index += 1) drifting.push(640 - index * 2);
    for (let index = 0; index < 15; index += 1) drifting.push(565 + index * 0.07);
    const folded = foldDelaySamples(drifting, { minCount: 7, wideFloor: 7 });
    expect(folded.tightCount).toBeGreaterThanOrEqual(15);
    expect(folded.status).not.toBe('certain');
  });

  it('uses three close sweeps when fully wired and seven when anything is wireless', () => {
    expect(calibrationSchedule({ wireless: false })).toMatchObject({ tightCount: 3, wideFloor: 3 });
    expect(calibrationSchedule({ wireless: true })).toMatchObject({ tightCount: 7, wideFloor: 7 });

    const wired = calibrationScheduleForDevices({
      bluetooth: false,
      input: { label: 'MacBook Pro Microphone' },
      output: { label: 'External Headphones' },
    });
    expect(wired.wireless).toBe(false);
    expect(wired.tightCount).toBe(3);

    const earbuds = calibrationScheduleForDevices({
      bluetooth: true,
      input: { label: 'MacBook Pro Microphone' },
      output: { label: 'Earbuds' },
    });
    expect(earbuds.wireless).toBe(true);
    expect(earbuds.tightCount).toBe(7);

    const hidden = calibrationScheduleForDevices({
      bluetooth: false,
      input: { label: '' },
      output: { label: '' },
    });
    expect(hidden.wireless).toBe(true);

    const close = [41, 41.2, 41.1];
    const early = foldDelaySamples(close, { minCount: 3, wideFloor: 3 });
    expect(early.status).toBe('certain');
    expect(early.count).toBe(3);
    expect(early.roundTripMs).toBe(41.1);

    expect(foldDelaySamples(close, { minCount: 7, wideFloor: 7 }).status).not.toBe('certain');
    expect(wideSampleTarget(1, 3)).toBe(3);
    expect(wideSampleTarget(1, 7)).toBe(7);
    expect(wideSampleTarget(20, 7)).toBe(WIDE_MAX_COUNT);
  });

  it('fits a wide delay to a normal curve and asks for more sweeps as it widens', () => {
    expect(wideSampleTarget(2)).toBe(WIDE_MIN_COUNT);
    expect(wideSampleTarget(10)).toBeGreaterThan(wideSampleTarget(4));
    expect(wideSampleTarget(80)).toBe(WIDE_MAX_COUNT);
    expect(wideSampleTarget(200)).toBe(WIDE_MAX_COUNT);

    const moving = foldDelaySamples([180, 198, 214, 189, 205, 221, 193]);
    expect(moving.status).toBe('wide');
    expect(moving.tightCount).toBeLessThan(5);
    expect(moving.roundTripMs).toBeCloseTo(200, 0);
    expect(moving.sigmaMs).toBeGreaterThan(10);
    expect(moving.sigmaMs).toBeLessThan(20);
    expect(moving.uncertaintyMs).toBeCloseTo(moving.sigmaMs / Math.sqrt(moving.count), 5);
    expect(moving.neededCount).toBe(WIDE_MAX_COUNT);

    // One echo past the robust gate stays out of the mean.
    const withEcho = foldDelaySamples([200, 210, 190, 205, 198, 220, 400]);
    expect(withEcho.status).toBe('wide');
    expect(withEcho.count).toBe(6);
    expect(withEcho.roundTripMs).toBeGreaterThan(198);
    expect(withEcho.roundTripMs).toBeLessThan(210);
    expect(withEcho.sigmaMs).toBeLessThan(20);
  });

  it('rejects sweeps that are too scattered to be one curve', () => {
    const scattered = foldDelaySamples([20, 180, 400, 700, 1000, 250, 600, 50]);
    expect(scattered.status).toBe('too-wide');
    expect(scattered.sigmaMs).toBeGreaterThan(WIDE_MAX_SIGMA_MS);

    const failure = failureForEstimation({
      status: 'too-wide',
      sigmaMs: scattered.sigmaMs,
      validCount: scattered.count,
    });
    expect(failure.message).toMatch(/1 standard deviation/);
    expect(failure.message).toMatch(/\d+(\.\d+)? ms/);
  });

  it('keeps the refine window narrow until the sweeps actually move', () => {
    expect(refineSearchHalfWindowMs([41, 41.2])).toBe(40);
    expect(refineSearchHalfWindowMs([180, 230])).toBeGreaterThan(40);
    expect(refineSearchHalfWindowMs([180, 230])).toBeLessThan(80);
    expect(refineSearchHalfWindowMs([200], { wireless: true })).toBeGreaterThanOrEqual(150);
    expect(refineSearchHalfWindowMs([0, 800])).toBeLessThanOrEqual(360);
    expect(refineSearchHalfWindowMs([200, 210], { sigmaMs: 30 })).toBeGreaterThan(100);
  });

  it('does not quote a delay when nothing was heard', () => {
    const failure = failureForEstimation({ status: 'no-signal', validCount: 0 });
    expect(failure.code).toBe('no-signal');
    expect(failure.message).not.toMatch(/\d+ ms/);
    expect(failure.message).toMatch(/output device can play sound into the input device/i);

    const thin = failureForEstimation({ status: 'unsettled', spreadMs: 0.2, validCount: 1 });
    expect(thin.message).toMatch(/Only 1 sweep/);
    expect(thin.message).not.toMatch(/disagreed/);
  });
});
