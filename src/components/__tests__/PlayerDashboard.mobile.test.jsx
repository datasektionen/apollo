import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import PlayerDashboard from '../PlayerDashboard';
import * as useIsMobileModule from '../../hooks/useIsMobile';
import * as serverApiModule from '../../lib/serverApi';
import { audioManager } from '../../lib/audioManager';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/serverApi', () => ({
  fetchPlayerMyDevice: vi.fn(async () => ({
    folders: [],
    playlists: [],
    playlistItemsByPlaylistId: {},
    mixes: [],
  })),
  fetchPlayerTuttiMixes: vi.fn(async () => [
    {
      id: 'mix-tutti-1',
      projectId: 'proj-1',
      presetId: 'tutti',
      name: 'Choir Opening Song',
      musicalNumber: '01.0',
      showId: 'show-1',
      showName: 'Show One',
      durationMs: 180000,
    },
  ]),
  fetchPlayerGlobalMixes: vi.fn(async () => []),
  fetchPlayerSearchCredits: vi.fn(async () => []),
  getProjectCredits: vi.fn(async () => ({})),
  bootstrapServerProject: vi.fn(async () => ({
    seq: 1,
    snapshot: { durationMs: 180000, tracks: [] },
  })),
  createVirtualMix: vi.fn(),
  updateVirtualMix: vi.fn(),
  deleteVirtualMix: vi.fn(),
  createPlayerFolder: vi.fn(),
  updatePlayerFolder: vi.fn(),
  deletePlayerFolder: vi.fn(),
  createPlayerPlaylist: vi.fn(),
  updatePlayerPlaylist: vi.fn(),
  deletePlayerPlaylist: vi.fn(),
  addPlayerPlaylistItem: vi.fn(),
  deletePlayerPlaylistItem: vi.fn(),
  reorderPlayerPlaylistItems: vi.fn(),
  downloadMediaBlob: vi.fn(),
}));

vi.mock('../../lib/audioManager', () => ({
  audioManager: {
    mediaCache: new Map(),
    play: vi.fn(async () => {}),
    stop: vi.fn(),
    pause: vi.fn(async () => {}),
    seek: vi.fn(async () => {}),
    getCurrentTime: vi.fn(() => 0),
    loadAudioBuffer: vi.fn(async () => null),
    decodeAudioFile: vi.fn(async () => null),
    updateTrackMix: vi.fn(),
    setOutputVolume: vi.fn(),
    setPlaybackRate: vi.fn(async () => {}),
    setTransposeSemitones: vi.fn(async () => {}),
    setPlaybackSpeedSettings: vi.fn(),
    setPlaybackOutputConfig: vi.fn(async () => {}),
    setMasterVolumeCurve: vi.fn(),
    setMasterHeadroomEnabled: vi.fn(),
    setPanLawStereoDb: vi.fn(),
    applyOutputDeviceAndPanLaw: vi.fn(async () => {}),
    setOutputDevice: vi.fn(async () => {}),
    getAudioContext: vi.fn(() => ({ destination: {} })),
    subscribePlaybackInterrupted: vi.fn(() => () => {}),
    isPlaying: false,
  },
}));

vi.mock('../../lib/playerSnapshotCache', () => ({
  resolvePlayerProjectSnapshot: vi.fn(async () => ({
    snapshot: { durationMs: 180000, tracks: [] },
    latestSeq: 1,
    reused: false,
  })),
  readCachedProjectSnapshot: vi.fn(() => null),
  writeCachedProjectSnapshot: vi.fn(),
}));

vi.mock('../../lib/loadStemAudio', () => ({
  loadStemsIntoMediaCache: vi.fn(async () => ({
    audioBuffers: new Map(),
    failedBlobIds: [],
  })),
  createStaleAudioLoadError: () => {
    const error = new Error('StaleAudioLoad');
    error.name = 'StaleAudioLoad';
    return error;
  },
}));

describe('PlayerDashboard mobile layout detection', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, val) => store.set(key, String(val)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    vi.restoreAllMocks();
  });

  it('renders mobile layout with Spotify tabs when useIsMobile returns true', async () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(true);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlayerDashboard
            session={{ user: { id: 'u1', name: 'Test User' }, accessSummary: {} }}
            onLogout={() => {}}
          />
        </MemoryRouter>
      );
    });

    // Check for mobile navigation bar with 3 tabs
    const nav = container.querySelector('nav[aria-label="Mobile Navigation"]');
    expect(nav).not.toBeNull();
    expect(nav.textContent).toContain('Home');
    expect(nav.textContent).toContain('Search');
    expect(nav.textContent).toContain('Your Library');
    expect(nav.textContent).not.toContain('Create');

    // Desktop 3-column elements should NOT be rendered in mobile view
    expect(container.querySelector('[data-player-region="transport-bar"]')).toBeNull(); // desktop bottom player bar region
  });

  it('renders desktop layout when useIsMobile returns false', async () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(false);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlayerDashboard
            session={{ user: { id: 'u1', name: 'Test User' }, accessSummary: {} }}
            onLogout={() => {}}
          />
        </MemoryRouter>
      );
    });

    // Mobile nav should NOT be rendered
    expect(container.querySelector('nav[aria-label="Mobile Navigation"]')).toBeNull();

    // Desktop bottom player bar should be rendered
    expect(container.querySelector('[data-player-region="transport-bar"]')).not.toBeNull();
  });

  it('starts playback when clicking a song row in mobile Home tab', async () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(true);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlayerDashboard
            session={{ user: { id: 'u1', name: 'Test User' }, accessSummary: {} }}
            onLogout={() => {}}
          />
        </MemoryRouter>
      );
    });

    // Verify track rendered on Home
    expect(container.textContent).toContain('Choir Opening Song');

    // Click on the song row to trigger mobile playback
    const songRow = Array.from(container.querySelectorAll('div[role="button"]'))
      .find((el) => el.textContent.includes('Choir Opening Song'));
    expect(songRow).not.toBeNull();

    await act(async () => {
      songRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // audioManager.play should be invoked
    expect(audioManager.play).toHaveBeenCalled();
  });
});
