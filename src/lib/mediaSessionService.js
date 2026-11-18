/**
 * MediaSession API integration and mobile background audio keep-alive
 * Enables lock-screen controls, OS media notifications, and background playback
 * on iOS and Android.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { audioManager } from './audioManager';

// Native ApolloMedia Capacitor Plugin
const ApolloMedia = registerPlugin('ApolloMedia');
const isNative = typeof Capacitor !== 'undefined' && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform();

let nativeListenerRegistered = false;
let currentMetadata = {
  title: 'Apollo Track',
  artist: 'Apollo Choir',
  album: '',
  artworkUrl: '/icon-512.png',
  durationSec: 0,
};
let currentPlaybackState = {
  isPlaying: false,
  positionSec: 0,
};

export const PAUSE_DISMISS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes, same as Spotify

let hasStartedPlayback = false;
let pauseDismissTimer = null;

// 46-byte minimal silent WAV loop fallback
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

let cachedSilentUrl = null;
let keepAliveAudioElement = null;
let keepAlivePauseTimeout = null;
let currentActionHandlers = {};

/**
 * Creates a valid 2-second silent WAV audio blob (8kHz 8-bit mono PCM)
 * so Android and iOS audio daemons recognize an active media stream with a measurable duration.
 */
function getSilentAudioUrl() {
  if (cachedSilentUrl) return cachedSilentUrl;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return SILENT_WAV_DATA_URL;
  }
  try {
    const sampleRate = 44100;
    const numChannels = 1;
    const durationSec = 10;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false); // 'RIFF'
    view.setUint32(4, 36 + numSamples * 2, true);
    view.setUint32(8, 0x57415645, false); // 'WAVE'
    view.setUint32(12, 0x666d7420, false); // 'fmt '
    view.setUint32(16, 16, true); // PCM header length (16)
    view.setUint16(20, 1, true); // Format: 1 (PCM)
    view.setUint16(22, numChannels, true); // Mono (1)
    view.setUint32(24, sampleRate, true); // 44100 Hz
    view.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate (88200)
    view.setUint16(32, numChannels * 2, true); // Block align (2)
    view.setUint16(34, 16, true); // 16-bit
    view.setUint32(36, 0x64617461, false); // 'data'
    view.setUint32(40, numSamples * 2, true); // Data length (882000)

    const samples = new Int16Array(buffer, 44, numSamples);
    // Sub-audible 30Hz sine wave (amplitude 120 in 16-bit signed PCM: -48.7 dBFS).
    // Exactly 300 complete cycles in 10 seconds at 44100Hz (30 * 10 = 300) for seamless looping.
    // Duration is 10.0 seconds, exceeding Chromium's hardcoded 5.0-second threshold
    // required for persistent AudioFocus and MediaSession notification creation on Android.
    for (let i = 0; i < numSamples; i++) {
      samples[i] = Math.round(120 * Math.sin((2 * Math.PI * 30 * i) / sampleRate));
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    cachedSilentUrl = URL.createObjectURL(blob);
    return cachedSilentUrl;
  } catch {
    return SILENT_WAV_DATA_URL;
  }
}

function getKeepAliveElement() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!keepAliveAudioElement) {
    try {
      let audio = document.getElementById('apollo-media-session-audio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'apollo-media-session-audio';
        audio.setAttribute('aria-hidden', 'true');
        audio.style.position = 'fixed';
        audio.style.width = '1px';
        audio.style.height = '1px';
        audio.style.opacity = '0.01';
        audio.style.pointerEvents = 'none';
        audio.style.bottom = '0';
        audio.style.right = '0';
        if (document.body) {
          document.body.appendChild(audio);
        } else {
          window.addEventListener('DOMContentLoaded', () => {
            if (audio && !audio.parentNode && document.body) {
              document.body.appendChild(audio);
            }
          });
        }
      }
      audio.src = getSilentAudioUrl();
      audio.loop = true;
      audio.muted = false;
      audio.volume = 1.0; // Audible volume so Android does not silence-detect and suppress notifications
      audio.preload = 'auto';
      audio.addEventListener('error', () => {
        try {
          const fallbackUrl = toAbsoluteUrl('/keepalive.wav');
          if (audio.src !== fallbackUrl) {
            audio.src = fallbackUrl;
            audio.load();
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        } catch {}
      });
      keepAliveAudioElement = audio;
    } catch {
      keepAliveAudioElement = null;
    }
  } else if (keepAliveAudioElement && !keepAliveAudioElement.parentNode && document.body) {
    try {
      document.body.appendChild(keepAliveAudioElement);
    } catch {}
  }
  return keepAliveAudioElement;
}

