import { describe, expect, it } from 'vitest';
import {
  compareMusicalNumbers,
  formatMusicalNumberForDisplay,
  isValidMusicalNumber,
  musicalNumberUniquenessKey,
  normalizeMusicalNumber,
  suggestNextUniqueMusicalNumber,
} from '../../../shared/musicalNumber.js';

describe('musicalNumber helpers', () => {
  it('validates length under 10 chars and requires non-underscore display chars', () => {
    expect(isValidMusicalNumber('')).toBe(false);
    expect(isValidMusicalNumber('   ')).toBe(false);
    expect(isValidMusicalNumber('_')).toBe(false);
    expect(isValidMusicalNumber('___')).toBe(false);
    expect(isValidMusicalNumber('1234567890')).toBe(false);
    expect(isValidMusicalNumber('123456789')).toBe(true);
    expect(isValidMusicalNumber('_1')).toBe(true);
    expect(isValidMusicalNumber('2.1')).toBe(true);
    expect(normalizeMusicalNumber('  _Intro  ')).toBe('_Intro');
    expect(formatMusicalNumberForDisplay('_Intro_1')).toBe('Intro1');
  });

  it('builds case-insensitive uniqueness keys ignoring underscores', () => {
    expect(musicalNumberUniquenessKey('_1')).toBe('1');
    expect(musicalNumberUniquenessKey('1')).toBe('1');
    expect(musicalNumberUniquenessKey('1A')).toBe('1a');
    expect(musicalNumberUniquenessKey('_1a_')).toBe('1a');
  });

  it('sorts underscore/punctuation < numbers < case-insensitive letters', () => {
    const raw = ['B2', '10', '2', '_Intro', 'a1', '1'];
    expect([...raw].sort(compareMusicalNumbers)).toEqual(['_Intro', '1', '2', '10', 'a1', 'B2']);
  });

  it('suggests the next unique musical number without colliding with underscores or case', () => {
    expect(suggestNextUniqueMusicalNumber(['0.0', '0.1'], '0.0')).toBe('0.2');
    expect(suggestNextUniqueMusicalNumber(['_0.0', '0.1'], '0.0')).toBe('0.2');
    expect(suggestNextUniqueMusicalNumber(['Finale', 'finale-2'], 'finale')).toBe('finale-3');
    expect(suggestNextUniqueMusicalNumber(['1.0'], '0.0')).toBe('0.0');
  });
});
