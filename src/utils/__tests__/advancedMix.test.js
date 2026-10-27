import { describe, expect, it } from 'vitest';
import {
  ADVANCED_MIX_PRESET_ID,
  ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  buildAdvancedPlaybackSnapshot,
} from '../advancedMix.js';

describe('buildAdvancedPlaybackSnapshot', () => {
  it('uses current project lyrics for old advanced mixes and their duplicates without losing mix deviations', () => {
    const lyrics = {
      useSyncedLyrics: true,
      lines: [{ id: 'line-1', text: 'Current lyric', startMs: 0 }],
    };
    const baseSnapshot = {
      projectId: 'project-1',
      projectName: 'Song',
      musicalNumber: '1.1',
      lyrics,
      tracks: [{ id: 'track-1', muted: false }],
    };
    const savedSnapshot = {
      projectId: 'project-1',
      projectName: 'Song',
      tracks: [{ id: 'track-1', muted: true }],
    };
    const original = {
      id: 'mix-1',
      projectId: 'project-1',
      name: 'Advanced mix',
      presetId: ADVANCED_MIX_PRESET_ID,
      advancedMix: { snapshot: savedSnapshot },
    };
    const duplicate = { ...original, id: 'mix-2', name: 'Advanced mix (Copy)' };

    const originalPlayback = buildAdvancedPlaybackSnapshot(baseSnapshot, original);
    const duplicatePlayback = buildAdvancedPlaybackSnapshot(baseSnapshot, duplicate);

    expect(originalPlayback.lyrics).toEqual(lyrics);
    expect(duplicatePlayback.lyrics).toEqual(lyrics);
    expect(originalPlayback.tracks).toEqual([{ id: 'track-1', muted: true }]);
    expect(duplicatePlayback.tracks).toEqual(originalPlayback.tracks);
  });

  it('does not retain lyrics from an advanced snapshot when the source project has none', () => {
    const playback = buildAdvancedPlaybackSnapshot({ projectId: 'project-1' }, {
      projectId: 'project-1',
      presetId: ADVANCED_MIX_PRESET_ID,
      advancedMix: {
        snapshot: {
          lyrics: { lines: [{ id: 'stale-line', text: 'Stale lyric', startMs: 0 }] },
        },
      },
    });

    expect(playback.lyrics).toBeNull();
  });
});

describe('ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS', () => {
  it('maps the configured numeric range evenly between omitted and solo', () => {
    const byStep = new Map(
      ADVANCED_MIX_PRACTICE_FOCUS_STEPS.map((step, index) => [
        step,
        ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS[index],
      ])
    );

    expect(byStep.get('omitted')).toBe(0);
    expect(byStep.get(-15)).toBe(8);
    expect(byStep.get(0)).toBe(50);
    expect(byStep.get(15)).toBe(92);
    expect(byStep.get('solo')).toBe(100);
  });
});
