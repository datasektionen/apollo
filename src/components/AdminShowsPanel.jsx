import { useEffect, useRef, useState } from 'react';
import { GripVertical, Loader2 } from 'lucide-react';
import {
  getAdminShowsConfig,
  reorderAdminShows,
  saveAdminShowsConfig,
} from '../lib/serverApi';

const DEFAULT_NO_ACCESS_MESSAGE = 'You do not currently have any permissions. Please contact an admin if you should.';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeShowId(value) {
  return normalizeText(value);
}

function normalizeSettings(settings = {}, firstShowId = '') {
  const noAccessMessage = normalizeText(settings.noAccessMessage) || DEFAULT_NO_ACCESS_MESSAGE;
  const defaultShowId = normalizeShowId(settings.defaultShowId) || normalizeShowId(firstShowId);
  return {
    defaultShowId,
    splitPlayerDawDefaults: settings.splitPlayerDawDefaults === true,
    playerDefaultShowId: normalizeShowId(settings.playerDefaultShowId) || defaultShowId,
    dawDefaultShowId: normalizeShowId(settings.dawDefaultShowId) || defaultShowId,
    noAccessMessage,
    playerNoAccessMessage: normalizeText(settings.playerNoAccessMessage) || noAccessMessage,
    dawNoAccessMessage: normalizeText(settings.dawNoAccessMessage) || noAccessMessage,
  };
}

