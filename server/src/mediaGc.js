import path from 'path';
import fs from 'fs/promises';

export const MEDIA_GC_LOCK_KEY = 88226401;

function clampHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  const truncated = Math.trunc(hour);
  if (truncated < 0 || truncated > 23) return fallback;
  return truncated;
}

export function getFollowingMediaGcRunAt(now = new Date(), { hour = 4 } = {}) {
  const runHour = clampHour(hour, 4);
  const candidate = new Date(now);
  candidate.setHours(runHour, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

export function collectSnapshotMediaIds(snapshot) {
  const ids = new Set();
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  tracks.forEach((track) => {
    const clips = Array.isArray(track?.clips) ? track.clips : [];
    clips.forEach((clip) => {
      const blobId = typeof clip?.blobId === 'string' ? clip.blobId : null;
      if (blobId) {
        ids.add(blobId);
      }
    });
  });
  return Array.from(ids);
}

export function fileNameFromStoredPath(mediaId, storedPath) {
  const base = path.basename(String(storedPath || ''));
  const prefix = `${mediaId}_`;
  if (base.startsWith(prefix)) {
    return base.slice(prefix.length);
  }
  return base || String(mediaId || 'media');
}

export function computeDeletesAt(unreferencedAt, ttlHours) {
  if (!unreferencedAt) return null;
  const start = new Date(unreferencedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const ttlMs = Math.max(0, Number(ttlHours) || 0) * 60 * 60 * 1000;
  return new Date(start + ttlMs).toISOString();
}

export function classifyMediaStatus({ clipCount = 0, unreferencedAt = null } = {}) {
  if (unreferencedAt) return 'quarantine';
  if (Number(clipCount || 0) > 0) return 'in_use';
  return 'unused';
}

export class MediaGcActionError extends Error {
  constructor(message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'MediaGcActionError';
    this.status = status;
    this.details = details;
  }
}

const LIVE_CLIP_USAGE_SQL = `
  SELECT clip->>'blobId' AS media_id,
         ph.project_id,
         p.name AS project_name
  FROM project_heads ph
  JOIN projects p ON p.id = ph.project_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(ph.latest_snapshot_json->'tracks') = 'array'
      THEN ph.latest_snapshot_json->'tracks'
      ELSE '[]'::jsonb
    END
  ) AS track
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(track->'clips') = 'array'
      THEN track->'clips'
      ELSE '[]'::jsonb
    END
  ) AS clip
  WHERE COALESCE(clip->>'blobId', '') <> ''
`;

export async function refreshMediaUnreferencedAt(client, mediaIds, { quarantinedBy = null } = {}) {
  const ids = Array.from(new Set((mediaIds || []).filter(Boolean)));
  if (!ids.length) return 0;

  await client.query(
    `UPDATE media_objects mo
     SET unreferenced_at = NULL,
         retained = FALSE,
         quarantined_by = NULL
     WHERE mo.id = ANY($1::text[])
       AND EXISTS (
         SELECT 1
         FROM project_media_refs r
         WHERE r.media_id = mo.id
       )`,
    [ids]
  );

  const tombstoned = await client.query(
    `UPDATE media_objects mo
     SET unreferenced_at = NOW(),
         quarantined_by = $2
     WHERE mo.id = ANY($1::text[])
       AND mo.unreferenced_at IS NULL
       AND NOT mo.retained
       AND NOT EXISTS (
         SELECT 1
         FROM project_media_refs r
         WHERE r.media_id = mo.id
       )
     RETURNING mo.id`,
    [ids, quarantinedBy]
  );
  return tombstoned.rowCount;
}

export async function syncProjectMediaRefs(client, projectId, snapshot, { quarantinedBy = null } = {}) {
  const desired = collectSnapshotMediaIds(snapshot);
  const previousResult = await client.query(
    `SELECT media_id AS "mediaId"
     FROM project_media_refs
     WHERE project_id = $1`,
    [projectId]
  );
  const previousIds = previousResult.rows.map((row) => row.mediaId);

  if (desired.length > 0) {
    await client.query(
      `INSERT INTO project_media_refs(project_id, media_id, snapshot_id)
       SELECT $1, m.id, NULL
       FROM unnest($2::text[]) AS t(id)
       JOIN media_objects m ON m.id = t.id
       WHERE m.unreferenced_at IS NULL
       ON CONFLICT (project_id, media_id) DO NOTHING`,
      [projectId, desired]
    );
  }

  await client.query(
    `DELETE FROM project_media_refs
     WHERE project_id = $1
       AND NOT (media_id = ANY($2::text[]))`,
    [projectId, desired]
  );

  const affected = Array.from(new Set([...previousIds, ...desired]));
  return await refreshMediaUnreferencedAt(client, affected, { quarantinedBy });
}

export async function markUnreferencedMedia(client, { attachGraceSeconds = 3600, quarantinedBy = null } = {}) {
  const graceSeconds = Math.max(0, Number(attachGraceSeconds) || 0);
  const result = await client.query(
    `UPDATE media_objects mo
     SET unreferenced_at = NOW(),
         quarantined_by = $2
     WHERE mo.unreferenced_at IS NULL
       AND NOT mo.retained
       AND mo.created_at <= NOW() - ($1::numeric * INTERVAL '1 second')
       AND NOT EXISTS (
         SELECT 1
         FROM project_media_refs r
         WHERE r.media_id = mo.id
       )
     RETURNING mo.id`,
    [graceSeconds, quarantinedBy]
  );
  return result.rowCount;
}

async function getLiveMediaUsage(client, mediaId) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS "clipCount",
            ARRAY_AGG(DISTINCT project_name ORDER BY project_name)
              FILTER (WHERE project_name IS NOT NULL) AS "projectNames"
     FROM (${LIVE_CLIP_USAGE_SQL}) usage
     WHERE usage.media_id = $1`,
    [mediaId]
  );
  const row = result.rows[0] || {};
  return {
    clipCount: Number(row.clipCount || 0),
    projectNames: Array.isArray(row.projectNames) ? row.projectNames.filter(Boolean) : [],
  };
}

async function deleteMediaRows(client, mediaIds) {
  const ids = Array.from(new Set((mediaIds || []).filter(Boolean)));
  if (!ids.length) return [];
  const result = await client.query(
    `DELETE FROM media_objects
     WHERE id = ANY($1::text[])
     RETURNING id, path`,
    [ids]
  );
  return result.rows;
}

async function unlinkDeletedMedia(rows, unlinkFile) {
  await Promise.all((rows || []).map(async (row) => {
    if (!row?.path || typeof unlinkFile !== 'function') return;
    try {
      await unlinkFile(row.path);
    } catch {
      // Best-effort file cleanup after the DB row is gone.
    }
  }));
}

async function withMediaGcLock(db, fn) {
  const client = await db.connect();
  try {
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [MEDIA_GC_LOCK_KEY]
    );
    if (!lockResult.rows[0]?.locked) {
      return { skipped: true };
    }
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MEDIA_GC_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function reconcileAllProjectMediaRefs(db, { attachGraceSeconds = 3600, quarantinedBy = null } = {}) {
  return withMediaGcLock(db, async (client) => {
    const heads = await client.query(
      `SELECT project_id AS "projectId",
              latest_snapshot_json AS snapshot
       FROM project_heads`
    );

    await client.query('BEGIN');
    try {
      let quarantinedCount = 0;
      for (const row of heads.rows) {
        quarantinedCount += Number(await syncProjectMediaRefs(client, row.projectId, row.snapshot, { quarantinedBy }) || 0);
      }
      quarantinedCount += Number(await markUnreferencedMedia(client, { attachGraceSeconds, quarantinedBy }) || 0);
      await client.query('COMMIT');
      return {
        projectCount: heads.rows.length,
        quarantinedCount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function validateUnusedMedia(db, { attachGraceSeconds = 0, quarantinedBy = null } = {}) {
  const result = await reconcileAllProjectMediaRefs(db, { attachGraceSeconds, quarantinedBy });
  if (result?.skipped) {
    throw new MediaGcActionError('Storage maintenance is already running. Try again in a moment.', {
      status: 409,
    });
  }
  return result;
}

export async function quarantineMediaById(db, mediaId, { force = false, quarantinedBy = null } = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const media = await client.query(
      `SELECT id, unreferenced_at AS "unreferencedAt"
       FROM media_objects
       WHERE id = $1
       FOR UPDATE`,
      [mediaId]
    );
    if (media.rowCount === 0) {
      throw new MediaGcActionError('Media not found', { status: 404 });
    }

    const usage = await getLiveMediaUsage(client, mediaId);
    if (usage.clipCount > 0 && !force) {
      throw new MediaGcActionError(
        `That file is still used by ${usage.clipCount} clip${usage.clipCount === 1 ? '' : 's'}.`,
        { status: 409, details: { projectNames: usage.projectNames, clipCount: usage.clipCount } }
      );
    }

    await client.query(
      `DELETE FROM project_media_refs
       WHERE media_id = $1`,
      [mediaId]
    );
    await client.query(
      `UPDATE media_objects
       SET unreferenced_at = COALESCE(unreferenced_at, NOW()),
           retained = FALSE,
           quarantined_by = COALESCE($2, quarantined_by)
       WHERE id = $1`,
      [mediaId, quarantinedBy]
    );
    await client.query('COMMIT');
    return { mediaId, alreadyQuarantined: Boolean(media.rows[0].unreferencedAt) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreMediaById(db, mediaId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const media = await client.query(
      `SELECT id, unreferenced_at AS "unreferencedAt"
       FROM media_objects
       WHERE id = $1
       FOR UPDATE`,
      [mediaId]
    );
    if (media.rowCount === 0) {
      throw new MediaGcActionError('Media not found', { status: 404 });
    }
    if (!media.rows[0].unreferencedAt) {
      await client.query('COMMIT');
      return { mediaId, restored: false, alreadyRestored: true };
    }

    const usage = await getLiveMediaUsage(client, mediaId);
    await client.query(
      `UPDATE media_objects
       SET unreferenced_at = NULL,
           retained = $2,
           quarantined_by = NULL
       WHERE id = $1`,
      [mediaId, usage.clipCount === 0]
    );
    await client.query('COMMIT');
    return { mediaId, restored: true, alreadyRestored: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMediaById(db, mediaId, { unlinkFile = null, force = false } = {}) {
  const client = await db.connect();
  let deletedRows = [];
  try {
    await client.query('BEGIN');
    const media = await client.query(
      `SELECT id
       FROM media_objects
       WHERE id = $1
       FOR UPDATE`,
      [mediaId]
    );
    if (media.rowCount === 0) {
      throw new MediaGcActionError('Media not found', { status: 404 });
    }

    const usage = await getLiveMediaUsage(client, mediaId);
    if (usage.clipCount > 0 && !force) {
      throw new MediaGcActionError(
        `That file is still used by ${usage.clipCount} clip${usage.clipCount === 1 ? '' : 's'}.`,
        { status: 409, details: { projectNames: usage.projectNames, clipCount: usage.clipCount } }
      );
    }

    deletedRows = await deleteMediaRows(client, [mediaId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await unlinkDeletedMedia(deletedRows, unlinkFile);
  return { deletedCount: deletedRows.length };
}

export async function deleteQuarantinedMedia(db, { unlinkFile = null } = {}) {
  const client = await db.connect();
  let deletedRows = [];
  try {
    await client.query('BEGIN');
    const quarantined = await client.query(
      `SELECT mo.id
       FROM media_objects mo
       WHERE mo.unreferenced_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM (${LIVE_CLIP_USAGE_SQL}) usage
           WHERE usage.media_id = mo.id
         )
       FOR UPDATE OF mo SKIP LOCKED`
    );
    deletedRows = await deleteMediaRows(client, quarantined.rows.map((row) => row.id));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await unlinkDeletedMedia(deletedRows, unlinkFile);
  return { deletedCount: deletedRows.length };
}

export async function runMediaGarbageCollection(db, {
  ttlHours = 168,
  unlinkFile = null,
} = {}) {
  const result = await withMediaGcLock(db, async (client) => {
    await client.query('BEGIN');
    try {
      const expired = await client.query(
        `SELECT mo.id, mo.path
         FROM media_objects mo
         WHERE mo.unreferenced_at IS NOT NULL
           AND mo.unreferenced_at <= NOW() - ($1::numeric * INTERVAL '1 hour')
           AND NOT EXISTS (
             SELECT 1
             FROM project_media_refs r
             WHERE r.media_id = mo.id
           )
         FOR UPDATE SKIP LOCKED`,
        [ttlHours]
      );

      const expiredRows = expired.rows;
      if (expiredRows.length > 0) {
        await client.query(
          `DELETE FROM media_objects
           WHERE id = ANY($1::text[])`,
          [expiredRows.map((row) => row.id)]
        );
      }

      await client.query('COMMIT');
      return { expiredRows };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (!result || result.skipped) {
    return { skipped: true, deletedCount: 0 };
  }

  await unlinkDeletedMedia(result.expiredRows, unlinkFile);

  return {
    skipped: false,
    deletedCount: (result.expiredRows || []).length,
  };
}

export async function getVolumeStats(targetPath) {
  try {
    const stats = await fs.statfs(targetPath);
    const blockSize = Number(stats.bsize || stats.frsize || 0);
    const totalBytes = Number(stats.blocks || 0) * blockSize;
    const availableBytes = Number(stats.bavail || 0) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return {
        path: targetPath,
        totalBytes: null,
        availableBytes: null,
        usedBytes: null,
      };
    }
    return {
      path: targetPath,
      totalBytes,
      availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
      usedBytes: Number.isFinite(availableBytes) ? Math.max(0, totalBytes - availableBytes) : null,
    };
  } catch {
    return {
      path: targetPath,
      totalBytes: null,
      availableBytes: null,
      usedBytes: null,
    };
  }
}

const HOST_SHARE_FS_TYPES = new Set([
  'virtiofs',
  'osxfs',
  'fuse.osxfs',
  'fuse.grpcfuse',
  'grpcfuse',
  '9p',
]);
const NETWORK_FS_TYPES = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smb3',
  'smbfs',
  'fuse.sshfs',
  'afs',
]);

export async function getFilesystemDevice(targetPath) {
  if (!targetPath) return null;
  try {
    const stats = await fs.stat(targetPath);
    return stats.dev == null ? null : stats.dev;
  } catch {
    return null;
  }
}

function decodeMountField(value) {
  return String(value || '').replace(/\\([0-7]{3})/g, (_match, octal) => (
    String.fromCharCode(Number.parseInt(octal, 8))
  ));
}

export function parseMountInfo(content, targetPath) {
  const resolved = path.resolve(targetPath);
  let best = null;
  String(content || '').split('\n').forEach((line) => {
    const separator = line.indexOf(' - ');
    if (separator === -1) return;
    const left = line.slice(0, separator).split(' ');
    const right = line.slice(separator + 3).split(' ');
    const mountPoint = decodeMountField(left[4]);
    const fstype = right[0];
    if (!mountPoint || !fstype) return;
    const isMatch = mountPoint === '/'
      ? resolved.startsWith('/')
      : (resolved === mountPoint || resolved.startsWith(`${mountPoint}/`));
    if (!isMatch) return;
    if (!best || mountPoint.length > best.mountPoint.length) {
      best = { mountPoint, fstype };
    }
  });
  return best;
}

export function classifyFstype(fstype) {
  const type = String(fstype || '').toLowerCase();
  if (!type) return 'local-disk';
  if (NETWORK_FS_TYPES.has(type) || type.startsWith('nfs') || type.startsWith('smb')) return 'network';
  if (HOST_SHARE_FS_TYPES.has(type) || type.includes('virtiofs') || type.includes('osxfs') || type.includes('grpcfuse')) {
    return 'host-share';
  }
  return 'local-disk';
}

export async function getMountKind(targetPath) {
  if (!targetPath) return 'local-disk';
  try {
    const [mountInfo, resolved] = await Promise.all([
      fs.readFile('/proc/self/mountinfo', 'utf8'),
      fs.realpath(targetPath).catch(() => path.resolve(targetPath)),
    ]);
    return classifyFstype(parseMountInfo(mountInfo, resolved)?.fstype);
  } catch {
    return 'local-disk';
  }
}

function parseDatabaseHostname(databaseUrl) {
  const raw = String(databaseUrl || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.replace(/^postgres(?:ql)?:/i, 'http:'));
    const socketHost = String(parsed.searchParams.get('host') || '');
    if (socketHost.startsWith('/')) return '';
    return decodeURIComponent(parsed.hostname || '')
      .replace(/^\[|\]$/g, '')
      .toLowerCase();
  } catch {
    if (/:\/\/[^/?#]*@\//.test(raw) || /^postgres(?:ql)?:\/\/\//i.test(raw)) return '';
    return null;
  }
}

export function classifyDatabaseHost(databaseUrl) {
  const host = parseDatabaseHostname(databaseUrl);
  if (host === null) return 'remote';
  if (!host) return 'loopback';
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) return 'loopback';
  if (['host.docker.internal', 'docker.for.mac.localhost', 'docker.for.win.localhost'].includes(host)) {
    return 'loopback';
  }
  if (!host.includes('.') && !/^\d+$/.test(host)) return 'docker-internal';
  return 'remote';
}

export function isLocalDatabaseUrl(databaseUrl) {
  return classifyDatabaseHost(databaseUrl) !== 'remote';
}

export function classifyStorageLayout({
  mediaDevice = null,
  databaseDevice = null,
  databaseHostKind = 'remote',
  mediaMountKind = 'local-disk',
  rootDevice = null,
} = {}) {
  if (databaseHostKind === 'remote') return 'split';

  if (mediaDevice != null && databaseDevice != null) {
    if (String(mediaDevice) === String(databaseDevice)) return 'combined';
    // Docker Desktop bind-mounts the host disk (virtiofs) while a Compose volume
    // looks like a different Linux filesystem, even though both live on that host disk.
    if (mediaMountKind === 'host-share') return 'combined';
    return 'split';
  }

  if (mediaMountKind === 'network') return 'split';
  if (mediaMountKind === 'host-share') return 'combined';
  if (rootDevice != null && mediaDevice != null && String(mediaDevice) !== String(rootDevice)) {
    return 'split';
  }
  return 'combined';
}

function toPositiveBytes(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function mapMediaStorageItem(row, ttlHours) {
  const clipCount = Number(row.clipCount || 0);
  const unreferencedAt = toIso(row.unreferencedAt);
  const status = classifyMediaStatus({ clipCount, unreferencedAt });
  return {
    id: row.id,
    fileName: fileNameFromStoredPath(row.id, row.path),
    sha256: row.sha256,
    mimeType: row.mimeType || 'application/octet-stream',
    sizeBytes: Number(row.sizeBytes || 0),
    createdAt: toIso(row.createdAt),
    createdByUserId: row.createdByUserId || null,
    createdByUsername: row.createdByUsername || null,
    quarantinedByUsername: row.quarantinedByUsername || null,
    unreferencedAt,
    deletesAt: status === 'quarantine' ? computeDeletesAt(unreferencedAt, ttlHours) : null,
    status,
    projectCount: Number(row.projectCount || 0),
    projectNames: Array.isArray(row.projectNames) ? row.projectNames.filter(Boolean) : [],
    clipCount,
  };
}

export async function getMediaStorageOverview(db, {
  mediaRoot,
  ttlHours = 168,
  databaseUrl = '',
} = {}) {
  const [databaseResult, itemsResult, volume] = await Promise.all([
    db.query(
      `SELECT pg_database_size(current_database())::bigint AS "databaseBytes",
              current_database() AS "databaseName",
              CASE
                WHEN current_setting('is_superuser') = 'on'
                  THEN current_setting('data_directory')
                ELSE NULL
              END AS "dataDirectory",
              (
                SELECT pg_size_bytes(split_part(opt, '=', 2))
                FROM pg_tablespace ts
                JOIN pg_database d ON d.dattablespace = ts.oid
                CROSS JOIN LATERAL unnest(COALESCE(ts.spcoptions, ARRAY[]::text[])) AS opt
                WHERE d.datname = current_database()
                  AND split_part(opt, '=', 1) = 'max_size'
                  AND NULLIF(split_part(opt, '=', 2), '') IS NOT NULL
                  AND split_part(opt, '=', 2) <> '-1'
                LIMIT 1
              ) AS "quotaBytes"`
    ),
    db.query(
      `WITH clip_usage AS (
         SELECT usage.media_id,
                COUNT(*)::int AS clip_count,
                COUNT(DISTINCT usage.project_id)::int AS project_count,
                ARRAY_AGG(DISTINCT usage.project_name ORDER BY usage.project_name)
                  FILTER (WHERE usage.project_name IS NOT NULL) AS project_names
         FROM (${LIVE_CLIP_USAGE_SQL}) usage
         GROUP BY usage.media_id
       )
       SELECT mo.id,
              mo.sha256,
              mo.mime_type AS "mimeType",
              mo.size_bytes AS "sizeBytes",
              mo.path,
              mo.created_at AS "createdAt",
              mo.created_by AS "createdByUserId",
              mo.unreferenced_at AS "unreferencedAt",
              u.username AS "createdByUsername",
              quarantiner.username AS "quarantinedByUsername",
              COALESCE(clip_usage.project_count, 0) AS "projectCount",
              COALESCE(clip_usage.project_names, ARRAY[]::text[]) AS "projectNames",
              COALESCE(clip_usage.clip_count, 0) AS "clipCount"
       FROM media_objects mo
       LEFT JOIN users u ON u.id = mo.created_by
       LEFT JOIN users quarantiner ON quarantiner.id = mo.quarantined_by
       LEFT JOIN clip_usage ON clip_usage.media_id = mo.id
       ORDER BY mo.size_bytes DESC, mo.created_at DESC`
    ),
    getVolumeStats(mediaRoot),
  ]);

  const databaseRow = databaseResult.rows[0] || {};
  const dataDirectory = databaseRow.dataDirectory || null;
  const databaseHostKind = classifyDatabaseHost(databaseUrl);
  const [mediaDevice, databaseDevice, rootDevice, mediaMountKind] = await Promise.all([
    getFilesystemDevice(mediaRoot),
    databaseHostKind === 'remote' ? Promise.resolve(null) : getFilesystemDevice(dataDirectory),
    process.platform === 'linux' ? getFilesystemDevice('/') : Promise.resolve(null),
    getMountKind(mediaRoot),
  ]);
  const sameFilesystem = classifyStorageLayout({
    mediaDevice,
    databaseDevice,
    databaseHostKind,
    mediaMountKind,
    rootDevice,
  }) === 'combined';
  const databaseVolume = (!sameFilesystem && databaseDevice != null)
    ? await getVolumeStats(dataDirectory)
    : null;

  const items = itemsResult.rows.map((row) => mapMediaStorageItem(row, ttlHours));
  const mediaBytes = items.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
  const quarantineItems = items.filter((item) => item.status === 'quarantine');
  const inUseItems = items.filter((item) => item.status === 'in_use');
  const unusedItems = items.filter((item) => item.status === 'unused');
  const databaseBytes = Number(databaseRow.databaseBytes || 0);

  return {
    summary: {
      mediaCount: items.length,
      mediaBytes,
      quarantineCount: quarantineItems.length,
      quarantineBytes: quarantineItems.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0),
      inUseCount: inUseItems.length,
      inUseBytes: inUseItems.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0),
      unusedCount: unusedItems.length,
      databaseBytes,
      databaseName: databaseRow.databaseName || null,
      databasePath: dataDirectory,
      databaseQuotaBytes: toPositiveBytes(databaseRow.quotaBytes),
      appBytes: mediaBytes + databaseBytes,
      ttlHours: Number(ttlHours) || 168,
      sameFilesystem,
      volume,
      databaseVolume,
    },
    items,
  };
}
