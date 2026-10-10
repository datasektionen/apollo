import { describe, expect, it } from 'vitest';
import {
  accessDraftDirty,
  createDraftGrant,
  grantWriteBody,
  grantsDraftDirty,
  isDraftGrantId,
  replaceGrant,
} from '../accessDraft';

const catalog = {
  permissions: [{ value: 'track_manager', label: 'Track manager' }],
  groupNames: [{ value: 'choir', label: 'Choir' }],
  partNames: [],
};

describe('access drafts', () => {
  it('treats a new grant and a changed grant as unsaved', () => {
    const baseline = [{
      id: 'grant-1',
      permissionKey: 'track_manager',
      scopeType: 'all',
    }];
    expect(grantsDraftDirty(baseline, baseline)).toBe(false);
    expect(grantsDraftDirty(baseline, [{
      ...baseline[0],
      scopeType: 'show',
      scopeShowId: 'show-1',
    }])).toBe(true);
    const created = createDraftGrant(catalog);
    expect(isDraftGrantId(created.id)).toBe(true);
    expect(accessDraftDirty({
      baselineGrants: baseline,
      draftGrants: [...baseline, created],
      baselineParentIds: ['role-a'],
      draftParentIds: ['role-a'],
    })).toBe(true);
    expect(accessDraftDirty({
      baselineGrants: baseline,
      draftGrants: baseline,
      baselineParentIds: ['role-a'],
      draftParentIds: ['role-b'],
    })).toBe(true);
  });

  it('keeps the same grant list when an edit does not change the rule', () => {
    const grants = [{
      id: 'grant-1',
      permissionKey: 'track_manager',
      permissionLabel: 'Track manager',
      scopeType: 'all',
      sourceType: 'direct',
    }];
    expect(replaceGrant(grants, {
      id: 'grant-1',
      permissionKey: 'track_manager',
      scopeType: 'all',
    }, catalog)).toBe(grants);
    const next = replaceGrant(grants, {
      id: 'grant-1',
      permissionKey: 'track_manager',
      scopeType: 'show',
      scopeShowId: 'show-1',
      scopeGroupNameValue: 'choir',
    }, catalog);
    expect(next).not.toBe(grants);
    expect(next[0].scopeGroupLabel).toBe('Choir');
    expect(grantWriteBody(next[0]).scopeShowId).toBe('show-1');
    expect(grantWriteBody(next[0]).id).toBeUndefined();
  });
});
