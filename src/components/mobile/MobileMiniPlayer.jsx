import React from 'react';
import { Play, Pause, Loader2, Music2, Heart, CheckCircle2 } from 'lucide-react';

export function MobileMiniPlayer({
  activeQueueItem,
  isPlaying,
  isRendering,
  currentTimeSec,
  durationSec,
  onTogglePlay,
  onOpenNowPlaying,
}) {
  if (!activeQueueItem) return null;

  const progressPercent = durationSec > 0
    ? Math.min(100, Math.max(0, (currentTimeSec / durationSec) * 100))
    : 0;

  const title = activeQueueItem.name || activeQueueItem.title || 'Untitled Track';
  const subtitle = activeQueueItem.showName || activeQueueItem.artist || activeQueueItem.projectName || 'Apollo Choir';

  return (
    <div
      onClick={onOpenNowPlaying}
      className="relative mx-2 mb-1 cursor-pointer overflow-hidden rounded-lg bg-gray-800/95 border border-gray-700/60 shadow-xl backdrop-blur-md transition-all active:scale-[0.99] select-none"
      role="button"
      tabIndex={0}
      aria-label={`Now playing: ${title}. Tap to open player.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenNowPlaying();
        }
      }}
    >
      <div className="flex h-14 items-center gap-3 px-3">
        {/* Album / Track Artwork Thumbnail */}
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-gray-700 shadow-sm flex items-center justify-center">
          {activeQueueItem.artworkUrl ? (
            <img
              src={activeQueueItem.artworkUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-700 to-indigo-900 text-white font-bold text-xs">
              {activeQueueItem.musicalNumber ? activeQueueItem.musicalNumber : <Music2 size={18} />}
            </div>
          )}
        </div>

        {/* Track Title and Artist / Show */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">
            {title}
          </div>
          <div className="truncate text-xs text-gray-400">
            {subtitle}
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            disabled={isRendering}
            className="flex h-10 w-10 items-center justify-center text-white hover:text-blue-400 active:scale-90 transition-transform disabled:opacity-50"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isRendering ? (
              <Loader2 size={22} className="animate-spin text-blue-400" />
            ) : isPlaying ? (
              <Pause size={24} className="fill-current" />
            ) : (
              <Play size={24} className="fill-current translate-x-0.5" />
            )}
          </button>
        </div>
      </div>

      {/* Thin bottom progress line */}
      <div className="h-[2.5px] w-full bg-gray-700/50">
        <div
          className="h-full bg-white transition-[width] duration-150 ease-linear rounded-r-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

export default MobileMiniPlayer;
