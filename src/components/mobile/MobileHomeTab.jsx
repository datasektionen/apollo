import React from 'react';
import { Play, Pause, Shuffle, CircleUserRound } from 'lucide-react';
import { BrandMark } from '../BrandLogo';
import { formatDurationMs } from '../../utils/playerTime';

function formatShowDurationLabel(mixes = []) {
  const totalMs = (mixes || []).reduce((sum, mix) => {
    const ms = Number(mix?.durationMs ?? 0);
    return Number.isFinite(ms) && ms > 0 ? sum + ms : sum;
  }, 0);
  if (totalMs <= 0) return '';
  const mins = Math.round(totalMs / 60000);
  return mins < 1 ? `${Math.max(1, Math.round(totalMs / 1000))} sec` : `${mins} min`;
}

export function MobileHomeTab({
  shows = [],
  tuttiMixes = [],
  playlists = [],
  activeQueueItem,
  isPlaying,
  shuffleEnabled = false,
  onToggleShuffle,
  onTogglePlay,
  onPlayMix,
  onSelectPlaylist,
  onOpenUserMenu,
}) {
  const showName = shows[0]?.name || tuttiMixes[0]?.showName || 'Show';
  const durationLabel = formatShowDurationLabel(tuttiMixes);
  const countLabel = `${tuttiMixes.length} ${tuttiMixes.length === 1 ? 'number' : 'numbers'}`;
  const heroMeta = [countLabel, durationLabel].filter(Boolean).join(' · ');

  const isShowTrackActive = Boolean(
    activeQueueItem && tuttiMixes.some((mix) => (
      activeQueueItem.id === mix.id
      || activeQueueItem.mixId === mix.id
      || String(activeQueueItem.projectId) === String(mix.projectId || mix.id)
    ))
  );
  const isShowPlaying = isShowTrackActive && isPlaying;

  return (
    <div className="flex-1 overflow-y-auto pb-28 select-none">
      {/* Sticky Obsidian Top Header: User Avatar + "Home" + Apollo Mark */}
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-[var(--player-bg-canvas-translucent)] px-4 pt-3 pb-3 backdrop-blur-md border-b border-[var(--player-border-subtle)]">
        <button
          type="button"
          onClick={onOpenUserMenu}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)] active:scale-95 transition-all"
          aria-label="User Menu"
        >
          <CircleUserRound size={20} />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--player-text-primary)]">Home</h1>
        <BrandMark className="ml-auto h-6 w-6 opacity-90" alt="" />
      </div>

      {/* Editorial Show Hero (Typography-First, Zero Fake Artwork) */}
      {tuttiMixes.length > 0 ? (
        <section className="player-hero-surface border-b border-[var(--player-border-subtle)] px-4 pt-5 pb-4">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
                Show
              </div>
              <h2 className="mt-1 truncate text-3xl font-extrabold leading-tight tracking-[-0.02em] text-[var(--player-text-primary)]">
                {showName}
              </h2>
              <p className="mt-1 text-xs font-medium text-[var(--player-text-secondary)] tabular-nums">
                {heroMeta}
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {onToggleShuffle ? (
                <button
                  type="button"
                  onClick={onToggleShuffle}
                  aria-pressed={shuffleEnabled}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors active:scale-95 ${
                    shuffleEnabled
                      ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                      : 'border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]'
                  }`}
                  aria-label={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
                >
                  <Shuffle size={17} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (isShowTrackActive && onTogglePlay) {
                    onTogglePlay();
                  } else {
                    onPlayMix?.(tuttiMixes[0], null, 0);
                  }
                }}
                className="player-play-cta flex h-12 w-12 items-center justify-center rounded-full"
                aria-label={isShowPlaying ? `Pause ${showName}` : `Play ${showName}`}
              >
                {isShowPlaying ? (
                  <Pause size={20} className="fill-current" />
                ) : (
                  <Play size={20} className="fill-current translate-x-[1px]" />
                )}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Full-Bleed High-Contrast Tracklist */}
      <div className="divide-y divide-[var(--player-border-subtle)]">
        {tuttiMixes.length > 0 ? (
          tuttiMixes.map((mix, idx) => {
            const isThisPlaying = Boolean(
              activeQueueItem && (
                activeQueueItem.id === mix.id
                || activeQueueItem.mixId === mix.id
                || String(activeQueueItem.projectId) === String(mix.projectId || mix.id)
              )
            );
            const activeAndPlaying = isThisPlaying && isPlaying;
            return (
              <div
                key={mix.id}
                onClick={() => onPlayMix(mix, null, idx)}
                data-active={isThisPlaying ? 'true' : 'false'}
                className={`relative flex min-h-[64px] items-center justify-between px-4 py-3 transition-colors cursor-pointer active:bg-[var(--player-pressed)] ${
                  isThisPlaying ? 'bg-[var(--player-row-active)]' : 'hover:bg-[var(--player-hover)]'
                }`}
                role="button"
                tabIndex={0}
              >
                {isThisPlaying ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[var(--player-accent)]"
                  />
                ) : null}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex w-7 shrink-0 items-center justify-center">
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
                      {mix.name || mix.projectName}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--player-text-secondary)] tabular-nums">
                      {[mix.musicalNumber ? `No. ${mix.musicalNumber}` : null, mix.showName].filter(Boolean).join(' · ') || 'Choir number'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-xs text-[var(--player-text-muted)] tabular-nums">
                    {formatDurationMs(mix.durationMs)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isThisPlaying && onTogglePlay) {
                        onTogglePlay();
                      } else {
                        onPlayMix(mix, null, idx);
                      }
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors active:scale-90 ${
                      isThisPlaying
                        ? 'text-[var(--player-accent-text)]'
                        : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                    }`}
                    aria-label={activeAndPlaying ? `Pause ${mix.name || mix.projectName}` : `Play ${mix.name || mix.projectName}`}
                  >
                    {activeAndPlaying ? (
                      <Pause size={16} className="fill-current" />
                    ) : (
                      <Play size={16} className="fill-current translate-x-[1px]" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-12 px-4 text-center text-sm text-[var(--player-text-muted)]">
            No tracks available in the current show.
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileHomeTab;
