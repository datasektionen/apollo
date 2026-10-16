import { describe, expect, it } from 'vitest';
import {
  describeRecordingDevices,
  isLikelyBluetoothLabel,
  isRecordingCalibrationStale,
  resolvePhysicalDevice,
  resolveRecordingOffset,
} from '../recordingDevices';
import { normalizePlaybackDeviceSettings } from '../playbackOutput';

const devices = [
  { kind: 'audioinput', deviceId: 'default', groupId: 'headset', label: 'Default - Headset Microphone' },
  { kind: 'audioinput', deviceId: 'mic-headset', groupId: 'headset', label: 'Headset Microphone' },
  { kind: 'audioinput', deviceId: 'mic-internal', groupId: 'builtin', label: 'MacBook Pro Microphone' },
  { kind: 'audiooutput', deviceId: 'default', groupId: 'headset', label: 'Default - Headset' },
  { kind: 'audiooutput', deviceId: 'out-headset', groupId: 'headset', label: 'Headset' },
  { kind: 'audiooutput', deviceId: 'out-bt', groupId: 'bt', label: 'AirPods Pro' },
];

describe('recording device identity', () => {
  it('maps the default entry to the physical device behind it', () => {
    const input = resolvePhysicalDevice(devices, 'audioinput', '');
    expect(input.id).toBe('mic-headset');
    expect(input.groupId).toBe('headset');
  });

  it('keeps an explicit selection and reports whether both ends share a clock', () => {
    const same = describeRecordingDevices(devices, { inputDeviceId: 'mic-headset', outputDeviceId: '' });
    expect(same.key).toBe('mic-headset|out-headset');
    expect(same.sameDevice).toBe(true);
    expect(same.warnings).toEqual([]);

    const split = describeRecordingDevices(devices, { inputDeviceId: 'mic-internal', outputDeviceId: 'out-headset' });
    expect(split.sameDevice).toBe(false);
    expect(split.warnings).toEqual([
      'You are using input and output devices that are running on separate clocks, so long takes can drift.',
    ]);
  });

  it('flags Bluetooth devices', () => {
    expect(isLikelyBluetoothLabel('AirPods Pro')).toBe(true);
    expect(isLikelyBluetoothLabel('Earbuds')).toBe(true);
    expect(isLikelyBluetoothLabel('Scarlett 2i2 USB')).toBe(false);
    const info = describeRecordingDevices(devices, { inputDeviceId: 'mic-internal', outputDeviceId: 'out-bt' });
    expect(info.bluetooth).toBe(true);
  });

  it('falls back to a generic default key when the browser hides device lists', () => {
    const info = describeRecordingDevices([], { inputDeviceId: '', outputDeviceId: '' });
    expect(info.key).toBe('default|default');
    expect(info.sameDevice).toBeNull();
  });
});

describe('recording offset resolution', () => {
  const info = describeRecordingDevices(devices, { inputDeviceId: 'mic-headset', outputDeviceId: '' });

  it('uses the manual value when manual mode is on', () => {
    const settings = normalizePlaybackDeviceSettings({ recordingOffsetMode: 'manual', recordingOffsetMs: 42 });
    expect(resolveRecordingOffset(settings, info)).toMatchObject({ status: 'manual', offsetMs: 42 });
  });

  it('asks for a measurement when none exists for the device pair', () => {
    const settings = normalizePlaybackDeviceSettings({});
    expect(resolveRecordingOffset(settings, info)).toMatchObject({ status: 'missing', offsetMs: null });
  });

  it('uses a stored measurement and detects when it went stale', () => {
    const settings = normalizePlaybackDeviceSettings({
      recordingCalibrations: {
        [info.key]: { roundTripMs: 63.4, sampleRate: 48000, outputLatencyMs: 20 },
      },
    });
    expect(resolveRecordingOffset(settings, info, { sampleRate: 48000, outputLatencyMs: 21 }))
      .toMatchObject({ status: 'measured', offsetMs: 63 });
    expect(resolveRecordingOffset(settings, info, { sampleRate: 44100, outputLatencyMs: 21 }).status)
      .toBe('stale');
    expect(resolveRecordingOffset(settings, info, { sampleRate: 48000, outputLatencyMs: 45 }).status)
      .toBe('stale');
    expect(isRecordingCalibrationStale(null)).toBe(true);
  });

  it('remembers when a measurement was unstable', () => {
    const settings = normalizePlaybackDeviceSettings({
      recordingCalibrations: {
        [info.key]: { roundTripMs: 214, spreadMs: 36, sigmaMs: 14.2, uncertaintyMs: 3.6, stable: false },
      },
    });
    expect(settings.recordingCalibrations[info.key].stable).toBe(false);
    expect(settings.recordingCalibrations[info.key].sigmaMs).toBe(14.2);
    expect(settings.recordingCalibrations[info.key].uncertaintyMs).toBe(3.6);

    const older = normalizePlaybackDeviceSettings({
      recordingCalibrations: {
        [info.key]: { roundTripMs: 63.4 },
      },
    });
    expect(older.recordingCalibrations[info.key].stable).toBe(true);
  });
});
