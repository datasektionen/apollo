import React from 'react';
import { Search, X, CircleUserRound } from 'lucide-react';
import { BrandMark } from '../BrandLogo';
import { PlayerSearchResults } from '../PlayerSearch';

export function MobileSearchTab({
  searchDraft = '',
  onSearchDraftChange,
  searchType,
  onSearchTypeChange,
  searchResults,
  searchSongItems = [],
  focusedSearchCreditId,
  onFocusedCreditChange,
  onSelectSearchItem,
  onPlaySearchItem,
  onOpenUserMenu,
}) {
  const safeSearchDraft = searchDraft || '';
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)] select-none">
      {/* Top Header: User Symbol + "Search" Title */}
      <div className="sticky top-0 z-20 bg-[var(--player-bg-canvas-translucent)] px-4 pt-3 pb-3 backdrop-blur-md border-b border-[var(--player-border-subtle)] space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenUserMenu}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 transition-all"
            aria-label="User Menu"
          >
            <CircleUserRound size={20} />
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--player-text-primary)]">Search</h1>
          <BrandMark className="ml-auto h-6 w-6 opacity-90" alt="" />
        </div>

        {/* Obsidian Search Pill Input */}
        <div className="relative flex items-center">
          <Search size={18} className="absolute left-4 text-[var(--player-text-muted)] pointer-events-none" />
          <input
            type="text"
            value={safeSearchDraft}
            onChange={(e) => onSearchDraftChange?.(e.target.value)}
            placeholder="What do you want to play?"
            className="w-full h-11 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] text-[var(--player-text-primary)] pl-11 pr-10 text-sm font-medium placeholder:text-[var(--player-text-muted)] focus:outline-none focus:border-[var(--player-accent-border)] focus:ring-1 focus:ring-[var(--player-focus-ring)]"
          />
          {safeSearchDraft ? (
            <button
              type="button"
              onClick={() => onSearchDraftChange?.('')}
              className="absolute right-3 p-1 text-[var(--player-text-muted)] hover:text-[var(--player-text-primary)] active:scale-90 transition-transform"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Results view (reuses PlayerSearchResults) */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-28">
        <PlayerSearchResults
          query={safeSearchDraft.trim()}
          results={searchResults}
          songItems={searchSongItems}
          activeType={searchType}
          focusedCreditId={focusedSearchCreditId}
          onFocusedCreditChange={onFocusedCreditChange}
          onTypeChange={onSearchTypeChange}
          onSelect={onSelectSearchItem}
          onPlay={onPlaySearchItem}
        />
      </div>
    </div>
  );
}

export default MobileSearchTab;
