import React, { useState } from 'react';
import {
  Folder,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Shuffle,
  CircleUserRound,
} from 'lucide-react';
import { BrandMark } from '../BrandLogo';
import { formatDurationMs } from '../../utils/playerTime';

function formatPlaylistDurationLabel(items = []) {
  const totalMs = (items || []).reduce((sum, row) => {
    const ms = Number(row?.mix?.durationMs ?? row?.durationMs ?? 0);
    return Number.isFinite(ms) && ms > 0 ? sum + ms : sum;
  }, 0);
  if (totalMs <= 0) return '';
  const mins = Math.round(totalMs / 60000);
  return mins < 1 ? `${Math.max(1, Math.round(totalMs / 1000))} sec` : `${mins} min`;
}

export function MobileLibraryTab({
  playlists = [],
  folders = [],
  playlistItemsByPlaylistId = {},
  myMixes = [],
  tuttiMixes = [],
  activeQueueItem,
  isPlaying,
  shuffleEnabled = false,
  onToggleShuffle,
  onTogglePlay,
  onPlayLibraryMix,
  onPlayPlaylistRow,
  onOpenUserMenu,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [drilledPlaylist, setDrilledPlaylist] = useState(null);

  if (drilledPlaylist) {
    const items = playlistItemsByPlaylistId[drilledPlaylist.id] || [];
    const durationLabel = formatPlaylistDurationLabel(items);
    const metaText = [`${items.length} ${items.length === 1 ? 'mix' : 'mixes'}`, durationLabel].filter(Boolean).join(' · ');
    const firstPlayableIndex = items.findIndex((row) => !row.unavailable && (row.mix || row.id));
    const firstPlayable = firstPlayableIndex >= 0 ? items[firstPlayableIndex] : null;
    const isPlaylistActive = Boolean(
      activeQueueItem && items.some((row) => (
        activeQueueItem.id === row.mix?.id
        || activeQueueItem.mixId === row.mix?.id
        || activeQueueItem.id === row.id
      ))
    );
    const isPlaylistPlaying = isPlaylistActive && isPlaying;

    return (
      <div className="flex-1 overflow-y-auto pb-36 select-none">
        {/* Sticky Back Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between bg-[var(--player-bg-canvas-translucent)] px-4 pt-3 pb-2.5 backdrop-blur-md border-b border-[var(--player-border-subtle)]">
          <button
            type="button"
            onClick={() => setDrilledPlaylist(null)}
            className="inline-flex items-center gap-1 -ml-1.5 py-1 pr-2 text-sm font-semibold text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 transition-all"
          >
            <ChevronLeft size={20} />
            <span>Your Library</span>
          </button>
          <BrandMark className="h-5 w-5 opacity-80" alt="" />
        </div>

        {/* Editorial Typographic Playlist Hero (Zero Fake Artwork) */}
        <section className="player-hero-surface border-b border-[var(--player-border-subtle)] px-4 pt-5 pb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
            Playlist
          </div>
          <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-[-0.02em] text-[var(--player-text-primary)] break-words">
            {drilledPlaylist.name}
          </h1>
          <p className="mt-1.5 text-xs font-medium text-[var(--player-text-secondary)] tabular-nums">
            {metaText}
          </p>

          <div className={onToggleShuffle ? 'mt-4 grid grid-cols-2 gap-3' : 'mt-4 flex items-center gap-3'}>
            <button
              type="button"
              disabled={!firstPlayable}
              onClick={() => {
                if (isPlaylistActive && onTogglePlay) {
                  onTogglePlay();
                } else if (firstPlayable) {
                  onPlayPlaylistRow(firstPlayable, drilledPlaylist, firstPlayableIndex);
                }
              }}
              className="player-play-cta inline-flex h-10 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-bold disabled:opacity-40"
              aria-label={isPlaylistPlaying ? `Pause ${drilledPlaylist.name}` : `Play ${drilledPlaylist.name}`}
            >
              {isPlaylistPlaying ? (
                <Pause size={16} className="fill-current" />
              ) : (
                <Play size={16} className="fill-current translate-x-[1px]" />
              )}
              <span>{isPlaylistPlaying ? 'Pause' : 'Play'}</span>
            </button>
            {onToggleShuffle ? (
              <button
                type="button"
                disabled={!firstPlayable}
                onClick={onToggleShuffle}
                aria-pressed={shuffleEnabled}
                className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border px-4 text-xs font-semibold transition-colors disabled:opacity-40 ${
                  shuffleEnabled
                    ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                    : 'border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]'
                }`}
              >
                <Shuffle size={14} />
                <span>Shuffle</span>
              </button>
            ) : null}
          </div>
        </section>

        {/* Playlist Tracks List */}
        {items.length === 0 ? (
          <div className="py-12 px-4 text-center text-sm text-[var(--player-text-muted)]">
            This playlist is empty.
          </div>
        ) : (
          <div className="divide-y divide-[var(--player-border-subtle)]">
            {items.map((row, idx) => {
              const isThisPlaying = Boolean(
                activeQueueItem && (
                  activeQueueItem.id === row.mix?.id
                  || activeQueueItem.mixId === row.mix?.id
                  || activeQueueItem.id === row.id
                )
              );
              const activeAndPlaying = isThisPlaying && isPlaying;
              return (
                <div
                  key={row.id}
                  onClick={() => {
                    if (isThisPlaying && onTogglePlay) {
                      onTogglePlay();
                    } else {
                      onPlayPlaylistRow(row, drilledPlaylist, idx);
                    }
                  }}
                  data-active={isThisPlaying ? 'true' : 'false'}
                  className={`relative flex min-h-[54px] items-center justify-between px-4 py-2 transition-colors cursor-pointer active:bg-[var(--player-pressed)] ${
                    isThisPlaying ? 'bg-[var(--player-row-active)]' : 'hover:bg-[var(--player-hover)]'
                  }`}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex w-6 shrink-0 items-center justify-center">
                      {activeAndPlaying ? (
                        <span className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
                          <span className="player-eq-bar" />
                          <span className="player-eq-bar" />
                          <span className="player-eq-bar" />
                        </span>
                      ) : (
                        <span className={`text-xs font-medium tabular-nums ${
                          isThisPlaying ? 'text-[var(--player-accent-text)] font-semibold' : 'text-[var(--player-text-muted)]'
                        }`}>
                          {idx + 1}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[15px] font-semibold ${
                        isThisPlaying ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'
                      }`}>
                        {row.mix?.name || row.mix?.projectName || row.name || 'Mix Track'}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--player-text-secondary)]">
                        {row.mix?.showName || 'Playlist item'}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    <span className="text-xs text-[var(--player-text-muted)] tabular-nums">
                      {formatDurationMs(row.mix?.durationMs)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const filteredPlaylists = activeFilter === 'folders' ? [] : playlists;
  const filteredFolders = activeFilter === 'playlists' ? [] : folders;

  return (
    <div className="flex-1 overflow-y-auto pb-36 select-none">
      {/* Top Header: User Symbol + "Your Library" Title */}
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
          <h1 className="text-2xl font-bold tracking-tight text-[var(--player-text-primary)]">Your Library</h1>
          <BrandMark className="ml-auto h-6 w-6 opacity-90" alt="" />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hidden py-0.5">
          {[
            { id: 'all', label: 'All' },
            { id: 'playlists', label: 'Playlists' },
            { id: 'folders', label: 'Folders' },
          ].map((pill) => {
            const active = activeFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onClick={() => setActiveFilter(pill.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors shrink-0 ${
                  active
                    ? 'bg-[var(--player-pill-active-bg)] text-[var(--player-pill-active-fg)]'
                    : 'border border-[var(--player-border-subtle)] bg-[var(--player-pill-bg)] text-[var(--player-pill-fg)] hover:text-[var(--player-text-primary)]'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Playlists and Folders List (No Fake Gradient Squares) */}
      <div className="divide-y divide-[var(--player-border-subtle)]">
        {filteredPlaylists.map((playlist) => {
          const count = (playlistItemsByPlaylistId[playlist.id] || []).length;
          return (
            <div
              key={playlist.id}
              onClick={() => setDrilledPlaylist(playlist)}
              className="flex min-h-[64px] items-center justify-between px-4 py-3 hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)] transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-accent-text)]">
                  <ListMusic size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-[var(--player-text-primary)]">
                    {playlist.name}
                  </div>
                  <div className="truncate text-xs text-[var(--player-text-secondary)] mt-0.5 tabular-nums">
                    Playlist · {count} {count === 1 ? 'mix' : 'mixes'}
                  </div>
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-[var(--player-text-muted)]" />
            </div>
          );
        })}

        {filteredFolders.map((folder) => (
          <div
            key={folder.id}
            className="flex min-h-[64px] items-center justify-between px-4 py-3 hover:bg-[var(--player-hover)] transition-colors cursor-pointer"
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]">
                <Folder size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-[var(--player-text-primary)]">
                  {folder.name}
                </div>
                <div className="truncate text-xs text-[var(--player-text-secondary)] mt-0.5">
                  Folder
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredPlaylists.length === 0 && filteredFolders.length === 0 && (
          <div className="py-12 px-4 text-center text-sm text-[var(--player-text-muted)]">
            No library items found.
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileLibraryTab;
