import { useEffect, useState } from 'react';
import '../styles/player-theme.css';
import { updateMyProfile } from '../lib/serverApi';

function getCurrentArtistDisplayName(session) {
  return String(
    session?.user?.artistDisplayName
    || session?.user?.oidcDisplayName
    || session?.user?.username
    || ''
  );
}

export default function ProfileDialog({
  open = false,
  session = null,
  onClose = null,
  onSaved = null,
}) {
  const [artistDisplayName, setArtistDisplayName] = useState('');
  const [artistDescription, setArtistDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setArtistDisplayName(getCurrentArtistDisplayName(session));
    setArtistDescription(session?.user?.artistDescription || '');
    setError('');
  }, [
    open,
    session?.user?.artistDisplayName,
    session?.user?.artistDescription,
    session?.user?.oidcDisplayName,
    session?.user?.username,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const nextSession = await updateMyProfile({ artistDisplayName, artistDescription }, session);
      onSaved?.(nextSession);
      onClose?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="player-theme fixed inset-0 z-[120] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4"
      data-player-theme="dark-gold"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close profile"
        onClick={() => {
          if (!saving) onClose?.();
        }}
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]"
      >
        <div className="player-hero-surface border-b border-[var(--player-border-subtle)] px-6 py-4">
          <h2 className="text-lg font-bold tracking-tight text-[var(--player-text-primary)]">My Profile</h2>
        </div>

        <div className="p-6">
          <label className="block text-sm font-medium text-[var(--player-text-secondary)]" htmlFor="artist-display-name">
            Artist Display Name
          </label>
          <input
            id="artist-display-name"
            type="text"
            value={artistDisplayName}
            maxLength={120}
            onChange={(event) => setArtistDisplayName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3.5 py-2.5 text-sm text-[var(--player-text-primary)] outline-none transition-colors placeholder:text-[var(--player-text-muted)] focus:border-[var(--player-accent-border)] focus:ring-1 focus:ring-[var(--player-focus-ring)]"
            placeholder="Optional artist name"
            autoFocus
          />
          <div className="mt-1 text-right text-xs tabular-nums text-[var(--player-text-muted)]">
            {artistDisplayName.length}/120
          </div>

          <label className="mt-4 block text-sm font-medium text-[var(--player-text-secondary)]" htmlFor="artist-description">
            Artist Description
          </label>
          <textarea
            id="artist-description"
            value={artistDescription}
            maxLength={2000}
            rows={4}
            onChange={(event) => setArtistDescription(event.target.value)}
            className="mt-2 w-full resize-none rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-popover)] px-3.5 py-2.5 text-sm text-[var(--player-text-primary)] outline-none transition-colors placeholder:text-[var(--player-text-muted)] focus:border-[var(--player-accent-border)] focus:ring-1 focus:ring-[var(--player-focus-ring)]"
            placeholder="Optional artist bio"
          />
          <div className="mt-1 text-right text-xs tabular-nums text-[var(--player-text-muted)]">
            {artistDescription.length}/2000
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-3.5 py-2.5 text-sm text-[var(--player-danger-text)]">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--player-text-primary)] transition-colors hover:bg-[var(--player-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] transition-colors hover:bg-[var(--player-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
