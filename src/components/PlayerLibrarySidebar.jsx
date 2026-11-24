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
  canDropLibraryEntryOnTarget,
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
const RESIZE_GAP_PX = 10;
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

function LibraryHoverTooltip({ tooltip, playerTheme = 'dark-gold' }) {
  if (!tooltip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="player-theme player-menu pointer-events-none fixed z-[90] max-w-xs -translate-y-1/2 rounded-lg border border-[var(--player-border-strong)] bg-[var(--player-bg-popover)] px-3 py-1.5 shadow-[var(--player-shadow-popover)]"
      data-player-theme={playerTheme}
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="truncate text-sm font-medium text-[var(--player-text-primary)]">{tooltip.name}</div>
      {tooltip.subtitle ? (
        <div className="truncate text-[11px] text-[var(--player-text-secondary)]">{tooltip.subtitle}</div>
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
    ? (minimized ? 1 : 0.78)
    : (showHover ? 0 : Math.max(0.78, 1 - progress));
  const openOpacity = snap
    ? 0
    : (showHover ? 1 - progress : 0);
  const closeOpacity = snap
    ? 0
    : (showHover ? progress : 0);
  const iconMotion = snap || animating ? 'none' : 'opacity 150ms linear';

  return (
    <span className="relative h-5 w-5 shrink-0 overflow-hidden">
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

function isSameDropTarget(left, right) {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'folder') return String(left.folderId) === String(right.folderId);
  if (left.kind === 'playlist') return String(left.playlistId) === String(right.playlistId);
  return left.kind === 'root';
}

function LibraryEntryRow({
  entry,
  isActive,
  layout,
  draggableEnabled = true,
  isDragging = false,
  isDropTarget = false,
  suppressHoverTooltip = false,
  onSelect,
  onPlayMix,
  onContextMenu,
  onHoverChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}) {
  const EntryIcon = ENTRY_ICONS[entry.kind] || Folder;
  const subtitle = libraryEntrySubtitle(entry);
  const fullyMinimized = layout.progress <= 0;
  const handleHover = (event, hovering) => {
    if (!fullyMinimized || suppressHoverTooltip) {
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
      x: rect.right + 16,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <button
      type="button"
      draggable={draggableEnabled}
      onClick={() => onSelect(entry)}
      onDoubleClick={async () => {
        if (entry.kind === 'mix' && entry.mix) {
          await onPlayMix?.(entry.mix);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onHoverChange(null);
        onContextMenu(entry, event);
      }}
      onMouseEnter={(event) => handleHover(event, true)}
      onMouseLeave={(event) => handleHover(event, false)}
      onDragStart={(event) => onDragStart?.(entry, event)}
      onDragEnd={(event) => onDragEnd?.(entry, event)}
      onDragOver={(event) => onDragOver?.(entry, event)}
      onDragLeave={(event) => onDragLeave?.(entry, event)}
      onDrop={(event) => onDrop?.(entry, event)}
      data-active={isActive ? 'true' : 'false'}
      data-drop-target={isDropTarget ? 'true' : 'false'}
      className={`player-library-row relative flex w-full min-w-0 items-center overflow-hidden rounded-lg text-left transition-colors ${
        isDragging ? 'opacity-45' : ''
      } ${
        isDropTarget ? 'bg-[var(--player-accent-soft)] ring-1 ring-inset ring-[var(--player-accent)]' : ''
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
        className={`shrink-0 transition-colors ${
          isActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-secondary)]'
        }`}
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
        <div
          className={`truncate text-sm font-medium ${
            isActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
          }`}
        >
          {entry.name}
        </div>
        <div className="truncate text-[11px] text-[var(--player-text-muted)]">{subtitle}</div>
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
  contextMenuOpen = false,
  externalDraggedEntry = null,
  onMoveEntry = null,
  onEntryDragStart = null,
  playerTheme = 'dark-gold',
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
  const [draggedEntry, setDraggedEntry] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
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

  const activeDraggedEntry = draggedEntry || externalDraggedEntry || null;
  const suppressHoverTooltip = contextMenuOpen || createOpen || sortOpen || Boolean(activeDraggedEntry);
  const canDropOnRoot = useMemo(() => canDropLibraryEntryOnTarget(
    activeDraggedEntry,
    { kind: 'root' },
    { folders, playlistItemsByPlaylistId }
  ), [activeDraggedEntry, folders, playlistItemsByPlaylistId]);

  useEffect(() => {
    if (suppressHoverTooltip) {
      setHoverTooltip(null);
    }
  }, [suppressHoverTooltip]);

  useEffect(() => {
    if (!activeDraggedEntry) {
      setDropTarget(null);
    }
  }, [activeDraggedEntry]);

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

  const updateDropTarget = useCallback((nextTarget) => {
    setDropTarget((previous) => (isSameDropTarget(previous, nextTarget) ? previous : nextTarget));
  }, []);

  const clearDropTargetIfSame = useCallback((expectedTarget) => {
    setDropTarget((previous) => (isSameDropTarget(previous, expectedTarget) ? null : previous));
  }, []);

  const targetForEntry = (entry) => {
    if (entry?.kind === 'folder' && entry.folder?.id) {
      return { kind: 'folder', folderId: entry.folder.id };
    }
    if (entry?.kind === 'playlist' && entry.playlist?.id) {
      return { kind: 'playlist', playlistId: entry.playlist.id };
    }
    return null;
  };

  const handleRowDragStart = (entry, event) => {
    if (isResizing) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-apollo-library-entry', entry.id);
    event.dataTransfer.setData('text/plain', entry.id);
    setHoverTooltip(null);
    setDraggedEntry(entry);
    onEntryDragStart?.(entry);
  };

  const handleRowDragEnd = () => {
    setDraggedEntry(null);
    setDropTarget(null);
  };

  const handleRowDragOver = (entry, event) => {
    if (!activeDraggedEntry) return;
    const rowTarget = targetForEntry(entry);
    if (
      !rowTarget
      || !canDropLibraryEntryOnTarget(activeDraggedEntry, rowTarget, { folders, playlistItemsByPlaylistId })
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    updateDropTarget(rowTarget);
  };

  const handleRowDragLeave = (entry, event) => {
    const rowTarget = targetForEntry(entry);
    if (!rowTarget) return;
    if (!event.currentTarget.contains(event.relatedTarget)) {
      clearDropTargetIfSame(rowTarget);
    }
  };

  const handleRowDrop = (entry, event) => {
    if (!activeDraggedEntry) return;
    const rowTarget = targetForEntry(entry);
    if (
      !rowTarget
      || !canDropLibraryEntryOnTarget(activeDraggedEntry, rowTarget, { folders, playlistItemsByPlaylistId })
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const moving = activeDraggedEntry;
    setDraggedEntry(null);
    setDropTarget(null);
    void onMoveEntry?.(moving, rowTarget);
  };

  const handleRootDragOver = (event) => {
    if (!canDropOnRoot) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    updateDropTarget({ kind: 'root' });
  };

  const handleRootDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      clearDropTargetIfSame({ kind: 'root' });
    }
  };

  const handleRootDrop = (event) => {
    if (!canDropOnRoot) return;
    event.preventDefault();
    event.stopPropagation();
    const moving = activeDraggedEntry;
    setDraggedEntry(null);
    setDropTarget(null);
    void onMoveEntry?.(moving, { kind: 'root' });
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
        className="player-theme player-menu fixed z-[80] min-w-40 overflow-hidden rounded-lg border border-[var(--player-border-strong)] bg-[var(--player-bg-popover)] py-1 shadow-[var(--player-shadow-popover)]"
        data-player-theme={playerTheme}
        style={{ top: createMenu.coords.top, left: createMenu.coords.left }}
      >
        <button
          type="button"
          onClick={async () => {
            setCreateOpen(false);
            await onCreateFolder?.();
          }}
          className="player-menu-item w-full px-3 py-2 text-left text-sm"
        >
          Create Folder
        </button>
        <button
          type="button"
          onClick={async () => {
            setCreateOpen(false);
            await onCreatePlaylist?.();
          }}
          className="player-menu-item w-full px-3 py-2 text-left text-sm"
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
        className="player-theme player-menu fixed z-[80] w-max overflow-hidden rounded-lg border border-[var(--player-border-strong)] bg-[var(--player-bg-popover)] py-1 shadow-[var(--player-shadow-popover)]"
        data-player-theme={playerTheme}
        style={{ top: sortMenu.coords.top, right: sortMenu.coords.right }}
      >
        {LIBRARY_SORT_OPTIONS.map((option) => {
          const selected = option.id === sort;
          return (
            <div
              key={option.id}
              className={`player-menu-item relative ${
                selected ? 'text-[var(--player-accent-text)] font-medium' : 'text-[var(--player-text-secondary)]'
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
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-[var(--player-accent-text)] hover:text-[var(--player-text-primary)]"
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)]">
        <div
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={handleRootDrop}
          className={`relative z-20 flex h-11 min-h-11 max-h-11 shrink-0 items-center border-b border-[var(--player-border-subtle)] transition-colors ${
            fullyMinimized ? 'justify-center px-1' : 'gap-1 pl-[15px] pr-2'
          } ${
            canDropOnRoot && dropTarget?.kind === 'root'
              ? 'bg-[var(--player-accent-soft)] ring-1 ring-inset ring-[var(--player-accent)]'
              : ''
          }`}
        >
          <button
            type="button"
            onClick={toggleMode}
            onMouseEnter={() => setHeaderHover(true)}
            onMouseLeave={() => setHeaderHover(false)}
            className={`group/toggle flex items-center rounded-md py-1 text-left text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors ${
              fullyMinimized ? 'h-8 w-8 justify-center px-0' : 'min-w-0 flex-1 gap-1.5 pl-1.5 pr-1'
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
                className="truncate text-[15px] font-bold leading-none tracking-tight text-[var(--player-text-primary)]"
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
              className="rounded-md p-1.5 text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
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
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            className={`shrink-0 overflow-hidden border-b border-[var(--player-border-subtle)] transition-colors ${
              canDropOnRoot && dropTarget?.kind === 'root'
                ? 'bg-[var(--player-accent-soft)] ring-1 ring-inset ring-[var(--player-accent)]'
                : ''
            }`}
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
              className="inline-flex max-w-full items-center gap-1 rounded-md text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
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
                className="truncate text-sm font-medium"
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
          className="flex shrink-0 items-center gap-2 overflow-hidden border-[var(--player-border-subtle)]"
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
              <Search size={TOOLBAR_ICON_SIZE} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--player-text-muted)]" />
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
                className={`h-7 w-full rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] py-0 pl-8 text-xs text-[var(--player-text-primary)] placeholder:text-[var(--player-text-muted)] focus:border-[var(--player-accent-border)] focus:outline-none ${
                  searchDraft ? 'pr-7' : 'pr-2.5'
                }`}
              />
              {searchDraft ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--player-text-muted)] hover:text-[var(--player-text-primary)]"
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
              className="rounded-md p-1.5 text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
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
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
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
          className={`flex-1 overflow-auto transition-colors ${
            !libraryScopeFolderId && canDropOnRoot && dropTarget?.kind === 'root'
              ? 'bg-[var(--player-accent-softer)]'
              : ''
          }`}
          style={{
            padding: layout.listPad,
            rowGap: 2,
            display: 'flex',
            flexDirection: 'column',
          }}
          onDragOver={!libraryScopeFolderId ? handleRootDragOver : undefined}
          onDragLeave={!libraryScopeFolderId ? handleRootDragLeave : undefined}
          onDrop={!libraryScopeFolderId ? handleRootDrop : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            setHoverTooltip(null);
            onContextMenu?.(null, event);
          }}
        >
          {displayedItems.map((entry) => {
            const rowTarget = targetForEntry(entry);
            return (
              <LibraryEntryRow
                key={entry.id}
                entry={entry}
                isActive={isEntryActive(entry)}
                layout={layout}
                draggableEnabled={!isResizing}
                isDragging={activeDraggedEntry?.id === entry.id}
                isDropTarget={Boolean(rowTarget && isSameDropTarget(dropTarget, rowTarget))}
                suppressHoverTooltip={suppressHoverTooltip}
                onSelect={onSelectEntry}
                onPlayMix={onPlayMix}
                onContextMenu={(nextEntry, event) => onContextMenu?.(nextEntry, event)}
                onHoverChange={setHoverTooltip}
                onDragStart={handleRowDragStart}
                onDragEnd={handleRowDragEnd}
                onDragOver={handleRowDragOver}
                onDragLeave={handleRowDragLeave}
                onDrop={handleRowDrop}
              />
            );
          })}
          {!displayedItems.length ? (
            <div
              className="text-xs text-[var(--player-text-muted)]"
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
          {canDropOnRoot && !fullyMinimized ? (
            <div
              data-library-root-dropzone="true"
              onDragOver={handleRootDragOver}
              onDragLeave={handleRootDragLeave}
              onDrop={handleRootDrop}
              className={`mt-1 rounded-lg border border-dashed px-3 py-2 text-center text-xs font-medium transition-colors ${
                dropTarget?.kind === 'root'
                  ? 'border-[var(--player-accent)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                  : 'border-[var(--player-border-default)] text-[var(--player-text-muted)]'
              }`}
            >
              Drop here to move to Library root
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
            isResizing
              ? 'bg-[var(--player-accent)]'
              : showResizeLine
                ? 'bg-[var(--player-border-strong)]'
                : 'bg-transparent'
          }`}
        />
      </div>

      {isResizing && typeof document !== 'undefined' ? createPortal(
        <div className="player-theme fixed inset-0 z-[70] cursor-col-resize" data-player-theme={playerTheme} />,
        document.body
      ) : null}

      {createMenuNode}
      {sortMenuNode}
      <LibraryHoverTooltip tooltip={suppressHoverTooltip ? null : hoverTooltip} playerTheme={playerTheme} />
    </div>
  );
}
