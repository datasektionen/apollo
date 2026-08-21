import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Database, HardDrive, RefreshCw, RotateCcw, ScanSearch, Search, Trash2, X } from 'lucide-react';
import {
  deleteAdminMedia,
  listAdminStorage,
  quarantineAdminMedia,
  restoreAdminMedia,
  validateAdminStorage,
} from '../lib/serverApi';
import { getAudioFormatFromFile } from '../lib/mediaEncoding';

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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
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

const SEARCH_KEYWORDS = [
  { key: 'file', label: 'file' },
  { key: 'format', label: 'format', suggestions: 'formats' },
  { key: 'uploader', label: 'uploader', suggestions: 'uploaders' },
  { key: 'hash', label: 'hash' },
  { key: 'size', label: 'size' },
  { key: 'projects', label: 'projects' },
  { key: 'in', label: 'in', suggestions: 'projects' },
  { key: 'clips', label: 'clips' },
  { key: 'created', label: 'created', subs: ['after', 'before'] },
  { key: 'quarantined', label: 'quarantined', subs: ['after', 'before'] },
  { key: 'quarantiner', label: 'quarantiner', suggestions: 'quarantiners' },
];
const SEARCH_KEYWORD_BY_KEY = Object.fromEntries(SEARCH_KEYWORDS.map((keyword) => [keyword.key, keyword]));
const SEARCH_VALUE_KEYS = SEARCH_KEYWORDS.filter((keyword) => !keyword.subs).map((keyword) => keyword.key).sort((left, right) => right.length - left.length);

const SEARCH_MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function parseByteAmount(raw) {
  const match = String(raw || '').trim().toLowerCase().replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[match[2] || 'b'];
  return amount * multiplier;
}

function parseNumberAmount(raw) {
  const amount = Number(String(raw || '').trim());
  return Number.isFinite(amount) ? amount : null;
}

function parseCompareFilter(raw, parseValue) {
  const text = String(raw || '').trim();
  const match = text.match(/^(<=|>=|<|>|=)?\s*(.*)$/);
  if (!match) return null;
  const value = parseValue(match[2]);
  if (value == null) return null;
  return { op: match[1] || '=', value };
}

function compareOp(actual, filter) {
  if (!filter) return false;
  const actualNum = Number(actual);
  if (!Number.isFinite(actualNum)) return false;
  if (filter.op === '>') return actualNum > filter.value;
  if (filter.op === '>=') return actualNum >= filter.value;
  if (filter.op === '<') return actualNum < filter.value;
  if (filter.op === '<=') return actualNum <= filter.value;
  return actualNum === filter.value;
}

function parseLooseDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  const normalized = text.toLowerCase().replace(/,/g, ' ').replace(/-/g, ' ');
  const parts = normalized.split(/\s+/).filter(Boolean);
  let day = null;
  let month = null;
  let year = null;
  parts.forEach((part) => {
    if (month == null && SEARCH_MONTHS[part] != null) {
      month = SEARCH_MONTHS[part];
      return;
    }
    if (/^\d{4}$/.test(part) && year == null) {
      year = Number(part);
      return;
    }
    if (/^\d{1,2}$/.test(part) && day == null) {
      day = Number(part);
    }
  });
  if (month == null && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime())) {
      return {
        start: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
        end: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999),
      };
    }
  }
  if (month == null || day == null) {
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return null;
    return {
      start: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
      end: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999),
    };
  }
  const resolvedYear = year == null ? new Date().getFullYear() : year;
  return {
    start: new Date(resolvedYear, month, day),
    end: new Date(resolvedYear, month, day, 23, 59, 59, 999),
  };
}

