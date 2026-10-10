import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleUserRound, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { BrandWordmark } from './BrandLogo';
import AdminShowsPanel from './AdminShowsPanel';
import AdminStoragePanel from './AdminStoragePanel';
import { AccessTypeInfoButton, GrantRulesTable } from './GrantRulesTable';
import { UnsavedAccessBar } from './UnsavedAccessBar';
import {
  accessDraftDirty,
  cloneGrants,
  createDraftGrant,
  grantSignature,
  grantWriteBody,
  grantsDraftDirty,
  isDraftGrantId,
  replaceGrant,
  sameIdList,
} from './accessDraft';
import { PERMISSION_COVERAGE } from './grantAccess';
import {
  addRbacRoleMember,
  addUserRole,
  createRbacRole,
  createRbacRoleOidcLink,
  deleteUser,
  deleteRbacRole,
  deleteRbacRoleGrant,
  deleteRbacRoleOidcLink,
  deleteUserGrant,
  getRbacCatalog,
  getRbacRole,
  getUserAccessDetail,
  deleteAdminArtist,
  listAdminArtists,
  listAdminStorage,
  listRbacRoles,
  listUsers,
  removeRbacRoleMember,
  removeUserRole,
  saveRbacRoleGrant,
  saveUserGrant,
  transferUserOwnership,
  updateRbacRoleGrant,
  updateUserGrant,
  updateAdminArtist,
  updateRbacRole,
} from '../lib/serverApi';