function Panel({ title, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)]">
      {title ? (
        <div className="border-b border-[var(--player-border-subtle)] px-4 py-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">{title}</h3>
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

function ShowSelect({ label, value, shows, onChange }) {
  return (
    <label className="block space-y-2">
      <div className="pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-text-muted)]">{label}</div>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] outline-none transition-colors focus:border-[var(--player-accent-border)] focus:ring-1 focus:ring-[var(--player-focus-ring)]"
      >
        {shows.map((show) => (
          <option key={show.id} value={show.id}>
            {show.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MessageField({ label, value, onChange, onBlur, disabled = false }) {
  return (
    <label className="block space-y-2">
      <div className="pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-text-muted)]">{label}</div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
        rows={2}
        maxLength={4000}
        className="w-full rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3 py-2 text-sm text-[var(--player-text-primary)] outline-none transition-colors focus:border-[var(--player-accent-border)] focus:ring-1 focus:ring-[var(--player-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

export default function AdminShowsPanel({
  session = null,
  onSessionRefresh = null,
}) {
  const [shows, setShows] = useState([]);
  const [settings, setSettings] = useState(normalizeSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const savedSettingsRef = useRef(null);
  const settingsRef = useRef(settings);
  const saveSeqRef = useRef(0);
  settingsRef.current = settings;
  const hasPublicShow = shows.some((show) => Number(show.publishedProjectCount || 0) > 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getAdminShowsConfig(session)
      .then((payload) => {
        if (cancelled) return;
        const nextShows = Array.isArray(payload?.shows) ? payload.shows : [];
        const normalized = normalizeSettings(payload?.settings, nextShows[0]?.id);
        setShows(nextShows);
        setSettings(normalized);
        savedSettingsRef.current = normalized;
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load show configuration.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const persistSettings = async (next) => {
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    setSaving(true);
    setError('');
    try {
      const payload = await saveAdminShowsConfig({
        defaultShowId: next.defaultShowId || shows[0]?.id || null,
        splitPlayerDawDefaults: next.splitPlayerDawDefaults,
        playerDefaultShowId: next.playerDefaultShowId || shows[0]?.id || null,
        dawDefaultShowId: next.dawDefaultShowId || shows[0]?.id || null,
        noAccessMessage: next.noAccessMessage,
        playerNoAccessMessage: next.playerNoAccessMessage,
        dawNoAccessMessage: next.dawNoAccessMessage,
      }, session);
      if (seq !== saveSeqRef.current) return;
      const nextShows = Array.isArray(payload?.shows) ? payload.shows : shows;
      const normalized = normalizeSettings(payload?.settings, nextShows[0]?.id);
      setShows(nextShows);
      setSettings(normalized);
      savedSettingsRef.current = normalized;
      await onSessionRefresh?.();
    } catch (saveError) {
      if (seq !== saveSeqRef.current) return;
      setError(saveError.message || 'Failed to save show settings.');
      if (savedSettingsRef.current) setSettings(savedSettingsRef.current);
    } finally {
      if (seq === saveSeqRef.current) setSaving(false);
    }
  };

  const commitSettings = (next) => {
    setSettings(next);
    if (savedSettingsRef.current && JSON.stringify(savedSettingsRef.current) === JSON.stringify(next)) return;
    persistSettings(next);
  };

  useEffect(() => () => {
    const next = settingsRef.current;
    const saved = savedSettingsRef.current;
    if (!saved || JSON.stringify(saved) === JSON.stringify(next)) return;
    saveAdminShowsConfig({
      defaultShowId: next.defaultShowId || null,
      splitPlayerDawDefaults: next.splitPlayerDawDefaults,
      playerDefaultShowId: next.playerDefaultShowId || null,
      dawDefaultShowId: next.dawDefaultShowId || null,
      noAccessMessage: next.noAccessMessage,
      playerNoAccessMessage: next.playerNoAccessMessage,
      dawNoAccessMessage: next.dawNoAccessMessage,
    }, session).catch(() => {});
  }, [session]);

  const handleDrop = async (event, targetIndex) => {
    event.preventDefault();
    const sourceIndex = dragIndex;
    setDragIndex(null);
    if (
      sourceIndex === null
      || sourceIndex === targetIndex
      || sourceIndex < 0
      || sourceIndex >= shows.length
    ) {
      return;
    }

    const previousShows = shows;
    const nextShows = [...shows];
    const [movedShow] = nextShows.splice(sourceIndex, 1);
    nextShows.splice(targetIndex, 0, movedShow);
    setShows(nextShows);
    setSaving(true);
    setError('');
    try {
      const payload = await reorderAdminShows(nextShows.map((show) => show.id), session);
      setShows(Array.isArray(payload?.shows) ? payload.shows : nextShows);
      await onSessionRefresh?.();
    } catch (orderError) {
      setShows(previousShows);
      setError(orderError.message || 'Failed to save show order.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-6xl items-center justify-center py-16 text-sm text-[var(--player-text-secondary)]">
        <Loader2 size={18} className="mr-2 animate-spin text-[var(--player-accent-text)]" />
        Loading show settings...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {error ? (
        <div className="rounded-xl border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-4 py-3 text-sm text-[var(--player-danger-text)]">
          {error}
        </div>
      ) : null}

      <Panel title="General show index">
        {shows.length ? (
          <div className="overflow-hidden rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)]">
            {shows.map((show, index) => (
              <div
                key={show.id}
                draggable={!saving}
                onDragStart={(event) => {
                  if (saving) return;
                  event.dataTransfer.effectAllowed = 'move';
                  setDragIndex(index);
                }}
                onDragOver={(event) => {
                  if (dragIndex === null || saving) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => handleDrop(event, index)}
                onDragEnd={() => setDragIndex(null)}
                className={`flex items-center gap-3 border-b border-[var(--player-border-subtle)] px-3.5 py-3 last:border-b-0 transition-colors ${
                  dragIndex === index ? 'opacity-40' : 'hover:bg-[var(--player-hover)]'
                }`}
              >
                <GripVertical size={17} className="shrink-0 cursor-grab text-[var(--player-text-muted)]" />
                <span className="w-6 shrink-0 text-sm font-mono tabular-nums text-[var(--player-text-muted)]">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--player-text-primary)]">{show.name}</div>
                  <div className="mt-0.5 text-xs text-[var(--player-text-muted)]">
                    {show.projectCount || 0} musical number{show.projectCount === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No shows have been created yet.</Empty>
        )}
      </Panel>

      <Panel title="Landing defaults">
        <div className="space-y-4">
          {hasPublicShow ? (
            <div className="rounded-lg border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] px-3.5 py-3 text-sm text-[var(--player-text-muted)]">
              No-access messages are disabled because at least one published musical number is available to every user.
            </div>
          ) : null}

          <div className="rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={settings.splitPlayerDawDefaults}
                onChange={(event) => {
                  const split = event.target.checked;
                  commitSettings({
                    ...settings,
                    splitPlayerDawDefaults: split,
                    playerDefaultShowId: split
                      ? settings.defaultShowId
                      : settings.playerDefaultShowId,
                    dawDefaultShowId: split
                      ? settings.defaultShowId
                      : settings.dawDefaultShowId,
                    playerNoAccessMessage: split
                      ? settings.noAccessMessage
                      : settings.playerNoAccessMessage,
                    dawNoAccessMessage: split
                      ? settings.noAccessMessage
                      : settings.dawNoAccessMessage,
                  });
                }}
                className="mt-0.5 h-4 w-4 rounded border-[var(--player-border-default)] bg-[var(--player-bg-popover)]"
              />
              <span
                title="Use a different default show and no-access message for Player and DAW."
                className="block text-sm font-semibold text-[var(--player-text-primary)]"
              >
                Use separate defaults
              </span>
            </label>

            {settings.splitPlayerDawDefaults ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[var(--player-text-primary)]">Player</div>
                  <ShowSelect
                    label="Default show"
                    value={settings.playerDefaultShowId}
                    shows={shows}
                    onChange={(value) => commitSettings({ ...settings, playerDefaultShowId: value })}
                  />
                  <MessageField
                    label="No-access message"
                    value={settings.playerNoAccessMessage}
                    disabled={hasPublicShow}
                    onChange={(value) => setSettings((current) => ({ ...current, playerNoAccessMessage: value }))}
                    onBlur={(value) => commitSettings({ ...settingsRef.current, playerNoAccessMessage: value })}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[var(--player-text-primary)]">DAW</div>
                  <ShowSelect
                    label="Default show"
                    value={settings.dawDefaultShowId}
                    shows={shows}
                    onChange={(value) => commitSettings({ ...settings, dawDefaultShowId: value })}
                  />
                  <MessageField
                    label="No-access message"
                    value={settings.dawNoAccessMessage}
                    disabled={hasPublicShow}
                    onChange={(value) => setSettings((current) => ({ ...current, dawNoAccessMessage: value }))}
                    onBlur={(value) => commitSettings({ ...settingsRef.current, dawNoAccessMessage: value })}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-1">
                <ShowSelect
                  label="Default show"
                  value={settings.defaultShowId}
                  shows={shows}
                  onChange={(value) => commitSettings({ ...settings, defaultShowId: value })}
                />
                <MessageField
                  label="No-access message"
                  value={settings.noAccessMessage}
                  disabled={hasPublicShow}
                  onChange={(value) => setSettings((current) => ({ ...current, noAccessMessage: value }))}
                  onBlur={(value) => commitSettings({ ...settingsRef.current, noAccessMessage: value })}
                />
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
