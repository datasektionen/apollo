import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, HardDrive, RefreshCw, ScanSearch, Search, Trash2 } from 'lucide-react';
import {
  deleteAdminMedia,
  deleteAdminQuarantinedMedia,
  listAdminStorage,
  quarantineAdminMedia,
  validateAdminStorage,
} from '../lib/serverApi';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  const digits = amount >= 100 || exponent === 0 ? 0 : (amount >= 10 ? 1 : 2);
  return `${amount.toFixed(digits)} ${units[exponent]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRemaining(deletesAt) {
  if (!deletesAt) return '—';
  const remainingMs = new Date(deletesAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs)) return '—';
  if (remainingMs <= 0) return 'Pending delete';
  const totalMinutes = Math.round(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.max(totalMinutes, 1)}m left`;
}

function compareValues(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

const SORT_OPTIONS = [
  { key: 'sizeBytes', label: 'Size' },
  { key: 'fileName', label: 'Name' },
  { key: 'createdAt', label: 'Created' },
  { key: 'projectCount', label: 'Projects' },
  { key: 'clipCount', label: 'Clips' },
  { key: 'deletesAt', label: 'Deletes' },
];

function SearchField({ value, onChange, placeholder }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-300">
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

function UsageCard({ label, value, hint = null, tone = 'slate' }) {
  const toneClass = {
    slate: 'border-gray-800 bg-gray-950/60',
    amber: 'border-amber-800/70 bg-amber-950/30',
    blue: 'border-blue-900/60 bg-blue-950/20',
  }[tone] || 'border-gray-800 bg-gray-950/60';

  return (
    <div className={`rounded-xl border px-4 py-4 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'quarantine') {
    return (
      <span className="inline-flex rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-semibold text-amber-100">
        Quarantine
      </span>
    );
  }
  if (status === 'in_use') {
    return (
      <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs font-semibold text-emerald-100">
        In use
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-gray-800 px-2 py-0.5 text-xs font-semibold text-gray-300">
      Unused
    </span>
  );
}

function SortHeader({ label, sortKey, currentKey, direction, onSort, className = '' }) {
  const active = currentKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-left uppercase tracking-wide ${
        active ? 'text-gray-100' : 'text-gray-400 hover:text-gray-200'
      } ${className}`}
    >
      {label}
      {active ? (direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
    </button>
  );
}

function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onCancel,
  onConfirm,
}) {
  const confirmClass = tone === 'amber'
    ? 'bg-amber-600 hover:bg-amber-500'
    : 'bg-red-700 hover:bg-red-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-700 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-gray-300">
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-700 px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminStoragePanel({
  session = null,
  storage = null,
  onStorageChange = null,
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('sizeBytes');
  const [sortDirection, setSortDirection] = useState('desc');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);

  const summary = storage?.summary || null;
  const items = storage?.items || [];
  const volume = summary?.volume || null;
  const diskPercent = volume?.totalBytes
    ? Math.min(100, Math.round((Number(volume.usedBytes || 0) / Number(volume.totalBytes)) * 100))
    : null;
  const busy = Boolean(busyAction);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!needle) return true;
      const haystack = [
        item.fileName,
        item.id,
        item.sha256,
        item.mimeType,
        item.createdByUsername,
        ...(item.projectNames || []),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });

    next.sort((left, right) => {
      const result = compareValues(left[sortKey], right[sortKey]);
      return sortDirection === 'asc' ? result : -result;
    });
    return next;
  }, [items, query, sortDirection, sortKey, statusFilter]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'fileName' ? 'asc' : 'desc');
  };

  const applyStorageResult = (payload, message) => {
    if (payload?.items || payload?.summary) {
      onStorageChange?.(payload);
    }
    setNotice(message || '');
  };

  const runStorageAction = async (actionKey, work, successMessage) => {
    setBusyAction(actionKey);
    setError('');
    setNotice('');
    try {
      const payload = await work();
      const message = typeof successMessage === 'function' ? successMessage(payload) : successMessage;
      applyStorageResult(payload, message);
      setConfirmAction(null);
    } catch (actionError) {
      setError(actionError.message || 'Storage action failed.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRefresh = () => runStorageAction('refresh', () => listAdminStorage(session), '');

  const requestValidate = () => {
    setConfirmAction({
      kind: 'validate',
      title: 'Validate unused media',
      confirmLabel: 'Validate',
      tone: 'amber',
      message: 'This checks every stored audio file against the current projects. Files that are not used anywhere are moved to quarantine.',
    });
  };

  const requestQuarantine = (item) => {
    setConfirmAction({
      kind: 'quarantine',
      item,
      title: 'Move to quarantine',
      confirmLabel: 'Quarantine',
      tone: 'amber',
      message: `"${item.fileName}" will stay on disk for ${summary?.ttlHours || 168} hours, then be deleted automatically.`,
    });
  };

  const requestDelete = (item) => {
    const inUse = item.status === 'in_use';
    setConfirmAction({
      kind: 'delete',
      item,
      force: inUse,
      title: inUse ? 'Delete a file that is still in use' : 'Delete file',
      confirmLabel: 'Delete now',
      tone: 'danger',
      message: inUse
        ? `"${item.fileName}" is used by ${item.clipCount} clip${item.clipCount === 1 ? '' : 's'}${item.projectNames?.length ? ` in ${item.projectNames.join(', ')}` : ''}. Deleting it now will break those clips.`
        : `Permanently delete "${item.fileName}" from disk. This cannot be undone.`,
    });
  };

  const requestDeleteQuarantine = () => {
    setConfirmAction({
      kind: 'delete-quarantine',
      title: 'Delete quarantined files',
      confirmLabel: 'Delete quarantined',
      tone: 'danger',
      message: `Permanently delete ${summary?.quarantineCount || 0} quarantined file${summary?.quarantineCount === 1 ? '' : 's'} (${formatBytes(summary?.quarantineBytes)}). This cannot be undone.`,
    });
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.kind === 'validate') {
      runStorageAction('validate', () => validateAdminStorage(session), (payload) => {
        const quarantinedCount = Number(payload?.result?.quarantinedCount || 0);
        return quarantinedCount
          ? `Validated current projects. Moved ${quarantinedCount} unused file${quarantinedCount === 1 ? '' : 's'} to quarantine.`
          : 'Validated current projects. Every stored file is still needed.';
      });
      return;
    }
    if (confirmAction.kind === 'quarantine') {
      runStorageAction(
        `quarantine:${confirmAction.item.id}`,
        () => quarantineAdminMedia(confirmAction.item.id, session),
        `Moved "${confirmAction.item.fileName}" to quarantine.`
      );
      return;
    }
    if (confirmAction.kind === 'delete') {
      runStorageAction(
        `delete:${confirmAction.item.id}`,
        () => deleteAdminMedia(confirmAction.item.id, session, { force: Boolean(confirmAction.force) }),
        `Deleted "${confirmAction.item.fileName}".`
      );
      return;
    }
    runStorageAction(
      'delete-quarantine',
      () => deleteAdminQuarantinedMedia(session),
      (payload) => {
        const deletedCount = Number(payload?.result?.deletedCount || 0);
        return deletedCount
          ? `Deleted ${deletedCount} quarantined file${deletedCount === 1 ? '' : 's'}.`
          : 'No quarantined files to delete.';
      }
    );
  };

  const confirmBusy = busy && confirmAction;

  if (!storage) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/50 px-4 py-4 text-sm text-gray-400">
        Loading storage...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Storage</h2>
          <p className="mt-1 text-sm text-gray-400">
            Audio blobs stay for {summary?.ttlHours || 168} hours after the last project stops using them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestValidate}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-700/70 bg-blue-950/40 px-3 py-2 text-sm font-medium text-blue-100 hover:bg-blue-900/50 disabled:opacity-50"
          >
            <ScanSearch size={14} className={busyAction === 'validate' ? 'animate-pulse' : ''} />
            Validate unused media
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busyAction === 'refresh' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageCard
          label="Media collection"
          value={formatBytes(summary?.mediaBytes)}
          hint={`${summary?.mediaCount || 0} file${summary?.mediaCount === 1 ? '' : 's'}`}
        />
        <UsageCard
          label="App data"
          value={formatBytes(summary?.appBytes)}
          hint={`Media ${formatBytes(summary?.mediaBytes)} + database ${formatBytes(summary?.databaseBytes)}`}
          tone="blue"
        />
        <UsageCard
          label="Quarantine"
          value={formatBytes(summary?.quarantineBytes)}
          hint={`${summary?.quarantineCount || 0} file${summary?.quarantineCount === 1 ? '' : 's'} waiting to be deleted`}
          tone="amber"
        />
        <UsageCard
          label="Disk remaining"
          value={volume?.availableBytes == null ? 'Unknown' : formatBytes(volume.availableBytes)}
          hint={
            volume?.totalBytes == null
              ? 'Could not read the media volume'
              : `${formatBytes(volume.usedBytes)} used of ${formatBytes(volume.totalBytes)}`
          }
        />
      </div>

      {diskPercent != null ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm text-gray-300">
            <span className="inline-flex items-center gap-2">
              <HardDrive size={16} className="text-gray-500" />
              Disk holding media
            </span>
            <span>{diskPercent}% used</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full rounded-full ${
                diskPercent >= 90 ? 'bg-red-500' : (diskPercent >= 75 ? 'bg-amber-500' : 'bg-blue-500')
              }`}
              style={{ width: `${diskPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      <div
        className={`flex w-full flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
          statusFilter === 'quarantine'
            ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/40'
            : 'border-amber-900/70 bg-amber-950/25'
        }`}
      >
        <button
          type="button"
          onClick={() => setStatusFilter((current) => (current === 'quarantine' ? 'all' : 'quarantine'))}
          className="min-w-0 flex-1 text-left"
        >
          <div className="text-sm font-semibold text-amber-100">Quarantine</div>
          <div className="text-xs text-amber-200/80">
            Unused audio waiting for the {summary?.ttlHours || 168} hour deletion window to elapse.
          </div>
          <div className="mt-2 text-lg font-semibold text-amber-50">
            {summary?.quarantineCount || 0}
            <span className="ml-2 text-sm font-medium text-amber-200/80">
              {formatBytes(summary?.quarantineBytes)}
            </span>
          </div>
        </button>
        <button
          type="button"
          disabled={busy || !(summary?.quarantineCount)}
          onClick={requestDeleteQuarantine}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size={14} />
          Delete quarantined
        </button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files, projects, hashes, or uploaders"
        />
        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: 'all', label: 'All' },
            { value: 'in_use', label: 'In use' },
            { value: 'unused', label: 'Unused' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === option.value
                  ? 'bg-gray-100 text-gray-900'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
          <label className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-400">
            Sort
            <select
              value={sortKey}
              onChange={(event) => handleSort(event.target.value)}
              className="bg-transparent text-sm text-gray-100 outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950/50">
        <div className="min-w-[1140px]">
          <div className="grid grid-cols-[minmax(220px,1.5fr),90px,110px,90px,70px,150px,140px,170px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold">
            <SortHeader label="File" sortKey="fileName" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Size" sortKey="sizeBytes" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <span className="text-gray-400">Status</span>
            <SortHeader label="Projects" sortKey="projectCount" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Clips" sortKey="clipCount" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Created" sortKey="createdAt" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Deletes" sortKey="deletesAt" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <span className="text-gray-400">Actions</span>
          </div>
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`grid grid-cols-[minmax(220px,1.5fr),90px,110px,90px,70px,150px,140px,170px] items-start gap-4 border-b border-gray-800 px-4 py-4 last:border-b-0 ${
                item.status === 'quarantine' ? 'bg-amber-950/20' : 'hover:bg-gray-900/70'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-white" title={item.fileName}>{item.fileName}</div>
                <div className="mt-1 truncate text-xs text-gray-500" title={item.id}>
                  {item.createdByUsername || 'Unknown uploader'}
                  {item.sha256 ? ` · ${String(item.sha256).slice(0, 12)}` : ''}
                </div>
                {item.projectNames?.length ? (
                  <div className="mt-1 truncate text-xs text-gray-500" title={item.projectNames.join(', ')}>
                    {item.projectNames.join(', ')}
                  </div>
                ) : null}
              </div>
              <div className="text-sm text-gray-200">{formatBytes(item.sizeBytes)}</div>
              <div><StatusBadge status={item.status} /></div>
              <div className="text-sm text-gray-300">{item.projectCount}</div>
              <div className="text-sm text-gray-300">{item.clipCount}</div>
              <div className="text-xs text-gray-300">{formatDate(item.createdAt)}</div>
              <div className="text-xs text-gray-300">
                {item.status === 'quarantine' ? formatRemaining(item.deletesAt) : '—'}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {item.status !== 'quarantine' ? (
                  <button
                    type="button"
                    disabled={busy || item.status === 'in_use'}
                    title={item.status === 'in_use' ? 'This file is still used by a project' : 'Move to quarantine'}
                    onClick={() => requestQuarantine(item)}
                    className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Quarantine
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => requestDelete(item)}
                  className="rounded-lg border border-red-800/80 bg-red-950/40 px-2.5 py-1 text-xs font-semibold text-red-100 hover:bg-red-900/50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!filteredItems.length ? (
            <div className="px-4 py-6 text-sm text-gray-400">
              No media matches the current filters.
            </div>
          ) : null}
        </div>
      </div>

      {confirmAction ? (
        <ConfirmDialog
          title={confirmAction.title}
          confirmLabel={confirmAction.confirmLabel}
          tone={confirmAction.tone}
          busy={Boolean(confirmBusy)}
          onCancel={() => {
            if (!busy) setConfirmAction(null);
          }}
          onConfirm={handleConfirm}
        >
          <p>{confirmAction.message}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
