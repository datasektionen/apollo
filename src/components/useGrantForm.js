import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_SCOPE_VALUE, PERMISSION_SCOPE_FLOW } from './grantAccess';

function draftFromGrant(grant) {
  return {
    permissionKey: grant?.permissionKey || '',
    scopeShowId: grant?.scopeShowId || ALL_SCOPE_VALUE,
    scopeProjectId: grant?.scopeProjectId || ALL_SCOPE_VALUE,
    groupScopeValue: grant?.scopeGroupNameValue || ALL_SCOPE_VALUE,
    partScopeValue: grant?.scopePartNameValue || ALL_SCOPE_VALUE,
    scopeTrackId: grant?.scopeTrackId || ALL_SCOPE_VALUE,
  };
}

export function useGrantForm({
  catalog,
  excludedPermissions = [],
  initialGrant = null,
}) {
  const excludedKey = excludedPermissions.join('|');
  const permissionOptions = useMemo(() => {
    const excluded = new Set(excludedKey ? excludedKey.split('|') : []);
    return (catalog?.permissions || []).filter((option) => !excluded.has(option.value));
  }, [catalog, excludedKey]);

  const initialDraft = draftFromGrant(initialGrant);
  const initialDraftRef = useRef(initialDraft);
  const scopeTouchedRef = useRef(false);
  const [permissionKey, setPermissionKey] = useState(
    initialDraft.permissionKey || permissionOptions[0]?.value || 'project_reader'
  );
  const [scopeShowId, setScopeShowId] = useState(initialDraft.scopeShowId);
  const [scopeProjectId, setScopeProjectId] = useState(initialDraft.scopeProjectId);
  const [groupScopeValue, setGroupScopeValue] = useState(initialDraft.groupScopeValue);
  const [partScopeValue, setPartScopeValue] = useState(initialDraft.partScopeValue);
  const [scopeTrackId, setScopeTrackId] = useState(initialDraft.scopeTrackId);

  const scopeFlow = PERMISSION_SCOPE_FLOW[permissionKey] || [];
  const hasShowScope = scopeFlow.includes('show');
  const hasProjectScope = scopeFlow.includes('project');
  const hasGroupScope = scopeFlow.includes('group');
  const hasPartScope = scopeFlow.includes('part');
  const hasTrackScope = scopeFlow.includes('track');

  const showOptions = catalog?.shows || [];
  const tracks = catalog?.tracks || [];
  const groupLabelByValue = useMemo(
    () => new Map((catalog?.groupNames || []).map((option) => [option.value, option.label])),
    [catalog]
  );
  const partLabelByValue = useMemo(
    () => new Map((catalog?.partNames || []).map((option) => [option.value, option.label])),
    [catalog]
  );

  const applyPermissionDefaults = (nextPermissionKey) => {
    scopeTouchedRef.current = true;
    setPermissionKey(nextPermissionKey);
    setScopeShowId(ALL_SCOPE_VALUE);
    setScopeProjectId(ALL_SCOPE_VALUE);
    setGroupScopeValue(ALL_SCOPE_VALUE);
    setPartScopeValue(ALL_SCOPE_VALUE);
    setScopeTrackId(ALL_SCOPE_VALUE);
  };

  const keepInitialValue = (value, field) => (
    !scopeTouchedRef.current && value === initialDraftRef.current[field]
  );

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
  const derivedGroupOptions = Array.from(new Set(
    scopedTrackOptions.flatMap((track) => (Array.isArray(track.groupValues) ? track.groupValues : []))
  ))
    .sort((left, right) => (groupLabelByValue.get(left) || left).localeCompare(groupLabelByValue.get(right) || right, undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map((value) => ({ value, label: groupLabelByValue.get(value) || value }));
  const groupOptions = groupScopeValue !== ALL_SCOPE_VALUE && !derivedGroupOptions.some((option) => option.value === groupScopeValue)
    ? [...derivedGroupOptions, { value: groupScopeValue, label: groupLabelByValue.get(groupScopeValue) || groupScopeValue }]
    : derivedGroupOptions;
  const derivedPartOptions = Array.from(new Set(
    scopedTrackOptions
      .filter((track) => groupScopeValue === ALL_SCOPE_VALUE || (track.groupValues || []).includes(groupScopeValue))
      .flatMap((track) => (Array.isArray(track.partValues) ? track.partValues : []))
  ))
    .sort((left, right) => (partLabelByValue.get(left) || left).localeCompare(partLabelByValue.get(right) || right, undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map((value) => ({ value, label: partLabelByValue.get(value) || value }));
  const partOptions = partScopeValue !== ALL_SCOPE_VALUE && !derivedPartOptions.some((option) => option.value === partScopeValue)
    ? [...derivedPartOptions, { value: partScopeValue, label: partLabelByValue.get(partScopeValue) || partScopeValue }]
    : derivedPartOptions;
  const trackOptions = scopedTrackOptions.filter((track) => (
    (groupScopeValue === ALL_SCOPE_VALUE || (track.groupValues || []).includes(groupScopeValue))
    && (partScopeValue === ALL_SCOPE_VALUE || (track.partValues || []).includes(partScopeValue))
  ));

  useEffect(() => {
    if (!hasShowScope) setScopeShowId(ALL_SCOPE_VALUE);
  }, [hasShowScope]);

  useEffect(() => {
    if (!hasProjectScope) setScopeProjectId(ALL_SCOPE_VALUE);
  }, [hasProjectScope]);

  useEffect(() => {
    if (!hasGroupScope) setGroupScopeValue(ALL_SCOPE_VALUE);
  }, [hasGroupScope]);

  useEffect(() => {
    if (!hasPartScope) setPartScopeValue(ALL_SCOPE_VALUE);
  }, [hasPartScope]);

  useEffect(() => {
    if (!hasTrackScope) setScopeTrackId(ALL_SCOPE_VALUE);
  }, [hasTrackScope]);

  useEffect(() => {
    if (scopeShowId === ALL_SCOPE_VALUE) {
      setScopeProjectId(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [scopeShowId]);

  useEffect(() => {
    if (scopeProjectId === ALL_SCOPE_VALUE) setScopeTrackId(ALL_SCOPE_VALUE);
  }, [scopeProjectId]);

  useEffect(() => {
    if (scopeShowId !== ALL_SCOPE_VALUE && !showOptions.some((show) => show.id === scopeShowId)) {
      setScopeShowId(ALL_SCOPE_VALUE);
    }
  }, [scopeShowId, showOptions]);

  useEffect(() => {
    if (scopeProjectId !== ALL_SCOPE_VALUE && !projectOptions.some((project) => project.id === scopeProjectId)) {
      setScopeProjectId(ALL_SCOPE_VALUE);
      setGroupScopeValue(ALL_SCOPE_VALUE);
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [projectOptions, scopeProjectId]);

  useEffect(() => {
    if (keepInitialValue(groupScopeValue, 'groupScopeValue')) return;
    if (groupScopeValue !== ALL_SCOPE_VALUE && !derivedGroupOptions.some((option) => option.value === groupScopeValue)) {
      setGroupScopeValue(ALL_SCOPE_VALUE);
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [derivedGroupOptions, groupScopeValue]);

  useEffect(() => {
    if (keepInitialValue(partScopeValue, 'partScopeValue')) return;
    if (partScopeValue !== ALL_SCOPE_VALUE && !derivedPartOptions.some((option) => option.value === partScopeValue)) {
      setPartScopeValue(ALL_SCOPE_VALUE);
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [derivedPartOptions, partScopeValue]);

  useEffect(() => {
    if (scopeTrackId !== ALL_SCOPE_VALUE && !trackOptions.some((track) => track.id === scopeTrackId)) {
      setScopeTrackId(ALL_SCOPE_VALUE);
    }
  }, [scopeTrackId, trackOptions]);

  const effectiveScopeType = (() => {
    if (hasTrackScope && scopeTrackId !== ALL_SCOPE_VALUE) return 'track';
    if (hasProjectScope && scopeProjectId !== ALL_SCOPE_VALUE) return 'project';
    if (hasShowScope && scopeShowId !== ALL_SCOPE_VALUE) return 'show';
    return 'all';
  })();

  const canSubmit = (() => {
    if (effectiveScopeType === 'all') return true;
    if (effectiveScopeType === 'show') return scopeShowId !== ALL_SCOPE_VALUE;
    if (effectiveScopeType === 'project') return scopeShowId !== ALL_SCOPE_VALUE && scopeProjectId !== ALL_SCOPE_VALUE;
    if (effectiveScopeType === 'track') return scopeTrackId !== ALL_SCOPE_VALUE;
    return false;
  })();

  const reset = () => {
    applyPermissionDefaults(permissionOptions[0]?.value || permissionKey || 'project_reader');
  };

  const buildPayload = () => ({
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

  return {
    permissionKey,
    applyPermissionDefaults,
    permissionOptions,
    scopeShowId,
    setScopeShowId: (value) => {
      scopeTouchedRef.current = true;
      setScopeShowId(value);
    },
    scopeProjectId,
    setScopeProjectId: (value) => {
      scopeTouchedRef.current = true;
      setScopeProjectId(value);
    },
    groupScopeValue,
    setGroupScopeValue: (value) => {
      scopeTouchedRef.current = true;
      setGroupScopeValue(value);
    },
    partScopeValue,
    setPartScopeValue: (value) => {
      scopeTouchedRef.current = true;
      setPartScopeValue(value);
    },
    scopeTrackId,
    setScopeTrackId: (value) => {
      scopeTouchedRef.current = true;
      setScopeTrackId(value);
    },
    hasShowScope,
    hasProjectScope,
    hasGroupScope,
    hasPartScope,
    hasTrackScope,
    showOptions,
    projectOptions,
    groupOptions,
    partOptions,
    trackOptions,
    canSubmit,
    buildPayload,
    reset,
  };
}
