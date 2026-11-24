import React, { useState } from 'react';
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
} from 'lucide-react';
import { isStandaloneApp } from '../../utils/platform';
import { PlaybackDevicesSettingsPanel } from '../SettingsPanels';

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
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[var(--player-bg-scrim)] backdrop-blur-sm animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="User Menu"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl bg-[var(--player-bg-surface)] border-t border-[var(--player-border-default)] p-5 space-y-4 pb-safe shadow-[var(--player-shadow-sheet)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header without title */}
        <div className="flex items-center justify-between border-b border-[var(--player-border-subtle)] pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--player-bg-elevated)] border border-[var(--player-border-default)] text-[var(--player-text-primary)]">
              <CircleUserRound size={24} />
            </div>
            {userEmail ? (
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--player-text-secondary)]">
                {userEmail}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]"
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
                className="text-xs font-semibold text-[var(--player-accent-text)] hover:text-[var(--player-accent-hover)] flex items-center gap-1"
              >
                ← Back to Menu
              </button>
              <span className="text-xs font-bold text-[var(--player-text-primary)]">
                Audio Settings
              </span>
            </div>

            <div className="player-settings-host rounded-xl bg-[var(--player-bg-elevated)] border border-[var(--player-border-subtle)] p-3 max-h-[55vh] overflow-y-auto">
              <PlaybackDevicesSettingsPanel
                audioSettings={audioSettings}
                setAudioSettings={setAudioSettings}
                audioInputs={audioInputs}
                audioOutputs={audioOutputs}
                monoOutputActive={monoOutputActive}
                outputChannelCount={outputChannelCount}
                showPlaybackSpeedSettings={true}
                usePlayerSliders={true}
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
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)]"
              >
                <div className="flex items-center gap-3 text-[var(--player-text-primary)]">
                  <User size={19} className="text-[var(--player-text-secondary)]" />
                  <span className="text-sm font-medium">My Profile</span>
                </div>
                <ChevronRight size={17} className="text-[var(--player-text-muted)]" />
              </button>
            )}

            {/* Audio Settings */}
            <button
              type="button"
              onClick={() => {
                onRefreshAudioDevices?.();
                setShowSettingsView(true);
              }}
              className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)]"
            >
              <div className="flex items-center gap-3 text-[var(--player-text-primary)]">
                <Settings size={19} className="text-[var(--player-text-secondary)]" />
                <span className="text-sm font-medium">Audio & Device Settings</span>
              </div>
              <ChevronRight size={17} className="text-[var(--player-text-muted)]" />
            </button>

            {/* Switch to DAW Mode */}
            {onSwitchToDawDashboard && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchToDawDashboard();
                }}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)]"
              >
                <div className="flex items-center gap-3 text-[var(--player-text-primary)]">
                  <SlidersHorizontal size={19} className="text-[var(--player-text-secondary)]" />
                  <span className="text-sm font-medium">Switch to DAW</span>
                </div>
                <ChevronRight size={17} className="text-[var(--player-text-muted)]" />
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
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)]"
              >
                <div className="flex items-center gap-3 text-[var(--player-text-primary)]">
                  <Shield size={19} className="text-[var(--player-text-secondary)]" />
                  <span className="text-sm font-medium">Admin Panel</span>
                </div>
                <ChevronRight size={17} className="text-[var(--player-text-muted)]" />
              </button>
            )}

            {/* Install App (if in browser) */}
            {!isStandalone && (
              <a
                href="/download"
                onClick={onClose}
                className="flex w-full items-center justify-between rounded-xl p-3 text-left transition-colors hover:bg-[var(--player-hover)] active:bg-[var(--player-pressed)]"
              >
                <div className="flex items-center gap-3 text-[var(--player-text-primary)]">
                  <Download size={19} className="text-[var(--player-text-secondary)]" />
                  <span className="text-sm font-medium">Install App</span>
                </div>
                <ChevronRight size={17} className="text-[var(--player-text-muted)]" />
              </a>
            )}

            {/* Log out */}
            <div className="border-t border-[var(--player-border-subtle)] pt-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left text-[var(--player-danger)] hover:bg-[var(--player-danger-soft)] transition-colors"
              >
                <LogOut size={19} />
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
