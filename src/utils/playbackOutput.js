import { DEFAULT_PAN_LAW_DB, normalizePanLawDb } from './audio';

export const RECORDING_OFFSET_MODES = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
});

export const DEFAULT_PLAYBACK_SPEED_SETTINGS = Object.freeze({
  stretchPerTrack: false,
  showTransposeControl: false,
  formantCompensation: false,
  formantBaseHz: 500,
  blockMs: 120,
  tonalityHz: 8000,
  overlap: 4,
  highOverlap: false,
});

export function normalizePlaybackSpeedSettings(settings = {}) {
  const blockMsRaw = Number(settings?.blockMs);
  const blockMs = Number.isFinite(blockMsRaw)
    ? Math.max(40, Math.min(250, Math.round(blockMsRaw)))
    : DEFAULT_PLAYBACK_SPEED_SETTINGS.blockMs;

  const tonalityHzRaw = Number(settings?.tonalityHz);
  const tonalityHz = Number.isFinite(tonalityHzRaw)
    ? Math.max(1000, Math.min(20000, Math.round(tonalityHzRaw)))
    : DEFAULT_PLAYBACK_SPEED_SETTINGS.tonalityHz;

  const formantBaseHzRaw = Number(settings?.formantBaseHz);
  const formantBaseHz = Number.isFinite(formantBaseHzRaw)
    ? Math.max(50, Math.min(1000, Math.round(formantBaseHzRaw)))
    : DEFAULT_PLAYBACK_SPEED_SETTINGS.formantBaseHz;

  const overlapRaw = Number(settings?.overlap);
  let overlap = Number.isFinite(overlapRaw)
    ? Math.max(2, Math.min(16, Math.round(overlapRaw)))
    : DEFAULT_PLAYBACK_SPEED_SETTINGS.overlap;

  if (settings?.highOverlap === true && overlap < 8) {
    overlap = 8;
  } else if (settings?.highOverlap === false && settings?.overlap === undefined && overlap >= 8) {
    overlap = 4;
  }

  return {
    stretchPerTrack: settings?.stretchPerTrack === true,
    showTransposeControl: settings?.showTransposeControl === true,
    formantCompensation: settings?.formantCompensation === true,
    formantBaseHz,
    blockMs,
    tonalityHz,
    overlap,
    highOverlap: overlap >= 8 || settings?.highOverlap === true,
  };
}

export const DEFAULT_PLAYBACK_DEVICE_SETTINGS = {
  inputDeviceId: '',
  outputDeviceId: '',
  // 'auto' uses a measured round trip for the current input/output pair;
  // 'manual' uses recordingOffsetMs as typed by the user.
  recordingOffsetMode: RECORDING_OFFSET_MODES.AUTO,
  recordingOffsetMs: 0,
  // Measured round trips keyed by `${inputDeviceId}|${outputDeviceId}`.
  recordingCalibrations: {},
  stereoPanLawDb: DEFAULT_PAN_LAW_DB,
  forceMonoOutput: false,
  playbackSpeedSettings: DEFAULT_PLAYBACK_SPEED_SETTINGS,
};

export function normalizeRecordingCalibration(record) {
  if (!record || typeof record !== 'object') return null;
  const roundTripMs = Number(record.roundTripMs);
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return null;
  const toFinite = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    roundTripMs,
    spreadMs: toFinite(record.spreadMs),
    sigmaMs: toFinite(record.sigmaMs),
    uncertaintyMs: toFinite(record.uncertaintyMs),
    measuredAt: toFinite(record.measuredAt),
    sampleRate: toFinite(record.sampleRate),
    outputLatencyMs: toFinite(record.outputLatencyMs),
    baseLatencyMs: toFinite(record.baseLatencyMs),
    inputLabel: String(record.inputLabel || ''),
    outputLabel: String(record.outputLabel || ''),
    // Absent on older measurements, which were only stored after the 1 ms bar.
    stable: record.stable !== false,
  };
}

function normalizeRecordingCalibrations(value) {
  if (!value || typeof value !== 'object') return {};
  const next = {};
  for (const [key, record] of Object.entries(value)) {
    const normalized = normalizeRecordingCalibration(record);
    if (normalized) next[String(key)] = normalized;
  }
  return next;
}

