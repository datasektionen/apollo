import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ACCESS_TYPE_COLUMNS,
  ACCESS_TYPE_ROWS,
  ALL_SCOPE_VALUE,
  PERMISSION_HELP,
  SCOPE_COLUMNS,
  grantScopeCells,
} from './grantAccess';
import { useGrantForm } from './useGrantForm';

const selectClass = 'w-full min-w-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-1.5 text-xs text-gray-100 disabled:cursor-not-allowed disabled:text-gray-500';
const COLUMN_COUNT = SCOPE_COLUMNS.length + 2;

function IconAction({ label, disabled, onClick, tone = 'default', children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'danger' ? 'hover:border-red-800 hover:text-red-200' : ''
      }`}
    >
      {children}
    </button>
  );
}

function ScopeValue({ cell }) {
  if (cell.kind === 'na') {
    return <span className="text-sm text-gray-600">—</span>;
  }
  if (cell.kind === 'virtual') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-800/50 bg-indigo-950/30 px-2 py-0.5 text-xs font-semibold text-indigo-100">
        {cell.text}
      </span>
    );
  }
  if (cell.kind === 'all') {
    return (
      <span className="inline-flex rounded-full border border-dashed border-gray-700 bg-gray-950 px-2 py-0.5 text-xs font-semibold text-gray-500">
        All
      </span>
    );
  }
  return (
    <span
      title={cell.text}
      className="inline-block max-w-full truncate rounded-full border border-blue-800/60 bg-blue-950/40 px-2 py-0.5 text-xs font-semibold text-blue-100"
    >
      {cell.text}
    </span>
  );
}

function LockedSelect({ label }) {
  return (
    <select disabled className={selectClass} value={label}>
      <option value={label}>{label}</option>
    </select>
  );
}

function ScopeSelect({
  value,
  onChange,
  disabled,
  options,
  labelForOption,
  pinVirtualOption = false,
}) {
  const virtualOptions = pinVirtualOption ? options.filter((option) => option.isVirtual) : [];
  const regularOptions = pinVirtualOption ? options.filter((option) => !option.isVirtual) : options;

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={selectClass}
    >
      <option value={ALL_SCOPE_VALUE}>All</option>
      {virtualOptions.map((option) => (
        <option key={option.id || option.value} value={option.id || option.value}>
          {labelForOption(option)}
        </option>
      ))}
      {virtualOptions.length && (regularOptions.length || pinVirtualOption) ? <option key="scope-divider" disabled value="__scope_divider__">──────────</option> : null}
      {regularOptions.map((option) => (
        <option key={option.id || option.value} value={option.id || option.value}>
          {labelForOption(option)}
        </option>
      ))}
    </select>
  );
}

function GrantEditRow({
  grant = null,
  catalog,
  disabled,
  onChange,
  onRemove,
}) {
  const form = useGrantForm({ catalog, initialGrant: grant });
  const showNumberSelect = form.hasProjectScope && form.scopeShowId !== ALL_SCOPE_VALUE;
  const onChangeRef = useRef(onChange);
  const skipEmitRef = useRef(true);
  onChangeRef.current = onChange;
  const payload = form.buildPayload();
  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    if (skipEmitRef.current) {
      skipEmitRef.current = false;
      return;
    }
    onChangeRef.current?.(grant?.id ? { ...payload, id: grant.id } : payload);
  }, [payloadKey]);

  return (
    <tr className="bg-gray-950" data-grant-edit={grant?.id || 'new'}>
      <td className="min-w-0 px-2 py-2 align-top">
        <select
          value={form.permissionKey}
          disabled={disabled}
          title={PERMISSION_HELP[form.permissionKey] || ''}
          onChange={(event) => form.applyPermissionDefaults(event.target.value)}
          className={selectClass}
        >
          {form.permissionOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {grant?.isRedundant ? <div className="mt-1"><span className="inline-flex rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-200">Redundant</span></div> : null}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        {form.hasShowScope ? (
          <ScopeSelect
            value={form.scopeShowId}
            onChange={form.setScopeShowId}
            disabled={disabled}
            options={form.showOptions}
            labelForOption={(show) => show.name}
          />
        ) : <LockedSelect label="—" />}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        {form.hasProjectScope ? (
          showNumberSelect ? (
            <ScopeSelect
              value={form.scopeProjectId}
              onChange={form.setScopeProjectId}
              disabled={disabled}
              options={form.projectOptions}
              labelForOption={(project) => `${project.musicalNumber ? `${project.musicalNumber} - ` : ''}${project.name}`}
            />
          ) : <LockedSelect label="All" />
        ) : <LockedSelect label="—" />}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        {form.hasGroupScope ? (
          <ScopeSelect
            value={form.groupScopeValue}
            onChange={form.setGroupScopeValue}
            disabled={disabled || form.isLyricsTrackScope}
            options={form.groupOptions}
            labelForOption={(option) => option.label}
          />
        ) : <LockedSelect label="—" />}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        {form.hasPartScope ? (
          <ScopeSelect
            value={form.partScopeValue}
            onChange={form.setPartScopeValue}
            disabled={disabled || form.isLyricsTrackScope}
            options={form.partOptions}
            labelForOption={(option) => option.label}
          />
        ) : <LockedSelect label="—" />}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        {form.hasTrackScope ? (
          <ScopeSelect
            value={form.scopeTrackId}
            onChange={form.setScopeTrackId}
            disabled={disabled}
            options={form.trackOptions}
            labelForOption={(track) => track.name}
            pinVirtualOption
          />
        ) : <LockedSelect label="—" />}
      </td>
      <td className="px-2 py-2 align-top text-right">
        {onRemove ? (
          <IconAction label="Delete" disabled={disabled} tone="danger" onClick={() => onRemove(grant)}>
            <Trash2 size={14} />
          </IconAction>
        ) : null}
      </td>
    </tr>
  );
}

export function GrantRulesTable({
  grants = [],
  catalog = null,
  canEdit = false,
  disabled = false,
  onChange,
  onAdd,
  onRemove,
  resetKey = 0,
}) {
  const [editingId, setEditingId] = useState('');

  useEffect(() => {
    setEditingId('');
  }, [resetKey]);

  useEffect(() => {
    if (editingId && !grants.some((grant) => grant.id === editingId)) {
      setEditingId('');
    }
  }, [editingId, grants]);

  useEffect(() => {
    if (!editingId) return undefined;
    const onPointerDown = (event) => {
      const row = document.querySelector(`[data-grant-edit="${CSS.escape(editingId)}"]`);
      if (row && !row.contains(event.target)) setEditingId('');
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [editingId]);

  if (!grants.length && !canEdit) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/50 px-4 py-4 text-sm text-gray-400">
          No access rules.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
          <col className="w-[12%]" />
          <col className="w-[11%]" />
          <col className="w-[12%]" />
          <col className="w-[15%]" />
        </colgroup>
        <thead>
          <tr className="bg-gray-950 text-[11px] font-extrabold uppercase tracking-wide text-gray-400">
            <th className="px-2 py-2 font-extrabold leading-tight">Access type</th>
            {SCOPE_COLUMNS.map((column) => (
              <th key={column.id} className="px-2 py-2 font-extrabold leading-tight">{column.label}</th>
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => {
            const inherited = grant.sourceType === 'inherited';
            const editable = canEdit && !inherited;
            if (editingId && editingId === grant.id) {
              return (
                <GrantEditRow
                  key={grant.id}
                  grant={grant}
                  catalog={catalog}
                  disabled={disabled}
                  onChange={onChange}
                  onRemove={onRemove}
                />
              );
            }
            const cells = grantScopeCells(grant, catalog || {});
            return (
              <tr key={grant.id} className={`border-t border-gray-800 ${grant.isRedundant ? 'opacity-60' : ''}`}>
                <td className="overflow-hidden px-2 py-2 align-middle">
                  <div className="truncate text-sm font-semibold text-white" title={grant.permissionLabel || grant.permissionKey}>
                    {grant.permissionLabel || grant.permissionKey}
                  </div>
                  {inherited && grant.sourceRoleName ? (
                    <div className="mt-1">
                      <span className="inline-block max-w-full whitespace-normal rounded-full bg-amber-900/40 px-2 py-0.5 text-xs leading-snug text-amber-200">
                        Inherited from {grant.sourceRoleName}
                      </span>
                    </div>
                  ) : null}
                  {grant.isRedundant ? (
                    <div className="mt-1">
                      <span className="inline-flex rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-200">Redundant</span>
                    </div>
                  ) : null}
                </td>
                {cells.map((cell, index) => (
                  <td key={SCOPE_COLUMNS[index].id} className="overflow-hidden px-2 py-2 align-middle">
                    <ScopeValue cell={cell} />
                  </td>
                ))}
                <td className="px-2 py-2 align-middle text-right">
                  {editable ? (
                    <div className="flex flex-nowrap justify-end gap-1">
                      <IconAction label="Edit" disabled={disabled} onClick={() => setEditingId(grant.id)}>
                        <Pencil size={14} />
                      </IconAction>
                      <IconAction label="Delete" disabled={disabled} tone="danger" onClick={() => onRemove?.(grant)}>
                        <Trash2 size={14} />
                      </IconAction>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {canEdit ? (
            <tr className="border-t border-gray-800">
              <td colSpan={COLUMN_COUNT} className="p-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const id = onAdd?.();
                    if (id) setEditingId(id);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-2.5 text-left text-sm font-semibold text-gray-300 hover:bg-gray-900/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={16} />
                  Add access
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function AccessTypeInfoButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        title="What each access type allows"
        aria-label="What each access type allows"
        onClick={() => setOpen(true)}
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-gray-400 font-serif text-[11px] font-bold leading-none text-gray-200 hover:border-white hover:text-white"
      >
        i
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/60 px-4 py-8"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-type-info-title"
            className="w-full max-w-6xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-4">
              <div>
                <h2 id="access-type-info-title" className="text-lg font-semibold text-white">
                  What each access type allows
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  The scope on a rule only limits where this applies.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto px-5 py-4">
              <table className="w-full min-w-[1100px] border-collapse text-center">
                <thead>
                  <tr className="text-xs font-bold text-gray-300">
                    <th className="border-b border-gray-800 bg-gray-950 px-2 py-2 text-left">Access type</th>
                    {ACCESS_TYPE_COLUMNS.map((column) => (
                      <th key={column.id} className="border-b border-gray-800 bg-gray-950 px-2 py-2 align-bottom leading-tight">
                        {column.lines.map((line) => (
                          <span key={line} className="block">{line}</span>
                        ))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_TYPE_ROWS.map((row) => (
                    row.kind === 'group' ? (
                      <tr key={row.label}>
                        <td colSpan={ACCESS_TYPE_COLUMNS.length + 1} className="bg-gray-950 px-2 py-1.5 text-left text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">
                          {row.label}
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.permissionKey} className="border-b border-gray-800">
                        <td className="px-2 py-2 text-left text-sm font-semibold text-white">{row.label}</td>
                        {ACCESS_TYPE_COLUMNS.map((column) => {
                          const value = row.cells[column.id];
                          if (value === 'yes') {
                            return <td key={column.id} className="px-2 py-2 text-base font-extrabold text-emerald-400">✓</td>;
                          }
                          if (value === 'if-all') {
                            return <td key={column.id} className="px-2 py-2 text-xs font-extrabold text-amber-300">✓*</td>;
                          }
                          return <td key={column.id} className="px-2 py-2 text-gray-700">·</td>;
                        })}
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm leading-relaxed text-gray-400">
                A check is included. A dot is not.
                <br />
                * Solo for Track manager only when the scope covers every track in that musical number.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
