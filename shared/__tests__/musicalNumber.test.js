import { describe, expect, it } from 'vitest';
import {
  MUSICAL_NUMBER_MAX_LENGTH,
  compareMusicalNumbers,
  formatMusicalNumberForDisplay,
  isValidMusicalNumber,
  normalizeMusicalNumber,
} from '../musicalNumber.js';

describe('musicalNumber', () => {
  it('validates any non-empty string under 10 characters', () => {
    expect(MUSICAL_NUMBER_MAX_LENGTH).toBe(9);
    expect(isValidMusicalNumber('1')).toBe(true);
    expect(isValidMusicalNumber('0.0')).toBe(true);
    expect(isValidMusicalNumber('_Intro')).toBe(true);
    expect(isValidMusicalNumber('Act 2 Finale'.slice(0, 9))).toBe(true);
    expect(isValidMusicalNumber('123456789')).toBe(true);
    expect(isValidMusicalNumber(' 123456789 ')).toBe(true);

    expect(isValidMusicalNumber('')).toBe(false);
    expect(isValidMusicalNumber('   ')).toBe(false);
    expect(isValidMusicalNumber('1234567890')).toBe(false);
    expect(normalizeMusicalNumber('  _1  ')).toBe('_1');
  });

  it('strips underscores from display strings while keeping spaces and other characters', () => {
    expect(formatMusicalNumberForDisplay('_Intro')).toBe('Intro');
    expect(formatMusicalNumberForDisplay('_1')).toBe('1');
    expect(formatMusicalNumberForDisplay('2_A')).toBe('2A');
    expect(formatMusicalNumberForDisplay('2.0')).toBe('2.0');
    expect(formatMusicalNumberForDisplay('A 1')).toBe('A 1');
  });

  it('sorts underscore/punctuation first, then numbers numerically, then case-insensitive letters', () => {
    const unsorted = [
      'b2',
      'A1',
      '10.0',
      '2.1',
      '2.0',
      '10a',
      '10B',
      '_Intro',
      '_1',
      '.5',
      'a2',
      '1',
    ];

    const sorted = unsorted.slice().sort(compareMusicalNumbers);

    expect(sorted).toEqual([
      '_1',
      '_Intro',
      '.5',
      '1',
      '2.0',
      '2.1',
      '10.0',
      '10a',
      '10B',
      'A1',
      'a2',
      'b2',
    ]);
  });

  it('compares letters case-insensitively regardless of uppercase/lowercase mix', () => {
    expect(compareMusicalNumbers('a', 'B')).toBeLessThan(0);
    expect(compareMusicalNumbers('B', 'c')).toBeLessThan(0);
    expect(compareMusicalNumbers('a 1', 'a.1')).toBeLessThan(0);
    expect(compareMusicalNumbers('a.1', 'a1')).toBeLessThan(0);
    expect(compareMusicalNumbers('a1', 'aa')).toBeLessThan(0);
  });
});
