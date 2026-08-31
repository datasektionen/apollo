import { useEffect, useState } from 'react';
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
    <section className="rounded-xl border border-gray-700 bg-gray-900/40">
      {title ? (
        <div className="border-b border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">{title}</h3>
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

function ShowSelect({ label, value, shows, onChange }) {
  return (
    <label className="block space-y-2">
      <div className="pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
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

function MessageField({ label, value, onChange, disabled = false }) {
  return (
    <label className="block space-y-2">
      <div className="pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={4000}
        className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
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
  const hasPublicShow = shows.some((show) => Number(show.publishedProjectCount || 0) > 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getAdminShowsConfig(session)
      .then((payload) => {
        if (cancelled) return;
        const nextShows = Array.isArray(payload?.shows) ? payload.shows : [];
        setShows(nextShows);
        setSettings(normalizeSettings(payload?.settings, nextShows[0]?.id));
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

  const handleSaveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = await saveAdminShowsConfig({
        defaultShowId: settings.defaultShowId || shows[0]?.id || null,
        splitPlayerDawDefaults: settings.splitPlayerDawDefaults,
        playerDefaultShowId: settings.playerDefaultShowId || shows[0]?.id || null,
        dawDefaultShowId: settings.dawDefaultShowId || shows[0]?.id || null,
        noAccessMessage: settings.noAccessMessage,
        playerNoAccessMessage: settings.playerNoAccessMessage,
        dawNoAccessMessage: settings.dawNoAccessMessage,
      }, session);
      const nextShows = Array.isArray(payload?.shows) ? payload.shows : shows;
      setShows(nextShows);
      setSettings(normalizeSettings(payload?.settings, nextShows[0]?.id));
      await onSessionRefresh?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save show settings.');
    } finally {
      setSaving(false);
    }
  };

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
      <div className="mx-auto flex max-w-6xl items-center justify-center py-16 text-sm text-gray-400">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Loading show settings...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {error ? (
        <div className="rounded border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <Panel title="General show index">
        {shows.length ? (
          <div className="overflow-hidden rounded-lg border border-gray-800">
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
                className={`flex items-center gap-3 border-b border-gray-800 px-3 py-3 last:border-b-0 ${
                  dragIndex === index ? 'opacity-40' : 'hover:bg-gray-900/70'
                }`}
              >
                <GripVertical size={17} className="shrink-0 cursor-grab text-gray-500" />
                <span className="w-6 shrink-0 text-sm tabular-nums text-gray-500">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{show.name}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
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
            <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-3 text-sm text-gray-500">
              No-access messages are disabled because at least one published musical number is available to every user.
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings.splitPlayerDawDefaults}
                onChange={(event) => {
                  const split = event.target.checked;
                  setSettings((current) => ({
                    ...current,
                    splitPlayerDawDefaults: split,
                    playerDefaultShowId: split
                      ? current.defaultShowId
                      : current.playerDefaultShowId,
                    dawDefaultShowId: split
                      ? current.defaultShowId
                      : current.dawDefaultShowId,
                    playerNoAccessMessage: split
                      ? current.noAccessMessage
                      : current.playerNoAccessMessage,
                    dawNoAccessMessage: split
                      ? current.noAccessMessage
                      : current.dawNoAccessMessage,
                  }));
                }}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 accent-blue-600"
              />
              <span
                title="Use a different default show and no-access message for Player and DAW."
                className="block text-sm font-semibold text-gray-200"
              >
                Use separate defaults
              </span>
            </label>

            {settings.splitPlayerDawDefaults ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-gray-200">Player</div>
                  <ShowSelect
                    label="Default show"
                    value={settings.playerDefaultShowId}
                    shows={shows}
                    onChange={(value) => setSettings((current) => ({ ...current, playerDefaultShowId: value }))}
                  />
                  <MessageField
                    label="No-access message"
                    value={settings.playerNoAccessMessage}
                    disabled={hasPublicShow}
                    onChange={(value) => setSettings((current) => ({ ...current, playerNoAccessMessage: value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-gray-200">DAW</div>
                  <ShowSelect
                    label="Default show"
                    value={settings.dawDefaultShowId}
                    shows={shows}
                    onChange={(value) => setSettings((current) => ({ ...current, dawDefaultShowId: value }))}
                  />
                  <MessageField
                    label="No-access message"
                    value={settings.dawNoAccessMessage}
                    disabled={hasPublicShow}
                    onChange={(value) => setSettings((current) => ({ ...current, dawNoAccessMessage: value }))}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-1">
                <ShowSelect
                  label="Default show"
                  value={settings.defaultShowId}
                  shows={shows}
                  onChange={(value) => setSettings((current) => ({ ...current, defaultShowId: value }))}
                />
                <MessageField
                  label="No-access message"
                  value={settings.noAccessMessage}
                  disabled={hasPublicShow}
                  onChange={(value) => setSettings((current) => ({ ...current, noAccessMessage: value }))}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveSettings}
              className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
