import { audioManager } from './audioManager';
import { recordingManager } from './recordingManager';
import { describeRecordingDevices } from '../utils/recordingDevices';

/**
 * Recording round-trip measurement.
 *
 * Plays a short logarithmic sweep through the same output path as project
 * playback and finds it with a phase-weighted correlation (a softened
 * GCC-PHAT). The sweep is short because the earcup is held on the microphone:
 * bandwidth, not length, sets the timing precision, and a clean path already
 * has enough level. Speaker and microphone coloration barely moves the peak.
 *
 * The browser's outputLatency is the output half only. The first sweep looks
 * in a short window around that figure (a little before it, plus room for the
 * microphone, and more room when the path is wireless). A miss searches the
 * whole range. Later sweeps search a window around the running estimate.
 *
 * Two finishes are possible. A tight fit is sweeps inside 1 ms, and the stored
 * delay is their median: three of them on a fully wired setup, seven when any
 * end of the path is wireless. If that never happens, the sweeps are fitted
 * to a normal curve: the stored delay is the mean, and the reported
 * uncertainty is the standard deviation of the curve plus the standard error
 * of that mean. A wider curve demands more sweeps before the run stops.
 * Scatter of hundreds of milliseconds is still rejected.
 */

export const CALIBRATION_SWEEP_COUNT = 4;
// Long enough for a sharp peak after a headphone and mic have colored it,
// short enough that a clean close-mic test does not sit on a long tone.
export const CALIBRATION_SWEEP_DURATION_SEC = 0.06;
export const CALIBRATION_MAX_DELAY_SEC = 0.6;
// Silence after each sweep so its search window cannot contain the next one,
// even when the delay is the maximum we look for.
export const CALIBRATION_SWEEP_GAP_SEC = 0.15;
export const CALIBRATION_SWEEP_SPACING_SEC = (
  CALIBRATION_SWEEP_DURATION_SEC + CALIBRATION_MAX_DELAY_SEC + CALIBRATION_SWEEP_GAP_SEC
);
export const CALIBRATION_LEAD_IN_SEC = 0.08;
const CALIBRATION_TAIL_SEC = 0.02;

// How many agreeing sweeps settle a measurement, and how close they must be.
// The live run uses 3 on a fully wired path and 7 when anything is wireless.
export const CERTAIN_COUNT = 5;
export const WIRED_TIGHT_COUNT = 3;
export const WIRELESS_MIN_COUNT = 7;
export const CERTAIN_CLUSTER_MS = 1;
export const REFINE_HALF_WINDOW_MS = 40;
// Wide fit: a normal curve instead of a 1 ms cluster. The target is how
// precisely the center should be known (one standard error). A wider curve
// needs more sweeps, up to the cap. Past the sigma cap it is not one delay.
export const WIDE_MIN_COUNT = 8;
export const WIDE_MAX_COUNT = 24;
export const WIDE_TARGET_SE_MS = 2;
export const WIDE_MAX_SIGMA_MS = 80;
export const WIDE_SEARCH_HALF_MS = 360;
// A manual run ignores the usual stop rules until the user presses Stop.
export const MANUAL_SWEEP_CAP = 200;
// Wireless outputs start the search wide so the first jump is not clipped.
export const UNSTABLE_HALF_WINDOW_MS = 180;
const REFINE_WINDOW_MARGIN_MS = 20;
const ROBUST_SIGMA_SCALE = 1.4826;
const OUTLIER_SIGMA = 3;
const MAX_OUTLIER_FRACTION = 0.2;
// outputLatency is the output half. Look this far before it, then this far
// past it for the microphone. Wireless buffering is often missing from the
// figure, so that path gets a longer tail. A miss still searches the full range.
export const HINT_MARGIN_MS = 80;
export const WIRED_HINT_AFTER_MS = 120;
export const WIRELESS_HINT_AFTER_MS = 420;
export const COARSE_FALLBACK_MAX_MS = 1200;
// Divide the cross-spectrum by |magnitude|^exponent. 0 is a plain matched
// filter, 1 is full PHAT. Short of 1 so quiet frequency bins (noise) are not
// amplified as hard as a pure phase transform would.
const PHAT_EXPONENT = 0.45;
const PHAT_FLOOR_FRACTION = 0.02;

// The tallest peak of a matched filter run on white noise, divided by the
// RMS of that correlation, is about sqrt(2 ln N) ≈ 4.5 for the lag counts
// used here. It barely depends on the signal. A cutoff near 4 therefore
// accepts silence. Sweeps of this length clear 8 by a wide margin when the
// microphone actually hears them; noise essentially never does.
const MIN_PEAK_QUALITY = 8;
// A later echo can be louder than the direct sound (a wall, a desk). Any
// local peak at least this fraction of the loudest one, and still above the
// noise floor, is treated as an arrival; the earliest one is the direct path.
const DIRECT_PATH_FRACTION = 0.22;
const MIN_VALID_SWEEPS = 3;
const CLUSTER_MS = 3;
const MAX_ACCEPTABLE_SPREAD_MS = 15;
const SILENCE_PEAK_LEVEL = 0.002;

