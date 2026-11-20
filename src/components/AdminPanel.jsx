import { useEffect, useMemo, useRef, useState } from 'react';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleUserRound, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import '../styles/player-theme.css';
import { BrandMark, BrandWordmark } from './BrandLogo';
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
    slate: 'border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]',
    blue: 'border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]',
    amber: 'border border-[var(--player-warning-border)] bg-[var(--player-warning-soft)] text-[var(--player-warning-text)]',
    green: 'border border-[var(--player-success-border)] bg-[var(--player-success-soft)] text-[var(--player-success-text)]',
  }[tone] || 'border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]';

  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function Panel({ title, actions = null, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)]">
      {(title || actions) ? (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--player-border-subtle)] px-4 py-3">
          {title ? <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--player-border-default)] bg-[var(--player-bg-surface-subtle)] px-4 py-4 text-sm text-[var(--player-text-muted)]">
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
    <label className={`flex items-center gap-3 rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-4 py-3 text-sm text-[var(--player-text-secondary)] focus-within:border-[var(--player-accent-border)] focus-within:ring-1 focus-within:ring-[var(--player-focus-ring)] ${className}`}>
      <Search size={16} className="shrink-0 text-[var(--player-text-muted)]" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-[var(--player-text-primary)] outline-none placeholder:text-[var(--player-text-muted)]"
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
          ? 'border-[var(--player-accent-border)] bg-[var(--player-accent)]'
          : 'border-[var(--player-border-default)] bg-[var(--player-bg-active-segment)]'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--player-accent-hover)]'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform ${
          checked
            ? 'translate-x-5 bg-[var(--player-accent-foreground)]'
            : 'translate-x-0.5 bg-[var(--player-text-body)]'
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
    <section className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--player-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--player-accent-text)]">{title}</h3>
          {count !== null ? (
            <span className="rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--player-text-secondary)]">
              {count}
            </span>
          ) : null}
          {titleExtra}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-[var(--player-border-subtle)]">{children}</div>
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
      className={`grid grid-cols-[1fr,auto] items-center gap-4 px-4 py-2.5 transition hover:bg-[var(--player-hover)] ${
        muted ? 'opacity-70' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-[var(--player-text-primary)]">{title}</span>
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
  const inRouter = useInRouterContext();
  const navigate = inRouter ? useNavigate() : null;
  const { tab: tabParam, roleId: roleIdParam } = inRouter ? useParams() : {};

  const [tab, setTab] = useState('roles');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [artists, setArtists] = useState({ users: [], groups: [], guests: [] });
  const [catalog, setCatalog] = useState({ shows: [], projects: [], groupNames: [], partNames: [] });
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const VALID_TABS = useMemo(() => ['roles', 'users', 'shows', 'artists', 'storage'], []);

  useEffect(() => {
    if (!inRouter) return;
    if (roleIdParam) {
      if (tab !== 'roles') setTab('roles');
      if (selectedRoleId !== roleIdParam) setSelectedRoleId(roleIdParam);
      return;
    }
    if (tabParam && VALID_TABS.includes(tabParam)) {
      if (tab !== tabParam) setTab(tabParam);
      if (selectedRoleId) setSelectedRoleId('');
    }
  }, [inRouter, tabParam, roleIdParam, tab, selectedRoleId, VALID_TABS]);
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
        if (inRouter) {
          navigate(`/admin/roles/${createdRole.id}`);
        } else {
          setSelectedRoleId(createdRole.id);
        }
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

  const navItems = [
    {
      id: 'artists',
      label: 'Artists',
      count: (artists.users?.length || 0) + (artists.groups?.length || 0) + (artists.guests?.length || 0),
    },
    { id: 'users', label: 'Users', count: users.length },
    { id: 'shows', label: 'Shows', count: catalog.shows?.length || 0 },
    { id: 'roles', label: 'Roles', count: roles.length },
    { id: 'storage', label: 'Storage', count: null },
  ];

  const selectAdminTab = (nextTab) => {
    leaveAdmin(() => {
      if (inRouter) {
        navigate(`/admin/${nextTab}`);
      } else {
        setSelectedRoleId('');
        setTab(nextTab);
      }
    });
  };

  return (
    <div
      className="player-theme h-full w-full overflow-hidden bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)]"
      data-player-theme="dark-gold"
    >
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div
          data-admin-topbar
          className="relative z-[100] flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--player-border-subtle)] bg-[var(--player-bg-canvas)] px-4"
        >
          <button
            type="button"
            onClick={() => leaveAdmin(() => onClose?.())}
            className="m-0 leading-none rounded-md hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--player-focus-ring)]"
            title="Go to Apollo"
            aria-label="Go to Apollo"
          >
            <BrandMark className="h-7 w-7 sm:hidden" />
            <BrandWordmark className="hidden h-8 sm:block" />
          </button>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)] p-0.5">
              <button
                type="button"
                onClick={() => leaveAdmin(() => onClose?.())}
                className="rounded-full px-3.5 py-1 text-xs font-medium text-[var(--player-text-secondary)] transition-colors hover:text-[var(--player-text-primary)]"
                title="Switch to Player"
              >
                Player
              </button>
              <button
                type="button"
                disabled
                className="rounded-full bg-[var(--player-bg-active-segment)] px-3.5 py-1 text-xs font-semibold text-[var(--player-accent-text)] cursor-default"
                title="Current page"
              >
                Admin
              </button>
            </div>
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((previous) => !previous)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-primary)] transition-colors hover:bg-[var(--player-hover)]"
                title="User menu"
              >
                <CircleUserRound size={18} />
              </button>
              {profileMenuOpen ? (
                <div className="player-menu absolute right-0 top-full z-[110] mt-2 min-w-40 overflow-hidden rounded-xl py-1">
                  {onOpenProfile ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onOpenProfile();
                      }}
                      className="player-menu-item w-full px-3.5 py-2 text-left text-sm"
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
                    className="player-menu-item w-full px-3.5 py-2 text-left text-sm"
                  >
                    Go to app
                  </button>
                  <div className="my-1 border-t border-[var(--player-border-subtle)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      leaveAdmin(() => onLogout?.());
                    }}
                    className="player-menu-item w-full px-3.5 py-2 text-left text-sm text-[var(--player-danger)] hover:bg-[var(--player-danger-soft)] hover:text-[var(--player-danger)]"
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-5 py-3 text-sm text-[var(--player-danger-text)]">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2.5">
          <div className="flex h-full flex-col gap-2.5 overflow-hidden md:flex-row">
            <aside className="shrink-0 rounded-[10px] border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)] p-1.5 md:w-48 md:p-2">
              <nav className="grid grid-cols-5 gap-1 px-0.5 md:block md:space-y-1 md:px-0" aria-label="Admin Navigation">
                {navItems.map((item) => {
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectAdminTab(item.id)}
                      className={`relative flex min-w-0 items-center justify-center rounded-lg border px-1 py-1.5 text-center text-[11px] sm:text-xs transition-colors md:w-full md:justify-between md:gap-1.5 md:border-transparent md:px-2.5 md:py-2 md:text-left md:text-sm ${
                        active
                          ? 'border-[var(--player-accent-border)] bg-[var(--player-bg-elevated)] text-[var(--player-accent-text)] font-semibold md:border-transparent md:text-[var(--player-text-primary)]'
                          : 'border-transparent text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                      }`}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="hidden md:block absolute inset-y-2 left-0 w-[2.5px] rounded-r-full bg-[var(--player-accent)]"
                        />
                      ) : null}
                      <span className={`font-medium md:pl-1.5 ${active ? 'text-[var(--player-accent-text)] font-semibold' : ''}`}>
                        {item.label}
                      </span>
                      {item.count !== null ? (
                        <span className="hidden md:inline-flex rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-canvas)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--player-text-muted)] md:px-2 md:text-xs">
                          {item.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className={`min-w-0 flex-1 overflow-auto p-0 md:rounded-[10px] md:border md:border-[var(--player-border-subtle)] md:bg-[var(--player-bg-surface)] md:p-4 ${accessDirty ? 'pb-24' : ''}`}>
              {loading ? (
                <Empty>Loading...</Empty>
              ) : tab === 'artists' ? (
                <div className="mx-auto max-w-6xl space-y-5">
                  <div className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)]">
                    <div className="grid grid-cols-[1fr,150px,80px] gap-4 border-b border-[var(--player-border-subtle)] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-text-muted)]">
                      <span>Artist</span>
                      <span>Type</span>
                      <span />
                    </div>
                    {allArtists.map((artist) => (
                      <div
                        key={`${artist.kind}:${artist.id}`}
                        className="grid grid-cols-[1fr,150px,80px] items-center gap-4 border-b border-[var(--player-border-subtle)] px-4 py-4 last:border-b-0 transition-colors hover:bg-[var(--player-hover)]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--player-text-primary)]">{artist.name}</div>
                          {artist.description ? (
                            <div className="mt-1 truncate text-sm text-[var(--player-text-secondary)]">{artist.description}</div>
                          ) : (
                            <div className="mt-1 text-sm text-[var(--player-text-disabled)]">No artist description.</div>
                          )}
                        </div>
                        <div className="text-sm text-[var(--player-text-secondary)]">
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
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            title="Delete"
                            aria-label={`Delete ${artist.name}`}
                            onClick={() => handleDeleteArtist(artist)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:border-[var(--player-danger-border)] hover:bg-[var(--player-hover)] hover:text-[var(--player-danger)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                    <aside className="space-y-2 rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] p-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => leaveAdmin(() => {
                            if (inRouter) {
                              navigate('/admin/roles');
                            } else {
                              setSelectedRoleId('');
                            }
                          })}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-2.5 py-1.5 text-left text-sm font-medium text-[var(--player-text-primary)] transition hover:bg-[var(--player-hover)] lg:hidden"
                        >
                          <ArrowLeft size={16} className="shrink-0" />
                          <span className="truncate">Back</span>
                        </button>
                        <span className="hidden lg:block flex-1 truncate px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--player-text-muted)]">
                          Roles
                        </span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleCreateRole}
                          title="Create role"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-primary)] transition hover:border-[var(--player-accent-border)] hover:text-[var(--player-accent-text)] disabled:opacity-50"
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
                              leaveAdmin(() => {
                                if (inRouter) {
                                  navigate(`/admin/roles/${role.id}`);
                                } else {
                                  setSelectedRoleId(role.id);
                                }
                              });
                            }}
                            className={`relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                              role.id === selectedRoleId
                                ? 'bg-[var(--player-bg-elevated)] text-[var(--player-accent-text)] font-semibold'
                                : 'text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)]'
                            }`}
                          >
                            <div className="min-w-0 truncate">{getRoleDisplayName(role)}</div>
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
                              className="min-w-0 flex-1 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3.5 py-2 text-xl font-bold tracking-tight text-[var(--player-text-primary)] outline-none focus:border-[var(--player-accent-border)] disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:opacity-100"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {!selectedRole.isSystem ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={handleDeleteRole}
                                  className="rounded-lg border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-3.5 py-2 text-sm font-semibold text-[var(--player-danger-text)] transition-colors hover:bg-[var(--player-danger-surface)] disabled:opacity-45"
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>

                        </div>
                      </Panel>

                      <div className="flex flex-wrap gap-2 border-b border-[var(--player-border-subtle)]">
                        {roleTabs.map(({ value, label, disabled }) => (
                          <button
                            key={value}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (disabled || value === roleDetailTab) return;
                              leaveAdmin(() => setRoleDetailTab(value));
                            }}
                            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                              roleDetailTab === value
                                ? 'border-[var(--player-accent)] text-[var(--player-accent-text)]'
                                : disabled
                                  ? 'border-transparent text-[var(--player-text-disabled)] cursor-not-allowed'
                                  : 'border-transparent text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
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
                                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--player-text-secondary)]">
                                  <input
                                    type="checkbox"
                                    checked={showRedundantAccesses}
                                    onChange={(event) => setShowRedundantAccesses(event.target.checked)}
                                    className="h-4 w-4 rounded border-[var(--player-border-default)] bg-[var(--player-bg-popover)]"
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
                                  className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] placeholder:text-[var(--player-text-muted)] outline-none focus:border-[var(--player-accent-border)]"
                                />
                                <input
                                  type="text"
                                  value={oidcClaimValueDraft}
                                  onChange={(event) => setOidcClaimValueDraft(event.target.value)}
                                  placeholder="Value"
                                  className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] placeholder:text-[var(--player-text-muted)] outline-none focus:border-[var(--player-accent-border)]"
                                />
                                <button
                                  type="button"
                                  disabled={!oidcClaimValueDraft.trim() || saving}
                                  onClick={handleSaveRoleOidcLink}
                                  className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] transition-colors hover:bg-[var(--player-accent-hover)] disabled:opacity-45"
                                >
                                  Add
                                </button>
                              </div>
                              <input
                                type="text"
                                value={oidcDescriptionDraft}
                                onChange={(event) => setOidcDescriptionDraft(event.target.value)}
                                placeholder="Description"
                                className="mt-3 w-full rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] placeholder:text-[var(--player-text-muted)] outline-none focus:border-[var(--player-accent-border)]"
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
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3.5 py-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-medium text-[var(--player-text-primary)]">
                                        {link.claimPath ? `${link.claimPath} = ${link.claimValue}` : link.claimValue}
                                      </div>
                                      {link.description ? (
                                        <div className="text-sm text-[var(--player-text-secondary)]">{link.description}</div>
                                      ) : null}
                                    </div>
                                    {canEditRoleLinks ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRoleOidcLink(link)}
                                        className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
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
                                    className="flex-1 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] outline-none focus:border-[var(--player-accent-border)]"
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
                                    className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] transition-colors hover:bg-[var(--player-accent-hover)] disabled:opacity-45"
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
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3.5 py-3"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium text-[var(--player-text-primary)]">{member.username}</span>
                                          {member.isAdmin ? <Badge tone="blue">Admin</Badge> : null}
                                          {member.source === 'oidc_link' ? <Badge tone="green">OIDC</Badge> : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveRoleMember(member.id)}
                                          className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
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
                                      className="flex-1 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] outline-none focus:border-[var(--player-accent-border)]"
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
                                      className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] transition-colors hover:bg-[var(--player-accent-hover)] disabled:opacity-45"
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
                                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3.5 py-3"
                                        >
                                          <div className="font-medium text-[var(--player-text-primary)]">{role.name}</div>
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveChildRole(role.id)}
                                            className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
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
                        className="rounded-xl bg-[var(--player-accent)] px-4 py-3 text-sm font-bold text-[var(--player-accent-foreground)] transition-colors hover:bg-[var(--player-accent-hover)] disabled:opacity-45"
                      >
                        Create role
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)]">
                      <div className="grid grid-cols-[1fr,140px] gap-4 border-b border-[var(--player-border-subtle)] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-text-muted)] md:grid-cols-[1fr,150px,120px]">
                        <span>Role</span>
                        <span>Members</span>
                        <span className="hidden md:block">Links</span>
                      </div>
                      {filteredRoles.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            if (inRouter) {
                              navigate(`/admin/roles/${role.id}`);
                            } else {
                              setSelectedRoleId(role.id);
                            }
                          }}
                          className={`grid w-full grid-cols-[1fr,140px] items-center gap-4 border-b border-[var(--player-border-subtle)] px-4 py-4 text-left last:border-b-0 transition-colors hover:bg-[var(--player-hover)] md:grid-cols-[1fr,150px,120px] ${
                            role.isSystem ? 'bg-[var(--player-bg-elevated)]' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--player-text-primary)]">{getRoleDisplayName(role)}</div>
                          </div>
                          <span className="text-sm tabular-nums text-[var(--player-text-secondary)]">
                            {role.memberCount || 0}
                          </span>
                          <span className="hidden text-sm tabular-nums text-[var(--player-text-secondary)] md:block">{role.linkCount || 0}</span>
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

                  <div className="overflow-visible rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)]">
                    <div className="hidden grid-cols-[1.2fr,1fr,1.5fr,40px] gap-4 border-b border-[var(--player-border-subtle)] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-text-muted)] lg:grid">
                      <span>User</span>
                      <span>Identity</span>
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
                          className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-b border-[var(--player-border-subtle)] px-4 py-3.5 last:border-b-0 transition-colors hover:bg-[var(--player-hover)] lg:grid-cols-[1.2fr,1fr,1.5fr,40px] lg:gap-4 lg:py-4"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--player-text-primary)]">{user.username}</div>
                            <div className="mt-0.5 truncate text-xs text-[var(--player-text-muted)] lg:hidden">
                              {user.oidcDisplayName || user.oidcEmail || 'No identity'}
                            </div>
                          </div>
                          <div className="hidden min-w-0 lg:block">
                            <div className="truncate text-sm text-[var(--player-text-secondary)]">
                              {user.oidcDisplayName || user.oidcEmail || '-'}
                            </div>
                            {user.oidcDisplayName && user.oidcEmail ? (
                              <div className="truncate text-xs text-[var(--player-text-muted)]">{user.oidcEmail}</div>
                            ) : null}
                          </div>
                          <div className="relative col-span-2 flex min-w-0 flex-wrap items-center gap-2 lg:col-span-1">
                            {visibleRoles.map((role) => (
                              <span
                                key={role.id}
                                className="max-w-48 truncate rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2.5 py-0.5 text-xs font-medium text-[var(--player-text-primary)]"
                              >
                                {role.name}
                              </span>
                            ))}
                            {!userRoles.length ? (
                              <span className="text-sm text-[var(--player-text-muted)]">No roles</span>
                            ) : null}
                            {collapsedExtraRoleCount > 0 ? (
                              <button
                                type="button"
                                title={isExpanded ? 'Hide extra roles' : 'Show all roles'}
                                onClick={() => toggleExpandedUserRoles(user.id)}
                                className="rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
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
                                  className="flex h-6 items-center justify-center rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2.5 text-[var(--player-text-secondary)] opacity-100 transition hover:bg-[var(--player-hover)] hover:text-[var(--player-accent-text)] md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                                >
                                  <Plus size={13} />
                                </button>
                                {rolePickerUserId === user.id ? (
                                  <div className="player-menu absolute left-0 top-full z-40 mt-2 max-h-72 w-64 overflow-auto rounded-xl p-1.5 lg:left-auto lg:right-0">
                                    {customAssignableRoles.map((role) => {
                                      const checked = userRoleIds.has(role.id);
                                      return (
                                      <label
                                        key={role.id}
                                        className="player-menu-item flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm"
                                      >
                                        <span className="truncate">{role.name}</span>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={saving}
                                          onChange={(event) => handleSetUserRoleFromList(user.id, role.id, event.target.checked)}
                                          className="h-4 w-4 rounded border-[var(--player-border-default)] bg-[var(--player-bg-canvas)]"
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
                            className="relative col-start-2 row-start-1 flex justify-end lg:col-start-auto lg:row-start-auto"
                            ref={userActionMenuId === user.id ? userActionMenuRef : null}
                          >
                            <button
                              type="button"
                              title="More actions"
                              onClick={() => setUserActionMenuId((current) => (current === user.id ? '' : user.id))}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] opacity-100 transition hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                            >
                              <MoreHorizontal size={17} />
                            </button>
                            {userActionMenuId === user.id ? (
                              <div className="player-menu absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl py-1">
                                <button
                                  type="button"
                                  onClick={() => openUserAccessModal(user)}
                                  className="player-menu-item w-full px-3.5 py-2 text-left text-sm"
                                >
                                  Manage direct access
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('transfer', user)}
                                  className="player-menu-item w-full px-3.5 py-2 text-left text-sm"
                                >
                                  Transfer all ownership
                                </button>
                                <div className="my-1 border-t border-[var(--player-border-subtle)]" />
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('delete', user)}
                                  className="player-menu-item w-full px-3.5 py-2 text-left text-sm text-[var(--player-danger)] hover:bg-[var(--player-danger-soft)] hover:text-[var(--player-danger)]"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] shadow-[var(--player-shadow-popover)]">
            <div className="player-hero-surface flex items-start justify-between gap-4 border-b border-[var(--player-border-subtle)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold tracking-tight text-[var(--player-text-primary)]">
                  Direct access: {userAccessModal.user?.username || 'User'}
                </h2>
                <div className="mt-1 truncate text-sm text-[var(--player-text-secondary)]">
                  {userAccessModal.user?.oidcDisplayName || userAccessModal.user?.oidcEmail || 'Apollo user'}
                </div>
              </div>
              <button
                type="button"
                onClick={closeUserAccessModal}
                className="rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3.5 py-1.5 text-xs font-semibold text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
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
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--player-text-secondary)]">
                        <input
                          type="checkbox"
                          checked={showRedundantUserAccesses}
                          onChange={(event) => setShowRedundantUserAccesses(event.target.checked)}
                          className="h-4 w-4 rounded border-[var(--player-border-default)] bg-[var(--player-bg-popover)]"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] p-6 shadow-[var(--player-shadow-popover)]">
            <div className="space-y-2">
              <h2 className="text-lg font-bold tracking-tight text-[var(--player-text-primary)]">
                {userActionModal.type === 'delete' ? 'Delete user' : 'Transfer ownership'}
              </h2>
              <p className="text-sm text-[var(--player-text-secondary)]">
                {userActionModal.type === 'delete'
                  ? `Choose who should receive all ownership from ${userActionModalUser?.username || 'this user'} before deletion.`
                  : `Transfer all ownership from ${userActionModalUser?.username || 'this user'} to another user.`}
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-[var(--player-text-secondary)]" htmlFor="ownership-transfer-target">
                Transfer ownership to
              </label>
              <select
                id="ownership-transfer-target"
                value={userActionModal.targetUserId}
                onChange={(event) => setUserActionModal((current) => (
                  current ? { ...current, targetUserId: event.target.value } : current
                ))}
                className="w-full rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] outline-none focus:border-[var(--player-accent-border)]"
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
                className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !userActionModal.targetUserId}
                onClick={handleConfirmUserAction}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:opacity-45 ${
                  userActionModal.type === 'delete'
                    ? 'bg-[var(--player-danger-solid)] text-[var(--player-danger-foreground)] hover:bg-[var(--player-danger-solid-hover)]'
                    : 'bg-[var(--player-accent)] text-[var(--player-accent-foreground)] hover:bg-[var(--player-accent-hover)]'
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
