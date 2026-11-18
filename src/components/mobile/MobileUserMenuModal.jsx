import React, { useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import {
  X,
  CircleUserRound,
  User,
  Settings,
  SlidersHorizontal,
  Shield,
  Download,
  LogOut,
  ChevronRight,
  Headphones,
} from 'lucide-react';
import { isStandaloneApp, isNativePlatform } from '../../utils/platform';
import { PlaybackDevicesSettingsPanel } from '../SettingsPanels';

const ApolloMedia = registerPlugin('ApolloMedia');

export function MobileUserMenuModal({
  isOpen,
  onClose,
  session,
  onOpenProfile,
  onSwitchToDawDashboard,
  onOpenAdmin,
  onLogout,
  // Audio settings
  audioSettings,
  setAudioSettings,
  audioInputs,
  audioOutputs,
  monoOutputActive,
  outputChannelCount,
  onRefreshAudioDevices,
}) {
  const [showSettingsView, setShowSettingsView] = useState(false);

  if (!isOpen) return null;

  const isStandalone = isStandaloneApp();
  const userEmail = session?.user?.email || '';
  const isAdmin = Boolean(session?.user?.isAdmin);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="User Menu"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl bg-gray-900 border-t border-gray-700/80 p-5 space-y-4 pb-safe shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header without title */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 border border-gray-700 text-gray-200 shadow-inner">
              <CircleUserRound size={28} />
            </div>
            {userEmail ? (
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-300">
                {userEmail}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:text-white"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content: Settings view or Menu options */}
        {showSettingsView ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowSettingsView(false)}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                ← Back to Menu
              </button>
              <span className="text-xs font-bold text-gray-300">Audio Settings</span>
            </div>

            <div className="rounded-xl bg-gray-950/80 border border-gray-800 p-3 max-h-[55vh] overflow-y-auto">
              <PlaybackDevicesSettingsPanel
                audioSettings={audioSettings}
                setAudioSettings={setAudioSettings}
                audioInputs={audioInputs}
                audioOutputs={audioOutputs}
                monoOutputActive={monoOutputActive}
                outputChannelCount={outputChannelCount}
                showPlaybackSpeedSettings={true}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {/* My Profile */}
            {onOpenProfile && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProfile();
                }}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-gray-800 active:bg-gray-750"
              >
                <div className="flex items-center gap-3 text-gray-200">
                  <User size={20} className="text-blue-400" />
                  <span className="text-sm font-medium">My Profile</span>
                </div>
                <ChevronRight size={18} className="text-gray-500" />
              </button>
            )}

            {/* Audio Settings */}
            <button
              type="button"
              onClick={() => {
                onRefreshAudioDevices?.();
                setShowSettingsView(true);
              }}
              className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-gray-800 active:bg-gray-750"
            >
              <div className="flex items-center gap-3 text-gray-200">
                <Settings size={20} className="text-amber-400" />
                <span className="text-sm font-medium">Audio & Device Settings</span>
              </div>
              <ChevronRight size={18} className="text-gray-500" />
            </button>

            {/* Switch to DAW Mode */}
            {onSwitchToDawDashboard && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchToDawDashboard();
                }}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-gray-800 active:bg-gray-750"
              >
                <div className="flex items-center gap-3 text-gray-200">
                  <SlidersHorizontal size={20} className="text-emerald-400" />
                  <span className="text-sm font-medium">Switch to DAW</span>
                </div>
                <ChevronRight size={18} className="text-gray-500" />
              </button>
            )}

            {/* Admin Panel (if admin) */}
            {isAdmin && onOpenAdmin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAdmin();
                }}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-gray-800 active:bg-gray-750"
              >
                <div className="flex items-center gap-3 text-gray-200">
                  <Shield size={20} className="text-purple-400" />
                  <span className="text-sm font-medium">Admin Panel</span>
                </div>
                <ChevronRight size={18} className="text-gray-500" />
              </button>
            )}

            {/* Install App (if in browser) */}
            {!isStandalone && (
              <a
                href="/download"
                onClick={onClose}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-gray-800 active:bg-gray-750"
              >
                <div className="flex items-center gap-3 text-gray-200">
                  <Download size={20} className="text-sky-400" />
                  <span className="text-sm font-medium">Install App</span>
                </div>
                <ChevronRight size={18} className="text-gray-500" />
              </a>
            )}

            {/* Native Environment Switcher */}
            {isNativePlatform() && (
              <div className="border-t border-gray-800/80 pt-2 mt-2 px-1">
                <div className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        typeof window !== 'undefined' &&
                        (window.location.origin.includes('3000') || window.location.origin.includes('localhost'))
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <span className="text-gray-400">
                      Env:{' '}
                      <strong className="text-gray-200">
                        {typeof window !== 'undefined' &&
                        (window.location.origin.includes('3000') || window.location.origin.includes('localhost'))
                          ? 'Dev (Mock SSO)'
                          : 'Production'}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      onClose();
                      const isDev =
                        typeof window !== 'undefined' &&
                        (window.location.origin.includes('3000') || window.location.origin.includes('localhost'));
                      const target = isDev
                        ? 'https://apollo.metaspexet.se'
                        : 'https://192.168.1.218:3000';
                      try {
                        await ApolloMedia.setServerUrl?.({ url: target });
                      } catch {
                        window.location.assign(target);
                      }
                    }}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    {typeof window !== 'undefined' &&
                    (window.location.origin.includes('3000') || window.location.origin.includes('localhost'))
                      ? 'Switch to Prod'
                      : 'Switch to Dev'}
                  </button>
                </div>
              </div>
            )}

            {/* Log out */}
            <div className="border-t border-gray-800 pt-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left text-red-400 hover:bg-red-950/30 transition-colors"
              >
                <LogOut size={20} />
                <span className="text-sm font-medium">Log out</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileUserMenuModal;
