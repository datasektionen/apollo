import { LYRICS_TRACK_SCOPE_ID } from '../../shared/accessRules.js';

export const ALL_SCOPE_VALUE = '__all__';

export const PERMISSION_HELP = {
  show_manager: 'Full control inside the selected show, including its musical numbers and tracks. Does not create new shows.',
  show_creator: 'Can create new shows. Shows you create become fully manageable by you.',
  show_reader: 'Can only see that a show exists.',
  project_manager: 'Full control of the selected musical numbers and everything inside them.',
  project_creator: 'Can create new musical numbers inside the selected shows.',
  project_reader: 'Can see musical numbers in the DAW dashboard and listen to their tutti mixes, but cannot open them.',
  track_manager: 'Full control of tracks in the selected scope. Selecting Lyrics grants lyric-only editing.',
  track_creator: 'Can create tracks or subtracks in the selected scope. Created tracks become fully manageable by you.',
  track_reader: 'Can open musical numbers in the DAW and create mixes.',
};

export const PERMISSION_COVERAGE = {
  show_manager: ['show_manager', 'show_reader', 'project_manager', 'project_creator', 'project_reader', 'track_manager', 'track_creator', 'track_reader'],
  show_creator: ['show_creator'],
  show_reader: ['show_reader'],
  project_manager: ['project_manager', 'project_reader', 'track_manager', 'track_creator', 'track_reader'],
  project_creator: ['project_creator'],
  project_reader: ['project_reader'],
  track_manager: ['track_manager', 'track_creator', 'track_reader', 'project_reader'],
  track_creator: ['track_creator'],
  track_reader: ['track_reader', 'project_reader'],
};

export const PERMISSION_SCOPE_FLOW = {
  show_manager: ['show'],
  show_creator: [],
  show_reader: ['show'],
  project_manager: ['show', 'project', 'group', 'part'],
  project_creator: ['show'],
  project_reader: ['show', 'project', 'group', 'part'],
  track_manager: ['show', 'project', 'group', 'part', 'track'],
  track_creator: ['show', 'project', 'group', 'part'],
  track_reader: ['show', 'project', 'group', 'part', 'track'],
};

export const SCOPE_COLUMNS = [
  { id: 'show', label: 'Show', flow: 'show' },
  { id: 'project', label: 'Musical number', flow: 'project' },
  { id: 'group', label: 'Group', flow: 'group' },
  { id: 'part', label: 'Part', flow: 'part' },
  { id: 'track', label: 'Track', flow: 'track' },
];

export const ACCESS_TYPE_COLUMNS = [
  { id: 'seeShow', lines: ['See', 'the show'] },
  { id: 'createShows', lines: ['Create', 'shows'] },
  { id: 'createNumbers', lines: ['Create', 'musical', 'numbers'] },
  { id: 'seeNumber', lines: ['See the number', 'and listen', 'to tutti'] },
  { id: 'openDaw', lines: ['Open the', 'number', 'in the DAW'] },
  { id: 'createMixes', lines: ['Create', 'mixes'] },
  { id: 'createTracks', lines: ['Create', 'tracks'] },
  { id: 'editOwn', lines: ['Edit tracks', 'you created'] },
  { id: 'editScope', lines: ['Edit every', 'track in', 'the scope'] },
  { id: 'manageProject', lines: ['Groups, settings,', 'publish', 'and export'] },
  { id: 'solo', lines: ['Solo'] },
];

const yes = (ids) => Object.fromEntries(ACCESS_TYPE_COLUMNS.map((column) => [
  column.id,
  ids.includes(column.id) ? 'yes' : 'no',
]));