/**
 * Convert relative URL to absolute URL for Android MediaSession system service
 */
function toAbsoluteUrl(url) {
  if (typeof window === 'undefined' || !url) return url || '';
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

/**
 * Prime and unlock the background audio element and notification permissions within an active user gesture
 */
export function unlockAudioSession() {
  const audio = getKeepAliveElement();
  if (audio) {
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {}
  }

  // On Android 13+, lock-screen media controls require POST_NOTIFICATIONS permission
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    try {
      Notification.requestPermission().catch(() => {});
    } catch {}
  }
}

export function getMediaNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestMediaNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

if (typeof window !== 'undefined') {
  const primeGesture = () => {
    // Only request permission for notifications on first user gesture; do not start keep-alive audio element before playback!
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission().catch(() => {});
      } catch {}
    }
    window.removeEventListener('pointerdown', primeGesture, true);
    window.removeEventListener('touchstart', primeGesture, true);
    window.removeEventListener('click', primeGesture, true);
  };
  window.addEventListener('pointerdown', primeGesture, true);
  window.addEventListener('touchstart', primeGesture, true);
  window.addEventListener('click', primeGesture, true);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (audioManager?.audioContext && audioManager.audioContext.state === 'suspended' && audioManager.isPlaying) {
          audioManager.audioContext.resume().catch(() => {});
        }
        const keepAlive = getKeepAliveElement();
        if (keepAlive && keepAlive.paused && navigator.mediaSession?.playbackState === 'playing') {
          keepAlive.play().catch(() => {});
        }
      }
    });
  }
}

export function isMediaSessionSupported() {
  return isNative || (typeof window !== 'undefined' && 'mediaSession' in navigator && Boolean(navigator.mediaSession));
}

/**
 * Configure MediaSession action handlers (play, pause, seek, track changes)
 */
export function setupMediaSession(handlers = {}) {
  currentActionHandlers = { ...handlers };

  if (isNative && !nativeListenerRegistered) {
    nativeListenerRegistered = true;
    try {
      ApolloMedia.addListener('mediaAction', (data) => {
        if (!data || !data.action) return;
        switch (data.action) {
          case 'play':
            currentActionHandlers.onPlay?.();
            break;
          case 'pause':
            currentActionHandlers.onPause?.();
            break;
          case 'next':
            currentActionHandlers.onNext?.();
            break;
          case 'previous':
            currentActionHandlers.onPrevious?.();
            break;
          case 'seek':
            if (typeof data.position === 'number') {
              currentActionHandlers.onSeekTo?.(data.position);
            }
            break;
        }
      });
    } catch (err) {
      console.warn('[ApolloMedia] Failed to add mediaAction listener:', err);
    }
  }

  if (typeof window === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) {
    return () => {
      currentActionHandlers = {};
    };
  }

  const actionMap = [
    ['play', () => currentActionHandlers.onPlay?.()],
    ['pause', () => currentActionHandlers.onPause?.()],
    ['stop', () => currentActionHandlers.onStop?.()],
  ];

  if (typeof handlers.onSeekTo === 'function') {
    actionMap.push(['seekto', (details) => {
      if (typeof details?.seekTime === 'number' && Number.isFinite(details.seekTime)) {
        currentActionHandlers.onSeekTo?.(details.seekTime);
      }
    }]);
  } else {
    try {
      navigator.mediaSession.setActionHandler('seekto', null);
    } catch {}
  }

  if (typeof handlers.onPrevious === 'function') {
    actionMap.push(['previoustrack', () => currentActionHandlers.onPrevious?.()]);
  } else {
    try {
      navigator.mediaSession.setActionHandler('previoustrack', null);
    } catch {}
  }

  if (typeof handlers.onNext === 'function') {
    actionMap.push(['nexttrack', () => currentActionHandlers.onNext?.()]);
  } else {
    try {
      navigator.mediaSession.setActionHandler('nexttrack', null);
    } catch {}
  }

  if (typeof handlers.onSeekBy === 'function') {
    actionMap.push(
      ['seekbackward', (details) => {
        const offset = Number(details?.seekOffset) || 5;
        currentActionHandlers.onSeekBy?.(-offset);
      }],
      ['seekforward', (details) => {
        const offset = Number(details?.seekOffset) || 5;
        currentActionHandlers.onSeekBy?.(offset);
      }]
    );
  } else {
    // Explicitly unregister seekbackward and seekforward so Chromium does NOT inject default +/- 10s or 5s buttons!
    try {
      navigator.mediaSession.setActionHandler('seekbackward', null);
    } catch {}
    try {
      navigator.mediaSession.setActionHandler('seekforward', null);
    } catch {}
  }

  for (const [action, handler] of actionMap) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers do not support all media session actions (e.g. previoustrack/seekto)
    }
  }

  return () => {
    for (const action of ['play', 'pause', 'stop', 'seekto', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward']) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {}
    }
    currentActionHandlers = {};
  };
}

