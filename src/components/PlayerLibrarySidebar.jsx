import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Folder,
  LibraryBig,
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
  commitLibrarySidebarDrag,
  libraryEntryFromSearchItem,
  libraryEntrySubtitle,
  librarySidebarProgress,
  lerp,
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
const CARD_BORDER_PX = 1;
const LIST_PAD_MIN = 4;
const LIST_PAD_MAX = 8;
const ENTRY_PAD_MAX = 8;
const ENTRY_GAP_MAX = 12;
const TOOLBAR_HEIGHT = 36;
const MINIMIZED_INNER = LIBRARY_SIDEBAR.MINIMIZED_WIDTH - CARD_BORDER_PX * 2 - LIST_PAD_MIN * 2;
const ENTRY_ROW_HEIGHT = MINIMIZED_INNER;
const MINIMIZED_CENTER_PAD = Math.max(0, (ENTRY_ROW_HEIGHT - ENTRY_ICON_SIZE) / 2);
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

function getSidebarLayout(sidebarWidth) {
  const progress = librarySidebarProgress(sidebarWidth);
  return {
    progress,
    listPad: lerp(LIST_PAD_MIN, LIST_PAD_MAX, progress),
    iconPad: lerp(MINIMIZED_CENTER_PAD, ENTRY_PAD_MAX, progress),
    rowHeight: ENTRY_ROW_HEIGHT,
    gap: lerp(0, ENTRY_GAP_MAX, progress),
  };
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

function HeaderToggleIcon({ progress, hovering, instant, animating }) {
  const showHover = hovering && !instant;
  const snap = instant;
  const minimized = progress <= 0;

  const libraryOpacity = snap
    ? (minimized ? 1 : 0)
    : (showHover ? 0 : 1 - progress);
  const openOpacity = snap
    ? 0
    : (showHover ? 1 - progress : 0);
  const closeOpacity = snap
    ? 0
    : (showHover ? progress : 0);
  const slotOpen = snap ? minimized : (progress < 1 || showHover);
  const iconMotion = snap || animating ? 'none' : 'opacity 150ms linear';
  const slotMotion = snap || animating ? 'none' : 'width 150ms linear, margin 150ms linear';

  return (
    <span
      className="relative h-5 shrink-0 overflow-hidden"
      style={{
        width: slotOpen ? HEADER_ICON_SIZE : 0,
        marginRight: slotOpen && progress > 0 ? 6 : 0,
        transition: slotMotion,
      }}
    >
      <LibraryBig
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: libraryOpacity, transition: iconMotion }}
      />
      <PanelLeftOpen
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: openOpacity, transition: iconMotion }}
      />
      <PanelLeftClose
        size={HEADER_ICON_SIZE}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: closeOpacity, transition: iconMotion }}
      />
    </span>
  );
}