export class RecordingCalibrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecordingCalibrationError';
    this.code = code;
    this.details = details;
  }
}

function nextPow2(value) {
  let size = 1;
  while (size < value) size <<= 1;
  return size;
}

/** In-place radix-2 FFT. `im` may be all zeros for a real signal. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const reSwap = re[i];
      re[i] = re[j];
      re[j] = reSwap;
      const imSwap = im[i];
      im[i] = im[j];
      im[j] = imSwap;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j += 1) {
        const evenRe = re[i + j];
        const evenIm = im[i + j];
        const oddIndex = i + j + half;
        const oddRe = re[oddIndex] * wRe - im[oddIndex] * wIm;
        const oddIm = re[oddIndex] * wIm + im[oddIndex] * wRe;
        re[i + j] = evenRe + oddRe;
        im[i + j] = evenIm + oddIm;
        re[oddIndex] = evenRe - oddRe;
        im[oddIndex] = evenIm - oddIm;
        const nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }
}

/**
 * Phase-weighted cross-correlation. dots[k] peaks where `template` best
 * lines up with `segment` starting at sample k. Weighting by a fractional
 * power of the magnitude keeps the peak on the time alignment when the
 * microphone hears a filtered copy of the sweep, instead of on how similar
 * the tone colors are.
 */
function phaseWeightedDots(segment, template) {
  const n = nextPow2(segment.length + template.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const kernelRe = new Float64Array(n);
  const kernelIm = new Float64Array(n);
  re.set(segment);
  kernelRe.set(template);
  fft(re, im);
  fft(kernelRe, kernelIm);

  const crossRe = new Float64Array(n);
  const crossIm = new Float64Array(n);
  let maxMagnitude = 0;
  for (let i = 0; i < n; i += 1) {
    const a = re[i];
    const b = im[i];
    const c = kernelRe[i];
    const d = -kernelIm[i];
    crossRe[i] = a * c - b * d;
    crossIm[i] = a * d + b * c;
    const magnitude = Math.hypot(crossRe[i], crossIm[i]);
    if (magnitude > maxMagnitude) maxMagnitude = magnitude;
  }
  const floor = Math.max(maxMagnitude * PHAT_FLOOR_FRACTION, 1e-12);
  for (let i = 0; i < n; i += 1) {
    const magnitude = Math.hypot(crossRe[i], crossIm[i]);
    const weight = 1 / (Math.max(magnitude, floor) ** PHAT_EXPONENT);
    // Conjugate so the forward transform below acts as the inverse.
    re[i] = crossRe[i] * weight;
    im[i] = -(crossIm[i] * weight);
  }
  fft(re, im);

  const dots = new Float64Array(segment.length);
  for (let i = 0; i < dots.length; i += 1) dots[i] = re[i] / n;
  return dots;
}

/**
 * Logarithmic sweep, kept short. Bandwidth (not duration) sets how sharp the
 * peak is. A close microphone in a reasonably clean room already supplies
 * the level, so a long tone would mostly add waiting.
 */
export function createLogSweep(sampleRate, {
  durationSec = CALIBRATION_SWEEP_DURATION_SEC,
  startHz = 500,
  endHz = Math.min(7500, sampleRate * 0.45),
  amplitude = 0.5,
  fadeSec = 0.004,
} = {}) {
  const length = Math.max(16, Math.round(durationSec * sampleRate));
  const sweep = new Float32Array(length);
  const f1 = Math.max(20, startHz);
  const f2 = Math.max(f1 * 2, endHz);
  const duration = length / sampleRate;
  const rate = duration / Math.log(f2 / f1);
  const fade = Math.min(Math.round(fadeSec * sampleRate), Math.floor(length / 4));

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * f1 * rate * (Math.exp(t / rate) - 1);
    let window = 1;
    if (i < fade) window = 0.5 * (1 - Math.cos((Math.PI * i) / fade));
    else if (i > length - 1 - fade) window = 0.5 * (1 - Math.cos((Math.PI * (length - 1 - i)) / fade));
    sweep[i] = amplitude * window * Math.sin(phase);
  }
  return sweep;
}

export function getSweepOffsetsSamples(sampleRate, {
  count = CALIBRATION_SWEEP_COUNT,
  spacingSec = CALIBRATION_SWEEP_SPACING_SEC,
} = {}) {
  const spacing = Math.round(spacingSec * sampleRate);
  const offsets = [];
  for (let i = 0; i < count; i += 1) offsets.push(i * spacing);
  return offsets;
}

