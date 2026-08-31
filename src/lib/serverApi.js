import { createEmptyProject } from '../types/project';
import { createId } from '../utils/id';

const API_PREFIX = '/api';
let currentServerSession = null;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function buildApiPath(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath === API_PREFIX || normalizedPath.startsWith(`${API_PREFIX}/`)) {
    return normalizedPath;
  }
  return `${API_PREFIX}${normalizedPath}`;
}

function dispatchSession(session) {
  window.dispatchEvent(new CustomEvent('apollo:server-session-updated', { detail: session }));
}

export function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function saveServerSession(session) {
  currentServerSession = session && isObject(session) ? session : null;
  dispatchSession(currentServerSession);
}

export function loadServerSession() {
  return currentServerSession;
}

export function clearServerSession() {
  currentServerSession = null;
  dispatchSession(null);
}

export function isSessionRecoveryError(error) {
  return /(invalid refresh token|missing refresh token|user is not active|invalid or expired access token|missing access token|session expired)/i.test(
    String(error?.message || '')
  );
}

async function apiFetch(path, options = {}, session = null, retryOnAuth = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const response = await fetch(buildApiPath(path), {
    ...options,
    credentials: 'include',
    headers,
    body: options.body instanceof Blob || options.body instanceof ArrayBuffer || options.body instanceof FormData
      ? options.body
      : (typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : undefined)),
  });

  if (response.status === 401 && retryOnAuth && !String(path).includes('/api/auth/refresh')) {
    const hadSession = Boolean(session?.user || loadServerSession()?.user);
    try {
      const refreshed = await refreshSession();
      if (refreshed?.user) {
        saveServerSession(refreshed);
      }
      return await apiFetch(path, options, refreshed, false);
    } catch (error) {
      if (hadSession && isSessionRecoveryError(error)) {
        clearServerSession();
        throw new Error('Session expired. Please log in again.');
      }
      throw error;
    }
  }

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) errorMessage = body.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return response;
}

export async function getCurrentSession() {
  return await apiFetch('/api/me', {
    method: 'GET',
  }, null, true);
}

export async function updateMyProfile(profile, session) {
  return await apiFetch('/api/me/profile', {
    method: 'PATCH',
    body: profile,
  }, session);
}

export async function fetchArtistCatalog(session) {
  return await apiFetch('/api/artists/catalog', {}, session);
}

export async function createMusicGroup(group, session) {
  const payload = await apiFetch('/api/artists/music-groups', {
    method: 'POST',
    body: group,
  }, session);
  return payload.group || null;
}

export async function createGuestArtist(guest, session) {
  const payload = await apiFetch('/api/artists/guest-artists', {
    method: 'POST',
    body: guest,
  }, session);
  return payload.guest || null;
}

export function beginOidcLogin() {
  window.location.assign(buildApiPath('/api/auth/oidc/start'));
}

export async function refreshSession() {
  const payload = await apiFetch('/api/auth/refresh', {
    method: 'POST',
    body: {},
  }, null, false);
  return payload;
}

export async function logout() {
  return await apiFetch('/api/auth/logout', {
    method: 'POST',
    body: {},
  }, null, false);
}

export async function listServerProjects(session) {
  const payload = await apiFetch('/api/projects', {}, session);
  return payload.projects || [];
}

export async function listShows(session) {
  const payload = await apiFetch('/api/shows', {}, session);
  return payload.shows || [];
}

export async function getAdminShowsConfig(session) {
  return await apiFetch('/api/admin/shows/config', {}, session);
}

export async function saveAdminShowsConfig(settings, session) {
  return await apiFetch('/api/admin/shows/config', {
    method: 'PATCH',
    body: settings,
  }, session);
}

export async function reorderAdminShows(showIds, session) {
  return await apiFetch('/api/admin/shows/order', {
    method: 'PATCH',
    body: { showIds },
  }, session);
}

export async function createShow(name, session) {
  const payload = await apiFetch('/api/admin/shows', {
    method: 'POST',
    body: { name },
  }, session);
  return payload.show || null;
}

export async function renameShow(showId, name, session) {
  const payload = await apiFetch(`/api/admin/shows/${encodeURIComponent(showId)}`, {
    method: 'PATCH',
    body: { name },
  }, session);
  return payload.show || null;
}

