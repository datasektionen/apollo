import React from 'react';
import { ChevronDown, MicVocal } from 'lucide-react';
import PlayerLyricsView from '../PlayerLyricsView';

export function MobileLyricsModal({
  isOpen,
  onClose,
  lyrics,
  currentTimeSec,
  durationSec,
  songTitle,
  onSeek,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)] pt-safe pb-safe select-none animate-in fade-in slide-in-from-bottom duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Song lyrics"
    >
      {/* Header */}
      <header className="player-hero-surface flex h-14 items-center justify-between px-4 border-b border-[var(--player-border-subtle)] shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 transition-all"
          aria-label="Close lyrics"
        >
          <ChevronDown size={24} />
        </button>

        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)] flex items-center justify-center gap-1">
            <MicVocal size={11} />
            <span>Lyrics</span>
          </div>
          <div className="truncate text-xs font-semibold text-[var(--player-text-primary)]">
            {songTitle || 'Lyrics'}
          </div>
        </div>

        <div className="w-10" />
      </header>

      {/* Lyrics View */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <PlayerLyricsView
          lyrics={lyrics}
          currentTimeMs={currentTimeSec * 1000}
          durationMs={durationSec * 1000}
          songTitle={songTitle}
          showHeader={false}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}

export default MobileLyricsModal;
