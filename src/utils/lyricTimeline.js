export const MIN_LYRIC_LINE_DURATION_MS = 200;

const finiteMs = (value, fallback = null) => {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
};

export function getPlacedLyricLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => line?.id && finiteMs(line.startMs) != null)
    .map((line, index) => ({ line, index, startMs: finiteMs(line.startMs) }))
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index);
}

export function getLyricLineRange(lines, anchorLineId, targetLineId) {
  const orderedIds = getPlacedLyricLines(lines).map(({ line }) => line.id);
  const anchorIndex = orderedIds.indexOf(anchorLineId);
  const targetIndex = orderedIds.indexOf(targetLineId);
  if (targetIndex < 0) return [];
  if (anchorIndex < 0) return [targetLineId];
  return orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
}

export function constrainLyricInsertionStart(lines, requestedStartMs, projectDurationMs) {
  const durationMs = Math.max(0, finiteMs(projectDurationMs, 0));
  const requestedMs = Math.max(0, finiteMs(requestedStartMs, 0));
  const deletedLineIds = new Set();

  for (let attempt = 0; attempt <= (Array.isArray(lines) ? lines.length : 0); attempt += 1) {
    const ordered = getPlacedLyricLines(lines).filter(({ line }) => !deletedLineIds.has(line.id));
    const gaps = [];
    let previous = null;

    [...ordered, null].forEach((next) => {
      const minStart = previous ? previous.startMs + MIN_LYRIC_LINE_DURATION_MS : 0;
      const maxStart = next
        ? next.startMs - MIN_LYRIC_LINE_DURATION_MS
        : durationMs - MIN_LYRIC_LINE_DURATION_MS;
      if (maxStart >= minStart) {
        const startMs = Math.max(minStart, Math.min(maxStart, requestedMs));
        gaps.push({
          startMs,
          distanceMs: Math.abs(startMs - requestedMs),
          previous,
          next,
        });
      }
      previous = next;
    });

    gaps.sort((left, right) => left.distanceMs - right.distanceMs || left.startMs - right.startMs);
    const closestGap = gaps[0];
    if (!closestGap) {
      const empty = ordered.find(({ line }) => !String(line.text ?? '').trim());
      if (!empty) return { startMs: null, deletedLineIds: [...deletedLineIds] };
      deletedLineIds.add(empty.line.id);
      continue;
    }

    const emptyBoundary = [closestGap.previous, closestGap.next].find((entry) => (
      entry
      && !String(entry.line.text ?? '').trim()
      && Math.abs(closestGap.startMs - entry.startMs) <= MIN_LYRIC_LINE_DURATION_MS
    ));
    if (emptyBoundary) {
      deletedLineIds.add(emptyBoundary.line.id);
      continue;
    }

    return { startMs: closestGap.startMs, deletedLineIds: [...deletedLineIds] };
  }

  return { startMs: null, deletedLineIds: [...deletedLineIds] };
}

export function pruneShortEmptyLyricLines(lines, projectDurationMs) {
  const durationMs = Math.max(0, finiteMs(projectDurationMs, 0));
  const ordered = getPlacedLyricLines(lines);
  const removedIds = new Set();
  ordered.forEach((entry, index) => {
    if (String(entry.line.text ?? '').trim()) return;
    const endMs = index + 1 < ordered.length ? ordered[index + 1].startMs : durationMs;
    if (endMs - entry.startMs <= MIN_LYRIC_LINE_DURATION_MS) removedIds.add(entry.line.id);
  });
  return (Array.isArray(lines) ? lines : []).filter((line) => !removedIds.has(line?.id));
}

export function getLyricLineEndMs(orderedLines, lineId, projectDurationMs) {
  const index = orderedLines.findIndex(({ line }) => line.id === lineId);
  if (index < 0) return Math.max(0, finiteMs(projectDurationMs, 0));
  return index + 1 < orderedLines.length
    ? orderedLines[index + 1].startMs
    : Math.max(orderedLines[index].startMs, finiteMs(projectDurationMs, 0));
}