export async function createServerProject(name, session, options = null) {
  const initial = options?.initialSnapshot && typeof options.initialSnapshot === 'object'
    ? options.initialSnapshot
    : createEmptyProject(name);
  const projectId = String(options?.projectId || initial.projectId || createId());
  const projectName = String(options?.name || name || initial.projectName || '').trim();
  const musicalNumber = String(options?.musicalNumber || initial.musicalNumber || '0.0').trim();
  const snapshot = {
    ...initial,
    projectId,
    projectName: projectName || initial.projectName,
    musicalNumber: musicalNumber || '0.0',
  };

  const payload = await apiFetch('/api/projects', {
    method: 'POST',
    body: {
      name: snapshot.projectName,
      showId: options?.showId || snapshot.showId || null,
      musicalNumber: snapshot.musicalNumber,
      projectId,
      initialSnapshot: snapshot,
    },
  }, session);
  return payload;
}

export async function deleteServerProject(projectId, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  }, session);
}

async function submitProjectOpViaWebSocket(projectId, op, session, allowRefresh = true) {
  const wsUrl = getWsUrl();
  if (!wsUrl) {
    throw new Error('WebSocket URL is not configured.');
  }
  const clientOpId = createId();

  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);

    const cleanup = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws.close(); } catch { /* ignore */ }
      reject(error instanceof Error ? error : new Error(String(error || 'WebSocket op submission failed')));
    };

    const succeed = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws.close(); } catch { /* ignore */ }
      resolve(payload);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'op.submit',
        projectId,
        clientOpId,
        op,
      }));
    };

    ws.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'op.ack' && message.clientOpId === clientOpId) {
        succeed({
          projectId,
          clientOpId,
          serverSeq: Number(message.serverSeq || 0),
        });
        return;
      }

      if (message.type === 'error') {
        if (message.code === 'AUTH_REQUIRED' && allowRefresh) {
          try {
            const refreshed = await refreshSession();
            if (refreshed?.user) {
              saveServerSession(refreshed);
            }
            succeed(await submitProjectOpViaWebSocket(projectId, op, refreshed, false));
          } catch (error) {
            if (isSessionRecoveryError(error)) {
              clearServerSession();
              fail(new Error('Session expired. Please log in again.'));
              return;
            }
            fail(error);
          }
          return;
        }
        fail(new Error(message?.message || 'Realtime op failed'));
      }
    };

    ws.onerror = () => {
      fail(new Error('Failed to connect to realtime server'));
    };

    ws.onclose = () => {
      if (!settled) {
        fail(new Error('Realtime connection closed before operation ack'));
      }
    };
  });
}

export async function renameServerProject(projectId, name, session) {
  return await submitProjectOpViaWebSocket(
    projectId,
    {
      type: 'project.update',
      updates: { projectName: String(name || '').trim() },
    },
    session
  );
}

export async function updateServerProjectMusicalNumber(projectId, musicalNumber, session) {
  return await submitProjectOpViaWebSocket(
    projectId,
    {
      type: 'project.update',
      updates: { musicalNumber: String(musicalNumber || '').trim() },
    },
    session
  );
}

export async function bootstrapServerProject(projectId, session, knownSeq = 0, options = {}) {
  const params = new URLSearchParams();
  params.set('knownSeq', String(Number(knownSeq || 0)));
  if (options?.purpose) {
    params.set('purpose', String(options.purpose));
  }
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/bootstrap?${params.toString()}`, {}, session);
}

export async function getProjectCredits(projectId, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/credits`, {}, session);
}

export async function saveProjectCredits(projectId, credits, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/credits`, {
    method: 'PUT',
    body: { credits },
  }, session);
}

export async function getShowMetadata(showId, session) {
  return await apiFetch(`/api/shows/${encodeURIComponent(showId)}/metadata`, {}, session);
}

export async function saveShowMetadata(showId, metadata, session) {
  const payload = await apiFetch(`/api/shows/${encodeURIComponent(showId)}/metadata`, {
    method: 'PATCH',
    body: metadata,
  }, session);
  return payload.show || null;
}

export async function saveTrackArtists(projectId, trackId, artistRefs, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}/artists`, {
    method: 'PATCH',
    body: { artistRefs },
  }, session);
}

export async function listUsers(session) {
  const payload = await apiFetch('/api/admin/users', {}, session);
  return payload.users || [];
}

export async function listAdminArtists(session) {
  return await apiFetch('/api/admin/artists', {}, session);
}

export async function listAdminStorage(session) {
  return await apiFetch('/api/admin/storage', {}, session);
}

export async function validateAdminStorage(session) {
  return await apiFetch('/api/admin/storage/validate', {
    method: 'POST',
    body: {},
  }, session);
}

