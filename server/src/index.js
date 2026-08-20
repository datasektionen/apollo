import fs from 'fs/promises';
import fssync from 'fs';
import { randomUUID } from 'crypto';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';

import { config } from './config.js';
import { buildStoredMediaPath, resolveMediaPath } from './mediaPaths.js';
import {
  MediaGcActionError,
  deleteMediaById,
  deleteQuarantinedMedia,
  getFollowingMediaGcRunAt,
  getMediaStorageOverview,
  quarantineMediaById,
  runMediaGarbageCollection,
  syncProjectMediaRefs,
  refreshMediaUnreferencedAt,
  validateUnusedMedia,
} from './mediaGc.js';
import { pool, waitForDatabase, runMigrations, closeDb, logDatabaseConnectionDetails } from './db.js';
import {
  isRefreshTokenPersisted,
  persistRefreshToken,
  requireAdmin,
  requireAuth,
  requireProjectPermission,
  revokeRefreshToken,
  signAccessToken,
  signRefreshToken,
  tryAuthenticateRequest,
  verifyRefreshToken,
} from './auth.js';
import {
  buildOidcAuthorizationRequest,
  buildProviderLogoutUrl,
  completeOidcAuthorization,
} from './oidc.js';
import {
  clearOidcTransactionCookie,
  clearSessionCookies,
  getOidcIdTokenCookie,
  getRefreshCookieLifetimeMs,
  getRefreshTokenCookie,
  parseCookieHeader,
  readOidcTransactionCookie,
  setOidcTransactionCookie,
  setSessionCookies,
} from './sessionCookies.js';
import { choosePreferredOrigin, getRequestOrigin } from './requestOrigin.js';
import {
  deleteUserAccount,
  findOrCreateOidcUser,
  findUserById,
  linkPendingOidcIdentityToUser,
  listUsersWithAuthDetails,
  toAdminUser,
  touchUserLogin,
  transferUserOwnership,
  updateUserProfile,
} from './userAccounts.js';
import {
  addRoleMember,
  buildTrackAccessInfoMap,
  canCreateProjectsInShow,
  canUserMutateTrack,
  createRoleOidcLink,
  createRole,
  deleteRoleOidcLink,
  deleteGrant,
  deleteRole,
  ensureDefaultUserRoleMembership,
  getProjectAccess,
  getProjectAccessCatalog,
  getProjectAccessMap,
  getShowAccessMap,
  getRoleById,
  getUserAccessSummary,
  listRoleChildren,
  listRoleInheritedGrants,
  listRoleOidcLinks,
  listRoleParents,
  listRoleGrants,
  listRoleMembers,
  listRoles,
  listUserDirectGrants,
  listUserRoles,
  removeRoleMember,
  replaceProjectAccessTags,
  syncAllProjectAccessTags,
  syncLegacyProjectPermission,
  updateRole,
  upsertRoleGrant,
  upsertUserGrant,
  userHasAdminRole,
  validateAndTransformProjectWrite,
} from './rbac.js';

const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

const clients = new Set();
const projectRooms = new Map();

function nowIso() {
  return new Date().toISOString();
}

function toSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    artistDisplayName: user.artist_display_name || user.artistDisplayName || '',
    artistDescription: user.artist_description || user.artistDescription || '',
    oidcDisplayName: user.oidc_display_name || user.oidcDisplayName || '',
    isAdmin: Boolean(user.is_admin ?? user.isAdmin),
  };
}

async function buildSessionPayload(user) {
  return {
    user: toSessionUser(user),
    accessSummary: await getUserAccessSummary(user.id),
  };
}

async function issueApolloSession(res, user, options = {}) {
  const sessionUser = await findUserById(user.id);
  if (!sessionUser) {
    throw new Error('User not found');
  }
  const accessToken = signAccessToken(sessionUser);
  const refreshToken = signRefreshToken(sessionUser);
  await persistRefreshToken(refreshToken, sessionUser.id);
  await touchUserLogin(sessionUser.id);
  setSessionCookies(res, {
    accessToken,
    refreshToken,
    refreshMaxAgeMs: getRefreshCookieLifetimeMs(),
    oidcIdToken: options.oidcIdToken || '',
  });
  return await buildSessionPayload(sessionUser);
}

function readRefreshToken(req) {
  return String(req.body?.refreshToken || getRefreshTokenCookie(req) || '').trim();
}

function buildAuthErrorRedirect(message) {
  const url = new URL('http://apollo.invalid/');
  url.searchParams.set('auth_error', message);
  return `${url.pathname}${url.search}`;
}

