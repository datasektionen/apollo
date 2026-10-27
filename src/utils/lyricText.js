import { createId } from './id';

/** Reconcile edited lyric text while preserving timing for existing lines. */
export function mergeLyricTextLines(text, existingLines = [], makeId = createId) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  const rawText = String(text || '');
  const inputLines = rawText ? rawText.split(/\r?\n/u) : [];
  const matchedByIndex = new Array(inputLines.length).fill(null);
  const usedIds = new Set();
  const existingByText = new Map();

  existing.forEach((line) => {
    const key = String(line?.text ?? '').trim();
    if (!key) return;
    if (!existingByText.has(key)) existingByText.set(key, []);
    existingByText.get(key).push(line);
  });

  inputLines.forEach((lineText, index) => {
    const key = lineText.trim();
    if (!key) return;
    const exact = (existingByText.get(key) || []).find((line) => !usedIds.has(line.id));
    if (!exact) return;
    matchedByIndex[index] = exact;
    usedIds.add(exact.id);
  });

  return inputLines.map((lineText, index) => {
    const positional = existing[index] && !usedIds.has(existing[index].id) ? existing[index] : null;
    const matched = matchedByIndex[index] || positional;
    const id = matched?.id || makeId();
    usedIds.add(id);
    return { id, text: lineText, startMs: matched?.startMs ?? null };
  });
}
