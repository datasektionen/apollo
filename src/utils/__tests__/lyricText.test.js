import { describe, expect, it, vi } from 'vitest';
import { mergeLyricTextLines } from '../lyricText';

describe('mergeLyricTextLines', () => {
  it('preserves existing line IDs and timing when inserting a line between them', () => {
    const result = mergeLyricTextLines('First\nInserted\nSecond', [
      { id: 'first', text: 'First', startMs: 100 },
      { id: 'second', text: 'Second', startMs: 800 },
    ], vi.fn(() => 'new-line'));

    expect(result).toEqual([
      { id: 'first', text: 'First', startMs: 100 },
      { id: 'new-line', text: 'Inserted', startMs: null },
      { id: 'second', text: 'Second', startMs: 800 },
    ]);
  });

  it('keeps an inserted blank row when another line is edited', () => {
    expect(mergeLyricTextLines('Updated first\n\nSecond', [
      { id: 'first', text: 'First', startMs: 100 },
      { id: 'blank', text: '', startMs: null },
      { id: 'second', text: 'Second', startMs: 800 },
    ], () => 'new-line')).toEqual([
      { id: 'first', text: 'Updated first', startMs: 100 },
      { id: 'blank', text: '', startMs: null },
      { id: 'second', text: 'Second', startMs: 800 },
    ]);
  });

  it('keeps a line ID and timing when its text is edited in place', () => {
    expect(mergeLyricTextLines('Updated first\nSecond', [
      { id: 'first', text: 'First', startMs: 100 },
      { id: 'second', text: 'Second', startMs: 800 },
    ], () => 'new-line')).toEqual([
      { id: 'first', text: 'Updated first', startMs: 100 },
      { id: 'second', text: 'Second', startMs: 800 },
    ]);
  });
});
