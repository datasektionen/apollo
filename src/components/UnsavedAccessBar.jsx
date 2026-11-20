import { useEffect, useState } from 'react';

export function UnsavedAccessBar({
  open = false,
  attention = 0,
  saving = false,
  onDiscard,
  onSave,
}) {
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!open || !attention) return undefined;
    setShake(true);
    const timer = window.setTimeout(() => setShake(false), 450);
    return () => window.clearTimeout(timer);
  }, [attention, open]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-4 transition-transform duration-200 ease-out ${
        open ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
      aria-hidden={!open}
    >
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-xl border border-[var(--player-accent-border)] bg-[var(--player-bg-popover)] px-4 py-3 shadow-[var(--player-shadow-popover)] ${
          shake ? 'apollo-unsaved-shake' : ''
        }`}
      >
        <p className="text-sm font-semibold text-[var(--player-text-primary)]">You have unsaved access changes</p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!open || saving}
            onClick={onDiscard}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] disabled:opacity-50 transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!open || saving}
            onClick={onSave}
            className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] hover:bg-[var(--player-accent-hover)] disabled:opacity-45 transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
