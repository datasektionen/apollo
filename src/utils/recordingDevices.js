import { isDefaultAudioOutputDeviceId, RECORDING_OFFSET_MODES } from './playbackOutput';

const BLUETOOTH_LABEL_PATTERN = /\b(bluetooth|airpods|hands-?free|a2dp|bt|wireless|earbuds?|buds|beats)\b/i;

// Calibrations go stale when the browser renegotiates the output path.
// A sample-rate change or an output-latency jump larger than this means the
// stored round trip no longer describes the current hardware buffers.
const STALE_OUTPUT_LATENCY_DELTA_MS = 10;
const DEFAULT_DEVICE_KEY = 'default';

function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim();
}

export function isLikelyBluetoothLabel(label = '') {
  return BLUETOOTH_LABEL_PATTERN.test(String(label || ''));
}

/**
 * Resolve the physical device behind a selection. Chrome exposes the OS
 * default as a separate "default"/"communications" entry that shares its
 * groupId with the real device; use that to key calibrations on the real
 * hardware so plugging in a headset invalidates the old measurement.
 */
export function resolvePhysicalDevice(devices = [], kind, deviceId = '') {
  const list = (Array.isArray(devices) ? devices : []).filter((device) => device?.kind === kind);
  const requestedId = normalizeDeviceId(deviceId);
  const isDefaultRequest = isDefaultAudioOutputDeviceId(requestedId);

  const selected = isDefaultRequest
    ? list.find((device) => normalizeDeviceId(device.deviceId) === 'default') || null
    : list.find((device) => normalizeDeviceId(device.deviceId) === requestedId) || null;

  if (!selected) {
    // Firefox/Safari do not expose a "default" entry (and Safari exposes no
    // outputs at all). Treat the selection as the OS default.
    return {
      id: isDefaultRequest ? DEFAULT_DEVICE_KEY : requestedId,
      groupId: '',
      label: '',
      resolved: false,
    };
  }

  const selectedId = normalizeDeviceId(selected.deviceId);
  let physical = selected;
  if (isDefaultAudioOutputDeviceId(selectedId) && selected.groupId) {
    physical = list.find((device) => (
      device.groupId === selected.groupId
      && !isDefaultAudioOutputDeviceId(normalizeDeviceId(device.deviceId))
    )) || selected;
  }

  const physicalId = normalizeDeviceId(physical.deviceId);
  return {
    id: isDefaultAudioOutputDeviceId(physicalId) ? DEFAULT_DEVICE_KEY : physicalId,
    groupId: String(physical.groupId || ''),
    label: String(physical.label || selected.label || ''),
    resolved: true,
  };
}

export function getRecordingCalibrationKey(input, output) {
  return `${input?.id || DEFAULT_DEVICE_KEY}|${output?.id || DEFAULT_DEVICE_KEY}`;
}

/**
 * Describe the current input/output pair: calibration key, whether both ends
 * are the same physical device (shared clock), and any Bluetooth hints.
 */
export function describeRecordingDevices(devices = [], { inputDeviceId = '', outputDeviceId = '' } = {}) {
  const input = resolvePhysicalDevice(devices, 'audioinput', inputDeviceId);
  const output = resolvePhysicalDevice(devices, 'audiooutput', outputDeviceId);
  const sameDevice = input.groupId && output.groupId
    ? input.groupId === output.groupId
    : null;
  const bluetooth = isLikelyBluetoothLabel(input.label) || isLikelyBluetoothLabel(output.label);

  const warnings = [];
  if (sameDevice === false) {
    warnings.push(
      'You are using input and output devices that are running on separate clocks, so long takes can drift.'
    );
  }

  return {
    input,
    output,
    key: getRecordingCalibrationKey(input, output),
    sameDevice,
    bluetooth,
    warnings,
  };
}

export function isRecordingCalibrationStale(record, { sampleRate = null, outputLatencyMs = null } = {}) {
  if (!record) return true;
  if (
    Number.isFinite(Number(record.sampleRate))
    && Number.isFinite(Number(sampleRate))
    && Number(record.sampleRate) !== Number(sampleRate)
  ) {
    return true;
  }
  if (
    Number.isFinite(Number(record.outputLatencyMs))
    && Number.isFinite(Number(outputLatencyMs))
    && Math.abs(Number(record.outputLatencyMs) - Number(outputLatencyMs)) > STALE_OUTPUT_LATENCY_DELTA_MS
  ) {
    return true;
  }
  return false;
}

/**
 * Decide which offset (ms) to trim from a new recording.
 *
 * Returns `{ status: 'manual' | 'measured', offsetMs }` when recording may
 * proceed, or `{ status: 'missing' | 'stale', offsetMs: null }` when the
 * current device pair needs a measurement first.
 */
export function resolveRecordingOffset(settings = {}, deviceInfo = null, context = {}) {
  if (settings?.recordingOffsetMode === RECORDING_OFFSET_MODES.MANUAL) {
    const manual = Number(settings.recordingOffsetMs);
    return {
      status: 'manual',
      offsetMs: Number.isFinite(manual) ? Math.max(0, Math.round(manual)) : 0,
      calibration: null,
    };
  }

  const key = deviceInfo?.key || getRecordingCalibrationKey(null, null);
  const record = settings?.recordingCalibrations?.[key] || null;
  if (!record) {
    return { status: 'missing', offsetMs: null, calibration: null, key };
  }
  if (isRecordingCalibrationStale(record, context)) {
    return { status: 'stale', offsetMs: null, calibration: record, key };
  }
  return {
    status: 'measured',
    offsetMs: Math.max(0, Math.round(Number(record.roundTripMs) || 0)),
    calibration: record,
    key,
  };
}
