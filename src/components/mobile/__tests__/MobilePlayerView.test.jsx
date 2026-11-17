import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MobilePlayerView from '../MobilePlayerView';
import MobileMiniPlayer from '../MobileMiniPlayer';
import MobileNowPlayingModal from '../MobileNowPlayingModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MobilePlayerView & Spotify-like UI Enhancements', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
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

  const mockQueueItem = {
    id: 'mix-1',
    name: 'Dear Bill',
    title: 'Dear Bill',
    projectName: 'Dear Bill',
    showName: 'Operation Mincemeat',
    musicalNumber: '01.0',
    durationMs: 351000,
  };

  it('renders top headers for Home, Search, and Your Library with uniform font size and user symbol on left', async () => {
    await act(async () => {
      root.render(
        <MobilePlayerView
          session={{ user: { name: 'Alice' } }}
          activeQueueItem={null}
          isPlaying={false}
          shows={[]}
          playlists={[]}
          folders={[]}
          tuttiMixes={[{ id: 'm1', name: 'Song 1', musicalNumber: '1.0' }]}
        />
      );
    });

    // 1. Home Tab Header
    const homeHeaderTitle = container.querySelector('h1');
    expect(homeHeaderTitle).not.toBeNull();
    expect(homeHeaderTitle.textContent).toBe('Home');
    expect(homeHeaderTitle.className).toContain('text-2xl font-bold');

    // User symbol button on left
    const userButtonHome = container.querySelector('button[aria-label="User Menu"]');
    expect(userButtonHome).not.toBeNull();

    // 2. Switch to Search Tab
    const searchTabButton = Array.from(container.querySelectorAll('nav button')).find((b) =>
      b.textContent.includes('Search')
    );
    await act(async () => {
      searchTabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const searchHeaderTitle = container.querySelector('h1');
    expect(searchHeaderTitle).not.toBeNull();
    expect(searchHeaderTitle.textContent).toBe('Search');
    expect(searchHeaderTitle.className).toContain('text-2xl font-bold');
    expect(container.querySelector('button[aria-label="User Menu"]')).not.toBeNull();

    // 3. Switch to Your Library Tab
    const libraryTabButton = Array.from(container.querySelectorAll('nav button')).find((b) =>
      b.textContent.includes('Your Library')
    );
    await act(async () => {
      libraryTabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const libraryHeaderTitle = container.querySelector('h1');
    expect(libraryHeaderTitle).not.toBeNull();
    expect(libraryHeaderTitle.textContent).toBe('Your Library');
    expect(libraryHeaderTitle.className).toContain('text-2xl font-bold');
    expect(container.querySelector('button[aria-label="User Menu"]')).not.toBeNull();
  });

  it('opens user menu with all desktop options when clicking user symbol', async () => {
    const handleLogout = vi.fn();
    const handleProfile = vi.fn();
    const handleSwitchDaw = vi.fn();
    const handleOpenAdmin = vi.fn();

    await act(async () => {
      root.render(
        <MobilePlayerView
          session={{ user: { name: 'Alice', email: 'alice@example.com', isAdmin: true } }}
          activeQueueItem={null}
          isPlaying={false}
          shows={[]}
          playlists={[]}
          folders={[]}
          tuttiMixes={[]}
          onLogout={handleLogout}
          onOpenProfile={handleProfile}
          onSwitchToDawDashboard={handleSwitchDaw}
          onOpenAdmin={handleOpenAdmin}
        />
      );
    });

    // Click user symbol
    const userButton = container.querySelector('button[aria-label="User Menu"]');
    expect(userButton).not.toBeNull();

    await act(async () => {
      userButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // User menu opens without user title (no "Apollo User" or user title header)
    const userMenu = container.querySelector('div[role="dialog"][aria-label="User Menu"]');
    expect(userMenu).not.toBeNull();
    expect(userMenu.textContent).not.toContain('Apollo User');
    expect(userMenu.textContent).toContain('alice@example.com');

    // Check desktop options are present in mobile menu
    expect(userMenu.textContent).toContain('My Profile');
    expect(userMenu.textContent).toContain('Audio & Device Settings');
    expect(userMenu.textContent).toContain('Switch to DAW');
    expect(userMenu.textContent).toContain('Admin Panel');
    expect(userMenu.textContent).toContain('Log out');
  });

  it('renders bottom 3 tabs centered and uniform in a 3-column grid', async () => {
    await act(async () => {
      root.render(
        <MobilePlayerView
          session={{ user: { name: 'Alice' } }}
          activeQueueItem={null}
          isPlaying={false}
          shows={[]}
          playlists={[]}
          folders={[]}
          tuttiMixes={[]}
        />
      );
    });

    const nav = container.querySelector('nav[aria-label="Mobile Navigation"]');
    expect(nav).not.toBeNull();

    // Check uniform grid container
    const grid = nav.querySelector('.grid-cols-3');
    expect(grid).not.toBeNull();
    expect(grid.className).toContain('max-w-md mx-auto');

    const buttons = grid.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toContain('Home');
    expect(buttons[1].textContent).toContain('Search');
    expect(buttons[2].textContent).toContain('Your Library');
  });

  it('renders default playlist / show repertoire tracks on Home screen without 6-brick, continue, or All Songs title', async () => {
    const mockTuttiMixes = Array.from({ length: 8 }).map((_, i) => ({
      id: `mix-${i}`,
      name: `Song ${i + 1}`,
      musicalNumber: `0${i + 1}.0`,
      durationMs: 180000,
    }));
    let playedMix = null;

    await act(async () => {
      root.render(
        <MobilePlayerView
          session={{ user: { name: 'Alice' } }}
          activeQueueItem={null}
          isPlaying={false}
          shows={[]}
          playlists={[]}
          folders={[]}
          tuttiMixes={mockTuttiMixes}
          onPlayMix={(mix) => {
            playedMix = mix;
          }}
        />
      );
    });

    // 6-brick grid is removed
    const bricksGrid = container.querySelector('.grid-cols-2');
    expect(bricksGrid).toBeNull();

    // Continue where you left off carousel is removed
    expect(container.textContent).not.toContain('Continue where you left off');

    // "All Songs" title is removed
    expect(container.textContent).not.toContain('All Songs');

    // Default playlist / show tracks are cleanly rendered
    expect(container.textContent).toContain('Song 1');
    expect(container.textContent).toContain('Song 8');

    // Clicking a track starts playback
    const firstSong = container.querySelector('div[role="button"]');
    expect(firstSong).not.toBeNull();
    await act(async () => {
      firstSong.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(playedMix).not.toBeNull();
    expect(playedMix.id).toBe('mix-0');
  });

  it('displays desktop-style sliders, lyrics, and credits accessible via vertical scroll in Now Playing view', async () => {
    await act(async () => {
      root.render(
        <MobileNowPlayingModal
          isOpen={true}
          onClose={() => {}}
          activeQueueItem={mockQueueItem}
          isPlaying={true}
          currentTimeSec={51}
          durationSec={351}
          volume={80}
          onSetVolume={() => {}}
          loopMode="off"
          shuffleEnabled={false}
          onTogglePlay={() => {}}
          onPrevious={() => {}}
          onNext={() => {}}
          playbackSpeed={1.0}
          onSetPlaybackSpeed={() => {}}
          playbackTranspose={0}
          onSetPlaybackTranspose={() => {}}
          practiceFocusControl={2}
          onSetPracticeFocusControl={() => {}}
          practicePanRange={100}
          onSetPracticePanRange={() => {}}
          currentPlaybackLyrics={{
            useSyncedLyrics: true,
            lines: [{ id: 'l1', text: 'Please devote all your time to their care', startMs: 50000 }],
          }}
          hasCurrentLyrics={true}
        />
      );
    });

    const modal = container.querySelector('div[role="dialog"][aria-label="Now Playing"]');
    expect(modal).not.toBeNull();

    // 1. Fold 1: Track title, times, and media controls
    expect(modal.textContent).toContain('Dear Bill');
    expect(modal.textContent).toContain('Operation Mincemeat');
    expect(modal.textContent).toContain('0:51');
    expect(modal.textContent).toContain('5:51');

    // 2. Fold 2: Sliders accessible directly in scroll
    expect(modal.textContent).toContain('Choir Practice & Sound Controls');
    expect(modal.querySelector('input[aria-label="Practice Focus Slider"]')).not.toBeNull();
    expect(modal.querySelector('input[aria-label="Practice Pan Range Slider"]')).not.toBeNull();
    expect(modal.querySelector('input[aria-label="Playback Speed Slider"]')).not.toBeNull();
    expect(modal.querySelector('input[aria-label="Pitch Transpose Slider"]')).not.toBeNull();
    expect(modal.querySelector('input[aria-label="Master Volume Slider"]')).not.toBeNull();

    // 3. Fold 3: Lyrics accessible directly in scroll
    expect(modal.textContent).toContain('Lyrics');
    expect(modal.textContent).toContain('Please devote all your time to their care');

    // 4. Fold 4: Credits section accessible in scroll
    expect(modal.textContent).toContain('Credits');
  });
});