function containsText(value, needle) {
  return String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function matchDateFilter(isoValue, filterValue, edge) {
  const bound = parseLooseDate(filterValue);
  const date = isoValue ? new Date(isoValue) : null;
  if (!bound || !date || !Number.isFinite(date.getTime())) return false;
  return edge === 'after' ? date.getTime() >= bound.start.getTime() : date.getTime() <= bound.end.getTime();
}

function itemMatchesSearch(item, filters, terms) {
  if (!filters.length && !terms.length) return true;

  for (const filter of filters) {
    if (filter.key === 'file' && !containsText(item.fileName, filter.value)) return false;
    else if (filter.key === 'format' && !containsText(formatFromItem(item), filter.value)) return false;
    else if (filter.key === 'uploader' && !containsText(item.createdByUsername, filter.value)) return false;
    else if (filter.key === 'hash' && !containsText(item.sha256, filter.value)) return false;
    else if (filter.key === 'size' && !compareOp(item.sizeBytes, parseCompareFilter(filter.value, parseByteAmount))) return false;
    else if (filter.key === 'projects' && !compareOp(item.projectCount, parseCompareFilter(filter.value, parseNumberAmount))) return false;
    else if (filter.key === 'in' && !(item.projectNames || []).some((name) => containsText(name, filter.value))) return false;
    else if (filter.key === 'clips' && !compareOp(item.clipCount, parseCompareFilter(filter.value, parseNumberAmount))) return false;
    else if (filter.key === 'created' && filter.sub === 'after' && !matchDateFilter(item.createdAt, filter.value, 'after')) return false;
    else if (filter.key === 'created' && filter.sub === 'before' && !matchDateFilter(item.createdAt, filter.value, 'before')) return false;
    else if (filter.key === 'quarantined' && filter.sub === 'after' && !matchDateFilter(item.unreferencedAt, filter.value, 'after')) return false;
    else if (filter.key === 'quarantined' && filter.sub === 'before' && !matchDateFilter(item.unreferencedAt, filter.value, 'before')) return false;
    else if (filter.key === 'quarantiner' && !containsText(item.quarantinedByUsername, filter.value)) return false;
  }

  if (!terms.length) return true;
  const haystack = [
    item.fileName,
    item.id,
    item.sha256,
    item.mimeType,
    formatFromItem(item),
    item.createdByUsername,
    item.quarantinedByUsername,
    ...(item.projectNames || []),
  ].join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function unwrapSearchValue(raw) {
  const text = String(raw || '').trim();
  const quoted = text.match(/^"(.*)"$/);
  return quoted ? quoted[1] : text;
}

function filterLabel(filter) {
  if (filter.sub) return `${filter.key} ${filter.sub}:`;
  return `${filter.key}:`;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((left, right) => (
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  ));
}

function collectSearchSuggestions(items) {
  const formats = [];
  const uploaders = [];
  const projects = [];
  const quarantiners = [];
  (items || []).forEach((item) => {
    const format = formatFromItem(item);
    if (format) formats.push(format);
    if (item.createdByUsername) uploaders.push(item.createdByUsername);
    (item.projectNames || []).forEach((name) => projects.push(name));
    if (item.quarantinedByUsername) quarantiners.push(item.quarantinedByUsername);
  });
  return {
    formats: uniqueSorted(formats),
    uploaders: uniqueSorted(uploaders),
    projects: uniqueSorted(projects),
    quarantiners: uniqueSorted(quarantiners),
  };
}

function suggestionMatches(value, draft) {
  const needle = String(draft || '').trim().toLowerCase();
  const hay = String(value || '').toLowerCase();
  if (!needle) return true;
  return hay.startsWith(needle) || hay.includes(needle);
}

const TABLE_COLUMNS = [
  { key: 'fileName', label: 'File', defaultWidth: 220, minWidth: 96, required: true },
  { key: 'format', label: 'Format', defaultWidth: 88, minWidth: 64 },
  { key: 'createdByUsername', label: 'Uploader', defaultWidth: 140, minWidth: 80 },
  { key: 'sha256', label: 'Hash', defaultWidth: 120, minWidth: 72 },
  { key: 'sizeBytes', label: 'Size', defaultWidth: 90, minWidth: 64 },
  { key: 'projectCount', label: 'Projects', defaultWidth: 90, minWidth: 64 },
  { key: 'projectNames', label: 'Used in', defaultWidth: 160, minWidth: 80 },
  { key: 'clipCount', label: 'Clips', defaultWidth: 70, minWidth: 56 },
  { key: 'createdAt', label: 'Created', defaultWidth: 170, minWidth: 120 },
  { key: 'unreferencedAt', label: 'Quarantine date', defaultWidth: 170, minWidth: 120 },
  { key: 'quarantinedByUsername', label: 'Quarantiner', defaultWidth: 140, minWidth: 80 },
];

const DEFAULT_COLUMN_ORDER = TABLE_COLUMNS.map((column) => column.key);
const DEFAULT_COLUMN_WIDTHS = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [column.key, column.defaultWidth])
);
const COLUMN_BY_KEY = Object.fromEntries(TABLE_COLUMNS.map((column) => [column.key, column]));
const SELECT_COLUMN_WIDTH = 44;

const DEFAULT_VISIBLE_COLUMNS = ['fileName', 'format', 'sizeBytes', 'projectCount', 'clipCount', 'createdAt', 'unreferencedAt', 'quarantinedByUsername'];
const COLUMN_LAYOUT_COOKIE = 'apollo.admin.storage.columns';
const COLUMN_LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return '';
}

