import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, AlertTriangle, Sparkles, X, CheckCircle } from 'lucide-react';
import { applyUpdate, isNativePlatform, subscribeVersionStatus } from '../lib/versionManager';
import { isStandaloneApp } from '../utils/platform';
import { AndroidIcon, ApolloLogoIcon } from './icons/PlatformIcons';

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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      >
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/40 bg-gray-900 p-6 shadow-2xl shadow-amber-950/50 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
            {isNativeUpdateRequired ? <AndroidIcon size={32} /> : <AlertTriangle size={32} />}
          </div>

          <span className="inline-block rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-red-400 border border-red-500/30 mb-2">
            Update Required
          </span>

          <h2 id="force-update-title" className="text-xl font-bold text-white mb-2">
            New Version of Apollo
          </h2>

          <p className="text-sm text-gray-300 mb-4 leading-relaxed">
            Your current client version (<span className="font-mono text-amber-400">v{clientVersion}</span>) is outdated and no longer supported. Please update to <span className="font-mono text-green-400">v{serverVersion}</span> to continue using Apollo.
          </p>

          {releaseNotes ? (
            <div className="mb-5 rounded-lg border border-gray-800 bg-gray-950/70 p-3 text-left text-xs text-gray-400">
              <span className="font-semibold text-gray-300 block mb-1">What's New:</span>
              <p>{releaseNotes}</p>
            </div>
          ) : null}

          {isNativeUpdateRequired ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-3 text-sm font-semibold text-black hover:from-amber-400 hover:to-amber-500 shadow-lg shadow-amber-600/30 transition-all disabled:opacity-50"
              >
                <Download size={18} />
                {isUpdating ? 'Downloading APK...' : `Download APK Update (v${serverVersion})`}
              </button>
              <p className="text-xs text-gray-400">
                A native Android app update is required. Tap the notification to install the update over your current app.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-3 text-sm font-semibold text-black hover:from-amber-400 hover:to-amber-500 shadow-lg shadow-amber-600/30 transition-all disabled:opacity-50"
              >
                <RefreshCw size={18} className={isUpdating ? 'animate-spin' : ''} />
                {isUpdating ? 'Updating Apollo...' : 'Update Apollo Now'}
              </button>
              <p className="text-xs text-gray-400">
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
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-xl border border-amber-500/30 bg-gray-900/95 p-4 shadow-xl shadow-black/60 backdrop-blur-md animate-in slide-in-from-bottom duration-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-white">Update Available</h4>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono text-amber-300 border border-amber-500/30">
              v{serverVersion}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-300 leading-normal">
            A new version of Apollo is ready to install.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isUpdating}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50"
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
              className="rounded-lg border border-gray-700 bg-gray-800/80 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissedSoftUpdate(true)}
          className="text-gray-400 hover:text-white"
          aria-label="Dismiss notification"
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
