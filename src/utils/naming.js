import {
  MUSICAL_NUMBER_MAX_LENGTH,
  compareMusicalNumbers,
  formatMusicalNumberForDisplay,
  isValidMusicalNumber,
  musicalNumberUniquenessKey,
  normalizeMusicalNumber,
  suggestNextUniqueMusicalNumber,
} from '../../shared/musicalNumber.js';

const INVALID_WINDOWS_FILENAME_CHARS_REGEX = /[\\/:*?"<>|]/g;
const INVALID_WINDOWS_FILENAME_CHARS_TEST_REGEX = /[\\/:*?"<>|]/;

export {
  MUSICAL_NUMBER_MAX_LENGTH,
  compareMusicalNumbers,
  formatMusicalNumberForDisplay,
  isValidMusicalNumber,
  musicalNumberUniquenessKey,
  normalizeMusicalNumber,
  suggestNextUniqueMusicalNumber,
};

/**
 * Remove leading/trailing spaces and dots.
 */
export function trimNameEdges(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/^[\s.]+|[\s.]+$/g, '');
}

export function normalizeProjectName(name) {
  return trimNameEdges(name);
}

export function normalizeTrackName(name) {
  const trimmed = trimNameEdges(name);
  return trimmed.replace(INVALID_WINDOWS_FILENAME_CHARS_REGEX, '');
}

export function normalizeExportName(name) {
  return trimNameEdges(name);
}

export function hasInvalidExportNameChars(name) {
  return INVALID_WINDOWS_FILENAME_CHARS_TEST_REGEX.test(name || '');
}
