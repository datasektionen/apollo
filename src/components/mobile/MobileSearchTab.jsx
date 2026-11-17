import React from 'react';
import { Search, X, CircleUserRound } from 'lucide-react';
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
    <div className="flex-1 min-h-0 flex flex-col bg-gray-950 text-white select-none">
      {/* Top Header: User Symbol + "Search" Title (Uniform with Home and Library) */}
      <div className="sticky top-0 z-20 bg-gray-950/95 px-4 pt-3 pb-3 backdrop-blur-md border-b border-gray-800/80 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenUserMenu}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-800 border border-gray-700/80 text-gray-300 hover:text-white active:scale-95 transition-transform shadow-sm"
            aria-label="User Menu"
          >
            <CircleUserRound size={24} />
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-white">Search</h1>
        </div>

        {/* Search Input */}
        <div className="relative flex items-center">
          <Search size={18} className="absolute left-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={safeSearchDraft}
            onChange={(e) => onSearchDraftChange?.(e.target.value)}
            placeholder="What do you want to play?"
            className="w-full h-11 rounded-full bg-white text-black pl-10 pr-10 text-sm font-medium placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
          />
          {safeSearchDraft ? (
            <button
              type="button"
              onClick={() => onSearchDraftChange?.('')}
              className="absolute right-3 p-1 text-gray-500 hover:text-black active:scale-90 transition-transform"
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
