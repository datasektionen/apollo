import React from 'react';
import { Play, Pause, CircleUserRound } from 'lucide-react';
import { formatDurationMs } from '../../utils/playerTime';

export function MobileHomeTab({
  shows = [],
  tuttiMixes = [],
  playlists = [],
  activeQueueItem,
  isPlaying,
  onPlayMix,
  onSelectPlaylist,
  onOpenUserMenu,
}) {
  return (
    <div className="flex-1 overflow-y-auto pb-28 select-none">
      {/* Top Header: User Symbol + "Home" Title */}
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-gray-950/95 px-4 pt-3 pb-3 backdrop-blur-md border-b border-gray-800/80">
        <button
          type="button"
          onClick={onOpenUserMenu}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-800 border border-gray-700/80 text-gray-300 hover:text-white active:scale-95 transition-transform shadow-sm"
          aria-label="User Menu"
        >
          <CircleUserRound size={24} />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-white">Home</h1>
      </div>

      <div className="px-4 pt-3 space-y-4">
        {/* Default Playlist / Show Track List */}
        {tuttiMixes.length > 0 ? (
          <div className="divide-y divide-gray-800/80 rounded-xl bg-gray-900/60 border border-gray-800/80 overflow-hidden shadow">
            {tuttiMixes.map((mix, idx) => {
              const isThisPlaying = activeQueueItem && (
                activeQueueItem.id === mix.id ||
                activeQueueItem.mixId === mix.id ||
                String(activeQueueItem.projectId) === String(mix.projectId || mix.id)
              );
              return (
                <div
                  key={mix.id}
                  onClick={() => onPlayMix(mix, null, idx)}
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
                        {mix.name || mix.projectName}
                      </div>
                      <div className="truncate text-xs text-gray-400">
                        {mix.showName || (mix.musicalNumber ? `No. ${mix.musicalNumber}` : 'Choir number')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-gray-400 tabular-nums">
                      {formatDurationMs(mix.durationMs)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayMix(mix, null, idx);
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
        ) : (
          <div className="py-12 text-center text-sm text-gray-500">
            No tracks available in the current show.
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileHomeTab;