export function createSweepTrain(sweep, offsets) {
  const lastOffset = offsets.length ? offsets[offsets.length - 1] : 0;
  const train = new Float32Array(lastOffset + sweep.length);
  for (const offset of offsets) {
    for (let i = 0; i < sweep.length; i += 1) train[offset + i] += sweep[i];
  }
  return train;
}

function refinePeakLag(scores, index) {
  if (index <= 0 || index >= scores.length - 1) return index;
  const earlier = scores[index - 1];
  const peak = scores[index];
  const later = scores[index + 1];
  const denom = earlier - 2 * peak + later;
  if (denom === 0) return index;
  const delta = (0.5 * (earlier - later)) / denom;
  if (!Number.isFinite(delta) || Math.abs(delta) > 1) return index;
  return index + delta;
}

function sliceSegment(capture, offset, length) {
  const segment = new Float32Array(length);
  const start = Math.max(0, offset);
  const end = Math.min(capture.length, offset + length);
  if (end > start) segment.set(capture.subarray(start, end), start - offset);
  return segment;
}

/**
 * Find the sweep inside `capture`, searching lags [minLag, maxLag] relative
 * to `expectedOffset` (where the sweep was played). The reported lag is the
 * earliest strong peak, not the loudest, so a brighter reflection does not
 * win over the direct sound. Peaks stuck on the edge of a narrow window are
 * rejected: the real arrival was probably outside it.
 */
export function estimateDelaySamples(capture, template, {
  expectedOffset = 0,
  minLag = 0,
  maxLag,
  edgeMarginSamples = 0,
}) {
  const templateLength = template.length;
  const startLag = Math.max(0, Math.floor(minLag));
  const endLag = Math.floor(maxLag);
  const lagCount = endLag - startLag + 1;
  const empty = { lag: null, peak: 0, quality: 0, confident: false };
  if (!capture?.length || !templateLength || lagCount <= 1) return empty;

  const segment = sliceSegment(capture, expectedOffset + startLag, templateLength + lagCount);
  const dots = phaseWeightedDots(segment, template);

  const scores = new Float64Array(lagCount);
  let sumSquares = 0;
  let evaluated = 0;
  for (let lag = 0; lag < lagCount; lag += 1) {
    if (lag >= dots.length) break;
    scores[lag] = dots[lag];
    sumSquares += dots[lag] * dots[lag];
    evaluated += 1;
  }
  if (evaluated === 0) return empty;

  let globalIndex = 0;
  for (let lag = 1; lag < evaluated; lag += 1) {
    if (scores[lag] > scores[globalIndex]) globalIndex = lag;
  }
  const rms = Math.sqrt(sumSquares / evaluated);
  const quality = rms > 0 ? scores[globalIndex] / rms : 0;
  const floor = Math.max(scores[globalIndex] * DIRECT_PATH_FRACTION, rms * MIN_PEAK_QUALITY);

  let arrival = -1;
  for (let lag = 0; lag < evaluated; lag += 1) {
    if (scores[lag] < floor) continue;
    const before = lag === 0 ? -Infinity : scores[lag - 1];
    const after = lag + 1 < evaluated ? scores[lag + 1] : -Infinity;
    if (scores[lag] < before || scores[lag] < after) continue;
    arrival = lag;
    break;
  }

  if (arrival < 0) {
    return { lag: startLag + globalIndex, peak: scores[globalIndex], quality, confident: false };
  }
  const arrivalQuality = rms > 0 ? scores[arrival] / rms : 0;
  const margin = Math.max(0, Math.floor(edgeMarginSamples));
  const onEdge = margin > 0 && (arrival <= margin || arrival >= evaluated - 1 - margin);
  return {
    lag: startLag + refinePeakLag(scores, arrival),
    peak: scores[arrival],
    quality: arrivalQuality,
    confident: arrivalQuality >= MIN_PEAK_QUALITY && !onEdge,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function spreadOf(list) {
  if (!list.length) return null;
  return Math.max(...list) - Math.min(...list);
}

function sampleMoments(values) {
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null;
  if (count < 2 || mean == null) {
    return { mean, sigma: 0, uncertainty: null };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  const sigma = Math.sqrt(variance);
  return { mean, sigma, uncertainty: sigma / Math.sqrt(count) };
}

/**
 * How many sweeps a wide fit needs before its center is known to about
 * `WIDE_TARGET_SE_MS`. Grows with the square of the standard deviation.
 */
export function wideSampleTarget(sigmaMs, floor = WIDE_MIN_COUNT) {
  const minimum = Number.isFinite(Number(floor)) && Number(floor) > 0
    ? Math.round(Number(floor))
    : WIDE_MIN_COUNT;
  const sigma = Number(sigmaMs);
  if (!Number.isFinite(sigma) || sigma <= 0) return minimum;
  const needed = Math.ceil((sigma / WIDE_TARGET_SE_MS) ** 2);
  return Math.min(WIDE_MAX_COUNT, Math.max(minimum, needed));
}

/**
 * How many sweeps to collect before a result is allowed.
 * Fully wired (both device names known, neither wireless) can stop at 3
 * close sweeps. Any wireless end, or hidden device names, starts at 7 and
 * then follows the width of the curve.
 */
export function calibrationSchedule({ wireless = false } = {}) {
  if (wireless) {
    return { wireless: true, tightCount: WIRELESS_MIN_COUNT, wideFloor: WIRELESS_MIN_COUNT };
  }
  return { wireless: false, tightCount: WIRED_TIGHT_COUNT, wideFloor: WIRED_TIGHT_COUNT };
}

export function calibrationScheduleForDevices(deviceInfo) {
  const inputLabel = String(deviceInfo?.input?.label || '').trim();
  const outputLabel = String(deviceInfo?.output?.label || '').trim();
  const namesKnown = inputLabel.length > 0 && outputLabel.length > 0;
  const wireless = !namesKnown || deviceInfo?.bluetooth === true;
  return {
    ...calibrationSchedule({ wireless }),
    namesKnown,
    inputLabel,
    outputLabel,
  };
}

/**
 * Points that belong to one bell curve. A single far echo is dropped.
 * A second hump that holds more than a small fraction of the sweeps is kept,
 * so it widens the fit instead of being hidden.
 */
function valuesForNormalFit(values) {
  if (values.length < 2) return values;
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const robustSigma = ROBUST_SIGMA_SCALE * (mad || 0);
  if (!(robustSigma > 0)) return values;
  const gate = OUTLIER_SIGMA * robustSigma;
  const kept = values.filter((value) => Math.abs(value - center) <= gate);
  const dropped = values.length - kept.length;
  const allowedDrops = Math.max(1, Math.floor(values.length * MAX_OUTLIER_FRACTION));
  if (kept.length >= 2 && dropped <= allowedDrops) return kept;
  return values;
}

/**
 * The largest set of delays that fit inside `windowMs`. Equal-sized sets keep
 * the earlier one, which is the direct arrival when a later echo also clusters.
 */
function densestDelayCluster(values, windowMs) {
  const sorted = [...values].sort((a, b) => a - b);
  let bestStart = 0;
  let bestEnd = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right] - sorted[left] > windowMs) left += 1;
    if (right - left > bestEnd - bestStart) {
      bestStart = left;
      bestEnd = right;
    }
  }
  return sorted.slice(bestStart, bestEnd + 1);
}

