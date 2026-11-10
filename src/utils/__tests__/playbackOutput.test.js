import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAYBACK_SPEED_SETTINGS,
  applySinkIdToAudioContext,
  collectAudioOutputDeviceIds,
  isDefaultAudioOutputDeviceId,
  isMonoOutputActive,
  normalizePlaybackDeviceSettings,
  normalizePlaybackSpeedSettings,
  resolvePlaybackPanLawDisplayDb,
  setAudioContextOutput,
  shouldAutoPauseForOutputDeviceChange,
  shouldRoutePlaybackThroughMediaElement,
} from '../playbackOutput';

describe('playbackOutput', () => {
  it('normalizes playback settings and migrates legacy pan law values', () => {
    const normalized = normalizePlaybackDeviceSettings({
      defaultPanLawDb: -4.5,
      forceMonoOutput: true,
      recordingOffsetMs: '12.6',
    });

    expect(normalized.stereoPanLawDb).toBe(-4.5);
    expect(normalized.forceMonoOutput).toBe(true);
    expect(normalized.recordingOffsetMs).toBe(13);
    expect(normalized.playbackSpeedSettings).toEqual(DEFAULT_PLAYBACK_SPEED_SETTINGS);
  });

  it('normalizes playback speed settings and clamps ranges', () => {
    const custom = normalizePlaybackSpeedSettings({
      stretchPerTrack: true,
      showTransposeControl: true,
      formantCompensation: true,
      formantBaseHz: '650',
      blockMs: '300',
      tonalityHz: '25000',
      overlap: 8,
    });
    expect(custom).toEqual({
      stretchPerTrack: true,
      showTransposeControl: true,
      formantCompensation: true,
      formantBaseHz: 650,
      blockMs: 250,
      tonalityHz: 20000,
      overlap: 8,
      highOverlap: true,
    });

    const low = normalizePlaybackSpeedSettings({
      blockMs: 20,
      tonalityHz: 200,
      formantBaseHz: 20,
      overlap: 1,
    });
    expect(low.blockMs).toBe(40);
    expect(low.tonalityHz).toBe(1000);
    expect(low.formantBaseHz).toBe(50);
    expect(low.overlap).toBe(2);
    expect(low.showTransposeControl).toBe(false);
  });

  it('treats mono hardware or forced mono as mono output', () => {
    expect(isMonoOutputActive(false, 1)).toBe(true);
    expect(isMonoOutputActive(true, 2)).toBe(true);
    expect(isMonoOutputActive(false, 2)).toBe(false);
  });

  it('shows 0 dB pan law while mono is active but restores stereo choice otherwise', () => {
    expect(resolvePlaybackPanLawDisplayDb({ stereoPanLawDb: -6, forceMonoOutput: false }, 2)).toBe(-6);
    expect(resolvePlaybackPanLawDisplayDb({ stereoPanLawDb: -6, forceMonoOutput: true }, 2)).toBe(0);
    expect(resolvePlaybackPanLawDisplayDb({ stereoPanLawDb: -6, forceMonoOutput: false }, 1)).toBe(0);
  });

  it('routes through a media element only for custom sinks without an AudioContext sink', () => {
    expect(shouldRoutePlaybackThroughMediaElement({ outputDeviceId: '' })).toBe(false);
    expect(shouldRoutePlaybackThroughMediaElement({
      outputDeviceId: 'headphones',
      audioContextSinkApplied: true,
    })).toBe(false);
    expect(shouldRoutePlaybackThroughMediaElement({
      outputDeviceId: 'headphones',
      audioContextSinkApplied: false,
    })).toBe(true);
  });

  it('treats empty, default, and communications sink ids as the OS default', () => {
    expect(isDefaultAudioOutputDeviceId('')).toBe(true);
    expect(isDefaultAudioOutputDeviceId('default')).toBe(true);
    expect(isDefaultAudioOutputDeviceId('communications')).toBe(true);
    expect(isDefaultAudioOutputDeviceId('headphones')).toBe(false);
  });

  it('collects audio output device ids', () => {
    expect(collectAudioOutputDeviceIds([
      { kind: 'audiooutput', deviceId: 'headphones' },
      { kind: 'audioinput', deviceId: 'mic' },
      { kind: 'audiooutput', deviceId: 'speakers' },
    ])).toEqual(new Set(['headphones', 'speakers']));
  });

  it('pauses when a selected non-default output is unplugged', () => {
    expect(shouldAutoPauseForOutputDeviceChange({
      isPlaying: true,
      selectedDeviceId: 'headphones',
      previousDeviceIds: new Set(['headphones', 'speakers']),
      currentDeviceIds: new Set(['speakers']),
    })).toBe(true);
  });

  it('pauses default-output playback when any output disappears', () => {
    expect(shouldAutoPauseForOutputDeviceChange({
      isPlaying: true,
      selectedDeviceId: '',
      previousDeviceIds: new Set(['headphones', 'speakers']),
      currentDeviceIds: new Set(['speakers']),
    })).toBe(true);
  });

  it('does not pause when a new output is connected or playback is already stopped', () => {
    expect(shouldAutoPauseForOutputDeviceChange({
      isPlaying: true,
      selectedDeviceId: '',
      previousDeviceIds: new Set(['speakers']),
      currentDeviceIds: new Set(['headphones', 'speakers']),
    })).toBe(false);
    expect(shouldAutoPauseForOutputDeviceChange({
      isPlaying: false,
      selectedDeviceId: 'headphones',
      previousDeviceIds: new Set(['headphones', 'speakers']),
      currentDeviceIds: new Set(['speakers']),
    })).toBe(false);
    expect(shouldAutoPauseForOutputDeviceChange({
      isPlaying: true,
      selectedDeviceId: 'headphones',
      previousDeviceIds: new Set(['headphones', 'speakers']),
      currentDeviceIds: new Set(['headphones']),
    })).toBe(false);
  });

  it('routes AudioContext output with setSinkId and reports unsupported/failed sinks', async () => {
    const audioContext = { setSinkId: vi.fn().mockResolvedValue(undefined) };
    await expect(setAudioContextOutput(audioContext, 'headphones')).resolves.toBe(true);
    expect(audioContext.setSinkId).toHaveBeenCalledWith('headphones');

    await expect(applySinkIdToAudioContext({}, 'headphones')).resolves.toBe(false);

    const failingContext = { setSinkId: vi.fn().mockRejectedValue(new Error('disconnected')) };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(applySinkIdToAudioContext(failingContext, 'headphones')).resolves.toBe(false);
    warnSpy.mockRestore();
  });
});