function Badge({ children, tone = 'slate' }) {
  const toneClass = {
    slate: 'bg-gray-700 text-gray-200',
    blue: 'bg-blue-900/40 text-blue-200',
    amber: 'bg-amber-900/40 text-amber-200',
    green: 'bg-green-900/40 text-green-200',
  }[tone] || 'bg-gray-700 text-gray-200';

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass}`}>
      {children}
    </span>
  );
}

function Panel({ title, actions = null, children }) {
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/40">
      {(title || actions) ? (
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          {title ? <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/50 px-4 py-4 text-sm text-gray-400">
      {children}
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
  className = '',
}) {
  return (
    <label className={`flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-300 ${className}`}>
      <Search size={16} className="shrink-0 text-gray-500" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
      />
    </label>
  );
}

function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
  title,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) onChange?.(!checked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition ${
        checked
          ? 'border-blue-500 bg-blue-600'
          : 'border-gray-600 bg-gray-800'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-blue-400'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function CompactAccessSection({
  actions = null,
  children,
  count = null,
  title,
  titleExtra = null,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-200">{title}</h3>
          {count !== null ? (
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-semibold text-gray-400">
              {count}
            </span>
          ) : null}
          {titleExtra}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-gray-800">{children}</div>
    </section>
  );
}

function CompactAccessRow({
  actions = null,
  badges = null,
  muted = false,
  title,
  titleAttr,
}) {
  return (
    <div
      title={titleAttr}
      className={`grid grid-cols-[1fr,auto] items-center gap-4 px-4 py-2.5 transition hover:bg-gray-900/70 ${
        muted ? 'opacity-70' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-white">{title}</span>
        {badges ? (
          <span className="flex min-w-0 shrink-0 items-center gap-2">
            {badges}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">{actions}</div>
    </div>
  );
}

function getRoleDisplayName(role) {
  if (role?.systemKey === 'default_user') return 'All users';
  return role?.name || '';
}

function isGeneralGrant(grant) {
  return Boolean(grant?.permissionKey)
    && grant.scopeType === 'all'
    && !grant.scopeGroupNameValue
    && !grant.scopePartNameValue;
}

function isSpecificGrant(grant) {
  return Boolean(grant?.permissionKey) && !isGeneralGrant(grant);
}

function scopeMatches(left, right) {
  return (
    (left?.scopeType || null) === (right?.scopeType || null)
    && String(left?.scopeShowId || '') === String(right?.scopeShowId || '')
    && String(left?.scopeProjectId || '') === String(right?.scopeProjectId || '')
    && String(left?.scopeTrackId || '') === String(right?.scopeTrackId || '')
    && String(left?.scopeNameValue || '') === String(right?.scopeNameValue || '')
    && String(left?.scopeGroupNameValue || '') === String(right?.scopeGroupNameValue || '')
    && String(left?.scopePartNameValue || '') === String(right?.scopePartNameValue || '')
  );
}

function permissionCovers(broaderPermission, narrowerPermission) {
  return (PERMISSION_COVERAGE[broaderPermission] || [broaderPermission]).includes(narrowerPermission);
}

function generalGrantCoversGrant(generalGrant, grant) {
  if (!generalGrant || !grant || !isSpecificGrant(grant)) return false;
  if (generalGrant.scopeType !== 'all') return false;
  return permissionCovers(generalGrant.permissionKey, grant.permissionKey);
}

function isGrantRedundant(grant, allGrants) {
  return allGrants.some((candidate) => (
    candidate.id !== grant.id
    && generalGrantCoversGrant(candidate, grant)
  ));
}

export default function AdminPanel({
  session = null,
  onClose,
  onLogout,
  onOpenProfile = null,
  onSessionRefresh = null,
}) {
  const [tab, setTab] = useState('roles');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [artists, setArtists] = useState({ users: [], groups: [], guests: [] });
  const [catalog, setCatalog] = useState({ shows: [], projects: [], groupNames: [], partNames: [] });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);
  const [newlyCreatedRoleId, setNewlyCreatedRoleId] = useState('');
  const [roleDetailTab, setRoleDetailTab] = useState('permissions');
  const [roleNameDraft, setRoleNameDraft] = useState('');
  const [parentRoleIdsDraft, setParentRoleIdsDraft] = useState([]);
  const [parentRoleBaseline, setParentRoleBaseline] = useState([]);
  const [roleGrantDraft, setRoleGrantDraft] = useState([]);
  const [roleGrantBaseline, setRoleGrantBaseline] = useState([]);
  const [userGrantDraft, setUserGrantDraft] = useState([]);
  const [userGrantBaseline, setUserGrantBaseline] = useState([]);
  const [accessBarAttention, setAccessBarAttention] = useState(0);
  const [roleEditorReset, setRoleEditorReset] = useState(0);
  const [userEditorReset, setUserEditorReset] = useState(0);
  const [pendingRoleMemberId, setPendingRoleMemberId] = useState('');
  const [pendingChildRoleId, setPendingChildRoleId] = useState('');
  const [oidcClaimPathDraft, setOidcClaimPathDraft] = useState('');
  const [oidcClaimValueDraft, setOidcClaimValueDraft] = useState('');
  const [oidcDescriptionDraft, setOidcDescriptionDraft] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [expandedUserRoleIds, setExpandedUserRoleIds] = useState([]);
  const [rolePickerUserId, setRolePickerUserId] = useState('');
  const [userActionMenuId, setUserActionMenuId] = useState('');
  const [userActionModal, setUserActionModal] = useState(null);
  const [userAccessModal, setUserAccessModal] = useState(null);
  const [showRedundantAccesses, setShowRedundantAccesses] = useState(false);
  const [showRedundantUserAccesses, setShowRedundantUserAccesses] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [storage, setStorage] = useState(null);
  const profileMenuRef = useRef(null);
  const rolePickerRef = useRef(null);
  const userActionMenuRef = useRef(null);
  const roleNameInputRef = useRef(null);

  const loadBaseData = async () => {
    const [nextRoles, nextUsers, nextCatalog, nextArtists] = await Promise.all([
      listRbacRoles(session),
      listUsers(session),
      getRbacCatalog(session),
      listAdminArtists(session),
    ]);
    setRoles(nextRoles);
    setUsers(nextUsers);
    setArtists(nextArtists || { users: [], groups: [], guests: [] });
    setCatalog(nextCatalog || {
      projects: [],
      shows: [],
      tracks: [],
      groupNames: [],
      partNames: [],
      permissions: [],
      scopeTypes: [],
    });
    listAdminStorage(session).then((nextStorage) => {
      setStorage(nextStorage);
    }).catch(() => {
      // Storage is optional for the rest of the admin UI.
    });
    setSelectedRoleId((current) => (
      nextRoles.some((role) => role.id === current) ? current : ''
    ));
  };

  const loadRole = async (roleId = selectedRoleId) => {
    if (!roleId) {
      setSelectedRole(null);
      setRoleGrantDraft([]);
      setRoleGrantBaseline([]);
      setParentRoleIdsDraft([]);
      setParentRoleBaseline([]);
      return;
    }
    const role = await getRbacRole(roleId, session);
    const parentIds = (role?.parents || []).map((parent) => parent.id);
    setSelectedRole(role);
    setRoleNameDraft(role?.name || '');
    setParentRoleIdsDraft(parentIds);
    setParentRoleBaseline(parentIds);
    setRoleGrantDraft(cloneGrants(role?.grants));
    setRoleGrantBaseline(cloneGrants(role?.grants));
    setRoleEditorReset((current) => current + 1);
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setLoading(true);
      setError('');
      try {
        await loadBaseData();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load admin data.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedRoleId) {
      setSelectedRole(null);
      setRoleNameDraft('');
      setParentRoleIdsDraft([]);
      setParentRoleBaseline([]);
      setRoleGrantDraft([]);
      setRoleGrantBaseline([]);
      return;
    }
    loadRole(selectedRoleId).catch((loadError) => {
      setError(loadError.message || 'Failed to load role.');
    });
  }, [selectedRoleId]);

  useEffect(() => {
    if (selectedRole?.systemKey === 'admin') {
      setRoleDetailTab('links');
    } else {
      setRoleDetailTab('permissions');
    }
    setPendingRoleMemberId('');
    setPendingChildRoleId('');
    setOidcClaimPathDraft('');
    setOidcClaimValueDraft('');
    setOidcDescriptionDraft('');
    setShowRedundantAccesses(false);
  }, [selectedRole?.systemKey, selectedRoleId]);

  useEffect(() => {
    if (!newlyCreatedRoleId || selectedRoleId !== newlyCreatedRoleId || !selectedRole || selectedRole.isSystem) return;
    const frame = window.requestAnimationFrame(() => {
      roleNameInputRef.current?.focus();
      roleNameInputRef.current?.select();
      setNewlyCreatedRoleId('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newlyCreatedRoleId, selectedRole, selectedRoleId]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!rolePickerRef.current?.contains(event.target)) {
        setRolePickerUserId('');
      }
      if (!userActionMenuRef.current?.contains(event.target)) {
        setUserActionMenuId('');
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  useEffect(() => {
    if (tab !== 'roles' && selectedRoleId) {
      setSelectedRoleId('');
    }
  }, [selectedRoleId, tab]);

  useEffect(() => {
    if (tab !== 'storage' || !session) return;
    listAdminStorage(session).then((nextStorage) => {
      setStorage(nextStorage);
    }).catch(() => {
      // Keep any previously loaded storage snapshot.
    });
  }, [session, tab]);

  const filteredRoles = useMemo(() => (
    roles.filter((role) => role.name.toLowerCase().includes(roleSearch.trim().toLowerCase()))
  ), [roles, roleSearch]);

  const filteredUsers = useMemo(() => (
    users.filter((user) => {
      const query = userSearch.trim().toLowerCase();
      if (!query) return true;
      return (
        String(user.username || '').toLowerCase().includes(query)
        || String(user.oidcEmail || '').toLowerCase().includes(query)
        || String(user.oidcDisplayName || '').toLowerCase().includes(query)
      );
    })
  ), [users, userSearch]);

  const allArtists = useMemo(() => ([
    ...(artists.users || []).map((artist) => ({ ...artist, kind: 'user', kindLabel: 'Account artist' })),
    ...(artists.groups || []).map((artist) => ({ ...artist, kind: 'group', kindLabel: 'Music group' })),
    ...(artists.guests || []).map((artist) => ({ ...artist, kind: 'guest', kindLabel: 'Guest artist' })),
  ].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  }))), [artists]);

  const availableRoleMembers = useMemo(() => {
    const currentIds = new Set((selectedRole?.members || []).map((member) => member.id));
    return users.filter((user) => !currentIds.has(user.id));
  }, [selectedRole, users]);

  const availableChildRoles = useMemo(() => {
    if (!selectedRole || selectedRole.isSystem) return [];
    const currentIds = new Set((selectedRole.childRoles || []).map((role) => role.id));
    return roles.filter((role) => (
      !role.isSystem
      && role.id !== selectedRole.id
      && !currentIds.has(role.id)
    ));
  }, [roles, selectedRole]);

  const includableRoles = useMemo(() => {
    if (!selectedRole || selectedRole.isSystem) return [];
    const childRoleIds = new Set((selectedRole.childRoles || []).map((role) => role.id));
    return roles.filter((role) => (
      !role.isSystem
      && role.id !== selectedRole.id
      && !childRoleIds.has(role.id)
    ));
  }, [roles, selectedRole]);

  const customAssignableRoles = useMemo(() => (
    roles.filter((role) => role.systemKey !== 'default_user')
  ), [roles]);

  const expandedUserRoleIdSet = useMemo(() => new Set(expandedUserRoleIds), [expandedUserRoleIds]);

  const roleGrants = roleGrantDraft;
  const inheritedRoleGrants = useMemo(() => (selectedRole?.inheritedGrants || []), [selectedRole]);
  const allRoleGrants = useMemo(() => ([
    ...roleGrants,
    ...inheritedRoleGrants,
  ]), [roleGrants, inheritedRoleGrants]);

  const visibleRoleGrants = useMemo(() => {
    const baselineById = new Map(roleGrantBaseline.map((grant) => [grant.id, grant]));
    const grants = allRoleGrants
      .map((grant) => ({
        ...grant,
        isRedundant: isGrantRedundant(grant, allRoleGrants),
      }));
    return showRedundantAccesses
      ? grants
      : grants.filter((grant) => {
        if (!grant.isRedundant || isDraftGrantId(grant.id)) return true;
        const saved = baselineById.get(grant.id);
        return !saved || grantSignature(saved) !== grantSignature(grant);
      });
  }, [allRoleGrants, roleGrantBaseline, showRedundantAccesses]);

  const userDirectGrants = userGrantDraft;

  const visibleUserDirectGrants = useMemo(() => {
    const baselineById = new Map(userGrantBaseline.map((grant) => [grant.id, grant]));
    const grants = userDirectGrants.map((grant) => ({
      ...grant,
      isRedundant: isGrantRedundant(grant, userDirectGrants),
    }));
    return showRedundantUserAccesses
      ? grants
      : grants.filter((grant) => {
        if (!grant.isRedundant || isDraftGrantId(grant.id)) return true;
        const saved = baselineById.get(grant.id);
        return !saved || grantSignature(saved) !== grantSignature(grant);
      });
  }, [showRedundantUserAccesses, userDirectGrants, userGrantBaseline]);

  const roleAccessDirty = Boolean(selectedRole) && accessDraftDirty({
    baselineGrants: roleGrantBaseline,
    draftGrants: roleGrantDraft,
    baselineParentIds: parentRoleBaseline,
    draftParentIds: parentRoleIdsDraft,
  });
  const userAccessDirty = Boolean(userAccessModal) && grantsDraftDirty(userGrantBaseline, userGrantDraft);
  const accessDirty = roleAccessDirty || userAccessDirty;

  const leaveAdmin = (action) => {
    if (accessDirty) {
      setAccessBarAttention((current) => current + 1);
      return;
    }
    action();
  };

  const runAction = async (action, fallbackMessage) => {
    setSaving(true);
    setError('');
    try {
      await action();
      await onSessionRefresh?.();
    } catch (actionError) {
      setError(actionError.message || fallbackMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    leaveAdmin(async () => {
      await runAction(async () => {
        const createdRole = await createRbacRole({ name: 'New role' }, session);
        await loadBaseData();
        setNewlyCreatedRoleId(createdRole.id);
        setSelectedRoleId(createdRole.id);
      }, 'Failed to create role.');
    });
  };

  const handleRoleNameCommit = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    const nextName = roleNameDraft.trim();
    if (!nextName) {
      setRoleNameDraft(selectedRole.name || '');
      return;
    }
    if (nextName === selectedRole.name) return;
    const previousName = selectedRole.name || '';
    let saved = false;
    await runAction(async () => {
      await updateRbacRole(selectedRole.id, { name: nextName }, session);
      saved = true;
      setSelectedRole((current) => (current ? { ...current, name: nextName } : current));
      await loadBaseData();
    }, 'Failed to save role.');
    if (!saved) setRoleNameDraft(previousName);
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    if (accessDirty) {
      setAccessBarAttention((current) => current + 1);
      return;
    }
    if (!window.confirm(`Delete "${selectedRole.name}"?`)) return;
    await runAction(async () => {
      await deleteRbacRole(selectedRole.id, session);
      await loadBaseData();
    }, 'Failed to delete role.');
  };

  const handleAddRoleMember = async () => {
    if (!selectedRole || !pendingRoleMemberId) return;
    await runAction(async () => {
      await addRbacRoleMember(selectedRole.id, pendingRoleMemberId, session);
      setPendingRoleMemberId('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to add member.');
  };

  const handleRemoveRoleMember = async (userId) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await removeRbacRoleMember(selectedRole.id, userId, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove member.');
  };

  const handleRoleGrantChange = (grant) => {
    setRoleGrantDraft((current) => replaceGrant(current, grant, catalog));
  };

  const handleAddRoleGrant = () => {
    const grant = createDraftGrant(catalog);
    setRoleGrantDraft((current) => [...current, grant]);
    return grant.id;
  };

  const handleRemoveRoleGrant = (grant) => {
    if (!grant?.id) return;
    setRoleGrantDraft((current) => current.filter((item) => item.id !== grant.id));
  };

  const discardRoleAccess = () => {
    setRoleGrantDraft(cloneGrants(roleGrantBaseline));
    setParentRoleIdsDraft([...parentRoleBaseline]);
    setRoleEditorReset((current) => current + 1);
  };

  const handleSaveRoleAccess = async () => {
    if (!selectedRole || !roleAccessDirty) return;
    const baselineById = new Map(roleGrantBaseline.map((grant) => [grant.id, grant]));
    const draftIds = new Set(roleGrantDraft.map((grant) => grant.id));
    await runAction(async () => {
      if (!sameIdList(parentRoleBaseline, parentRoleIdsDraft)) {
        await updateRbacRole(selectedRole.id, { parentRoleIds: parentRoleIdsDraft }, session);
        setParentRoleBaseline([...parentRoleIdsDraft]);
      }
      for (const saved of roleGrantBaseline) {
        if (!draftIds.has(saved.id)) {
          await deleteRbacRoleGrant(selectedRole.id, saved.id, session);
          setRoleGrantBaseline((current) => current.filter((item) => item.id !== saved.id));
        }
      }
      for (const grant of roleGrantDraft) {
        const saved = baselineById.get(grant.id);
        const body = grantWriteBody(grant);
        if (!saved || isDraftGrantId(grant.id)) {
          const created = await saveRbacRoleGrant(selectedRole.id, body, session);
          const createdId = created?.id;
          if (createdId) {
            setRoleGrantDraft((current) => current.map((item) => (
              item.id === grant.id ? { ...item, ...created, id: createdId } : item
            )));
            setRoleGrantBaseline((current) => [...current.filter((item) => item.id !== grant.id), created]);
          }
        } else if (grantSignature(saved) !== grantSignature(grant)) {
          await updateRbacRoleGrant(selectedRole.id, grant.id, body, session);
          setRoleGrantBaseline((current) => current.map((item) => (
            item.id === grant.id ? { ...item, ...body } : item
          )));
        }
      }
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save role access.');
  };

  const handleEditArtistDescription = async (artist) => {
    const nextName = artist.kind === 'user'
      ? artist.name
      : window.prompt(`${artist.kindLabel} name`, artist.name || '');
    if (nextName == null) return;
    const nextGroupType = artist.kind === 'group'
      ? window.prompt('Music group type', artist.groupType || '')
      : artist.groupType;
    if (artist.kind === 'group' && nextGroupType == null) return;
    const nextDescription = window.prompt(`Artist description for ${artist.name}`, artist.description || '');
    if (nextDescription == null) return;
    await runAction(async () => {
      await updateAdminArtist(artist.kind, artist.id, {
        name: nextName,
        groupType: nextGroupType,
        description: nextDescription,
      }, session);
      const nextArtists = await listAdminArtists(session);
      setArtists(nextArtists || { users: [], groups: [], guests: [] });
    }, 'Failed to update artist.');
  };

  const handleDeleteArtist = async (artist) => {
    const message = artist.kind === 'user'
      ? `Delete "${artist.name}" from artists? The user account will stay.`
      : `Delete "${artist.name}"?`;
    if (!window.confirm(message)) return;
    await runAction(async () => {
      await deleteAdminArtist(artist.kind, artist.id, session);
      const nextArtists = await listAdminArtists(session);
      setArtists(nextArtists || { users: [], groups: [], guests: [] });
    }, 'Failed to delete artist.');
  };

  const handleSaveRoleOidcLink = async () => {
    if (!selectedRole || !oidcClaimValueDraft.trim()) return;
    await runAction(async () => {
      await createRbacRoleOidcLink(selectedRole.id, {
        claimPath: oidcClaimPathDraft.trim(),
        claimValue: oidcClaimValueDraft.trim(),
        description: oidcDescriptionDraft.trim(),
      }, session);
      setOidcClaimPathDraft('');
      setOidcClaimValueDraft('');
      setOidcDescriptionDraft('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save OIDC link.');
  };

  const handleDeleteRoleOidcLink = async (link) => {
    if (!selectedRole || !link?.id) return;
    await runAction(async () => {
      await deleteRbacRoleOidcLink(selectedRole.id, link.id, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove OIDC link.');
  };

  const handleAddChildRole = async () => {
    if (!selectedRole || !pendingChildRoleId) return;
    await runAction(async () => {
      const childRole = await getRbacRole(pendingChildRoleId, session);
      const nextParentRoleIds = Array.from(new Set([
        ...(childRole?.parents || []).map((role) => role.id),
        selectedRole.id,
      ]));
      await updateRbacRole(pendingChildRoleId, { parentRoleIds: nextParentRoleIds }, session);
      setPendingChildRoleId('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to add role member.');
  };

  const handleRemoveChildRole = async (childRoleId) => {
    if (!selectedRole || !childRoleId) return;
    await runAction(async () => {
      const childRole = await getRbacRole(childRoleId, session);
      const nextParentRoleIds = (childRole?.parents || [])
        .map((role) => role.id)
        .filter((roleId) => roleId !== selectedRole.id);
      await updateRbacRole(childRoleId, { parentRoleIds: nextParentRoleIds }, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove role member.');
  };

  const toggleExpandedUserRoles = (userId) => {
    setExpandedUserRoleIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  const handleSetUserRoleFromList = async (userId, roleId, shouldHaveRole) => {
    if (!userId || !roleId) return;
    await runAction(async () => {
      if (shouldHaveRole) {
        await addUserRole(userId, roleId, session);
      } else {
        await removeUserRole(userId, roleId, session);
      }
      await loadBaseData();
      if (selectedRoleId === roleId || selectedRoleId === 'system-role-admin') {
        await loadRole(selectedRoleId);
      }
    }, shouldHaveRole ? 'Failed to add role.' : 'Failed to remove role.');
  };

  const loadUserAccess = async (userId) => {
    const detail = await getUserAccessDetail(userId, session);
    const directGrants = cloneGrants(detail?.directGrants);
    setUserGrantBaseline(directGrants);
    setUserGrantDraft(cloneGrants(directGrants));
    setUserEditorReset((current) => current + 1);
    setUserAccessModal((current) => (
      current?.userId === userId
        ? {
          ...current,
          loading: false,
          detail,
          user: detail?.user || current.user,
        }
        : current
    ));
    return detail;
  };

  const openUserAccessModal = async (user) => {
    if (!user?.id) return;
    setUserActionMenuId('');
    setShowRedundantUserAccesses(false);
    setUserAccessModal({
      userId: user.id,
      user,
      detail: null,
      loading: true,
    });
    setError('');
    try {
      await loadUserAccess(user.id);
    } catch (loadError) {
      setUserAccessModal(null);
      setError(loadError.message || 'Failed to load user access.');
    }
  };

  const handleUserGrantChange = (grant) => {
    setUserGrantDraft((current) => replaceGrant(current, grant, catalog));
  };

  const handleAddUserGrant = () => {
    const grant = createDraftGrant(catalog);
    setUserGrantDraft((current) => [...current, grant]);
    return grant.id;
  };

  const handleRemoveUserGrant = (grant) => {
    if (!grant?.id) return;
    setUserGrantDraft((current) => current.filter((item) => item.id !== grant.id));
  };

  const discardUserAccess = () => {
    setUserGrantDraft(cloneGrants(userGrantBaseline));
    setUserEditorReset((current) => current + 1);
  };

  const handleSaveUserAccess = async () => {
    if (!userAccessModal?.userId || !userAccessDirty) return;
    const userId = userAccessModal.userId;
    const baselineById = new Map(userGrantBaseline.map((grant) => [grant.id, grant]));
    const draftIds = new Set(userGrantDraft.map((grant) => grant.id));
    await runAction(async () => {
      for (const saved of userGrantBaseline) {
        if (!draftIds.has(saved.id)) {
          await deleteUserGrant(userId, saved.id, session);
          setUserGrantBaseline((current) => current.filter((item) => item.id !== saved.id));
        }
      }
      for (const grant of userGrantDraft) {
        const saved = baselineById.get(grant.id);
        const body = grantWriteBody(grant);
        if (!saved || isDraftGrantId(grant.id)) {
          const created = await saveUserGrant(userId, body, session);
          const createdId = created?.id;
          if (createdId) {
            setUserGrantDraft((current) => current.map((item) => (
              item.id === grant.id ? { ...item, ...created, id: createdId } : item
            )));
            setUserGrantBaseline((current) => [...current.filter((item) => item.id !== grant.id), created]);
          }
        } else if (grantSignature(saved) !== grantSignature(grant)) {
          await updateUserGrant(userId, grant.id, body, session);
          setUserGrantBaseline((current) => current.map((item) => (
            item.id === grant.id ? { ...item, ...body } : item
          )));
        }
      }
      await loadBaseData();
      await loadUserAccess(userId);
    }, 'Failed to save user access.');
  };

  const closeUserAccessModal = () => {
    leaveAdmin(() => {
      setUserAccessModal(null);
      setUserGrantDraft([]);
      setUserGrantBaseline([]);
    });
  };

  const openUserActionModal = (type, user) => {
    if (!user) return;
    if (type === 'delete' && !window.confirm(`Delete ${user.username}?`)) {
      return;
    }
    const fallbackTargetUserId = users.find((candidate) => candidate.id !== user.id)?.id || '';
    setUserActionMenuId('');
    setUserActionModal({
      type,
      userId: user.id,
      targetUserId: fallbackTargetUserId,
    });
  };

  const handleConfirmUserAction = async () => {
    if (!userActionModal?.userId || !userActionModal.targetUserId) return;
    const { type, userId, targetUserId } = userActionModal;
    await runAction(async () => {
      if (type === 'transfer') {
        await transferUserOwnership(userId, targetUserId, session);
      } else if (type === 'delete') {
        await deleteUser(userId, targetUserId, session);
      }
      setUserActionModal(null);
      setExpandedUserRoleIds((current) => current.filter((id) => id !== userId));
      setRolePickerUserId((current) => (current === userId ? '' : current));
      await loadBaseData();
      if (selectedRoleId) {
        await loadRole(selectedRoleId);
      }
    }, type === 'transfer' ? 'Failed to transfer ownership.' : 'Failed to delete user.');
  };

  const canEditRoleName = selectedRole && !selectedRole.isSystem;
  const canEditRoleGrants = selectedRole && selectedRole.systemKey !== 'admin';
  const canEditRoleLinks = selectedRole && selectedRole.systemKey !== 'default_user';
  const canEditRoleChildren = selectedRole && !selectedRole.isSystem;
  const canEditRoleParents = selectedRole && !selectedRole.isSystem;
  const canShowMembers = selectedRole && selectedRole.systemKey !== 'default_user';
  const userActionModalUser = userActionModal
    ? users.find((user) => user.id === userActionModal.userId)
    : null;
  const userActionTargetUsers = userActionModal
    ? users.filter((user) => user.id !== userActionModal.userId)
    : [];
  const roleTabs = selectedRole ? [
    {
      value: 'permissions',
      label: 'Permissions',
      disabled: selectedRole.systemKey === 'admin',
    },
    {
      value: 'links',
      label: 'Links',
      disabled: false,
    },
    {
      value: 'members',
      label: `Members (${selectedRole.memberCount || 0})`,
      disabled: selectedRole.systemKey === 'default_user',
    },
  ] : [];

  return (
    <div className="h-full w-full overflow-hidden bg-gray-900 text-white">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div data-admin-topbar className="flex items-center justify-between gap-3 border-b border-gray-700 bg-gray-800 px-4 py-3">
          <div>
            <h1 className="m-0 leading-none">
              <BrandWordmark className="h-9" />
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg bg-gray-700 p-0.5">
              <button
                type="button"
                disabled
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                title="Current page"
              >
                ADMIN
              </button>
            </div>
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((previous) => !previous)}
                className="flex items-center justify-center rounded-lg bg-gray-700 p-2 text-white transition-colors hover:bg-gray-600"
                title="User menu"
              >
                <CircleUserRound size={18} />
              </button>
              {profileMenuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-2 min-w-32 overflow-hidden rounded-md border border-gray-700 bg-gray-800 shadow-lg">
                  {onOpenProfile ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onOpenProfile();
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                    >
                      My Profile
                    </button>
                  ) : null}
                  <button
                    type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        leaveAdmin(() => onClose?.());
                      }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Go to app
                  </button>
                  <button
                    type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        leaveAdmin(() => onLogout?.());
                      }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-700/40 bg-red-900/20 px-5 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden md:flex-row">
            <aside className="shrink-0 border-b border-gray-800 bg-gray-950 p-2 md:w-44 md:border-b-0 md:border-r">
              <nav className="flex gap-1.5 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
                <button
                  type="button"
                  onClick={() => {
                    leaveAdmin(() => {
                      setSelectedRoleId('');
                      setTab('artists');
                    });
                  }}
                  className={`relative flex min-w-28 items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition md:w-full ${
                    tab === 'artists'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'artists' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Artists</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {(artists.users?.length || 0) + (artists.groups?.length || 0) + (artists.guests?.length || 0)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    leaveAdmin(() => {
                      setSelectedRoleId('');
                      setTab('users');
                    });
                  }}
                  className={`relative flex min-w-28 items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition md:w-full ${
                    tab === 'users'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'users' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Users</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {users.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    leaveAdmin(() => {
                      setSelectedRoleId('');
                      setTab('shows');
                    });
                  }}
                  className={`relative flex min-w-28 items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition md:w-full ${
                    tab === 'shows'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'shows' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Shows</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {catalog.shows?.length || 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    leaveAdmin(() => {
                      setSelectedRoleId('');
                      setTab('roles');
                    });
                  }}
                  className={`relative flex min-w-28 items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition md:w-full ${
                    tab === 'roles'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'roles' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Roles</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {roles.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    leaveAdmin(() => {
                      setSelectedRoleId('');
                      setTab('storage');
                    });
                  }}
                  className={`relative flex min-w-28 items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition md:w-full ${
                    tab === 'storage'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'storage' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Storage</span>
                </button>
              </nav>
            </aside>

            <div className={`min-w-0 flex-1 overflow-auto p-3 ${accessDirty ? 'pb-24' : ''}`}>
              {loading ? (
                <Empty>Loading...</Empty>
              ) : tab === 'artists' ? (
                <div className="mx-auto max-w-6xl space-y-5">
                  <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
                    <div className="grid grid-cols-[1fr,150px,80px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      <span>Artist</span>
                      <span>Type</span>
                      <span />
                    </div>
                    {allArtists.map((artist) => (
                      <div
                        key={`${artist.kind}:${artist.id}`}
                        className="grid grid-cols-[1fr,150px,80px] items-center gap-4 border-b border-gray-800 px-4 py-4 last:border-b-0 hover:bg-gray-900/70"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{artist.name}</div>
                          {artist.description ? (
                            <div className="mt-1 truncate text-sm text-gray-400">{artist.description}</div>
                          ) : (
                            <div className="mt-1 text-sm text-gray-600">No artist description.</div>
                          )}
                        </div>
                        <div className="text-sm text-gray-300">
                          {artist.kind === 'group' && artist.groupType
                            ? artist.groupType
                            : artist.kindLabel}
                        </div>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            disabled={saving}
                            title="Edit"
                            aria-label={`Edit ${artist.name}`}
                            onClick={() => handleEditArtistDescription(artist)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            title="Delete"
                            aria-label={`Delete ${artist.name}`}
                            onClick={() => handleDeleteArtist(artist)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-gray-200 hover:border-red-800 hover:bg-gray-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!allArtists.length ? (
                      <div className="px-4 py-6">
                        <Empty>No artists found yet.</Empty>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : tab === 'shows' ? (
                <AdminShowsPanel
                  session={session}
                  onSessionRefresh={onSessionRefresh}
                />
              ) : tab === 'roles' ? (
                selectedRole ? (
                  <div className="grid gap-3 lg:grid-cols-[12.5rem,minmax(0,1fr)]">
                    <aside className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 p-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => leaveAdmin(() => setSelectedRoleId(''))}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-950/80 px-2 py-1.5 text-left text-sm font-medium text-gray-200 transition hover:border-gray-700 hover:bg-gray-900"
                        >
                          <ArrowLeft size={16} className="shrink-0" />
                          <span className="truncate">Back</span>
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleCreateRole}
                          title="Create role"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-gray-950/80 text-gray-200 transition hover:border-gray-700 hover:bg-gray-900 disabled:opacity-50"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <div className="space-y-1">
                        {roles.map((role) => (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => {
                              if (role.id === selectedRoleId) return;
                              leaveAdmin(() => setSelectedRoleId(role.id));
                            }}
                            className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                              role.id === selectedRoleId
                                ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                                : 'text-gray-300 hover:bg-gray-900 hover:text-white'
                            }`}
                          >
                            <div className="min-w-0 truncate font-medium">{getRoleDisplayName(role)}</div>
                          </button>
                        ))}
                      </div>
                    </aside>

                    <div className="min-w-0 space-y-4">
                      <Panel title={null} actions={null}>
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <input
                              ref={roleNameInputRef}
                              type="text"
                              value={canEditRoleName ? roleNameDraft : getRoleDisplayName(selectedRole)}
                              disabled={!canEditRoleName || saving}
                              onChange={(event) => setRoleNameDraft(event.target.value)}
                              onBlur={handleRoleNameCommit}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xl font-semibold text-gray-100 disabled:cursor-default disabled:opacity-100"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {!selectedRole.isSystem ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={handleDeleteRole}
                                  className="rounded bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:bg-gray-700"
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>

                        </div>
                      </Panel>

                      <div className="flex flex-wrap gap-2 border-b border-gray-700">
                        {roleTabs.map(({ value, label, disabled }) => (
                          <button
                            key={value}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (disabled || value === roleDetailTab) return;
                              leaveAdmin(() => setRoleDetailTab(value));
                            }}
                            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                              roleDetailTab === value
                                ? 'border-blue-500 text-white'
                                : disabled
                                  ? 'border-transparent text-gray-600 cursor-not-allowed'
                                  : 'border-transparent text-gray-400 hover:text-gray-100'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {roleDetailTab === 'permissions' ? (
                        selectedRole.systemKey === 'admin' ? (
                          <Empty>Admin has full access automatically.</Empty>
                        ) : (
                          <div className="space-y-4">
                            <CompactAccessSection
                              title="Included roles"
                              count={parentRoleIdsDraft.length}
                            >
                              {canEditRoleParents ? (
                                <>
                                  {includableRoles.map((role) => {
                                    const checked = parentRoleIdsDraft.includes(role.id);
                                    return (
                                      <CompactAccessRow
                                        key={role.id}
                                        title={role.name}
                                        actions={(
                                          <ToggleSwitch
                                            checked={checked}
                                            disabled={saving}
                                            title={checked ? 'Remove included role' : 'Include role'}
                                            onChange={(nextChecked) => {
                                              setParentRoleIdsDraft((current) => (
                                                nextChecked
                                                  ? Array.from(new Set([...current, role.id]))
                                                  : current.filter((roleId) => roleId !== role.id)
                                              ));
                                            }}
                                          />
                                        )}
                                      />
                                    );
                                  })}
                                  {!includableRoles.length ? (
                                    <div className="p-4">
                                      <Empty>No custom roles can be included.</Empty>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="p-4">
                                  <Empty>System roles cannot include other roles.</Empty>
                                </div>
                              )}
                            </CompactAccessSection>

                            <CompactAccessSection
                              title="Access rules"
                              count={visibleRoleGrants.length}
                              titleExtra={<AccessTypeInfoButton />}
                              actions={(
                                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={showRedundantAccesses}
                                    onChange={(event) => setShowRedundantAccesses(event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-600 bg-gray-950 accent-blue-600"
                                  />
                                  Show redundant accesses
                                </label>
                              )}
                            >
                              <GrantRulesTable
                                grants={visibleRoleGrants}
                                catalog={catalog}
                                canEdit={Boolean(canEditRoleGrants)}
                                disabled={saving}
                                onChange={handleRoleGrantChange}
                                onAdd={handleAddRoleGrant}
                                onRemove={handleRemoveRoleGrant}
                                resetKey={roleEditorReset}
                              />
                            </CompactAccessSection>
                          </div>
                        )
                      ) : null}

                      {roleDetailTab === 'links' ? (
                        <div className="space-y-5">
                          {canEditRoleLinks ? (
                            <Panel title="Add link">
                              <div className="grid gap-3 lg:grid-cols-[1fr,1fr,auto]">
                                <input
                                  type="text"
                                  value={oidcClaimPathDraft}
                                  onChange={(event) => setOidcClaimPathDraft(event.target.value)}
                                  placeholder="Claim path"
                                  className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                />
                                <input
                                  type="text"
                                  value={oidcClaimValueDraft}
                                  onChange={(event) => setOidcClaimValueDraft(event.target.value)}
                                  placeholder="Value"
                                  className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                />
                                <button
                                  type="button"
                                  disabled={!oidcClaimValueDraft.trim() || saving}
                                  onClick={handleSaveRoleOidcLink}
                                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                >
                                  Add
                                </button>
                              </div>
                              <input
                                type="text"
                                value={oidcDescriptionDraft}
                                onChange={(event) => setOidcDescriptionDraft(event.target.value)}
                                placeholder="Description"
                                className="mt-3 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                              />
                            </Panel>
                          ) : null}

                          <Panel title="Links">
                            {!selectedRole.oidcLinks?.length ? (
                              <Empty>No links.</Empty>
                            ) : (
                              <div className="space-y-2">
                                {selectedRole.oidcLinks.map((link) => (
                                  <div
                                    key={link.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-medium text-white">
                                        {link.claimPath ? `${link.claimPath} = ${link.claimValue}` : link.claimValue}
                                      </div>
                                      {link.description ? (
                                        <div className="text-sm text-gray-400">{link.description}</div>
                                      ) : null}
                                    </div>
                                    {canEditRoleLinks ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRoleOidcLink(link)}
                                        className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                      >
                                        Remove
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </Panel>
                        </div>
                      ) : null}

                      {roleDetailTab === 'members' ? (
                        canShowMembers ? (
                          <div className="space-y-5">
                            <Panel title="Users">
                              <div className="space-y-4">
                                <div className="flex flex-col gap-2 md:flex-row">
                                  <select
                                    value={pendingRoleMemberId}
                                    onChange={(event) => setPendingRoleMemberId(event.target.value)}
                                    className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                  >
                                    <option value="">Add user...</option>
                                    {availableRoleMembers.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.username}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={!pendingRoleMemberId || saving}
                                    onClick={handleAddRoleMember}
                                    className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                  >
                                    Add
                                  </button>
                                </div>

                                {!selectedRole.members?.length ? (
                                  <Empty>No members.</Empty>
                                ) : (
                                  <div className="space-y-2">
                                    {selectedRole.members.map((member) => (
                                      <div
                                        key={member.id}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium text-white">{member.username}</span>
                                          {member.isAdmin ? <Badge tone="blue">Admin</Badge> : null}
                                          {member.source === 'oidc_link' ? <Badge tone="green">OIDC</Badge> : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveRoleMember(member.id)}
                                          className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </Panel>

                            {canEditRoleChildren ? (
                              <Panel title="Roles">
                                <div className="space-y-4">
                                  <div className="flex flex-col gap-2 md:flex-row">
                                    <select
                                      value={pendingChildRoleId}
                                      onChange={(event) => setPendingChildRoleId(event.target.value)}
                                      className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                    >
                                      <option value="">Add role...</option>
                                      {availableChildRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={!pendingChildRoleId || saving}
                                      onClick={handleAddChildRole}
                                      className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                    >
                                      Add
                                    </button>
                                  </div>

                                  {!selectedRole.childRoles?.length ? (
                                    <Empty>No role members.</Empty>
                                  ) : (
                                    <div className="space-y-2">
                                      {selectedRole.childRoles.map((role) => (
                                        <div
                                          key={role.id}
                                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                        >
                                          <div className="font-medium text-white">{role.name}</div>
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveChildRole(role.id)}
                                            className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </Panel>
                            ) : null}
                          </div>
                        ) : (
                          <Empty>Automatic for all users.</Empty>
                        )
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-6xl space-y-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <SearchField
                        value={roleSearch}
                        onChange={(event) => setRoleSearch(event.target.value)}
                        placeholder="Search roles"
                        className="md:flex-1"
                      />
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleCreateRole}
                        className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700"
                      >
                        Create role
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
                      <div className="grid grid-cols-[1fr,140px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 md:grid-cols-[1fr,150px,120px]">
                        <span>Role</span>
                        <span>Members</span>
                        <span className="hidden md:block">Links</span>
                      </div>
                      {filteredRoles.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => setSelectedRoleId(role.id)}
                          className={`grid w-full grid-cols-[1fr,140px] items-center gap-4 border-b px-4 py-4 text-left last:border-b-0 hover:bg-gray-900 md:grid-cols-[1fr,150px,120px] ${
                            role.isSystem ? 'border-gray-700 bg-gray-900/40' : 'border-gray-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{getRoleDisplayName(role)}</div>
                          </div>
                          <span className="text-sm text-gray-300">
                            {role.memberCount || 0}
                          </span>
                          <span className="hidden text-sm text-gray-300 md:block">{role.linkCount || 0}</span>
                        </button>
                      ))}
                      {!filteredRoles.length ? (
                        <div className="px-4 py-6">
                          <Empty>No roles found.</Empty>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              ) : tab === 'storage' ? (
                <AdminStoragePanel
                  session={session}
                  storage={storage}
                  onStorageChange={setStorage}
                />
              ) : (
                <div className="mx-auto max-w-6xl space-y-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <SearchField
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      placeholder="Search users"
                      className="md:flex-1"
                    />
                  </div>

                  <div className="overflow-visible rounded-xl border border-gray-800 bg-gray-950/50">
                    <div className="grid grid-cols-[1.1fr,1.6fr,40px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 lg:grid-cols-[1.2fr,1fr,1.5fr,40px]">
                      <span>User</span>
                      <span className="hidden lg:block">Identity</span>
                      <span>Roles</span>
                      <span />
                    </div>
                    {filteredUsers.map((user) => {
                      const userRoles = Array.isArray(user.roles) ? user.roles : [];
                      const isExpanded = expandedUserRoleIdSet.has(user.id);
                      const visibleRoles = isExpanded ? userRoles : userRoles.slice(0, 1);
                      const collapsedExtraRoleCount = Math.max(userRoles.length - 1, 0);
                      const userRoleIds = new Set(userRoles.map((role) => role.id));
                      return (
                        <div
                          key={user.id}
                          className="group grid grid-cols-[1.1fr,1.6fr,40px] items-center gap-4 border-b border-gray-800 px-4 py-4 last:border-b-0 hover:bg-gray-900/70 lg:grid-cols-[1.2fr,1fr,1.5fr,40px]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{user.username}</div>
                            <div className="mt-1 truncate text-xs text-gray-500 lg:hidden">
                              {user.oidcDisplayName || user.oidcEmail || 'No identity'}
                            </div>
                          </div>
                          <div className="hidden min-w-0 lg:block">
                            <div className="truncate text-sm text-gray-300">
                              {user.oidcDisplayName || user.oidcEmail || '-'}
                            </div>
                            {user.oidcDisplayName && user.oidcEmail ? (
                              <div className="truncate text-xs text-gray-500">{user.oidcEmail}</div>
                            ) : null}
                          </div>
                          <div className="relative flex min-w-0 flex-wrap items-center gap-2">
                            {visibleRoles.map((role) => (
                              <span
                                key={role.id}
                                className="max-w-48 truncate rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-100"
                              >
                                {role.name}
                              </span>
                            ))}
                            {!userRoles.length ? (
                              <span className="text-sm text-gray-500">No roles</span>
                            ) : null}
                            {collapsedExtraRoleCount > 0 ? (
                              <button
                                type="button"
                                title={isExpanded ? 'Hide extra roles' : 'Show all roles'}
                                onClick={() => toggleExpandedUserRoles(user.id)}
                                className="rounded bg-gray-800 px-2.5 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-700"
                              >
                                {isExpanded ? '-' : `+${collapsedExtraRoleCount}`}
                              </button>
                            ) : null}
                            {customAssignableRoles.length ? (
                              <div
                                className="relative"
                                ref={rolePickerUserId === user.id ? rolePickerRef : null}
                              >
                                <button
                                  type="button"
                                  title="Add role"
                                  disabled={saving}
                                  onClick={() => setRolePickerUserId((current) => (current === user.id ? '' : user.id))}
                                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-200 opacity-0 transition hover:bg-gray-700 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                                >
                                  <Plus size={13} />
                                </button>
                                {rolePickerUserId === user.id ? (
                                  <div className="absolute right-0 top-full z-40 mt-2 max-h-72 w-64 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-2 shadow-2xl">
                                    {customAssignableRoles.map((role) => {
                                      const checked = userRoleIds.has(role.id);
                                      return (
                                      <label
                                        key={role.id}
                                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800"
                                      >
                                        <span className="truncate">{role.name}</span>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={saving}
                                          onChange={(event) => handleSetUserRoleFromList(user.id, role.id, event.target.checked)}
                                          className="h-4 w-4 rounded border-gray-600 bg-gray-950 accent-blue-600"
                                        />
                                      </label>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div
                            className="relative flex justify-end"
                            ref={userActionMenuId === user.id ? userActionMenuRef : null}
                          >
                            <button
                              type="button"
                              title="More actions"
                              onClick={() => setUserActionMenuId((current) => (current === user.id ? '' : user.id))}
                              className="flex h-8 w-8 items-center justify-center rounded bg-gray-800 text-gray-300 opacity-0 transition hover:bg-gray-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
                            >
                              <MoreHorizontal size={17} />
                            </button>
                            {userActionMenuId === user.id ? (
                              <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-2xl">
                                <button
                                  type="button"
                                  onClick={() => openUserAccessModal(user)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800"
                                >
                                  Manage direct access
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('transfer', user)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800"
                                >
                                  Transfer all ownership
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('delete', user)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 hover:bg-red-950/40"
                                >
                                  Delete user
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {!filteredUsers.length ? (
                      <div className="px-4 py-6">
                        <Empty>No users found.</Empty>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {userAccessModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-white">
                  Direct access: {userAccessModal.user?.username || 'User'}
                </h2>
                <div className="mt-1 truncate text-sm text-gray-400">
                  {userAccessModal.user?.oidcDisplayName || userAccessModal.user?.oidcEmail || 'Apollo user'}
                </div>
              </div>
              <button
                type="button"
                onClick={closeUserAccessModal}
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
              >
                Close
              </button>
            </div>

            <div className={`max-h-[calc(90vh-78px)] overflow-auto p-3 ${userAccessDirty ? 'pb-24' : ''}`}>
              {userAccessModal.loading ? (
                <Empty>Loading access...</Empty>
              ) : (
                <div className="space-y-5">
                  <CompactAccessSection
                    title="Roles"
                    count={(userAccessModal.detail?.roles || []).length}
                  >
                    {(userAccessModal.detail?.roles || []).length ? (
                      (userAccessModal.detail?.roles || []).map((role) => (
                        <CompactAccessRow
                          key={role.id}
                          title={getRoleDisplayName(role)}
                          badges={role.isSystem ? <Badge tone="blue">System</Badge> : null}
                        />
                      ))
                    ) : (
                      <div className="p-4">
                        <Empty>No roles.</Empty>
                      </div>
                    )}
                  </CompactAccessSection>

                  <CompactAccessSection
                    title="Direct access rules"
                    count={visibleUserDirectGrants.length}
                    titleExtra={<AccessTypeInfoButton />}
                    actions={(
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-300">
                        <input
                          type="checkbox"
                          checked={showRedundantUserAccesses}
                          onChange={(event) => setShowRedundantUserAccesses(event.target.checked)}
                          className="h-4 w-4 rounded border-gray-600 bg-gray-950 accent-blue-600"
                        />
                        Show redundant accesses
                      </label>
                    )}
                  >
                    <GrantRulesTable
                      grants={visibleUserDirectGrants}
                      catalog={catalog}
                      canEdit
                      disabled={saving}
                      onChange={handleUserGrantChange}
                      onAdd={handleAddUserGrant}
                      onRemove={handleRemoveUserGrant}
                      resetKey={userEditorReset}
                    />
                  </CompactAccessSection>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {userActionModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">
                {userActionModal.type === 'delete' ? 'Delete user' : 'Transfer ownership'}
              </h2>
              <p className="text-sm text-gray-400">
                {userActionModal.type === 'delete'
                  ? `Choose who should receive all ownership from ${userActionModalUser?.username || 'this user'} before deletion.`
                  : `Transfer all ownership from ${userActionModalUser?.username || 'this user'} to another user.`}
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm text-gray-300" htmlFor="ownership-transfer-target">
                Transfer ownership to
              </label>
              <select
                id="ownership-transfer-target"
                value={userActionModal.targetUserId}
                onChange={(event) => setUserActionModal((current) => (
                  current ? { ...current, targetUserId: event.target.value } : current
                ))}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
              >
                <option value="">Select user...</option>
                {userActionTargetUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUserActionModal(null)}
                className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-100 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !userActionModal.targetUserId}
                onClick={handleConfirmUserAction}
                className={`rounded px-4 py-2 text-sm text-white disabled:bg-gray-700 ${
                  userActionModal.type === 'delete'
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {userActionModal.type === 'delete' ? 'Delete user' : 'Transfer ownership'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <UnsavedAccessBar
        open={accessDirty}
        attention={accessBarAttention}
        saving={saving}
        onDiscard={() => {
          if (userAccessDirty) discardUserAccess();
          if (roleAccessDirty) discardRoleAccess();
        }}
        onSave={() => {
          if (userAccessDirty) handleSaveUserAccess();
          if (roleAccessDirty) handleSaveRoleAccess();
        }}
      />
    </div>
  );
}
