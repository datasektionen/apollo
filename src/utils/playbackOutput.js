import { DEFAULT_PAN_LAW_DB, normalizePanLawDb } from './audio';

export const DEFAULT_PLAYBACK_DEVICE_SETTINGS = {
  inputDeviceId: '',
  outputDeviceId: '',
  recordingOffsetMs: 0,
  stereoPanLawDb: DEFAULT_PAN_LAW_DB,
  forceMonoOutput: false,
};

export function normalizePlaybackDeviceSettings(settings = {}) {
  const next = {
    ...DEFAULT_PLAYBACK_DEVICE_SETTINGS,
    ...(settings || {}),
  };

  const legacyDefaultPanLawDb = settings?.defaultPanLawDb;
  const requestedStereoPanLawDb = settings?.stereoPanLawDb;
  next.recordingOffsetMs = Number.isFinite(Number(next.recordingOffsetMs))
    ? Number(next.recordingOffsetMs)
    : DEFAULT_PLAYBACK_DEVICE_SETTINGS.recordingOffsetMs;
  next.stereoPanLawDb = normalizePanLawDb(
    requestedStereoPanLawDb ?? legacyDefaultPanLawDb ?? DEFAULT_PLAYBACK_DEVICE_SETTINGS.stereoPanLawDb
  );
  next.forceMonoOutput = next.forceMonoOutput === true;
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
  } catch {
    return false;
  }
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
