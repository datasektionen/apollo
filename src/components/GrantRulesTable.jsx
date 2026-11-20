import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import '../styles/player-theme.css';
import {
  ACCESS_TYPE_COLUMNS,
  ACCESS_TYPE_ROWS,
  ALL_SCOPE_VALUE,
  PERMISSION_HELP,
  SCOPE_COLUMNS,
  grantScopeCells,
} from './grantAccess';
import { useGrantForm } from './useGrantForm';

const selectClass = 'w-full min-w-0 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-2 py-1.5 text-xs text-[var(--player-text-primary)] outline-none focus:border-[var(--player-accent-border)] disabled:cursor-not-allowed disabled:text-[var(--player-text-muted)] disabled:opacity-75';
const COLUMN_COUNT = SCOPE_COLUMNS.length + 2;

function IconAction({ label, disabled, onClick, tone = 'default', children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'danger' ? 'hover:border-[var(--player-danger-border)] hover:text-[var(--player-danger)]' : ''
      }`}
    >
      {children}
    </button>
  );
}

function ScopeValue({ cell }) {
  if (cell.kind === 'na') {
    return <span className="text-sm text-[var(--player-text-disabled)]">—</span>;
  }
  if (cell.kind === 'virtual') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--player-info-border)] bg-[var(--player-info-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--player-info-text)]">
        {cell.text}
      </span>
    );
  }
  if (cell.kind === 'all') {
    return (
      <span className="inline-flex rounded-full border border-dashed border-[var(--player-border-default)] bg-[var(--player-bg-surface-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--player-text-muted)]">
        All
      </span>
    );
  }
  return (
    <span
      title={cell.text}
      className="inline-block max-w-full truncate rounded-full border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--player-accent-text)]"
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
    <tr className="bg-[var(--player-bg-surface-subtle)]" data-grant-edit={grant?.id || 'new'}>
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
        {grant?.isRedundant ? <div className="mt-1"><span className="inline-flex rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2 py-0.5 text-xs text-[var(--player-text-muted)]">Redundant</span></div> : null}
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
        <div className="rounded-lg border border-dashed border-[var(--player-border-default)] bg-[var(--player-bg-surface-subtle)] px-4 py-4 text-sm text-[var(--player-text-muted)]">
          No access rules.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[21%]" />
          <col className="w-[19%]" />
          <col className="w-[16%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr className="bg-[var(--player-bg-surface-subtle)] text-[11px] font-bold uppercase tracking-wider text-[var(--player-text-muted)]">
            <th className="px-2 py-2 font-bold leading-tight">Access type</th>
            {SCOPE_COLUMNS.map((column) => (
              <th key={column.id} className="px-2 py-2 font-bold leading-tight">{column.label}</th>
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
              <tr key={grant.id} className={`border-t border-[var(--player-border-subtle)] hover:bg-[var(--player-hover)] transition-colors ${grant.isRedundant ? 'opacity-60' : ''}`}>
                <td className="overflow-hidden px-2 py-2 align-middle">
                  <div className="truncate text-sm font-semibold text-[var(--player-text-primary)]" title={grant.permissionLabel || grant.permissionKey}>
                    {grant.permissionLabel || grant.permissionKey}
                  </div>
                  {inherited && grant.sourceRoleName ? (
                    <div className="mt-1">
                      <span className="inline-block max-w-full truncate rounded-full border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] px-2 py-0.5 text-[11px] font-medium leading-tight text-[var(--player-accent-text)]">
                        Inherited from {grant.sourceRoleName}
                      </span>
                    </div>
                  ) : null}
                  {grant.isRedundant ? (
                    <div className="mt-1">
                      <span className="inline-flex rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2 py-0.5 text-xs text-[var(--player-text-muted)]">Redundant</span>
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
            <tr className="border-t border-[var(--player-border-subtle)]">
              <td colSpan={COLUMN_COUNT} className="p-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const id = onAdd?.();
                    if (id) setEditingId(id);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-2.5 text-left text-sm font-semibold text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-accent-text)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[var(--player-border-strong)] font-serif text-[11px] font-bold leading-none text-[var(--player-text-secondary)] hover:border-[var(--player-accent-border)] hover:text-[var(--player-accent-text)] transition-colors"
      >
        i
      </button>
      {open ? (
        <div
          className="player-theme fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4 py-8"
          data-player-theme="dark-gold"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-type-info-title"
            className="w-full max-w-6xl overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] shadow-[var(--player-shadow-popover)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="player-hero-surface flex items-start justify-between gap-4 border-b border-[var(--player-border-subtle)] px-5 py-4">
              <div>
                <h2 id="access-type-info-title" className="text-lg font-bold tracking-tight text-[var(--player-text-primary)]">
                  What each access type allows
                </h2>
                <p className="mt-1 text-sm text-[var(--player-text-secondary)]">
                  The scope on a rule only limits where this applies.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3.5 py-1.5 text-xs font-semibold text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto px-5 py-4">
              <table className="w-full min-w-[1100px] border-collapse text-center">
                <thead>
                  <tr className="text-xs font-bold text-[var(--player-text-secondary)]">
                    <th className="border-b border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-2 py-2 text-left">Access type</th>
                    {ACCESS_TYPE_COLUMNS.map((column) => (
                      <th key={column.id} className="border-b border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-2 py-2 align-bottom leading-tight">
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
                        <td colSpan={ACCESS_TYPE_COLUMNS.length + 1} className="bg-[var(--player-bg-surface-subtle)] px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
                          {row.label}
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.permissionKey} className="border-b border-[var(--player-border-subtle)]">
                        <td className="px-2 py-2 text-left text-sm font-semibold text-[var(--player-text-primary)]">{row.label}</td>
                        {ACCESS_TYPE_COLUMNS.map((column) => {
                          const value = row.cells[column.id];
                          if (value === 'yes') {
                            return <td key={column.id} className="px-2 py-2 text-base font-extrabold text-[var(--player-success)]">✓</td>;
                          }
                          if (value === 'if-all') {
                            return <td key={column.id} className="px-2 py-2 text-xs font-extrabold text-[var(--player-accent-text)]">✓*</td>;
                          }
                          return <td key={column.id} className="px-2 py-2 text-[var(--player-text-disabled)]">·</td>;
                        })}
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm leading-relaxed text-[var(--player-text-secondary)]">
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
