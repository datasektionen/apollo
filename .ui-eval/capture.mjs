import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function resolvePlaywrightEntry() {
  const candidates = [
    path.resolve(process.cwd(), '.ui-eval/node_modules/playwright-core/index.mjs'),
  ];
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
    const primaryRoot = path.resolve(gitCommonDir, '..');
    candidates.push(path.join(primaryRoot, '.ui-eval/node_modules/playwright-core/index.mjs'));
  } catch {
    // Fallback below if git is unavailable
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`playwright-core not found. Run 'npm --prefix .ui-eval install' first. Checked: ${candidates.join(', ')}`);
  }
  return pathToFileURL(found).href;
}

const { chromium } = await import(resolvePlaywrightEntry());

const BASE_URL = process.env.APOLLO_URL || 'https://localhost:3000';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGET_DIR_NAME = process.argv[2] || 'current';
const OUTPUT_DIR = path.resolve(process.cwd(), '.ui-eval', TARGET_DIR_NAME);

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

function createSilentWavBuffer(durationSec = 1, sampleRate = 44100, channels = 2) {
  const frameCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataByteLength = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataByteLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);
  return buffer;
}

const SILENT_WAV = createSilentWavBuffer(1);

function createFixtureData() {
  const showId = 'show-metaspexet-2026';
  const showName = 'METAspexet 2026';

  const tuttiMixes = [
    {
      id: 'tutti:proj-01',
      projectId: 'proj-01',
      name: 'Prince Ali',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '0.0',
      sceneOrder: 1,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 169000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-02',
      projectId: 'proj-02',
      name: 'TestSong',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '0.0',
      sceneOrder: 2,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 8000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-03',
      projectId: 'proj-03',
      name: "I've Got a Dream",
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '2.0',
      sceneOrder: 3,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 186000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-04',
      projectId: 'proj-04',
      name: 'This Jesus Must Die',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '5.0',
      sceneOrder: 4,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 214000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-05',
      projectId: 'proj-05',
      name: 'The Pitch',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '7.0',
      sceneOrder: 5,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 150000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-06',
      projectId: 'proj-06',
      name: 'Dumb Ways to Die',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '7.1',
      sceneOrder: 6,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 45000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-07',
      projectId: 'proj-07',
      name: "Gangsta's Paradise",
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '8.1',
      sceneOrder: 7,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 159000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
    {
      id: 'tutti:proj-08',
      projectId: 'proj-08',
      name: 'Worrying Kind',
      presetId: 'tutti',
      presetVariantKey: null,
      published: true,
      musicalNumber: '10.0',
      sceneOrder: 8,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 230000,
      canWrite: true,
      canCreateMixes: true,
      canListenTutti: true,
    },
  ];

  const playlistMixes = [
    {
      id: 'mix-pl-1',
      ownerUserId: 'user-johan',
      projectId: 'proj-03',
      name: "2.0 - I've Got a Dream - Tenor",
      presetId: 'choir_parts',
      presetVariantKey: 'track:track-tenor',
      advancedMix: {},
      visibility: 'private',
      folderId: null,
      createdAt: '2026-03-05T10:00:00Z',
      updatedAt: '2026-03-18T10:00:00Z',
      projectName: "I've Got a Dream",
      musicalNumber: '2.0',
      sceneOrder: 3,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 186000,
      canRead: true,
      canWrite: true,
      canCreateMixes: true,
    },
    {
      id: 'mix-pl-2',
      ownerUserId: 'user-johan',
      projectId: 'proj-04',
      name: '5.0 - This Jesus Must Die - Tenor',
      presetId: 'choir_parts',
      presetVariantKey: 'track:track-tenor',
      advancedMix: {},
      visibility: 'private',
      folderId: null,
      createdAt: '2026-03-04T10:00:00Z',
      updatedAt: '2026-03-17T10:00:00Z',
      projectName: 'This Jesus Must Die',
      musicalNumber: '5.0',
      sceneOrder: 4,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 214000,
      canRead: true,
      canWrite: true,
      canCreateMixes: true,
    },
    {
      id: 'mix-pl-3',
      ownerUserId: 'user-johan',
      projectId: 'proj-06',
      name: '7.1 - Dumb Ways to Die - Johan',
      presetId: 'choir_parts',
      presetVariantKey: 'track:track-tenor',
      advancedMix: {},
      visibility: 'private',
      folderId: null,
      createdAt: '2026-03-03T10:00:00Z',
      updatedAt: '2026-03-16T10:00:00Z',
      projectName: 'Dumb Ways to Die',
      musicalNumber: '7.1',
      sceneOrder: 6,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 45000,
      canRead: true,
      canWrite: true,
      canCreateMixes: true,
    },
    {
      id: 'mix-pl-4',
      ownerUserId: 'user-johan',
      projectId: 'proj-08',
      name: '10.0 - Worrying Kind - Tutti',
      presetId: 'tutti',
      presetVariantKey: null,
      advancedMix: {},
      visibility: 'private',
      folderId: null,
      createdAt: '2026-03-02T10:00:00Z',
      updatedAt: '2026-03-15T10:00:00Z',
      projectName: 'Worrying Kind',
      musicalNumber: '10.0',
      sceneOrder: 8,
      showId,
      showName,
      showOrderIndex: 1,
      durationMs: 230000,
      canRead: true,
      canWrite: true,
      canCreateMixes: true,
    },
  ];

  const rootMix = {
    id: 'mix-root-1',
    ownerUserId: 'user-johan',
    projectId: 'proj-06',
    name: '7.1 - Dumb Ways to Die - Johan',
    presetId: 'choir_parts',
    presetVariantKey: 'track:track-tenor',
    advancedMix: {},
    visibility: 'private',
    folderId: null,
    createdAt: '2026-03-03T09:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
    projectName: 'Dumb Ways to Die',
    musicalNumber: '7.1',
    sceneOrder: 6,
    showId,
    showName,
    showOrderIndex: 1,
    durationMs: 45000,
    canRead: true,
    canWrite: true,
    canCreateMixes: true,
  };

  const folders = [
    {
      id: 'folder-1',
      ownerUserId: 'user-johan',
      name: 'Rehearsal 2026',
      parentFolderId: null,
      orderIndex: 0,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-12T10:00:00Z',
    },
  ];

  const playlists = [
    {
      id: 'pl-1',
      ownerUserId: 'user-johan',
      name: 'Johan Practice 2026',
      folderId: null,
      createdAt: '2026-03-02T10:00:00Z',
      updatedAt: '2026-03-19T10:00:00Z',
    },
  ];

  const playlistItemsByPlaylistId = {
    'pl-1': playlistMixes.map((mix, idx) => ({
      id: `pli-${idx + 1}`,
      playlistId: 'pl-1',
      mixId: mix.id,
      orderIndex: idx,
      createdAt: mix.createdAt,
      unavailable: false,
      mix,
    })),
  };

  const snapshotLyrics = {
    useSyncedLyrics: true,
    lines: [
      { id: 'l-1', text: 'I am malicious, mean and scary', startMs: 0 },
      { id: 'l-2', text: 'My sneer could curdle dairy', startMs: 12000 },
      { id: 'l-3', text: 'And violence-wise, my hands are not the cleanest', startMs: 25000 },
      { id: 'l-4', text: 'But despite my evil look, and my temper, and my hook', startMs: 38000 },
      { id: 'l-5', text: "I've always yearned to be a concert pianist", startMs: 46000 },
      { id: 'l-6', text: "Can't you see me on the stage performing Mozart", startMs: 62000 },
      { id: 'l-7', text: 'Tickling the ivories till they gleam', startMs: 78000 },
      { id: 'l-8', text: "Yes I'd rather be called deadly for my killer show-tune medley", startMs: 96000 },
      { id: 'l-9', text: "Thank you, 'cause way down deep inside I've got a dream", startMs: 118000 },
      { id: 'l-10', text: "I've got a dream, I've got a dream", startMs: 142000 },
    ],
  };

  function makeBootstrap(projectId) {
    const project = tuttiMixes.find((m) => m.projectId === projectId) || tuttiMixes[2];
    const durationMs = project.durationMs || 186000;
    return {
      project: {
        id: project.projectId,
        name: project.name,
        musicalNumber: project.musicalNumber,
        showId,
        showName,
      },
      latestSeq: 1,
      snapshot: {
        projectId: project.projectId,
        projectName: project.name,
        musicalNumber: project.musicalNumber,
        showId,
        showName,
        durationMs,
        masterVolume: 100,
        tracks: [
          {
            id: 'track-metronome',
            name: 'Metronome',
            role: 'metronome',
            muted: false,
            solo: false,
            volume: 80,
            pan: 0,
            clips: [
              {
                id: 'clip-click',
                blobId: 'stub-wav',
                timelineStartMs: 0,
                cropStartMs: 0,
                cropEndMs: durationMs,
                sourceDurationMs: durationMs,
              },
            ],
          },
          {
            id: 'track-tenor',
            name: 'Tenor',
            role: 'choir',
            muted: false,
            solo: false,
            volume: 100,
            pan: 0.25,
            clips: [
              {
                id: 'clip-tenor',
                blobId: 'stub-wav',
                timelineStartMs: 0,
                cropStartMs: 0,
                cropEndMs: durationMs,
                sourceDurationMs: durationMs,
              },
            ],
          },
          {
            id: 'track-band',
            name: 'Band',
            role: 'instrument',
            muted: false,
            solo: false,
            volume: 95,
            pan: -0.25,
            clips: [
              {
                id: 'clip-band',
                blobId: 'stub-wav',
                timelineStartMs: 0,
                cropStartMs: 0,
                cropEndMs: durationMs,
                sourceDurationMs: durationMs,
              },
            ],
          },
        ],
        trackTree: [
          { id: 'node-metro', kind: 'track', parentId: null, order: 0, trackId: 'track-metronome' },
          { id: 'node-tenor', kind: 'track', parentId: null, order: 1, trackId: 'track-tenor' },
          { id: 'node-band', kind: 'track', parentId: null, order: 2, trackId: 'track-band' },
        ],
        lyrics: snapshotLyrics,
      },
      access: {
        compatibility: { canRead: true, canWrite: true },
      },
      purpose: 'player',
      runtimeConfig: { defaultLyricLanguage: 'en' },
    };
  }

  function makeCredits(projectId) {
    const project = tuttiMixes.find((m) => m.projectId === projectId) || tuttiMixes[2];
    return {
      show: {
        id: showId,
        name: showName,
        description: 'Annual student musical theatre production featuring live pit orchestra and full ensemble choir.',
        producers: [{ id: 'art-prod-1', type: 'user', name: 'Johan Lindeberg' }],
      },
      project: {
        id: project.projectId,
        name: project.name,
        musicalNumber: project.musicalNumber,
      },
      credits: {
        artist: [{ roleKey: 'choir', roleLabel: 'Ensemble', artists: [{ id: 'grp-1', type: 'group', name: 'METAspexet Choir & Pit' }] }],
        compositionLyrics: [
          { roleKey: 'composer', roleLabel: 'Music', artists: [{ id: 'art-1', type: 'guest', name: 'Alan Menken' }] },
          { roleKey: 'lyricist', roleLabel: 'Lyrics', artists: [{ id: 'art-2', type: 'guest', name: 'Glenn Slater' }] },
        ],
        productionEngineering: [
          { roleKey: 'mix', roleLabel: 'Mixing & Mastering', artists: [{ id: 'art-3', type: 'user', name: 'Johan Lindeberg' }] },
        ],
        performers: [
          { artist: { id: 'perf-1', type: 'user', name: 'Tenor Section' }, role: 'Tenor', contributionLabel: 'Tenor' },
          { artist: { id: 'perf-2', type: 'user', name: 'Soprano Section' }, role: 'Soprano', contributionLabel: 'Soprano' },
          { artist: { id: 'perf-3', type: 'user', name: 'Alto Section' }, role: 'Alto', contributionLabel: 'Alto' },
          { artist: { id: 'perf-4', type: 'user', name: 'Bass Section' }, role: 'Bass', contributionLabel: 'Bass' },
        ],
      },
      creditRoleOptions: [],
    };
  }

  function makeAdminFixtures() {
    const roles = [
      { id: 'system-role-admin', name: 'Admin', isSystem: true, systemKey: 'admin', memberCount: 2, linkCount: 1 },
      { id: 'system-role-default', name: 'Default User', isSystem: true, systemKey: 'default_user', memberCount: 42, linkCount: 0 },
      { id: 'role-choir', name: 'Choir Singers 2026', isSystem: false, systemKey: null, memberCount: 28, linkCount: 1 },
      { id: 'role-leads', name: 'Soloists & Leads', isSystem: false, systemKey: null, memberCount: 8, linkCount: 1 },
      { id: 'role-prod', name: 'Music Production', isSystem: false, systemKey: null, memberCount: 4, linkCount: 1 },
    ];

    const users = [
      {
        id: 'user-johan',
        username: 'johan',
        oidcDisplayName: 'Johan Lindeberg',
        oidcEmail: 'johan@metaspexet.se',
        isAdmin: true,
        roles: [
          { id: 'role-prod', name: 'Music Production' },
          { id: 'role-choir', name: 'Choir Singers 2026' },
        ],
      },
      {
        id: 'user-astrid',
        username: 'astrid',
        oidcDisplayName: 'Astrid Bergstrom',
        oidcEmail: 'astrid@metaspexet.se',
        isAdmin: false,
        roles: [{ id: 'role-leads', name: 'Soloists & Leads' }],
      },
      {
        id: 'user-oskar',
        username: 'oskar',
        oidcDisplayName: 'Oskar Lindholm',
        oidcEmail: 'oskar@metaspexet.se',
        isAdmin: false,
        roles: [{ id: 'role-choir', name: 'Choir Singers 2026' }],
      },
    ];

    const roleDetails = {
      'role-choir': {
        id: 'role-choir',
        name: 'Choir Singers 2026',
        isSystem: false,
        systemKey: null,
        memberCount: 28,
        linkCount: 1,
        parents: [],
        grants: [
          {
            id: 'grant-choir-1',
            permissionKey: 'track_reader',
            permissionLabel: 'Track reader',
            scopeType: 'show',
            scopeShowId: showId,
            scopeGroupNameValue: 'choir',
            scopeGroupLabel: 'Choir',
            sourceType: 'direct',
          },
          {
            id: 'grant-choir-lyrics',
            permissionKey: 'project_reader',
            permissionLabel: 'Project reader',
            scopeType: 'show',
            scopeShowId: showId,
            sourceType: 'direct',
          },
        ],
        inheritedGrants: [
          {
            id: 'grant-inherited-1',
            permissionKey: 'show_reader',
            permissionLabel: 'Show reader',
            scopeType: 'show',
            scopeShowId: showId,
            sourceType: 'inherited',
            sourceRoleName: 'All users',
          },
        ],
        oidcLinks: [
          { id: 'oidc-1', claimPath: 'groups', claimValue: 'choir-2026', description: 'METAspexet 2026 Choir Members' },
        ],
        members: [
          { id: 'user-johan', username: 'johan', isAdmin: true, source: 'direct' },
          { id: 'user-oskar', username: 'oskar', isAdmin: false, source: 'oidc_link' },
        ],
        childRoles: [],
      },
    };

    const catalog = {
      permissions: [
        { value: 'show_manager', label: 'Show manager' },
        { value: 'show_creator', label: 'Show creator' },
        { value: 'show_reader', label: 'Show reader' },
        { value: 'project_manager', label: 'Project manager' },
        { value: 'project_reader', label: 'Project reader' },
        { value: 'track_manager', label: 'Track manager' },
        { value: 'track_reader', label: 'Track reader' },
      ],
      shows: [
        { id: showId, name: showName, projectCount: 8, publishedProjectCount: 8 },
        { id: 'show-metaspexet-2025', name: 'METAspexet 2025', projectCount: 6, publishedProjectCount: 6 },
      ],
      projects: tuttiMixes.map((m) => ({
        id: m.projectId,
        showId,
        name: m.name,
        musicalNumber: m.musicalNumber,
      })),
      tracks: [],
      groupNames: [
        { value: 'choir', label: 'Choir' },
        { value: 'leads', label: 'Leads' },
        { value: 'instruments', label: 'Instruments' },
      ],
      partNames: [
        { value: 'tenor', label: 'Tenor' },
        { value: 'soprano', label: 'Soprano' },
        { value: 'alto', label: 'Alto' },
        { value: 'bass', label: 'Bass' },
      ],
    };

    const artists = {
      users: [
        { id: 'art-u-1', name: 'Johan Lindeberg', description: 'Choir conductor & lead Tenor arranger' },
        { id: 'art-u-2', name: 'Astrid Bergstrom', description: 'Vocal coach and Soprano lead' },
      ],
      groups: [
        { id: 'art-g-1', name: 'METAspexet Choir & Pit', groupType: 'Ensemble', description: 'Main stage vocal & orchestra ensemble' },
      ],
      guests: [
        { id: 'art-x-1', name: 'Alan Menken', description: 'Original score composer' },
      ],
    };

    const storage = {
      summary: {
        mediaBytes: 18_420_000_000,
        databaseBytes: 1_240_000_000,
        quarantineBytes: 2_380_000_000,
        sameFilesystem: true,
        volume: {
          totalBytes: 64_000_000_000,
          usedBytes: 26_500_000_000,
          availableBytes: 37_500_000_000,
        },
      },
      items: [
        {
          id: 'media-1',
          fileName: '02_ive_got_a_dream_tenor_master.flac',
          sha256: '9f8e7d6c5b4a3210fedcba9876543210',
          mimeType: 'audio/flac',
          sizeBytes: 94_200_000,
          projectCount: 1,
          projectNames: ["2.0 - I've Got a Dream"],
          clipCount: 4,
          createdByUsername: 'johan',
          createdAt: '2026-03-04T14:22:00Z',
          unreferencedAt: null,
          quarantinedByUsername: null,
          status: 'in_use',
        },
        {
          id: 'media-2',
          fileName: '05_this_jesus_must_die_orchestra.wav',
          sha256: '4a5b6c7d8e9f00112233445566778899',
          mimeType: 'audio/wav',
          sizeBytes: 186_400_000,
          projectCount: 1,
          projectNames: ['5.0 - This Jesus Must Die'],
          clipCount: 6,
          createdByUsername: 'johan',
          createdAt: '2026-03-05T19:10:00Z',
          unreferencedAt: null,
          quarantinedByUsername: null,
          status: 'in_use',
        },
        {
          id: 'media-3',
          fileName: 'rehearsal_take_unused_old_mix.wav',
          sha256: '7c8d9e0f1a2b3c4d5e6f708192a3b4c5',
          mimeType: 'audio/wav',
          sizeBytes: 68_900_000,
          projectCount: 0,
          projectNames: [],
          clipCount: 0,
          createdByUsername: 'astrid',
          createdAt: '2026-02-20T11:05:00Z',
          unreferencedAt: '2026-03-10T08:30:00Z',
          quarantinedByUsername: 'johan',
          status: 'quarantine',
        },
      ],
    };

    return { roles, users, roleDetails, catalog, artists, storage };
  }

  return {
    showId,
    showName,
    tuttiMixes,
    playlists,
    folders,
    playlistItemsByPlaylistId,
    mixes: [...playlistMixes, rootMix],
    makeBootstrap,
    makeCredits,
    admin: makeAdminFixtures(),
  };
}

async function installApiMocks(page, fixtures) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p === '/api/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'user-johan',
            username: 'johan',
            artistDisplayName: 'Johan',
            oidcDisplayName: 'Johan Lindeberg',
            isAdmin: true,
          },
          accessSummary: {},
        }),
      });
    }

    if (p === '/api/version') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '1.0.0',
          minSupportedVersion: '1.0.0',
          minSupportedNativeBuild: 1,
          apkUrl: '/apollo.apk',
          releaseNotes: '',
          serverTime: '2026-11-19T18:00:00Z',
        }),
      });
    }

    if (p === '/api/shows') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shows: [{ id: fixtures.showId, name: fixtures.showName, orderIndex: 1, canSeeShow: true }],
        }),
      });
    }

    if (p === '/api/projects') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: fixtures.tuttiMixes.map((m) => ({
            id: m.projectId,
            name: m.name,
            musicalNumber: m.musicalNumber,
            showId: fixtures.showId,
            showName: fixtures.showName,
          })),
        }),
      });
    }

    if (p === '/api/player/my-device') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folders: fixtures.folders,
          playlists: fixtures.playlists,
          playlistItemsByPlaylistId: fixtures.playlistItemsByPlaylistId,
          mixes: fixtures.mixes,
        }),
      });
    }

    if (p === '/api/player/tutti') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mixes: fixtures.tuttiMixes }),
      });
    }

    if (p === '/api/player/mixes/global') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mixes: [] }),
      });
    }

    if (p === '/api/player/search/credits') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credits: [] }),
      });
    }

    const bootstrapMatch = p.match(/^\/api\/projects\/([^/]+)\/bootstrap$/);
    if (bootstrapMatch) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtures.makeBootstrap(decodeURIComponent(bootstrapMatch[1]))),
      });
    }

    const creditsMatch = p.match(/^\/api\/projects\/([^/]+)\/credits$/);
    if (creditsMatch) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtures.makeCredits(decodeURIComponent(creditsMatch[1]))),
      });
    }

    if (p.startsWith('/api/media/')) {
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: SILENT_WAV,
      });
    }

    if (p === '/api/admin/roles') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ roles: fixtures.admin.roles }),
      });
    }

    const roleDetailMatch = p.match(/^\/api\/admin\/roles\/([^/]+)$/);
    if (roleDetailMatch) {
      const roleId = decodeURIComponent(roleDetailMatch[1]);
      const detail = fixtures.admin.roleDetails[roleId] || {
        ...(fixtures.admin.roles.find((r) => r.id === roleId) || fixtures.admin.roles[2]),
        parents: [],
        grants: [],
        inheritedGrants: [],
        oidcLinks: [],
        members: [],
        childRoles: [],
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ role: detail }),
      });
    }

    if (p === '/api/admin/users') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: fixtures.admin.users }),
      });
    }

    if (p === '/api/admin/rbac/catalog') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtures.admin.catalog),
      });
    }

    if (p === '/api/admin/artists') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtures.admin.artists),
      });
    }

    if (p === '/api/admin/storage') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtures.admin.storage),
      });
    }

    if (p === '/api/admin/shows/config') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shows: fixtures.admin.catalog.shows,
          settings: { defaultShowId: fixtures.showId, splitPlayerDawDefaults: false },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function waitForStableRender(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(180);
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw new Error(`Invalid PNG signature for ${filePath}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function captureDesktop(browser, fixtures, errors) {
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[desktop console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[desktop pageerror] ${err.message}`);
  });

  await installApiMocks(page, fixtures);
  await page.addInitScript(() => {
    localStorage.setItem('apollo.playerControlsSidebar', JSON.stringify({
      mode: 'default',
      width: 240,
      playbackSpeed: 1,
      playbackTranspose: 0,
      lastPlaybackTranspose: 1,
    }));
    localStorage.setItem('apollo.playerLibrarySidebar', JSON.stringify({
      mode: 'default',
      width: 280,
      sort: 'latest',
      sortReversed: false,
    }));
  });

  await page.goto(`${BASE_URL}/player`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=METAspexet 2026');
  await waitForStableRender(page);

  const homePath = path.join(OUTPUT_DIR, 'home-desktop.png');
  await page.screenshot({ path: homePath, type: 'png', fullPage: false });

  // Playlist view
  await page.getByRole('button', { name: /Johan Practice 2026/i }).first().click();
  await page.waitForSelector("text=2.0 - I've Got a Dream - Tenor");
  await waitForStableRender(page);

  const playlistPath = path.join(OUTPUT_DIR, 'playlist-desktop.png');
  await page.screenshot({ path: playlistPath, type: 'png', fullPage: false });

  // Song focus / Lyrics view: trigger playback on playlist row, wait until loaded, pause, seek via lyric click, open lyrics
  const songTitleLocator = page.locator("text=2.0 - I've Got a Dream - Tenor").first();
  await songTitleLocator.dblclick();

  await page.waitForFunction(() => {
    const lyricsBtn = document.querySelector('button[title="Lyrics"][aria-label="Lyrics"]');
    const pauseBtn = document.querySelector('button[title="Pause"]');
    return Boolean(lyricsBtn && !lyricsBtn.disabled && pauseBtn);
  }, { timeout: 15000 });

  // Dismiss LoadProgressDialog ("Audio ready") if it opened on cold stem fetch
  const desktopCloseProgress = page.locator('[aria-labelledby="play-progress-title"] button[aria-label="Close"]');
  if (await desktopCloseProgress.count()) {
    await desktopCloseProgress.first().click();
  }

  // Pause so timeline stays completely deterministic at 0:46
  await page.locator('button[title="Pause"]').first().click();
  await page.waitForSelector('button[title="Play"]');

  // Open lyrics view
  await page.locator('button[title="Lyrics"][aria-label="Lyrics"]').click();
  await page.waitForSelector('[aria-label="Lyrics lines"]');

  // Click line starting at 46000ms to seek and highlight mid-song lyric cleanly
  await page.locator('[data-lyric-id="l-5"]').click();
  await page.waitForTimeout(350);
  await waitForStableRender(page);

  const songPath = path.join(OUTPUT_DIR, 'song-desktop.png');
  await page.screenshot({ path: songPath, type: 'png', fullPage: false });

  // Submenu & context popup capture on expanded desktop
  await page.getByRole('button', { name: 'Johan Practice 2026' }).first().click({ button: 'right' });
  await page.waitForSelector('text=Move to folder');
  await page.locator('button:has-text("Move to folder")').hover();
  await page.waitForSelector('text=New folder');
  await waitForStableRender(page);

  const submenuPath = path.join(OUTPUT_DIR, 'submenu-desktop.png');
  await page.screenshot({ path: submenuPath, type: 'png', fullPage: false });
  await page.mouse.click(720, 450);

  // Overlays & collapsed hover tooltip + open user menu capture
  await page.getByRole('button', { name: 'Collapse Your Library' }).click();
  await page.waitForSelector('button[aria-label="Expand Your Library"]');
  await page.locator('button[title="User menu"]').click();
  await page.waitForSelector('text=My Profile');
  await page.locator('button[aria-label*="Johan Practice 2026"]').first().hover();
  await page.waitForSelector('body > div.player-theme.player-menu:has-text("Johan Practice 2026")');
  await waitForStableRender(page);

  const overlaysPath = path.join(OUTPUT_DIR, 'overlays-desktop.png');
  await page.screenshot({ path: overlaysPath, type: 'png', fullPage: false });

  // /download editorial page
  await page.goto(`${BASE_URL}/download`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Desktop');
  await waitForStableRender(page);

  const downloadPath = path.join(OUTPUT_DIR, 'download-desktop.png');
  await page.screenshot({ path: downloadPath, type: 'png', fullPage: false });

  // /admin Roles detail view
  await page.goto(`${BASE_URL}/admin/roles/role-choir`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Track reader');
  await waitForStableRender(page);

  const adminRolesPath = path.join(OUTPUT_DIR, 'admin-roles-desktop.png');
  await page.screenshot({ path: adminRolesPath, type: 'png', fullPage: false });

  // /admin Storage view
  await page.goto(`${BASE_URL}/admin/storage`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=02_ive_got_a_dream_tenor_master.flac');
  await waitForStableRender(page);

  const adminStoragePath = path.join(OUTPUT_DIR, 'admin-storage-desktop.png');
  await page.screenshot({ path: adminStoragePath, type: 'png', fullPage: false });

  await context.close();
  return [homePath, playlistPath, songPath, overlaysPath, submenuPath, downloadPath, adminRolesPath, adminStoragePath];
}

async function captureMobile(browser, fixtures, errors) {
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[mobile console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[mobile pageerror] ${err.message}`);
  });

  await installApiMocks(page, fixtures);
  await page.goto(`${BASE_URL}/player`, { waitUntil: 'networkidle' });
  await page.waitForSelector('nav[aria-label="Mobile Navigation"]');
  await page.waitForSelector("text=I've Got a Dream");

  // Start track 3 so MobileMiniPlayer is visible and active at realistic progress
  await page.locator("text=I've Got a Dream").first().click();
  await page.waitForSelector('[aria-label^="Now playing:"]');
  await page.waitForFunction(() => {
    const mini = document.querySelector('[aria-label^="Now playing:"]');
    return Boolean(mini && mini.querySelector('button[aria-label="Pause"]'));
  }, { timeout: 15000 });

  // Dismiss LoadProgressDialog ("Audio ready") if it opened on cold stem fetch
  const mobileCloseProgress = page.locator('[aria-labelledby="play-progress-title"] button[aria-label="Close"]');
  if (await mobileCloseProgress.count()) {
    await mobileCloseProgress.first().click();
  }

  // Open Now Playing to pause & scrub to ~25% (0:46) deterministically
  await page.locator('[aria-label^="Now playing:"]').click();
  await page.waitForSelector('div[role="dialog"][aria-label="Now Playing"]');
  await page.locator('div[role="dialog"][aria-label="Now Playing"] button[aria-label="Pause"]').click();
  const scrubber = page.locator('input[aria-label="Seek track position"]');
  const box = await scrubber.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  }
  await page.waitForTimeout(200);

  // Close Now Playing for Home Mobile capture (with mini player active!)
  await page.locator('button[aria-label="Collapse player"]').click();
  await waitForStableRender(page);

  const homeMobilePath = path.join(OUTPUT_DIR, 'home-mobile.png');
  await page.screenshot({ path: homeMobilePath, type: 'png', fullPage: false });

  // Playlist Mobile view
  await page.locator('nav[aria-label="Mobile Navigation"] button', { hasText: 'Your Library' }).click();
  await page.waitForSelector('text=Johan Practice 2026');
  await page.locator('text=Johan Practice 2026').first().click();
  await page.waitForSelector("text=2.0 - I've Got a Dream - Tenor");
  await waitForStableRender(page);

  const playlistMobilePath = path.join(OUTPUT_DIR, 'playlist-mobile.png');
  await page.screenshot({ path: playlistMobilePath, type: 'png', fullPage: false });

  // Song Focus Mobile view
  await page.locator('[aria-label^="Now playing:"]').click();
  await page.waitForSelector('div[role="dialog"][aria-label="Now Playing"]');
  await waitForStableRender(page);

  const songMobilePath = path.join(OUTPUT_DIR, 'song-mobile.png');
  await page.screenshot({ path: songMobilePath, type: 'png', fullPage: false });

  // Scrolled Mobile Now Playing showing Choir Practice & Sound Controls (connected clickable icons, zero preset buttons)
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await page.waitForTimeout(350);
  await waitForStableRender(page);

  const controlsMobilePath = path.join(OUTPUT_DIR, 'controls-mobile.png');
  await page.screenshot({ path: controlsMobilePath, type: 'png', fullPage: false });

  // /download mobile view
  await page.goto(`${BASE_URL}/download`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Mobile');
  await waitForStableRender(page);

  const downloadMobilePath = path.join(OUTPUT_DIR, 'download-mobile.png');
  await page.screenshot({ path: downloadMobilePath, type: 'png', fullPage: false });

  // /admin mobile view (Users tab)
  await page.goto(`${BASE_URL}/admin/users`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Choir Singers 2026');
  await waitForStableRender(page);

  const adminMobilePath = path.join(OUTPUT_DIR, 'admin-mobile.png');
  await page.screenshot({ path: adminMobilePath, type: 'png', fullPage: false });

  await context.close();
  return [homeMobilePath, playlistMobilePath, songMobilePath, controlsMobilePath, downloadMobilePath, adminMobilePath];
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fixtures = createFixtureData();
  const errors = [];

  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    channel: fs.existsSync(CHROME_PATH) ? undefined : 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const desktopFiles = await captureDesktop(browser, fixtures, errors);
    const mobileFiles = await captureMobile(browser, fixtures, errors);

    const report = [];
    for (const file of desktopFiles) {
      const dims = readPngDimensions(file);
      if (dims.width !== 2880 || dims.height !== 1800) {
        throw new Error(`Expected 2880x1800 for ${file}, got ${dims.width}x${dims.height}`);
      }
      report.push(`${path.basename(file)}: ${dims.width}x${dims.height}`);
    }
    for (const file of mobileFiles) {
      const dims = readPngDimensions(file);
      if (dims.width !== 780 || dims.height !== 1688) {
        throw new Error(`Expected 780x1688 for ${file}, got ${dims.width}x${dims.height}`);
      }
      report.push(`${path.basename(file)}: ${dims.width}x${dims.height}`);
    }

    if (errors.length > 0) {
      throw new Error(`Console/page errors detected:\n${errors.join('\n')}`);
    }

    console.log(`Captured Retina screenshots to .ui-eval/${TARGET_DIR_NAME}/:\n${report.join('\n')}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
