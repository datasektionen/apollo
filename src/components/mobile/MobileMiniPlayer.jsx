import React from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';

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
  const showName = activeQueueItem.showName || activeQueueItem.artist || activeQueueItem.projectName || 'Apollo Choir';
  const subline = [
    activeQueueItem.musicalNumber ? `No. ${activeQueueItem.musicalNumber}` : null,
    showName,
  ].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onOpenNowPlaying}
      className="relative mx-2.5 mb-2 cursor-pointer overflow-hidden rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] shadow-[var(--player-shadow-elevated)] backdrop-blur-md transition-transform active:scale-[0.99] select-none"
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
      <div className="flex h-14 items-center gap-3 pl-3.5 pr-2">
        {/* Crisp 3px Gold Leading Accent Bar (Replaces fake square cover) */}
        <span
          aria-hidden="true"
          className="h-8 w-[3px] shrink-0 rounded-full bg-[var(--player-accent)]"
        />

        {/* Track Title and Musical Number / Show */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--player-text-primary)]">
            {title}
          </div>
          <div className="truncate text-xs text-[var(--player-text-secondary)]">
            {subline}
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--player-text-primary)] hover:text-[var(--player-accent-text)] active:scale-90 transition-all"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isRendering ? (
              <Loader2 size={20} className="animate-spin text-[var(--player-accent-text)]" />
            ) : isPlaying ? (
              <Pause size={22} className="fill-current" />
            ) : (
              <Play size={22} className="fill-current translate-x-[1px]" />
            )}
          </button>
        </div>
      </div>

      {/* Inset 2px Gold Progress Line */}
      <div className="h-[2px] w-full bg-[var(--player-slider-track)]">
        <div
          className="h-full bg-[var(--player-accent)] transition-[width] duration-150 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

export default MobileMiniPlayer;
