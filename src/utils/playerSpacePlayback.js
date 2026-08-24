export function canResumePlayerPlayback({
  currentTimeSec,
  durationSec,
  hasRealtimeItem,
} = {}) {
  return Boolean(hasRealtimeItem)
    && Number(currentTimeSec) < Math.max(0, (Number(durationSec) || 0) - 0.01);
}

/**
 * Space in player mode: toggle the current/paused song first, else play the
 * highlighted list row. Returns 'toggle-current' | 'play-highlighted' | 'none'.
 */
export function resolvePlayerSpaceAction({
  isPlaying = false,
  canResumeCurrent = false,
  highlightedIndex = -1,
} = {}) {
  if (isPlaying || canResumeCurrent) return 'toggle-current';
  if (Number(highlightedIndex) >= 0) return 'play-highlighted';
  return 'none';
}
