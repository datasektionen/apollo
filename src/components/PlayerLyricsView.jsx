import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, ChevronsDown, ChevronsUp } from 'lucide-react';
import { getPlacedLyricLines } from '../utils/lyricTimeline';

const LYRICS_TOP_INSET_PX = 16;

function CircleChevronsIcon({ direction }) {
  const Chevrons = direction === 'up' ? ChevronsUp : ChevronsDown;
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
      <Circle size={20} strokeWidth={1.8} />
      <Chevrons className="absolute h-3 w-3" strokeWidth={2.2} />
    </span>
  );
}

function PlayerLyricsView({
  lyrics,
  currentTimeMs = 0,
  durationMs = 0,
  isLoading = false,
  songTitle = '',
  showHeader = true,
  contentClassName = 'px-6 pt-4 pb-4 sm:px-12',
  onSeek,
}) {
  const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
  const isSynced = lyrics?.useSyncedLyrics === true;
  const placedLines = useMemo(() => getPlacedLyricLines(lines), [lines]);
  const currentTime = Math.max(0, Number(currentTimeMs) || 0);
  const duration = Math.max(0, Number(durationMs) || 0);
  const isAtEnd = duration > 0 && currentTime >= duration - 1;
  const firstPlacedEntry = placedLines[0] || null;
  const currentEntry = isSynced
    ? placedLines.reduce((current, entry) => (entry.startMs <= currentTime ? entry : current), null)
    : null;
  const currentLineId = currentEntry?.line?.id || null;
  const currentStartMs = currentEntry?.startMs ?? null;
  const lineToFollowId = currentLineId || (isSynced ? firstPlacedEntry?.line?.id || null : null);
  const isFirstActiveLine = currentLineId != null && currentLineId === firstPlacedEntry?.line?.id;

  const scrollContainerRef = useRef(null);
  const lineElementsRef = useRef(new Map());
  const programmaticScrollRef = useRef(false);
  const scrollReleaseTimerRef = useRef(null);
  const previousLyricsRef = useRef(lyrics);
  const previousPlaybackTimeMsRef = useRef(currentTime);
  const [isFollowing, setIsFollowing] = useState(isSynced);
  const [showResync, setShowResync] = useState(false);
  const [resyncDirection, setResyncDirection] = useState('down');
  const previousCurrentLineIdRef = useRef(null);

  useEffect(() => {
    setIsFollowing(isSynced);
    setShowResync(false);
  }, [isSynced]);

  useEffect(() => () => {
    if (scrollReleaseTimerRef.current != null) {
      window.clearTimeout(scrollReleaseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const lyricsChanged = previousLyricsRef.current !== lyrics;
    const playbackRestarted = previousPlaybackTimeMsRef.current > 1000 && currentTime <= 100;
    previousLyricsRef.current = lyrics;
    previousPlaybackTimeMsRef.current = currentTime;
    if (!lyricsChanged && !playbackRestarted) return;

    if (scrollReleaseTimerRef.current != null) {
      window.clearTimeout(scrollReleaseTimerRef.current);
      scrollReleaseTimerRef.current = null;
    }
    programmaticScrollRef.current = false;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    previousCurrentLineIdRef.current = null;
    setIsFollowing(isSynced);
    setShowResync(false);
    setResyncDirection('down');
  }, [currentTime, isSynced, lyrics]);

  const isCurrentLineVisible = useCallback(() => {
    const container = scrollContainerRef.current;
    const currentLine = lineToFollowId ? lineElementsRef.current.get(lineToFollowId) : null;
    if (!container || !currentLine) return false;
    const containerBounds = container.getBoundingClientRect();
    const lineBounds = currentLine.getBoundingClientRect();
    return lineBounds.bottom > containerBounds.top && lineBounds.top < containerBounds.bottom;
  }, [lineToFollowId]);

  const getResyncDirection = useCallback(() => {
    const container = scrollContainerRef.current;
    const currentLine = currentLineId ? lineElementsRef.current.get(currentLineId) : null;
    if (!container || !currentLine) return 'down';
    const containerBounds = container.getBoundingClientRect();
    const lineBounds = currentLine.getBoundingClientRect();
    return lineBounds.bottom <= containerBounds.top ? 'up' : 'down';
  }, [currentLineId]);

  useEffect(() => {
    if (!isSynced || !currentLineId || isAtEnd) {
      setShowResync(false);
      return;
    }
    if (!isFollowing && isCurrentLineVisible()) {
      setIsFollowing(true);
      setShowResync(false);
      return;
    }
    if (!isFollowing) setResyncDirection(getResyncDirection());
    setShowResync(!isFollowing);
  }, [currentLineId, getResyncDirection, isAtEnd, isCurrentLineVisible, isFollowing, isSynced]);

  const alignCurrentLine = useCallback(() => {
    const container = scrollContainerRef.current;
    const currentLine = lineToFollowId ? lineElementsRef.current.get(lineToFollowId) : null;
    if (!container || !currentLine) return;

    const containerBounds = container.getBoundingClientRect();
    const lineBounds = currentLine.getBoundingClientRect();
    const viewportHeight = container.clientHeight || containerBounds.height;
    const maxScrollTop = Math.max(0, container.scrollHeight - viewportHeight);
    const targetLineOffset = isFirstActiveLine
      ? LYRICS_TOP_INSET_PX
      : (viewportHeight - lineBounds.height) / 2;
    const desiredTop = container.scrollTop + lineBounds.top - containerBounds.top - targetLineOffset;
    const targetTop = Math.max(0, Math.min(maxScrollTop, desiredTop));
    if (Math.abs(targetTop - container.scrollTop) < 1) return;

    programmaticScrollRef.current = true;
    if (scrollReleaseTimerRef.current != null) {
      window.clearTimeout(scrollReleaseTimerRef.current);
    }
    if (typeof container.scrollTo === 'function') {
      try {
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
      } catch {
        container.scrollTop = targetTop;
      }
    } else {
      container.scrollTop = targetTop;
    }
    scrollReleaseTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      scrollReleaseTimerRef.current = null;
    }, 500);
    setShowResync(false);
  }, [isFirstActiveLine, lineToFollowId]);

  useEffect(() => {
    const previousLineId = previousCurrentLineIdRef.current;
    previousCurrentLineIdRef.current = currentLineId;
    if (!isSynced || !lineToFollowId) return;
    if (isFirstActiveLine && previousLineId !== currentLineId) {
      setIsFollowing(true);
      alignCurrentLine();
      return;
    }
    if (!isFollowing) return;
    alignCurrentLine();
  }, [alignCurrentLine, currentLineId, isFirstActiveLine, isFollowing, isSynced, lineToFollowId]);

  const handleScroll = () => {
    if (!isSynced || programmaticScrollRef.current || !lineToFollowId) return;
    if (!isCurrentLineVisible()) {
      if (currentLineId) {
        setIsFollowing(false);
        setResyncDirection(getResyncDirection());
        setShowResync(!isAtEnd);
      }
      return;
    }
    if (isFollowing) alignCurrentLine();
    else setIsFollowing(true);
  };

  const handleSeekLine = (line) => {
    const startMs = line?.startMs == null || line.startMs === '' ? null : Number(line.startMs);
    if (!Number.isFinite(startMs)) return;
    onSeek?.(Math.max(0, startMs) / 1000);
    if (isSynced) setIsFollowing(true);
  };

  const handleResync = () => {
    setIsFollowing(true);
    setShowResync(false);
    alignCurrentLine();
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Lyrics">
      {showHeader ? (
        <header className="player-hero-surface flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--player-border-subtle)] px-6 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
              Lyrics
            </div>
            {songTitle ? (
              <div className="mt-0.5 truncate text-base font-bold tracking-tight text-[var(--player-text-primary)]">
                {songTitle}
              </div>
            ) : null}
          </div>
          {isSynced && placedLines.length > 0 ? (
            <span className="shrink-0 rounded-full border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--player-accent-text)]">
              Synced
            </span>
          ) : null}
        </header>
      ) : null}
      <div
        ref={scrollContainerRef}
        className={`player-scrollfade min-h-0 flex-1 overflow-y-auto ${contentClassName}`}
        aria-label="Lyrics lines"
        onScroll={handleScroll}
      >
        {isLoading && lines.length === 0 ? (
          <div className="mx-auto max-w-3xl py-6 text-lg text-[var(--player-text-secondary)]">Loading lyrics…</div>
        ) : lines.length === 0 ? (
          <div className="mx-auto max-w-3xl py-6 text-lg text-[var(--player-text-muted)]">No lyrics available for this song.</div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 pb-16">
            {lines.map((line, index) => {
              const text = String(line?.text ?? '');
              if (!text.trim()) {
                return <div key={line?.id || `blank-${index}`} className="h-4" aria-hidden="true" />;
              }
              const lineStartMs = line?.startMs == null || line.startMs === '' ? null : Number(line.startMs);
              const isCurrent = isSynced && line.id === currentLineId;
              const isPast = isSynced
                && currentStartMs != null
                && Number.isFinite(lineStartMs)
                && lineStartMs < currentStartMs;
              const lyricState = !isSynced
                ? 'static'
                : (isCurrent ? 'current' : (isPast ? 'past' : 'upcoming'));
              const colorClass = !isSynced
                ? 'font-extrabold text-[var(--player-text-primary)]'
                : (isCurrent
                    ? 'font-extrabold text-[var(--player-text-primary)]'
                    : (isPast
                        ? 'font-semibold text-[var(--player-lyric-past)]'
                        : 'font-semibold text-[var(--player-lyric-upcoming)]'));
              const canSeek = Number.isFinite(lineStartMs);
              return (
                <button
                  key={line?.id || `line-${index}`}
                  data-lyric-id={line?.id || undefined}
                  data-lyric-state={lyricState}
                  ref={(element) => {
                    if (!line?.id) return;
                    if (element) lineElementsRef.current.set(line.id, element);
                    else lineElementsRef.current.delete(line.id);
                  }}
                  type="button"
                  disabled={!canSeek}
                  aria-current={isCurrent ? 'true' : undefined}
                  title={canSeek ? 'Jump to this lyric' : undefined}
                  onClick={() => handleSeekLine(line)}
                  className={`relative block w-full whitespace-pre-wrap break-words text-left text-[1.5rem] leading-[1.25] tracking-tight transition-colors sm:text-[2rem] disabled:cursor-default disabled:opacity-100 ${colorClass} ${canSeek ? 'cursor-pointer hover:text-[var(--player-text-primary)]' : 'cursor-default'}`}
                >
                  {text}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {showResync && isSynced && !isAtEnd && currentLineId ? (
        <button
          type="button"
          onClick={handleResync}
          className="player-menu absolute bottom-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--player-accent-border)] px-4 py-2 text-sm font-semibold text-[var(--player-accent-text)] transition-colors hover:bg-[var(--player-bg-elevated)]"
          title="Sync"
          aria-label="Sync to current lyric"
        >
          <CircleChevronsIcon direction={resyncDirection} />
          <span>Sync</span>
        </button>
      ) : null}
    </section>
  );
}

export default PlayerLyricsView;
