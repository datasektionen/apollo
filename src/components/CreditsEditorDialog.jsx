import { useEffect, useMemo, useRef, useState } from 'react';
import { createGuestArtist, createMusicGroup, fetchArtistCatalog } from '../lib/serverApi';

const ARTIST_CATALOG_LOAD_TIMEOUT_MS = 12000;

function artistKey(ref) {
  return `${ref?.type || ''}:${ref?.id || ''}`;
}

function normalizeRefs(refs) {
  const seen = new Set();
  return (Array.isArray(refs) ? refs : []).map((ref) => ({
    type: String(ref?.type || '').trim(),
    id: String(ref?.id || '').trim(),
  })).filter((ref) => {
    const key = artistKey(ref);
    if (!ref.type || !ref.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ArtistRefsInput({ label, refs, catalog, onChange }) {
  const artistOptions = catalog?.artistOptions || [];
  const selectedKeys = new Set(normalizeRefs(refs).map(artistKey));
  const [selectedKey, setSelectedKey] = useState('');
  const byKey = new Map(artistOptions.map((artist) => [artistKey(artist), artist]));

  const addSelected = () => {
    const artist = byKey.get(selectedKey);
    if (!artist) return;
    onChange(normalizeRefs([...refs, { type: artist.type, id: artist.id }]));
    setSelectedKey('');
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-[var(--player-text-primary)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {normalizeRefs(refs).map((ref) => {
          const artist = byKey.get(artistKey(ref));
          return (
            <span
              key={artistKey(ref)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--player-text-primary)]"
            >
              {artist?.name || artistKey(ref)}
              <button
                type="button"
                onClick={() => onChange(normalizeRefs(refs).filter((candidate) => artistKey(candidate) !== artistKey(ref)))}
                className="text-[var(--player-text-muted)] hover:text-[var(--player-text-primary)]"
              >
                x
              </button>
            </span>
          );
        })}
        {!normalizeRefs(refs).length ? <span className="text-sm text-[var(--player-text-muted)]">No artists selected.</span> : null}
      </div>
      <div className="flex gap-2">
        <select
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-3 py-2 text-sm text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
        >
          <option value="">Add artist...</option>
          {artistOptions.map((artist) => (
            <option key={artistKey(artist)} value={artistKey(artist)} disabled={selectedKeys.has(artistKey(artist))}>
              {artist.name} ({artist.type})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addSelected}
          disabled={!selectedKey}
          className="rounded-lg bg-[var(--player-accent)] px-3.5 py-2 text-sm font-semibold text-[var(--player-accent-foreground)] hover:bg-[var(--player-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function flattenCreditRows(entries = []) {
  return entries.flatMap((entry) => normalizeRefs(entry.artists).map((artist) => ({
    id: `${entry.roleKey}:${artistKey(artist)}`,
    roleKey: entry.roleKey,
    artist,
  })));
}

function buildCreditEntries(rows) {
  const byRole = new Map();
  rows.forEach((row) => {
    if (!row.roleKey || !row.artist?.id) return;
    if (!byRole.has(row.roleKey)) byRole.set(row.roleKey, []);
    byRole.get(row.roleKey).push(row.artist);
  });
  return Array.from(byRole.entries()).map(([roleKey, artists]) => ({
    roleKey,
    artists: normalizeRefs(artists),
  })).filter((entry) => entry.artists.length);
}

export default function CreditsEditorDialog({
  open = false,
  mode = 'track',
  title = 'Credits',
  session = null,
  initialDescription = '',
  initialProducerRefs = [],
  initialArtistRefs = [],
  initialCredits = null,
  creditRoleOptions = null,
  resetKey = '',
  onSave,
  onClose,
}) {
  const [catalog, setCatalog] = useState({ artistOptions: [], creditRoleOptions: {} });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [producerRefs, setProducerRefs] = useState([]);
  const [artistRefs, setArtistRefs] = useState([]);
  const [creditRows, setCreditRows] = useState({
    artist: [],
    compositionLyrics: [],
    productionEngineering: [],
  });
  const [pendingRoleByCategory, setPendingRoleByCategory] = useState({});
  const [pendingArtistByCategory, setPendingArtistByCategory] = useState({});
  const catalogRequestIdRef = useRef(0);
  const initializedKeyRef = useRef('');

  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = '';
      return;
    }
    const nextInitializedKey = String(resetKey || `${mode}:${title}`);
    if (initializedKeyRef.current === nextInitializedKey) return;
    initializedKeyRef.current = nextInitializedKey;
    setDescription(initialDescription || '');
    setProducerRefs(normalizeRefs(initialProducerRefs));
    setArtistRefs(normalizeRefs(initialArtistRefs));
    setCreditRows({
      artist: flattenCreditRows(initialCredits?.artist || []),
      compositionLyrics: flattenCreditRows(initialCredits?.compositionLyrics || []),
      productionEngineering: flattenCreditRows(initialCredits?.productionEngineering || []),
    });
    setError('');
    setPendingRoleByCategory({});
    setPendingArtistByCategory({});
  }, [open, resetKey, mode, title, initialArtistRefs, initialCredits, initialDescription, initialProducerRefs]);

  useEffect(() => {
    if (!open) return undefined;
    const requestId = catalogRequestIdRef.current + 1;
    catalogRequestIdRef.current = requestId;
    let timeoutId = null;
    let cancelled = false;

    setLoading(true);
    Promise.race([
      fetchArtistCatalog(session),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Loading artists timed out. Please try again.'));
        }, ARTIST_CATALOG_LOAD_TIMEOUT_MS);
      }),
    ])
      .then((payload) => {
        if (cancelled || catalogRequestIdRef.current !== requestId) return;
        setCatalog(payload || { artistOptions: [], creditRoleOptions: {} });
      })
      .catch((loadError) => {
        if (cancelled || catalogRequestIdRef.current !== requestId) return;
        setCatalog({ artistOptions: [], creditRoleOptions: {} });
        setError(loadError.message || 'Failed to load artists');
      })
      .finally(() => {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (!cancelled && catalogRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [open, session?.accessToken]);

  const effectiveRoleOptions = creditRoleOptions || catalog.creditRoleOptions || {};
  const artistByKey = useMemo(() => new Map((catalog.artistOptions || []).map((artist) => [artistKey(artist), artist])), [catalog.artistOptions]);

  if (!open) return null;

  const handleCreateArtist = async (type) => {
    const name = window.prompt(type === 'group' ? 'Music group name' : 'Guest artist name', '');
    if (!name?.trim()) return;
    const groupType = type === 'group'
      ? window.prompt('Music group type, for example choir or symphony orchestra', '')?.trim()
      : '';
    try {
      const created = type === 'group'
        ? await createMusicGroup({ name: name.trim(), groupType }, session)
        : await createGuestArtist({ name: name.trim() }, session);
      const nextCatalog = await fetchArtistCatalog(session);
      setCatalog(nextCatalog || catalog);
      return created;
    } catch (createError) {
      setError(createError.message || 'Failed to create artist');
      return null;
    }
  };

  const addCreditRow = (category) => {
    const roleKey = pendingRoleByCategory[category] || '';
    const selectedArtistKey = pendingArtistByCategory[category] || '';
    const artist = artistByKey.get(selectedArtistKey);
    if (!roleKey || !artist) return;
    setCreditRows((current) => ({
      ...current,
      [category]: [
        ...current[category],
        {
          id: `${roleKey}:${artistKey(artist)}:${Date.now()}`,
          roleKey,
          artist: { type: artist.type, id: artist.id },
        },
      ],
    }));
    setPendingArtistByCategory((current) => ({ ...current, [category]: '' }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      if (mode === 'show') {
        await onSave?.({ description, producers: producerRefs });
      } else if (mode === 'project') {
        await onSave?.({
          artist: buildCreditEntries(creditRows.artist),
          compositionLyrics: buildCreditEntries(creditRows.compositionLyrics),
          productionEngineering: buildCreditEntries(creditRows.productionEngineering),
          performers: initialCredits?.performers || [],
        });
      } else {
        await onSave?.(artistRefs);
      }
      onClose?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save credits');
    } finally {
      setSaving(false);
    }
  };

  const renderCreditCategory = (category, label) => {
    const options = effectiveRoleOptions[category] || [];
    return (
      <section className="space-y-3 rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] p-3.5">
        <div className="text-sm font-semibold text-[var(--player-text-primary)]">{label}</div>
        <div className="space-y-2">
          {(creditRows[category] || []).map((row) => {
            const artist = artistByKey.get(artistKey(row.artist));
            const role = options.find((option) => option.key === row.roleKey);
            return (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--player-text-primary)]">
                  <span className="font-medium">{role?.label || row.roleKey}</span>
                  <span className="text-[var(--player-text-muted)]"> · </span>
                  {artist?.name || artistKey(row.artist)}
                </span>
                <button
                  type="button"
                  onClick={() => setCreditRows((current) => ({
                    ...current,
                    [category]: current[category].filter((candidate) => candidate.id !== row.id),
                  }))}
                  className="text-xs text-[var(--player-text-muted)] hover:text-[var(--player-danger)]"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
          <select
            value={pendingRoleByCategory[category] || ''}
            onChange={(event) => setPendingRoleByCategory((current) => ({ ...current, [category]: event.target.value }))}
            className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-3 py-2 text-sm text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
          >
            <option value="">Role...</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <select
            value={pendingArtistByCategory[category] || ''}
            onChange={(event) => setPendingArtistByCategory((current) => ({ ...current, [category]: event.target.value }))}
            className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-3 py-2 text-sm text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
          >
            <option value="">Artist...</option>
            {(catalog.artistOptions || []).map((artist) => (
              <option key={artistKey(artist)} value={artistKey(artist)}>{artist.name} ({artist.type})</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => addCreditRow(category)}
            className="rounded-lg bg-[var(--player-accent)] px-3.5 py-2 text-sm font-semibold text-[var(--player-accent-foreground)] hover:bg-[var(--player-accent-hover)] transition-colors"
          >
            Add
          </button>
        </div>
      </section>
    );
  };

  return (
    <div
      className="player-theme fixed inset-0 z-[80] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4"
      data-player-theme="dark-gold"
    >
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close credits editor" />
      <div className="relative max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--player-border-strong)] bg-[var(--player-bg-surface)] text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--player-border-subtle)] px-5 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-sm text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors">
            Close
          </button>
        </div>
        <div className="max-h-[calc(88vh-132px)] overflow-auto space-y-4 px-5 py-4">
          {loading ? <div className="py-8 text-center text-sm text-[var(--player-text-muted)]">Loading artists...</div> : null}
          {error ? <div className="rounded-lg border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-3 py-2 text-sm text-[var(--player-danger-text)]">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => handleCreateArtist('group')} className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors">
              New music group
            </button>
            <button type="button" onClick={() => handleCreateArtist('guest')} className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors">
              New guest artist
            </button>
          </div>

          {mode === 'show' ? (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--player-text-primary)]">Show description</span>
                <textarea
                  value={description}
                  rows={4}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full resize-none rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-3 py-2 text-sm text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
                />
              </label>
              <ArtistRefsInput label="Producer" refs={producerRefs} catalog={catalog} onChange={setProducerRefs} />
            </>
          ) : null}

          {mode === 'track' ? (
            <ArtistRefsInput label="Track artist" refs={artistRefs} catalog={catalog} onChange={setArtistRefs} />
          ) : null}

          {mode === 'project' ? (
            <>
              {renderCreditCategory('artist', 'Artist')}
              {renderCreditCategory('compositionLyrics', 'Composition & Lyrics')}
              {renderCreditCategory('productionEngineering', 'Production & Engineering')}
            </>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--player-border-subtle)] px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-4 py-2 text-sm text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="player-play-cta rounded-lg px-4 py-2 text-sm font-semibold">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