/**
 * Update media session title, artist, album, and artwork
 */
export function updateMediaSessionMetadata({
  title = 'Apollo Track',
  artist = 'Apollo',
  album = 'Apollo DAW',
  artworkUrl = '/icon-512.png',
  durationSec = 0,
} = {}) {
  currentMetadata = {
    title: String(title || 'Apollo Track'),
    artist: String(artist || 'Apollo'),
    album: String(album || 'Apollo DAW'),
    artworkUrl: artworkUrl || '/icon-512.png',
    durationSec: Number(durationSec) || currentMetadata.durationSec || 0,
  };

  if (isNative) {
    const isDefaultArtwork = !artworkUrl ||
      artworkUrl === '/icon-512.png' ||
      artworkUrl === '/icon-192.png' ||
      artworkUrl.endsWith('/icon-512.png') ||
      artworkUrl.endsWith('/icon-192.png');

    try {
      ApolloMedia.setMetadata({
        title: currentMetadata.title,
        artist: currentMetadata.artist,
        album: currentMetadata.album,
        duration: currentMetadata.durationSec,
        artworkUrl: isDefaultArtwork ? '' : toAbsoluteUrl(currentMetadata.artworkUrl),
      }).catch(() => {});
    } catch {}
  }

  if (typeof window === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) return;

  const MediaMetadataCtor = window.MediaMetadata || globalThis.MediaMetadata;
  if (!MediaMetadataCtor) return;

  const icon192 = toAbsoluteUrl('/icon-192.png');
  const icon512 = toAbsoluteUrl(artworkUrl || '/icon-512.png');

  try {
    navigator.mediaSession.metadata = new MediaMetadataCtor({
      title: currentMetadata.title,
      artist: currentMetadata.artist,
      album: currentMetadata.album,
      artwork: [
        { src: icon192, sizes: '96x96', type: 'image/png' },
        { src: icon192, sizes: '128x128', type: 'image/png' },
        { src: icon192, sizes: '192x192', type: 'image/png' },
        { src: icon512, sizes: '256x256', type: 'image/png' },
        { src: icon512, sizes: '384x384', type: 'image/png' },
        { src: icon512, sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch (err) {
    console.warn('[MediaSession] Failed to set metadata:', err);
  }
}

/**
 * Set playback state ('playing' or 'paused') and manage background keep-alive
 */
export function setMediaSessionPlaybackState(isPlaying, positionSec = null) {
  const willPlay = Boolean(isPlaying);

  // If app is opened and nothing has ever played, do NOT create a media session or show notification!
  if (!willPlay && !hasStartedPlayback) {
    currentPlaybackState.isPlaying = false;
    if (typeof positionSec === 'number') {
      currentPlaybackState.positionSec = positionSec;
    }
    return;
  }

  hasStartedPlayback = true;
  currentPlaybackState.isPlaying = willPlay;
  if (typeof positionSec === 'number') {
    currentPlaybackState.positionSec = positionSec;
  }

  if (pauseDismissTimer) {
    clearTimeout(pauseDismissTimer);
    pauseDismissTimer = null;
  }

  if (isNative) {
    try {
      ApolloMedia.setPlaybackState({
        state: willPlay ? 'playing' : 'paused',
        position: currentPlaybackState.positionSec,
      }).catch(() => {});
    } catch {}
  }

  if (typeof window !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession) {
    try {
      navigator.mediaSession.playbackState = willPlay ? 'playing' : 'paused';
    } catch {}
  }

  const keepAlive = getKeepAliveElement();

  if (willPlay) {
    if (keepAlive) {
      try {
        const playPromise = keepAlive.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((err) => {
            console.warn('[MediaSession] Keep-alive play rejected:', err);
          });
        }
      } catch (err) {
        console.warn('[MediaSession] Keep-alive play failed:', err);
      }
    }
  } else {
    if (keepAlive) {
      try {
        keepAlive.pause();
      } catch {}
    }
    // Stay visible for 10 minutes after pause, then auto-dismiss (same as Spotify)
    pauseDismissTimer = setTimeout(() => {
      clearMediaSession();
    }, PAUSE_DISMISS_TIMEOUT_MS);
  }
}

let lastPositionUpdateMs = 0;
let lastReportedPositionSec = -1;

/**
 * Update playback position state for the lock-screen scrubber.
 * Throttles rapid calls during playback while applying seeks immediately.
 */
export function updateMediaSessionPositionState({
  durationSec = 0,
  positionSec = 0,
  playbackRate = 1.0,
  force = false,
} = {}) {
  const duration = Math.max(0, Number(durationSec) || 0);
  const position = Math.max(0, Math.min(duration || Infinity, Number(positionSec) || 0));
  const rate = Math.max(0.1, Number(playbackRate) || 1.0);

  const now = Date.now();
  const isSeek = Math.abs(position - lastReportedPositionSec) > 1.5;

  if (duration > 0 && duration !== currentMetadata.durationSec) {
    currentMetadata.durationSec = duration;
    if (isNative) {
      try {
        ApolloMedia.setMetadata({
          title: currentMetadata.title,
          artist: currentMetadata.artist,
          album: currentMetadata.album,
          duration: currentMetadata.durationSec,
          artworkUrl: toAbsoluteUrl(currentMetadata.artworkUrl),
        }).catch(() => {});
      } catch {}
    }
  }

  if (isNative && (force || isSeek)) {
    currentPlaybackState.positionSec = position;
    try {
      ApolloMedia.setPlaybackState({
        state: currentPlaybackState.isPlaying ? 'playing' : 'paused',
        position: position,
      }).catch(() => {});
    } catch {}
  }

  if (typeof window === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession || typeof navigator.mediaSession.setPositionState !== 'function') {
    return;
  }

  if (duration <= 0) return;

  if (!force && !isSeek && now - lastPositionUpdateMs < 1000) {
    return;
  }

  lastPositionUpdateMs = now;
  lastReportedPositionSec = position;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: rate,
      position,
    });
  } catch {
    // Ignore invalid position bounds
  }
}

/**
 * Reset media session and stop keep-alive
 */
export function clearMediaSession() {
  hasStartedPlayback = false;
  currentPlaybackState.isPlaying = false;
  currentPlaybackState.positionSec = 0;

  if (pauseDismissTimer) {
    clearTimeout(pauseDismissTimer);
    pauseDismissTimer = null;
  }

  if (isNative) {
    try {
      ApolloMedia.clear?.().catch(() => {});
    } catch {}
  }

  if (typeof window === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) return;

  if (keepAlivePauseTimeout) {
    clearTimeout(keepAlivePauseTimeout);
    keepAlivePauseTimeout = null;
  }

  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  } catch {}

  lastPositionUpdateMs = 0;
  lastReportedPositionSec = -1;

  if (keepAliveAudioElement) {
    try {
      keepAliveAudioElement.pause();
    } catch {}
  }
}