function LibraryEntryRow({
  entry,
  isActive,
  layout,
  onSelect,
  onPlayMix,
  onContextMenu,
  onHoverChange,
}) {
  const EntryIcon = ENTRY_ICONS[entry.kind] || Folder;
  const subtitle = libraryEntrySubtitle(entry);
  const fullyMinimized = layout.progress <= 0;
  const handleHover = (event, hovering) => {
    if (!fullyMinimized) {
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
    <button
      type="button"
      onClick={() => onSelect(entry)}
      onDoubleClick={async () => {
        if (entry.kind === 'mix' && entry.mix) {
          await onPlayMix?.(entry.mix);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(entry, event);
      }}
      onMouseEnter={(event) => handleHover(event, true)}
      onMouseLeave={(event) => handleHover(event, false)}
      className={`flex w-full min-w-0 items-center overflow-hidden rounded-md text-left transition-colors ${
        isActive ? 'bg-blue-700/30' : 'hover:bg-gray-700'
      }`}
      style={{
        height: layout.rowHeight,
        paddingLeft: layout.iconPad,
        paddingRight: layout.iconPad,
        gap: layout.gap,
      }}
      aria-label={fullyMinimized ? `${entry.name} (${subtitle})` : undefined}
    >
      <EntryIcon
        size={ENTRY_ICON_SIZE}
        className="shrink-0 text-gray-300"
        style={{ width: ENTRY_ICON_SIZE, height: ENTRY_ICON_SIZE, minWidth: ENTRY_ICON_SIZE }}
      />
      <div
        className="overflow-hidden"
        style={{
          opacity: layout.progress,
          flexGrow: layout.progress,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          maxWidth: layout.progress <= 0 ? 0 : undefined,
        }}
        aria-hidden={fullyMinimized}
      >
        <div className="truncate text-sm">{entry.name}</div>
        <div className="truncate text-[11px] text-gray-500">{subtitle}</div>
      </div>
    </button>
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
  const [viewWidth, setViewWidth] = useState(null);
  const [sort, setSort] = useState(saved.sort);
  const [sortReversed, setSortReversed] = useState(saved.sortReversed);
  const [isResizing, setIsResizing] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const [headerHover, setHeaderHover] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const searchInputRef = useRef(null);
  const resizeRef = useRef(null);
  const animRef = useRef(null);
  const sidebarWidthRef = useRef(null);
  const sidebarRootRef = useRef(null);
  const resizingRef = useRef(false);
  const createMenu = useAnchoredMenu(createOpen);
  const sortMenu = useAnchoredMenu(sortOpen);

  const committedWidth = mode === LIBRARY_SIDEBAR_MODES.MINIMIZED
    ? LIBRARY_SIDEBAR.MINIMIZED_WIDTH
    : clampLibrarySidebarWidth(width);
  const sidebarWidth = viewWidth ?? committedWidth;
  sidebarWidthRef.current = sidebarWidth;
  const layout = getSidebarLayout(sidebarWidth);
  const { progress } = layout;
  const fullyMinimized = progress <= 0;
  const chromeInteractive = progress > 0.85;

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

  const searchQuery = searchOpen && progress > 0 ? searchDraft.trim() : '';
  const displayedItems = useMemo(() => {
    if (searchQuery) {
      return searchPlayerLibrary(catalogItems, searchQuery)
        .all
        .map(libraryEntryFromSearchItem)
        .filter(Boolean);
    }
    return sortLibraryItems(scopedItems, sort, sortReversed);
  }, [catalogItems, scopedItems, searchQuery, sort, sortReversed]);

  const stopAnimation = useCallback(() => {
    if (animRef.current != null) {
      window.cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setIsAnimating(false);
  }, []);

  const animateToWidth = useCallback((targetWidth, targetMode, { onComplete } = {}) => {
    stopAnimation();
    const from = sidebarWidthRef.current;
    const start = performance.now();
    setIsAnimating(true);
    const step = (now) => {
      const t = Math.min(1, (now - start) / LIBRARY_SIDEBAR.TOGGLE_ANIMATION_MS);
      setViewWidth(from + (targetWidth - from) * t);
      if (t < 1) {
        animRef.current = window.requestAnimationFrame(step);
        return;
      }
      animRef.current = null;
      setMode(targetMode);
      if (targetMode === LIBRARY_SIDEBAR_MODES.DEFAULT) {
        setWidth(clampLibrarySidebarWidth(targetWidth));
      }
      setIsAnimating(false);
      onComplete?.(targetWidth, targetMode);
      if (!resizingRef.current) {
        setViewWidth(null);
      }
    };
    animRef.current = window.requestAnimationFrame(step);
  }, [stopAnimation]);

  useEffect(() => () => {
    if (animRef.current != null) window.cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => {
    if (isResizing || isAnimating) return;
    writeLibrarySidebarSettings({ mode, width, sort, sortReversed });
  }, [isAnimating, isResizing, mode, sort, sortReversed, width]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!fullyMinimized) return;
    setSearchOpen(false);
    setSearchDraft('');
    setCreateOpen(false);
    setSortOpen(false);
    setHoverTooltip(null);
  }, [fullyMinimized]);

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
    const applyDragPosition = (clientX) => {
      const drag = resizeRef.current;
      if (!drag || drag.modeAnimating) return;
      const pointerWidth = clientX - drag.originLeft - drag.grabOffset;
      const next = resolveLibrarySidebarDrag({
        mode: drag.mode,
        pointerWidth,
      });
      if (next.mode !== drag.mode) {
        const targetWidth = next.mode === LIBRARY_SIDEBAR_MODES.MINIMIZED
          ? LIBRARY_SIDEBAR.MINIMIZED_WIDTH
          : LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH;
        drag.modeAnimating = true;
        drag.last = { mode: next.mode, width: targetWidth };
        animateToWidth(targetWidth, next.mode, {
          onComplete: (finishedWidth, finishedMode) => {
            const active = resizeRef.current;
            if (!active) return;
            active.mode = finishedMode;
            active.modeAnimating = false;
            active.last = { mode: finishedMode, width: finishedWidth };
            if (resizingRef.current) {
              applyDragPosition(active.lastClientX);
            }
          },
        });
        return;
      }
      drag.last = next;
      setViewWidth(next.width);
      setMode(next.mode);
      if (next.mode === LIBRARY_SIDEBAR_MODES.DEFAULT) {
        setWidth(next.width);
      }
    };
    const handleMove = (event) => {
      const drag = resizeRef.current;
      if (!drag) return;
      drag.lastClientX = event.clientX;
      applyDragPosition(event.clientX);
    };
    const handleUp = () => {
      const drag = resizeRef.current;
      resizingRef.current = false;
      setIsResizing(false);
      if (drag?.modeAnimating) {
        return;
      }
      const next = drag?.last || {
        mode: drag?.mode,
        width: sidebarWidthRef.current,
      };
      const committed = commitLibrarySidebarDrag({
        mode: next.mode,
        width: next.width,
      });
      setMode(committed.mode);
      if (committed.mode === LIBRARY_SIDEBAR_MODES.DEFAULT) {
        setWidth(committed.width);
      }
      setViewWidth(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [animateToWidth, isResizing]);

  const sortLabel = LIBRARY_SORT_OPTIONS.find((option) => option.id === sort)?.label || 'Latest';
  const showResizeLine = isResizing || resizeHover;
  const instantChrome = isResizing;

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
    if (fullyMinimized) {
      animateToWidth(clampLibrarySidebarWidth(width), LIBRARY_SIDEBAR_MODES.DEFAULT);
      return;
    }
    animateToWidth(LIBRARY_SIDEBAR.MINIMIZED_WIDTH, LIBRARY_SIDEBAR_MODES.MINIMIZED);
  };

  const startResize = (event) => {
    event.preventDefault();
    stopAnimation();
    const startMode = fullyMinimized
      ? LIBRARY_SIDEBAR_MODES.MINIMIZED
      : LIBRARY_SIDEBAR_MODES.DEFAULT;
    const startWidth = fullyMinimized
      ? LIBRARY_SIDEBAR.MINIMIZED_WIDTH
      : Math.max(LIBRARY_SIDEBAR.DEFAULT_MIN_WIDTH, sidebarWidth);
    const rect = sidebarRootRef.current?.getBoundingClientRect();
    const originLeft = rect?.left ?? 0;
    const grabOffset = event.clientX - (rect?.right ?? event.clientX);
    resizingRef.current = true;
    resizeRef.current = {
      mode: startMode,
      originLeft,
      grabOffset,
      lastClientX: event.clientX,
      modeAnimating: false,
      last: {
        mode: startMode,
        width: startWidth,
      },
    };
    setViewWidth(sidebarWidth);
    setIsResizing(true);
    setCreateOpen(false);
    setSortOpen(false);
    setHoverTooltip(null);
    setHeaderHover(false);
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
      ref={sidebarRootRef}
      className="relative shrink-0 min-h-0"
      style={{ width: sidebarWidth }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800/80">
        <div className={`relative z-20 flex h-11 min-h-11 max-h-11 shrink-0 items-center border-b border-gray-700 ${
          fullyMinimized ? 'justify-center px-1' : 'gap-1 px-2'
        }`}>
          <button
            type="button"
            onClick={toggleMode}
            onMouseEnter={() => setHeaderHover(true)}
            onMouseLeave={() => setHeaderHover(false)}
            className={`group/toggle flex items-center rounded-md py-1 text-left hover:bg-gray-700 ${
              fullyMinimized ? 'h-8 w-8 justify-center px-0' : 'min-w-0 flex-1 px-1'
            }`}
            title={fullyMinimized ? 'Expand Your Library' : 'Collapse Your Library'}
            aria-label={fullyMinimized ? 'Expand Your Library' : 'Collapse Your Library'}
          >
            <HeaderToggleIcon
              progress={progress}
              hovering={headerHover}
              instant={instantChrome}
              animating={isAnimating}
            />
            {fullyMinimized ? null : (
              <span
                className="truncate text-base font-semibold leading-none"
                style={{
                  opacity: progress,
                  maxWidth: lerp(0, 180, progress),
                  minWidth: 0,
                  flexGrow: 0,
                  flexShrink: 1,
                  overflow: 'hidden',
                }}
              >
                Your Library
              </span>
            )}
          </button>

          {fullyMinimized ? null : (
            <button
              ref={createMenu.triggerRef}
              type="button"
              onClick={() => {
                if (!chromeInteractive) return;
                setCreateOpen((previous) => !previous);
                setSortOpen(false);
              }}
              className="rounded p-1.5 hover:bg-gray-700"
              title="Create"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              aria-hidden={!chromeInteractive}
              tabIndex={chromeInteractive ? 0 : -1}
              style={{
                opacity: progress,
                width: lerp(0, 32, progress),
                minWidth: 0,
                overflow: 'hidden',
                pointerEvents: chromeInteractive ? 'auto' : 'none',
              }}
            >
              <Plus size={HEADER_ICON_SIZE} />
            </button>
          )}
        </div>

        {libraryScopeFolderId && !searchQuery ? (
          <div
            className="shrink-0 overflow-hidden border-b border-gray-700"
            style={{
              paddingLeft: lerp(4, 8, progress),
              paddingRight: lerp(4, 8, progress),
              paddingTop: lerp(4, 6, progress),
              paddingBottom: lerp(4, 6, progress),
            }}
          >
            <button
              type="button"
              onClick={() => onLibraryScopeChange?.(null)}
              className="inline-flex max-w-full items-center gap-1 rounded hover:bg-gray-700"
              title="Back to Your Library"
              aria-label="Back to Your Library"
              style={{
                height: lerp(36, 28, progress),
                paddingLeft: lerp(6, 4, progress),
                paddingRight: lerp(6, 4, progress),
              }}
            >
              <ChevronLeft size={Math.round(lerp(16, 13, progress))} className="shrink-0" />
              <span
                className="truncate text-sm"
                style={{
                  opacity: progress,
                  maxWidth: lerp(0, 200, progress),
                  overflow: 'hidden',
                }}
              >
                {currentFolder?.name || 'Your Library'}
              </span>
            </button>
          </div>
        ) : null}

        <div
          className="flex shrink-0 items-center gap-2 overflow-hidden border-gray-700"
          style={{
            height: lerp(0, TOOLBAR_HEIGHT, progress),
            opacity: progress,
            paddingLeft: 8,
            paddingRight: 8,
            pointerEvents: chromeInteractive ? 'auto' : 'none',
            borderBottomWidth: progress > 0 ? 1 : 0,
            borderBottomStyle: 'solid',
          }}
          aria-hidden={!chromeInteractive}
        >
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
              tabIndex={chromeInteractive ? 0 : -1}
            >
              <Search size={TOOLBAR_ICON_SIZE} />
            </button>
          )}
          <button
            ref={sortMenu.triggerRef}
            type="button"
            onClick={() => {
              if (!chromeInteractive) return;
              setSortOpen((previous) => !previous);
              setCreateOpen(false);
            }}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            title="Change library order"
            tabIndex={chromeInteractive ? 0 : -1}
          >
            {searchOpen ? null : <span>{sortLabel}</span>}
            <ListFilter size={TOOLBAR_ICON_SIZE} className="shrink-0" />
          </button>
        </div>

        <div
          className="flex-1 overflow-auto"
          style={{
            padding: layout.listPad,
            rowGap: 4,
            display: 'flex',
            flexDirection: 'column',
          }}
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
              layout={layout}
              onSelect={onSelectEntry}
              onPlayMix={onPlayMix}
              onContextMenu={(nextEntry, event) => onContextMenu?.(nextEntry, event)}
              onHoverChange={setHoverTooltip}
            />
          ))}
          {!displayedItems.length ? (
            <div
              className="text-xs text-gray-500"
              style={{
                paddingLeft: fullyMinimized ? 4 : 8,
                paddingRight: fullyMinimized ? 4 : 8,
                paddingTop: 8,
                paddingBottom: 8,
                textAlign: fullyMinimized ? 'center' : 'left',
              }}
            >
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
            isResizing ? 'bg-white/75' : showResizeLine ? 'bg-white/45' : 'bg-transparent'
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
