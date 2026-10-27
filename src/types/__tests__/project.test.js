import { describe, expect, it } from 'vitest';
import { createEmptyProject, normalizeProjectLyrics } from '../project';

describe('project lyrics schema', () => {
  it('creates projects with empty Swedish lyrics and fills the configured legacy default', () => {
    expect(createEmptyProject().lyrics).toEqual({ language: 'sv', useSyncedLyrics: false, lines: [] });
    expect(normalizeProjectLyrics(undefined, 'en')).toEqual({ language: 'en', useSyncedLyrics: false, lines: [] });
  });

  it('keeps only lyric text, IDs, and optional start markers', () => {
    expect(normalizeProjectLyrics({
      language: 'EN',
      useSyncedLyrics: true,
      lines: [
        { id: 'stable', text: '  Keep spaces  ', startMs: 12.6, endMs: 850.2, source: 'ai', confidence: 1.4 },
        { id: 'pending', text: 'not placed', startMs: null, endMs: 5, source: 'manual' },
        { id: 'empty', text: '', startMs: 900, endMs: 901, source: 'manual', confidence: 0.9 },
      ],
    })).toEqual({
      language: 'en',
      useSyncedLyrics: true,
      lines: [
        { id: 'stable', text: '  Keep spaces  ', startMs: 13 },
        { id: 'pending', text: 'not placed', startMs: null },
        { id: 'empty', text: '', startMs: 900 },
      ],
    });
  });
});
