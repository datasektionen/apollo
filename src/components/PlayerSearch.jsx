import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Folder,
  ListMusic,
  Loader2,
  Music,
  Play,
  Search,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import {
  PLAYER_SEARCH_TYPE_LABELS,
  PLAYER_SEARCH_TYPE_TABS,
  PLAYER_SEARCH_TYPES,
  applyRoleToQuery,
  buildSearchSuggestions,
  filterResultsByType,
  parsePlayerSearchQuery,
  searchPlayerCatalog,
} from '../utils/playerSearch';
import { formatDurationMs } from '../utils/playerTime';

const TYPE_ICONS = {
  show: Clapperboard,
  song: Music,
  mix: SlidersHorizontal,
  playlist: ListMusic,
  folder: Folder,
  credit: User,
  role: User,
  query: Search,
};

function SearchTypeIcon({ type, size = 16, className = 'text-gray-400' }) {
  const Icon = TYPE_ICONS[type] || Search;
  return <Icon size={size} className={className} />;
}

function ResultRow({
  item,
  active = false,
  showType = true,
  onSelect,
  onPlay,
}) {
  return (
    <div
      className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
        active ? 'bg-white/10' : 'hover:bg-white/5'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect?.(item)}
        className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-left"
      >
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-900 text-gray-300">
          <SearchTypeIcon type={item.type} size={18} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-white">{item.title}</div>
          <div className="truncate text-[11px] text-gray-400">
            {showType ? [PLAYER_SEARCH_TYPE_LABELS[item.type] || item.type, item.subtitle].filter(Boolean).join(' · ') : item.subtitle}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-3">
        {item.payload?.durationMs ? (
          <span className="text-xs tabular-nums text-gray-500">{formatDurationMs(item.payload.durationMs)}</span>
        ) : null}
        {onPlay && (item.type === 'song' || item.type === 'mix') ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(item);
            }}
            className="rounded p-1 text-gray-400 opacity-0 hover:text-white group-hover:opacity-100"
            title={`Play ${item.title}`}
          >
            <Play size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PlayerSearchBar({
  value,
  onChange,
  results,
  loading = false,
  onSubmit,
  onSelect,
  onPlay,
  onFocus,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const parsed = useMemo(() => parsePlayerSearchQuery(value), [value]);
  const suggestions = useMemo(
    () => buildSearchSuggestions(parsed, results, { limit: 8 }),
    [parsed, results]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const applySuggestion = (suggestion) => {
    if (!suggestion) return;
    if (suggestion.type === 'role') {
      onChange(applyRoleToQuery(value, suggestion.payload));
      setOpen(true);
      inputRef.current?.focus();
      return;
    }
    if (suggestion.type === 'query') {
      setOpen(false);
      onSubmit?.(parsed.raw);
      return;
    }
    setOpen(false);
    onSelect?.(suggestion);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && suggestions[activeIndex]) {
        applySuggestion(suggestions[activeIndex]);
        return;
      }
      setOpen(false);
      onSubmit?.(value.trim());
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  const showMenu = open && Boolean(value.trim()) && (suggestions.length > 0 || loading);

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <div className="relative flex h-9 min-w-0 items-center">
        <Search size={15} className="pointer-events-none absolute left-3 text-gray-500" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder="What do you want to play?"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full min-w-0 box-border rounded-md border border-gray-700 bg-gray-900 py-0 pl-9 pr-9 text-sm leading-none text-gray-100 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
        />
        {loading ? (
          <Loader2 size={14} className="absolute right-3 animate-spin text-gray-500" />
        ) : value ? (
          <button
            type="button"
            className="absolute right-2 rounded p-1 text-gray-500 hover:text-white"
            onClick={() => {
              onChange('');
              onSubmit?.('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {showMenu ? (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 py-1 shadow-2xl">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left ${
                index === activeIndex ? 'bg-white/10 text-white' : 'text-gray-200 hover:bg-white/5'
              }`}
            >
              <SearchTypeIcon type={suggestion.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {suggestion.type === 'query' ? `Search for "${suggestion.title}"` : suggestion.title}
                </div>
                {suggestion.type !== 'query' && suggestion.subtitle ? (
                  <div className="truncate text-[11px] text-gray-400">{suggestion.subtitle}</div>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-500">
                {PLAYER_SEARCH_TYPE_LABELS[suggestion.type] || suggestion.subtitle || ''}
              </span>
              {(suggestion.type === 'song' || suggestion.type === 'mix') && onPlay ? (
                <span
                  role="presentation"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onPlay(suggestion);
                  }}
                  className="rounded p-1 text-gray-400 hover:text-white"
                >
                  <Play size={13} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchSection({ title, items, onShowAll, onSelect, onPlay }) {
  if (!items?.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {onShowAll && items.length > 4 ? (
          <button type="button" onClick={onShowAll} className="text-xs font-semibold text-gray-400 hover:text-white">
            Show all
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {items.slice(0, 5).map((item) => (
          <ResultRow key={item.id} item={item} onSelect={onSelect} onPlay={onPlay} />
        ))}
      </div>
    </section>
  );
}

function CreditDetail({ credit, songsByProjectId, onBack, onSelect, onPlay }) {
  const payload = credit?.payload || credit;
  const involvements = payload?.involvements || [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-4 border-b border-gray-700 px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Back
        </button>
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-900">
          <User size={28} className="text-gray-400" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.16em] text-gray-500">
            {payload?.artistType === 'group' ? 'Group' : 'Credits'}
          </div>
          <h2 className="truncate text-2xl font-semibold">{payload?.name}</h2>
          {payload?.groupType ? (
            <div className="text-sm text-gray-400">{payload.groupType}</div>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        {!involvements.length ? (
          <div className="text-sm text-gray-500">No accessible credits for this person.</div>
        ) : (
          <div className="space-y-1">
            {involvements.map((row, index) => {
              const song = row.projectId ? songsByProjectId.get(String(row.projectId)) : null;
              const title = row.projectName
                ? `${row.musicalNumber ? `${row.musicalNumber} - ` : ''}${row.projectName}`
                : (row.showName || 'Show');
              const item = song || (row.showId ? {
                id: `show:${row.showId}`,
                type: 'show',
                title: row.showName || 'Show',
                payload: { id: row.showId, name: row.showName },
              } : null);
              return (
                <div
                  key={`${row.roleKey}:${row.projectId}:${row.showId}:${row.contributionLabel}:${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_160px] items-center gap-3 rounded-md px-2 py-2 hover:bg-white/5"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => item && onSelect(item)}
                    disabled={!item}
                  >
                    <div className="truncate text-sm text-white">{title}</div>
                    <div className="truncate text-[11px] text-gray-400">
                      {[row.roleLabel, row.contributionLabel, row.showName].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                  {song ? (
                    <button
                      type="button"
                      onClick={() => onPlay?.(song)}
                      className="justify-self-end rounded p-1 text-gray-400 hover:text-white"
                      title={`Play ${song.title}`}
                    >
                      <Play size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlayerSearchResults({
  query,
  results,
  songItems = [],
  activeType = PLAYER_SEARCH_TYPES.ALL,
  focusedCreditId = null,
  onFocusedCreditChange = null,
  onTypeChange,
  onSelect,
  onPlay,
}) {
  const [selectedCredit, setSelectedCredit] = useState(null);
  const visible = filterResultsByType(results, activeType);
  const songsByProjectId = useMemo(() => {
    const map = new Map();
    songItems.forEach((item) => {
      const projectId = String(item.payload?.projectId || item.payload?.id || '');
      if (projectId) map.set(projectId, item);
    });
    return map;
  }, [songItems]);

  useEffect(() => {
    setSelectedCredit(null);
  }, [query]);

  useEffect(() => {
    if (!focusedCreditId) return;
    const credit = (results?.byType?.credits || []).find((item) => item.id === focusedCreditId)
      || (results?.all || []).find((item) => item.id === focusedCreditId);
    if (credit) setSelectedCredit(credit);
  }, [focusedCreditId, results]);

  const handleSelect = (item) => {
    if (item?.type === 'credit') {
      setSelectedCredit(item);
      onFocusedCreditChange?.(item.id);
      return;
    }
    onSelect?.(item);
  };

  if (selectedCredit) {
    return (
      <CreditDetail
        credit={selectedCredit}
        songsByProjectId={songsByProjectId}
        onBack={() => {
          setSelectedCredit(null);
          onFocusedCreditChange?.(null);
        }}
        onSelect={handleSelect}
        onPlay={onPlay}
      />
    );
  }

  const counts = {
    [PLAYER_SEARCH_TYPES.SHOWS]: results?.byType?.shows?.length || 0,
    [PLAYER_SEARCH_TYPES.SONGS]: results?.byType?.songs?.length || 0,
    [PLAYER_SEARCH_TYPES.MIXES]: results?.byType?.mixes?.length || 0,
    [PLAYER_SEARCH_TYPES.PLAYLISTS]: results?.byType?.playlists?.length || 0,
    [PLAYER_SEARCH_TYPES.FOLDERS]: results?.byType?.folders?.length || 0,
    [PLAYER_SEARCH_TYPES.CREDITS]: results?.byType?.credits?.length || 0,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-gray-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Search</h2>
        <p className="mt-0.5 truncate text-xs text-gray-400">
          {query ? `Results for “${query}”` : 'Type a show, song, mix, playlist, folder, or person'}
        </p>
        <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
          {PLAYER_SEARCH_TYPE_TABS.map((tab) => {
            const count = tab.id === PLAYER_SEARCH_TYPES.ALL ? (results?.total || 0) : counts[tab.id];
            const active = activeType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTypeChange?.(tab.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  active ? 'bg-white text-gray-900' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                }`}
              >
                {tab.label}
                {query ? ` ${count}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4">
        {!query ? (
          <div className="text-sm text-gray-500">Start typing to search your library.</div>
        ) : !visible.total ? (
          <div className="text-sm text-gray-500">No results found.</div>
        ) : activeType === PLAYER_SEARCH_TYPES.ALL ? (
          <div className="space-y-6">
            {visible.topResult ? (
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-white">Top result</h3>
                <button
                  type="button"
                  onClick={() => handleSelect(visible.topResult)}
                  className="w-full max-w-md rounded-xl bg-gray-900/80 p-4 text-left hover:bg-gray-900"
                >
                  <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-lg bg-gray-800">
                    <SearchTypeIcon type={visible.topResult.type} size={32} className="text-gray-300" />
                  </div>
                  <div className="truncate text-2xl font-semibold">{visible.topResult.title}</div>
                  <div className="mt-1 truncate text-sm text-gray-400">
                    {[PLAYER_SEARCH_TYPE_LABELS[visible.topResult.type], visible.topResult.subtitle].filter(Boolean).join(' · ')}
                  </div>
                </button>
              </section>
            ) : null}
            <SearchSection title="Songs" items={results.byType.songs} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.SONGS)} onSelect={handleSelect} onPlay={onPlay} />
            <SearchSection title="Shows" items={results.byType.shows} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.SHOWS)} onSelect={handleSelect} />
            <SearchSection title="Mixes" items={results.byType.mixes} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.MIXES)} onSelect={handleSelect} onPlay={onPlay} />
            <SearchSection title="Playlists" items={results.byType.playlists} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.PLAYLISTS)} onSelect={handleSelect} />
            <SearchSection title="Folders" items={results.byType.folders} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.FOLDERS)} onSelect={handleSelect} />
            <SearchSection title="Credits" items={results.byType.credits} onShowAll={() => onTypeChange?.(PLAYER_SEARCH_TYPES.CREDITS)} onSelect={handleSelect} />
          </div>
        ) : (
          <div className="space-y-0.5">
            {visible.all.map((item) => (
              <ResultRow key={item.id} item={item} onSelect={handleSelect} onPlay={onPlay} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function usePlayerSearchResults(items, credits, query) {
  const parsed = useMemo(() => parsePlayerSearchQuery(query), [query]);
  return useMemo(() => searchPlayerCatalog(items, parsed, credits), [items, parsed, credits]);
}
