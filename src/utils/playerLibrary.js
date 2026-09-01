import {
  buildPlayerSearchItems,
  parsePlayerSearchQuery,
  searchPlayerCatalog,
} from './playerSearch';
import {
  createQueueItemFromMix,
  PLAYER_COLLECTION_TYPES,
} from '../types/player';

export const LIBRARY_SIDEBAR_STORAGE_KEY = 'apollo.playerLibrarySidebar';

export const LIBRARY_SIDEBAR_MODES = {
  DEFAULT: 'default',
  MINIMIZED: 'minimized',
};

export const LIBRARY_SORTS = {
  LATEST: 'latest',
  RECENT: 'recent',
  ALPHA: 'alpha',
};

export const LIBRARY_SORT_OPTIONS = [
  { id: LIBRARY_SORTS.LATEST, label: 'Latest' },
  { id: LIBRARY_SORTS.RECENT, label: 'Recently added' },
  { id: LIBRARY_SORTS.ALPHA, label: 'Alphabetical' },
];

export const LIBRARY_SIDEBAR = {
  MINIMIZED_WIDTH: 72,
  DEFAULT_MIN_WIDTH: 240,
  DEFAULT_MAX_WIDTH: 480,
  DEFAULT_WIDTH: 320,
  COLLAPSE_THRESHOLD: 80,
  EXPAND_THRESHOLD: 48,
};

const DEFAULT_LIBRARY_SIDEBAR_SETTINGS = {
  mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
  width: LIBRARY_SIDEBAR.DEFAULT_WIDTH,
  sort: LIBRARY_SORTS.LATEST,
  sortReversed: false,
};

function toTimestamp(value) {
  if (value == null || value === '') return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareNames(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function normalizeLibrarySort(value) {
  if (value === LIBRARY_SORTS.RECENT || value === LIBRARY_SORTS.ALPHA) return value;
  return LIBRARY_SORTS.LATEST;
}

export function normalizeLibrarySidebarMode(value) {
  return value === LIBRARY_SIDEBAR_MODES.MINIMIZED
    ? LIBRARY_SIDEBAR_MODES.MINIMIZED
    : LIBRARY_SIDEBAR_MODES.DEFAULT;
}

export function clampLibrarySidebarWidth(width, mode = LIBRARY_SIDEBAR_MODES.DEFAULT) {
  const numeric = Number(width);
  if (mode === LIBRARY_SIDEBAR_MODES.MINIMIZED) {
    return LIBRARY_SIDEBAR.MINIMIZED_WIDTH;
  }
  if (!Number.isFinite(numeric)) return LIBRARY_SIDEBAR.DEFAULT_WIDTH;
  return Math.max(
    LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    Math.min(LIBRARY_SIDEBAR.DEFAULT_MAX_WIDTH, Math.round(numeric))
  );
}

export function normalizeLibrarySidebarSettings(settings = {}) {
  const mode = normalizeLibrarySidebarMode(settings.mode);
  return {
    mode,
    width: clampLibrarySidebarWidth(
      settings.width ?? DEFAULT_LIBRARY_SIDEBAR_SETTINGS.width,
      LIBRARY_SIDEBAR_MODES.DEFAULT
    ),
    sort: normalizeLibrarySort(settings.sort),
    sortReversed: Boolean(settings.sortReversed),
  };
}

export function readLibrarySidebarSettings() {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
      return { ...DEFAULT_LIBRARY_SIDEBAR_SETTINGS };
    }
    const raw = localStorage.getItem(LIBRARY_SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LIBRARY_SIDEBAR_SETTINGS };
    return normalizeLibrarySidebarSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LIBRARY_SIDEBAR_SETTINGS };
  }
}

export function writeLibrarySidebarSettings(settings) {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    localStorage.setItem(
      LIBRARY_SIDEBAR_STORAGE_KEY,
      JSON.stringify(normalizeLibrarySidebarSettings(settings))
    );
  } catch {
    // Ignore storage failures; the sidebar still works for the current session.
  }
}

export function resolveLibrarySidebarDrag({
  mode,
  startWidth,
  deltaX,
}) {
  const currentMode = normalizeLibrarySidebarMode(mode);
  const movement = Number(deltaX) || 0;

  if (currentMode === LIBRARY_SIDEBAR_MODES.MINIMIZED) {
    if (movement <= LIBRARY_SIDEBAR.EXPAND_THRESHOLD) {
      return {
        mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
        width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
      };
    }
    const extra = movement - LIBRARY_SIDEBAR.EXPAND_THRESHOLD;
    return {
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: clampLibrarySidebarWidth(LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH + extra),
    };
  }

  const nextWidth = (Number(startWidth) || LIBRARY_SIDEBAR.DEFAULT_WIDTH) + movement;
  if (nextWidth >= LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH) {
    return {
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: clampLibrarySidebarWidth(nextWidth),
    };
  }

  const overshoot = LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH - nextWidth;
  if (overshoot < LIBRARY_SIDEBAR.COLLAPSE_THRESHOLD) {
    return {
      mode: LIBRARY_SIDEBAR_MODES.DEFAULT,
      width: LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH,
    };
  }

  return {
    mode: LIBRARY_SIDEBAR_MODES.MINIMIZED,
    width: LIBRARY_SIDEBAR.MINIMIZED_WIDTH,
  };
}

function mapFolder(folder) {
  return {
    id: `folder:${folder.id}`,
    kind: 'folder',
    name: folder.name,
    createdAt: folder.createdAt || null,
    updatedAt: folder.updatedAt || folder.createdAt || null,
    folder,
  };
}