/**
 * Where the first sweep should look.
 *
 * `outputLatency` is how long the browser thinks sound takes to leave the
 * output. It does not include the microphone, the air, or Bluetooth buffering
 * the OS left out. The capture only runs until the end of this window, so a
 * tight window is what makes the first sweep fast. A miss retries from zero
 * across the full range.
 */
export function formatOutputLatencyLog(outputLatencyMs, baseLatencyMs) {
  const figure = (value) => (Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'unavailable');
  return `outputLatency: ${figure(outputLatencyMs)} (baseLatency: ${figure(baseLatencyMs)})`;
}

export function coarseSearchBoundsMs({
  outputLatencyMs = null,
  baseLatencyMs = null,
  wireless = false,
} = {}) {
  const output = Number(outputLatencyMs);
  const base = Number(baseLatencyMs);
  const outputOk = Number.isFinite(output) && output > 1 && output <= 400;
  const baseOk = Number.isFinite(base) && base > 0 && base <= 400;
  // The spec's output figure includes baseLatency. A smaller number means
  // this browser's value is not a usable prior.
  const reliable = outputOk && (!baseOk || output + 5 >= base);
  if (!reliable) {
    return {
      minMs: 0,
      maxMs: COARSE_FALLBACK_MAX_MS,
      hintMs: baseOk ? base : 0,
      reliable: false,
    };
  }
  const after = (wireless ? WIRELESS_HINT_AFTER_MS : WIRED_HINT_AFTER_MS) + (baseOk ? base : 0);
  return {
    minMs: Math.max(0, output - HINT_MARGIN_MS),
    maxMs: Math.min(COARSE_FALLBACK_MAX_MS, output + after),
    hintMs: output,
    reliable: true,
  };
}

/**
 * Combine individual sweep delays.
 *
 * `certain` once `minCount` sweeps sit inside 1 ms and that cluster is most of
 * the run. A late plateau in a drifting series does not count. The returned
 * delay is their median, so one sweep that locked onto an echo does not move
 * it the way an average would. `wideFloor` is the fewest sweeps a wide fit may
 * stop on.
 * `wide` fits the rest to a normal curve: `roundTripMs` is the mean,
 * `sigmaMs` is the standard deviation, and `uncertaintyMs` is the standard
 * error of that mean. `neededCount` grows with `sigmaMs`. `too-wide` means
 * the curve is broader than one recording offset can absorb.
 */