export function constrainLyricStart(lines, lineId, requestedStartMs, projectDurationMs) {
  const ordered = getPlacedLyricLines(lines);
  const index = ordered.findIndex(({ line }) => line.id === lineId);
  if (index < 0) return null;
  const durationMs = Math.max(0, finiteMs(projectDurationMs, 0));
  const previousStart = index > 0 ? ordered[index - 1].startMs : 0;
  const nextStart = index + 1 < ordered.length ? ordered[index + 1].startMs : durationMs;
  const minStart = index > 0 ? previousStart + MIN_LYRIC_LINE_DURATION_MS : 0;
  const maxStart = index + 1 < ordered.length
    ? nextStart - MIN_LYRIC_LINE_DURATION_MS
    : durationMs - MIN_LYRIC_LINE_DURATION_MS;
  if (maxStart < minStart) return null;
  return Math.max(minStart, Math.min(maxStart, finiteMs(requestedStartMs, minStart)));
}

/** Move one or more selected start markers together without crossing another marker. */
export function calculateLyricStartMovePreview(lines, selectedLineIds, requestedDeltaMs, projectDurationMs) {
  const ordered = getPlacedLyricLines(lines);
  const selectedIds = new Set(Array.isArray(selectedLineIds) ? selectedLineIds : [selectedLineIds]);
  const selectedIndexes = ordered
    .map((entry, index) => selectedIds.has(entry.line.id) ? index : -1)
    .filter((index) => index >= 0);
  if (selectedIndexes.length === 0) return null;

  const selectedIndexSet = new Set(selectedIndexes);
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  const durationMs = Math.max(0, finiteMs(projectDurationMs, 0));
  selectedIndexes.forEach((index) => {
    const current = ordered[index].startMs;
    if (index === 0 || !selectedIndexSet.has(index - 1)) {
      const previous = index > 0 ? ordered[index - 1].startMs : 0;
      minDelta = Math.max(minDelta, (index > 0 ? previous + MIN_LYRIC_LINE_DURATION_MS : 0) - current);
    }
    if (index === ordered.length - 1 || !selectedIndexSet.has(index + 1)) {
      const next = index < ordered.length - 1
        ? ordered[index + 1].startMs
        : durationMs;
      maxDelta = Math.min(maxDelta, (index < ordered.length - 1
        ? next - MIN_LYRIC_LINE_DURATION_MS
        : durationMs - MIN_LYRIC_LINE_DURATION_MS) - current);
    }
  });
  if (maxDelta < minDelta) return null;
  const delta = Math.max(minDelta, Math.min(maxDelta, finiteMs(requestedDeltaMs, 0)));
  return Object.fromEntries(selectedIndexes.map((index) => {
    const { line, startMs } = ordered[index];
    return [line.id, { startMs: startMs + delta }];
  }));
}

/** Clamp the playhead preview between neighboring lyric markers and leave room for every pending line. */
export function getLyricPlacementPreviewStart(lines, lineIndex, requestedStartMs, projectDurationMs) {
  const rows = Array.isArray(lines) ? lines : [];
  const target = rows[lineIndex];
  if (!target) return null;
  const durationMs = Math.max(0, finiteMs(projectDurationMs, 0));
  const pendingCount = rows.slice(lineIndex).filter((line) => finiteMs(line?.startMs) == null).length;
  const previous = rows.slice(0, lineIndex).reverse().find((line) => finiteMs(line?.startMs) != null);
  const next = rows.slice(lineIndex + 1).find((line) => finiteMs(line?.startMs) != null);
  const minStart = previous ? finiteMs(previous.startMs) + MIN_LYRIC_LINE_DURATION_MS : 0;
  const maxStart = Math.min(
    next ? finiteMs(next.startMs) - MIN_LYRIC_LINE_DURATION_MS : durationMs - MIN_LYRIC_LINE_DURATION_MS,
    durationMs - pendingCount * MIN_LYRIC_LINE_DURATION_MS,
  );
  if (maxStart < minStart) return null;
  return Math.max(minStart, Math.min(maxStart, finiteMs(requestedStartMs, minStart)));
}
