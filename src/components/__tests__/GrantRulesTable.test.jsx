import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessTypeInfoButton, GrantRulesTable } from '../GrantRulesTable';
import { LYRICS_TRACK_SCOPE_ID } from '../../../shared/accessRules.js';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const catalog = {
  permissions: [
    { value: 'track_manager', label: 'Track manager' },
    { value: 'project_reader', label: 'Project reader' },
    { value: 'track_reader', label: 'Track reader' },
  ],
  shows: [{ id: 'show-1', name: 'Les Misérables' }],
  projects: [{ id: 'project-1', showId: 'show-1', name: 'One Day More', musicalNumber: '1.4' }],
  tracks: [],
  groupNames: [{ value: 'choir', label: 'Choir' }],
  partNames: [],
};

const grants = [
  {
    id: 'direct-1',
    permissionKey: 'track_manager',
    permissionLabel: 'Track manager',
    scopeType: 'show',
    scopeShowId: 'show-1',
    scopeGroupNameValue: 'choir',
    scopeGroupLabel: 'Choir',
    sourceType: 'direct',
  },
  {
    id: 'inherited-1',
    permissionKey: 'track_reader',
    permissionLabel: 'Track reader',
    scopeType: 'all',
    sourceType: 'inherited',
    sourceRoleName: 'Singers',
  },
];

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

describe('GrantRulesTable', () => {
  it('shows every scope and keeps inherited rules read-only', () => {
    const view = render(
      <GrantRulesTable grants={grants} catalog={catalog} canEdit onChange={vi.fn()} onRemove={vi.fn()} />
    );
    expect(view.container.textContent).toContain('Les Misérables');
    expect(view.container.textContent).toContain('Choir');
    expect(view.container.textContent).toContain('Inherited from Singers');
    expect(view.container.querySelectorAll('button[aria-label="Edit"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('button[aria-label="Delete"]')).toHaveLength(1);
    view.unmount();
  });

  it('reports an edited rule without a row save button', async () => {
    const onChange = vi.fn();
    const view = render(
      <GrantRulesTable grants={grants} catalog={catalog} canEdit onChange={onChange} onRemove={vi.fn()} />
    );
    const edit = view.container.querySelector('button[aria-label="Edit"]');
    await act(async () => {
      edit.click();
    });
    expect([...view.container.querySelectorAll('button')].some((button) => button.textContent === 'Save')).toBe(false);
    const permission = view.container.querySelector('select');
    await act(async () => {
      permission.value = 'project_reader';
      permission.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      id: 'direct-1',
      permissionKey: 'project_reader',
    }));
    view.unmount();
  });

  it('shows Lyrics at the top of the track selector with a separator', async () => {
    const lyricsCatalog = {
      ...catalog,
      tracks: [{
        id: LYRICS_TRACK_SCOPE_ID,
        name: 'Lyrics',
        isVirtual: true,
        projectId: 'project-1',
        showId: 'show-1',
        groupValues: [],
        partValues: [],
      }, {
        id: 'vocal-track',
        name: 'Lead vocal',
        projectId: 'project-1',
        showId: 'show-1',
        groupValues: [],
        partValues: [],
      }],
    };
    const lyricsGrant = {
      id: 'lyrics-grant',
      permissionKey: 'track_manager',
      permissionLabel: 'Track manager',
      scopeType: 'track',
      scopeShowId: 'show-1',
      scopeProjectId: 'project-1',
      scopeTrackId: LYRICS_TRACK_SCOPE_ID,
      sourceType: 'direct',
    };
    const view = render(
      <GrantRulesTable grants={[lyricsGrant]} catalog={lyricsCatalog} canEdit onChange={vi.fn()} onRemove={vi.fn()} />
    );

    expect(view.container.textContent).toContain('Lyrics');
    expect(view.container.textContent).not.toContain('built-in');
    await act(async () => view.container.querySelector('button[aria-label="Edit"]').click());
    const trackSelect = [...view.container.querySelectorAll('select')].at(-1);
    const lyricsOption = trackSelect.querySelector(`option[value="${LYRICS_TRACK_SCOPE_ID}"]`);
    expect(lyricsOption.textContent).toBe('Lyrics');
    expect(lyricsOption.nextElementSibling.disabled).toBe(true);
    expect(lyricsOption.nextElementSibling.textContent).toContain('─');
    view.unmount();
  });

  it('starts a new rule from the plus row', () => {
    const onAdd = vi.fn(() => 'draft:1');
    const view = render(
      <GrantRulesTable grants={[]} catalog={catalog} canEdit onAdd={onAdd} onChange={vi.fn()} onRemove={vi.fn()} />
    );
    const add = [...view.container.querySelectorAll('button')].find((button) => button.textContent.includes('Add access'));
    expect(add).toBeTruthy();
    act(() => {
      add.click();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect([...view.container.querySelectorAll('button')].some((button) => button.textContent === 'Save')).toBe(false);
    view.unmount();
  });
});

describe('AccessTypeInfoButton', () => {
  it('opens the access-type grid', () => {
    const view = render(<AccessTypeInfoButton />);
    const info = view.container.querySelector('button[aria-label="What each access type allows"]');
    act(() => {
      info.click();
    });
    expect(document.body.textContent).toContain('What each access type allows');
    expect(document.body.textContent).toContain('Show creator');
    expect(document.body.textContent).toContain('Solo for Track manager');
    view.unmount();
  });
});
