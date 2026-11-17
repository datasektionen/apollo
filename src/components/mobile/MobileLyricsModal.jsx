import React from 'react';
import { ChevronDown, MicVocal } from 'lucide-react';
import PlayerLyricsView from '../PlayerLyricsView';

export function MobileLyricsModal({
  isOpen,
  onClose,
  lyrics,
  currentTimeSec = 0,
  durationSec = 0,
  songTitle = '',
  onSeek,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-amber-950/90 via-gray-950 to-black text-white pt-safe pb-safe select-none animate-in fade-in slide-in-from-bottom duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Song lyrics"
    >
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center text-gray-300 hover:text-white active:scale-95 transition-transform"
          aria-label="Close lyrics"
        >
          <ChevronDown size={28} />
        </button>

        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 flex items-center justify-center gap-1">
            <MicVocal size={12} />
            <span>Lyrics</span>
          </div>
          <div className="truncate text-xs font-semibold text-gray-200">
            {songTitle || 'Lyrics'}
          </div>
        </div>

        <div className="w-10" />
      </header>

      {/* Lyrics View */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <PlayerLyricsView
          lyrics={lyrics}
          currentTimeMs={currentTimeSec * 1000}
          durationMs={durationSec * 1000}
          songTitle={songTitle}
          onSeek={(ms) => onSeek && onSeek(ms / 1000)}
        />
      </div>
    </div>
  );
}

export default MobileLyricsModal;
