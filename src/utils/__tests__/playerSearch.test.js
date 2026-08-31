import { describe, expect, it } from 'vitest';
import {
  applyRoleToQuery,
  buildPlayerSearchItems,
  buildSearchSuggestions,
  parsePlayerSearchQuery,
  scoreTextMatch,
  searchPlayerCatalog,
} from '../playerSearch';

describe('parsePlayerSearchQuery', () => {
  it('splits free text into terms', () => {
    expect(parsePlayerSearchQuery('  Hello   World ')).toEqual(expect.objectContaining({
      terms: ['Hello', 'World'],
      roleKeys: [],
      empty: false,
    }));
  });

  it('parses role:value syntax', () => {
    expect(parsePlayerSearchQuery('lyricist:Jane')).toEqual(expect.objectContaining({
      terms: ['Jane'],
      roleKeys: ['lyricist'],
    }));
  });

  it('treats a role word plus a name as a specific credit search', () => {
    expect(parsePlayerSearchQuery('Jane lyricist')).toEqual(expect.objectContaining({
      terms: ['Jane'],
      roleKeys: ['lyricist'],
      catalogTerms: ['Jane'],
    }));
  });

  it('recognizes multi-word role phrases', () => {
    expect(parsePlayerSearchQuery('Jane lyrics writer')).toEqual(expect.objectContaining({
      terms: ['Jane'],
      roleKeys: ['lyricist'],
    }));
    expect(parsePlayerSearchQuery('music performer Jane')).toEqual(expect.objectContaining({
      terms: ['Jane'],
      roleKeys: ['performer'],
    }));
  });

  it('keeps a lone role word searchable as catalog text', () => {
    expect(parsePlayerSearchQuery('lyricist')).toEqual(expect.objectContaining({
      terms: ['lyricist'],
      roleKeys: [],
      catalogTerms: ['lyricist'],
    }));
  });
});

describe('scoreTextMatch', () => {
  it('ranks prefix matches above contains', () => {
    expect(scoreTextMatch('Hello Dolly', ['hello'])).toBeGreaterThan(scoreTextMatch('Say Hello', ['hello']));
    expect(scoreTextMatch('Cabaret', ['xyz'])).toBe(0);
  });

  it('requires every term to match', () => {
    expect(scoreTextMatch('One Night Only', ['one', 'night'])).toBeGreaterThan(0);
    expect(scoreTextMatch('One Night Only', ['one', 'missing'])).toBe(0);
  });
});

describe('searchPlayerCatalog', () => {
  const items = buildPlayerSearchItems({
    shows: [{ id: 'show-1', name: 'Chicago', mixes: [{ id: 's1' }, { id: 's2' }] }],
    songs: [{
      id: 'song-1',
      projectId: 'proj-1',
      name: 'Cell Block Tango',
      musicalNumber: '1.4',
      showName: 'Chicago',
      showId: 'show-1',
    }],
    mixes: [{
      id: 'mix-1',
      name: 'Tango practice',
      projectName: 'Cell Block Tango',
      musicalNumber: '1.4',
      showName: 'Chicago',
    }],
    playlists: [{ id: 'pl-1', name: 'Warmup' }],
    folders: [{ id: 'folder-1', name: 'Private charts' }],
  });
  const credits = [{
    artistKey: 'user:jane',
    artistType: 'user',
    artistId: 'jane',
    name: 'Jane Doe',
    involvements: [
      { roleKey: 'lyricist', roleLabel: 'Lyricist', projectName: 'Cell Block Tango', showName: 'Chicago' },
      { roleKey: 'performer', roleLabel: 'Performer', projectName: 'Roxie', showName: 'Chicago' },
    ],
  }];

  it('finds each library type by name', () => {
    const chicago = searchPlayerCatalog(items, parsePlayerSearchQuery('chicago'));
    expect(chicago.byType.shows.map((item) => item.title)).toContain('Chicago');
    expect(chicago.byType.songs[0].title).toContain('Cell Block Tango');

    expect(searchPlayerCatalog(items, parsePlayerSearchQuery('tango practice')).byType.mixes).toHaveLength(1);
    expect(searchPlayerCatalog(items, parsePlayerSearchQuery('warmup')).byType.playlists).toHaveLength(1);
    expect(searchPlayerCatalog(items, parsePlayerSearchQuery('private')).byType.folders).toHaveLength(1);
  });

  it('matches songs by musical number', () => {
    const results = searchPlayerCatalog(items, parsePlayerSearchQuery('1.4'));
    expect(results.byType.songs).toHaveLength(1);
  });

  it('filters credits by person and optional role', () => {
    const generic = searchPlayerCatalog(items, parsePlayerSearchQuery('jane'), credits);
    expect(generic.byType.credits).toHaveLength(1);
    expect(generic.byType.credits[0].payload.involvements).toHaveLength(2);

    const specific = searchPlayerCatalog(items, parsePlayerSearchQuery('jane lyricist'), credits);
    expect(specific.byType.credits[0].payload.involvements.map((row) => row.roleKey)).toEqual(['lyricist']);
    expect(specific.byType.credits[0].subtitle).toBe('Lyricist');
  });

  it('does not return a credit for the wrong role', () => {
    const results = searchPlayerCatalog(items, parsePlayerSearchQuery('jane composer'), credits);
    expect(results.byType.credits).toHaveLength(0);
  });

  it('builds typed suggestions including the query itself', () => {
    const parsed = parsePlayerSearchQuery('chic');
    const results = searchPlayerCatalog(items, parsed, credits);
    const suggestions = buildSearchSuggestions(parsed, results);
    expect(suggestions[0]).toEqual(expect.objectContaining({ type: 'query', title: 'chic' }));
    expect(suggestions.some((item) => item.type === 'show')).toBe(true);
  });

  it('turns a role suggestion back into a role query', () => {
    expect(applyRoleToQuery('jane', { key: 'lyricist', label: 'Lyricist', aliases: [] })).toBe('lyricist:jane');
  });
});
