export const MUSICAL_NUMBER_MAX_LENGTH = 9;

const LETTER_RE = /^\p{L}$/u;

export function normalizeMusicalNumber(value) {
  return String(value ?? '').trim();
}

export function formatMusicalNumberForDisplay(value) {
  return normalizeMusicalNumber(value).replace(/_/g, '');
}

export function musicalNumberUniquenessKey(value) {
  return formatMusicalNumberForDisplay(value).toLowerCase();
}

export function isValidMusicalNumber(value) {
  const normalized = normalizeMusicalNumber(value);
  return (
    normalized.length >= 1
    && normalized.length <= MUSICAL_NUMBER_MAX_LENGTH
    && formatMusicalNumberForDisplay(normalized).length >= 1
  );
}

export function suggestNextUniqueMusicalNumber(existingNumbers = [], preferred = '0.0') {
  const usedKeys = new Set(
    (existingNumbers || [])
      .map((entry) => musicalNumberUniquenessKey(entry))
      .filter(Boolean)
  );
  const trimmedPreferred = normalizeMusicalNumber(preferred);
  if (isValidMusicalNumber(trimmedPreferred) && !usedKeys.has(musicalNumberUniquenessKey(trimmedPreferred))) {
    return trimmedPreferred;
  }

  const decimalMatch = trimmedPreferred.match(/^([0-9]+)\.([0-9]+)$/);
  if (decimalMatch) {
    const major = decimalMatch[1];
    const startMinor = Number.parseInt(decimalMatch[2], 10);
    for (let offset = 1; offset <= 99; offset += 1) {
      const candidate = `${major}.${startMinor + offset}`;
      if (candidate.length <= MUSICAL_NUMBER_MAX_LENGTH && !usedKeys.has(musicalNumberUniquenessKey(candidate))) {
        return candidate;
      }
    }
  }

  if (isValidMusicalNumber(trimmedPreferred)) {
    for (let suffixNum = 2; suffixNum <= 99; suffixNum += 1) {
      const suffix = `-${suffixNum}`;
      const base = trimmedPreferred.slice(0, Math.max(0, MUSICAL_NUMBER_MAX_LENGTH - suffix.length));
      const candidate = `${base}${suffix}`;
      if (isValidMusicalNumber(candidate) && !usedKeys.has(musicalNumberUniquenessKey(candidate))) {
        return candidate;
      }
    }
  }

  for (let n = 1; n <= 999999; n += 1) {
    const candidate = String(n);
    if (candidate.length <= MUSICAL_NUMBER_MAX_LENGTH && !usedKeys.has(musicalNumberUniquenessKey(candidate))) {
      return candidate;
    }
  }
  return '1';
}

function tokenizeMusicalNumber(raw) {
  const str = normalizeMusicalNumber(raw);
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const remaining = str.slice(i);
    const digitMatch = remaining.match(/^[0-9]+/);
    if (digitMatch) {
      const digits = digitMatch[0];
      tokens.push({
        bucket: 1,
        num: Number.parseInt(digits, 10),
        rawLen: digits.length,
        raw: digits,
      });
      i += digits.length;
      continue;
    }
    const codePoint = str.codePointAt(i);
    const ch = String.fromCodePoint(codePoint);
    i += ch.length;
    if (LETTER_RE.test(ch)) {
      tokens.push({
        bucket: 2,
        fold: ch.toLowerCase(),
        raw: ch,
      });
      continue;
    }
    let subRank;
    if (ch === '_') {
      subRank = 0;
    } else if (/\s/.test(ch)) {
      subRank = 1;
    } else {
      subRank = 2 + (codePoint ?? 0);
    }
    tokens.push({
      bucket: 0,
      subRank,
      raw: ch,
    });
  }
  return tokens;
}

function compareFoldedLetters(leftFold, rightFold) {
  if (leftFold === rightFold) return 0;
  const isLeftAscii = /^[a-z]$/.test(leftFold);
  const isRightAscii = /^[a-z]$/.test(rightFold);
  if (isLeftAscii && isRightAscii) {
    return leftFold < rightFold ? -1 : 1;
  }
  const localeDiff = leftFold.localeCompare(rightFold, undefined, { sensitivity: 'base' });
  if (localeDiff !== 0) return localeDiff;
  return leftFold < rightFold ? -1 : 1;
}

/**
 * Sorts musical number strings with custom precedence:
 *   0. Underscore (_), spaces, and punctuation
 *   1. Numbers (0-9, compared numerically)
 *   2. Letters (A/a-Z/z, case-insensitive)
 */
export function compareMusicalNumbers(leftRaw, rightRaw) {
  const leftTokens = tokenizeMusicalNumber(leftRaw);
  const rightTokens = tokenizeMusicalNumber(rightRaw);
  const commonLen = Math.min(leftTokens.length, rightTokens.length);

  for (let i = 0; i < commonLen; i += 1) {
    const lt = leftTokens[i];
    const rt = rightTokens[i];
    if (lt.bucket !== rt.bucket) {
      return lt.bucket - rt.bucket;
    }
    if (lt.bucket === 0) {
      if (lt.subRank !== rt.subRank) return lt.subRank - rt.subRank;
      continue;
    }
    if (lt.bucket === 1) {
      if (lt.num !== rt.num) return lt.num - rt.num;
      continue;
    }
    const letterDiff = compareFoldedLetters(lt.fold, rt.fold);
    if (letterDiff !== 0) return letterDiff;
  }

  if (leftTokens.length !== rightTokens.length) {
    return leftTokens.length - rightTokens.length;
  }

  for (let i = 0; i < commonLen; i += 1) {
    const lt = leftTokens[i];
    const rt = rightTokens[i];
    if (lt.raw !== rt.raw) {
      return lt.raw < rt.raw ? -1 : 1;
    }
  }
  return 0;
}