export async function quarantineAdminMedia(mediaId, session, { force = false } = {}) {
  return await apiFetch(`/api/admin/storage/media/${encodeURIComponent(mediaId)}/quarantine`, {
    method: 'POST',
    body: { force: Boolean(force) },
  }, session);
}

export async function restoreAdminMedia(mediaId, session) {
  return await apiFetch(`/api/admin/storage/media/${encodeURIComponent(mediaId)}/restore`, {
    method: 'POST',
    body: {},
  }, session);
}

export async function deleteAdminMedia(mediaId, session, { force = false } = {}) {
  const params = force ? '?force=1' : '';
  return await apiFetch(`/api/admin/storage/media/${encodeURIComponent(mediaId)}${params}`, {
    method: 'DELETE',
  }, session);
}

export async function deleteAdminQuarantinedMedia(session) {
  return await apiFetch('/api/admin/storage/quarantine', {
    method: 'DELETE',
  }, session);
}

export async function updateAdminArtist(kind, artistId, updates, session) {
  const pathKind = kind === 'group'
    ? 'music-groups'
    : (kind === 'guest' ? 'guest-artists' : 'users');
  const payload = await apiFetch(`/api/admin/artists/${pathKind}/${encodeURIComponent(artistId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
  return payload.artist || payload.group || payload.guest || null;
}

export async function createUser(user, session) {
  return await apiFetch('/api/admin/users', {
    method: 'POST',
    body: user,
  }, session);
}

export async function updateUser(userId, updates, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
}

export async function transferUserOwnership(userId, targetUserId, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/transfer-ownership`, {
    method: 'POST',
    body: { targetUserId },
  }, session);
}

export async function deleteUser(userId, transferToUserId, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: { transferToUserId },
  }, session);
}

export async function linkOidcIdentity(targetUserId, sourceUserId, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(targetUserId)}/link-oidc`, {
    method: 'POST',
    body: { sourceUserId },
  }, session);
}

export async function getRbacCatalog(session) {
  return await apiFetch('/api/admin/rbac/catalog', {}, session);
}

export async function listRbacRoles(session) {
  const payload = await apiFetch('/api/admin/roles', {}, session);
  return payload.roles || [];
}

export async function createRbacRole(role, session) {
  const payload = await apiFetch('/api/admin/roles', {
    method: 'POST',
    body: role,
  }, session);
  return payload.role;
}

export async function getRbacRole(roleId, session) {
  const payload = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {}, session);
  return payload.role || null;
}

export async function updateRbacRole(roleId, updates, session) {
  const payload = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
  return payload.role || null;
}

export async function deleteRbacRole(roleId, session) {
  return await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
  }, session);
}

export async function createRbacRoleOidcLink(roleId, link, session) {
  const payload = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}/oidc-links`, {
    method: 'POST',
    body: link,
  }, session);
  return payload.link || null;
}

export async function deleteRbacRoleOidcLink(roleId, linkId, session) {
  return await apiFetch(
    `/api/admin/roles/${encodeURIComponent(roleId)}/oidc-links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
    session
  );
}

export async function addRbacRoleMember(roleId, userId, session) {
  const payload = await apiFetch(
    `/api/admin/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PUT', body: {} },
    session
  );
  return payload.role || null;
}

export async function removeRbacRoleMember(roleId, userId, session) {
  const payload = await apiFetch(
    `/api/admin/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
    session
  );
  return payload.role || null;
}

export async function saveRbacRoleGrant(roleId, grant, session) {
  const payload = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}/grants`, {
    method: 'POST',
    body: grant,
  }, session);
  return payload.grant || null;
}

export async function deleteRbacRoleGrant(roleId, grantId, session) {
  return await apiFetch(
    `/api/admin/roles/${encodeURIComponent(roleId)}/grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE' },
    session
  );
}

export async function getUserAccessDetail(userId, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/access`, {}, session);
}

export async function addUserRole(userId, roleId, session) {
  return await apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    { method: 'PUT', body: {} },
    session
  );
}

export async function removeUserRole(userId, roleId, session) {
  return await apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
    session
  );
}

export async function saveUserGrant(userId, grant, session) {
  const payload = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/grants`, {
    method: 'POST',
    body: grant,
  }, session);
  return payload.grant || null;
}

export async function deleteUserGrant(userId, grantId, session) {
  return await apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE' },
    session
  );
}

export async function getProjectPermissions(projectId, session) {
  const payload = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/permissions`, {}, session);
  return payload.permissions || [];
}

export async function setProjectPermission(projectId, userId, permission, session) {
  return await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/permissions/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: permission,
    },
    session
  );
}

