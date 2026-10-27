import { describe, expect, it } from 'vitest';
import {
  calculateLyricStartMovePreview,
  constrainLyricInsertionStart,
  constrainLyricStart,
  getLyricLineEndMs,
  getLyricLineRange,
  getLyricPlacementPreviewStart,
  getPlacedLyricLines,
  pruneShortEmptyLyricLines,
} from '../lyricTimeline';

const lines = [
  { id: 'one', text: 'One', startMs: 0 },
  { id: 'two', text: 'Two', startMs: 500 },
  { id: 'three', text: 'Three', startMs: null },
];

describe('lyric timeline', () => {
  it('renders each line through the next start and the last line through project end', () => {
    const placed = getPlacedLyricLines(lines);
    expect(placed.map(({ line }) => line.id)).toEqual(['one', 'two']);
    expect(getLyricLineEndMs(placed, 'one', 1200)).toBe(500);
    expect(getLyricLineEndMs(placed, 'two', 1200)).toBe(1200);
  });

  it('selects a contiguous range between the anchor and target lyric lines', () => {
    expect(getLyricLineRange([
      { id: 'four', startMs: 900 },
      { id: 'one', startMs: 100 },
      { id: 'three', startMs: 700 },
      { id: 'two', startMs: 400 },
    ], 'two', 'four')).toEqual(['two', 'three', 'four']);
    expect(getLyricLineRange(lines, 'two', 'one')).toEqual(['one', 'two']);
  });

  it('previews the next start at the playhead while preserving lyric order', () => {
    expect(getLyricPlacementPreviewStart(lines, 2, 800, 1200)).toBe(800);
    expect(getLyricPlacementPreviewStart(lines, 2, 400, 1200)).toBe(700);
  });

  it('moves selected starts together without crossing neighboring starts', () => {
    const preview = calculateLyricStartMovePreview(lines, ['one', 'two'], 700, 1200);
    expect(preview).toEqual({
      one: { startMs: 500 },
      two: { startMs: 1000 },
    });
  });

  it('constrains direct time edits between neighboring starts', () => {
    expect(constrainLyricStart(lines, 'two', 1500, 1200)).toBe(1000);
    expect(constrainLyricStart(lines, 'two', 0, 1200)).toBe(200);
    expect(constrainLyricStart(lines, 'one', -100, 1200)).toBe(0);
  });

  it('keeps at least the minimum duration on both sides of an inserted start', () => {
    expect(constrainLyricInsertionStart(lines, 550, 1200)).toEqual({
      startMs: 700,
      deletedLineIds: [],
    });
  });

  it('removes an empty neighbor when insertion would leave it at the minimum duration', () => {
    expect(constrainLyricInsertionStart([
      { id: 'first', text: 'First', startMs: 0 },
      { id: 'empty', text: '', startMs: 250 },
      { id: 'next', text: 'Next', startMs: 700 },
    ], 300, 1200)).toEqual({
      startMs: 300,
      deletedLineIds: ['empty'],
    });
  });

  it('deletes empty placed lines whose duration reaches the minimum', () => {
    expect(pruneShortEmptyLyricLines([
      { id: 'first', text: 'First', startMs: 0 },
      { id: 'empty', text: '', startMs: 300 },
      { id: 'next', text: 'Next', startMs: 500 },
    ], 1200).map((line) => line.id)).toEqual(['first', 'next']);
  });
});
