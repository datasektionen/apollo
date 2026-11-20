import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, AlertTriangle, Sparkles, X } from 'lucide-react';
import '../styles/player-theme.css';
import { applyUpdate, isNativePlatform, subscribeVersionStatus } from '../lib/versionManager';
import { isStandaloneApp } from '../utils/platform';
import { AndroidIcon } from './icons/PlatformIcons';

export default function UpdateNotificationModal() {
  const [versionState, setVersionState] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [dismissedSoftUpdate, setDismissedSoftUpdate] = useState(false);

  useEffect(() => {
    return subscribeVersionStatus((state) => {
      setVersionState(state);
    });
  }, []);

  if (!versionState || !versionState.isUpdateAvailable) {
    return null;
  }

  const isNative = isNativePlatform();
  const isStandalone = isStandaloneApp();
  const { isForceUpdate, isNativeUpdateRequired, clientVersion, serverVersion, apkUrl, releaseNotes } = versionState;

  // On regular web browsers, do not show soft update notifications.
  // Web visitors should never see "Update Available: ready to install";
  // they only see a modal if a hard force upgrade (HTTP 426) is required by the API.
  if (!isStandalone && !isForceUpdate) {
    return null;
  }

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await applyUpdate();
    } catch (err) {
      console.error('[Update] Update execution failed:', err);
      setIsUpdating(false);
    }
  };

  // Hard blocking update modal (Force Update)
  if (isForceUpdate) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="force-update-title"
        className="player-theme fixed inset-0 z-[130] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-md p-4"
        data-player-theme="dark-gold"
      >
        <div className="player-hero-surface relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--player-accent-border)] bg-[var(--player-bg-surface)] p-6 shadow-[var(--player-shadow-popover)] text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]">
            {isNativeUpdateRequired ? <AndroidIcon size={32} /> : <AlertTriangle size={32} />}
          </div>

          <span className="inline-block rounded-full border border-[var(--player-danger-border)] bg-[var(--player-danger-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--player-danger-text)] mb-2">
            Update Required
          </span>

          <h2 id="force-update-title" className="text-xl font-bold tracking-tight text-[var(--player-text-primary)] mb-2">
            New Version of Apollo
          </h2>

          <p className="text-sm text-[var(--player-text-secondary)] mb-4 leading-relaxed">
            Your current client version (<span className="font-mono text-[var(--player-accent-text)]">v{clientVersion}</span>) is outdated and no longer supported. Please update to <span className="font-mono text-[var(--player-success)]">v{serverVersion}</span> to continue using Apollo.
          </p>

          {releaseNotes ? (
            <div className="mb-5 rounded-xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] p-3 text-left text-xs text-[var(--player-text-secondary)]">
              <span className="font-semibold text-[var(--player-text-primary)] block mb-1">What's New:</span>
              <p>{releaseNotes}</p>
            </div>
          ) : null}

          {isNativeUpdateRequired ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--player-accent)] hover:bg-[var(--player-accent-hover)] px-5 py-3 text-sm font-bold text-[var(--player-accent-foreground)] shadow-[var(--player-shadow-accent)] transition-colors disabled:opacity-50"
              >
                <Download size={18} />
                {isUpdating ? 'Downloading APK...' : `Download APK Update (v${serverVersion})`}
              </button>
              <p className="text-xs text-[var(--player-text-muted)]">
                A native Android app update is required. Tap the notification to install the update over your current app.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--player-accent)] hover:bg-[var(--player-accent-hover)] px-5 py-3 text-sm font-bold text-[var(--player-accent-foreground)] shadow-[var(--player-shadow-accent)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={isUpdating ? 'animate-spin' : ''} />
                {isUpdating ? 'Updating Apollo...' : 'Update Apollo Now'}
              </button>
              <p className="text-xs text-[var(--player-text-muted)]">
                Instantly applies the latest updates over the air.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Soft update notification (Non-blocking banner)
  if (dismissedSoftUpdate) {
    return null;
  }

  return (
    <aside
      aria-label="Software update notification"
      className="player-theme fixed bottom-4 right-4 z-[110] max-w-sm rounded-2xl border border-[var(--player-accent-border)] bg-[var(--player-bg-popover)] p-4 shadow-[var(--player-shadow-popover)] backdrop-blur-md animate-in slide-in-from-bottom duration-300"
      data-player-theme="dark-gold"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-[var(--player-text-primary)]">Update Available</h4>
            <span className="rounded border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--player-accent-text)]">
              v{serverVersion}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--player-text-secondary)] leading-normal">
            A new version of Apollo is ready to install.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isUpdating}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--player-accent)] hover:bg-[var(--player-accent-hover)] px-3 py-1.5 text-xs font-bold text-[var(--player-accent-foreground)] transition-colors disabled:opacity-50"
            >
              {isNativeUpdateRequired ? (
                <Download size={13} />
              ) : (
                <RefreshCw size={13} className={isUpdating ? 'animate-spin' : ''} />
              )}
              {isUpdating
                ? 'Updating...'
                : isNativeUpdateRequired
                ? 'Download APK'
                : 'Update Now'}
            </button>
            <button
              type="button"
              onClick={() => setDismissedSoftUpdate(true)}
              className="rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--player-text-secondary)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissedSoftUpdate(true)}
          className="text-[var(--player-text-muted)] hover:text-[var(--player-text-primary)]"
          aria-label="Dismiss notification"
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
