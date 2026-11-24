import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerDashboard from '../PlayerDashboard';
import { fetchPlayerMyDevice, fetchPlayerTuttiMixes } from '../../lib/serverApi';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const mockSnapshot = {
  durationMs: 30000,
  tracks: [],
  lyrics: {
    useSyncedLyrics: true,
    lines: [
      { id: 'line-1', text: 'First line of lyrics', startMs: 0 },
      { id: 'line-2', text: 'Second line of lyrics', startMs: 2000 },
    ],
  },
};

vi.mock('../../lib/serverApi', () => ({
  fetchPlayerMyDevice: vi.fn(async () => ({
    folders: [],
    playlists: [],
    playlistItemsByPlaylistId: {},
    myMixes: [],
  })),
  fetchPlayerTuttiMixes: vi.fn(async () => [
    {
      id: 'mix-1',
      projectId: 'proj-1',
      presetId: 'full',
      name: 'Song with Lyrics',
      showId: 'show-1',
      showName: 'Show One',
      durationMs: 30000,
    },
  ]),
  fetchPlayerGlobalMixes: vi.fn(async () => []),
  fetchPlayerSearchCredits: vi.fn(async () => []),
  getProjectCredits: vi.fn(async () => ({})),
  bootstrapServerProject: vi.fn(async () => ({
    seq: 1,
    snapshot: mockSnapshot,
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

vi.mock('../../lib/playerSnapshotCache', () => ({
  resolvePlayerProjectSnapshot: vi.fn(async () => ({
    snapshot: mockSnapshot,
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
  },
}));

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('PlayerDashboard - Settings and Lyrics View Priority', () => {
  let view;
  const session = {
    user: { id: 'user-1', name: 'Test User', isAdmin: false },
  };

  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {
        enumerateDevices: vi.fn(async () => []),
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    } else {
      navigator.mediaDevices.getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    }
    window.alert = vi.fn();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('allows opening settings when lyrics is open and returns to lyrics when closing settings', async () => {
    await act(async () => {
      view = render(
        <PlayerDashboard
          session={session}
          onLogout={vi.fn()}
          onSwitchToDawDashboard={vi.fn()}
        />
      );
    });

    // Wait for initial data to load and render the song in the table
    const songRow = Array.from(view.container.querySelectorAll('div')).find(
      (el) => el.textContent.includes('Song with Lyrics') && el.className.includes('grid-cols-')
    );
    expect(songRow).toBeTruthy();

    // Double-click to play the song
    await act(async () => {
      songRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    // Now currentPlaybackLyrics is set. Let's find the lyrics toggle button in the bottom bar
    const lyricsButton = view.container.querySelector('button[title="Lyrics"][aria-label="Lyrics"]');
    expect(lyricsButton).toBeTruthy();
    expect(lyricsButton.disabled).toBe(false);

    // Toggle lyrics open
    await act(async () => {
      lyricsButton.click();
    });

    // Verify lyrics view is open
    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeTruthy();
    expect(lyricsButton.getAttribute('aria-pressed')).toBe('true');

    // Open User profile menu
    const userMenuButton = view.container.querySelector('button[title="User menu"]');
    expect(userMenuButton).toBeTruthy();
    await act(async () => {
      userMenuButton.click();
    });

    // Click "Settings" in the user menu dropdown
    const settingsMenuItem = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Settings'
    );
    expect(settingsMenuItem).toBeTruthy();
    await act(async () => {
      settingsMenuItem.click();
    });

    // Verify Settings panel IS OPEN and lyrics view is NOT visible
    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeNull();
    const settingsHeader = Array.from(view.container.querySelectorAll('h2')).find(
      (h) => h.textContent.trim() === 'Settings'
    );
    expect(settingsHeader).toBeTruthy();
    expect(view.container.textContent).toContain('Playback and device options for the player.');
    // In settings, the footer lyrics button should not show active state
    expect(lyricsButton.getAttribute('aria-pressed')).toBe('false');

    // Click the "Close" button inside the Settings panel
    const closeSettingsButton = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Close' && b.closest('.border-b')
    );
    expect(closeSettingsButton).toBeTruthy();
    await act(async () => {
      closeSettingsButton.click();
    });

    // Verify we are back on the Lyrics screen!
    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeTruthy();
    expect(lyricsButton.getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(view.container.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Settings')).toBe(false);
  });

  it('closes settings and returns to lyrics when clicking the lyrics button while settings is open', async () => {
    await act(async () => {
      view = render(
        <PlayerDashboard
          session={session}
          onLogout={vi.fn()}
          onSwitchToDawDashboard={vi.fn()}
        />
      );
    });

    const songRow = Array.from(view.container.querySelectorAll('div')).find(
      (el) => el.textContent.includes('Song with Lyrics') && el.className.includes('grid-cols-')
    );
    expect(songRow).toBeTruthy();
    await act(async () => {
      songRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const lyricsButton = view.container.querySelector('button[title="Lyrics"][aria-label="Lyrics"]');
    await act(async () => {
      lyricsButton.click();
    });

    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeTruthy();

    // Open settings
    const userMenuButton = view.container.querySelector('button[title="User menu"]');
    await act(async () => {
      userMenuButton.click();
    });
    const settingsMenuItem = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Settings'
    );
    await act(async () => {
      settingsMenuItem.click();
    });

    // Settings is visible
    expect(view.container.textContent).toContain('Playback and device options for the player.');
    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeNull();

    // Click lyrics button while in settings
    await act(async () => {
      lyricsButton.click();
    });

    // Verify settings closed and lyrics view is shown
    expect(view.container.querySelector('[aria-label="Lyrics lines"]')).toBeTruthy();
    expect(lyricsButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders Install App button to the left of the Player/DAW toggle in browser mode and hides it in standalone mode', async () => {
    // 1. Browser mode: should render Install App link
    await act(async () => {
      view = render(
        <PlayerDashboard
          session={session}
          onLogout={vi.fn()}
          onSwitchToDawDashboard={vi.fn()}
        />
      );
    });

    const installBtn = view.container.querySelector('a[href="/download"]');
    expect(installBtn).toBeTruthy();
    expect(installBtn.textContent).toContain('Install App');

    // Verify it is placed before the Player/DAW toggle in the DOM
    const dawBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'DAW'
    );
    expect(dawBtn).toBeTruthy();
    expect(installBtn.compareDocumentPosition(dawBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    view.unmount();
    view = null;

    // 2. Standalone mode: should NOT render Install App button
    window.Capacitor = { isNativePlatform: () => true };
    try {
      await act(async () => {
        view = render(
          <PlayerDashboard
            session={session}
            onLogout={vi.fn()}
            onSwitchToDawDashboard={vi.fn()}
          />
        );
      });

      expect(view.container.querySelector('a[href="/download"]')).toBeNull();
    } finally {
      delete window.Capacitor;
    }
  });

  it('uses default cursor on show and playlist rows, centers 3-dots column, and opens Move submenus', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    fetchPlayerTuttiMixes.mockResolvedValueOnce([
      {
        id: 'mix-tutti-1',
        projectId: 'proj-1',
        presetId: 'tutti',
        name: 'Opening Number',
        projectName: 'Opening Number',
        musicalNumber: '1.0',
        showId: 'show-1',
        showName: 'Show One',
        durationMs: 30000,
      },
      {
        id: 'mix-tutti-2',
        projectId: 'proj-2',
        presetId: 'tutti',
        name: 'Finale',
        projectName: 'Finale',
        musicalNumber: '2.0',
        showId: 'show-2',
        showName: 'Show Two',
        durationMs: 45000,
      },
    ]);
    fetchPlayerMyDevice.mockResolvedValueOnce({
      folders: [{ id: 'folder-1', name: 'Practice Folder', parentFolderId: null }],
      playlists: [
        { id: 'pl-1', name: 'Rehearsal A', folderId: null },
        { id: 'pl-2', name: 'Rehearsal B', folderId: null },
      ],
      playlistItemsByPlaylistId: {
        'pl-1': [
          {
            id: 'pi-1',
            mixId: 'mix-saved-1',
            mix: {
              id: 'mix-saved-1',
              projectId: 'proj-2',
              presetId: 'practice',
              name: 'Tenor Line',
              projectName: 'Finale',
              musicalNumber: '2.0',
              showId: 'show-2',
              showName: 'Show Two',
              durationMs: 45000,
            },
          },
        ],
        'pl-2': [],
      },
      mixes: [
        {
          id: 'mix-saved-1',
          projectId: 'proj-2',
          presetId: 'practice',
          name: 'Tenor Line',
          projectName: 'Finale',
          musicalNumber: '2.0',
          showId: 'show-2',
          showName: 'Show Two',
          durationMs: 45000,
        },
        {
          id: 'mix-saved-root',
          projectId: 'proj-1',
          presetId: 'practice',
          name: 'Root Saved Mix',
          projectName: 'Opening Number',
          musicalNumber: '1.0',
          showId: 'show-1',
          showName: 'Show One',
          folderId: null,
          durationMs: 30000,
        },
      ],
    });

    await act(async () => {
      view = render(
        <PlayerDashboard
          session={session}
          onLogout={vi.fn()}
          onSwitchToDawDashboard={vi.fn()}
        />
      );
    });

    // 1. Show row uses cursor-default and centered 3-dots cell in 56px trailing column
    const showRow = Array.from(view.container.querySelectorAll('.player-track-row')).find((el) => (
      el.textContent.includes('Opening Number')
    ));
    expect(showRow).toBeTruthy();
    expect(showRow.className).toContain('cursor-default');
    expect(showRow.className).not.toContain('cursor-pointer');
    expect(showRow.className).toContain('grid-cols-[72px_minmax(0,1fr)_64px_56px]');
    expect(showRow.className).toContain('pr-0');
    const showDotsBtn = showRow.querySelector('button[title="Options"]');
    expect(showDotsBtn.parentElement.className).toContain('justify-center');

    // 2. Right-clicking root saved mix opens "Move to playlist" submenu (NOT window.prompt)
    const rootMixSidebarBtn = Array.from(view.container.querySelectorAll('.player-library-row')).find((el) => (
      el.textContent.includes('Root Saved Mix')
    ));
    expect(rootMixSidebarBtn).toBeTruthy();
    await act(async () => {
      rootMixSidebarBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 160 }));
    });
    const moveToPlaylistBtn = Array.from(view.container.querySelectorAll('button')).find((b) => (
      b.textContent.includes('Move to playlist')
    ));
    expect(moveToPlaylistBtn).toBeTruthy();
    await act(async () => {
      moveToPlaylistBtn.click();
    });
    expect(promptSpy).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('New playlist');
    expect(view.container.textContent).toContain('Library root');
    const newPlNode = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'New playlist');
    const rootNode = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Library root');
    expect(newPlNode.nextElementSibling).toBe(rootNode);
    expect(rootNode.nextElementSibling?.className).toContain('border-t');

    // 3. Right-clicking a playlist opens "Move to folder" starting with "New folder", "Library root", separator
    const playlistSidebarBtn = Array.from(view.container.querySelectorAll('.player-library-row')).find((el) => (
      el.textContent.includes('Rehearsal A')
    ));
    await act(async () => {
      playlistSidebarBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 160 }));
    });
    const moveToFolderBtn = Array.from(view.container.querySelectorAll('button')).find((b) => (
      b.textContent.includes('Move to folder')
    ));
    expect(moveToFolderBtn).toBeTruthy();
    await act(async () => {
      moveToFolderBtn.click();
    });
    const newFolderNode = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'New folder');
    const folderRootNode = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Library root');
    expect(newFolderNode).toBeTruthy();
    expect(newFolderNode.nextElementSibling).toBe(folderRootNode);
    expect(folderRootNode.nextElementSibling?.className).toContain('border-t');

    // 4. Open Rehearsal A playlist: rows use cursor-default, show name is clickable cursor-pointer -> navigates to Show Two
    await act(async () => {
      playlistSidebarBtn.click();
    });
    const playlistRow = Array.from(view.container.querySelectorAll('.player-track-row')).find((el) => (
      el.textContent.includes('Tenor Line')
    ));
    expect(playlistRow).toBeTruthy();
    expect(playlistRow.className).toContain('cursor-default');
    expect(playlistRow.className).not.toContain('cursor-grab');
    expect(playlistRow.className).toContain('grid-cols-[44px_minmax(0,1fr)_64px_56px]');
    expect(playlistRow.className).toContain('pr-0');
    const playlistDotsBtn = playlistRow.querySelector('button[title="Options"]');
    expect(playlistDotsBtn.parentElement.className).toContain('justify-center');

    const showLinkBtn = Array.from(playlistRow.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Show Two');
    expect(showLinkBtn).toBeTruthy();
    expect(showLinkBtn.className).toContain('cursor-pointer');
    await act(async () => {
      showLinkBtn.click();
    });
    expect(view.container.querySelector('h2')?.textContent).toBe('Show Two');
  });
});
