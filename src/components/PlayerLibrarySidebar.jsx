import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Folder,
  Library,
  ListFilter,
  ListMusic,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  LIBRARY_SIDEBAR,
  LIBRARY_SIDEBAR_MODES,
  LIBRARY_SORT_OPTIONS,
  buildLibrarySearchItems,
  buildLibraryVisibleItems,
  clampLibrarySidebarWidth,
  libraryEntryFromSearchItem,
  libraryEntrySubtitle,
  readLibrarySidebarSettings,
  resolveLibrarySidebarDrag,
  searchPlayerLibrary,
  sortLibraryItems,
  writeLibrarySidebarSettings,
} from '../utils/playerLibrary';
import { PLAYER_COLLECTION_TYPES } from '../types/player';

const ENTRY_ICON_SIZE = 24;
const HEADER_ICON_SIZE = 20;
const TOOLBAR_ICON_SIZE = 16;
const RESIZE_GAP_PX = 12;
const ENTRY_ICONS = {
  folder: Folder,
  playlist: ListMusic,
  mix: Play,
};

function useAnchoredMenu(open) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);

  const updateCoords = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({
      top: rect.bottom + 6,
      left: Math.max(8, rect.left),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    updateCoords();
    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords, true);
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [open, updateCoords]);

  return { triggerRef, menuRef, coords };
}

function LibraryHoverTooltip({ tooltip }) {
  if (!tooltip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[90] max-w-xs -translate-y-1/2 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 shadow-xl"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="truncate text-sm text-white">{tooltip.name}</div>
      {tooltip.subtitle ? (
        <div className="truncate text-[11px] text-gray-400">{tooltip.subtitle}</div>
      ) : null}
    </div>,
    document.body
  );
}

