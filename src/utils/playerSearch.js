export const PLAYER_SEARCH_TYPES = {
  ALL: 'all',
  SHOWS: 'shows',
  SONGS: 'songs',
  MIXES: 'mixes',
  PLAYLISTS: 'playlists',
  FOLDERS: 'folders',
  CREDITS: 'credits',
};

export const PLAYER_SEARCH_TYPE_TABS = [
  { id: PLAYER_SEARCH_TYPES.ALL, label: 'All' },
  { id: PLAYER_SEARCH_TYPES.SHOWS, label: 'Shows' },
  { id: PLAYER_SEARCH_TYPES.SONGS, label: 'Songs' },
  { id: PLAYER_SEARCH_TYPES.MIXES, label: 'Mixes' },
  { id: PLAYER_SEARCH_TYPES.PLAYLISTS, label: 'Playlists' },
  { id: PLAYER_SEARCH_TYPES.FOLDERS, label: 'Folders' },
  { id: PLAYER_SEARCH_TYPES.CREDITS, label: 'Credits' },
];

export const PLAYER_SEARCH_TYPE_LABELS = {
  show: 'Show',
  song: 'Song',
  mix: 'Mix',
  playlist: 'Playlist',
  folder: 'Folder',
  credit: 'Credits',
  role: 'Role',
};

export const CREDIT_ROLE_SEARCH = [
  { key: 'primary_artist', label: 'Primary artist', aliases: ['primary artist', 'lead artist'] },
  { key: 'featured_artist', label: 'Featured artist', aliases: ['featured artist', 'featured'] },
  { key: 'ensemble', label: 'Ensemble', aliases: ['ensemble'] },
  { key: 'conductor', label: 'Conductor', aliases: ['conductor'] },
  { key: 'arranger_artist', label: 'Arranger artist', aliases: ['arranger artist'] },
  { key: 'composer', label: 'Composer', aliases: ['composer', 'composed', 'composition'] },
  { key: 'lyricist', label: 'Lyricist', aliases: ['lyricist', 'lyrics', 'lyric', 'lyrics writer', 'lyric writer'] },
  { key: 'writer', label: 'Writer', aliases: ['writer'] },
  { key: 'arranger', label: 'Arranger', aliases: ['arranger'] },
  { key: 'translator', label: 'Translator', aliases: ['translator'] },
  { key: 'original_writer', label: 'Original writer', aliases: ['original writer'] },
  { key: 'producer', label: 'Producer', aliases: ['producer'] },
  { key: 'executive_producer', label: 'Executive producer', aliases: ['executive producer'] },
  { key: 'recording_engineer', label: 'Recording engineer', aliases: ['recording engineer', 'recording'] },
  { key: 'mixing_engineer', label: 'Mixing engineer', aliases: ['mixing engineer', 'mixing'] },
  { key: 'mastering_engineer', label: 'Mastering engineer', aliases: ['mastering engineer', 'mastering'] },
  { key: 'editor', label: 'Editor', aliases: ['editor'] },
  { key: 'sound_designer', label: 'Sound designer', aliases: ['sound designer'] },
  { key: 'performer', label: 'Performer', aliases: ['performer', 'performers', 'performance', 'music performer', 'played', 'playing'] },
  { key: 'show_producer', label: 'Show producer', aliases: ['show producer'] },
];

const ROLE_BY_KEY = Object.fromEntries(CREDIT_ROLE_SEARCH.map((role) => [role.key, role]));
const RELATED_ROLE_KEYS = {
  producer: ['producer', 'show_producer', 'executive_producer'],
  show_producer: ['show_producer', 'producer'],
  arranger: ['arranger', 'arranger_artist'],
  arranger_artist: ['arranger_artist', 'arranger'],
};

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueStrings(values) {
  const seen = new Set();
  const next = [];
  (values || []).forEach((value) => {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    next.push(text);
  });
  return next;
}