export function foldDelaySamples(samplesMs, {
  clusterMs = CERTAIN_CLUSTER_MS,
  minCount = CERTAIN_COUNT,
  wideFloor = WIDE_MIN_COUNT,
} = {}) {
  const values = (Array.isArray(samplesMs) ? samplesMs : []).filter((value) => Number.isFinite(value));
  const empty = {
    status: 'none',
    roundTripMs: null,
    spreadMs: null,
    sigmaMs: null,
    uncertaintyMs: null,
    count: 0,
    tightCount: 0,
    neededCount: minCount,
  };
  if (!values.length) return empty;

  const tight = densestDelayCluster(values, clusterMs);
  const tightCount = tight.length;

  if (tight.length >= minCount && tight.length * 2 > values.length) {
    const moments = sampleMoments(tight);
    return {
      status: 'certain',
      roundTripMs: median(tight),
      spreadMs: spreadOf(tight),
      sigmaMs: moments.sigma,
      uncertaintyMs: moments.uncertainty,
      count: tight.length,
      tightCount,
      neededCount: minCount,
    };
  }

  if (values.length < 2) {
    return {
      status: 'approximate',
      roundTripMs: values[0],
      spreadMs: 0,
      sigmaMs: null,
      uncertaintyMs: null,
      count: tightCount,
      tightCount,
      neededCount: wideFloor,
    };
  }

  const fittedValues = valuesForNormalFit(values);
  const moments = sampleMoments(fittedValues);
  const fitted = {
    roundTripMs: moments.mean,
    spreadMs: spreadOf(fittedValues),
    sigmaMs: moments.sigma,
    uncertaintyMs: moments.uncertainty,
    count: fittedValues.length,
    tightCount,
    neededCount: wideSampleTarget(moments.sigma, wideFloor),
  };
  if (moments.sigma > WIDE_MAX_SIGMA_MS && values.length >= WIDE_MIN_COUNT) {
    return { status: 'too-wide', ...fitted };
  }
  return { status: 'wide', ...fitted };
}

/**
 * Half-width of the next refine search. Steady delays stay inside the narrow
 * window. A wide curve opens the window out to a few standard deviations so
 * the tails are part of the fit, and a wireless output starts wide so the
 * first jump is not clipped.
 */
export function refineSearchHalfWindowMs(samplesMs, { wireless = false, sigmaMs = null } = {}) {
  const floor = wireless ? UNSTABLE_HALF_WINDOW_MS : REFINE_HALF_WINDOW_MS;
  const values = (Array.isArray(samplesMs) ? samplesMs : []).filter((value) => Number.isFinite(value));
  let needed = floor;
  if (values.length >= 2) {
    const spread = Math.max(...values) - Math.min(...values);
    needed = Math.max(needed, spread / 2 + REFINE_WINDOW_MARGIN_MS);
  }
  const sigma = Number(sigmaMs);
  if (Number.isFinite(sigma) && sigma > 0) {
    needed = Math.max(needed, sigma * OUTLIER_SIGMA + REFINE_WINDOW_MARGIN_MS);
  }
  return Math.min(WIDE_SEARCH_HALF_MS, needed);
}

/**
 * Combine per-sweep estimates into one round trip.
 * `status` is `ok`, `no-signal` (nothing trustworthy was heard, including
 * pure noise), or `inconsistent` (the sweeps were heard but disagree).
 */
export function estimateRoundTrip({
  capture,
  sampleRate,
  sweep,
  sweepOffsetsInCapture,
  maxLagSamples,
}) {
  const estimates = sweepOffsetsInCapture.map((offset) => estimateDelaySamples(capture, sweep, {
    expectedOffset: offset,
    maxLag: maxLagSamples,
  }));

  const confident = estimates.filter((estimate) => estimate.confident && estimate.lag != null);
  const confidentMs = confident.map((estimate) => (estimate.lag / sampleRate) * 1000);
  const base = {
    validCount: confident.length,
    estimates,
    roundTripMs: null,
    spreadMs: null,
  };
  if (confident.length < MIN_VALID_SWEEPS) {
    return { ...base, status: 'no-signal' };
  }

  const centerMs = median(confidentMs);
  const inliers = confidentMs.filter((lagMs) => Math.abs(lagMs - centerMs) <= CLUSTER_MS);
  const spreadOf = (values) => Math.max(...values) - Math.min(...values);
  if (inliers.length < MIN_VALID_SWEEPS) {
    return {
      ...base,
      status: 'inconsistent',
      roundTripMs: centerMs,
      spreadMs: spreadOf(confidentMs),
    };
  }

  const roundTripMs = median(inliers);
  const spreadMs = spreadOf(inliers);
  if (spreadMs > MAX_ACCEPTABLE_SPREAD_MS) {
    return { ...base, status: 'inconsistent', roundTripMs, spreadMs };
  }
  return { ...base, status: 'ok', roundTripMs, spreadMs };
}