export const ACCESS_TYPE_ROWS = [
  { kind: 'group', label: 'Show' },
  {
    kind: 'permission',
    permissionKey: 'show_manager',
    label: 'Show manager',
    cells: yes(['seeShow', 'createNumbers', 'seeNumber', 'openDaw', 'createMixes', 'createTracks', 'editOwn', 'editScope', 'manageProject', 'solo']),
  },
  {
    kind: 'permission',
    permissionKey: 'show_creator',
    label: 'Show creator',
    cells: yes(['createShows']),
  },
  {
    kind: 'permission',
    permissionKey: 'show_reader',
    label: 'Show reader',
    cells: yes(['seeShow']),
  },
  { kind: 'group', label: 'Musical number' },
  {
    kind: 'permission',
    permissionKey: 'project_manager',
    label: 'Project manager',
    cells: yes(['seeShow', 'seeNumber', 'openDaw', 'createMixes', 'createTracks', 'editOwn', 'editScope', 'manageProject', 'solo']),
  },
  {
    kind: 'permission',
    permissionKey: 'project_creator',
    label: 'Project creator',
    cells: yes(['seeShow', 'createNumbers']),
  },
  {
    kind: 'permission',
    permissionKey: 'project_reader',
    label: 'Project reader',
    cells: yes(['seeShow', 'seeNumber']),
  },
  { kind: 'group', label: 'Track' },
  {
    kind: 'permission',
    permissionKey: 'track_manager',
    label: 'Track manager',
    cells: {
      ...yes(['seeShow', 'seeNumber', 'openDaw', 'createMixes', 'createTracks', 'editOwn', 'editScope']),
      solo: 'if-all',
    },
  },
  {
    kind: 'permission',
    permissionKey: 'track_creator',
    label: 'Track creator',
    cells: yes(['seeShow', 'seeNumber', 'openDaw', 'createTracks', 'editOwn']),
  },
  {
    kind: 'permission',
    permissionKey: 'track_reader',
    label: 'Track reader',
    cells: yes(['seeShow', 'seeNumber', 'openDaw', 'createMixes']),
  },
];

function namedValue(active, text) {
  if (!active) return { kind: 'all', text: 'All' };
  return { kind: 'value', text: text || 'Unknown' };
}

export function grantScopeCells(grant = {}, catalog = {}) {
  const flow = PERMISSION_SCOPE_FLOW[grant.permissionKey] || [];
  const applies = (key) => flow.includes(key);
  const shows = catalog.shows || [];
  const projects = catalog.projects || [];
  const tracks = catalog.tracks || [];

  const showName = grant.scopeShowId
    ? (shows.find((show) => show.id === grant.scopeShowId)?.name
      || (grant.scopeType === 'show' ? grant.scopeLabel : '')
      || 'Unknown show')
    : '';
  const project = projects.find((item) => item.id === grant.scopeProjectId);
  const projectName = grant.scopeProjectId
    ? (project
      ? `${project.musicalNumber ? `${project.musicalNumber} - ` : ''}${project.name}`
      : (grant.scopeType === 'project' ? grant.scopeLabel : '')
        || 'Unknown musical number')
    : '';
  const track = tracks.find((item) => item.id === grant.scopeTrackId);
  const trackName = grant.scopeTrackId
    ? (track?.name
      || (grant.scopeType === 'track' && grant.scopeLabel
        ? String(grant.scopeLabel).split(' / ').pop()
        : '')
      || 'Unknown track')
    : '';
  const groupName = grant.scopeGroupNameValue
    ? (grant.scopeGroupLabel || grant.scopeGroupNameValue)
    : '';
  const partName = grant.scopePartNameValue
    ? (grant.scopePartLabel || grant.scopePartNameValue)
    : '';

  const values = {
    show: namedValue(Boolean(grant.scopeShowId), showName),
    project: namedValue(Boolean(grant.scopeProjectId), projectName),
    group: namedValue(Boolean(grant.scopeGroupNameValue), groupName),
    part: namedValue(Boolean(grant.scopePartNameValue), partName),
    track: String(grant.scopeTrackId || '') === LYRICS_TRACK_SCOPE_ID
      ? { kind: 'virtual', text: trackName || 'Lyrics' }
      : namedValue(Boolean(grant.scopeTrackId), trackName),
  };

  return SCOPE_COLUMNS.map((column) => (
    applies(column.flow) ? values[column.id] : { kind: 'na', text: '—' }
  ));
}
