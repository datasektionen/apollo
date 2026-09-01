import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlayerLibrarySidebar } from '../PlayerLibrarySidebar';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

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

const folders = [
  { id: 'folder-1', name: 'Private charts', createdAt: '2026-01-01', updatedAt: '2026-02-01' },
];
const playlists = [
  { id: 'pl-1', name: 'Warmup', folderId: null, createdAt: '2026-01-02', updatedAt: '2026-03-01' },
];
const myMixes = [
  { id: 'mix-1', name: 'Tango practice', folderId: null, createdAt: '2026-01-03', updatedAt: '2026-04-01' },
];

describe('PlayerLibrarySidebar', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders library items and portals the create menu above the list', () => {
    const view = render(
      <PlayerLibrarySidebar
        folders={folders}
        playlists={playlists}
        myMixes={myMixes}
        playlistItemsByPlaylistId={{}}
        onSelectEntry={() => {}}
      />
    );

    expect(view.container.textContent).toContain('Your Library');
    expect(view.container.textContent).toContain('Latest');
    expect(view.container.textContent).toContain('Private charts');
    expect(view.container.textContent).toContain('Warmup');
    expect(view.container.textContent).toContain('Tango practice');

    const createButton = view.container.querySelector('button[title="Create"]');
    expect(createButton).toBeTruthy();
    act(() => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const menu = Array.from(document.body.querySelectorAll('div')).find((node) => (
      node.textContent.includes('Create Folder') && node.className.includes('z-[80]')
    ));
    expect(menu).toBeTruthy();
    expect(menu.parentElement).toBe(document.body);
    view.unmount();
  });

  it('filters the library when search is used', () => {
    const view = render(
      <PlayerLibrarySidebar
        folders={folders}
        playlists={playlists}
        myMixes={myMixes}
        playlistItemsByPlaylistId={{}}
        onSelectEntry={() => {}}
      />
    );

    act(() => {
      view.container.querySelector('button[aria-label="Search Your Library"]').click();
    });
    expect(view.container.querySelector('button[title="Change library order"]')?.textContent || '').not.toContain('Latest');
    const input = view.container.querySelector('input[placeholder="Search your library"]');
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'warmup');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(view.container.textContent).toContain('Warmup');
    expect(view.container.textContent).not.toContain('Tango practice');
    expect(view.container.textContent).not.toContain('Private charts');

    const clear = view.container.querySelector('button[aria-label="Clear library search"]');
    expect(clear).toBeTruthy();
    act(() => {
      clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const emptyInput = view.container.querySelector('input[placeholder="Search your library"]');
    expect(emptyInput).toBeTruthy();
    expect(emptyInput.value).toBe('');

    act(() => {
      emptyInput.blur();
    });
    expect(view.container.querySelector('input[placeholder="Search your library"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Search Your Library"]')).toBeTruthy();
    view.unmount();
  });

  it('toggles to minimized mode from the header button', () => {
    const view = render(
      <PlayerLibrarySidebar
        folders={folders}
        playlists={playlists}
        myMixes={myMixes}
        playlistItemsByPlaylistId={{}}
        onSelectEntry={() => {}}
      />
    );

    act(() => {
      view.container.querySelector('button[aria-label="Collapse Your Library"]').click();
    });
    expect(view.container.querySelector('button[aria-label="Expand Your Library"]')).toBeTruthy();
    expect(view.container.textContent).not.toContain('Your Library');
    expect(view.container.querySelector('button[aria-label="Warmup (Playlist)"]')).toBeTruthy();
    view.unmount();
  });

  it('keeps the sort menu open when choosing a new order', () => {
    const view = render(
      <PlayerLibrarySidebar
        folders={folders}
        playlists={playlists}
        myMixes={myMixes}
        playlistItemsByPlaylistId={{}}
        onSelectEntry={() => {}}
      />
    );

    act(() => {
      view.container.querySelector('button[title="Change library order"]').click();
    });
    const menu = Array.from(document.body.querySelectorAll('div')).find((node) => (
      node.textContent.includes('Recently added') && node.className.includes('z-[80]')
    ));
    expect(menu).toBeTruthy();
    const recent = Array.from(menu.querySelectorAll('button')).find((button) => (
      button.textContent === 'Recently added'
    ));
    act(() => {
      recent.click();
    });
    expect(document.body.textContent).toContain('Recently added');
    expect(document.body.querySelector('button[aria-label="Sort descending"]')).toBeTruthy();
    view.unmount();
  });
});