function mapPlaylist(playlist) {
  return {
    id: `playlist:${playlist.id}`,
    kind: 'playlist',
    name: playlist.name,
    createdAt: playlist.createdAt || null,
    updatedAt: playlist.updatedAt || playlist.createdAt || null,
    playlist,
  };
}

function mapMix(mix) {
  return {
    id: `mix:${mix.id}`,
    kind: 'mix',
    name: mix.name || mix.projectName || 'Untitled mix',
    createdAt: mix.createdAt || null,
    updatedAt: mix.updatedAt || mix.createdAt || null,
    mix,
  };
}

export function buildLibraryVisibleItems({
  folders = [],
  playlists = [],
  myMixes = [],
  playlistItemsByPlaylistId = {},
  libraryScopeFolderId = null,
} = {}) {
  if (libraryScopeFolderId) {
    const scopedFolders = folders
      .filter((folder) => (folder.parentFolderId || null) === libraryScopeFolderId)
      .map(mapFolder);
    const scopedPlaylists = playlists
      .filter((playlist) => (playlist.folderId || null) === libraryScopeFolderId)
      .map(mapPlaylist);
    return [...scopedFolders, ...scopedPlaylists];
  }

  const playlistMixIds = new Set(
    Object.values(playlistItemsByPlaylistId || {})
      .flat()
      .map((item) => item?.mixId)
      .filter(Boolean)
      .map((mixId) => String(mixId))
  );
  const rootMixes = myMixes
    .filter((mix) => (mix.folderId || null) === null)
    .filter((mix) => !playlistMixIds.has(String(mix.id)))
    .map(mapMix);
  const foldersFlat = folders.map(mapFolder);
  const playlistsFlat = playlists
    .filter((playlist) => (playlist.folderId || null) === null)
    .map(mapPlaylist);
  return [...foldersFlat, ...playlistsFlat, ...rootMixes];
}

export function buildMyDeviceQueue(myMixes = [], folderId = null) {
  return (myMixes || [])
    .filter((mix) => (mix.folderId || null) === (folderId || null))
    .map((mix) => createQueueItemFromMix(
      mix,
      PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES,
      folderId || 'root'
    ))
    .filter(Boolean);
}

export function getFolderDescendantIds(folders = [], folderId) {
  const rootId = folderId || null;
  if (!rootId) return new Set();
  const childrenByParent = new Map();
  folders.forEach((folder) => {
    const parentId = folder?.parentFolderId || null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(folder.id);
  });
  const ids = new Set();
  const stack = [...(childrenByParent.get(rootId) || [])];
  while (stack.length) {
    const current = stack.pop();
    if (!current || ids.has(current)) continue;
    ids.add(current);
    (childrenByParent.get(current) || []).forEach((childId) => stack.push(childId));
  }
  return ids;
}

export function listLibraryFolderMoveTargets(folders = [], movingFolderId = null) {
  const blocked = getFolderDescendantIds(folders, movingFolderId);
  if (movingFolderId) blocked.add(movingFolderId);
  return [...folders]
    .filter((folder) => folder?.id && !blocked.has(folder.id))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
}

export function sortLibraryItems(items, sort = LIBRARY_SORTS.LATEST, reversed = false) {
  const normalized = normalizeLibrarySort(sort);
  const next = [...(items || [])];
  next.sort((left, right) => {
    if (normalized === LIBRARY_SORTS.ALPHA) {
      const byName = compareNames(left?.name, right?.name);
      if (byName) return byName;
      return compareNames(left?.id, right?.id);
    }
    const field = normalized === LIBRARY_SORTS.RECENT ? 'createdAt' : 'updatedAt';
    const rightTime = toTimestamp(right?.[field] || right?.createdAt);
    const leftTime = toTimestamp(left?.[field] || left?.createdAt);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return compareNames(left?.name, right?.name);
  });
  if (reversed) next.reverse();
  return next;
}

export function buildLibrarySearchItems({
  folders = [],
  playlists = [],
  myMixes = [],
} = {}) {
  return buildPlayerSearchItems({
    shows: [],
    songs: [],
    mixes: myMixes,
    playlists,
    folders,
  });
}

export function searchPlayerLibrary(items, query) {
  const parsed = parsePlayerSearchQuery(query);
  const results = searchPlayerCatalog(items, parsed, []);
  const all = (results.all || []).filter((item) => (
    item.type === 'folder' || item.type === 'playlist' || item.type === 'mix'
  ));
  return {
    ...results,
    byType: {
      ...results.byType,
      shows: [],
      songs: [],
      credits: [],
      mixes: results.byType?.mixes || [],
      playlists: results.byType?.playlists || [],
      folders: results.byType?.folders || [],
    },
    all,
    topResult: all[0] || null,
    total: all.length,
  };
}

export function libraryEntryFromSearchItem(item) {
  if (!item) return null;
  if (item.type === 'folder' && item.payload) return mapFolder(item.payload);
  if (item.type === 'playlist' && item.payload) return mapPlaylist(item.payload);
  if (item.type === 'mix' && item.payload) return mapMix(item.payload);
  return null;
}

export function libraryEntrySubtitle(entry) {
  if (entry?.kind === 'playlist') return 'Playlist';
  if (entry?.kind === 'mix') return `${entry.mix?.musicalNumber || '0.0'} - Mix`;
  return 'Folder';
}
