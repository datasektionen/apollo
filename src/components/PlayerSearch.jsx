import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
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

function SearchTypeIcon({ type, size = 18, className = 'text-[var(--player-text-muted)]' }) {
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
      className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-[var(--player-bg-elevated)]' : 'hover:bg-[var(--player-hover)]'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect?.(item)}
        className="col-span-2 grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          <SearchTypeIcon type={item.type} size={18} className="text-[var(--player-text-secondary)]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--player-text-primary)]">{item.title}</div>
          <div className="truncate text-xs text-[var(--player-text-secondary)]">
            {showType ? [PLAYER_SEARCH_TYPE_LABELS[item.type] || item.type, item.subtitle].filter(Boolean).join(' · ') : item.subtitle}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-3">
        {item.payload?.durationMs ? (
          <span className="text-xs tabular-nums text-[var(--player-text-muted)]">
            {formatDurationMs(item.payload.durationMs)}
          </span>
        ) : null}
        {onPlay && (item.type === 'song' || item.type === 'mix') ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(item);
            }}
            className="rounded-full p-1.5 text-[var(--player-text-secondary)] opacity-0 hover:bg-[var(--player-pressed)] hover:text-[var(--player-accent-text)] group-hover:opacity-100 focus:opacity-100 transition-all"
            title={`Play ${item.title}`}
          >
            <Play size={14} className="fill-current" />
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
      <div className="relative flex h-10 min-w-0 items-center">
        <Search size={16} className="pointer-events-none absolute left-3.5 text-[var(--player-text-muted)]" />
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
          className="h-10 w-full min-w-0 box-border rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] py-0 pl-10 pr-10 text-sm leading-none text-[var(--player-text-primary)] placeholder:text-[var(--player-text-muted)] transition-colors focus:border-[var(--player-accent-border)] focus:outline-none focus:ring-1 focus:ring-[var(--player-focus-ring)]"
        />
        {loading ? (
          <Loader2 size={14} className="absolute right-3.5 animate-spin text-[var(--player-accent-text)]" />
        ) : value ? (
          <button
            type="button"
            className="absolute right-2.5 rounded-full p-1 text-[var(--player-text-muted)] hover:text-[var(--player-text-primary)] transition-colors"
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
        <div className="player-menu absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl py-1">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                index === activeIndex
                  ? 'bg-[var(--player-bg-elevated)] text-[var(--player-text-primary)]'
                  : 'text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
              }`}
            >
              <SearchTypeIcon
                type={suggestion.type}
                size={16}
                className={index === activeIndex ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-muted)]'}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--player-text-primary)]">
                  {suggestion.type === 'query' ? `Search for "${suggestion.title}"` : suggestion.title}
                </div>
                {suggestion.type !== 'query' && suggestion.subtitle ? (
                  <div className="truncate text-xs text-[var(--player-text-secondary)]">{suggestion.subtitle}</div>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--player-text-muted)]">
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
                  className="rounded-full p-1 text-[var(--player-text-secondary)] hover:text-[var(--player-accent-text)]"
                >
                  <Play size={13} className="fill-current" />
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
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="text-base font-bold tracking-tight text-[var(--player-text-primary)]">{title}</h3>
        {onShowAll && items.length > 4 ? (
          <button
            type="button"
            onClick={onShowAll}
            className="text-xs font-semibold text-[var(--player-text-secondary)] hover:text-[var(--player-accent-text)] transition-colors"
          >
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
      <div className="player-hero-surface border-b border-[var(--player-border-subtle)] px-6 py-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 -ml-2.5 text-xs font-semibold text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
        >
          <ChevronLeft size={15} />
          <span>Back</span>
        </button>
        <div className="mt-3 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
            {payload?.artistType === 'group' ? 'Group' : 'Credits'}
          </div>
          <h2 className="mt-1 truncate text-3xl font-extrabold tracking-tight text-[var(--player-text-primary)]">
            {payload?.name}
          </h2>
          {payload?.groupType ? (
            <div className="mt-1 text-sm text-[var(--player-text-secondary)]">{payload.groupType}</div>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        {!involvements.length ? (
          <div className="text-sm text-[var(--player-text-muted)]">No accessible credits for this person.</div>
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
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--player-hover)] transition-colors"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => item && onSelect(item)}
                    disabled={!item}
                  >
                    <div className="truncate text-sm font-medium text-[var(--player-text-primary)]">{title}</div>
                    <div className="truncate text-xs text-[var(--player-text-secondary)]">
                      {[row.roleLabel, row.contributionLabel, row.showName].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                  {song ? (
                    <button
                      type="button"
                      onClick={() => onPlay?.(song)}
                      className="justify-self-end rounded-full p-1.5 text-[var(--player-text-secondary)] hover:bg-[var(--player-pressed)] hover:text-[var(--player-accent-text)] transition-colors"
                      title={`Play ${song.title}`}
                    >
                      <Play size={14} className="fill-current" />
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
      <div className="shrink-0 border-b border-[var(--player-border-subtle)] px-5 py-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
          Search
        </div>
        <p className="mt-1 truncate text-sm text-[var(--player-text-secondary)]">
          {query ? `Results for “${query}”` : 'Type a show, song, mix, playlist, folder, or person'}
        </p>
        <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto scrollbar-hidden pb-0.5">
          {PLAYER_SEARCH_TYPE_TABS.map((tab) => {
            const count = tab.id === PLAYER_SEARCH_TYPES.ALL ? (results?.total || 0) : counts[tab.id];
            const active = activeType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onClick={() => onTypeChange?.(tab.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--player-pill-active-bg)] text-[var(--player-pill-active-fg)]'
                    : 'border border-[var(--player-border-subtle)] bg-[var(--player-pill-bg)] text-[var(--player-pill-fg)] hover:text-[var(--player-text-primary)]'
                }`}
              >
                {tab.label}
                {query ? ` ${count}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        {!query ? (
          <div className="py-8 text-sm text-[var(--player-text-muted)]">Start typing to search your library.</div>
        ) : !visible.total ? (
          <div className="py-8 text-sm text-[var(--player-text-muted)]">No results found.</div>
        ) : activeType === PLAYER_SEARCH_TYPES.ALL ? (
          <div className="space-y-6">
            {visible.topResult ? (
              <section className="space-y-2">
                <h3 className="text-base font-bold tracking-tight text-[var(--player-text-primary)]">Top result</h3>
                <div className="player-hero-surface flex w-full max-w-lg items-center justify-between gap-4 rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] p-5 transition-colors hover:border-[var(--player-accent-border)]">
                  <button
                    type="button"
                    onClick={() => handleSelect(visible.topResult)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
                      {PLAYER_SEARCH_TYPE_LABELS[visible.topResult.type] || visible.topResult.type}
                    </div>
                    <div className="mt-1 truncate text-2xl font-extrabold tracking-tight text-[var(--player-text-primary)]">
                      {visible.topResult.title}
                    </div>
                    {visible.topResult.subtitle ? (
                      <div className="mt-1 truncate text-sm text-[var(--player-text-secondary)]">
                        {visible.topResult.subtitle}
                      </div>
                    ) : null}
                  </button>
                  {(visible.topResult.type === 'song' || visible.topResult.type === 'mix') && onPlay ? (
                    <button
                      type="button"
                      onClick={() => onPlay(visible.topResult)}
                      className="player-play-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                      title={`Play ${visible.topResult.title}`}
                      aria-label={`Play ${visible.topResult.title}`}
                    >
                      <Play size={18} className="fill-current translate-x-0.5" />
                    </button>
                  ) : null}
                </div>
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
