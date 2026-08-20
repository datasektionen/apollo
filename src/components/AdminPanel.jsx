import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleUserRound, MoreHorizontal, Plus, Search } from 'lucide-react';
import { BrandWordmark } from './BrandLogo';
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
  listAdminArtists,
  listRbacRoles,
  listUsers,
  removeRbacRoleMember,
  removeUserRole,
  saveRbacRoleGrant,
  saveUserGrant,
  transferUserOwnership,
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

const PERMISSION_HELP = {
  show_manager: 'Full control inside the selected show, including its musical numbers and tracks. Does not create new shows.',
  show_creator: 'Can create new shows. Shows you create become fully manageable by you.',
  show_reader: 'Can only see that a show exists.',
  project_manager: 'Full control of the selected musical numbers and everything inside them.',
  project_creator: 'Can create new musical numbers inside the selected shows.',
  project_reader: 'Can see musical numbers in the DAW dashboard and listen to their tutti mixes, but cannot open them.',
  track_manager: 'Full control of tracks in the selected scope, including descendant subtracks.',
  track_creator: 'Can create tracks or subtracks in the selected scope. Created tracks become fully manageable by you.',
  track_reader: 'Can open musical numbers in the DAW and create mixes.',
};

const PERMISSION_COVERAGE = {
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

const PERMISSION_SCOPE_FLOW = {
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

const ALL_SCOPE_VALUE = '__all__';

function getPermissionHelp(permissionKey) {
  return PERMISSION_HELP[permissionKey] || 'This permission controls what the user can do in Apollo.';
}

function getPermissionLabel(catalog, permissionKey) {
  const option = (catalog?.permissions || []).find((candidate) => candidate.value === permissionKey);
  return option?.label || permissionKey || 'Permission';
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

function getGrantHoverTitle(grant) {
  const parts = [getPermissionHelp(grant.permissionKey)];
  if (grant.sourceType === 'inherited' && grant.sourceRoleName) {
    parts.push(`Inherited from ${grant.sourceRoleName}.`);
  }
  if (grant.isRedundant) {
    parts.push('Redundant because a broader access already covers this.');
  }
  return parts.filter(Boolean).join(' ');
}

function formatGrantLabel(grant) {
  const permissionLabel = grant.permissionLabel || grant.permissionKey || 'Permission';
  const parts = [permissionLabel];
  if (grant.scopeType === 'all') parts.push('All');
  if (grant.scopeType === 'show') parts.push(`Show: ${grant.scopeLabel || 'Unknown show'}`);
  if (grant.scopeType === 'project') parts.push(`Musical number: ${grant.scopeLabel || 'Unknown project'}`);
  if (grant.scopeType === 'track') parts.push(`Track: ${grant.scopeLabel || 'Unknown track'}`);
  if (grant.scopeType === 'group_name') parts.push(`Group: ${grant.scopeLabel || grant.scopeNameValue || ''}`);
  if (grant.scopeType === 'part_name') parts.push(`Part: ${grant.scopeLabel || grant.scopeNameValue || ''}`);
  if (grant.scopeGroupNameValue && grant.scopeType !== 'group_name') {
    parts.push(`Group: ${grant.scopeGroupLabel || grant.scopeGroupNameValue}`);
  }
  if (grant.scopePartNameValue && grant.scopeType !== 'part_name') {
    parts.push(`Part: ${grant.scopePartLabel || grant.scopePartNameValue}`);
  }
  return parts.join(' • ');
}

function GrantList({ grants = [], canRemove = true, onRemove }) {
  if (!grants.length) {
    return (
      <div className="p-4">
        <Empty>No access rules.</Empty>
      </div>
    );
  }

  return (
    <>
      {grants.map((grant) => {
        const inherited = grant.sourceType === 'inherited';
        const removable = canRemove && !inherited;
        const badges = (inherited || grant.isRedundant) ? (
          <>
            {inherited && grant.sourceRoleName ? (
              <Badge tone="amber">Inherited from {grant.sourceRoleName}</Badge>
            ) : null}
            {grant.isRedundant ? <Badge>Redundant</Badge> : null}
          </>
        ) : null;
        return (
          <CompactAccessRow
            key={grant.id}
            title={formatGrantLabel(grant)}
            titleAttr={getGrantHoverTitle(grant)}
            badges={badges}
            muted={grant.isRedundant}
            actions={removable ? (
              <button
                type="button"
                onClick={() => onRemove?.(grant)}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-100 hover:bg-gray-700"
              >
                Remove
              </button>
            ) : null}
          />
        );
      })}
    </>
  );
}

function GrantEditor({
  catalog,
  disabled = false,
  excludedPermissions = [],
  onSave,
}) {
  const excludedPermissionSet = new Set(excludedPermissions);
  const permissionOptions = (catalog?.permissions || []).filter((option) => (
    !excludedPermissionSet.has(option.value)
  ));

  const [permissionKey, setPermissionKey] = useState(permissionOptions[0]?.value || 'project_reader');
  const [scopeShowId, setScopeShowId] = useState(ALL_SCOPE_VALUE);
  const [scopeProjectId, setScopeProjectId] = useState(ALL_SCOPE_VALUE);
  const [groupScopeValue, setGroupScopeValue] = useState(ALL_SCOPE_VALUE);
  const [partScopeValue, setPartScopeValue] = useState(ALL_SCOPE_VALUE);
  const [scopeTrackId, setScopeTrackId] = useState(ALL_SCOPE_VALUE);

  const scopeFlow = PERMISSION_SCOPE_FLOW[permissionKey] || [];
  const hasShowScope = scopeFlow.includes('show');
  const hasProjectScope = scopeFlow.includes('project');
  const hasGroupScope = scopeFlow.includes('group');
  const hasPartScope = scopeFlow.includes('part');
  const hasTrackScope = scopeFlow.includes('track');

  const showOptions = catalog?.shows || [];
  const tracks = catalog?.tracks || [];
  const groupLabelByValue = new Map((catalog?.groupNames || []).map((option) => [option.value, option.label]));
  const partLabelByValue = new Map((catalog?.partNames || []).map((option) => [option.value, option.label]));

  const applyPermissionDefaults = (nextPermissionKey) => {
    setPermissionKey(nextPermissionKey);
    setScopeShowId(ALL_SCOPE_VALUE);
    setScopeProjectId(ALL_SCOPE_VALUE);
    setGroupScopeValue(ALL_SCOPE_VALUE);
    setPartScopeValue(ALL_SCOPE_VALUE);
    setScopeTrackId(ALL_SCOPE_VALUE);
  };

  useEffect(() => {
    if (!permissionOptions.some((option) => option.value === permissionKey)) {
      applyPermissionDefaults(permissionOptions[0]?.value || 'project_reader');
    }
  }, [permissionKey, permissionOptions]);

  const projectOptions = (catalog?.projects || []).filter((project) => (
    scopeShowId === ALL_SCOPE_VALUE || project.showId === scopeShowId
  ));
  const scopedTrackOptions = tracks.filter((track) => (
    (scopeShowId === ALL_SCOPE_VALUE || track.showId === scopeShowId)
    && (scopeProjectId === ALL_SCOPE_VALUE || track.projectId === scopeProjectId)
  ));
  const groupOptions = Array.from(new Set(
    scopedTrackOptions.flatMap((track) => Array.isArray(track.groupValues) ? track.groupValues : [])
  ))
    .sort((left, right) => (groupLabelByValue.get(left) || left).localeCompare(groupLabelByValue.get(right) || right, undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map((value) => ({ value, label: groupLabelByValue.get(value) || value }));
  const partOptions = Array.from(new Set(
    scopedTrackOptions
      .filter((track) => groupScopeValue === ALL_SCOPE_VALUE || (track.groupValues || []).includes(groupScopeValue))
      .flatMap((track) => Array.isArray(track.partValues) ? track.partValues : [])
  ))
    .sort((left, right) => (partLabelByValue.get(left) || left).localeCompare(partLabelByValue.get(right) || right, undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map((value) => ({ value, label: partLabelByValue.get(value) || value }));
  const trackOptions = scopedTrackOptions.filter((track) => (
    (groupScopeValue === ALL_SCOPE_VALUE || (track.groupValues || []).includes(groupScopeValue))
    && (partScopeValue === ALL_SCOPE_VALUE || (track.partValues || []).includes(partScopeValue))
  ));

  useEffect(() => {
    if (!hasShowScope) {
      setScopeShowId(ALL_SCOPE_VALUE);
    }
  }, [hasShowScope]);

  useEffect(() => {
    if (!hasProjectScope) {
      setScopeProjectId(ALL_SCOPE_VALUE);
    }
  }, [hasProjectScope]);

  useEffect(() => {
    if (!hasGroupScope) {
      setGroupScopeValue(ALL_SCOPE_VALUE);
    }
  }, [hasGroupScope]);

  useEffect(() => {
    if (!hasPartScope) {
      setPartScopeValue(ALL_SCOPE_VALUE);
    }
  }, [hasPartScope]);

  useEffect(() => {
    if (!hasTrackScope) {
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [hasTrackScope]);

  useEffect(() => {
    if (scopeShowId === ALL_SCOPE_VALUE) {
      setScopeProjectId(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [scopeShowId]);

  useEffect(() => {
    if (scopeProjectId === ALL_SCOPE_VALUE) {
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [scopeProjectId]);

  useEffect(() => {
    if (
      scopeShowId !== ALL_SCOPE_VALUE
      && !showOptions.some((show) => show.id === scopeShowId)
    ) {
      setScopeShowId(ALL_SCOPE_VALUE);
    }
  }, [scopeShowId, showOptions]);

  useEffect(() => {
    if (
      scopeProjectId !== ALL_SCOPE_VALUE
      && !projectOptions.some((project) => project.id === scopeProjectId)
    ) {
      setScopeProjectId(ALL_SCOPE_VALUE);
      setGroupScopeValue(ALL_SCOPE_VALUE);
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [projectOptions, scopeProjectId]);

  useEffect(() => {
    if (
      groupScopeValue !== ALL_SCOPE_VALUE
      && !groupOptions.some((option) => option.value === groupScopeValue)
    ) {
      setGroupScopeValue(ALL_SCOPE_VALUE);
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [groupOptions, groupScopeValue]);

  useEffect(() => {
    if (
      partScopeValue !== ALL_SCOPE_VALUE
      && !partOptions.some((option) => option.value === partScopeValue)
    ) {
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [partOptions, partScopeValue]);

  useEffect(() => {
    if (
      scopeTrackId !== ALL_SCOPE_VALUE
      && !trackOptions.some((track) => track.id === scopeTrackId)
    ) {
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [scopeTrackId, trackOptions]);

  const effectiveScopeType = (() => {
    if (hasTrackScope && scopeTrackId !== ALL_SCOPE_VALUE) return 'track';
    if (hasProjectScope && scopeProjectId !== ALL_SCOPE_VALUE) return 'project';
    if (hasShowScope && scopeShowId !== ALL_SCOPE_VALUE) return 'show';
    return 'all';
  })();

  const canSubmit = !disabled && (() => {
    if (effectiveScopeType === 'all') return true;
    if (effectiveScopeType === 'show') return scopeShowId !== ALL_SCOPE_VALUE;
    if (effectiveScopeType === 'project') return scopeShowId !== ALL_SCOPE_VALUE && scopeProjectId !== ALL_SCOPE_VALUE;
    if (effectiveScopeType === 'track') return scopeTrackId !== ALL_SCOPE_VALUE;
    return false;
  })();

  const reset = () => {
    applyPermissionDefaults(permissionOptions[0]?.value || permissionKey || 'project_reader');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSave?.({
      permissionKey,
      scopeType: effectiveScopeType,
      scopeShowId: effectiveScopeType === 'show' || effectiveScopeType === 'project' || effectiveScopeType === 'track'
        ? scopeShowId
        : null,
      scopeProjectId: effectiveScopeType === 'project' || effectiveScopeType === 'track'
        ? scopeProjectId
        : null,
      scopeTrackId: effectiveScopeType === 'track' ? scopeTrackId : null,
      scopeNameValue: null,
      scopeGroupNameValue: hasGroupScope && groupScopeValue !== ALL_SCOPE_VALUE ? groupScopeValue : null,
      scopePartNameValue: hasPartScope && partScopeValue !== ALL_SCOPE_VALUE ? partScopeValue : null,
    });
    reset();
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-950/60 p-4">
      <label className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Access type</div>
        <select
          value={permissionKey}
          disabled={disabled}
          title={getPermissionHelp(permissionKey)}
          onChange={(event) => applyPermissionDefaults(event.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          {permissionOptions.map((option) => (
            <option
              key={option.value}
              value={option.value}
              title={getPermissionHelp(option.value)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {hasShowScope ? (
        <>
          <label className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Scope: show</div>
            <select
              value={scopeShowId}
              disabled={disabled}
              onChange={(event) => setScopeShowId(event.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
            >
              <option value={ALL_SCOPE_VALUE}>All</option>
              {showOptions.map((show) => (
                <option key={show.id} value={show.id}>
                  {show.name}
                </option>
              ))}
            </select>
          </label>

          {scopeShowId !== ALL_SCOPE_VALUE && hasProjectScope ? (
            <label className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Scope: musical number</div>
              <select
                value={scopeProjectId}
                disabled={disabled}
                onChange={(event) => setScopeProjectId(event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              >
                <option value={ALL_SCOPE_VALUE}>All</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.musicalNumber ? `${project.musicalNumber} - ` : ''}{project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {hasGroupScope ? (
            <label className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Scope: group track</div>
              <select
                value={groupScopeValue}
                disabled={disabled}
                onChange={(event) => setGroupScopeValue(event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              >
                <option value={ALL_SCOPE_VALUE}>All</option>
                {groupOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {hasPartScope ? (
            <label className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Scope: part track</div>
              <select
                value={partScopeValue}
                disabled={disabled}
                onChange={(event) => setPartScopeValue(event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              >
                <option value={ALL_SCOPE_VALUE}>All</option>
                {partOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {scopeProjectId !== ALL_SCOPE_VALUE && hasTrackScope ? (
            <label className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Scope: track</div>
              <select
                value={scopeTrackId}
                disabled={disabled}
                onChange={(event) => setScopeTrackId(event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              >
                <option value={ALL_SCOPE_VALUE}>All</option>
                {trackOptions.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
        >
          Add access
        </button>
      </div>
    </div>
  );
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
  const [defaultMessageDraft, setDefaultMessageDraft] = useState('');
  const [parentRoleIdsDraft, setParentRoleIdsDraft] = useState([]);
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
    setSelectedRoleId((current) => (
      nextRoles.some((role) => role.id === current) ? current : ''
    ));
  };

  const loadRole = async (roleId = selectedRoleId) => {
    if (!roleId) {
      setSelectedRole(null);
      return;
    }
    const role = await getRbacRole(roleId, session);
    setSelectedRole(role);
    setRoleNameDraft(role?.name || '');
    setDefaultMessageDraft(role?.emptyAccessMessage || '');
    setParentRoleIdsDraft((role?.parents || []).map((parent) => parent.id));
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
      setDefaultMessageDraft('');
      setParentRoleIdsDraft([]);
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

  const roleGrants = useMemo(() => (selectedRole?.grants || []), [selectedRole]);
  const inheritedRoleGrants = useMemo(() => (selectedRole?.inheritedGrants || []), [selectedRole]);
  const allRoleGrants = useMemo(() => ([
    ...roleGrants,
    ...inheritedRoleGrants,
  ]), [roleGrants, inheritedRoleGrants]);

  const visibleRoleGrants = useMemo(() => {
    const grants = allRoleGrants
      .map((grant) => ({
        ...grant,
        isRedundant: isGrantRedundant(grant, allRoleGrants),
      }));
    return showRedundantAccesses ? grants : grants.filter((grant) => !grant.isRedundant);
  }, [allRoleGrants, showRedundantAccesses]);

  const userDirectGrants = useMemo(() => (
    userAccessModal?.detail?.directGrants || []
  ), [userAccessModal]);

  const visibleUserDirectGrants = useMemo(() => {
    const grants = userDirectGrants.map((grant) => ({
      ...grant,
      isRedundant: isGrantRedundant(grant, userDirectGrants),
    }));
    return showRedundantUserAccesses ? grants : grants.filter((grant) => !grant.isRedundant);
  }, [showRedundantUserAccesses, userDirectGrants]);

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
    await runAction(async () => {
      const createdRole = await createRbacRole({ name: 'New role' }, session);
      await loadBaseData();
      setNewlyCreatedRoleId(createdRole.id);
      setSelectedRoleId(createdRole.id);
    }, 'Failed to create role.');
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;
    await runAction(async () => {
      if (selectedRole.systemKey === 'default_user') {
        await updateRbacRole(selectedRole.id, {
          emptyAccessMessage: defaultMessageDraft,
        }, session);
      } else if (!selectedRole.isSystem) {
        await updateRbacRole(selectedRole.id, {
          name: roleNameDraft.trim(),
          parentRoleIds: parentRoleIdsDraft,
        }, session);
      }
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save role.');
  };

  const handleSaveIncludedRoles = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    await runAction(async () => {
      await updateRbacRole(selectedRole.id, {
        parentRoleIds: parentRoleIdsDraft,
      }, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save included roles.');
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
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

  const handleSaveRoleGrant = async (grant) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await saveRbacRoleGrant(selectedRole.id, grant, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save role access.');
  };

  const handleDeleteRoleGrant = async (grant) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await deleteRbacRoleGrant(selectedRole.id, grant.id, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove role access.');
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

  const handleSaveUserGrant = async (grant) => {
    if (!userAccessModal?.userId) return;
    const userId = userAccessModal.userId;
    await runAction(async () => {
      await saveUserGrant(userId, grant, session);
      await loadBaseData();
      await loadUserAccess(userId);
    }, 'Failed to save user access.');
  };

  const handleDeleteUserGrant = async (grant) => {
    if (!userAccessModal?.userId || !grant?.id) return;
    const userId = userAccessModal.userId;
    await runAction(async () => {
      await deleteUserGrant(userId, grant.id, session);
      await loadBaseData();
      await loadUserAccess(userId);
    }, 'Failed to remove user access.');
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
  const canEditDefaultMessage = (
    selectedRole?.systemKey === 'default_user'
    && (selectedRole.grants?.length || 0) === 0
    && (selectedRole.inheritedGrants?.length || 0) === 0
  );
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
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 bg-gray-800 px-4 py-3">
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
                      onClose?.();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Go to app
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onLogout?.();
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
            <aside className="shrink-0 border-b border-gray-800 bg-gray-950 p-3 md:w-60 md:border-b-0 md:border-r">
              <nav className="flex gap-2 overflow-x-auto md:block md:space-y-2 md:overflow-visible">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRoleId('');
                    setTab('artists');
                  }}
                  className={`relative flex min-w-36 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition md:w-full ${
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
                    setSelectedRoleId('');
                    setTab('users');
                  }}
                  className={`relative flex min-w-36 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition md:w-full ${
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
                    setSelectedRoleId('');
                    setTab('roles');
                  }}
                  className={`relative flex min-w-36 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition md:w-full ${
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
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-auto p-5">
              {loading ? (
                <Empty>Loading...</Empty>
              ) : tab === 'artists' ? (
                <div className="mx-auto max-w-6xl space-y-5">
                  <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
                    <div className="grid grid-cols-[1fr,150px,110px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      <span>Artist</span>
                      <span>Type</span>
                      <span />
                    </div>
                    {allArtists.map((artist) => (
                      <div
                        key={`${artist.kind}:${artist.id}`}
                        className="grid grid-cols-[1fr,150px,110px] items-center gap-4 border-b border-gray-800 px-4 py-4 last:border-b-0 hover:bg-gray-900/70"
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
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleEditArtistDescription(artist)}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                          >
                            Edit
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
              ) : tab === 'roles' ? (
                selectedRole ? (
                  <div className="grid gap-5 xl:grid-cols-[280px,1fr]">
                    <aside className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedRoleId('')}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/80 px-3 py-2 text-left text-sm font-medium text-gray-200 transition hover:border-gray-700 hover:bg-gray-900"
                        >
                          <ArrowLeft size={16} className="shrink-0" />
                          <span className="truncate">Back</span>
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleCreateRole}
                          title="Create role"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-gray-950/80 text-gray-200 transition hover:border-gray-700 hover:bg-gray-900 disabled:opacity-50"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <div className="space-y-1">
                        {roles.map((role) => (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => setSelectedRoleId(role.id)}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
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

                    <div className="space-y-5">
                      <Panel title={null} actions={null}>
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <input
                              ref={roleNameInputRef}
                              type="text"
                              value={canEditRoleName ? roleNameDraft : getRoleDisplayName(selectedRole)}
                              disabled={!canEditRoleName}
                              onChange={(event) => setRoleNameDraft(event.target.value)}
                              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xl font-semibold text-gray-100 disabled:cursor-default disabled:opacity-100"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {(canEditRoleName || canEditDefaultMessage) ? (
                                <button
                                  type="button"
                                  disabled={saving || (canEditRoleName ? !roleNameDraft.trim() : false)}
                                  onClick={handleSaveRole}
                                  className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                >
                                  Save
                                </button>
                              ) : null}
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

                          {selectedRole.systemKey === 'default_user' ? (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-300">No-access message</div>
                              <textarea
                                value={defaultMessageDraft}
                                disabled={!canEditDefaultMessage}
                                onChange={(event) => setDefaultMessageDraft(event.target.value)}
                                rows={1}
                                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 disabled:opacity-60"
                              />
                            </div>
                          ) : null}
                        </div>
                      </Panel>

                      <div className="flex flex-wrap gap-2 border-b border-gray-700">
                        {roleTabs.map(({ value, label, disabled }) => (
                          <button
                            key={value}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (!disabled) setRoleDetailTab(value);
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
                          <div className="space-y-5">
                            <CompactAccessSection
                              title="Included roles"
                              count={parentRoleIdsDraft.length}
                              actions={canEditRoleParents ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={handleSaveIncludedRoles}
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700"
                                >
                                  Save
                                </button>
                              ) : null}
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
                              {canEditRoleGrants ? (
                                <div className="border-b border-gray-800 p-4">
                                  <GrantEditor
                                    catalog={catalog}
                                    disabled={saving}
                                    excludedPermissions={[]}
                                    onSave={handleSaveRoleGrant}
                                  />
                                </div>
                              ) : null}
                              <GrantList
                                grants={visibleRoleGrants}
                                canRemove={Boolean(canEditRoleGrants)}
                                onRemove={handleDeleteRoleGrant}
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
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
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
                onClick={() => setUserAccessModal(null)}
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(90vh-78px)] overflow-auto p-5">
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
                    <div className="border-b border-gray-800 p-4">
                      <GrantEditor
                        catalog={catalog}
                        disabled={saving}
                        excludedPermissions={[]}
                        onSave={handleSaveUserGrant}
                      />
                    </div>
                    <GrantList
                      grants={visibleUserDirectGrants}
                      canRemove
                      onRemove={handleDeleteUserGrant}
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
    </div>
  );
}
