import { describe, expect, it } from 'vitest';
import {
  LIBRARY_SIDEBAR,
  LIBRARY_SIDEBAR_MODES,
  LIBRARY_SORTS,
  buildLibrarySearchItems,
  buildLibraryVisibleItems,
  buildMyDeviceQueue,
  commitLibrarySidebarDrag,
  libraryEntryFromSearchItem,
  librarySidebarProgress,
  listLibraryFolderMoveTargets,
  resolveLibrarySidebarDrag,
  searchPlayerLibrary,
  sortLibraryItems,
} from '../playerLibrary';

const folders = [
  {
    id: 'folder-b',
    name: 'Ballads',
    parentFolderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'folder-a',
    name: 'Aria cuts',
    parentFolderId: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
  },
  {
    id: 'folder-nested',
    name: 'Nested',
    parentFolderId: 'folder-b',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
  },
];

const playlists = [
  {
    id: 'pl-old',
    name: 'Warmup',
    folderId: null,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'pl-new',
    name: 'Zephyr',
    folderId: 'folder-b',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  },
];

const myMixes = [
  {
    id: 'mix-1',
    name: 'Tango practice',
    folderId: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'mix-2',
    name: 'Hidden in playlist',
    folderId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];

describe('buildLibraryVisibleItems', () => {
  it('hides playlist mixes from the root library', () => {
    const items = buildLibraryVisibleItems({
      folders,
      playlists,
      myMixes,
      playlistItemsByPlaylistId: {
        'pl-old': [{ mixId: 'mix-2' }],
      },
      libraryScopeFolderId: null,
    });
    expect(items.map((item) => item.id)).toEqual([
      'folder:folder-b',
      'folder:folder-a',
      'folder:folder-nested',
      'playlist:pl-old',
      'mix:mix-1',
    ]);
  });

  it('scopes to the open folder', () => {
    const items = buildLibraryVisibleItems({
      folders,
      playlists,
      myMixes,
      playlistItemsByPlaylistId: {},
      libraryScopeFolderId: 'folder-b',
    });
    expect(items.map((item) => item.id)).toEqual([
      'folder:folder-nested',
      'playlist:pl-new',
    ]);
  });
});

describe('buildMyDeviceQueue', () => {
  it('uses the requested folder instead of mixing in other folders', () => {
    const mixes = [
      { id: 'mix-1', projectId: 'p1', presetId: 'practice', folderId: null },
      { id: 'mix-2', projectId: 'p2', presetId: 'practice', folderId: 'folder-b' },
    ];
    expect(buildMyDeviceQueue(mixes, null).map((item) => item.mixId)).toEqual(['mix-1']);
    expect(buildMyDeviceQueue(mixes, 'folder-b').map((item) => item.mixId)).toEqual(['mix-2']);
    expect(buildMyDeviceQueue(mixes, 'missing-folder')).toEqual([]);
  });
});

describe('sortLibraryItems', () => {
  const items = buildLibraryVisibleItems({
    folders,
    playlists,
    myMixes,
    playlistItemsByPlaylistId: { 'pl-old': [{ mixId: 'mix-2' }] },
  });

  it('orders by latest update', () => {
    expect(sortLibraryItems(items, LIBRARY_SORTS.LATEST).map((item) => item.id)).toEqual([
      'mix:mix-1',
      'folder:folder-nested',
      'folder:folder-a',
      'folder:folder-b',
      'playlist:pl-old',
    ]);
  });

  it('orders by recently added', () => {
    expect(sortLibraryItems(items, LIBRARY_SORTS.RECENT).map((item) => item.id)).toEqual([
      'folder:folder-nested',
      'folder:folder-a',
      'mix:mix-1',
      'folder:folder-b',
      'playlist:pl-old',
    ]);
  });

  it('orders alphabetically', () => {
    expect(sortLibraryItems(items, LIBRARY_SORTS.ALPHA).map((item) => item.name)).toEqual([
      'Aria cuts',
      'Ballads',
      'Nested',
      'Tango practice',
      'Warmup',
    ]);
  });

  it('reverses the default order when requested', () => {
    expect(sortLibraryItems(items, LIBRARY_SORTS.ALPHA, true).map((item) => item.name)).toEqual([
      'Warmup',
      'Tango practice',
      'Nested',
      'Ballads',
      'Aria cuts',
    ]);
  });
});

describe('listLibraryFolderMoveTargets', () => {
  it('omits a folder and its descendants', () => {
    const targets = listLibraryFolderMoveTargets(folders, 'folder-b');
    expect(targets.map((folder) => folder.id)).toEqual(['folder-a']);
  });
});

describe('searchPlayerLibrary', () => {
  it('only returns folders, playlists, and mixes from the user library', () => {
    const items = buildLibrarySearchItems({
      folders,
      playlists,
      myMixes,
    });
    const results = searchPlayerLibrary(items, 'warmup');
    expect(results.all.map((item) => item.type)).toEqual(['playlist']);
    expect(results.byType.shows).toEqual([]);
    expect(results.byType.songs).toEqual([]);
    expect(results.byType.credits).toEqual([]);
  });

  it('maps a search hit back to a library entry', () => {
    const items = buildLibrarySearchItems({ folders, playlists, myMixes });
    const results = searchPlayerLibrary(items, 'tango');
    expect(libraryEntryFromSearchItem(results.all[0])).toEqual(expect.objectContaining({
      kind: 'mix',
      name: 'Tango practice',
    }));
  });
});

describe('librarySidebarProgress', () => {
  it('maps live width onto the minimized-to-default range', () => {
    expect(librarySidebarProgress(LIBRARY_SIDEBAR.MINIMIZED_WIDTH)).toBe(0);
    expect(librarySidebarProgress(LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH)).toBe(1);
    expect(librarySidebarProgress(
      (LIBRARY_SIDEBAR.MINIMIZED_WIDTH + LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH) / 2
    )).toBeCloseTo(0.5);
  });
});

describe('resolveLibrarySidebarDrag', () => {
  it('resizes within the default range', () => {
    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      startWidth: 320,
      deltaX: -20,
    })).toEqual({ mode: LIBRARY_SIDEBAR_MODES.DEFAULT, width: 300 });
  });

  it('holds the minimum default width until the pointer reaches the midpoint', () => {
    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH + 1,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    });

    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    });
  });

  it('stays minimized until the pointer goes past the midpoint', () => {
    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      pointerWidth: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    });

    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    });

    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH + 1,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    });
  });

  it('returns to default after collapsing if the pointer crosses the midpoint again', () => {
    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    });

    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      pointerWidth: LIBRARY_SIDEBAR.FLIP_WIDTH + 1,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    });
  });

  it('only resizes the default sidebar when the pointer is past the minimum edge', () => {
    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      pointerWidth: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH - 20,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    });

    expect(resolveLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      pointerWidth: 300,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: 300,
    });
  });
});

describe('commitLibrarySidebarDrag', () => {
  it('keeps a snapped default width', () => {
    expect(commitLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH + 40,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH + 40,
    });
  });

  it('commits minimized mode to the rail width', () => {
    expect(commitLibrarySidebarDrag({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    })).toEqual({
      mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
      width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
    });
  });
});