export async function registerMedia(payload, session) {
  return await apiFetch('/api/media/register', {
    method: 'POST',
    body: payload,
  }, session);
}

export async function uploadMedia(mediaId, blob, session, options = {}) {
  const params = new URLSearchParams();
  if (options?.projectId) {
    params.set('projectId', String(options.projectId));
  }
  await apiFetch(`/api/media/${encodeURIComponent(mediaId)}/content${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  }, session);
}

export async function resolveMedia(mediaIds, session, options = {}) {
  return await apiFetch('/api/media/batch-resolve', {
    method: 'POST',
    body: {
      mediaIds,
      projectId: options?.projectId || null,
    },
  }, session);
}

export async function downloadMediaBlob(mediaId, session, options = {}) {
  const params = new URLSearchParams();
  if (options?.projectId) {
    params.set('projectId', String(options.projectId));
  }
  const response = await apiFetch(`/api/media/${encodeURIComponent(mediaId)}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'GET',
  }, session);
  return await response.blob();
}

export async function forceCheckpoint(projectId, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/checkpoint`, {
    method: 'POST',
    body: {},
  }, session);
}

export async function commitLocalProjectSession(projectId, snapshot, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/local-session`, {
    method: 'POST',
    body: { snapshot },
  }, session);
}

export async function fetchPlayerMyDevice(session) {
  return await apiFetch('/api/player/my-device', {}, session);
}

export async function fetchPlayerTuttiMixes(session) {
  const payload = await apiFetch('/api/player/tutti', {}, session);
  return payload.mixes || [];
}

export async function fetchPlayerSearchCredits(session) {
  const payload = await apiFetch('/api/player/search/credits', {}, session);
  return payload.credits || [];
}

export async function fetchPlayerGlobalMixes(session) {
  const payload = await apiFetch('/api/player/mixes/global', {}, session);
  return payload.mixes || [];
}

export async function createPlayerFolder(folder, session) {
  const payload = await apiFetch('/api/player/folders', {
    method: 'POST',
    body: folder,
  }, session);
  return payload.folder;
}

export async function updatePlayerFolder(folderId, updates, session) {
  const payload = await apiFetch(`/api/player/folders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
  return payload.folder;
}

export async function deletePlayerFolder(folderId, session) {
  return await apiFetch(`/api/player/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
  }, session);
}

export async function createVirtualMix(mix, session) {
  const payload = await apiFetch('/api/player/mixes', {
    method: 'POST',
    body: mix,
  }, session);
  return payload.mix;
}

export async function updateVirtualMix(mixId, updates, session) {
  const payload = await apiFetch(`/api/player/mixes/${encodeURIComponent(mixId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
  return payload.mix;
}

export async function deleteVirtualMix(mixId, session) {
  return await apiFetch(`/api/player/mixes/${encodeURIComponent(mixId)}`, {
    method: 'DELETE',
  }, session);
}

export async function publishVirtualMix(mixId, session) {
  const payload = await apiFetch(`/api/player/mixes/${encodeURIComponent(mixId)}/publish`, {
    method: 'POST',
    body: {},
  }, session);
  return payload.mix;
}

export async function unpublishVirtualMix(mixId, session) {
  const payload = await apiFetch(`/api/player/mixes/${encodeURIComponent(mixId)}/unpublish`, {
    method: 'POST',
    body: {},
  }, session);
  return payload.mix;
}

export async function createPlayerPlaylist(playlist, session) {
  const payload = await apiFetch('/api/player/playlists', {
    method: 'POST',
    body: playlist,
  }, session);
  return payload.playlist;
}

export async function updatePlayerPlaylist(playlistId, updates, session) {
  const payload = await apiFetch(`/api/player/playlists/${encodeURIComponent(playlistId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
  return payload.playlist;
}

export async function deletePlayerPlaylist(playlistId, session) {
  return await apiFetch(`/api/player/playlists/${encodeURIComponent(playlistId)}`, {
    method: 'DELETE',
  }, session);
}

export async function addPlayerPlaylistItem(playlistId, mixId, session) {
  const payload = await apiFetch(`/api/player/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    body: { mixId },
  }, session);
  return payload.item;
}

export async function reorderPlayerPlaylistItems(playlistId, orderedItemIds, session) {
  return await apiFetch(`/api/player/playlists/${encodeURIComponent(playlistId)}/items/reorder`, {
    method: 'PATCH',
    body: { orderedItemIds },
  }, session);
}

export async function deletePlayerPlaylistItem(playlistId, itemId, session) {
  return await apiFetch(
    `/api/player/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
    session
  );
}
