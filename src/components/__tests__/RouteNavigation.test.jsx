import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerDashboard from '../PlayerDashboard';
import HostedDashboard from '../HostedDashboard';
import AdminPanel from '../AdminPanel';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const mockSnapshot = {
  durationMs: 30000,
  tracks: [],
  lyrics: {
    useSyncedLyrics: false,
    lines: [],
  },
};

vi.mock('../../lib/serverApi', () => ({
  fetchPlayerMyDevice: vi.fn(async () => ({
    folders: [
      { id: 'folder-1', name: 'My Folder', parentFolderId: null },
    ],
    playlists: [
      { id: 'playlist-1', name: 'My Favorites', folderId: null },
    ],
    playlistItemsByPlaylistId: {
      'playlist-1': [
        {
          id: 'item-1',
          mixId: 'mix-1',
          playlistId: 'playlist-1',
          unavailable: false,
          mix: { id: 'mix-1', name: 'Song in Playlist', durationMs: 30000 },
        },
      ],
    },
    mixes: [
      {
        id: 'user-mix-1',
        projectId: 'proj-1',
        presetId: 'custom',
        name: 'My Custom Mix',
        folderId: 'folder-1',
      },
    ],
  })),
  fetchPlayerTuttiMixes: vi.fn(async () => [
    {
      id: 'tutti-mix-1',
      projectId: 'proj-1',
      presetId: 'full',
      name: 'Overture',
      showId: 'show-1',
      showName: 'Show One',
      durationMs: 30000,
    },
    {
      id: 'tutti-mix-2',
      projectId: 'proj-2',
      presetId: 'full',
      name: 'Act 1 Finale',
      showId: 'show-2',
      showName: 'Show Two',
      durationMs: 45000,
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
  listShows: vi.fn(async () => [
    { id: 'show-1', name: 'Show One', canSeeShow: true },
    { id: 'show-2', name: 'Show Two', canSeeShow: true },
  ]),
  listServerProjects: vi.fn(async () => [
    { id: 'proj-1', name: 'Overture', showId: 'show-1' },
    { id: 'proj-2', name: 'Act 1 Finale', showId: 'show-2' },
  ]),
  listRbacRoles: vi.fn(async () => [
    { id: 'role-1', name: 'Band Leader', memberCount: 2, linkCount: 0 },
    { id: 'role-2', name: 'Choir Director', memberCount: 5, linkCount: 1 },
  ]),
  listUsers: vi.fn(async () => []),
  listAdminArtists: vi.fn(async () => ({ users: [], groups: [], guests: [] })),
  getRbacCatalog: vi.fn(async () => ({ shows: [], projects: [], groupNames: [], partNames: [] })),
  listAdminStorage: vi.fn(async () => ({ totalBytes: 0, quarantineCount: 0 })),
  getRbacRole: vi.fn(async (id) => ({
    id,
    name: id === 'role-1' ? 'Band Leader' : 'Choir Director',
    parentRoleIds: [],
    childRoleIds: [],
    members: [],
    oidcLinks: [],
    grants: [],
  })),
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
  createStaleAudioLoadError: () => new Error('StaleAudioLoad'),
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

function LocationTracker({ onChange }) {
  const location = useLocation();
  onChange?.(location);
  return <div data-testid="location-path">{location.pathname}{location.search}</div>;
}

describe('URL Routing & Deep Linking', () => {
  let container;
  let root;

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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const session = {
    token: 'test-token',
    user: { id: 'user-1', username: 'johan', isAdmin: true },
    accessSummary: {},
  };

  it('deep links into a specific show in the Player', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/shows/show-2']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Verify Show Two and Act 1 Finale are displayed
    expect(container.textContent).toContain('Show Two');
    expect(container.textContent).toContain('Act 1 Finale');
  });

  it('deep links into an accessible playlist', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/playlists/playlist-1']}>
          <Routes>
            <Route path="/player/playlists/:playlistId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('My Favorites');
  });

  it('falls back to /player when accessing a non-existent or private playlist', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/playlists/non-existent-playlist']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/playlists/:playlistId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Should redirect to /player and display notice
    expect(currentLocation?.pathname).toBe('/player');
    expect(container.textContent).toContain('Playlist not found or private');
  });

  it('falls back to Tutti song when attempting to play an inaccessible/private mix whose project is in Tutti', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player?play=proj-2']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // The ?play param should be consumed and cleared
    expect(currentLocation?.search).not.toContain('play=');
  });

  it('syncs ?show=:showId query parameter in HostedDashboard', async () => {
    const shows = [
      { id: 'show-1', name: 'Show One', canSeeShow: true },
      { id: 'show-2', name: 'Show Two', canSeeShow: true },
    ];
    const projects = [
      { id: 'proj-1', name: 'Overture', showId: 'show-1', musicalNumber: '1.0' },
      { id: 'proj-2', name: 'Act 1 Finale', showId: 'show-2', musicalNumber: '2.0' },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/daw?show=show-2']}>
          <HostedDashboard
            session={session}
            shows={shows}
            projects={projects}
            onOpenProject={vi.fn()}
            onCreateProject={vi.fn()}
          />
        </MemoryRouter>
      );
    });

    // Should display Show Two's projects
    expect(container.textContent).toContain('Show Two');
    expect(container.textContent).toContain('Act 1 Finale');
    expect(container.textContent).not.toContain('Overture');
  });

  it('deep links into Admin role detail at /admin/roles/:roleId', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/roles/role-1']}>
          <Routes>
            <Route
              path="/admin/roles/:roleId"
              element={<AdminPanel session={session} onClose={vi.fn()} onLogout={vi.fn()} />}
            />
            <Route
              path="/admin/:tab"
              element={<AdminPanel session={session} onClose={vi.fn()} onLogout={vi.fn()} />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    // Verify role detail is rendered with role name
    expect(container.textContent).toContain('Band Leader');
  });

  it('deep links to player search and changes filter tabs without resetting or flickering', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/search?q=Show&type=all']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/search" element={<PlayerDashboard session={session} />} />
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('Results for “Show”');

    // Find the "Shows" filter button
    const buttons = Array.from(container.querySelectorAll('button'));
    const showsTabButton = buttons.find((b) => b.textContent?.startsWith('Shows'));
    expect(showsTabButton).toBeDefined();

    await act(async () => {
      showsTabButton.click();
    });

    // URL should have updated to type=shows
    expect(currentLocation?.search).toContain('type=shows');
    expect(currentLocation?.search).toContain('q=Show');
    // Shows tab should have active styles (bg-white)
    expect(showsTabButton.className).toContain('bg-white');
  });

  it('navigates to show page and exits search results when clicking a show in search', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/search?q=Show&type=shows']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/search" element={<PlayerDashboard session={session} />} />
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('Results for “Show”');

    // Click on the result for "Show One"
    const buttons = Array.from(container.querySelectorAll('button'));
    const showOneItem = buttons.find((b) => b.textContent?.includes('Show One'));
    expect(showOneItem).toBeDefined();

    await act(async () => {
      showOneItem.click();
    });

    // Should navigate to /player/shows/show-1
    expect(currentLocation?.pathname).toBe('/player/shows/show-1');
    // Should have exited search results page
    expect(container.textContent).not.toContain('Results for “Show”');
    expect(container.textContent).toContain('Show One');
  });

  it('starts search from /player without rubberbanding typed characters', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/search" element={<PlayerDashboard session={session} />} />
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const searchInput = container.querySelector('input[placeholder="What do you want to play?"]');
    expect(searchInput).toBeDefined();
    expect(searchInput.value).toBe('');

    // Type the first character while at /player
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(searchInput, 's');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Should immediately navigate to /player/search?q=s
    expect(currentLocation?.pathname).toBe('/player/search');
    expect(currentLocation?.search).toContain('q=s');
    // Input value should retain the character 's' (not rubberbanded to '')
    expect(searchInput.value).toBe('s');

    // Type further characters
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(searchInput, 'show');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(searchInput.value).toBe('show');
  });

  it('navigates to show on the first click from search results without bouncing back', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/search?q=Show&type=all']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/search" element={<PlayerDashboard session={session} />} />
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('Results for “Show”');

    // Click on Show Two
    const buttons = Array.from(container.querySelectorAll('button'));
    const showTwoItem = buttons.find((b) => b.textContent?.includes('Show Two'));
    expect(showTwoItem).toBeDefined();

    await act(async () => {
      showTwoItem.click();
    });

    // Should immediately navigate to /player/shows/show-2 on the FIRST click
    expect(currentLocation?.pathname).toBe('/player/shows/show-2');
    expect(container.textContent).toContain('Show Two');
    expect(container.textContent).not.toContain('Results for “Show”');
  });

  it('clears search without rubberbanding when deleting characters to empty', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player/search?q=test&type=all']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player/search" element={<PlayerDashboard session={session} />} />
            <Route path="/player/shows/:showId" element={<PlayerDashboard session={session} />} />
            <Route path="/player" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const searchInput = container.querySelector('input[placeholder="What do you want to play?"]');
    expect(searchInput).toBeDefined();
    expect(searchInput.value).toBe('test');

    // Simulate clearing the input
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(searchInput, '');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(currentLocation?.pathname).toBe('/player');
    expect(searchInput.value).toBe('');
  });

  it('opens a playlist from the library sidebar, updating URL and displaying playlist content', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player" element={<PlayerDashboard session={session} />} />
            <Route path="/player/playlists/:playlistId" element={<PlayerDashboard session={session} />} />
            <Route path="/player/folders/:folderId" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Find the playlist entry in the sidebar
    const buttons = Array.from(container.querySelectorAll('button'));
    const playlistButton = buttons.find((b) => b.textContent?.includes('My Favorites'));
    expect(playlistButton).toBeDefined();

    await act(async () => {
      playlistButton.click();
    });

    expect(currentLocation?.pathname).toBe('/player/playlists/playlist-1');
    expect(container.textContent).toContain('My Favorites');
    expect(container.textContent).toContain('Song in Playlist');
  });

  it('opens a folder from the library sidebar, updating URL and scoping sidebar view', async () => {
    let currentLocation = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/player']}>
          <LocationTracker onChange={(loc) => { currentLocation = loc; }} />
          <Routes>
            <Route path="/player" element={<PlayerDashboard session={session} />} />
            <Route path="/player/playlists/:playlistId" element={<PlayerDashboard session={session} />} />
            <Route path="/player/folders/:folderId" element={<PlayerDashboard session={session} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Find the folder entry in the sidebar
    const buttons = Array.from(container.querySelectorAll('button'));
    const folderButton = buttons.find((b) => b.textContent?.includes('My Folder'));
    expect(folderButton).toBeDefined();

    await act(async () => {
      folderButton.click();
    });

    expect(currentLocation?.pathname).toBe('/player/folders/folder-1');
    // Sidebar should now show "Back to Your Library" button
    const backButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label') === 'Back to Your Library'
    );
    expect(backButton).toBeDefined();

    // Clicking back button should return to /player
    await act(async () => {
      backButton.click();
    });
    expect(currentLocation?.pathname).toBe('/player');
  });
});