export function failureForEstimation(estimation) {
  const spreadMs = Number(estimation?.spreadMs);
  const sigmaMs = Number(estimation?.sigmaMs);
  if (estimation?.status === 'too-wide') {
    const shown = Number.isFinite(sigmaMs) ? sigmaMs.toFixed(1) : String(Math.round(spreadMs));
    return new RecordingCalibrationError(
      'inconsistent',
      `The delay varies by ${shown} ms (1 standard deviation). That is too wide to use as one recording offset. A wired headphone holds a steadier time.`,
      { spreadMs: estimation.spreadMs, sigmaMs: estimation.sigmaMs, validCount: estimation.validCount }
    );
  }
  const heard = Number(estimation?.validCount) || 0;
  const minForDisagreement = Number(estimation?.minCount) > 0
    ? Number(estimation.minCount)
    : WIDE_MIN_COUNT;
  const disagreed = Number.isFinite(spreadMs) && spreadMs > CERTAIN_CLUSTER_MS && heard >= minForDisagreement;
  if (estimation?.status === 'inconsistent' || (estimation?.status === 'unsettled' && disagreed)) {
    return new RecordingCalibrationError(
      'inconsistent',
      `The delay would not settle (the sweeps disagreed by ${Math.round(spreadMs)} ms). Hold the microphone still against the headphone and try again.`,
      { spreadMs: estimation.spreadMs, validCount: estimation.validCount }
    );
  }
  if (estimation?.status === 'unsettled') {
    const heard = Number(estimation.validCount) || 0;
    return new RecordingCalibrationError(
      'inconsistent',
      `Only ${heard} sweep${heard === 1 ? '' : 's'} came through clearly, which is not enough to settle the delay. Hold an earcup against the microphone and try again.`,
      { spreadMs: estimation.spreadMs, validCount: heard }
    );
  }
  return new RecordingCalibrationError(
    'no-signal',
    'Measurement failed. Ensure that the output device can play sound into the input device by adjusting their locations and the volume.',
    { validCount: estimation?.validCount || 0 }
  );
}