function LibraryEntryRow({
  entry,
  isActive,
  minimized,
  onSelect,
  onPlayMix,
  onContextMenu,
  onHoverChange,
}) {
  const EntryIcon = ENTRY_ICONS[entry.kind] || Folder;
  const subtitle = libraryEntrySubtitle(entry);
  const handleHover = (event, hovering) => {
    if (!minimized) {
      onHoverChange(null);
      return;
    }
    if (!hovering) {
      onHoverChange(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    onHoverChange({
      name: entry.name,
      subtitle,
      x: rect.right + 10,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(entry, event);
      }}
      onMouseEnter={(event) => handleHover(event, true)}
      onMouseLeave={(event) => handleHover(event, false)}
      className={`group flex items-center rounded-md transition-colors ${
        minimized ? 'justify-center p-1' : 'gap-1 pr-1'
      } ${isActive ? 'bg-blue-700/30' : 'hover:bg-gray-700'}`}
    >
      <button
        type="button"
        onClick={() => onSelect(entry)}
        onDoubleClick={async () => {
          if (entry.kind === 'mix' && entry.mix) {
            await onPlayMix?.(entry.mix);
          }
        }}
        className={minimized
          ? 'flex h-11 w-11 items-center justify-center rounded-md'
          : 'flex-1 min-w-0 text-left px-2 py-1.5'}
        aria-label={minimized ? `${entry.name} (${subtitle})` : undefined}
      >
        {minimized ? (
          <EntryIcon size={ENTRY_ICON_SIZE} className="text-gray-300" />
        ) : (
          <div className="flex items-center gap-3">
            <EntryIcon size={ENTRY_ICON_SIZE} className="text-gray-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm truncate">{entry.name}</div>
              <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

export function PlayerLibrarySidebar({
  folders,
  playlists,
  myMixes,
  playlistItemsByPlaylistId,
  libraryScopeFolderId,
  onLibraryScopeChange,
  activeCollectionType,
  activeCollectionId,
  activeQueueItem,
  onSelectEntry,
  onPlayMix,
  onCreateFolder,
  onCreatePlaylist,
  onContextMenu,
}) {
  const saved = useMemo(() => readLibrarySidebarSettings(), []);
  const [mode, setMode] = useState(saved.mode);
  const [width, setWidth] = useState(saved.width);
  const [sort, setSort] = useState(saved.sort);
  const [sortReversed, setSortReversed] = useState(saved.sortReversed);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const searchInputRef = useRef(null);
  const resizeRef = useRef(null);
  const createMenu = useAnchoredMenu(createOpen);
  const sortMenu = useAnchoredMenu(sortOpen);
  const minimized = mode === LIBRARY_SIDEBAR_MODES.MINIMIZED;

  const currentFolder = folders.find((folder) => folder.id === libraryScopeFolderId) || null;
  const scopedItems = useMemo(() => buildLibraryVisibleItems({
    folders,
    playlists,
    myMixes,
    playlistItemsByPlaylistId,
    libraryScopeFolderId,
  }), [folders, libraryScopeFolderId, myMixes, playlistItemsByPlaylistId, playlists]);

  const catalogItems = useMemo(() => buildLibrarySearchItems({
    folders,
    playlists,
    myMixes,
  }), [folders, myMixes, playlists]);

  const searchQuery = searchOpen ? searchDraft.trim() : '';
  const displayedItems = useMemo(() => {
    if (searchQuery) {
      return searchPlayerLibrary(catalogItems, searchQuery)
        .all
        .map(libraryEntryFromSearchItem)
        .filter(Boolean);
    }
    return sortLibraryItems(scopedItems, sort, sortReversed);
  }, [catalogItems, scopedItems, searchQuery, sort, sortReversed]);

  useEffect(() => {
    writeLibrarySidebarSettings({ mode, width, sort, sortReversed });
  }, [mode, sort, sortReversed, width]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!minimized) return;
    setSearchOpen(false);
    setSearchDraft('');
    setCreateOpen(false);
    setSortOpen(false);
  }, [minimized]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      const target = event.target;
      if (
        !createMenu.triggerRef.current?.contains(target)
        && !createMenu.menuRef.current?.contains(target)
      ) {
        setCreateOpen(false);
      }
      if (
        !sortMenu.triggerRef.current?.contains(target)
        && !sortMenu.menuRef.current?.contains(target)
      ) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [createMenu.menuRef, createMenu.triggerRef, sortMenu.menuRef, sortMenu.triggerRef]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const handleMove = (event) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = resolveLibrarySidebarDrag({
        mode: drag.mode,
        startWidth: drag.startWidth,
        deltaX: event.clientX - drag.startX,
      });
      setMode(next.mode);
      if (next.mode === LIBRARY_SIDEBAR_MODES.DEFAULT) {
        setWidth(next.width);
      }
    };
    const handleUp = () => {
      setIsResizing(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  const sidebarWidth = minimized ? LIBRARY_SIDEBAR.MINIMIZED_WIDTH : clampLibrarySidebarWidth(width);
  const sortLabel = LIBRARY_SORT_OPTIONS.find((option) => option.id === sort)?.label || 'Latest';
  const showResizeLine = isResizing || resizeHover;

  const isEntryActive = (entry) => {
    if (entry.kind === 'folder') return false;
    if (entry.kind === 'playlist') {
      return activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
        && activeCollectionId === entry.playlist?.id;
    }
    return activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
      && activeCollectionId === 'root'
      && String(activeQueueItem?.mixId || '') === String(entry.mix?.id || '');
  };

  const toggleMode = () => {
    if (minimized) {
      setMode(LIBRARY_SIDEBAR_MODES.DEFAULT);
      setWidth((current) => clampLibrarySidebarWidth(current));
      return;
    }
    setMode(LIBRARY_SIDEBAR_MODES.MINIMIZED);
  };

  const startResize = (event) => {
    event.preventDefault();
    resizeRef.current = {
      mode,
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    setIsResizing(true);
    setCreateOpen(false);
    setSortOpen(false);
    setHoverTooltip(null);
  };

  const createMenuNode = createOpen && createMenu.coords && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={createMenu.menuRef}
        className="fixed z-[80] min-w-36 overflow-hidden rounded-md border border-gray-700 bg-gray-800 text-white shadow-xl"
        style={{ top: createMenu.coords.top, left: createMenu.coords.left }}
      >
        <button
          type="button"
          onClick={async () => {
            setCreateOpen(false);
            await onCreateFolder?.();
          }}
          className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
        >
          Create Folder
        </button>
        <button
          type="button"
          onClick={async () => {
            setCreateOpen(false);
            await onCreatePlaylist?.();
          }}
          className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
        >
          Create Playlist
        </button>
      </div>,
      document.body
    )
    : null;

  const sortMenuNode = sortOpen && sortMenu.coords && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={sortMenu.menuRef}
        className="fixed z-[80] w-max overflow-hidden rounded-md border border-gray-700 bg-gray-800 py-1 shadow-xl"
        style={{ top: sortMenu.coords.top, right: sortMenu.coords.right }}
      >
        {LIBRARY_SORT_OPTIONS.map((option) => {
          const selected = option.id === sort;
          return (
            <div
              key={option.id}
              className={`relative hover:bg-gray-700 ${
                selected ? 'text-white' : 'text-gray-200'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (option.id !== sort) {
                    setSort(option.id);
                    setSortReversed(false);
                  }
                }}
                className="w-full py-2 pl-3 pr-9 text-left text-sm"
              >
                {option.label}
              </button>
              {selected ? (
                <button
                  type="button"
                  onClick={() => setSortReversed((current) => !current)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-gray-300 hover:text-white"
                  title={sortReversed ? 'Sort ascending' : 'Sort descending'}
                  aria-label={sortReversed ? 'Sort ascending' : 'Sort descending'}
                >
                  {sortReversed ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>,
      document.body
    )
    : null;

  return (
    <div
      className={`relative shrink-0 min-h-0 ${isResizing ? '' : 'transition-[width] duration-200'}`}
      style={{ width: sidebarWidth }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800/80">
        <div className={`relative z-20 flex h-11 min-h-11 max-h-11 shrink-0 items-center gap-1 border-b border-gray-700 px-2 ${
          minimized ? 'justify-center' : ''
        }`}>
          <button
            type="button"
            onClick={toggleMode}
            className={`group/toggle flex min-w-0 items-center rounded-md py-1 text-left hover:bg-gray-700 ${
              minimized ? 'h-8 w-8 justify-center px-0' : 'flex-1 gap-1.5 px-1'
            }`}
            title={minimized ? 'Expand Your Library' : 'Collapse Your Library'}
            aria-label={minimized ? 'Expand Your Library' : 'Collapse Your Library'}
          >
            {minimized ? (
              <span className="relative flex h-6 w-6 items-center justify-center">
                <Library
                  size={HEADER_ICON_SIZE}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150 group-hover/toggle:opacity-0"
                />
                <PanelLeftOpen
                  size={HEADER_ICON_SIZE}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/toggle:opacity-100"
                />
              </span>
            ) : (
              <>
                <span className="flex w-0 shrink-0 items-center justify-center overflow-hidden opacity-0 transition-all duration-200 group-hover/toggle:w-6 group-hover/toggle:opacity-100">
                  <PanelLeftClose size={HEADER_ICON_SIZE} />
                </span>
                <span className="truncate text-base font-semibold leading-none">Your Library</span>
              </>
            )}
          </button>

          {!minimized ? (
            <button
              ref={createMenu.triggerRef}
              type="button"
              onClick={() => {
                setCreateOpen((previous) => !previous);
                setSortOpen(false);
              }}
              className="rounded p-1.5 hover:bg-gray-700"
              title="Create"
              aria-haspopup="menu"
              aria-expanded={createOpen}
            >
              <Plus size={HEADER_ICON_SIZE} />
            </button>
          ) : null}
        </div>

        {!minimized && libraryScopeFolderId && !searchQuery ? (
          <div className="shrink-0 border-b border-gray-700 px-2 py-1.5">
            <button
              type="button"
              onClick={() => onLibraryScopeChange?.(null)}
              className="inline-flex max-w-full items-center gap-1 rounded px-1 text-sm hover:bg-gray-700"
              title="Back to Your Library"
            >
              <ChevronLeft size={13} className="shrink-0" />
              <span className="truncate">{currentFolder?.name || 'Your Library'}</span>
            </button>
          </div>
        ) : null}

        {!minimized ? (
          <div className="flex h-9 min-h-9 max-h-9 shrink-0 items-center gap-2 border-b border-gray-700 px-2">
            {searchOpen ? (
              <div className="relative min-w-0 flex-1">
                <Search size={TOOLBAR_ICON_SIZE} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchDraft}
                  placeholder="Search your library"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onBlur={() => {
                    if (!searchDraft.trim()) setSearchOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    if (searchDraft) {
                      setSearchDraft('');
                      return;
                    }
                    setSearchOpen(false);
                  }}
                  className={`h-7 w-full rounded-md border border-gray-700 bg-gray-900 py-0 pl-8 text-sm text-gray-100 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none ${
                    searchDraft ? 'pr-7' : 'pr-2'
                  }`}
                />
                {searchDraft ? (
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-white"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSearchDraft('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear library search"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  setCreateOpen(false);
                }}
                className="rounded p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
                title="Search Your Library"
                aria-label="Search Your Library"
              >
                <Search size={TOOLBAR_ICON_SIZE} />
              </button>
            )}
            <button
              ref={sortMenu.triggerRef}
              type="button"
              onClick={() => {
                setSortOpen((previous) => !previous);
                setCreateOpen(false);
              }}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              title="Change library order"
            >
              {searchOpen ? null : <span>{sortLabel}</span>}
              <ListFilter size={TOOLBAR_ICON_SIZE} className="shrink-0" />
            </button>
          </div>
        ) : null}

        {minimized && libraryScopeFolderId ? (
          <div className="flex justify-center px-1 py-1">
            <button
              type="button"
              onClick={() => onLibraryScopeChange?.(null)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-gray-300 hover:bg-gray-700"
              title="Back to Your Library"
              aria-label="Back to Your Library"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        ) : null}

        <div
          className={`flex-1 overflow-auto ${minimized ? 'p-1 space-y-1' : 'p-2 space-y-1'}`}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu?.(null, event);
          }}
        >
          {displayedItems.map((entry) => (
            <LibraryEntryRow
              key={entry.id}
              entry={entry}
              isActive={isEntryActive(entry)}
              minimized={minimized}
              onSelect={onSelectEntry}
              onPlayMix={onPlayMix}
              onContextMenu={(nextEntry, event) => onContextMenu?.(nextEntry, event)}
              onHoverChange={setHoverTooltip}
            />
          ))}
          {!displayedItems.length ? (
            <div className={`text-xs text-gray-500 ${minimized ? 'px-1 py-2 text-center' : 'px-2 py-2'}`}>
              {searchQuery ? 'No matching library items.' : 'No library items here.'}
            </div>
          ) : null}
        </div>
      </div>

      <div
        role="separator"
        aria-label="Resize library sidebar"
        onMouseDown={startResize}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => setResizeHover(false)}
        className="absolute inset-y-0 z-30 cursor-col-resize"
        style={{ left: '100%', width: RESIZE_GAP_PX }}
      >
        <div
          className={`absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full transition-colors ${
            showResizeLine ? 'bg-white/55' : 'bg-transparent'
          }`}
        />
      </div>

      {isResizing && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[70] cursor-col-resize" />,
        document.body
      ) : null}

      {createMenuNode}
      {sortMenuNode}
      <LibraryHoverTooltip tooltip={hoverTooltip} />
    </div>
  );
}