export function normalizePlaybackDeviceSettings(settings = {}) {
  const next = {
    ...DEFAULT_PLAYBACK_DEVICE_SETTINGS,
    ...(settings || {}),
  };

  const legacyDefaultPanLawDb = settings?.defaultPanLawDb;
  const requestedStereoPanLawDb = settings?.stereoPanLawDb;
  next.recordingOffsetMs = Number.isFinite(Number(next.recordingOffsetMs))
    ? Math.max(0, Math.round(Number(next.recordingOffsetMs)))
    : DEFAULT_PLAYBACK_DEVICE_SETTINGS.recordingOffsetMs;
  next.recordingOffsetMode = next.recordingOffsetMode === RECORDING_OFFSET_MODES.MANUAL
    ? RECORDING_OFFSET_MODES.MANUAL
    : RECORDING_OFFSET_MODES.AUTO;
  next.recordingCalibrations = normalizeRecordingCalibrations(next.recordingCalibrations);
  next.stereoPanLawDb = normalizePanLawDb(
    requestedStereoPanLawDb ?? legacyDefaultPanLawDb ?? DEFAULT_PLAYBACK_DEVICE_SETTINGS.stereoPanLawDb
  );
  next.forceMonoOutput = next.forceMonoOutput === true;
  next.playbackSpeedSettings = normalizePlaybackSpeedSettings(next.playbackSpeedSettings);
  next.inputDeviceId = String(next.inputDeviceId || '');
  next.outputDeviceId = String(next.outputDeviceId || '');
  delete next.defaultPanLawDb;

  return next;
}

export function normalizeOutputChannelCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return numeric <= 1 ? 1 : 2;
}

export function isMonoOutputActive(forceMonoOutput = false, outputChannelCount = 2) {
  return forceMonoOutput === true || normalizeOutputChannelCount(outputChannelCount) === 1;
}

export function resolvePlaybackPanLawDisplayDb(settings = {}, outputChannelCount = 2) {
  const normalized = normalizePlaybackDeviceSettings(settings);
  if (isMonoOutputActive(normalized.forceMonoOutput, outputChannelCount)) {
    return 0;
  }
  return normalizePanLawDb(normalized.stereoPanLawDb);
}

export async function detectOutputChannelCount(outputDeviceId = '') {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor) return 2;

  let audioContext = null;
  try {
    audioContext = new AudioContextCtor();
    if (outputDeviceId && typeof audioContext.setSinkId === 'function') {
      await audioContext.setSinkId(outputDeviceId);
    }
    return normalizeOutputChannelCount(audioContext.destination?.maxChannelCount || 2);
  } catch {
    return 2;
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Ignore teardown failures from the probe context.
      }
    }
  }
}

export async function applySinkIdToMediaElement(element, outputDeviceId = '') {
  if (!element || typeof element.setSinkId !== 'function') return;
  try {
    await element.setSinkId(String(outputDeviceId || ''));
  } catch {
    // Ignore output routing failures; playback can continue on the default sink.
  }
}

export async function applySinkIdToAudioContext(audioContext, outputDeviceId = '') {
  if (!audioContext || typeof audioContext.setSinkId !== 'function') return false;
  try {
    await audioContext.setSinkId(String(outputDeviceId || ''));
    return true;
  } catch (error) {
    console.warn('Failed to route audio to sink:', error);
    return false;
  }
}

export const setAudioContextOutput = applySinkIdToAudioContext;

export function isDefaultAudioOutputDeviceId(deviceId = '') {
  const id = String(deviceId || '').trim().toLowerCase();
  return id === '' || id === 'default' || id === 'communications';
}

export function collectAudioOutputDeviceIds(devices = []) {
  return new Set(
    (Array.isArray(devices) ? devices : [])
      .filter((device) => device?.kind === 'audiooutput')
      .map((device) => String(device.deviceId || ''))
  );
}

function toDeviceIdSet(deviceIds) {
  if (deviceIds instanceof Set) return deviceIds;
  return new Set(Array.isArray(deviceIds) ? deviceIds.map((id) => String(id || '')) : []);
}

/**
 * Spotify-style "becoming noisy" / device-loss detection.
 * Pause when a selected non-default sink disappears, or when any output is
 * removed while playing through the OS default (headphones unplugged).
 */
export function shouldAutoPauseForOutputDeviceChange({
  isPlaying = false,
  selectedDeviceId = '',
  previousDeviceIds,
  currentDeviceIds,
} = {}) {
  if (!isPlaying) return false;

  const previousIds = toDeviceIdSet(previousDeviceIds);
  const currentIds = toDeviceIdSet(currentDeviceIds);
  const selected = String(selectedDeviceId || '');

  if (selected && !isDefaultAudioOutputDeviceId(selected) && !currentIds.has(selected)) {
    return true;
  }

  if (
    isDefaultAudioOutputDeviceId(selected)
    && previousIds.size > 0
    && previousIds.size > currentIds.size
  ) {
    return true;
  }

  return false;
}

/**
 * MediaStreamDestination + HTMLAudioElement resampling is a known source of
 * brief pitch/speed glitches on Android. Use it only when a custom output
 * device is selected and AudioContext.setSinkId could not be applied.
 */
export function shouldRoutePlaybackThroughMediaElement({
  outputDeviceId = '',
  audioContextSinkApplied = false,
} = {}) {
  return Boolean(String(outputDeviceId || '')) && audioContextSinkApplied !== true;
}
