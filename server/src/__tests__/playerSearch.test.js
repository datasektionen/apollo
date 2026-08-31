import { describe, expect, it } from 'vitest';
import { collectCreditInvolvements, groupInvolvementsByArtist } from '../playerSearch.js';

describe('collectCreditInvolvements', () => {
  it('flattens project roles, nested performers, and show producers', () => {
    const involvements = collectCreditInvolvements({
      projectId: 'p1',
      projectName: 'Roxie',
      musicalNumber: '1.1',
      showId: 's1',
      showName: 'Chicago',
      credits: {
        compositionLyrics: [{
          roleKey: 'lyricist',
          roleLabel: 'Lyricist',
          artists: [{ type: 'user', id: 'jane', name: 'Jane Doe' }],
        }],
        performers: [{
          artist: { type: 'group', id: 'band', name: 'The Band', groupType: 'Band' },
          contributionLabel: 'Band',
          members: [{
            artist: { type: 'user', id: 'john', name: 'John Smith' },
            contributionLabel: 'Guitar',
          }],
        }],
      },
      showProducers: [{ type: 'user', id: 'jane', name: 'Jane Doe' }],
    });

    expect(involvements).toEqual(expect.arrayContaining([
      expect.objectContaining({ artistId: 'jane', roleKey: 'lyricist', projectId: 'p1' }),
      expect.objectContaining({ artistId: 'jane', roleKey: 'show_producer', showId: 's1', projectId: '' }),
      expect.objectContaining({ artistId: 'band', roleKey: 'performer', contributionLabel: 'Band' }),
      expect.objectContaining({ artistId: 'john', roleKey: 'performer', contributionLabel: 'Guitar' }),
    ]));
  });

  it('groups involvements by artist', () => {
    const grouped = groupInvolvementsByArtist(collectCreditInvolvements({
      projectId: 'p1',
      projectName: 'Roxie',
      showId: 's1',
      showName: 'Chicago',
      credits: {
        compositionLyrics: [{
          roleKey: 'lyricist',
          roleLabel: 'Lyricist',
          artists: [{ type: 'user', id: 'jane', name: 'Jane Doe' }],
        }],
      },
      showProducers: [{ type: 'user', id: 'jane', name: 'Jane Doe' }],
    }));

    expect(grouped).toHaveLength(1);
    expect(grouped[0].involvements).toHaveLength(2);
  });
});
