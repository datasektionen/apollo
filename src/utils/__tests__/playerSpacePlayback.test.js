import { describe, expect, it } from 'vitest';
import {
  canResumePlayerPlayback,
  resolvePlayerSpaceAction,
} from '../playerSpacePlayback';

describe('resolvePlayerSpaceAction', () => {
  it('toggles the current song while playing even if another row is highlighted', () => {
    expect(resolvePlayerSpaceAction({
      isPlaying: true,
      canResumeCurrent: false,
      highlightedIndex: 2,
    })).toBe('toggle-current');
  });

  it('toggles the latest paused song before using the highlighted row', () => {
    expect(resolvePlayerSpaceAction({
      isPlaying: false,
      canResumeCurrent: true,
      highlightedIndex: 2,
    })).toBe('toggle-current');
  });

  it('plays the highlighted row when nothing is playing or paused', () => {
    expect(resolvePlayerSpaceAction({
      isPlaying: false,
      canResumeCurrent: false,
      highlightedIndex: 1,
    })).toBe('play-highlighted');
  });

  it('does nothing when there is no current song and no highlight', () => {
    expect(resolvePlayerSpaceAction({
      isPlaying: false,
      canResumeCurrent: false,
      highlightedIndex: -1,
    })).toBe('none');
  });
});

describe('canResumePlayerPlayback', () => {
  it('resumes realtime playback that has not reached the end', () => {
    expect(canResumePlayerPlayback({
      playbackEngine: 'realtime',
      currentTimeSec: 12,
      durationSec: 40,
      hasRealtimeItem: true,
    })).toBe(true);
  });

  it('does not resume realtime playback that has finished', () => {
    expect(canResumePlayerPlayback({
      playbackEngine: 'realtime',
      currentTimeSec: 40,
      durationSec: 40,
      hasRealtimeItem: true,
    })).toBe(false);
  });

  it('resumes html audio that still has a source and has not ended', () => {
    expect(canResumePlayerPlayback({
      playbackEngine: 'html',
      htmlAudio: { src: 'blob:mix', ended: false },
    })).toBe(true);
  });

  it('does not resume ended html audio', () => {
    expect(canResumePlayerPlayback({
      playbackEngine: 'html',
      htmlAudio: { src: 'blob:mix', ended: true },
    })).toBe(false);
  });
});