function toSafeName(name, fallback = 'file') {
  return (name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function normalizeMusicalNumber(value) {
  return String(value || '').trim();
}

function isValidMusicalNumber(value) {
  return /^[0-9]+\..+$/.test(normalizeMusicalNumber(value));
}

function normalizeSceneOrder(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return NaN;
  return numeric;
}

function normalizeProjectPublished(value) {
  return value === true || String(value ?? '').trim().toLowerCase() === 'true';
}

function parseMusicalNumberSegments(value) {
  return normalizeMusicalNumber(value)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function classifyMusicalToken(token) {
  if (/^dk$/i.test(token)) return 0;
  if (/^\d+$/.test(token)) return 1;
  return 2;
}

function compareMusicalNumbers(leftRaw, rightRaw) {
  const left = parseMusicalNumberSegments(leftRaw);
  const right = parseMusicalNumberSegments(rightRaw);
  const leftMajor = Number.parseInt(left[0] || '0', 10);
  const rightMajor = Number.parseInt(right[0] || '0', 10);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;

  const maxParts = Math.max(left.length, right.length);
  for (let i = 1; i < maxParts; i += 1) {
    const leftPart = left[i];
    const rightPart = right[i];

    if (leftPart == null && rightPart == null) return 0;
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;

    const leftKind = classifyMusicalToken(leftPart);
    const rightKind = classifyMusicalToken(rightPart);
    if (leftKind !== rightKind) return leftKind - rightKind;

    if (leftKind === 1) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      continue;
    }

    const textCompare = leftPart.localeCompare(rightPart, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (textCompare !== 0) return textCompare;
  }

  return 0;
}

function compareProjectsByMusicalOrder(left, right) {
  const showOrderLeft = Number(left?.showOrderIndex ?? 0);
  const showOrderRight = Number(right?.showOrderIndex ?? 0);
  if (showOrderLeft !== showOrderRight) return showOrderLeft - showOrderRight;

  const showCompare = String(left?.showName || '').localeCompare(String(right?.showName || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (showCompare !== 0) return showCompare;

  const musicalCompare = compareMusicalNumbers(left?.musicalNumber, right?.musicalNumber);
  if (musicalCompare !== 0) return musicalCompare;

  // Optional explicit per-scene order inside same X.* bucket.
  const leftSceneOrder = normalizeSceneOrder(left?.sceneOrder);
  const rightSceneOrder = normalizeSceneOrder(right?.sceneOrder);
  const leftHasSceneOrder = Number.isFinite(leftSceneOrder);
  const rightHasSceneOrder = Number.isFinite(rightSceneOrder);

  if (leftHasSceneOrder && rightHasSceneOrder && leftSceneOrder !== rightSceneOrder) {
    return leftSceneOrder - rightSceneOrder;
  }
  if (leftHasSceneOrder && !rightHasSceneOrder) return -1;
  if (!leftHasSceneOrder && rightHasSceneOrder) return 1;

  const nameCompare = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (nameCompare !== 0) return nameCompare;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

async function loadCurrentSessionUser(userId) {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

async function buildProjectPermissionMapForRows(userId, rows = []) {
  const projectIds = Array.from(new Set(rows.map((row) => String(row?.id || row?.projectId || '')).filter(Boolean)));
  const projectRows = projectIds.map((projectId) => {
    const row = rows.find((entry) => String(entry?.id || entry?.projectId || '') === projectId) || {};
    return {
      id: projectId,
      createdByUserId: row.createdByUserId,
      showId: row.showId,
      showName: row.showName,
      published: row.published,
      musicalNumber: row.musicalNumber,
      sceneOrder: row.sceneOrder,
      name: row.name || row.projectName,
    };
  });
  return await getProjectAccessMap(userId, projectRows);
}

async function buildShowAccessMapForRows(userId, rows = []) {
  const showIds = Array.from(new Set(rows.map((row) => String(row?.id || '')).filter(Boolean)));
  const showRows = showIds.map((showId) => {
    const row = rows.find((entry) => String(entry?.id || '') === showId) || {};
    return {
      id: showId,
      name: row.name,
      orderIndex: row.orderIndex,
      createdByUserId: row.createdByUserId,
    };
  });
  return await getShowAccessMap(userId, showRows);
}

function attachProjectAccess(row, permissionMap) {
  const projectId = String(row?.id || row?.projectId || '');
  const access = permissionMap.get(projectId) || null;
  return {
    ...row,
    access,
    canRead: Boolean(access?.canOpenProject),
    canWrite: Boolean(access?.compatibility?.canWrite),
    canSeeShow: Boolean(access?.canSeeShow),
    canManageShow: Boolean(access?.canManageShow),
    canCreateShows: Boolean(access?.canCreateShows),
    canSeeProject: Boolean(access?.canSeeProject),
    canOpenProject: Boolean(access?.canOpenProject),
    canCreateProjects: Boolean(access?.canCreateProjects),
    canCreateTracks: Boolean(access?.canCreateTracks),
    canManageTracks: Boolean(access?.canManageTracks),
    canEditAllTracks: Boolean(access?.canEditAllTracks),
    canListenTutti: Boolean(access?.canListenTutti),
    canReadProject: Boolean(access?.canOpenProject),
    canCreateMixes: Boolean(access?.canCreateMixes),
    canWriteOwnTracks: Boolean(access?.canWriteOwnTracks),
    canWriteScopedTracks: Boolean(access?.canWriteScopedTracks),
    canManageOwnProject: Boolean(access?.canManageOwnProject),
    canManageProject: Boolean(access?.canManageProject),
  };
}

function attachShowAccess(row, accessMap) {
  const showId = String(row?.id || '');
  const access = accessMap.get(showId) || null;
  return {
    ...row,
    access,
    canSeeShow: Boolean(access?.canSeeShow),
    canManageShow: Boolean(access?.canManageShow),
    canCreateProjects: Boolean(access?.canCreateProjects),
    canCreateShows: Boolean(access?.canCreateShows),
  };
}

function canAccessProjectInPlayer(access) {
  return Boolean(access?.canListenTutti);
}

function canAccessProjectInDaw(access) {
  return Boolean(access?.canSeeProject);
}

function canOpenProjectInDaw(access) {
  return Boolean(access?.canOpenProject);
}

function canCreateProjectMixes(access) {
  return Boolean(access?.canCreateMixes);
}

function canWriteProjectTracks(access) {
  return Boolean(
    access?.canCreateTracks
    || access?.canManageTracks
    || access?.canManageProject
  );
}

async function ensureMediaRoot() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
}

function roomFor(projectId) {
  if (!projectRooms.has(projectId)) {
    projectRooms.set(projectId, new Set());
  }
  return projectRooms.get(projectId);
}

function sendWs(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastToProject(projectId, type, payload = {}, excludeWs = null) {
  const room = roomFor(projectId);
  room.forEach((ws) => {
    if (excludeWs && ws === excludeWs) return;
    sendWs(ws, type, payload);
  });
}

async function applyOpToSnapshot(currentSnapshot, op) {
  if (!op || typeof op !== 'object') return currentSnapshot;
  if (op.type === 'project.replace' && op.project && typeof op.project === 'object') {
    return op.project;
  }
  if (op.type === 'project.update' && op.updates && typeof op.updates === 'object') {
    return {
      ...currentSnapshot,
      ...op.updates,
    };
  }
  return currentSnapshot;
}

function preserveLocalOnlyProjectFields(nextSnapshot = {}, currentSnapshot = {}) {
  const currentCollapsedById = new Map(
    (Array.isArray(currentSnapshot?.trackTree) ? currentSnapshot.trackTree : [])
      .filter((node) => node?.kind === 'group' && node?.id)
      .map((node) => [String(node.id), Boolean(node.collapsed)])
  );

  const sharedSnapshot = {
    ...nextSnapshot,
    loop: currentSnapshot?.loop || nextSnapshot?.loop || { enabled: false, startMs: 0, endMs: 0 },
  };
  if (Array.isArray(nextSnapshot?.trackTree)) {
    sharedSnapshot.trackTree = nextSnapshot.trackTree.map((node) => {
      if (node?.kind !== 'group') return node;
      return {
        ...node,
        collapsed: currentCollapsedById.has(String(node.id))
          ? currentCollapsedById.get(String(node.id))
          : false,
      };
    });
  }
  return sharedSnapshot;
}

async function unlinkMediaFile(storedPath) {
  if (!storedPath) return;
  try {
    await fs.unlink(resolveMediaPath(storedPath));
  } catch {
    // ignore missing file/delete errors
  }
}

let mediaGcTimer = null;

function msUntil(date) {
  return Math.max(0, date.getTime() - Date.now());
}

function scheduleMediaGarbageCollection(delayMs, reason = '') {
  if (mediaGcTimer) {
    clearTimeout(mediaGcTimer);
    mediaGcTimer = null;
  }
  const waitMs = Math.max(1000, Number(delayMs) || 0);
  if (reason) {
    const nextAt = new Date(Date.now() + waitMs);
    console.log(`Media garbage collection ${reason}; next run ${nextAt.toString()}`);
  }
  mediaGcTimer = setTimeout(() => {
    runScheduledMediaGarbageCollection().catch((error) => {
      console.error('Failed to run media garbage collection', error);
    });
  }, waitMs);
  mediaGcTimer.unref();
}

function scheduleNextMediaGc(now = new Date()) {
  const nextRun = getFollowingMediaGcRunAt(now, { hour: config.mediaGcHour });
  scheduleMediaGarbageCollection(msUntil(nextRun), `waiting for ${String(config.mediaGcHour).padStart(2, '0')}:00`);
}

async function runScheduledMediaGarbageCollection() {
  try {
    const result = await runMediaGarbageCollection(pool, {
      ttlHours: config.mediaGcTtlHours,
      attachGraceSeconds: config.mediaGcAttachGraceSeconds,
      unlinkFile: unlinkMediaFile,
    });
    if (result?.deletedCount) {
      console.log(`Media garbage collection deleted ${result.deletedCount} unused blob(s)`);
    } else if (!result?.skipped) {
      console.log('Media garbage collection found nothing expired to delete');
    }
  } catch (error) {
    console.error('Failed to run media garbage collection', error);
  }

  scheduleNextMediaGc(new Date());
}

async function appendProjectOp({ projectId, userId, clientOpId, op }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const headResult = await client.query(
      `SELECT latest_seq, latest_snapshot_json, last_checkpoint_at
       FROM project_heads
       WHERE project_id = $1
       FOR UPDATE`,
      [projectId]
    );

    if (headResult.rowCount === 0) {
      throw new Error('Project head missing');
    }

    const projectResult = await client.query(
      `SELECT id,
              name,
              published,
              created_by AS "createdByUserId"
       FROM projects
       WHERE id = $1`,
      [projectId]
    );
    if (projectResult.rowCount === 0) {
      throw new Error('Project not found');
    }

    const head = headResult.rows[0];
    const project = projectResult.rows[0];
    const latestSeq = Number(head.latest_seq || 0);
    const maxOpSeqResult = await client.query(
      `SELECT COALESCE(MAX(server_seq), 0) AS max_op_seq
       FROM project_ops
       WHERE project_id = $1`,
      [projectId]
    );
    const maxOpSeq = Number(maxOpSeqResult.rows?.[0]?.max_op_seq || 0);
    const nextSeq = Math.max(latestSeq, maxOpSeq) + 1;
    const currentSnapshot = head.latest_snapshot_json || {};
    const provisionalNextSnapshot = await applyOpToSnapshot(currentSnapshot, op);
    const access = await getProjectAccess(userId, projectId, client);
    const validatedSnapshot = await validateAndTransformProjectWrite({
      userId,
      project,
      access,
      currentSnapshot,
      nextSnapshot: provisionalNextSnapshot,
    });
    const sharedSnapshot = preserveLocalOnlyProjectFields(validatedSnapshot, currentSnapshot);
    const nextSnapshot = {
      ...sharedSnapshot,
      published: normalizeProjectPublished(
        sharedSnapshot?.published
        ?? sharedSnapshot?.publish
        ?? currentSnapshot?.published
        ?? currentSnapshot?.publish
        ?? project?.published
      ),
    };
    const storedOp = (
      op?.type === 'project.replace'
        ? { ...op, project: nextSnapshot }
        : op
    );

    const projectMetadataUpdates = [];
    const projectMetadataValues = [projectId];
    let metadataIdx = 2;
    const nextProjectName = String(nextSnapshot?.projectName || '').trim();
    const currentProjectName = String(currentSnapshot?.projectName || '').trim();
    if (nextProjectName && nextProjectName !== currentProjectName) {
      projectMetadataUpdates.push(`name = $${metadataIdx++}`);
      projectMetadataValues.push(nextProjectName);
    }

    const nextMusicalNumber = normalizeMusicalNumber(nextSnapshot?.musicalNumber || '');
    const currentMusicalNumber = normalizeMusicalNumber(currentSnapshot?.musicalNumber || '');
    if (nextMusicalNumber) {
      if (!isValidMusicalNumber(nextMusicalNumber)) {
        throw new Error('Invalid musicalNumber in operation payload');
      }
      if (nextMusicalNumber !== currentMusicalNumber) {
        projectMetadataUpdates.push(`musical_number = $${metadataIdx++}`);
        projectMetadataValues.push(nextMusicalNumber);
      }
    }

    const nextPublished = normalizeProjectPublished(nextSnapshot?.published ?? nextSnapshot?.publish);
    const currentPublished = normalizeProjectPublished(currentSnapshot?.published ?? currentSnapshot?.publish ?? project?.published);
    if (nextPublished !== currentPublished) {
      projectMetadataUpdates.push(`published = $${metadataIdx++}`);
      projectMetadataValues.push(nextPublished);
    }

    const nextCreditsJson = JSON.stringify(normalizeProjectCredits(nextSnapshot?.credits || {}));
    const currentCreditsJson = JSON.stringify(normalizeProjectCredits(currentSnapshot?.credits || {}));
    if (nextCreditsJson !== currentCreditsJson) {
      projectMetadataUpdates.push(`credits_json = $${metadataIdx++}::jsonb`);
      projectMetadataValues.push(nextCreditsJson);
    }

    await client.query(
      `INSERT INTO project_ops(project_id, server_seq, client_op_id, user_id, op_json)
       VALUES($1, $2, $3, $4, $5::jsonb)`,
      [projectId, nextSeq, clientOpId || null, userId, JSON.stringify(storedOp || {})]
    );

    if (projectMetadataUpdates.length > 0) {
      await client.query(
        `UPDATE projects
         SET ${projectMetadataUpdates.join(', ')}
         WHERE id = $1`,
        projectMetadataValues
      );
    }

    const checkpointEveryMs = config.checkpointEverySeconds * 1000;
    const lastCheckpointAt = head.last_checkpoint_at ? new Date(head.last_checkpoint_at).getTime() : 0;
    const shouldCheckpoint = (nextSeq % config.checkpointEveryOps === 0)
      || (Date.now() - lastCheckpointAt >= checkpointEveryMs)
      || latestSeq === 0;

    await client.query(
      `UPDATE project_heads
       SET latest_seq = $2,
           latest_snapshot_json = $3::jsonb,
           updated_at = NOW(),
           last_checkpoint_at = CASE WHEN $4 THEN NOW() ELSE last_checkpoint_at END
       WHERE project_id = $1`,
      [projectId, nextSeq, JSON.stringify(nextSnapshot), shouldCheckpoint]
    );

    await syncProjectMediaRefs(client, projectId, nextSnapshot);

    if (shouldCheckpoint) {
      await client.query(
        `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
         VALUES($1, $2, $3::jsonb, $4)`,
        [projectId, nextSeq, JSON.stringify(nextSnapshot), userId]
      );
    }

    await replaceProjectAccessTags(client, projectId, nextSnapshot);

    await client.query('COMMIT');

    return {
      serverSeq: nextSeq,
      snapshot: nextSnapshot,
      op: storedOp,
      checkpointed: shouldCheckpoint,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fetchProjectBootstrap(projectId, knownSeq = 0) {
  const [headResult, projectResult] = await Promise.all([
    pool.query(
      `SELECT latest_seq, latest_snapshot_json
       FROM project_heads
       WHERE project_id = $1`,
      [projectId]
    ),
    pool.query(
      `SELECT p.id,
              p.name,
              p.published,
              p.show_id AS "showId",
              s.name AS "showName"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       WHERE p.id = $1`,
      [projectId]
    ),
  ]);

  if (headResult.rowCount === 0 || projectResult.rowCount === 0) {
    throw new Error('Project not found');
  }

  const head = headResult.rows[0];
  const latestSeq = Number(head.latest_seq || 0);
  const snapshot = head.latest_snapshot_json || {};

  let missingOps = [];
  const seq = Number(knownSeq || 0);
  if (seq > 0 && seq < latestSeq) {
    const opsResult = await pool.query(
      `SELECT server_seq, op_json, user_id
       FROM project_ops
       WHERE project_id = $1 AND server_seq > $2
       ORDER BY server_seq ASC
       LIMIT 5000`,
      [projectId, seq]
    );
    missingOps = opsResult.rows.map((row) => ({
      serverSeq: Number(row.server_seq),
      op: row.op_json,
      actor: { userId: row.user_id },
    }));
  }

  return {
    project: {
      id: projectResult.rows[0].id,
      name: projectResult.rows[0].name,
      published: Boolean(projectResult.rows[0].published),
      showId: projectResult.rows[0].showId,
      showName: projectResult.rows[0].showName,
    },
    latestSeq,
    snapshot,
    missingOps,
  };
}

async function broadcastLockState(projectId, trackId) {
  const result = await pool.query(
    `SELECT owner_user_id, owner_name, expires_at
     FROM record_locks
     WHERE project_id = $1 AND track_id = $2`,
    [projectId, trackId]
  );

  if (result.rowCount === 0) {
    broadcastToProject(projectId, 'lock.state', {
      projectId,
      trackId,
      ownerUserId: null,
      ownerName: null,
      expiresAt: null,
    });
    return;
  }

  const row = result.rows[0];
  broadcastToProject(projectId, 'lock.state', {
    projectId,
    trackId,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    expiresAt: row.expires_at,
  });
}

async function sendProjectLockStatesToClient(projectId, ws) {
  const result = await pool.query(
    `SELECT track_id, owner_user_id, owner_name, expires_at
     FROM record_locks
     WHERE project_id = $1 AND expires_at > NOW()`,
    [projectId]
  );

  result.rows.forEach((row) => {
    sendWs(ws, 'lock.state', {
      projectId,
      trackId: row.track_id,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      expiresAt: row.expires_at,
    });
  });
}

async function cleanupExpiredLocks() {
  const result = await pool.query(
    `DELETE FROM record_locks
     WHERE expires_at < NOW()
     RETURNING project_id, track_id`
  );
  if (!result.rowCount) return;
  await Promise.all(result.rows.map((row) => broadcastLockState(row.project_id, row.track_id)));
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const ARTIST_REF_TYPES = new Set(['user', 'group', 'guest']);
const CREDIT_ROLE_OPTIONS = {
  artist: [
    { key: 'primary_artist', label: 'Primary artist' },
    { key: 'featured_artist', label: 'Featured artist' },
    { key: 'ensemble', label: 'Ensemble' },
    { key: 'conductor', label: 'Conductor' },
    { key: 'arranger_artist', label: 'Arranger artist' },
  ],
  compositionLyrics: [
    { key: 'composer', label: 'Composer' },
    { key: 'lyricist', label: 'Lyricist' },
    { key: 'writer', label: 'Writer' },
    { key: 'arranger', label: 'Arranger' },
    { key: 'translator', label: 'Translator' },
    { key: 'original_writer', label: 'Original writer' },
  ],
  productionEngineering: [
    { key: 'producer', label: 'Producer' },
    { key: 'executive_producer', label: 'Executive producer' },
    { key: 'recording_engineer', label: 'Recording engineer' },
    { key: 'mixing_engineer', label: 'Mixing engineer' },
    { key: 'mastering_engineer', label: 'Mastering engineer' },
    { key: 'editor', label: 'Editor' },
    { key: 'sound_designer', label: 'Sound designer' },
  ],
};

function getEffectiveArtistName(row = {}) {
  return normalizeText(row.artistDisplayName || row.artist_display_name || row.oidcDisplayName || row.oidc_display_name || row.username || row.name);
}

function normalizeArtistRefs(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const refs = [];
  rows.forEach((candidate) => {
    const type = normalizeText(candidate?.type).toLowerCase();
    const id = normalizeText(candidate?.id || candidate?.userId || candidate?.groupId || candidate?.guestId);
    if (!ARTIST_REF_TYPES.has(type) || !id) return;
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ type, id });
  });
  return refs;
}

function artistRefsHaveSoloArtist(value) {
  return normalizeArtistRefs(value).some((ref) => ref.type === 'user' || ref.type === 'guest');
}

function normalizeCreditEntries(value, options = []) {
  const optionKeys = new Set(options.map((option) => option.key));
  const rows = Array.isArray(value) ? value : [];
  return rows.map((entry) => {
    const roleKey = normalizeText(entry?.roleKey || entry?.key).toLowerCase();
    if (!optionKeys.has(roleKey)) return null;
    return {
      roleKey,
      artists: normalizeArtistRefs(entry?.artists || entry?.artistRefs),
    };
  }).filter((entry) => entry && entry.artists.length);
}

function normalizePerformerCredits(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((entry) => {
    const partName = normalizeText(entry?.partName || entry?.label);
    return {
      partTrackId: normalizeText(entry?.partTrackId || ''),
      partName,
      artists: normalizeArtistRefs(entry?.artists || entry?.artistRefs),
    };
  }).filter((entry) => entry.partName && entry.artists.length);
}

function normalizeProjectCredits(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    artist: normalizeCreditEntries(source.artist, CREDIT_ROLE_OPTIONS.artist),
    compositionLyrics: normalizeCreditEntries(source.compositionLyrics, CREDIT_ROLE_OPTIONS.compositionLyrics),
    productionEngineering: normalizeCreditEntries(source.productionEngineering, CREDIT_ROLE_OPTIONS.productionEngineering),
    performers: normalizePerformerCredits(source.performers),
  };
}

function projectCreditsHaveContent(value = {}) {
  const credits = normalizeProjectCredits(value);
  return (
    credits.artist.length > 0
    || credits.compositionLyrics.length > 0
    || credits.productionEngineering.length > 0
    || credits.performers.length > 0
  );
}

function chooseStoredProjectCredits(projectCredits = {}, snapshotCredits = {}) {
  const normalizedProjectCredits = normalizeProjectCredits(projectCredits);
  if (projectCreditsHaveContent(normalizedProjectCredits)) {
    return normalizedProjectCredits;
  }
  const normalizedSnapshotCredits = normalizeProjectCredits(snapshotCredits);
  if (projectCreditsHaveContent(normalizedSnapshotCredits)) {
    return normalizedSnapshotCredits;
  }
  return normalizedProjectCredits;
}

function buildArtistCatalogKey(ref) {
  return `${normalizeText(ref?.type).toLowerCase()}:${normalizeText(ref?.id)}`;
}

async function loadArtistCatalog(db = pool) {
  const [userResult, groupResult, guestResult] = await Promise.all([
    db.query(
      `SELECT id,
              username,
              artist_display_name AS "artistDisplayName",
              artist_description AS "artistDescription",
              oidc_display_name AS "oidcDisplayName"
       FROM users
       ORDER BY COALESCE(NULLIF(artist_display_name, ''), NULLIF(oidc_display_name, ''), username) ASC`
    ),
    db.query(
      `SELECT id, name, group_type AS "groupType", description
       FROM music_groups
       ORDER BY name ASC`
    ),
    db.query(
      `SELECT id, name, description
       FROM guest_artists
       ORDER BY name ASC`
    ),
  ]);

  const users = userResult.rows.map((row) => ({
    type: 'user',
    id: row.id,
    username: row.username,
    name: getEffectiveArtistName(row),
    description: row.artistDescription || '',
  }));
  const groups = groupResult.rows.map((row) => ({
    type: 'group',
    id: row.id,
    name: row.name,
    groupType: row.groupType || '',
    description: row.description || '',
  }));
  const guests = guestResult.rows.map((row) => ({
    type: 'guest',
    id: row.id,
    name: row.name,
    description: row.description || '',
  }));
  const byKey = new Map([...users, ...groups, ...guests].map((artist) => [buildArtistCatalogKey(artist), artist]));
  return { users, groups, guests, byKey };
}

function resolveArtistRefs(refs, catalog) {
  return normalizeArtistRefs(refs).map((ref) => {
    const artist = catalog.byKey.get(buildArtistCatalogKey(ref));
    return artist ? {
      ...ref,
      name: artist.name,
      description: artist.description || '',
      groupType: artist.groupType || '',
    } : null;
  }).filter(Boolean);
}

function resolveCreditEntries(entries, options, catalog) {
  const labelByKey = new Map(options.map((option) => [option.key, option.label]));
  return (entries || []).map((entry) => ({
    roleKey: entry.roleKey,
    roleLabel: labelByKey.get(entry.roleKey) || entry.roleKey,
    artists: resolveArtistRefs(entry.artists, catalog),
  })).filter((entry) => entry.artists.length);
}

function collectArtistRefKeys(refs, targetSet) {
  normalizeArtistRefs(refs).forEach((ref) => targetSet.add(buildArtistCatalogKey(ref)));
}

function collectCreditArtistRefKeys(credits, targetSet) {
  ['artist', 'compositionLyrics', 'productionEngineering'].forEach((category) => {
    (credits?.[category] || []).forEach((entry) => collectArtistRefKeys(entry.artists, targetSet));
  });
  (credits?.performers || []).forEach((entry) => collectArtistRefKeys(entry.artists, targetSet));
}

function resolvePartNamesByTrackId(snapshot = {}) {
  const tracksById = new Map((snapshot.tracks || []).map((track) => [String(track.id), track]));
  const partNameByTrackId = new Map();
  const nodes = Array.isArray(snapshot.trackTree) ? snapshot.trackTree : [];
  const childrenByParent = new Map();
  nodes.forEach((node) => {
    const parentId = node.parentId ?? null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const walk = (parentId = null, inheritedPart = '') => {
    (childrenByParent.get(parentId) || []).forEach((node) => {
      let nextPart = inheritedPart;
      if (node.kind === 'track') {
        const track = tracksById.get(String(node.trackId));
        if (track?.part) nextPart = track.name || nextPart;
        if (track?.id) partNameByTrackId.set(String(track.id), nextPart || track.name || '');
      } else if (node.kind === 'group') {
        if (node.part) nextPart = node.name || nextPart;
      }
      walk(node.id, nextPart);
    });
  };
  walk(null, '');
  (snapshot.tracks || []).forEach((track) => {
    if (!partNameByTrackId.has(String(track.id))) {
      partNameByTrackId.set(String(track.id), track.part ? track.name : '');
    }
  });
  return partNameByTrackId;
}

function addContributionName(target, contributionName) {
  const normalized = normalizeText(contributionName);
  if (!normalized) return;
  if (!Array.isArray(target.contributionNames)) target.contributionNames = [];
  if (!target.contributionNames.includes(normalized)) {
    target.contributionNames.push(normalized);
  }
}

function mergePerformerRows(rows = []) {
  const byArtist = new Map();
  rows.forEach((row) => {
    const artist = normalizeArtistRefs([row?.artist || row?.artists?.[0]])[0];
    if (!artist) return;
    const key = buildArtistCatalogKey(artist);
    if (!byArtist.has(key)) {
      byArtist.set(key, {
        artist,
        artists: [artist],
        contributionNames: [],
        members: [],
      });
    }
    const entry = byArtist.get(key);
    (Array.isArray(row.contributionNames) ? row.contributionNames : [row.contributionName || row.partName])
      .forEach((name) => addContributionName(entry, name));
    if (Array.isArray(row.members)) {
      entry.members.push(...row.members);
    }
  });
  return Array.from(byArtist.values()).map((entry) => ({
    ...entry,
    members: mergePerformerRows(entry.members || []),
  }));
}

function buildPerformerCreditsFromTracks(snapshot = {}) {
  const tracksById = new Map((snapshot.tracks || []).map((track) => [String(track.id), track]));
  const nodes = (Array.isArray(snapshot.trackTree) ? snapshot.trackTree : [])
    .map((node) => {
      if (!node || typeof node !== 'object') return null;
      const kind = node.kind === 'group' ? 'group' : (node.kind === 'track' || node.type === 'audio' ? 'track' : null);
      if (!kind) return null;
      const id = normalizeText(node.id || node.nodeId);
      if (!id) return null;
      return {
        ...node,
        id,
        kind,
        parentId: node.parentId || null,
      };
    })
    .filter(Boolean);
  const existingTrackIds = new Set(nodes.filter((node) => node.kind === 'track').map((node) => String(node.trackId || '')));
  (snapshot.tracks || []).forEach((track) => {
    if (!track?.id || existingTrackIds.has(String(track.id))) return;
    nodes.push({
      id: String(track.id),
      kind: 'track',
      parentId: null,
      trackId: track.id,
    });
  });

  const childrenByParent = new Map();
  nodes.forEach((node) => {
    const key = node.parentId || '__root__';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(node);
  });
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => toFiniteNumber(left.order, 0) - toFiniteNumber(right.order, 0));
  }

  const nodeName = (node) => {
    if (node.kind === 'group') return normalizeText(node.name) || 'Group track';
    const track = tracksById.get(String(node.trackId || ''));
    return normalizeText(track?.name) || 'Track';
  };
  const nodeArtistRefs = (node) => {
    if (node.kind === 'group') return normalizeArtistRefs(node.artistRefs);
    const track = tracksById.get(String(node.trackId || ''));
    return normalizeArtistRefs(track?.artistRefs);
  };

  const topLevelRows = [];
  const walk = (parentId = null, activeGroupRows = [], hasSoloArtistAncestor = false) => {
    const key = parentId || '__root__';
    (childrenByParent.get(key) || []).forEach((node) => {
      const contributionName = nodeName(node);
      const rawRefs = nodeArtistRefs(node);
      const refs = hasSoloArtistAncestor ? [] : rawRefs;
      const nextActiveGroupRows = [...activeGroupRows];
      const nextHasSoloArtistAncestor = hasSoloArtistAncestor || artistRefsHaveSoloArtist(rawRefs);

      if (refs.length && activeGroupRows.length) {
        activeGroupRows.forEach((groupRow) => {
          refs.forEach((artist) => {
            groupRow.members.push({ artist, artists: [artist], contributionName });
          });
        });
      }

      if (refs.length && !activeGroupRows.length) {
        refs.forEach((artist) => {
          const row = {
            artist,
            artists: [artist],
            contributionName,
            members: [],
          };
          topLevelRows.push(row);
          if (artist.type === 'group') {
            nextActiveGroupRows.push(row);
          }
        });
      }

      walk(node.id, nextActiveGroupRows, nextHasSoloArtistAncestor);
    });
  };
  walk(null, []);

  return mergePerformerRows(topLevelRows).sort((left, right) => (
    buildArtistCatalogKey(left.artist).localeCompare(buildArtistCatalogKey(right.artist), undefined, { sensitivity: 'base', numeric: true })
  ));
}

function clearDescendantArtistRefsFromSnapshot(snapshot = {}, ancestorNodeId) {
  const normalizedAncestorNodeId = normalizeText(ancestorNodeId);
  const trackTree = Array.isArray(snapshot.trackTree) ? snapshot.trackTree : [];
  if (!normalizedAncestorNodeId || !trackTree.length) {
    return snapshot;
  }

  const childrenByParent = new Map();
  trackTree.forEach((node) => {
    const parentKey = normalizeText(node?.parentId) || '__root__';
    const children = childrenByParent.get(parentKey) || [];
    children.push(node);
    childrenByParent.set(parentKey, children);
  });

  const descendantNodeIds = new Set();
  const stack = [normalizedAncestorNodeId];
  while (stack.length) {
    const parentId = stack.pop();
    (childrenByParent.get(parentId) || []).forEach((child) => {
      const childId = normalizeText(child?.id || child?.nodeId);
      if (!childId || descendantNodeIds.has(childId)) return;
      descendantNodeIds.add(childId);
      stack.push(childId);
    });
  }
  if (!descendantNodeIds.size) {
    return snapshot;
  }

  const descendantTrackIds = new Set();
  const nextTrackTree = trackTree.map((node) => {
    const nodeId = normalizeText(node?.id || node?.nodeId);
    if (!descendantNodeIds.has(nodeId)) return node;
    const kind = node.kind === 'group' ? 'group' : (node.kind === 'track' || node.type === 'audio' ? 'track' : null);
    if (kind === 'track' && node.trackId) {
      descendantTrackIds.add(String(node.trackId));
      return node;
    }
    if (kind === 'group' && Array.isArray(node.artistRefs) && node.artistRefs.length) {
      return { ...node, artistRefs: [] };
    }
    return node;
  });

  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  const nextTracks = tracks.map((track) => {
    if (!descendantTrackIds.has(String(track?.id)) || !Array.isArray(track?.artistRefs) || !track.artistRefs.length) {
      return track;
    }
    return { ...track, artistRefs: [] };
  });

  return {
    ...snapshot,
    trackTree: nextTrackTree,
    tracks: nextTracks,
  };
}

function applyTrackArtistRefsToSnapshot(snapshot = {}, trackId, artistRefs) {
  const normalizedTrackId = String(trackId || '');
  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  let nextSnapshot = {
    ...snapshot,
    tracks: tracks.map((track) => (
      String(track?.id) === normalizedTrackId ? { ...track, artistRefs } : track
    )),
  };
  if (!artistRefsHaveSoloArtist(artistRefs)) {
    return nextSnapshot;
  }
  const trackNode = (Array.isArray(snapshot.trackTree) ? snapshot.trackTree : []).find((node) => {
    const kind = node?.kind === 'track' || node?.type === 'audio';
    return kind && String(node?.trackId || '') === normalizedTrackId;
  });
  if (!trackNode) {
    return nextSnapshot;
  }
  return clearDescendantArtistRefsFromSnapshot(nextSnapshot, trackNode.id || trackNode.nodeId);
}

function resolvePerformerRows(rows = [], catalog) {
  return mergePerformerRows(rows).map((entry) => {
    const artist = resolveArtistRefs([entry.artist], catalog)[0];
    if (!artist) return null;
    const contributionNames = Array.isArray(entry.contributionNames) ? entry.contributionNames : [];
    const displayContributionNames = artist.type === 'group' && artist.groupType
      ? [artist.groupType]
      : contributionNames;
    return {
      ...entry,
      artist,
      artists: [artist],
      contributionNames: displayContributionNames,
      contributionLabel: displayContributionNames.join(' · '),
      members: resolvePerformerRows(entry.members || [], catalog),
    };
  }).filter(Boolean);
}

function resolveProjectCreditsPayload(rawCredits, snapshot, catalog) {
  const credits = normalizeProjectCredits(rawCredits);
  const manualPerformerRows = (credits.performers || []).flatMap((entry) => (
    normalizeArtistRefs(entry.artists).map((artist) => ({
      artist,
      artists: [artist],
      contributionName: entry.partName,
      members: [],
    }))
  ));
  const performerRows = [
    ...manualPerformerRows,
    ...buildPerformerCreditsFromTracks(snapshot),
  ];
  return {
    artist: resolveCreditEntries(credits.artist, CREDIT_ROLE_OPTIONS.artist, catalog),
    compositionLyrics: resolveCreditEntries(credits.compositionLyrics, CREDIT_ROLE_OPTIONS.compositionLyrics, catalog),
    productionEngineering: resolveCreditEntries(credits.productionEngineering, CREDIT_ROLE_OPTIONS.productionEngineering, catalog),
    performers: resolvePerformerRows(performerRows, catalog),
  };
}

function normalizeOrderIndex(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return NaN;
  return numeric;
}

async function canMutateOwnedEntity(ownerUserId, user) {
  if (String(ownerUserId) === String(user?.id || '')) {
    return true;
  }
  if (!user?.id) {
    return false;
  }
  return await userHasAdminRole(user.id);
}

async function canUserEditTrackInProject(userId, projectId, trackId) {
  const [projectResult, headResult, access] = await Promise.all([
    pool.query(
      `SELECT id,
              created_by AS "createdByUserId"
       FROM projects
       WHERE id = $1`,
      [projectId]
    ),
    pool.query(
      `SELECT latest_snapshot_json
       FROM project_heads
       WHERE project_id = $1`,
      [projectId]
    ),
    getProjectAccess(userId, projectId),
  ]);

  if (projectResult.rowCount === 0 || headResult.rowCount === 0) {
    return false;
  }
  if (!canWriteProjectTracks(access)) {
    return false;
  }

  const snapshot = headResult.rows[0].latest_snapshot_json || {};
  const track = Array.isArray(snapshot?.tracks)
    ? snapshot.tracks.find((entry) => String(entry?.id || '') === String(trackId || ''))
    : null;
  if (!track) {
    return false;
  }

  return canUserMutateTrack({
    access,
    track,
    trackInfoById: buildTrackAccessInfoMap(snapshot),
    userId,
    project: {
      id: projectId,
      showId: headResult.rows[0]?.latest_snapshot_json?.showId || null,
    },
    projectCreatedByUserId: projectResult.rows[0].createdByUserId,
  });
}

async function authorizeProjectMediaAccess(req, res, {
  projectId,
  requireWrite = false,
  requireReferenceMediaId = null,
} = {}) {
  const normalizedProjectId = String(projectId || req.body?.projectId || req.query?.projectId || '').trim();
  if (!normalizedProjectId) {
    res.status(400).json({ error: 'projectId is required' });
    return null;
  }

  const projectExistsResult = await pool.query(
    `SELECT 1
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [normalizedProjectId]
  );
  const projectExists = projectExistsResult.rowCount > 0;

  if (!projectExists && requireWrite) {
    const accessSummary = await getUserAccessSummary(req.user.id);
    if (!accessSummary.canCreateProjects) {
      res.status(403).json({ error: 'No write permission for this project' });
      return null;
    }
    return {
      projectId: normalizedProjectId,
      access: null,
    };
  }

  const access = await getProjectAccess(req.user.id, normalizedProjectId);
  const allowed = requireWrite
    ? canWriteProjectTracks(access)
    : canAccessProjectInPlayer(access);
  if (!allowed) {
    res.status(403).json({
      error: requireWrite
        ? 'No write permission for this project'
        : 'No read permission for this project',
    });
    return null;
  }

  if (requireReferenceMediaId) {
    const referenceResult = await pool.query(
      `SELECT 1
       FROM project_media_refs
       WHERE project_id = $1
         AND media_id = $2
       LIMIT 1`,
      [normalizedProjectId, requireReferenceMediaId]
    );
    if (referenceResult.rowCount === 0) {
      res.status(403).json({ error: 'That media is not available through the selected project' });
      return null;
    }
  }

  return {
    projectId: normalizedProjectId,
    access,
  };
}

async function loadPlayerFolderById(folderId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            name,
            parent_folder_id AS "parentFolderId",
            order_index AS "orderIndex",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM player_folders
     WHERE id = $1`,
    [folderId]
  );
  return result.rows[0] || null;
}

async function loadVirtualMixById(mixId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            project_id AS "projectId",
            name,
            preset_id AS "presetId",
            preset_variant_key AS "presetVariantKey",
            advanced_mix_json AS "advancedMix",
            visibility,
            folder_id AS "folderId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            published_at AS "publishedAt"
     FROM virtual_mixes
     WHERE id = $1`,
    [mixId]
  );
  return result.rows[0] || null;
}

async function loadPlaylistById(playlistId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            name,
            folder_id AS "folderId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM player_playlists
     WHERE id = $1`,
    [playlistId]
  );
  return result.rows[0] || null;
}

async function buildRoleDetailPayload(roleId) {
  const role = await getRoleById(roleId);
  if (!role) return null;
  return {
    ...role,
    parents: await listRoleParents(roleId),
    childRoles: await listRoleChildren(roleId),
    members: await listRoleMembers(roleId),
    oidcLinks: await listRoleOidcLinks(roleId),
    grants: await listRoleGrants(roleId),
    inheritedGrants: await listRoleInheritedGrants(roleId),
  };
}

async function buildUserAccessPayload(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  return {
    user: toAdminUser(user),
    roles: await listUserRoles(userId),
    directGrants: await listUserDirectGrants(userId),
    accessSummary: await getUserAccessSummary(userId),
  };
}

async function buildEffectiveProjectPermissions(projectId) {
  const users = await listUsersWithAuthDetails();
  const permissions = [];
  for (const user of users) {
    const access = await getProjectAccess(user.id, projectId);
    permissions.push({
      userId: user.id,
      username: user.username,
      canSeeShow: Boolean(access.canSeeShow),
      canManageShow: Boolean(access.canManageShow),
      canSeeProject: Boolean(access.canSeeProject),
      canOpenProject: Boolean(access.canOpenProject),
      canCreateProjects: Boolean(access.canCreateProjects),
      canCreateTracks: Boolean(access.canCreateTracks),
      canManageTracks: Boolean(access.canManageTracks),
      canEditAllTracks: Boolean(access.canEditAllTracks),
      canListenTutti: Boolean(access.canListenTutti),
      canReadProject: Boolean(access.canOpenProject),
      canCreateMixes: Boolean(access.canCreateMixes),
      canWriteOwnTracks: Boolean(access.canWriteOwnTracks),
      canWriteScopedTracks: Boolean(access.canWriteScopedTracks),
      canManageOwnProject: Boolean(access.canManageOwnProject),
      canManageProject: Boolean(access.canManageProject),
      canRead: Boolean(access.compatibility?.canRead),
      canWrite: Boolean(access.compatibility?.canWrite),
      updatedAt: user.updatedAt,
    });
  }
  return permissions;
}

app.use(cors((req, callback) => {
  const requestOrigin = String(req.headers.origin || '').trim();
  const allowedOrigin = choosePreferredOrigin(
    config.publicBaseUrl,
    getRequestOrigin(req)
  );

  callback(null, {
    origin: !requestOrigin || !allowedOrigin || requestOrigin === allowedOrigin,
    credentials: true,
  });
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', now: nowIso() });
});

app.get('/api/auth/oidc/start', async (req, res) => {
  try {
    const { url, transaction } = await buildOidcAuthorizationRequest(req);
    setOidcTransactionCookie(res, transaction);
    res.redirect(url.href);
  } catch (error) {
    console.error(error);
    res.redirect(buildAuthErrorRedirect('Failed to start SSO login'));
  }
});

app.get('/api/auth/oidc/callback', async (req, res) => {
  const providerError = String(req.query?.error || '').trim();
  if (providerError) {
    const description = String(req.query?.error_description || providerError).trim();
    clearOidcTransactionCookie(res);
    res.redirect(buildAuthErrorRedirect(description || 'SSO login failed'));
    return;
  }

  const transaction = readOidcTransactionCookie(req);
  clearOidcTransactionCookie(res);
  const missingPkceVerifier = config.oidcUsePkce && !transaction?.codeVerifier;
  if (!transaction?.state || !transaction?.nonce || missingPkceVerifier) {
    res.redirect(buildAuthErrorRedirect('Missing or expired OIDC login transaction'));
    return;
  }

  try {
    const { tokens, claims } = await completeOidcAuthorization(req, transaction);
    if (!claims.subject || !claims.issuer) {
      res.redirect(buildAuthErrorRedirect('OIDC response did not include a stable subject'));
      return;
    }

    const user = await findOrCreateOidcUser(claims);
    if (!user) {
      throw new Error('SSO login succeeded, but Apollo could not resolve or create a local user');
    }
    await issueApolloSession(res, user, {
      oidcIdToken: tokens.id_token || '',
    });
    res.redirect('/');
  } catch (error) {
    console.error(error);
    clearSessionCookies(res);
    res.redirect(buildAuthErrorRedirect(error.message || 'SSO login failed'));
  }
});

app.post('/api/auth/login', async (req, res) => {
  res.status(403).json({ error: 'Local login is disabled. Use SSO.' });
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      clearSessionCookies(res);
      res.status(400).json({ error: 'Missing refresh token' });
      return;
    }

    const persisted = await isRefreshTokenPersisted(refreshToken);
    if (!persisted) {
      clearSessionCookies(res);
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);
    const user = await findUserById(payload.sub);
    if (!user) {
      await revokeRefreshToken(refreshToken);
      clearSessionCookies(res);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    await revokeRefreshToken(refreshToken);
    res.json(await issueApolloSession(res, user, {
      oidcIdToken: getOidcIdTokenCookie(req),
    }));
  } catch (error) {
    clearSessionCookies(res);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const refreshToken = readRefreshToken(req);
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    const redirectUrl = await buildProviderLogoutUrl(req, getOidcIdTokenCookie(req));
    clearOidcTransactionCookie(res);
    clearSessionCookies(res);
    res.json({ ok: true, redirectUrl: redirectUrl || null });
  } catch (error) {
    clearOidcTransactionCookie(res);
    clearSessionCookies(res);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    res.json(await buildSessionPayload(await loadCurrentSessionUser(req.user.id)));
  } catch {
    res.status(401).json({ error: 'User not found' });
  }
});

app.patch('/api/me/profile', requireAuth, async (req, res) => {
  try {
    const updatedUser = await updateUserProfile(req.user.id, {
      artistDisplayName: req.body?.artistDisplayName,
      artistDescription: req.body?.artistDescription,
    });
    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(await buildSessionPayload(updatedUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    if (/artist display name|artist description/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.get('/api/artists/catalog', requireAuth, async (_req, res) => {
  try {
    const catalog = await loadArtistCatalog();
    res.json({
      users: catalog.users,
      groups: catalog.groups,
      guests: catalog.guests,
      artistOptions: [...catalog.users, ...catalog.groups, ...catalog.guests],
      creditRoleOptions: CREDIT_ROLE_OPTIONS,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load artist catalog' });
  }
});

app.post('/api/artists/music-groups', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const groupType = normalizeText(req.body?.groupType);
    const description = normalizeText(req.body?.description);
    if (!name) {
      res.status(400).json({ error: 'Music group name is required' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO music_groups(id, name, group_type, description, created_by)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id, name, group_type AS "groupType", description`,
      [randomUUID(), name, groupType, description, req.user.id]
    );
    res.status(201).json({ group: { type: 'group', ...result.rows[0] } });
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A music group with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create music group' });
  }
});

app.post('/api/artists/guest-artists', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    if (!name) {
      res.status(400).json({ error: 'Guest artist name is required' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO guest_artists(id, name, description, created_by)
       VALUES($1, $2, $3, $4)
       RETURNING id, name, description`,
      [randomUUID(), name, description, req.user.id]
    );
    res.status(201).json({ guest: { type: 'guest', ...result.rows[0] } });
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A guest artist with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create guest artist' });
  }
});

app.get('/api/admin/storage', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const overview = await getMediaStorageOverview(pool, {
      mediaRoot: config.mediaRoot,
      ttlHours: config.mediaGcTtlHours,
    });
    res.json(overview);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load storage overview' });
  }
});

async function sendAdminStorage(res, extra = {}, status = 200) {
  const overview = await getMediaStorageOverview(pool, {
    mediaRoot: config.mediaRoot,
    ttlHours: config.mediaGcTtlHours,
  });
  res.status(status).json({ ...overview, ...extra });
}

function handleMediaGcActionError(res, error, fallbackMessage) {
  if (error instanceof MediaGcActionError) {
    res.status(error.status || 400).json({
      error: error.message,
      ...(error.details || {}),
    });
    return true;
  }
  console.error(error);
  res.status(500).json({ error: fallbackMessage });
  return false;
}

app.post('/api/admin/storage/validate', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await validateUnusedMedia(pool, { attachGraceSeconds: 0 });
    await sendAdminStorage(res, { result });
  } catch (error) {
    handleMediaGcActionError(res, error, 'Failed to validate unused media');
  }
});

app.post('/api/admin/storage/media/:mediaId/quarantine', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await quarantineMediaById(pool, req.params.mediaId);
    await sendAdminStorage(res, { result });
  } catch (error) {
    handleMediaGcActionError(res, error, 'Failed to move media to quarantine');
  }
});

app.delete('/api/admin/storage/media/:mediaId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const force = Boolean(req.body?.force)
      || req.query?.force === 'true'
      || req.query?.force === '1';
    const result = await deleteMediaById(pool, req.params.mediaId, {
      unlinkFile: unlinkMediaFile,
      force,
    });
    await sendAdminStorage(res, { result });
  } catch (error) {
    handleMediaGcActionError(res, error, 'Failed to delete media');
  }
});

app.delete('/api/admin/storage/quarantine', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await deleteQuarantinedMedia(pool, { unlinkFile: unlinkMediaFile });
    await sendAdminStorage(res, { result });
  } catch (error) {
    handleMediaGcActionError(res, error, 'Failed to delete quarantined media');
  }
});

app.get('/api/admin/artists', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const catalog = await loadArtistCatalog();
    const usedKeys = new Set();
    const rowsResult = await pool.query(
      `SELECT p.credits_json AS "projectCredits",
              s.producers AS "showProducers",
              ph.latest_snapshot_json AS "snapshot"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       LEFT JOIN project_heads ph
         ON ph.project_id = p.id`
    );
    rowsResult.rows.forEach((row) => {
      collectArtistRefKeys(row.showProducers, usedKeys);
      collectCreditArtistRefKeys(chooseStoredProjectCredits(row.projectCredits, row.snapshot?.credits), usedKeys);
      (row.snapshot?.tracks || []).forEach((track) => collectArtistRefKeys(track?.artistRefs, usedKeys));
      (row.snapshot?.trackTree || []).forEach((node) => collectArtistRefKeys(node?.artistRefs, usedKeys));
    });

    const users = catalog.users.filter((artist) => usedKeys.has(buildArtistCatalogKey(artist)));
    res.json({
      users,
      groups: catalog.groups,
      guests: catalog.guests,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load artists' });
  }
});

app.patch('/api/admin/artists/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const description = normalizeText(req.body?.description);
    if (description.length > 2000) {
      res.status(400).json({ error: 'Artist description must be 2000 characters or fewer' });
      return;
    }
    const result = await pool.query(
      `UPDATE users
       SET artist_description = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 username,
                 artist_display_name AS "artistDisplayName",
                 artist_description AS "artistDescription",
                 oidc_display_name AS "oidcDisplayName"`,
      [req.params.id, description || null]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }
    const row = result.rows[0];
    res.json({
      artist: {
        type: 'user',
        id: row.id,
        username: row.username,
        name: getEffectiveArtistName(row),
        description: row.artistDescription || '',
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update artist' });
  }
});

app.patch('/api/admin/artists/music-groups/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const groupType = normalizeText(req.body?.groupType);
    const description = normalizeText(req.body?.description);
    if (!name) {
      res.status(400).json({ error: 'Music group name is required' });
      return;
    }
    const result = await pool.query(
      `UPDATE music_groups
       SET name = $2,
           group_type = $3,
           description = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, group_type AS "groupType", description`,
      [req.params.id, name, groupType, description]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Music group not found' });
      return;
    }
    res.json({ group: { type: 'group', ...result.rows[0] } });
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A music group with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update music group' });
  }
});

app.patch('/api/admin/artists/guest-artists/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    if (!name) {
      res.status(400).json({ error: 'Guest artist name is required' });
      return;
    }
    const result = await pool.query(
      `UPDATE guest_artists
       SET name = $2,
           description = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description`,
      [req.params.id, name, description]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Guest artist not found' });
      return;
    }
    res.json({ guest: { type: 'guest', ...result.rows[0] } });
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A guest artist with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update guest artist' });
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const isAdmin = Boolean(req.body?.isAdmin);

    if (!username || !password || password.length < 12) {
      res.status(400).json({ error: 'Username and password (>=12 chars) are required' });
      return;
    }

    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users(id, username, password_hash, is_admin, is_active)
         VALUES($1, $2, $3, $4, TRUE)`,
        [id, username, hash, isAdmin]
      );
      await ensureDefaultUserRoleMembership(id, client);
      if (isAdmin) {
        await addRoleMember('system-role-admin', id, req.user.id, client);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ user: toAdminUser(await findUserById(id)) });
  } catch (error) {
    if (String(error?.message || '').includes('users_username_key')) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  res.json({ users: await listUsersWithAuthDetails() });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = [];
    const values = [];
    let idx = 1;
    const hasIsAdmin = typeof req.body?.isAdmin === 'boolean';

    if (hasIsAdmin) {
      updates.push(`is_admin = $${idx++}`);
      values.push(req.body.isAdmin);
    }
    if (typeof req.body?.password === 'string' && req.body.password.length > 0) {
      if (req.body.password.length < 12) {
        res.status(400).json({ error: 'Password must be at least 12 characters' });
        return;
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (!updates.length) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      updates.push(`updated_at = NOW()`);
      values.push(userId);

      result = await client.query(
        `UPDATE users
         SET ${updates.join(', ')}
         WHERE id = $${idx}
         RETURNING id`,
        values
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (hasIsAdmin) {
        if (req.body.isAdmin) {
          await addRoleMember('system-role-admin', userId, req.user.id, client);
        } else {
          await removeRoleMember('system-role-admin', userId, client);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (!result || result.rowCount === 0) {
      return;
    }

    const updatedUser = await findUserById(userId);
    res.json({ user: toAdminUser(updatedUser) });
  } catch (error) {
    const message = String(error?.message || '');
    if (/at least one active admin/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/admin/users/:id/transfer-ownership', requireAuth, requireAdmin, async (req, res) => {
  try {
    const counts = await transferUserOwnership({
      sourceUserId: req.params.id,
      targetUserId: String(req.body?.targetUserId || ''),
    });
    res.json({ ok: true, counts });
  } catch (error) {
    const message = String(error?.message || 'Failed to transfer ownership');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/required/i.test(message) || /different/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteUserAccount({
      userId: req.params.id,
      transferToUserId: String(req.body?.transferToUserId || ''),
      actorUserId: req.user.id,
    });
    res.json({ ok: true, userId: req.params.id });
  } catch (error) {
    const message = String(error?.message || 'Failed to delete user');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (
      /required/i.test(message)
      || /different/i.test(message)
      || /own user/i.test(message)
      || /at least one active admin/i.test(message)
    ) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.post('/api/admin/users/:id/link-oidc', requireAuth, requireAdmin, async (req, res) => {
  try {
    const linkedUser = await linkPendingOidcIdentityToUser({
      sourceUserId: String(req.body?.sourceUserId || ''),
      targetUserId: req.params.id,
    });
    res.json({ user: toAdminUser(linkedUser) });
  } catch (error) {
    const message = String(error?.message || 'Failed to link OIDC identity');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (
      /required/i.test(message)
      || /already has/i.test(message)
      || /must be different/i.test(message)
      || /pending/i.test(message)
      || /not an oidc/i.test(message)
    ) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to link OIDC identity' });
  }
});

app.get('/api/admin/rbac/catalog', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await getProjectAccessCatalog());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load RBAC catalog' });
  }
});

app.get('/api/admin/roles', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ roles: await listRoles() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load roles' });
  }
});

app.post('/api/admin/roles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const role = await createRole({
      name: req.body?.name,
      description: req.body?.description || '',
    }, req.user.id);
    res.status(201).json({ role });
  } catch (error) {
    const message = String(error?.message || 'Failed to create role');
    if (/required/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    if (/rbac_roles_name_key/i.test(message) || /duplicate/i.test(message)) {
      res.status(409).json({ error: 'Role name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

app.get('/api/admin/roles/:id', requireAuth, requireAdmin, async (req, res) => {
  const role = await buildRoleDetailPayload(req.params.id);
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
  }
  res.json({ role });
});

app.patch('/api/admin/roles/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await updateRole(req.params.id, {
      name: req.body?.name,
      description: req.body?.description,
      emptyAccessMessage: req.body?.emptyAccessMessage,
      parentRoleIds: Array.isArray(req.body?.parentRoleIds) ? req.body.parentRoleIds : undefined,
    });
    res.json({ role: await buildRoleDetailPayload(req.params.id) });
  } catch (error) {
    const message = String(error?.message || 'Failed to update role');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (
      /cannot be modified/i.test(message)
      || /required/i.test(message)
      || /only the default user role/i.test(message)
      || /inherit/i.test(message)
      || /cycle/i.test(message)
    ) {
      res.status(400).json({ error: message });
      return;
    }
    if (/rbac_roles_name_key/i.test(message) || /duplicate/i.test(message)) {
      res.status(409).json({ error: 'Role name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

app.delete('/api/admin/roles/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteRole(req.params.id);
    res.json({ ok: true, roleId: req.params.id });
  } catch (error) {
    const message = String(error?.message || 'Failed to delete role');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/system roles cannot be modified/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

app.post('/api/admin/roles/:id/oidc-links', requireAuth, requireAdmin, async (req, res) => {
  try {
    const link = await createRoleOidcLink(req.params.id, {
      claimPath: req.body?.claimPath,
      claimValue: req.body?.claimValue,
      description: req.body?.description,
    }, req.user.id);
    res.status(201).json({ link });
  } catch (error) {
    const message = String(error?.message || 'Failed to create OIDC role link');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/required/i.test(message) || /automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    if (/duplicate/i.test(message) || /unique/i.test(message) || /idx_rbac_role_oidc_links_unique/i.test(message)) {
      res.status(409).json({ error: 'OIDC link already exists for this role' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create OIDC role link' });
  }
});

app.delete('/api/admin/roles/:roleId/oidc-links/:linkId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteRoleOidcLink(req.params.roleId, req.params.linkId);
    res.json({ ok: true, linkId: req.params.linkId });
  } catch (error) {
    const message = String(error?.message || 'Failed to delete OIDC role link');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to delete OIDC role link' });
  }
});

app.put('/api/admin/roles/:roleId/members/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await addRoleMember(req.params.roleId, req.params.userId, req.user.id);
    res.json({ role: await buildRoleDetailPayload(req.params.roleId) });
  } catch (error) {
    const message = String(error?.message || 'Failed to add role member');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/membership is automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to add role member' });
  }
});

app.delete('/api/admin/roles/:roleId/members/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await removeRoleMember(req.params.roleId, req.params.userId);
    res.json({ role: await buildRoleDetailPayload(req.params.roleId) });
  } catch (error) {
    const message = String(error?.message || 'Failed to remove role member');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/membership is automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    if (/at least one active admin/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to remove role member' });
  }
});

app.post('/api/admin/roles/:id/grants', requireAuth, requireAdmin, async (req, res) => {
  try {
    const grant = await upsertRoleGrant(req.params.id, {
      permissionKey: req.body?.permissionKey ?? req.body?.permission,
      scopeType: req.body?.scopeType,
      scopeShowId: req.body?.scopeShowId,
      scopeProjectId: req.body?.scopeProjectId,
      scopeTrackId: req.body?.scopeTrackId,
      scopeNameValue: req.body?.scopeNameValue,
      capability: req.body?.capability,
      showTargetType: req.body?.showTargetType,
      showTargetShowId: req.body?.showTargetShowId,
      projectTargetType: req.body?.projectTargetType ?? req.body?.scopeType,
      projectTargetProjectId: req.body?.projectTargetProjectId ?? req.body?.scopeProjectId,
      projectTargetValue: req.body?.projectTargetValue ?? req.body?.scopeValue,
      trackScopeType: req.body?.trackScopeType,
      trackScopeValue: req.body?.trackScopeValue,
    }, req.user.id);
    res.status(201).json({ grant });
  } catch (error) {
    const message = String(error?.message || 'Failed to save role grant');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/invalid/i.test(message) || /required/i.test(message) || /grants cannot be modified/i.test(message) || /selected/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to save role grant' });
  }
});

app.delete('/api/admin/roles/:roleId/grants/:grantId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteGrant(req.params.grantId);
    res.json({ ok: true, grantId: req.params.grantId });
  } catch (error) {
    const message = String(error?.message || 'Failed to delete role grant');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/grants cannot be modified/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to delete role grant' });
  }
});

app.get('/api/admin/users/:id/access', requireAuth, requireAdmin, async (req, res) => {
  const payload = await buildUserAccessPayload(req.params.id);
  if (!payload) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(payload);
});

app.put('/api/admin/users/:userId/roles/:roleId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await addRoleMember(req.params.roleId, req.params.userId, req.user.id);
    res.json(await buildUserAccessPayload(req.params.userId));
  } catch (error) {
    const message = String(error?.message || 'Failed to add user role');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/membership is automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to add user role' });
  }
});

app.delete('/api/admin/users/:userId/roles/:roleId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await removeRoleMember(req.params.roleId, req.params.userId);
    res.json(await buildUserAccessPayload(req.params.userId));
  } catch (error) {
    const message = String(error?.message || 'Failed to remove user role');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/membership is automatic/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    if (/at least one active admin/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to remove user role' });
  }
});

app.post('/api/admin/users/:id/grants', requireAuth, requireAdmin, async (req, res) => {
  try {
    const grant = await upsertUserGrant(req.params.id, {
      permissionKey: req.body?.permissionKey ?? req.body?.permission,
      scopeType: req.body?.scopeType,
      scopeShowId: req.body?.scopeShowId,
      scopeProjectId: req.body?.scopeProjectId,
      scopeTrackId: req.body?.scopeTrackId,
      scopeNameValue: req.body?.scopeNameValue,
      capability: req.body?.capability,
      showTargetType: req.body?.showTargetType,
      showTargetShowId: req.body?.showTargetShowId,
      projectTargetType: req.body?.projectTargetType ?? req.body?.scopeType,
      projectTargetProjectId: req.body?.projectTargetProjectId ?? req.body?.scopeProjectId,
      projectTargetValue: req.body?.projectTargetValue ?? req.body?.scopeValue,
      trackScopeType: req.body?.trackScopeType,
      trackScopeValue: req.body?.trackScopeValue,
    }, req.user.id);
    res.status(201).json({ grant });
  } catch (error) {
    const message = String(error?.message || 'Failed to save direct grant');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (/invalid/i.test(message) || /required/i.test(message) || /selected/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to save direct grant' });
  }
});

app.delete('/api/admin/users/:userId/grants/:grantId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteGrant(req.params.grantId);
    res.json({ ok: true, grantId: req.params.grantId });
  } catch (error) {
    const message = String(error?.message || 'Failed to delete direct grant');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to delete direct grant' });
  }
});

app.get('/api/projects', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.name,
            p.published,
            p.musical_number AS "musicalNumber",
            p.scene_order AS "sceneOrder",
            p.show_id AS "showId",
            s.name AS "showName",
            s.order_index AS "showOrderIndex",
            p.created_by AS "createdByUserId",
            ph.latest_seq AS "latestSeq",
            COALESCE(jsonb_array_length(ph.latest_snapshot_json -> 'tracks'), 0) AS "trackCount",
            ph.updated_at AS "updatedAt"
     FROM projects p
     LEFT JOIN shows s
       ON s.id = p.show_id
     LEFT JOIN project_heads ph
       ON ph.project_id = p.id`
  );
  const permissionMap = await buildProjectPermissionMapForRows(req.user.id, result.rows);
  const sortedProjects = result.rows
    .map((row) => attachProjectAccess(row, permissionMap))
    .filter((row) => canAccessProjectInDaw(row.access))
    .sort(compareProjectsByMusicalOrder);
  res.json({ projects: sortedProjects });
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const initialSnapshot = req.body?.initialSnapshot;
    const requestedShowId = String(req.body?.showId || initialSnapshot?.showId || '').trim();
    const requestedMusicalNumber = normalizeMusicalNumber(
      req.body?.musicalNumber ?? initialSnapshot?.musicalNumber ?? '0.0'
    );
    const requestedSceneOrder = normalizeSceneOrder(req.body?.sceneOrder);
    const requestedPublished = normalizeProjectPublished(
      req.body?.published ?? initialSnapshot?.published ?? initialSnapshot?.publish
    );

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }
    if (!isValidMusicalNumber(requestedMusicalNumber)) {
      res.status(400).json({ error: 'Musical number must start with "<number>." (example: 2.1)' });
      return;
    }
    if (Number.isNaN(requestedSceneOrder)) {
      res.status(400).json({ error: 'sceneOrder must be an integer >= 1 when provided' });
      return;
    }
    if (!requestedShowId) {
      res.status(400).json({ error: 'Show is required' });
      return;
    }

    const showResult = await pool.query(
      `SELECT id, name, order_index AS "orderIndex"
       FROM shows
       WHERE id = $1`,
      [requestedShowId]
    );
    if (showResult.rowCount === 0) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    const show = showResult.rows[0];
    if (!(await canCreateProjectsInShow(req.user.id, show.id))) {
      res.status(403).json({ error: 'You do not have permission to create projects in this show' });
      return;
    }

    const projectId = String(req.body?.projectId || randomUUID());
    const snapshot = initialSnapshot && typeof initialSnapshot === 'object'
      ? { ...initialSnapshot, projectId, projectName: name, musicalNumber: requestedMusicalNumber, published: requestedPublished, showId: show.id, showName: show.name, credits: normalizeProjectCredits(initialSnapshot.credits || {}) }
      : {
        projectId,
        projectName: name,
        showId: show.id,
        showName: show.name,
        musicalNumber: requestedMusicalNumber,
        published: requestedPublished,
        sampleRate: 44100,
        masterVolume: 100,
        credits: normalizeProjectCredits({}),
        tracks: [],
        trackTree: [],
        loop: { enabled: false, startMs: 0, endMs: 0 },
      };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO projects(id, name, musical_number, scene_order, show_id, published, created_by, credits_json)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [projectId, name, requestedMusicalNumber, requestedSceneOrder, show.id, requestedPublished, req.user.id, JSON.stringify(normalizeProjectCredits(snapshot.credits || {}))]
      );

      await client.query(
        `INSERT INTO project_heads(project_id, latest_seq, latest_snapshot_json)
         VALUES($1, 0, $2::jsonb)`,
        [projectId, JSON.stringify(snapshot)]
      );

      await client.query(
        `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
         VALUES($1, 0, $2::jsonb, $3)`,
        [projectId, JSON.stringify(snapshot), req.user.id]
      );

      await replaceProjectAccessTags(client, projectId, snapshot);

      await syncProjectMediaRefs(client, projectId, snapshot);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({
      project: {
        id: projectId,
        name,
        showId: show.id,
        showName: show.name,
        showOrderIndex: show.orderIndex,
        musicalNumber: requestedMusicalNumber,
        sceneOrder: requestedSceneOrder,
        published: requestedPublished,
        latestSeq: 0,
      },
      snapshot,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mediaRefRows = await client.query(
      `SELECT media_id
       FROM project_media_refs
       WHERE project_id = $1`,
      [permission.projectId]
    );
    const candidateMediaIds = mediaRefRows.rows.map((row) => row.media_id);

    const deletedProject = await client.query(
      `DELETE FROM projects
       WHERE id = $1
       RETURNING id`,
      [permission.projectId]
    );

    if (deletedProject.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await refreshMediaUnreferencedAt(client, candidateMediaIds);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Failed to delete project' });
    return;
  } finally {
    client.release();
  }

  res.json({ ok: true, projectId: permission.projectId });
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  try {
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasMusicalNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'musicalNumber');
    const hasSceneOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'sceneOrder');
    const hasPublished = Object.prototype.hasOwnProperty.call(req.body || {}, 'published');
    if (!hasName && !hasMusicalNumber && !hasSceneOrder && !hasPublished) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [permission.projectId];
    let idx = 2;
    const snapshotMetadataUpdates = {};

    if (hasName) {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'Project name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(name);
      snapshotMetadataUpdates.projectName = name;
    }

    if (hasMusicalNumber) {
      const musicalNumber = normalizeMusicalNumber(req.body?.musicalNumber);
      if (!isValidMusicalNumber(musicalNumber)) {
        res.status(400).json({ error: 'Musical number must start with "<number>." (example: 2.1)' });
        return;
      }
      updates.push(`musical_number = $${idx++}`);
      values.push(musicalNumber);
      snapshotMetadataUpdates.musicalNumber = musicalNumber;
    }

    if (hasSceneOrder) {
      const sceneOrder = normalizeSceneOrder(req.body?.sceneOrder);
      if (Number.isNaN(sceneOrder)) {
        res.status(400).json({ error: 'sceneOrder must be an integer >= 1 when provided' });
        return;
      }
      updates.push(`scene_order = $${idx++}`);
      values.push(sceneOrder);
    }

    if (hasPublished) {
      const published = normalizeProjectPublished(req.body?.published);
      updates.push(`published = $${idx++}`);
      values.push(published);
      snapshotMetadataUpdates.published = published;
    }

    const client = await pool.connect();
    let updated;
    let broadcastPayload = null;
    try {
      await client.query('BEGIN');
      updated = await client.query(
        `UPDATE projects
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING id, name, published, musical_number AS "musicalNumber", scene_order AS "sceneOrder"`,
        values
      );

      if (updated.rowCount > 0 && Object.keys(snapshotMetadataUpdates).length > 0) {
        const headResult = await client.query(
          `SELECT latest_seq, latest_snapshot_json
           FROM project_heads
           WHERE project_id = $1
           FOR UPDATE`,
          [permission.projectId]
        );
        if (headResult.rowCount === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ error: 'Project head missing' });
          return;
        }

        const head = headResult.rows[0];
        const maxOpSeqResult = await client.query(
          `SELECT COALESCE(MAX(server_seq), 0) AS max_op_seq
           FROM project_ops
           WHERE project_id = $1`,
          [permission.projectId]
        );
        const headLatestSeq = Number(head.latest_seq || 0);
        const maxOpSeq = Number(maxOpSeqResult.rows?.[0]?.max_op_seq || 0);
        const nextSeq = Math.max(headLatestSeq, maxOpSeq) + 1;
        const nextSnapshot = {
          ...(head.latest_snapshot_json || {}),
          ...snapshotMetadataUpdates,
        };
        const op = {
          type: 'project.replace',
          project: nextSnapshot,
        };

        await client.query(
          `INSERT INTO project_ops(project_id, server_seq, client_op_id, user_id, op_json)
           VALUES($1, $2, NULL, $3, $4::jsonb)`,
          [permission.projectId, nextSeq, req.user.id, JSON.stringify(op)]
        );

        await client.query(
          `UPDATE project_heads
           SET latest_seq = $2,
               latest_snapshot_json = $3::jsonb,
               updated_at = NOW()
           WHERE project_id = $1`,
          [permission.projectId, nextSeq, JSON.stringify(nextSnapshot)]
        );

        await client.query(
          `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
           VALUES($1, $2, $3::jsonb, $4)`,
          [permission.projectId, nextSeq, JSON.stringify(nextSnapshot), req.user.id]
        );

        broadcastPayload = {
          projectId: permission.projectId,
          serverSeq: nextSeq,
          clientOpId: null,
          op,
          actor: {
            userId: req.user.id,
            username: req.user.username,
          },
        };
      } else if (updated.rowCount > 0) {
        await client.query(
          `UPDATE project_heads
           SET updated_at = NOW()
           WHERE project_id = $1`,
          [permission.projectId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (updated.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (broadcastPayload) {
      broadcastToProject(permission.projectId, 'op.broadcast', broadcastPayload);
    }

    res.json({ project: updated.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.get('/api/projects/:id/bootstrap', requireAuth, async (req, res) => {
  try {
    const projectId = String(req.params.id || '');
    const purpose = String(req.query?.purpose || 'daw').trim().toLowerCase();
    const access = await getProjectAccess(req.user.id, projectId);
    const canBootstrap = purpose === 'player'
      ? canAccessProjectInPlayer(access)
      : canOpenProjectInDaw(access);
    if (!canBootstrap) {
      res.status(403).json({
        error: purpose === 'player'
          ? 'No player access for this project'
          : 'No DAW access for this project',
      });
      return;
    }

    const knownSeq = Number(req.query.knownSeq || 0);
    const payload = await fetchProjectBootstrap(projectId, knownSeq);
    res.json({
      ...payload,
      access,
      purpose,
    });
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: 'Project not found' });
  }
});

app.get('/api/projects/:id/credits', requireAuth, async (req, res) => {
  try {
    const projectId = String(req.params.id || '');
    const access = await getProjectAccess(req.user.id, projectId);
    if (!canAccessProjectInPlayer(access) && !canAccessProjectInDaw(access)) {
      res.status(403).json({ error: 'No access for this project' });
      return;
    }
    const result = await pool.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              p.credits_json AS "projectCredits",
              s.id AS "showId",
              s.name AS "showName",
              s.description AS "showDescription",
              s.producers AS "showProducers",
              ph.latest_snapshot_json AS "snapshot"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       LEFT JOIN project_heads ph
         ON ph.project_id = p.id
       WHERE p.id = $1`,
      [projectId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const row = result.rows[0];
    const snapshot = row.snapshot || {};
    const catalog = await loadArtistCatalog();
    const rawCredits = chooseStoredProjectCredits(row.projectCredits, snapshot.credits);
    res.json({
      show: {
        id: row.showId,
        name: row.showName || '',
        description: row.showDescription || '',
        producers: resolveArtistRefs(row.showProducers, catalog),
      },
      project: {
        id: row.id,
        name: row.name,
        musicalNumber: row.musicalNumber,
      },
      credits: resolveProjectCreditsPayload(rawCredits, snapshot, catalog),
      creditRoleOptions: CREDIT_ROLE_OPTIONS,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load credits' });
  }
});

app.put('/api/projects/:id/credits', requireAuth, async (req, res) => {
  try {
    const projectId = String(req.params.id || '');
    const access = await getProjectAccess(req.user.id, projectId);
    if (!access?.canManageProject) {
      res.status(403).json({ error: 'Project manager access is required to edit project credits' });
      return;
    }
    const headResult = await pool.query(
      `SELECT latest_snapshot_json
       FROM project_heads
       WHERE project_id = $1`,
      [projectId]
    );
    if (headResult.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const currentSnapshot = headResult.rows[0].latest_snapshot_json || {};
    const credits = normalizeProjectCredits(req.body?.credits || {});
    const result = await appendProjectOp({
      projectId,
      userId: req.user.id,
      clientOpId: null,
      op: {
        type: 'project.replace',
        project: {
          ...currentSnapshot,
          credits,
        },
      },
    });
    await pool.query(
      `UPDATE projects
       SET credits_json = $2::jsonb
       WHERE id = $1`,
      [projectId, JSON.stringify(credits)]
    );
    broadcastToProject(projectId, 'op.broadcast', {
      projectId,
      serverSeq: result.serverSeq,
      clientOpId: null,
      op: result.op,
      actor: {
        userId: req.user.id,
        username: req.user.username,
      },
    });
    res.json({ credits, latestSeq: result.serverSeq });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save project credits' });
  }
});

app.patch('/api/projects/:id/tracks/:trackId/artists', requireAuth, async (req, res) => {
  try {
    const projectId = String(req.params.id || '');
    const trackId = String(req.params.trackId || '');
    const headResult = await pool.query(
      `SELECT latest_snapshot_json
       FROM project_heads
       WHERE project_id = $1`,
      [projectId]
    );
    if (headResult.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const currentSnapshot = headResult.rows[0].latest_snapshot_json || {};
    const tracks = Array.isArray(currentSnapshot.tracks) ? currentSnapshot.tracks : [];
    if (!tracks.some((track) => String(track.id) === trackId)) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    const artistRefs = normalizeArtistRefs(req.body?.artistRefs);
    const nextSnapshot = applyTrackArtistRefsToSnapshot(currentSnapshot, trackId, artistRefs);
    const result = await appendProjectOp({
      projectId,
      userId: req.user.id,
      clientOpId: null,
      op: {
        type: 'project.replace',
        project: nextSnapshot,
      },
    });
    broadcastToProject(projectId, 'op.broadcast', {
      projectId,
      serverSeq: result.serverSeq,
      clientOpId: null,
      op: result.op,
      actor: {
        userId: req.user.id,
        username: req.user.username,
      },
    });
    res.json({ artistRefs, latestSeq: result.serverSeq });
  } catch (error) {
    const message = String(error?.message || 'Failed to save track artists');
    if (/permission|scope|edit|create|manage/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to save track artists' });
  }
});

app.post('/api/projects/:id/checkpoint', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  const headResult = await pool.query(
    `SELECT latest_seq, latest_snapshot_json
     FROM project_heads
     WHERE project_id = $1`,
    [permission.projectId]
  );
  if (headResult.rowCount === 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const head = headResult.rows[0];
  await pool.query(
    `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
     VALUES($1, $2, $3::jsonb, $4)`,
    [permission.projectId, Number(head.latest_seq || 0), JSON.stringify(head.latest_snapshot_json || {}), req.user.id]
  );

  await pool.query(
    `UPDATE project_heads
     SET last_checkpoint_at = NOW(), updated_at = NOW()
     WHERE project_id = $1`,
    [permission.projectId]
  );

  res.json({ ok: true, latestSeq: Number(head.latest_seq || 0) });
});

app.post('/api/projects/:id/local-session', requireAuth, async (req, res) => {
  try {
    const permission = await requireProjectPermission(req, res, 'write');
    if (!permission) return;

    const snapshot = req.body?.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      res.status(400).json({ error: 'Local session snapshot is required' });
      return;
    }

    const clientOpId = String(req.body?.clientOpId || randomUUID());
    const result = await appendProjectOp({
      projectId: permission.projectId,
      userId: req.user.id,
      clientOpId,
      op: {
        type: 'project.replace',
        project: snapshot,
      },
    });

    broadcastToProject(permission.projectId, 'op.broadcast', {
      projectId: permission.projectId,
      serverSeq: result.serverSeq,
      clientOpId,
      op: result.op,
      actor: {
        userId: req.user.id,
        username: req.user.username,
      },
    });

    res.json({
      latestSeq: result.serverSeq,
      snapshot: result.snapshot,
    });
  } catch (error) {
    const message = String(error?.message || 'Failed to save local session');
    if (/permission|scope|edit|create|manage/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to save local session' });
  }
});

app.get('/api/projects/:projectId/permissions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '');
    if (!projectId) {
      res.status(400).json({ error: 'Missing project id' });
      return;
    }
    res.json({ permissions: await buildEffectiveProjectPermissions(projectId) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load project permissions' });
  }
});

app.put('/api/projects/:projectId/permissions/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '');
    if (!projectId) {
      res.status(400).json({ error: 'Missing project id' });
      return;
    }
    await syncLegacyProjectPermission(
      req.params.userId,
      projectId,
      {
        canRead: Boolean(req.body?.canRead),
        canWrite: Boolean(req.body?.canWrite),
      },
      req.user.id
    );
    res.json({ ok: true });
  } catch (error) {
    const message = String(error?.message || 'Failed to update project permission');
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update project permission' });
  }
});

app.get('/api/shows', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id,
              s.name,
              s.order_index AS "orderIndex",
              s.created_by AS "createdByUserId",
              COUNT(p.id)::integer AS "projectCount"
       FROM shows s
       LEFT JOIN projects p
         ON p.show_id = s.id
       GROUP BY s.id, s.name, s.order_index, s.created_by
       ORDER BY s.order_index ASC, s.name ASC`
    );
    const accessMap = await buildShowAccessMapForRows(req.user.id, result.rows);
    res.json({
      shows: result.rows
        .map((row) => attachShowAccess(row, accessMap))
        .filter((row) => row.canSeeShow || row.canCreateProjects || row.canManageShow),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load shows' });
  }
});

app.post('/api/admin/shows', requireAuth, async (req, res) => {
  try {
    const accessSummary = await getUserAccessSummary(req.user.id);
    if (!accessSummary.canCreateShows) {
      res.status(403).json({ error: 'You do not have permission to create shows' });
      return;
    }
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Show name is required' });
      return;
    }
    const orderResult = await pool.query('SELECT COALESCE(MAX(order_index), -1) + 1 AS "nextOrder" FROM shows');
    const id = randomUUID();
    const result = await pool.query(
      `INSERT INTO shows(id, name, order_index, created_by)
       VALUES($1, $2, $3, $4)
       RETURNING id, name, order_index AS "orderIndex", 0::integer AS "projectCount"`,
      [id, name, Number(orderResult.rows[0]?.nextOrder || 0), req.user.id]
    );
    res.status(201).json({ show: result.rows[0] });
  } catch (error) {
    const message = String(error?.message || 'Failed to create show');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A show with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create show' });
  }
});

app.patch('/api/admin/shows/:id', requireAuth, async (req, res) => {
  const showId = String(req.params.id || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!showId || !name) {
    res.status(400).json({ error: 'Show name is required' });
    return;
  }

  const showAccessMap = await getShowAccessMap(req.user.id, [{ id: showId }], pool);
  if (!showAccessMap.get(showId)?.canManageShow) {
    res.status(403).json({ error: 'You do not have permission to rename this show' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE shows
       SET name = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, order_index AS "orderIndex"`,
      [showId, name]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Show not found' });
      return;
    }

    await client.query(
      `UPDATE project_heads ph
       SET latest_snapshot_json = jsonb_set(
             COALESCE(ph.latest_snapshot_json, '{}'::jsonb),
             '{showName}',
             to_jsonb($2::text),
             true
           ),
           updated_at = NOW()
       FROM projects p
       WHERE p.id = ph.project_id
         AND p.show_id = $1`,
      [showId, name]
    );

    const countResult = await client.query(
      `SELECT COUNT(*)::integer AS "projectCount"
       FROM projects
       WHERE show_id = $1`,
      [showId]
    );
    await client.query('COMMIT');
    res.json({
      show: {
        ...result.rows[0],
        projectCount: Number(countResult.rows[0]?.projectCount || 0),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = String(error?.message || 'Failed to rename show');
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: 'A show with that name already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to rename show' });
  } finally {
    client.release();
  }
});

app.get('/api/shows/:id/metadata', requireAuth, async (req, res) => {
  try {
    const showId = String(req.params.id || '').trim();
    const accessMap = await getShowAccessMap(req.user.id, [{ id: showId }], pool);
    if (!accessMap.get(showId)?.canSeeShow && !accessMap.get(showId)?.canManageShow) {
      res.status(403).json({ error: 'No access for this show' });
      return;
    }
    const result = await pool.query(
      `SELECT id, name, description, producers
       FROM shows
       WHERE id = $1`,
      [showId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    const catalog = await loadArtistCatalog();
    const show = result.rows[0];
    res.json({
      show: {
        id: show.id,
        name: show.name,
        description: show.description || '',
        producers: resolveArtistRefs(show.producers, catalog),
        producerRefs: normalizeArtistRefs(show.producers),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load show metadata' });
  }
});

app.patch('/api/shows/:id/metadata', requireAuth, async (req, res) => {
  try {
    const showId = String(req.params.id || '').trim();
    const accessMap = await getShowAccessMap(req.user.id, [{ id: showId }], pool);
    if (!accessMap.get(showId)?.canManageShow) {
      res.status(403).json({ error: 'Show manager access is required to edit show metadata' });
      return;
    }
    const description = normalizeText(req.body?.description);
    if (description.length > 4000) {
      res.status(400).json({ error: 'Show description must be 4000 characters or fewer' });
      return;
    }
    const producers = normalizeArtistRefs(req.body?.producers || req.body?.producerRefs);
    const result = await pool.query(
      `UPDATE shows
       SET description = $2,
           producers = $3::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, producers`,
      [showId, description, JSON.stringify(producers)]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    const catalog = await loadArtistCatalog();
    const show = result.rows[0];
    res.json({
      show: {
        id: show.id,
        name: show.name,
        description: show.description || '',
        producers: resolveArtistRefs(show.producers, catalog),
        producerRefs: normalizeArtistRefs(show.producers),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save show metadata' });
  }
});

app.get('/api/player/my-device', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = await userHasAdminRole(userId);
    const [folderResult, mixResult, playlistResult, playlistItemResult] = await Promise.all([
      pool.query(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                name,
                parent_folder_id AS "parentFolderId",
                order_index AS "orderIndex",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM player_folders
         WHERE owner_user_id = $1
         ORDER BY parent_folder_id NULLS FIRST, order_index ASC, name ASC`,
        [userId]
      ),
      pool.query(
        `SELECT vm.id,
                vm.owner_user_id AS "ownerUserId",
                vm.project_id AS "projectId",
                vm.name,
                vm.preset_id AS "presetId",
                vm.preset_variant_key AS "presetVariantKey",
                vm.advanced_mix_json AS "advancedMix",
                vm.visibility,
                vm.folder_id AS "folderId",
                vm.created_at AS "createdAt",
                vm.updated_at AS "updatedAt",
                vm.published_at AS "publishedAt",
                p.name AS "projectName",
                p.musical_number AS "musicalNumber",
                p.scene_order AS "sceneOrder",
                p.show_id AS "showId",
                s.name AS "showName",
                s.order_index AS "showOrderIndex"
         FROM virtual_mixes vm
         JOIN projects p
           ON p.id = vm.project_id
         LEFT JOIN shows s
           ON s.id = p.show_id
         WHERE vm.owner_user_id = $1
         ORDER BY vm.updated_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                name,
                folder_id AS "folderId",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM player_playlists
         WHERE owner_user_id = $1
         ORDER BY updated_at DESC, created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT pli.id,
                pli.playlist_id AS "playlistId",
                pli.mix_id AS "mixId",
                pli.order_index AS "orderIndex",
                pli.created_at AS "createdAt",
                vm.owner_user_id AS "mixOwnerUserId",
                vm.project_id AS "projectId",
                vm.name AS "mixName",
                vm.preset_id AS "presetId",
                vm.preset_variant_key AS "presetVariantKey",
                vm.advanced_mix_json AS "advancedMix",
                vm.visibility AS "mixVisibility",
                vm.folder_id AS "mixFolderId",
                vm.created_at AS "mixCreatedAt",
                vm.updated_at AS "mixUpdatedAt",
                vm.published_at AS "mixPublishedAt",
                p.name AS "projectName",
                p.musical_number AS "musicalNumber",
                p.scene_order AS "sceneOrder",
                p.show_id AS "showId",
                s.name AS "showName",
                s.order_index AS "showOrderIndex"
         FROM player_playlist_items pli
         JOIN player_playlists pl
           ON pl.id = pli.playlist_id
         LEFT JOIN virtual_mixes vm
           ON vm.id = pli.mix_id
         LEFT JOIN projects p
           ON p.id = vm.project_id
         LEFT JOIN shows s
           ON s.id = p.show_id
         WHERE pl.owner_user_id = $1
         ORDER BY pli.playlist_id ASC, pli.order_index ASC`,
        [userId]
      ),
    ]);

    const permissionRows = [
      ...mixResult.rows,
      ...playlistItemResult.rows,
    ].filter((row) => row.projectId);
    const permissionMap = await buildProjectPermissionMapForRows(userId, permissionRows);

    const playlistItemsByPlaylistId = {};
    playlistResult.rows.forEach((playlist) => {
      playlistItemsByPlaylistId[playlist.id] = [];
    });

    playlistItemResult.rows.forEach((row) => {
      const permission = row.projectId
        ? (permissionMap.get(String(row.projectId)) || null)
        : null;
      const readable = Boolean(
        row.mixId
        && (
          isAdmin
          || row.mixOwnerUserId === userId
          || (row.mixVisibility === 'global' && canCreateProjectMixes(permission))
        )
      );
      const mix = readable
        ? {
          id: row.mixId,
          ownerUserId: row.mixOwnerUserId,
          projectId: row.projectId,
          name: row.mixName,
          presetId: row.presetId,
          presetVariantKey: row.presetVariantKey,
          advancedMix: row.advancedMix || {},
          visibility: row.mixVisibility,
          folderId: row.mixFolderId,
          createdAt: row.mixCreatedAt,
          updatedAt: row.mixUpdatedAt,
          publishedAt: row.mixPublishedAt,
          projectName: row.projectName,
          musicalNumber: row.musicalNumber,
          sceneOrder: row.sceneOrder,
          showId: row.showId,
          showName: row.showName,
          showOrderIndex: row.showOrderIndex,
          canRead: true,
          canWrite: Boolean(isAdmin || permission?.compatibility?.canWrite),
          canCreateMixes: Boolean(isAdmin || canCreateProjectMixes(permission)),
        }
        : null;
      const item = {
        id: row.id,
        playlistId: row.playlistId,
        mixId: row.mixId,
        orderIndex: Number(row.orderIndex || 0),
        createdAt: row.createdAt,
        unavailable: !readable,
        mix,
      };
      if (!playlistItemsByPlaylistId[row.playlistId]) {
        playlistItemsByPlaylistId[row.playlistId] = [];
      }
      playlistItemsByPlaylistId[row.playlistId].push(item);
    });

    res.json({
      folders: folderResult.rows,
      mixes: mixResult.rows.map((row) => {
        const permission = permissionMap.get(String(row.projectId)) || null;
        return {
          ...row,
          access: permission,
          canRead: Boolean(isAdmin || permission?.compatibility?.canRead),
          canWrite: Boolean(isAdmin || permission?.compatibility?.canWrite),
          canCreateMixes: Boolean(isAdmin || canCreateProjectMixes(permission)),
        };
      }),
      playlists: playlistResult.rows,
      playlistItemsByPlaylistId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load player library' });
  }
});

app.get('/api/player/tutti', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name,
              p.published,
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              p.show_id AS "showId",
              s.name AS "showName",
              s.order_index AS "showOrderIndex",
              p.created_by AS "createdByUserId"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id`
    );
    const permissionMap = await buildProjectPermissionMapForRows(req.user.id, result.rows);
    const projects = result.rows
      .map((row) => attachProjectAccess(row, permissionMap))
      .filter((row) => canAccessProjectInPlayer(row.access))
      .sort(compareProjectsByMusicalOrder);
    res.json({
      mixes: projects.map((project) => ({
        id: `tutti:${project.id}`,
        projectId: project.id,
        name: project.name,
        presetId: 'tutti',
        presetVariantKey: null,
        published: Boolean(project.published),
        musicalNumber: project.musicalNumber,
        sceneOrder: project.sceneOrder,
        showId: project.showId,
        showName: project.showName,
        showOrderIndex: project.showOrderIndex,
        canWrite: Boolean(project.canWrite),
        canCreateMixes: Boolean(project.canCreateMixes),
        canListenTutti: Boolean(project.canListenTutti),
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load tutti mixes' });
  }
});

app.get('/api/player/mixes/global', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vm.id,
              vm.owner_user_id AS "ownerUserId",
              vm.project_id AS "projectId",
              vm.name,
              vm.preset_id AS "presetId",
              vm.preset_variant_key AS "presetVariantKey",
              vm.advanced_mix_json AS "advancedMix",
              vm.visibility,
              vm.folder_id AS "folderId",
              vm.created_at AS "createdAt",
              vm.updated_at AS "updatedAt",
              vm.published_at AS "publishedAt",
              p.name AS "projectName",
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              p.show_id AS "showId",
              s.name AS "showName",
              s.order_index AS "showOrderIndex",
              p.created_by AS "createdByUserId",
              u.username AS "ownerUsername"
       FROM virtual_mixes vm
       JOIN projects p
         ON p.id = vm.project_id
       LEFT JOIN shows s
         ON s.id = p.show_id
       JOIN users u
         ON u.id = vm.owner_user_id
       WHERE vm.visibility = 'global'
       ORDER BY vm.published_at DESC NULLS LAST, vm.updated_at DESC`,
      []
    );
    const permissionMap = await buildProjectPermissionMapForRows(req.user.id, result.rows);
    res.json({
      mixes: result.rows
        .map((row) => ({
          ...row,
          access: permissionMap.get(String(row.projectId)) || null,
          canWrite: Boolean((permissionMap.get(String(row.projectId)) || {}).compatibility?.canWrite),
          canRead: Boolean((permissionMap.get(String(row.projectId)) || {}).compatibility?.canRead),
          canCreateMixes: Boolean(canCreateProjectMixes(permissionMap.get(String(row.projectId)) || null)),
        }))
        .filter((row) => row.canCreateMixes),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load global mixes' });
  }
});

app.post('/api/player/folders', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const parentFolderId = normalizeOptionalText(req.body?.parentFolderId);
    const orderIndexRaw = normalizeOrderIndex(req.body?.orderIndex);
    const orderIndex = Number.isNaN(orderIndexRaw) ? null : orderIndexRaw;
    if (!name) {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }
    if (Number.isNaN(orderIndexRaw)) {
      res.status(400).json({ error: 'orderIndex must be an integer >= 0 when provided' });
      return;
    }

    if (parentFolderId) {
      const parentFolder = await loadPlayerFolderById(parentFolderId);
      if (!parentFolder || parentFolder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Parent folder not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO player_folders(id, owner_user_id, name, parent_folder_id, order_index)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 parent_folder_id AS "parentFolderId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [randomUUID(), req.user.id, name, parentFolderId, orderIndex ?? 0]
    );

    res.status(201).json({ folder: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.patch('/api/player/folders/:id', requireAuth, async (req, res) => {
  try {
    const folder = await loadPlayerFolderById(req.params.id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(folder.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to edit this folder' });
      return;
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasParentFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentFolderId');
    const hasOrderIndex = Object.prototype.hasOwnProperty.call(req.body || {}, 'orderIndex');
    if (!hasName && !hasParentFolderId && !hasOrderIndex) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [folder.id];
    let idx = 2;

    if (hasName) {
      const nextName = normalizeText(req.body?.name);
      if (!nextName) {
        res.status(400).json({ error: 'Folder name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(nextName);
    }

    if (hasParentFolderId) {
      const nextParentFolderId = normalizeOptionalText(req.body?.parentFolderId);
      if (nextParentFolderId) {
        if (nextParentFolderId === folder.id) {
          res.status(400).json({ error: 'Folder cannot be parent of itself' });
          return;
        }
        const parentFolder = await loadPlayerFolderById(nextParentFolderId);
        if (!parentFolder || parentFolder.ownerUserId !== folder.ownerUserId) {
          res.status(400).json({ error: 'Parent folder not found' });
          return;
        }

        const cycleCheck = await pool.query(
          `WITH RECURSIVE descendants AS (
             SELECT id
             FROM player_folders
             WHERE id = $1
             UNION ALL
             SELECT pf.id
             FROM player_folders pf
             JOIN descendants d
               ON pf.parent_folder_id = d.id
           )
           SELECT 1
           FROM descendants
           WHERE id = $2
           LIMIT 1`,
          [folder.id, nextParentFolderId]
        );
        if (cycleCheck.rowCount > 0) {
          res.status(400).json({ error: 'Cannot move folder into itself or descendant folder' });
          return;
        }
      }
      updates.push(`parent_folder_id = $${idx++}`);
      values.push(nextParentFolderId);
    }

    if (hasOrderIndex) {
      const nextOrderIndex = normalizeOrderIndex(req.body?.orderIndex);
      if (Number.isNaN(nextOrderIndex)) {
        res.status(400).json({ error: 'orderIndex must be an integer >= 0 when provided' });
        return;
      }
      updates.push(`order_index = $${idx++}`);
      values.push(nextOrderIndex ?? 0);
    }

    const result = await pool.query(
      `UPDATE player_folders
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 parent_folder_id AS "parentFolderId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      values
    );

    res.json({ folder: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

app.delete('/api/player/folders/:id', requireAuth, async (req, res) => {
  try {
    const folder = await loadPlayerFolderById(req.params.id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(folder.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to delete this folder' });
      return;
    }

    const countResult = await pool.query(
      `SELECT
          (SELECT COUNT(*)::integer FROM player_folders WHERE parent_folder_id = $1) AS "childCount",
          (SELECT COUNT(*)::integer FROM virtual_mixes WHERE folder_id = $1) AS "mixCount"`,
      [folder.id]
    );
    const childCount = Number(countResult.rows?.[0]?.childCount || 0);
    const mixCount = Number(countResult.rows?.[0]?.mixCount || 0);
    if (childCount > 0 || mixCount > 0) {
      res.status(409).json({ error: 'Folder is not empty' });
      return;
    }

    await pool.query(`DELETE FROM player_folders WHERE id = $1`, [folder.id]);
    res.json({ ok: true, folderId: folder.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

app.post('/api/player/mixes', requireAuth, async (req, res) => {
  try {
    const projectId = normalizeText(req.body?.projectId);
    const name = normalizeText(req.body?.name);
    const presetId = normalizeText(req.body?.presetId);
    const presetVariantKey = normalizeOptionalText(req.body?.presetVariantKey);
    const folderId = normalizeOptionalText(req.body?.folderId);
    const advancedMix = req.body?.advancedMix && typeof req.body.advancedMix === 'object'
      ? req.body.advancedMix
      : {};
    if (!projectId || !name || !presetId) {
      res.status(400).json({ error: 'projectId, name, and presetId are required' });
      return;
    }

    const projectExists = await pool.query(
      `SELECT id
       FROM projects
       WHERE id = $1`,
      [projectId]
    );
    if (projectExists.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const access = await getProjectAccess(req.user.id, projectId);
    if (!canCreateProjectMixes(access)) {
      res.status(403).json({ error: 'No permission to create mixes from this project' });
      return;
    }

    if (folderId) {
      const folder = await loadPlayerFolderById(folderId);
      if (!folder || folder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Folder not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO virtual_mixes(
          id, owner_user_id, project_id, name, preset_id, preset_variant_key, advanced_mix_json, visibility, folder_id
       )
       VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, 'private', $8)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 advanced_mix_json AS "advancedMix",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [randomUUID(), req.user.id, projectId, name, presetId, presetVariantKey, JSON.stringify(advancedMix), folderId]
    );
    res.status(201).json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create virtual mix' });
  }
});

app.patch('/api/player/mixes/:id', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(mix.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to edit this mix' });
      return;
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasPresetId = Object.prototype.hasOwnProperty.call(req.body || {}, 'presetId');
    const hasPresetVariantKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'presetVariantKey');
    const hasFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'folderId');
    const hasAdvancedMix = Object.prototype.hasOwnProperty.call(req.body || {}, 'advancedMix');
    if (!hasName && !hasPresetId && !hasPresetVariantKey && !hasFolderId && !hasAdvancedMix) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [mix.id];
    let idx = 2;

    if (hasName) {
      const nextName = normalizeText(req.body?.name);
      if (!nextName) {
        res.status(400).json({ error: 'Mix name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(nextName);
    }

    if (hasPresetId) {
      const nextPresetId = normalizeText(req.body?.presetId);
      if (!nextPresetId) {
        res.status(400).json({ error: 'presetId is required' });
        return;
      }
      updates.push(`preset_id = $${idx++}`);
      values.push(nextPresetId);
    }

    if (hasPresetVariantKey) {
      const nextVariant = normalizeOptionalText(req.body?.presetVariantKey);
      updates.push(`preset_variant_key = $${idx++}`);
      values.push(nextVariant);
    }

    if (hasFolderId) {
      const nextFolderId = normalizeOptionalText(req.body?.folderId);
      if (nextFolderId) {
        const folder = await loadPlayerFolderById(nextFolderId);
        if (!folder || folder.ownerUserId !== mix.ownerUserId) {
          res.status(400).json({ error: 'Folder not found' });
          return;
        }
      }
      updates.push(`folder_id = $${idx++}`);
      values.push(nextFolderId);
    }

    if (hasAdvancedMix) {
      const nextAdvancedMix = req.body?.advancedMix && typeof req.body.advancedMix === 'object'
        ? req.body.advancedMix
        : {};
      updates.push(`advanced_mix_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(nextAdvancedMix));
    }

    const result = await pool.query(
      `UPDATE virtual_mixes
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 advanced_mix_json AS "advancedMix",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      values
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update mix' });
  }
});

app.delete('/api/player/mixes/:id', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(mix.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to delete this mix' });
      return;
    }

    await pool.query(`DELETE FROM virtual_mixes WHERE id = $1`, [mix.id]);
    res.json({ ok: true, mixId: mix.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete mix' });
  }
});

app.post('/api/player/mixes/:id/publish', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(mix.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to publish this mix' });
      return;
    }
    const result = await pool.query(
      `UPDATE virtual_mixes
       SET visibility = 'global',
           published_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 advanced_mix_json AS "advancedMix",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [mix.id]
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to publish mix' });
  }
});

app.post('/api/player/mixes/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(mix.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to unpublish this mix' });
      return;
    }
    const result = await pool.query(
      `UPDATE virtual_mixes
       SET visibility = 'private',
           published_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 advanced_mix_json AS "advancedMix",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [mix.id]
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to unpublish mix' });
  }
});

app.post('/api/player/playlists', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const folderId = normalizeOptionalText(req.body?.folderId);
    if (!name) {
      res.status(400).json({ error: 'Playlist name is required' });
      return;
    }
    if (folderId) {
      const folder = await loadPlayerFolderById(folderId);
      if (!folder || folder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Folder not found' });
        return;
      }
    }
    const result = await pool.query(
      `INSERT INTO player_playlists(id, owner_user_id, name, folder_id)
       VALUES($1, $2, $3, $4)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [randomUUID(), req.user.id, name, folderId]
    );
    res.status(201).json({ playlist: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

app.patch('/api/player/playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(playlist.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'folderId');
    if (!hasName && !hasFolderId) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [playlist.id];
    let idx = 2;

    if (hasName) {
      const name = normalizeText(req.body?.name);
      if (!name) {
        res.status(400).json({ error: 'Playlist name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(name);
    }

    if (hasFolderId) {
      const folderId = normalizeOptionalText(req.body?.folderId);
      if (folderId) {
        const folder = await loadPlayerFolderById(folderId);
        if (!folder || folder.ownerUserId !== playlist.ownerUserId) {
          res.status(400).json({ error: 'Folder not found' });
          return;
        }
      }
      updates.push(`folder_id = $${idx++}`);
      values.push(folderId);
    }

    const result = await pool.query(
      `UPDATE player_playlists
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      values
    );
    res.json({ playlist: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

app.delete('/api/player/playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(playlist.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to delete this playlist' });
      return;
    }
    await pool.query(`DELETE FROM player_playlists WHERE id = $1`, [playlist.id]);
    res.json({ ok: true, playlistId: playlist.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

app.post('/api/player/playlists/:id/items', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(playlist.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }

    const mixId = normalizeText(req.body?.mixId);
    if (!mixId) {
      res.status(400).json({ error: 'mixId is required' });
      return;
    }
    const mixPermission = await pool.query(
      `SELECT vm.id,
              vm.owner_user_id AS "ownerUserId",
              vm.project_id AS "projectId",
              vm.visibility AS "visibility"
       FROM virtual_mixes vm
       WHERE vm.id = $1`,
      [mixId]
    );
    if (mixPermission.rowCount === 0) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    const mixRow = mixPermission.rows[0];
    const isAdmin = await userHasAdminRole(req.user.id);
    const access = await getProjectAccess(req.user.id, mixRow.projectId);
    const canUse = Boolean(
      isAdmin
      || mixRow.ownerUserId === req.user.id
      || (mixRow.visibility === 'global' && canCreateProjectMixes(access))
    );
    if (!canUse) {
      res.status(403).json({ error: 'No permission to use this mix in playlist' });
      return;
    }

    const nextIndexResult = await pool.query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS "nextIndex"
       FROM player_playlist_items
       WHERE playlist_id = $1`,
      [playlist.id]
    );
    const nextIndex = Number(nextIndexResult.rows?.[0]?.nextIndex || 0);
    const result = await pool.query(
      `INSERT INTO player_playlist_items(id, playlist_id, mix_id, order_index)
       VALUES($1, $2, $3, $4)
       RETURNING id,
                 playlist_id AS "playlistId",
                 mix_id AS "mixId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt"`,
      [randomUUID(), playlist.id, mixId, nextIndex]
    );
    await pool.query(
      `UPDATE player_playlists
       SET updated_at = NOW()
       WHERE id = $1`,
      [playlist.id]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add playlist item' });
  }
});

app.patch('/api/player/playlists/:id/items/reorder', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(playlist.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to reorder this playlist' });
      return;
    }

    const orderedItemIds = Array.isArray(req.body?.orderedItemIds)
      ? req.body.orderedItemIds.map((value) => String(value))
      : null;
    if (!orderedItemIds) {
      res.status(400).json({ error: 'orderedItemIds array is required' });
      return;
    }
    if (new Set(orderedItemIds).size !== orderedItemIds.length) {
      res.status(400).json({ error: 'orderedItemIds must not contain duplicates' });
      return;
    }

    const existingResult = await pool.query(
      `SELECT id
       FROM player_playlist_items
       WHERE playlist_id = $1
       ORDER BY order_index ASC, created_at ASC`,
      [playlist.id]
    );
    const existingIds = existingResult.rows.map((row) => row.id);
    if (existingIds.length !== orderedItemIds.length) {
      res.status(400).json({ error: 'orderedItemIds must include all playlist item ids exactly once' });
      return;
    }
    const existingSet = new Set(existingIds);
    const allKnown = orderedItemIds.every((id) => existingSet.has(id));
    if (!allKnown) {
      res.status(400).json({ error: 'orderedItemIds contains unknown item ids' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedItemIds.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, orderedItemIds[i], -(i + 1)]
        );
      }
      for (let i = 0; i < orderedItemIds.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, orderedItemIds[i], i]
        );
      }
      await client.query(
        `UPDATE player_playlists
         SET updated_at = NOW()
         WHERE id = $1`,
        [playlist.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to reorder playlist items' });
  }
});

app.delete('/api/player/playlists/:id/items/:itemId', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!(await canMutateOwnedEntity(playlist.ownerUserId, req.user))) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(
        `DELETE FROM player_playlist_items
         WHERE playlist_id = $1 AND id = $2
         RETURNING id`,
        [playlist.id, req.params.itemId]
      );
      if (deleted.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Playlist item not found' });
        return;
      }

      const remaining = await client.query(
        `SELECT id
         FROM player_playlist_items
         WHERE playlist_id = $1
         ORDER BY order_index ASC, created_at ASC`,
        [playlist.id]
      );
      for (let i = 0; i < remaining.rows.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, remaining.rows[i].id, i]
        );
      }
      await client.query(
        `UPDATE player_playlists
         SET updated_at = NOW()
         WHERE id = $1`,
        [playlist.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, itemId: req.params.itemId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete playlist item' });
  }
});

app.post('/api/media/register', requireAuth, async (req, res) => {
  try {
    const authorization = await authorizeProjectMediaAccess(req, res, { requireWrite: true });
    if (!authorization) return;

    const mediaId = String(req.body?.mediaId || randomUUID());
    const sha256 = String(req.body?.sha256 || '').trim();
    const mimeType = String(req.body?.mimeType || 'application/octet-stream');
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    const fileName = toSafeName(String(req.body?.fileName || mediaId));

    if (!sha256 || sizeBytes <= 0) {
      res.status(400).json({ error: 'sha256 and sizeBytes are required' });
      return;
    }

    const existing = await pool.query(
      `SELECT id
       FROM media_objects
       WHERE sha256 = $1 OR id = $2`,
      [sha256, mediaId]
    );

    if (existing.rowCount > 0) {
      res.json({ mediaId: existing.rows[0].id, exists: true });
      return;
    }

    const diskPath = buildStoredMediaPath(mediaId, fileName);
    await pool.query(
      `INSERT INTO media_objects(id, sha256, mime_type, size_bytes, path, created_by)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [mediaId, sha256, mimeType, sizeBytes, diskPath, req.user.id]
    );

    res.status(201).json({ mediaId, exists: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to register media' });
  }
});

app.put('/api/media/:mediaId/content', requireAuth, express.raw({ type: '*/*', limit: config.maxUploadBytes }), async (req, res) => {
  try {
    const authorization = await authorizeProjectMediaAccess(req, res, {
      projectId: req.query?.projectId,
      requireWrite: true,
    });
    if (!authorization) return;

    const mediaId = req.params.mediaId;
    const recordResult = await pool.query(
      `SELECT path, size_bytes AS "sizeBytes"
       FROM media_objects
       WHERE id = $1`,
      [mediaId]
    );

    if (recordResult.rowCount === 0) {
      res.status(404).json({ error: 'Media not registered' });
      return;
    }

    const record = recordResult.rows[0];
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Missing binary payload' });
      return;
    }

    if (Number(record.sizeBytes || 0) !== buffer.length) {
      res.status(400).json({ error: 'Upload size mismatch' });
      return;
    }

    const diskPath = resolveMediaPath(record.path);
    await fs.writeFile(diskPath, buffer);
    res.json({ ok: true, mediaId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to store media content' });
  }
});

app.get('/api/media/:mediaId', requireAuth, async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    const authorization = await authorizeProjectMediaAccess(req, res, {
      projectId: req.query?.projectId,
      requireWrite: false,
      requireReferenceMediaId: mediaId,
    });
    if (!authorization) return;

    const result = await pool.query(
      `SELECT path, mime_type AS "mimeType", size_bytes AS "sizeBytes"
       FROM media_objects
       WHERE id = $1`,
      [mediaId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const media = result.rows[0];
    const diskPath = resolveMediaPath(media.path);
    if (!fssync.existsSync(diskPath)) {
      res.status(404).json({ error: 'Media file is missing on disk' });
      return;
    }

    const stat = await fs.stat(diskPath);
    const totalSize = Number(stat.size || 0);

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) {
        res.status(416).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : totalSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= totalSize) {
        res.status(416).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      fssync.createReadStream(diskPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', totalSize);
    fssync.createReadStream(diskPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

app.post('/api/media/batch-resolve', requireAuth, async (req, res) => {
  try {
    const authorization = await authorizeProjectMediaAccess(req, res, { requireWrite: true });
    if (!authorization) return;

    const mediaIds = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds.slice(0, 5000) : [];
    if (!mediaIds.length) {
      res.json({ found: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id
       FROM media_objects
       WHERE id = ANY($1::text[])`,
      [mediaIds]
    );
    const found = new Set(result.rows.map((row) => row.id));
    res.json({
      found: mediaIds.filter((id) => found.has(id)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to resolve media ids' });
  }
});

wsServer.on('connection', (ws, req) => {
  const authenticatedUser = req.user || null;
  ws.session = {
    userId: authenticatedUser?.id || null,
    username: authenticatedUser?.username || null,
    isAdmin: Boolean(authenticatedUser?.isAdmin),
    joinedProjects: new Set(),
  };
  clients.add(ws);

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      sendWs(ws, 'error', { code: 'BAD_JSON', message: 'Invalid JSON payload', retryable: false });
      return;
    }

    try {
      switch (message.type) {
        case 'auth.hello': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          sendWs(ws, 'auth.ok', {
            user: {
              id: ws.session.userId,
              username: ws.session.username,
              isAdmin: ws.session.isAdmin,
            },
          });
          return;
        }

        case 'project.join': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const knownSeq = Number(message.knownSeq || 0);
          if (!projectId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId is required', retryable: false });
            return;
          }

          const access = await getProjectAccess(ws.session.userId, projectId);
          if (!canOpenProjectInDaw(access)) {
            sendWs(ws, 'error', { code: 'NO_READ_PERMISSION', message: 'No DAW access', retryable: false });
            return;
          }

          const payload = await fetchProjectBootstrap(projectId, knownSeq);
          ws.session.joinedProjects.add(projectId);
          roomFor(projectId).add(ws);

          sendWs(ws, 'project.joined', {
            projectId,
            latestSeq: payload.latestSeq,
            snapshot: payload.snapshot,
            missingOps: payload.missingOps,
            access,
          });
          await sendProjectLockStatesToClient(projectId, ws);
          return;
        }

        case 'op.submit': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const clientOpId = String(message.clientOpId || randomUUID());
          const op = message.op;

          if (!projectId || !op || typeof op !== 'object') {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and op are required', retryable: false });
            return;
          }

          const access = await getProjectAccess(ws.session.userId, projectId);
          if (!canWriteProjectTracks(access)) {
            sendWs(ws, 'error', { code: 'NO_WRITE_PERMISSION', message: 'No write permission', retryable: false });
            return;
          }

          const result = await appendProjectOp({
            projectId,
            userId: ws.session.userId,
            clientOpId,
            op,
          });

          sendWs(ws, 'op.ack', {
            projectId,
            clientOpId,
            serverSeq: result.serverSeq,
          });

          broadcastToProject(projectId, 'op.broadcast', {
            projectId,
            serverSeq: result.serverSeq,
            clientOpId,
            op: result.op || op,
            actor: {
              userId: ws.session.userId,
              username: ws.session.username,
            },
          });
          return;
        }

        case 'lock.acquire': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          const access = await getProjectAccess(ws.session.userId, projectId);
          if (!canWriteProjectTracks(access)) {
            sendWs(ws, 'error', { code: 'NO_WRITE_PERMISSION', message: 'No write permission', retryable: false });
            return;
          }
          if (!(await canUserEditTrackInProject(ws.session.userId, projectId, trackId))) {
            sendWs(ws, 'error', {
              code: 'NO_TRACK_WRITE_PERMISSION',
              message: 'You cannot edit that track',
              retryable: false,
            });
            return;
          }

          const client = await pool.connect();
          let locked = false;
          try {
            await client.query('BEGIN');
            const lockResult = await client.query(
              `SELECT owner_user_id, expires_at
               FROM record_locks
               WHERE project_id = $1 AND track_id = $2
               FOR UPDATE`,
              [projectId, trackId]
            );

            if (lockResult.rowCount === 0) {
              locked = true;
            } else {
              const row = lockResult.rows[0];
              const isExpired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : true;
              const ownedBySelf = row.owner_user_id === ws.session.userId;
              locked = isExpired || ownedBySelf;
            }

            if (!locked) {
              await client.query('ROLLBACK');
              await broadcastLockState(projectId, trackId);
              sendWs(ws, 'error', {
                code: 'TRACK_LOCKED',
                message: 'Track is currently locked by another user',
                retryable: true,
              });
              break;
            }

            await client.query(
              `INSERT INTO record_locks(project_id, track_id, owner_user_id, owner_name, expires_at)
               VALUES($1, $2, $3, $4, NOW() + ($5 || ' seconds')::INTERVAL)
               ON CONFLICT (project_id, track_id)
               DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id,
                             owner_name = EXCLUDED.owner_name,
                             expires_at = EXCLUDED.expires_at,
                             updated_at = NOW()`,
              [projectId, trackId, ws.session.userId, ws.session.username, String(config.lockTimeoutSeconds)]
            );

            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }

          await broadcastLockState(projectId, trackId);
          sendWs(ws, 'lock.acquired', { projectId, trackId, ownerUserId: ws.session.userId });
          return;
        }

        case 'lock.heartbeat': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          if (!(await canUserEditTrackInProject(ws.session.userId, projectId, trackId))) {
            sendWs(ws, 'error', {
              code: 'NO_TRACK_WRITE_PERMISSION',
              message: 'You cannot edit that track',
              retryable: false,
            });
            return;
          }

          const result = await pool.query(
            `UPDATE record_locks
             SET expires_at = NOW() + ($4 || ' seconds')::INTERVAL,
                 updated_at = NOW()
             WHERE project_id = $1 AND track_id = $2 AND owner_user_id = $3
             RETURNING track_id`,
            [projectId, trackId, ws.session.userId, String(config.lockTimeoutSeconds)]
          );

          if (result.rowCount > 0) {
            await broadcastLockState(projectId, trackId);
          }
          return;
        }

        case 'lock.release': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          if (!(await canUserEditTrackInProject(ws.session.userId, projectId, trackId))) {
            sendWs(ws, 'error', {
              code: 'NO_TRACK_WRITE_PERMISSION',
              message: 'You cannot edit that track',
              retryable: false,
            });
            return;
          }

          await pool.query(
            `DELETE FROM record_locks
             WHERE project_id = $1 AND track_id = $2 AND owner_user_id = $3`,
            [projectId, trackId, ws.session.userId]
          );

          await broadcastLockState(projectId, trackId);
          return;
        }

        default:
          sendWs(ws, 'error', { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${message.type}`, retryable: false });
      }
    } catch (error) {
      console.error(error);
      sendWs(ws, 'error', {
        code: 'SERVER_ERROR',
        message: error.message || 'Unexpected server error',
        retryable: true,
      });
    }
  });

  ws.on('close', async () => {
    clients.delete(ws);
    ws.session?.joinedProjects?.forEach((projectId) => {
      const room = roomFor(projectId);
      room.delete(ws);
      if (room.size === 0) {
        projectRooms.delete(projectId);
      }
    });
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  req.cookies = parseCookieHeader(req.headers.cookie || '');
  req.user = tryAuthenticateRequest(req);

  wsServer.handleUpgrade(req, socket, head, (ws) => {
    wsServer.emit('connection', ws, req);
  });
});

async function start() {
  await ensureMediaRoot();
  await waitForDatabase();
  await logDatabaseConnectionDetails();
  await runMigrations();
  await syncAllProjectAccessTags();

  server.listen(config.port, () => {
    console.log(`Apollo server listening on http://0.0.0.0:${config.port}`);
  });

  setInterval(() => {
    cleanupExpiredLocks().catch((error) => {
      console.error('Failed to cleanup expired locks', error);
    });
  }, 5000).unref();

  scheduleNextMediaGc();
}

start().catch(async (error) => {
  console.error('Failed to start server', error);
  await closeDb();
  process.exit(1);
});

process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});
