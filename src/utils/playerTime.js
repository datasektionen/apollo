/**
 * Player clock and mix-duration helpers.
 * Timeline times are milliseconds; clock display uses seconds.
 */

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeClipEndMs(clip) {
  const startMs = toFiniteNumber(clip?.timelineStartMs, 0);
  const cropStartMs = toFiniteNumber(clip?.cropStartMs, 0);
  const cropEndMs = Number(clip?.cropEndMs);
  const sourceDurationMs = Number(clip?.sourceDurationMs);
  const endOffsetMs = Number.isFinite(cropEndMs) && cropEndMs > cropStartMs
    ? cropEndMs
    : (Number.isFinite(sourceDurationMs) ? sourceDurationMs : 0);
  return startMs + Math.max(0, endOffsetMs - cropStartMs);
}

export function computeSnapshotDurationMs(snapshot) {
  let maxDurationMs = 0;
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  tracks.forEach((track) => {
    const clips = Array.isArray(track?.clips) ? track.clips : [];
    clips.forEach((clip) => {
      const clipEndMs = computeClipEndMs(clip);
      if (Number.isFinite(clipEndMs)) {
        maxDurationMs = Math.max(maxDurationMs, clipEndMs);
      }
    });
  });
  return maxDurationMs;
}

export function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds));
  if (!Number.isFinite(safe)) return '0:00';
  const totalSecs = Math.floor(safe);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function clampPlayerSeek(timeSec, durationSec) {
  const duration = Math.max(0, toFiniteNumber(durationSec, 0));
  const next = Math.max(0, Math.min(toFiniteNumber(timeSec, 0), duration));
  return {
    timeSec: next,
    timeMs: Math.max(0, Math.round(next * 1000)),
  };
}

export function shouldCommitPlayingSeek(committedMs, nextMs, epsilonMs = 0) {
  if (!Number.isFinite(nextMs)) return false;
  if (committedMs == null) return true;
  const epsilon = Math.max(0, Number(epsilonMs) || 0);
  return Math.abs(committedMs - nextMs) > epsilon;
}

export function seekPreviewFromPointer(clientX, trackRect, durationSec) {
  const width = Math.max(1, Number(trackRect?.width) || 0);
  const left = Number(trackRect?.left) || 0;
  const ratio = Math.max(0, Math.min(1, (Number(clientX) - left) / width));
  return clampPlayerSeek(ratio * (Number(durationSec) || 0), durationSec);
}

export function formatDurationMs(durationMs, fallbackSec = 0) {
  const mixMs = Number(durationMs);
  if (Number.isFinite(mixMs) && mixMs > 0) {
    return formatClock(mixMs / 1000);
  }
  const fallback = Number(fallbackSec);
  if (Number.isFinite(fallback) && fallback > 0) {
    return formatClock(fallback);
  }
  return '--:--';
}
