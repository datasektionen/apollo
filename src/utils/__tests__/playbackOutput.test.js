import { describe, expect, it } from 'vitest';
import {
  isMonoOutputActive,
  normalizePlaybackDeviceSettings,
  resolvePlaybackPanLawDisplayDb,
  shouldRoutePlaybackThroughMediaElement,
} from '../playbackOutput';

describe('playbackOutput', () => {
  it('normalizes playback settings and migrates legacy pan law values', () => {
    const normalized = normalizePlaybackDeviceSettings({
      defaultPanLawDb: -4.5,
      forceMonoOutput: true,
      recordingOffsetMs: '12',
    });

    expect(normalized.stereoPanLawDb).toBe(-4.5);
    expect(normalized.forceMonoOutput).toBe(true);
    expect(normalized.recordingOffsetMs).toBe(12);
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
});
