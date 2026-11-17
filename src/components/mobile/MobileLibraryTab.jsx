import React, { useState } from 'react';
import {
  Folder,
  ListMusic,
  ChevronLeft,
  Play,
  Pause,
  CircleUserRound,
} from 'lucide-react';
import { formatDurationMs } from '../../utils/playerTime';

export function MobileLibraryTab({
  playlists = [],
  folders = [],
  playlistItemsByPlaylistId = {},
  myMixes = [],
  tuttiMixes = [],
  activeQueueItem,
  isPlaying,
  onPlayLibraryMix,
  onPlayPlaylistRow,
  onOpenUserMenu,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [drilledPlaylist, setDrilledPlaylist] = useState(null);

  // If viewing a drilled-down playlist
  if (drilledPlaylist) {
    const items = playlistItemsByPlaylistId[drilledPlaylist.id] || [];

    return (
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-2 space-y-4 select-none">
        {/* Back navigation */}
        <button
          type="button"
          onClick={() => setDrilledPlaylist(null)}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-300 hover:text-white active:scale-95 transition-transform"
        >
          <ChevronLeft size={20} />
          <span>Your Library</span>
        </button>

        {/* Playlist Header Card */}
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-950 to-gray-900 border border-indigo-900/40 p-4 shadow-lg">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white shadow-md">
            <ListMusic size={32} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-white truncate">
              {drilledPlaylist.name}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Playlist • {items.length} tracks
            </p>
          </div>
        </div>

        {/* Playlist Tracks List */}
        <div className="space-y-1">
          {items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              This playlist is empty.
            </div>
          ) : (
            <div className="divide-y divide-gray-800/80 rounded-xl bg-gray-900/60 border border-gray-800/80 overflow-hidden">
              {items.map((row, idx) => {
                const isThisPlaying = activeQueueItem?.id === row.mix?.id || activeQueueItem?.id === row.id;
                return (
                  <div
                    key={row.id}
                    onClick={() => onPlayPlaylistRow(row, drilledPlaylist, idx)}
                    className={`flex items-center justify-between p-3.5 transition-colors cursor-pointer active:bg-gray-800 ${
                      isThisPlaying ? 'bg-blue-900/20 text-blue-400' : 'text-gray-200 hover:bg-gray-800/50'
                    }`}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-5 text-center text-xs font-mono text-gray-400 shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-semibold ${isThisPlaying ? 'text-blue-400' : 'text-white'}`}>
                          {row.mix?.name || row.mix?.projectName || row.name || 'Mix Track'}
                        </div>
                        <div className="truncate text-xs text-gray-400">
                          {row.mix?.showName || 'Playlist item'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {formatDurationMs(row.mix?.durationMs)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayPlaylistRow(row, drilledPlaylist, idx);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-white hover:bg-gray-700 active:scale-90 transition-transform"
                      >
                        {isThisPlaying && isPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-0.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Filtered lists
  const filteredPlaylists = activeFilter === 'folders' ? [] : playlists;
  const filteredFolders = activeFilter === 'playlists' ? [] : folders;

  return (
    <div className="flex-1 overflow-y-auto pb-28 select-none">
      {/* Top Header: User Symbol + "Your Library" Title (Uniform with Home and Search) */}
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Your Library</h1>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hidden py-0.5">
          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all shrink-0 ${
              activeFilter === 'all'
                ? 'bg-white text-black font-bold shadow-md'
                : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('playlists')}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all shrink-0 ${
              activeFilter === 'playlists'
                ? 'bg-white text-black font-bold shadow-md'
                : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            Playlists
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('folders')}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all shrink-0 ${
              activeFilter === 'folders'
                ? 'bg-white text-black font-bold shadow-md'
                : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            Folders
          </button>
        </div>
      </div>

      {/* Playlists and Folders List */}
      <div className="px-4 pt-3 space-y-2">
        {/* Playlists */}
        {filteredPlaylists.map((playlist) => {
          const count = (playlistItemsByPlaylistId[playlist.id] || []).length;
          return (
            <div
              key={playlist.id}
              onClick={() => setDrilledPlaylist(playlist)}
              className="flex items-center justify-between p-3 rounded-xl bg-gray-900/60 border border-gray-800/80 hover:bg-gray-800 transition-colors cursor-pointer active:scale-[0.99]"
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-700 to-indigo-900 text-white shadow">
                  <ListMusic size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {playlist.name}
                  </div>
                  <div className="truncate text-xs text-gray-400 mt-0.5">
                    Playlist • {count} tracks
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Folders */}
        {filteredFolders.map((folder) => (
          <div
            key={folder.id}
            className="flex items-center justify-between p-3 rounded-xl bg-gray-900/60 border border-gray-800/80 hover:bg-gray-800 transition-colors cursor-pointer active:scale-[0.99]"
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-amber-400 shadow">
                <Folder size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                  {folder.name}
                </div>
                <div className="truncate text-xs text-gray-400 mt-0.5">
                  Folder
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredPlaylists.length === 0 && filteredFolders.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            No library items found.
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileLibraryTab;
