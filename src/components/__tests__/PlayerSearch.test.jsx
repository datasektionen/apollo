import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlayerSearchBar } from '../PlayerSearch';
import { parsePlayerSearchQuery, searchPlayerCatalog, buildPlayerSearchItems } from '../../utils/playerSearch';

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

describe('PlayerSearchBar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows typed suggestions with type labels', () => {
    const items = buildPlayerSearchItems({
      shows: [{ id: 'show-1', name: 'Chicago', mixes: [] }],
      songs: [{ id: 'song-1', projectId: 'p1', name: 'Cell Block Tango', musicalNumber: '1.4', showName: 'Chicago' }],
      mixes: [],
      playlists: [],
      folders: [],
    });
    const parsed = parsePlayerSearchQuery('chic');
    const results = searchPlayerCatalog(items, parsed, []);
    const view = render(
      <PlayerSearchBar
        value="chic"
        onChange={() => {}}
        results={results}
        onSubmit={() => {}}
        onSelect={() => {}}
      />
    );
    const input = view.container.querySelector('input');
    expect(input).toBeTruthy();
    act(() => {
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('Search for "chic"');
    expect(view.container.textContent).toContain('Chicago');
    expect(view.container.textContent).toContain('Show');
    view.unmount();
  });
});