function peakLevel(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function msToSamples(sampleRate, ms) {
  return Math.max(0, Math.round((Number(ms) || 0) / 1000 * sampleRate));
}

/**
 * Play one sweep and look for it between minMs and maxMs after it was scheduled.
 */
async function playSweepAndEstimate({
  audioContext,
  target,
  sweep,
  sampleRate,
  minMs,
  maxMs,
  edgeMarginSamples = 0,
}) {
  const buffer = audioContext.createBuffer(1, sweep.length, sampleRate);
  buffer.copyToChannel(sweep, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  const gain = audioContext.createGain();
  gain.gain.value = 1;
  source.connect(gain);
  gain.connect(target);

  const startContextTime = audioContext.currentTime + CALIBRATION_LEAD_IN_SEC;
  const captureStart = Math.max(0, startContextTime - 0.02);
  const captureEnd = startContextTime + (sweep.length / sampleRate) + (maxMs / 1000) + CALIBRATION_TAIL_SEC;
  source.start(startContextTime);

  let captured;
  try {
    captured = await recordingManager.captureMonoRange(
      captureStart,
      captureEnd,
      Math.round((captureEnd - audioContext.currentTime) * 1000) + 3000
    );
  } catch (error) {
    throw new RecordingCalibrationError('capture', error?.message || 'Could not read the microphone.');
  } finally {
    try { source.stop(); } catch { /* already finished */ }
    try { gain.disconnect(); } catch { /* ignore */ }
    try { source.disconnect(); } catch { /* ignore */ }
  }

  const { samples, startFrame } = captured;
  if (!samples.length || peakLevel(samples) < SILENCE_PEAK_LEVEL) {
    return { confident: false, lagMs: null };
  }

  const estimate = estimateDelaySamples(samples, sweep, {
    expectedOffset: Math.round(startContextTime * sampleRate) - startFrame,
    minLag: msToSamples(sampleRate, minMs),
    maxLag: msToSamples(sampleRate, maxMs),
    edgeMarginSamples,
  });
  return {
    confident: estimate.confident,
    lagMs: estimate.lag == null ? null : (estimate.lag / sampleRate) * 1000,
  };
}

/**
 * Run a full measurement on the live audio engine.
 *
 * Resolves with `{ roundTripMs, spreadMs, sigmaMs, uncertaintyMs, stable, measuredAt, sampleRate, outputLatencyMs, baseLatencyMs }`.
 * `stable` is false for a wide normal fit. `sigmaMs` is that fit's standard
 * deviation, and `uncertaintyMs` is the standard error of its center.
 * Rejects with RecordingCalibrationError codes `no-signal`, `inconsistent`, or `capture`.
 */
export async function measureRecordingRoundTrip({
  inputDeviceId = '',
  onProgress = null,
  signal = null,
  untilStopped = false,
  shouldFinish = null,
} = {}) {
  const report = (phase, detail = {}) => {
    if (typeof onProgress === 'function') onProgress({ phase, ...detail });
  };
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new RecordingCalibrationError('aborted', 'Measurement cancelled.');
    }
  };

  const log = (message) => {
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info(`[Apollo calibration] ${message}`);
    }
  };
  const logSweep = (index, heard) => {
    if (heard?.confident && Number.isFinite(heard.lagMs)) {
      log(`Sweep ${index}: ${heard.lagMs.toFixed(2)} ms`);
    } else {
      log(`Sweep ${index}: not heard`);
    }
  };

  const stopRequested = () => untilStopped && typeof shouldFinish === 'function' && shouldFinish();

  report('preparing');
  await audioManager.init();
  await audioManager.resume();
  const audioContext = audioManager.audioContext;
  const outputLatencyMs = Number.isFinite(audioContext?.outputLatency)
    ? audioContext.outputLatency * 1000
    : null;
  const baseLatencyMs = Number.isFinite(audioContext?.baseLatency)
    ? audioContext.baseLatency * 1000
    : null;
  log(formatOutputLatencyLog(outputLatencyMs, baseLatencyMs));

  await recordingManager.ensureCapture({ deviceId: inputDeviceId });
  throwIfAborted();

  let plan = calibrationSchedule({ wireless: true });
  try {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const deviceInfo = describeRecordingDevices(devices, {
        inputDeviceId,
        outputDeviceId: audioManager.currentOutputDeviceId || '',
      });
      plan = calibrationScheduleForDevices(deviceInfo);
    }
  } catch {
    plan = calibrationSchedule({ wireless: true });
  }
  if (plan.wireless) {
    log(plan.namesKnown
      ? `Wireless link (${plan.inputLabel || 'microphone'} → ${plan.outputLabel || 'output'}). Starting with ${plan.tightCount} sweeps.`
      : `Device names are hidden, so this run uses the wireless schedule. Starting with ${plan.tightCount} sweeps.`);
  } else {
    log(`Fully wired (${plan.inputLabel} → ${plan.outputLabel}). ${plan.tightCount} close sweeps can finish the test.`);
  }

  if (!audioContext) {
    throw new RecordingCalibrationError('capture', 'Audio output is not ready.');
  }
  const sampleRate = audioContext.sampleRate;
  const sweep = createLogSweep(sampleRate);
  const target = audioManager.getCalibrationInputNode();
  if (!target) {
    throw new RecordingCalibrationError('capture', 'Audio output is not ready.');
  }

  const prior = coarseSearchBoundsMs({
    outputLatencyMs,
    baseLatencyMs,
    wireless: plan.wireless,
  });
  const fallback = { minMs: 0, maxMs: COARSE_FALLBACK_MAX_MS };
  const coarseWindows = prior.reliable && (prior.minMs > 0 || prior.maxMs !== fallback.maxMs)
    ? [prior, fallback]
    : [fallback];

  let coarse = null;
  let sweepIndex = 0;
  for (const bounds of coarseWindows) {
    if (stopRequested()) break;
    throwIfAborted();
    report('coarse', { minMs: bounds.minMs, maxMs: bounds.maxMs });
    const heard = await playSweepAndEstimate({
      audioContext,
      target,
      sweep,
      sampleRate,
      minMs: bounds.minMs,
      maxMs: bounds.maxMs,
    });
    sweepIndex += 1;
    logSweep(sweepIndex, heard);
    await yieldToUi();
    if (heard.confident) {
      coarse = heard;
      break;
    }
  }
  if (!coarse) {
    if (stopRequested()) {
      const stopped = new RecordingCalibrationError(
        'inconsistent',
        'Stopped before a sweep was heard. Let at least two sweeps finish, then press Stop.',
      );
      log(stopped.message);
      throw stopped;
    }
    const missed = failureForEstimation({ status: 'no-signal', validCount: 0 });
    log(missed.message);
    throw missed;
  }

  const samplesMs = [coarse.lagMs];
  const edgeMarginSamples = msToSamples(sampleRate, 2);
  const hearAround = (centerMs, halfMs) => playSweepAndEstimate({
    audioContext,
    target,
    sweep,
    sampleRate,
    minMs: Math.max(0, centerMs - halfMs),
    maxMs: centerMs + halfMs,
    edgeMarginSamples,
  });
  const roundMs = (value) => (value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);

  // A few misses are allowed on top of the widest fit we are willing to run.
  // A manual run keeps going until Stop, with a cap so it cannot spin forever.
  const playCap = untilStopped ? MANUAL_SWEEP_CAP : WIDE_MAX_COUNT + 6;
  const foldOptions = { minCount: plan.tightCount, wideFloor: plan.wideFloor };
  let plays = 0;
  while (plays < playCap) {
    if (stopRequested()) break;
    const fold = foldDelaySamples(samplesMs, foldOptions);
    const gathering = samplesMs.length < plan.tightCount;
    const wide = !gathering && fold.status === 'wide';
    report('refining', {
      agreed: fold.tightCount,
      heard: samplesMs.length,
      need: untilStopped ? null : (wide ? fold.neededCount : plan.tightCount),
      fit: untilStopped ? 'manual' : (wide ? 'wide' : 'tight'),
      sigmaMs: fold.sigmaMs,
      manual: untilStopped,
    });
    if (!untilStopped) {
      if (fold.status === 'certain') break;
      if (!gathering && fold.status === 'too-wide') break;
      if (
        wide
        && fold.count >= fold.neededCount
        && fold.sigmaMs <= WIDE_MAX_SIGMA_MS
      ) break;
      if (samplesMs.length >= WIDE_MAX_COUNT) break;
    }
    throwIfAborted();
    const half = refineSearchHalfWindowMs(samplesMs, {
      wireless: plan.wireless || wide,
      sigmaMs: fold.sigmaMs,
    });
    plays += 1;
    let heard = await hearAround(fold.roundTripMs, half);
    sweepIndex += 1;
    logSweep(sweepIndex, heard);
    // A jump past the narrow window is a miss, not a disagreement. Look again
    // across the wide span before giving up on this sweep.
    if (!heard.confident && half + 1 < WIDE_SEARCH_HALF_MS && plays < playCap && !stopRequested()) {
      plays += 1;
      heard = await hearAround(fold.roundTripMs, WIDE_SEARCH_HALF_MS);
      sweepIndex += 1;
      logSweep(sweepIndex, heard);
    }
    if (heard.confident && heard.lagMs != null) samplesMs.push(heard.lagMs);
    await yieldToUi();
  }

  const settled = foldDelaySamples(samplesMs, foldOptions);
  throwIfAborted();
  const manualStop = untilStopped && (stopRequested() || plays >= playCap);
  const reject = (estimation) => {
    const error = failureForEstimation({ ...estimation, minCount: plan.wideFloor });
    log(error.message);
    throw error;
  };
  const manualUsable = manualStop
    && samplesMs.length >= 2
    && Number.isFinite(settled.roundTripMs)
    && settled.status !== 'none';
  if (!manualUsable && settled.status === 'too-wide') {
    reject({
      status: 'too-wide',
      sigmaMs: settled.sigmaMs,
      spreadMs: settled.spreadMs,
      validCount: samplesMs.length,
    });
  }
  const wideReady = settled.status === 'wide'
    && settled.count >= plan.wideFloor
    && settled.sigmaMs <= WIDE_MAX_SIGMA_MS
    && (settled.count >= settled.neededCount || samplesMs.length >= WIDE_MAX_COUNT);
  if (!manualUsable && ((settled.status !== 'certain' && !wideReady) || settled.roundTripMs == null)) {
    reject({
      status: 'unsettled',
      spreadMs: settled.spreadMs,
      sigmaMs: settled.sigmaMs,
      validCount: samplesMs.length,
    });
  }

  const record = {
    roundTripMs: roundMs(settled.roundTripMs),
    spreadMs: roundMs(settled.spreadMs),
    sigmaMs: roundMs(settled.sigmaMs),
    uncertaintyMs: roundMs(settled.uncertaintyMs),
    stable: settled.status === 'certain',
    measuredAt: Date.now(),
    sampleRate,
    outputLatencyMs,
    baseLatencyMs,
    validCount: settled.count,
  };
  const delays = samplesMs.map((value) => `${value.toFixed(2)} ms`).join(', ');
  const stoppedNote = manualStop ? 'Stopped manually. ' : '';
  if (settled.status === 'certain') {
    log(`${stoppedNote}Tight fit. Median ${record.roundTripMs} ms from ${settled.count} sweeps (${delays}).`);
  } else {
    log(`${stoppedNote}Wide fit. Center ${record.roundTripMs} ms, standard deviation ${record.sigmaMs} ms, standard error ${record.uncertaintyMs} ms, from ${settled.count} sweeps (${delays}).`);
  }
  report('done', { record });
  return record;
}