function writeCookie(name, value) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${COLUMN_LAYOUT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function sanitizeColumnLayout(raw) {
  const known = new Set(DEFAULT_COLUMN_ORDER);
  const order = [];
  const seen = new Set();
  if (Array.isArray(raw?.order)) {
    raw.order.forEach((key) => {
      if (known.has(key) && !seen.has(key)) {
        order.push(key);
        seen.add(key);
      }
    });
  }
  DEFAULT_COLUMN_ORDER.forEach((key) => {
    if (!seen.has(key)) order.push(key);
  });

  const visible = new Set();
  const visibleSource = Array.isArray(raw?.visible) ? raw.visible : DEFAULT_VISIBLE_COLUMNS;
  visibleSource.forEach((key) => {
    if (known.has(key)) visible.add(key);
  });
  TABLE_COLUMNS.forEach((column) => {
    if (column.required) visible.add(column.key);
  });

  const widths = { ...DEFAULT_COLUMN_WIDTHS };
  if (raw?.widths && typeof raw.widths === 'object') {
    TABLE_COLUMNS.forEach((column) => {
      const value = Number(raw.widths[column.key]);
      if (Number.isFinite(value)) {
        widths[column.key] = Math.max(column.minWidth, Math.round(value));
      }
    });
  }

  return { order, visible, widths };
}

function loadColumnLayout() {
  try {
    return sanitizeColumnLayout(JSON.parse(readCookie(COLUMN_LAYOUT_COOKIE) || 'null'));
  } catch {
    return sanitizeColumnLayout(null);
  }
}

function SearchField({
  filters,
  draft,
  pending,
  onFiltersChange,
  onDraftChange,
  onPendingChange,
  suggestionLists,
  placeholder,
}) {
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const commitFilter = (nextFilter) => {
    if (!nextFilter?.key || !String(nextFilter.value || '').trim()) return;
    onFiltersChange([...filters, {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key: nextFilter.key,
      sub: nextFilter.sub || null,
      value: unwrapSearchValue(nextFilter.value),
    }]);
    onPendingChange(null);
    onDraftChange('');
    setActiveIndex(0);
  };

  const suggestions = useMemo(() => {
    const typed = draft.trim();
    if (pending?.key && SEARCH_KEYWORD_BY_KEY[pending.key]?.subs && !pending.sub) {
      return ['after', 'before']
        .filter((sub) => {
          const needle = typed.toLowerCase();
          return !needle || sub.startsWith(needle);
        })
        .map((sub) => ({
          kind: 'sub',
          key: pending.key,
          sub,
          label: `${sub}:`,
        }));
    }
    if (pending?.key) {
      const keyword = SEARCH_KEYWORD_BY_KEY[pending.key];
      if (!keyword?.suggestions) return [];
      const values = suggestionLists[keyword.suggestions] || [];
      return values
        .filter((value) => suggestionMatches(value, typed))
        .sort((left, right) => {
          const needle = typed.toLowerCase();
          if (!needle) return left.localeCompare(right, undefined, { sensitivity: 'base' });
          const leftStarts = left.toLowerCase().startsWith(needle);
          const rightStarts = right.toLowerCase().startsWith(needle);
          if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
          return left.localeCompare(right, undefined, { sensitivity: 'base' });
        })
        .slice(0, 20)
        .map((value) => ({
          kind: 'value',
          key: pending.key,
          sub: pending.sub || null,
          value,
          label: value,
        }));
    }
    if (typed.length < 1) return [];
    const needle = typed.toLowerCase();
    return SEARCH_KEYWORDS
      .filter((keyword) => keyword.key.startsWith(needle) || keyword.label.startsWith(needle))
      .map((keyword) => ({
        kind: 'keyword',
        key: keyword.key,
        label: keyword.subs ? keyword.label : `${keyword.label}:`,
      }));
  }, [draft, pending, suggestionLists]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions, pending]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const applySuggestion = (suggestion) => {
    if (!suggestion) return;
    if (suggestion.kind === 'keyword') {
      const keyword = SEARCH_KEYWORD_BY_KEY[suggestion.key];
      onPendingChange({ key: suggestion.key, sub: null });
      onDraftChange('');
      setOpen(Boolean(keyword?.subs || keyword?.suggestions));
      return;
    }
    if (suggestion.kind === 'sub') {
      onPendingChange({ key: suggestion.key, sub: suggestion.sub });
      onDraftChange('');
      setOpen(false);
      return;
    }
    commitFilter(suggestion);
    setOpen(false);
  };

  const handleChange = (event) => {
    const nextDraft = event.target.value;
    onDraftChange(nextDraft);
    setOpen(true);

    if (!pending) {
      const typedKeyword = SEARCH_KEYWORDS.find((keyword) => {
        const lower = nextDraft.toLowerCase();
        if (keyword.subs) return lower === `${keyword.key} ` || lower === `${keyword.key}:`;
        return lower === `${keyword.key}:`;
      });
      if (typedKeyword) {
        onPendingChange({ key: typedKeyword.key, sub: null });
        onDraftChange('');
        setOpen(Boolean(typedKeyword.subs || typedKeyword.suggestions));
        return;
      }
    }

    if (pending?.key && SEARCH_KEYWORD_BY_KEY[pending.key]?.subs && !pending.sub) {
      const subMatch = nextDraft.trim().toLowerCase().match(/^(after|before):?$/);
      if (subMatch && /[:\s]$/.test(nextDraft)) {
        onPendingChange({ key: pending.key, sub: subMatch[1] });
        onDraftChange('');
        return;
      }
    }

    const trimmedEnd = nextDraft.replace(/\s+$/, '');
    const dateMatch = trimmedEnd.match(/^(created|quarantined)\s+(after|before):(?:"([^"]*)"|(\S+))$/i);
    if (dateMatch && /\s$/.test(nextDraft)) {
      commitFilter({
        key: dateMatch[1].toLowerCase(),
        sub: dateMatch[2].toLowerCase(),
        value: dateMatch[3] || dateMatch[4],
      });
      return;
    }
    const valueKey = SEARCH_VALUE_KEYS.find((key) => trimmedEnd.toLowerCase().startsWith(`${key}:`));
    if (valueKey && /\s$/.test(nextDraft)) {
      const raw = trimmedEnd.slice(valueKey.length + 1);
      const quoted = raw.match(/^"(.*)"$/);
      commitFilter({ key: valueKey, value: quoted ? quoted[1] : raw });
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && open && suggestions[activeIndex]) {
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && pending && draft.trim()) {
      if (SEARCH_KEYWORD_BY_KEY[pending.key]?.subs && !pending.sub) return;
      event.preventDefault();
      commitFilter({ key: pending.key, sub: pending.sub, value: draft.trim() });
      setOpen(false);
      return;
    }
    if (event.key === ' ' && pending && draft.trim() && !SEARCH_KEYWORD_BY_KEY[pending.key]?.subs) {
      if (draft.trim().startsWith('"') && !/^"[^"]+"$/.test(draft.trim())) return;
      event.preventDefault();
      commitFilter({ key: pending.key, sub: pending.sub, value: draft.trim() });
      setOpen(false);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        setOpen(false);
        return;
      }
      if (pending) {
        onPendingChange(null);
        onDraftChange('');
      }
      return;
    }
    if (event.key === 'Backspace' && !draft) {
      if (pending?.sub) {
        event.preventDefault();
        onPendingChange({ key: pending.key, sub: null });
        setOpen(true);
        return;
      }
      if (pending?.key) {
        event.preventDefault();
        onPendingChange(null);
        setOpen(false);
        return;
      }
      if (filters.length) {
        event.preventDefault();
        onFiltersChange(filters.slice(0, -1));
      }
    }
  };

  const pendingKeyword = pending ? SEARCH_KEYWORD_BY_KEY[pending.key] : null;
  const showMenu = open && suggestions.length > 0;
  const empty = !filters.length && !draft && !pending;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <label className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 focus-within:border-gray-500">
        <Search size={16} className="shrink-0 text-gray-500" />
        {filters.map((filter) => (
          <span
            key={filter.id}
            className="inline-flex max-w-full items-center gap-1 rounded-[4px] bg-[#5865F2]/30 px-1.5 py-[3px] text-[13px] leading-none"
          >
            <span className="shrink-0 font-medium text-[#c9cdfb]">{filterLabel(filter)}</span>
            <span className="truncate text-white">{filter.value}</span>
            <button
              type="button"
              className="rounded p-0.5 text-gray-300 hover:bg-white/10 hover:text-white"
              onClick={() => onFiltersChange(filters.filter((current) => current.id !== filter.id))}
              aria-label={`Remove ${filterLabel(filter)} ${filter.value}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {pendingKeyword ? (
          <span className="shrink-0 text-xs text-[#b8b9f4]">
            {pending.sub ? `${pendingKeyword.label} ${pending.sub}:` : `${pendingKeyword.label}${pendingKeyword.subs ? '' : ':'}`}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={empty ? placeholder : pending?.sub ? '21 Aug 2026' : ''}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-gray-100 outline-none placeholder:text-gray-500"
        />
      </label>
      {showMenu ? (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 py-1 shadow-2xl">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.kind}-${suggestion.label}-${suggestion.value || suggestion.sub || suggestion.key}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(suggestion)}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                index === activeIndex ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-800'
              }`}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const STORAGE_COLORS = {
  media: '#ff453a',
  database: '#ff9f0a',
  quarantine: '#ffd60a',
  other: '#8e8e93',
  free: '#3a3a3c',
};

function StorageBar({
  title,
  icon: Icon = HardDrive,
  usedLabel,
  segments,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  const [anchor, setAnchor] = useState({ caretX: 0, caretTop: 0, tooltipLeft: 0, tooltipTop: 0 });
  const barRef = useRef(null);
  const tooltipRef = useRef(null);
  const hovered = segments.find((segment) => segment.id === hoveredId) || null;

  useLayoutEffect(() => {
    if (!hoveredId || !barRef.current) return;

    const updateAnchor = () => {
      const bar = barRef.current;
      if (!bar) return;
      const hoveredNode = bar.querySelector(`[data-segment="${hoveredId}"]`);
      if (!hoveredNode) return;

      const targetRect = hoveredNode.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const caretX = Math.round((targetRect.left + targetRect.right) / 2);
      const caretTop = Math.round(barRect.top - 10);
      const tooltipWidth = tooltipRef.current?.offsetWidth || 0;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 0;
      const maxLeft = Math.max(8, window.innerWidth - tooltipWidth - 8);
      const tooltipLeft = Math.round(Math.min(Math.max(8, caretX - (tooltipWidth / 2)), maxLeft));
      const tooltipTop = Math.round(Math.max(8, caretTop - tooltipHeight));

      setAnchor((current) => (
        current.caretX === caretX
          && current.caretTop === caretTop
          && current.tooltipLeft === tooltipLeft
          && current.tooltipTop === tooltipTop
          ? current
          : { caretX, caretTop, tooltipLeft, tooltipTop }
      ));
    };

    updateAnchor();
    const frame = window.requestAnimationFrame(updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('resize', updateAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('resize', updateAnchor);
    };
  }, [hoveredId]);

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-950/60 px-5 py-3">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={16} className="text-gray-500" />
          {title}
        </div>
        <div className="text-sm text-gray-400">{usedLabel}</div>
      </div>

      <div
        ref={barRef}
        className="flex h-12 overflow-hidden rounded-[8px] bg-[#2c2c2e]"
        onMouseLeave={() => setHoveredId(null)}
      >
        {segments.map((segment, index) => {
          const isHovered = hoveredId === segment.id;
          const dimmed = Boolean(hoveredId) && !isHovered;
          const isLast = index === segments.length - 1;
          return (
            <div
              key={segment.id}
              data-segment={segment.id}
              className="flex h-full cursor-default"
              style={{
                flexGrow: Math.max(segment.bytes, 1),
                flexBasis: 0,
                minWidth: isLast ? 2 : 3,
              }}
              onMouseEnter={() => setHoveredId(segment.id)}
            >
              <div
                className="h-full min-w-0 flex-1 transition-opacity"
                style={{
                  backgroundColor: segment.color,
                  opacity: dimmed ? 0.45 : 1,
                }}
              />
              {isLast ? null : (
                <div className="h-full w-px shrink-0 bg-black" />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`flex items-center gap-[7px] text-sm leading-none ${
              hoveredId === segment.id ? 'text-white' : 'text-gray-400'
            }`}
          >
            <span
              className="block h-2.5 w-2.5 shrink-0 translate-y-[0.5px] rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="leading-none">{segment.label}</span>
          </div>
        ))}
      </div>

      {hovered ? createPortal(
        <>
          <div
            ref={tooltipRef}
            className="pointer-events-none fixed z-[60]"
            style={{ left: anchor.tooltipLeft, top: anchor.tooltipTop }}
          >
            <div className="rounded-xl bg-gray-800 px-3 py-2 text-center text-white shadow-2xl ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white">{hovered.label}</div>
              <div className="text-xs text-gray-400">{formatBytes(hovered.bytes)}</div>
            </div>
          </div>
          <div
            className="pointer-events-none fixed z-[60] h-0 w-0 border-x-[7px] border-t-[8px] border-x-transparent border-t-gray-800"
            style={{ left: anchor.caretX, top: anchor.caretTop, transform: 'translateX(-50%)' }}
          />
        </>,
        document.body
      ) : null}
    </div>
  );
}

function volumeCapacityLabel(volume, usedFallback) {
  const totalBytes = Number(volume?.totalBytes || 0);
  const usedBytes = Number(volume?.usedBytes || 0);
  if (totalBytes > 0) {
    return `${formatBytes(usedBytes)} of ${formatBytes(totalBytes)} used`;
  }
  return formatBytes(usedFallback);
}

function diskSegments({
  mediaBytes = 0,
  databaseBytes = 0,
  quarantineBytes = 0,
  includeDatabase = false,
  volume = null,
}) {
  const totalBytes = Number(volume?.totalBytes || 0);
  const usedBytes = Number(volume?.usedBytes || 0);
  const freeBytes = Number(volume?.availableBytes || 0);
  const accountedBytes = mediaBytes + quarantineBytes + (includeDatabase ? databaseBytes : 0);
  const otherBytes = totalBytes > 0 ? Math.max(0, usedBytes - accountedBytes) : 0;

  return [
    { id: 'media', label: 'Media', color: STORAGE_COLORS.media, bytes: mediaBytes },
    ...(includeDatabase
      ? [{ id: 'database', label: 'Database', color: STORAGE_COLORS.database, bytes: databaseBytes }]
      : []),
    { id: 'quarantine', label: 'Quarantine', color: STORAGE_COLORS.quarantine, bytes: quarantineBytes },
    ...(otherBytes > 0
      ? [{ id: 'other', label: 'Other', color: STORAGE_COLORS.other, bytes: otherBytes }]
      : []),
    ...(totalBytes > 0
      ? [{ id: 'free', label: 'Free', color: STORAGE_COLORS.free, bytes: Math.max(0, freeBytes) }]
      : []),
  ].filter((segment) => segment.bytes > 0);
}

function postgresSegments({
  databaseBytes = 0,
  quotaBytes = null,
  volume = null,
}) {
  const quota = Number(quotaBytes || 0);
  if (quota > 0) {
    return [
      { id: 'database', label: 'Database', color: STORAGE_COLORS.database, bytes: databaseBytes },
      { id: 'remaining', label: 'Remaining', color: STORAGE_COLORS.free, bytes: Math.max(0, quota - databaseBytes) },
    ].filter((segment) => segment.bytes > 0);
  }

  const totalBytes = Number(volume?.totalBytes || 0);
  const usedBytes = Number(volume?.usedBytes || 0);
  const freeBytes = Number(volume?.availableBytes || 0);
  const otherBytes = totalBytes > 0 ? Math.max(0, usedBytes - databaseBytes) : 0;

  return [
    { id: 'database', label: 'Database', color: STORAGE_COLORS.database, bytes: databaseBytes },
    ...(otherBytes > 0
      ? [{ id: 'other', label: 'Other', color: STORAGE_COLORS.other, bytes: otherBytes }]
      : []),
    ...(totalBytes > 0
      ? [{ id: 'free', label: 'Free', color: STORAGE_COLORS.free, bytes: Math.max(0, freeBytes) }]
      : []),
  ].filter((segment) => segment.bytes > 0);
}

function StorageOverviewBar({ summary }) {
  const mediaBytes = Math.max(0, Number(summary?.mediaBytes || 0) - Number(summary?.quarantineBytes || 0));
  const databaseBytes = Math.max(0, Number(summary?.databaseBytes || 0));
  const quarantineBytes = Math.max(0, Number(summary?.quarantineBytes || 0));
  const volume = summary?.volume || null;
  const splitVolumes = summary?.sameFilesystem === false;

  if (!summary) return null;

  if (!splitVolumes) {
    return (
      <StorageBar
        title="Disk space"
        usedLabel={volumeCapacityLabel(volume, mediaBytes + databaseBytes + quarantineBytes)}
        segments={diskSegments({
          mediaBytes,
          databaseBytes,
          quarantineBytes,
          includeDatabase: true,
          volume,
        })}
      />
    );
  }

  const quotaBytes = Number(summary?.databaseQuotaBytes || 0);
  const databaseVolume = summary?.databaseVolume || null;
  const postgresCapacity = quotaBytes > 0
    ? `${formatBytes(databaseBytes)} of ${formatBytes(quotaBytes)} allowed`
    : (Number(databaseVolume?.totalBytes || 0) > 0
      ? volumeCapacityLabel(databaseVolume, databaseBytes)
      : formatBytes(databaseBytes));

  return (
    <div className="space-y-5">
      <StorageBar
        title="Media Disk"
        usedLabel={volumeCapacityLabel(volume, mediaBytes + quarantineBytes)}
        segments={diskSegments({
          mediaBytes,
          quarantineBytes,
          includeDatabase: false,
          volume,
        })}
      />
      <StorageBar
        title="Postgres Database"
        icon={Database}
        usedLabel={postgresCapacity}
        segments={postgresSegments({
          databaseBytes,
          quotaBytes: quotaBytes > 0 ? quotaBytes : null,
          volume: databaseVolume,
        })}
      />
    </div>
  );
}

function formatFromItem(item) {
  const known = getAudioFormatFromFile({
    fileName: item?.fileName,
    mimeType: item?.mimeType,
  });
  if (known) return known.toUpperCase();
  const name = String(item?.fileName || '');
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (extension) return extension.toUpperCase();
  const mime = String(item?.mimeType || '');
  if (mime && mime !== 'application/octet-stream') {
    const subtype = mime.split('/')[1]?.split(';')[0]?.trim();
    if (subtype) return subtype.toUpperCase();
  }
  return '';
}

function sortValue(item, key) {
  if (key === 'projectNames') return (item.projectNames || []).join(', ');
  if (key === 'format') return formatFromItem(item);
  return item[key];
}

function renderStorageCell(column, item) {
  if (column.key === 'fileName') {
    return (
      <span className="block truncate font-semibold text-white" title={item.fileName}>
        {item.fileName}
      </span>
    );
  }
  if (column.key === 'createdByUsername') {
    const name = item.createdByUsername || '—';
    return (
      <span className="block truncate text-sm text-gray-300" title={name}>
        {name}
      </span>
    );
  }
  if (column.key === 'sha256') {
    const hash = item.sha256 ? String(item.sha256) : '';
    return (
      <span className="block truncate font-mono text-xs text-gray-400" title={hash || undefined}>
        {hash ? hash.slice(0, 12) : '—'}
      </span>
    );
  }
  if (column.key === 'sizeBytes') {
    return <span className="text-sm text-gray-200">{formatBytes(item.sizeBytes)}</span>;
  }
  if (column.key === 'format') {
    const format = formatFromItem(item);
    return <span className="text-sm text-gray-200">{format || '—'}</span>;
  }
  if (column.key === 'projectCount') {
    return <span className="text-sm text-gray-300">{item.projectCount}</span>;
  }
  if (column.key === 'projectNames') {
    const names = (item.projectNames || []).join(', ');
    return (
      <span className="block truncate text-sm text-gray-300" title={names || undefined}>
        {names || '—'}
      </span>
    );
  }
  if (column.key === 'clipCount') {
    return <span className="text-sm text-gray-300">{item.clipCount}</span>;
  }
  if (column.key === 'createdAt') {
    return <span className="text-xs text-gray-300">{formatDate(item.createdAt)}</span>;
  }
  if (column.key === 'unreferencedAt') {
    return <span className="text-xs text-gray-300">{formatDate(item.unreferencedAt)}</span>;
  }
  if (column.key === 'quarantinedByUsername') {
    const name = item.quarantinedByUsername || '—';
    return (
      <span className="block truncate text-sm text-gray-300" title={name}>
        {name}
      </span>
    );
  }
  return <span className="text-xs text-gray-300">—</span>;
}

function HeaderCell({
  column,
  isLast = false,
  currentKey,
  direction,
  onSort,
  width,
  onResize,
  onResizeStart,
  onResizeEnd,
  onMoveColumn,
  draggingKey,
  dropTargetKey,
  onDragState,
}) {
  const suppressClickRef = useRef(false);
  const active = currentKey === column.key;
  const dragging = draggingKey === column.key;

  return (
    <div
      className={`relative flex h-full min-h-[2.75rem] ${isLast ? '' : 'border-r border-gray-800'} ${
        dragging ? 'cursor-grabbing opacity-40' : ''
      } ${dropTargetKey === column.key && !dragging ? 'bg-blue-900/40' : ''}`}
      draggable
      onDragStart={(event) => {
        suppressClickRef.current = true;
        event.dataTransfer.setData('text/plain', column.key);
        event.dataTransfer.effectAllowed = 'move';
        onDragState({ draggingKey: column.key, dropTargetKey: null });
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTargetKey !== column.key) {
          onDragState({ dropTargetKey: column.key });
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const fromKey = event.dataTransfer.getData('text/plain');
        onMoveColumn(fromKey, column.key);
        onDragState({ draggingKey: null, dropTargetKey: null });
      }}
      onDragEnd={() => onDragState({ draggingKey: null, dropTargetKey: null })}
    >
      <button
        type="button"
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onSort(column.key);
        }}
        className={`flex h-full w-full items-center gap-1 px-3 py-3 text-left text-xs font-semibold ${
          dragging ? 'cursor-grabbing' : 'cursor-pointer'
        } ${
          active ? 'text-gray-100' : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200'
        }`}
      >
        {column.label}
        {active ? (direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
      </button>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        className="absolute right-0 top-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize"
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResizeStart();
          const startX = event.clientX;
          const startWidth = width;
          const onMove = (moveEvent) => {
            onResize(column.key, Math.max(column.minWidth, startWidth + (moveEvent.clientX - startX)));
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            onResizeEnd();
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        }}
      />
    </div>
  );
}

const TOAST_SHOW_MS = 4000;
const TOAST_HOVER_MS = 1600;
const TOAST_FADE_MS = 700;

function FloatingToast({ message, tone = 'success', onDone }) {
  const [opaque, setOpaque] = useState(true);
  const [top, setTop] = useState(72);
  const hoveredRef = useRef(false);
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);
  const onDoneRef = useRef(onDone);
  const scheduleHideRef = useRef(() => {});
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const updateTop = () => {
      const bar = document.querySelector('[data-admin-topbar]');
      const bottom = bar?.getBoundingClientRect().bottom;
      setTop(Math.round((Number.isFinite(bottom) ? bottom : 56) + 12));
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    return () => window.removeEventListener('resize', updateTop);
  }, []);

  useEffect(() => {
    const clearTimers = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (removeTimerRef.current) {
        clearTimeout(removeTimerRef.current);
        removeTimerRef.current = null;
      }
    };

    const scheduleHide = (delayMs) => {
      clearTimers();
      hideTimerRef.current = setTimeout(() => {
        if (hoveredRef.current) return;
        setOpaque(false);
        removeTimerRef.current = setTimeout(() => onDoneRef.current?.(), TOAST_FADE_MS);
      }, delayMs);
    };

    scheduleHideRef.current = scheduleHide;
    hoveredRef.current = false;
    setOpaque(true);
    scheduleHide(TOAST_SHOW_MS);

    return clearTimers;
  }, [message, tone]);

  const toneClass = tone === 'error'
    ? 'border-red-700/40 bg-red-900/90 text-red-100'
    : 'border-emerald-700/40 bg-emerald-900/90 text-emerald-100';

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-[200] flex justify-center px-4"
      style={{ top }}
    >
      <div
        role={tone === 'error' ? 'alert' : 'status'}
        onMouseEnter={() => {
          hoveredRef.current = true;
          if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
          if (removeTimerRef.current) {
            clearTimeout(removeTimerRef.current);
            removeTimerRef.current = null;
          }
          setOpaque(true);
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          scheduleHideRef.current(TOAST_HOVER_MS);
        }}
        className={`pointer-events-auto max-w-lg rounded-xl border px-4 py-3 text-sm shadow-2xl transition-opacity ${toneClass}`}
        style={{ opacity: opaque ? 1 : 0, transitionDuration: `${TOAST_FADE_MS}ms` }}
      >
        {message}
      </div>
    </div>,
    document.body
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
  const [searchFilters, setSearchFilters] = useState([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchPending, setSearchPending] = useState(null);
  const [sortKey, setSortKey] = useState('sizeBytes');
  const [sortDirection, setSortDirection] = useState('desc');
  const [busyAction, setBusyAction] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => loadColumnLayout().visible);
  const [columnOrder, setColumnOrder] = useState(() => loadColumnLayout().order);
  const [columnWidths, setColumnWidths] = useState(() => loadColumnLayout().widths);
  const [columnsMenu, setColumnsMenu] = useState(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [dropTargetKey, setDropTargetKey] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const columnsMenuRef = useRef(null);

  const summary = storage?.summary || null;
  const items = storage?.items || [];
  const busy = Boolean(busyAction);
  const visibleColumns = columnOrder
    .map((key) => COLUMN_BY_KEY[key])
    .filter((column) => column && (column.required || visibleColumnKeys.has(column.key)));
  const gridTemplateColumns = `${SELECT_COLUMN_WIDTH}px ${visibleColumns.map((column, index) => {
    const width = columnWidths[column.key] || column.defaultWidth;
    return index === visibleColumns.length - 1
      ? `minmax(${width}px, 1fr)`
      : `${width}px`;
  }).join(' ')}`;

  const searchSuggestions = useMemo(() => collectSearchSuggestions(items), [items]);
  const searchTerms = useMemo(() => (
    searchPending ? [] : searchDraft.trim().split(/\s+/).filter(Boolean)
  ), [searchDraft, searchPending]);

  const filteredItems = useMemo(() => {
    const next = items.filter((item) => itemMatchesSearch(item, searchFilters, searchTerms));

    next.sort((left, right) => {
      const result = compareValues(sortValue(left, sortKey), sortValue(right, sortKey));
      return sortDirection === 'asc' ? result : -result;
    });
    return next;
  }, [items, searchFilters, searchTerms, sortDirection, sortKey]);

  const selectedItems = filteredItems.filter((item) => selectedIds.has(item.id));
  const quarantinableItems = selectedItems.filter((item) => item.status !== 'quarantine');
  const restorableItems = selectedItems.filter((item) => item.status === 'quarantine');
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
  const someVisibleSelected = filteredItems.some((item) => selectedIds.has(item.id));

  useEffect(() => {
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      if (next.size === current.size) {
        let unchanged = true;
        current.forEach((id) => {
          if (!next.has(id)) unchanged = false;
        });
        if (unchanged) return current;
      }
      return next;
    });
  }, [filteredItems]);

  useEffect(() => {
    if (!columnsMenu) return undefined;
    const onPointerDown = (event) => {
      if (!columnsMenuRef.current?.contains(event.target)) {
        setColumnsMenu(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [columnsMenu]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeCookie(COLUMN_LAYOUT_COOKIE, JSON.stringify({
        order: columnOrder,
        visible: [...visibleColumnKeys],
        widths: columnWidths,
      }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [columnOrder, columnWidths, visibleColumnKeys]);

  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = 'col-resize';
    } else if (draggingKey) {
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.cursor = '';
    };
  }, [draggingKey, isResizing]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(['fileName', 'format', 'createdByUsername', 'sha256', 'projectNames', 'quarantinedByUsername'].includes(key) ? 'asc' : 'desc');
  };

  const toggleColumn = (key) => {
    setVisibleColumnKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resizeColumn = (key, width) => {
    setColumnWidths((current) => (
      current[key] === width ? current : { ...current, [key]: width }
    ));
  };

  const moveColumn = (fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== fromKey);
      const insertAt = next.indexOf(toKey);
      if (insertAt < 0) return current;
      next.splice(insertAt, 0, fromKey);
      return next;
    });
  };

  const openColumnsMenu = (event) => {
    event.preventDefault();
    setColumnsMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 360),
    });
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        filteredItems.forEach((item) => next.delete(item.id));
        return next;
      }
      const next = new Set(current);
      filteredItems.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const applyStorageResult = (payload, message) => {
    if (payload?.items || payload?.summary) {
      onStorageChange?.(payload);
    }
    if (message) {
      setToast({ id: Date.now(), tone: 'success', message });
    }
  };

  const runStorageAction = async (actionKey, work, successMessage) => {
    setBusyAction(actionKey);
    try {
      const payload = await work();
      const message = typeof successMessage === 'function' ? successMessage(payload) : successMessage;
      applyStorageResult(payload, message);
    } catch (actionError) {
      setToast({
        id: Date.now(),
        tone: 'error',
        message: actionError.message || 'Storage action failed.',
      });
    } finally {
      setBusyAction('');
      setConfirmAction(null);
    }
  };

  const runOnItems = async (targetItems, worker) => {
    let lastPayload = null;
    for (const item of targetItems) {
      lastPayload = await worker(item);
    }
    return lastPayload;
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

  const quarantineItems = (targetItems, { force = false } = {}) => {
    if (!targetItems.length) return;
    runStorageAction(
      'quarantine-selected',
      async () => {
        const payload = await runOnItems(targetItems, (item) => (
          quarantineAdminMedia(item.id, session, {
            force: force || item.status === 'in_use',
          })
        ));
        setSelectedIds(new Set());
        return payload;
      },
      targetItems.length === 1
        ? `Moved "${targetItems[0].fileName}" to quarantine.`
        : `Moved ${targetItems.length} files to quarantine.`
    );
  };

  const requestQuarantineSelected = () => {
    if (!quarantinableItems.length) return;
    const inUseCount = quarantinableItems.filter((item) => item.status === 'in_use').length;
    if (!inUseCount) {
      quarantineItems(quarantinableItems);
      return;
    }
    const count = quarantinableItems.length;
    setConfirmAction({
      kind: 'quarantine-selected',
      items: quarantinableItems,
      title: 'Quarantine files that are still in use',
      confirmLabel: count === 1 ? 'Quarantine' : `Quarantine ${count}`,
      tone: 'danger',
      message: `Move ${count} file${count === 1 ? '' : 's'} to quarantine. ${inUseCount} ${inUseCount === 1 ? 'is' : 'are'} still used by a project, and quarantining ${inUseCount === 1 ? 'it' : 'them'} will break those clips.`,
    });
  };

  const requestRestoreSelected = () => {
    if (!restorableItems.length) return;
    const targetItems = restorableItems;
    runStorageAction(
      'restore-selected',
      async () => {
        const payload = await runOnItems(targetItems, (item) => restoreAdminMedia(item.id, session));
        setSelectedIds(new Set());
        return payload;
      },
      targetItems.length === 1
        ? `Restored "${targetItems[0].fileName}" from quarantine.`
        : `Restored ${targetItems.length} files from quarantine.`
    );
  };

  const deleteItems = (targetItems) => {
    if (!targetItems.length) return;
    runStorageAction(
      'delete-selected',
      async () => {
        const payload = await runOnItems(targetItems, (item) => (
          deleteAdminMedia(item.id, session, { force: item.status === 'in_use' })
        ));
        setSelectedIds(new Set());
        return payload;
      },
      targetItems.length === 1
        ? `Deleted "${targetItems[0].fileName}".`
        : `Deleted ${targetItems.length} files.`
    );
  };

  const requestDeleteSelected = () => {
    if (!selectedItems.length) return;
    if (selectedItems.every((item) => item.status === 'quarantine')) {
      deleteItems(selectedItems);
      return;
    }
    const inUseCount = selectedItems.filter((item) => item.status === 'in_use').length;
    const count = selectedItems.length;
    setConfirmAction({
      kind: 'delete-selected',
      items: selectedItems,
      force: inUseCount > 0,
      title: inUseCount ? 'Delete files that are still in use' : (count === 1 ? 'Delete file' : 'Delete files'),
      confirmLabel: count === 1 ? 'Delete now' : `Delete ${count}`,
      tone: 'danger',
      message: inUseCount
        ? `Permanently delete ${count} file${count === 1 ? '' : 's'}. ${inUseCount} ${inUseCount === 1 ? 'is' : 'are'} still used by a project, and deleting ${inUseCount === 1 ? 'it' : 'them'} will break those clips.`
        : `Permanently delete ${count} file${count === 1 ? '' : 's'} from disk. This cannot be undone.`,
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
    if (confirmAction.kind === 'quarantine-selected') {
      quarantineItems(confirmAction.items || [], { force: true });
      return;
    }
    if (confirmAction.kind === 'delete-selected') {
      deleteItems(confirmAction.items || []);
    }
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
      <StorageOverviewBar summary={summary} />

      <SearchField
        filters={searchFilters}
        draft={searchDraft}
        pending={searchPending}
        onFiltersChange={setSearchFilters}
        onDraftChange={setSearchDraft}
        onPendingChange={setSearchPending}
        suggestionLists={searchSuggestions}
        placeholder="Search, or file: name"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !quarantinableItems.length}
            onClick={requestQuarantineSelected}
            className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-2.5 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Quarantine
          </button>
          <button
            type="button"
            disabled={busy || !restorableItems.length}
            onClick={requestRestoreSelected}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/80 bg-emerald-950/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={12} />
            Restore
          </button>
          <button
            type="button"
            disabled={busy || !selectedItems.length}
            onClick={requestDeleteSelected}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/80 bg-red-950/40 px-2.5 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={12} />
            Delete
          </button>
          {selectedItems.length ? (
            <span className="text-xs text-gray-400">
              {selectedItems.length} selected
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={requestValidate}
            disabled={busy}
            title="Quarantine unused"
            aria-label="Quarantine unused"
            className="inline-flex items-center justify-center rounded-lg border border-blue-700/70 bg-blue-950/40 p-1.5 text-blue-100 hover:bg-blue-900/50 disabled:opacity-50"
          >
            <ScanSearch size={14} className={busyAction === 'validate' ? 'animate-pulse' : ''} />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={busy}
            title="Refresh"
            aria-label="Refresh"
            className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-950 p-1.5 text-gray-200 hover:bg-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busyAction === 'refresh' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950/50">
        <div className="w-full min-w-max">
          <div
            className="grid w-full min-w-max items-stretch border-b border-gray-800 text-xs font-semibold"
            style={{ gridTemplateColumns }}
            onContextMenu={openColumnsMenu}
          >
            <label
              className="inline-flex h-full min-h-[2.75rem] items-center justify-center border-r border-gray-800 px-3"
              title="Right-click to choose columns"
            >
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someVisibleSelected && !allVisibleSelected;
                }}
                onChange={toggleSelectAllVisible}
                className="accent-blue-500"
                aria-label="Select all visible files"
              />
            </label>
            {visibleColumns.map((column, columnIndex) => (
              <HeaderCell
                key={column.key}
                column={column}
                isLast={columnIndex === visibleColumns.length - 1}
                currentKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                width={columnWidths[column.key] || column.defaultWidth}
                onResize={resizeColumn}
                onResizeStart={() => setIsResizing(true)}
                onResizeEnd={() => setIsResizing(false)}
                onMoveColumn={moveColumn}
                draggingKey={draggingKey}
                dropTargetKey={dropTargetKey}
                onDragState={(next) => {
                  if (Object.prototype.hasOwnProperty.call(next, 'draggingKey')) {
                    setDraggingKey(next.draggingKey);
                  }
                  if (Object.prototype.hasOwnProperty.call(next, 'dropTargetKey')) {
                    setDropTargetKey(next.dropTargetKey);
                  }
                }}
              />
            ))}
          </div>
          {filteredItems.map((item, index) => {
            const selected = selectedIds.has(item.id);
            const striped = index % 2 === 1;
            const rowTone = selected
              ? 'bg-blue-950/35'
              : item.status === 'quarantine'
                ? (striped ? 'bg-red-900/45 hover:bg-red-900/60' : 'bg-red-900/30 hover:bg-red-900/45')
                : (striped ? 'bg-gray-800/20 hover:bg-gray-800/50' : 'hover:bg-gray-900/50');
            return (
              <div
                key={item.id}
                className={`grid w-full min-w-max items-stretch border-b border-gray-800 ${rowTone}`}
                style={{ gridTemplateColumns }}
              >
                <label className="inline-flex items-center justify-center border-r border-gray-800 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(item.id)}
                    className="accent-blue-500"
                    aria-label={`Select ${item.fileName}`}
                  />
                </label>
                {visibleColumns.map((column, columnIndex) => (
                  <div
                    key={column.key}
                    className={`min-w-0 whitespace-nowrap px-3 py-2 ${
                      columnIndex === visibleColumns.length - 1 ? '' : 'border-r border-gray-800'
                    }`}
                  >
                    {renderStorageCell(column, item)}
                  </div>
                ))}
              </div>
            );
          })}
          {!filteredItems.length ? (
            <div className="px-4 py-6 text-sm text-gray-400">
              No media matches the current filters.
            </div>
          ) : null}
        </div>
      </div>

      {isResizing ? createPortal(
        <div className="fixed inset-0 z-[80] cursor-col-resize" />,
        document.body
      ) : null}

      {columnsMenu ? createPortal(
        <div
          ref={columnsMenuRef}
          className="fixed z-[70] w-56 rounded-xl border border-gray-700 bg-gray-900 p-2 shadow-2xl"
          style={{ left: Math.max(8, columnsMenu.x), top: Math.max(8, columnsMenu.y) }}
        >
          {TABLE_COLUMNS.map((column) => (
            <label
              key={column.key}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                column.required ? 'text-gray-500' : 'text-gray-200 hover:bg-gray-800'
              }`}
            >
              <input
                type="checkbox"
                checked={column.required || visibleColumnKeys.has(column.key)}
                disabled={column.required}
                onChange={() => toggleColumn(column.key)}
                className="accent-blue-500"
              />
              {column.label}
            </label>
          ))}
        </div>,
        document.body
      ) : null}

      {toast?.message ? (
        <FloatingToast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDone={() => setToast((current) => (current?.id === toast.id ? null : current))}
        />
      ) : null}

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
