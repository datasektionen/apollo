import { describe, expect, it } from 'vitest';
import { ACCESS_TYPE_ROWS, grantScopeCells } from '../grantAccess';

const catalog = {
  shows: [{ id: 'show-1', name: 'Les Misérables' }],
  projects: [{ id: 'project-1', showId: 'show-1', name: 'One Day More', musicalNumber: '1.4' }],
  tracks: [{ id: 'track-1', name: 'Soprano 1' }],
};

describe('grantScopeCells', () => {
  it('shows every scope level a track manager can set', () => {
    const cells = grantScopeCells({
      permissionKey: 'track_manager',
      scopeType: 'show',
      scopeShowId: 'show-1',
      scopeGroupNameValue: 'choir',
      scopeGroupLabel: 'Choir',
    }, catalog);

    expect(cells.map((cell) => cell.text)).toEqual([
      'Les Misérables',
      'All',
      'Choir',
      'All',
      'All',
    ]);
  });

  it('marks levels the access type does not use', () => {
    const cells = grantScopeCells({
      permissionKey: 'project_reader',
      scopeType: 'project',
      scopeShowId: 'show-1',
      scopeProjectId: 'project-1',
    }, catalog);

    expect(cells.map((cell) => cell.kind)).toEqual(['value', 'value', 'all', 'all', 'na']);
    expect(cells[1].text).toBe('1.4 - One Day More');
    expect(cells[4].text).toBe('—');
  });

  it('leaves every level blank for show creator', () => {
    const cells = grantScopeCells({ permissionKey: 'show_creator', scopeType: 'all' }, catalog);
    expect(cells.every((cell) => cell.kind === 'na')).toBe(true);
  });
});

describe('access type grid', () => {
  function cellsFor(permissionKey) {
    return ACCESS_TYPE_ROWS.find((row) => row.permissionKey === permissionKey).cells;
  }

  it('gives show creator only the ability to create shows', () => {
    const cells = cellsFor('show_creator');
    expect(cells.createShows).toBe('yes');
    expect(Object.values(cells).filter((value) => value === 'yes')).toEqual(['yes']);
  });

  it('lets a project reader listen without opening the number', () => {
    const cells = cellsFor('project_reader');
    expect(cells.seeNumber).toBe('yes');
    expect(cells.openDaw).toBe('no');
  });

  it('marks track-manager solo as depending on a full-number scope', () => {
    expect(cellsFor('track_manager').solo).toBe('if-all');
    expect(cellsFor('project_manager').solo).toBe('yes');
    expect(cellsFor('track_creator').createMixes).toBe('no');
    expect(cellsFor('track_creator').editOwn).toBe('yes');
  });
});
