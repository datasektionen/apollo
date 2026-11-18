import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMediaSession,
  isMediaSessionSupported,
  setMediaSessionPlaybackState,
  setupMediaSession,
  unlockAudioSession,
  updateMediaSessionMetadata,
  updateMediaSessionPositionState,
} from '../mediaSessionService';

describe('MediaSession API & Mobile Background Audio Service', () => {
  let mockMediaSession;
  let mockActionHandlers;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockActionHandlers = {};
    mockMediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action, handler) => {
        mockActionHandlers[action] = handler;
      }),
      setPositionState: vi.fn(),
    };

    Object.defineProperty(navigator, 'mediaSession', {
      value: mockMediaSession,
      writable: true,
      configurable: true,
    });

    globalThis.MediaMetadata = class MockMediaMetadata {
      constructor(init) {
        Object.assign(this, init);
      }
    };
  });

  it('detects mediaSession support', () => {
    expect(isMediaSessionSupported()).toBe(true);
  });

  it('registers all standard mediaSession action handlers and invokes callbacks', () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    const onSeekTo = vi.fn();
    const onSeekBy = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();

    const cleanup = setupMediaSession({
      onPlay,
      onPause,
      onStop,
      onSeekTo,
      onSeekBy,
      onPrevious,
      onNext,
    });

    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('seekto', expect.any(Function));

    // Test invoking handlers
    mockActionHandlers.play();
    expect(onPlay).toHaveBeenCalled();

    mockActionHandlers.pause();
    expect(onPause).toHaveBeenCalled();

    mockActionHandlers.stop();
    expect(onStop).toHaveBeenCalled();

    mockActionHandlers.seekto({ seekTime: 42.5 });
    expect(onSeekTo).toHaveBeenCalledWith(42.5);

    mockActionHandlers.seekforward({ seekOffset: 10 });
    expect(onSeekBy).toHaveBeenCalledWith(10);

    mockActionHandlers.seekbackward({ seekOffset: 5 });
    expect(onSeekBy).toHaveBeenCalledWith(-5);

    mockActionHandlers.previoustrack();
    expect(onPrevious).toHaveBeenCalled();

    mockActionHandlers.nexttrack();
    expect(onNext).toHaveBeenCalled();

    cleanup();
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('play', null);
  });

  it('explicitly disables seekbackward and seekforward when onSeekBy is omitted', () => {
    setupMediaSession({
      onPlay: vi.fn(),
      onPause: vi.fn(),
    });

    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('seekbackward', null);
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('seekforward', null);
  });

  it('updates metadata with track title, artist, album, and artwork', () => {
    updateMediaSessionMetadata({
      title: 'Amazing Grace',
      artist: 'Choir Tenors',
      album: 'Rehearsal Set 1',
    });

    expect(mockMediaSession.metadata).toBeDefined();
    expect(mockMediaSession.metadata.title).toBe('Amazing Grace');
    expect(mockMediaSession.metadata.artist).toBe('Choir Tenors');
    expect(mockMediaSession.metadata.album).toBe('Rehearsal Set 1');
    expect(mockMediaSession.metadata.artwork).toHaveLength(6);
  });

  it('updates playback state and manages keep-alive element', () => {
    setMediaSessionPlaybackState(true);
    expect(mockMediaSession.playbackState).toBe('playing');

    setMediaSessionPlaybackState(false);
    expect(mockMediaSession.playbackState).toBe('paused');
  });

  it('updates mediaSession position state', () => {
    updateMediaSessionPositionState({
      durationSec: 180,
      positionSec: 45,
      playbackRate: 1.25,
    });

    expect(mockMediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 180,
      position: 45,
      playbackRate: 1.25,
    });
  });

  it('clears mediaSession state and resets keepAlive on clearMediaSession', () => {
    setMediaSessionPlaybackState(true);
    clearMediaSession();

    expect(mockMediaSession.playbackState).toBe('none');
    expect(mockMediaSession.metadata).toBeNull();
  });

  it('safely attempts unlockAudioSession without throwing', () => {
    expect(() => unlockAudioSession()).not.toThrow();
  });

  it('does not activate media session on initial pause state before any playback', () => {
    clearMediaSession();
    expect(mockMediaSession.playbackState).toBe('none');

    // App mount calls setMediaSessionPlaybackState(false)
    setMediaSessionPlaybackState(false);
    // Should remain none (not paused, no media brick)
    expect(mockMediaSession.playbackState).toBe('none');
  });

  it('keeps media session paused for 10 minutes then automatically dismisses', () => {
    vi.useFakeTimers();
    clearMediaSession();

    // Start playback
    setMediaSessionPlaybackState(true);
    expect(mockMediaSession.playbackState).toBe('playing');

    // Pause playback
    setMediaSessionPlaybackState(false);
    expect(mockMediaSession.playbackState).toBe('paused');

    // 5 minutes in - still paused
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(mockMediaSession.playbackState).toBe('paused');

    // After 10 minutes total - dismissed!
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(mockMediaSession.playbackState).toBe('none');

    vi.useRealTimers();
  });
});