function tokenize(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function unwrapQuotedValue(raw) {
  const text = String(raw || '').trim();
  const quoted = text.match(/^"(.*)"$/);
  return quoted ? quoted[1] : text;
}

function findRoleByToken(token) {
  const needle = normalizeSearchText(token);
  if (!needle) return null;
  return CREDIT_ROLE_SEARCH.find((role) => (
    role.key === needle
    || normalizeSearchText(role.label) === needle
    || (role.aliases || []).some((alias) => normalizeSearchText(alias) === needle)
  )) || null;
}

function findRolesMatchingPrefix(draft) {
  const needle = normalizeSearchText(draft);
  if (!needle) return [];
  return CREDIT_ROLE_SEARCH.filter((role) => {
    const haystacks = [role.key, role.label, ...(role.aliases || [])].map(normalizeSearchText);
    return haystacks.some((hay) => hay.startsWith(needle) || hay.includes(needle));
  });
}

export function expandCreditRoleKeys(roleKeys = []) {
  const expanded = new Set();
  roleKeys.forEach((key) => {
    const normalized = normalizeSearchText(key);
    if (!normalized) return;
    expanded.add(normalized);
    (RELATED_ROLE_KEYS[normalized] || []).forEach((related) => expanded.add(related));
  });
  return [...expanded];
}

export function parsePlayerSearchQuery(raw) {
  const text = String(raw || '').trim();
  const filters = [];
  let working = text;

  const phraseAliases = CREDIT_ROLE_SEARCH
    .flatMap((role) => [role.label, role.key, ...(role.aliases || [])].map((alias) => ({
      role,
      alias: normalizeSearchText(alias),
    })))
    .filter((entry) => entry.alias.includes(' '))
    .sort((left, right) => right.alias.length - left.alias.length);

  phraseAliases.forEach((entry) => {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(entry.alias)}(?=\\s|:|$)`, 'i');
    if (pattern.test(working)) {
      filters.push({ key: entry.role.key, roleKey: entry.role.key, value: '' });
      working = working.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    }
  });

  const leftover = [];
  const tokens = working ? working.split(/\s+/) : [];

  tokens.forEach((token) => {
    const match = token.match(/^([a-z_]+):(.*)$/i);
    if (!match) {
      leftover.push(token);
      return;
    }
    const key = normalizeSearchText(match[1]);
    const value = unwrapQuotedValue(match[2]);
    if (key === 'role') {
      const role = findRoleByToken(value) || (value ? { key: normalizeSearchText(value) } : null);
      if (role?.key) {
        filters.push({ key: 'role', roleKey: role.key, value: '' });
        return;
      }
    }
    const role = findRoleByToken(key);
    if (role) {
      filters.push({ key: role.key, roleKey: role.key, value });
      return;
    }
    leftover.push(token);
  });

  const terms = [];
  const roleKeys = uniqueStrings(filters.map((filter) => filter.roleKey).filter(Boolean));
  leftover.forEach((token) => {
    const role = findRoleByToken(token);
    if (role && leftover.length > 1) {
      roleKeys.push(role.key);
      return;
    }
    terms.push(token);
  });

  filters.forEach((filter) => {
    if (filter.value) terms.push(filter.value);
  });

  const uniqueTerms = uniqueStrings(terms.map((term) => String(term || '').trim()).filter(Boolean));
  const uniqueRoleKeys = uniqueStrings(roleKeys);
  const leftoverTerms = uniqueStrings(leftover.map((token) => String(token || '').trim()).filter(Boolean));

  return {
    raw: text,
    terms: uniqueTerms,
    catalogTerms: uniqueRoleKeys.length ? uniqueTerms : (leftoverTerms.length ? leftoverTerms : uniqueTerms),
    roleKeys: uniqueRoleKeys,
    filters,
    empty: !text,
  };
}

export function scoreTextMatch(haystack, terms = []) {
  if (!terms.length) return 1;
  const hay = normalizeSearchText(haystack);
  if (!hay) return 0;
  let score = 0;
  for (const term of terms) {
    const needle = normalizeSearchText(term);
    if (!needle) continue;
    if (hay === needle) {
      score += 100;
      continue;
    }
    if (hay.startsWith(needle)) {
      score += 80;
      continue;
    }
    const wordStart = new RegExp(`(?:^|\\s|[\\-_/.,])${escapeRegExp(needle)}`);
    if (wordStart.test(hay)) {
      score += 60;
      continue;
    }
    if (hay.includes(needle)) {
      score += 40;
      continue;
    }
    return 0;
  }
  return score;
}

function songTitle(song) {
  const number = String(song?.musicalNumber || '').trim();
  const name = String(song?.projectName || song?.name || 'Untitled').trim();
  return number ? `${number} - ${name}` : name;
}

export function buildPlayerSearchItems({
  shows = [],
  songs = [],
  mixes = [],
  playlists = [],
  folders = [],
} = {}) {
  const items = [];
  shows.forEach((show) => {
    const title = String(show?.name || 'Untitled show');
    items.push({
      id: `show:${show.id}`,
      type: 'show',
      title,
      subtitle: `${(show.mixes || []).length} song${(show.mixes || []).length === 1 ? '' : 's'}`,
      haystack: title,
      payload: show,
    });
  });
  songs.forEach((song) => {
    const title = songTitle(song);
    const subtitle = String(song?.showName || '').trim();
    items.push({
      id: `song:${song.projectId || song.id}`,
      type: 'song',
      title,
      subtitle,
      haystack: [title, song?.name, song?.projectName, song?.musicalNumber, subtitle].filter(Boolean).join(' '),
      payload: song,
    });
  });
  mixes.forEach((mix) => {
    const title = String(mix?.name || mix?.projectName || 'Untitled mix');
    const subtitle = [songTitle(mix), mix?.showName].filter(Boolean).join(' · ');
    items.push({
      id: `mix:${mix.id}`,
      type: 'mix',
      title,
      subtitle: subtitle || 'Mix',
      haystack: [title, mix?.projectName, mix?.name, mix?.musicalNumber, mix?.showName].filter(Boolean).join(' '),
      payload: mix,
    });
  });
  playlists.forEach((playlist) => {
    const title = String(playlist?.name || 'Untitled playlist');
    items.push({
      id: `playlist:${playlist.id}`,
      type: 'playlist',
      title,
      subtitle: 'Playlist',
      haystack: title,
      payload: playlist,
    });
  });
  folders.forEach((folder) => {
    const title = String(folder?.name || 'Untitled folder');
    items.push({
      id: `folder:${folder.id}`,
      type: 'folder',
      title,
      subtitle: 'Folder',
      haystack: title,
      payload: folder,
    });
  });
  return items;
}

function creditHaystack(credit) {
  return [
    credit?.name,
    credit?.groupType,
    ...(credit?.involvements || []).flatMap((row) => [
      row.roleLabel,
      row.roleKey,
      row.projectName,
      row.musicalNumber,
      row.showName,
      row.contributionLabel,
    ]),
  ].filter(Boolean).join(' ');
}

function creditMatchesQuery(credit, parsed) {
  const roleKeys = expandCreditRoleKeys(parsed.roleKeys);
  const involvements = Array.isArray(credit?.involvements) ? credit.involvements : [];
  const scopedInvolvements = roleKeys.length
    ? involvements.filter((row) => roleKeys.includes(normalizeSearchText(row.roleKey)))
    : involvements;
  if (roleKeys.length && !scopedInvolvements.length) return null;

  const nameScore = scoreTextMatch(credit?.name, parsed.terms);
  if (parsed.terms.length && nameScore <= 0) {
    const scopedHay = scopedInvolvements.map((row) => [
      row.roleLabel,
      row.projectName,
      row.musicalNumber,
      row.showName,
      row.contributionLabel,
    ].filter(Boolean).join(' ')).join(' ');
    const fallback = scoreTextMatch(`${credit?.name || ''} ${scopedHay}`, parsed.terms);
    if (fallback <= 0) return null;
    return {
      ...credit,
      involvements: scopedInvolvements,
      score: fallback + 8,
    };
  }

  const roleBoost = roleKeys.length ? 12 : 0;
  const specificRole = roleKeys.length === 1
    ? (ROLE_BY_KEY[roleKeys[0]] || scopedInvolvements[0] || null)
    : null;
  return {
    ...credit,
    involvements: scopedInvolvements,
    score: (nameScore || 1) + roleBoost + Math.min(scopedInvolvements.length, 8),
    matchedRoleLabel: specificRole?.label || specificRole?.roleLabel || '',
  };
}

function compareResults(left, right) {
  if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0);
  return String(left.title || '').localeCompare(String(right.title || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function searchPlayerCatalog(items, parsed, credits = []) {
  const catalogTerms = parsed.empty
    ? []
    : (parsed.catalogTerms.length ? parsed.catalogTerms : parsed.terms);
  const matchedItems = (parsed.empty || !catalogTerms.length ? [] : items)
    .map((item) => {
      const score = scoreTextMatch(item.haystack, catalogTerms);
      if (score <= 0) return null;
      return { ...item, score };
    })
    .filter(Boolean)
    .sort(compareResults);

  const matchedCredits = (parsed.empty ? [] : credits)
    .map((credit) => creditMatchesQuery(credit, parsed))
    .filter(Boolean)
    .map((credit) => {
      const roleLabel = credit.matchedRoleLabel
        || uniqueStrings((credit.involvements || []).map((row) => row.roleLabel)).slice(0, 3).join(' · ');
      return {
        id: `credit:${credit.artistKey || `${credit.artistType}:${credit.artistId}`}`,
        type: 'credit',
        title: credit.name,
        subtitle: roleLabel || (credit.artistType === 'group' ? 'Group' : 'Person'),
        haystack: creditHaystack(credit),
        payload: credit,
        score: credit.score,
      };
    })
    .sort(compareResults);

  const byType = {
    shows: matchedItems.filter((item) => item.type === 'show'),
    songs: matchedItems.filter((item) => item.type === 'song'),
    mixes: matchedItems.filter((item) => item.type === 'mix'),
    playlists: matchedItems.filter((item) => item.type === 'playlist'),
    folders: matchedItems.filter((item) => item.type === 'folder'),
    credits: matchedCredits,
  };
  const all = [...matchedItems, ...matchedCredits].sort(compareResults);
  return {
    byType,
    all,
    topResult: all[0] || null,
    total: all.length,
  };
}

export function filterResultsByType(results, type = PLAYER_SEARCH_TYPES.ALL) {
  if (!results) {
    return {
      byType: { shows: [], songs: [], mixes: [], playlists: [], folders: [], credits: [] },
      all: [],
      topResult: null,
      total: 0,
    };
  }
  if (!type || type === PLAYER_SEARCH_TYPES.ALL) return results;
  const key = type;
  const list = results.byType?.[key] || [];
  return {
    ...results,
    all: list,
    topResult: list[0] || null,
    total: list.length,
  };
}

export function buildSearchSuggestions(parsed, results, { limit = 8 } = {}) {
  if (parsed.empty) return [];
  const suggestions = [];
  const seen = new Set();
  const push = (suggestion) => {
    if (!suggestion?.id || seen.has(suggestion.id) || suggestions.length >= limit) return;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  };

  push({
    id: `query:${parsed.raw}`,
    type: 'query',
    title: parsed.raw,
    subtitle: 'Search',
    payload: { query: parsed.raw },
    score: Number.POSITIVE_INFINITY,
  });

  if (!parsed.terms.length || parsed.roleKeys.length === 0) {
    findRolesMatchingPrefix(parsed.raw).slice(0, 3).forEach((role) => {
      push({
        id: `role:${role.key}`,
        type: 'role',
        title: role.label,
        subtitle: 'Role',
        payload: role,
        score: 90,
      });
    });
  }

  (results?.all || []).forEach((item) => push(item));
  return suggestions.slice(0, limit);
}

export function applyRoleToQuery(raw, role) {
  const parsed = parsePlayerSearchQuery(raw);
  const remaining = parsed.terms.filter((term) => normalizeSearchText(term) !== normalizeSearchText(role?.label)
    && normalizeSearchText(term) !== normalizeSearchText(role?.key)
    && !(role?.aliases || []).some((alias) => normalizeSearchText(alias) === normalizeSearchText(term)));
  const nextTerms = remaining.join(' ');
  return nextTerms ? `${role.key}:${nextTerms}` : `${role.key}:`;
}

export function creditRoleLabel(roleKey) {
  return ROLE_BY_KEY[normalizeSearchText(roleKey)]?.label || String(roleKey || '');
}
