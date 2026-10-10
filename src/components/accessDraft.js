export function isDraftGrantId(id) {
  return String(id || '').startsWith('draft:');
}

export function grantSignature(grant) {
  return [
    grant?.permissionKey || '',
    grant?.scopeType || '',
    grant?.scopeShowId || '',
    grant?.scopeProjectId || '',
    grant?.scopeTrackId || '',
    grant?.scopeNameValue || '',
    grant?.scopeGroupNameValue || '',
    grant?.scopePartNameValue || '',
  ].join('\u0000');
}

export function cloneGrants(grants) {
  return (grants || []).map((grant) => ({ ...grant }));
}

export function sameIdList(left, right) {
  const normalize = (ids) => (ids || []).map(String).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function grantsDraftDirty(baseline, draft) {
  const base = baseline || [];
  const next = draft || [];
  if (base.length !== next.length) return true;
  const baseById = new Map(base.map((grant) => [grant.id, grant]));
  return next.some((grant) => {
    const saved = baseById.get(grant.id);
    return !saved || grantSignature(saved) !== grantSignature(grant);
  });
}

export function accessDraftDirty({
  baselineGrants,
  draftGrants,
  baselineParentIds,
  draftParentIds,
}) {
  return !sameIdList(baselineParentIds, draftParentIds)
    || grantsDraftDirty(baselineGrants, draftGrants);
}

export function grantWriteBody(grant) {
  return {
    permissionKey: grant.permissionKey,
    scopeType: grant.scopeType,
    scopeShowId: grant.scopeShowId || null,
    scopeProjectId: grant.scopeProjectId || null,
    scopeTrackId: grant.scopeTrackId || null,
    scopeNameValue: grant.scopeNameValue || null,
    scopeGroupNameValue: grant.scopeGroupNameValue || null,
    scopePartNameValue: grant.scopePartNameValue || null,
  };
}

export function decorateGrant(grant, catalog) {
  const permission = (catalog?.permissions || []).find((item) => item.value === grant.permissionKey);
  const group = (catalog?.groupNames || []).find((item) => item.value === grant.scopeGroupNameValue);
  const part = (catalog?.partNames || []).find((item) => item.value === grant.scopePartNameValue);
  return {
    ...grant,
    permissionLabel: permission?.label || grant.permissionLabel || grant.permissionKey,
    scopeGroupLabel: grant.scopeGroupNameValue
      ? (group?.label || grant.scopeGroupLabel || grant.scopeGroupNameValue)
      : null,
    scopePartLabel: grant.scopePartNameValue
      ? (part?.label || grant.scopePartLabel || grant.scopePartNameValue)
      : null,
    sourceType: grant.sourceType || 'direct',
  };
}

export function createDraftGrant(catalog) {
  const permission = catalog?.permissions?.[0];
  return decorateGrant({
    id: `draft:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    permissionKey: permission?.value || 'project_reader',
    scopeType: 'all',
    scopeShowId: null,
    scopeProjectId: null,
    scopeTrackId: null,
    scopeNameValue: null,
    scopeGroupNameValue: null,
    scopePartNameValue: null,
    sourceType: 'direct',
  }, catalog);
}

export function replaceGrant(grants, next, catalog) {
  const decorated = decorateGrant(next, catalog);
  let changed = false;
  const result = (grants || []).map((grant) => {
    if (grant.id !== decorated.id) return grant;
    if (
      grantSignature(grant) === grantSignature(decorated)
      && (grant.permissionLabel || '') === (decorated.permissionLabel || '')
    ) {
      return grant;
    }
    changed = true;
    return {
      ...grant,
      ...decorated,
      id: grant.id,
      sourceType: grant.sourceType || 'direct',
    };
  });
  return changed ? result : grants;
}
