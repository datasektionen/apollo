import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Share,
  PlusSquare,
  Laptop,
  Smartphone,
  Globe,
  ChevronRight,
} from 'lucide-react';
import '../styles/player-theme.css';
import { BrandWordmark } from './BrandLogo';
import { detectPlatform } from '../utils/platform';
import { promptPwaInstall, subscribePwaInstall } from '../lib/pwa';
import { getVersionState, subscribeVersionStatus } from '../lib/versionManager';
import {
  AndroidIcon,
  AppleIcon,
  WindowsIcon,
  LinuxIcon,
  WebIcon,
} from './icons/PlatformIcons';

function PlatformIconWell({ Icon, active = false, size = 24, boxClass = 'h-10 w-10 rounded-xl' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center border transition-colors ${boxClass} ${
        active
          ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
          : 'border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] text-[var(--player-text-primary)]'
      }`}
    >
      <Icon size={size} />
    </div>
  );
}

function GuideStepList({ steps }) {
  return (
    <ol className="space-y-3.5 text-sm leading-relaxed text-[var(--player-text-body)]">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-3.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-xs font-bold tabular-nums text-[var(--player-accent-text)]">
            {index + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function GuideHeader({ icon, title, subtitle, rightSlot = null }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--player-border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-center gap-3.5">
        <PlatformIconWell Icon={icon} active size={26} boxClass="h-12 w-12 rounded-xl" />
        <div>
          <div className="text-xl font-bold tracking-tight text-[var(--player-text-primary)]">{title}</div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--player-accent-text)]">{subtitle}</span>
        </div>
      </div>
      {rightSlot}
    </div>
  );
}

function PlatformCard({
  active = false,
  icon,
  title,
  badge,
  onClick,
  href,
  download,
  trailingIcon: TrailingIcon = ChevronRight,
}) {
  const cardClass = `group flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all cursor-pointer ${
    active
      ? 'border-[var(--player-accent-border)] bg-[var(--player-bg-elevated)] shadow-[var(--player-shadow-accent)]'
      : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)] hover:border-[var(--player-border-default)] hover:bg-[var(--player-bg-elevated)]'
  }`;

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3.5">
        <PlatformIconWell Icon={icon} active={active} size={22} boxClass="h-10 w-10 rounded-xl" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-base font-semibold tracking-tight text-[var(--player-text-primary)]">
            {title}
          </span>
          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${
              active
                ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-surface-subtle)] text-[var(--player-text-muted)]'
            }`}
          >
            {badge}
          </span>
        </div>
      </div>
      <TrailingIcon
        size={18}
        className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${
          active ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-muted)] group-hover:text-[var(--player-text-primary)]'
        }`}
      />
    </>
  );

  if (href) {
    return (
      <a href={href} download={download} onClick={onClick} className={cardClass}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cardClass}>
      {content}
    </button>
  );
}

const KBD_PILL_CLASS = 'inline-flex items-center gap-1 rounded-md border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--player-text-primary)]';
const PRIMARY_CTA_CLASS = 'flex w-full items-center justify-center gap-2.5 rounded-xl bg-[var(--player-accent)] hover:bg-[var(--player-accent-hover)] py-3.5 text-sm font-bold text-[var(--player-accent-foreground)] shadow-[var(--player-shadow-accent)] transition-colors disabled:opacity-50';
const GUIDE_CARD_CLASS = 'player-hero-surface rounded-2xl border border-[var(--player-accent-border)] bg-[var(--player-bg-surface)] p-5 sm:p-7 shadow-[var(--player-shadow-elevated)] space-y-5';

export default function DistributionLanding() {
  const navigate = useNavigate();
  const scrollContainerRef = useRef(null);
  const [detectedPlatform, setDetectedPlatform] = useState(detectPlatform());
  const [selectedPlatform, setSelectedPlatform] = useState(detectPlatform().os);
  const [pwaState, setPwaState] = useState({ isInstallable: false, isStandalone: false });
  const [versionState, setVersionState] = useState(getVersionState());
  const [installingPwa, setInstallingPwa] = useState(false);
  const [macBrowserTab, setMacBrowserTab] = useState('safari');

  useEffect(() => {
    const unsubVersion = subscribeVersionStatus((state) => {
      setVersionState(state);
    });

    const platform = detectPlatform();
    setDetectedPlatform(platform);
    setSelectedPlatform(platform.os);
    if (platform.browser === 'chrome' || platform.browser === 'edge') {
      setMacBrowserTab('chrome');
    } else {
      setMacBrowserTab('safari');
    }

    const unsubPwa = subscribePwaInstall((state) => {
      setPwaState(state);
    });

    return () => {
      unsubVersion();
      unsubPwa();
    };
  }, []);

  const handleInstallPwa = async () => {
    setInstallingPwa(true);
    try {
      await promptPwaInstall();
    } finally {
      setInstallingPwa(false);
    }
  };

  const handleOpenWeb = () => {
    navigate('/player');
  };

  const scrollToTop = () => {
    if (typeof scrollContainerRef.current?.scrollTo === 'function') {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    } else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectPlatform = (platformId) => {
    if (platformId === 'web') {
      handleOpenWeb();
      return;
    }

    setSelectedPlatform(platformId);
    scrollToTop();
  };

  const apkDownloadUrl = versionState?.apkUrl || '/apollo.apk';
  const isDirectApk = apkDownloadUrl.endsWith('.apk') || apkDownloadUrl.includes('/apollo.apk');

  const renderPwaInstallButton = () => (
    pwaState.isInstallable ? (
      <button
        type="button"
        onClick={handleInstallPwa}
        disabled={installingPwa}
        className={PRIMARY_CTA_CLASS}
      >
        <Download size={18} />
        <span>{installingPwa ? 'Installing...' : 'Install Apollo PWA'}</span>
      </button>
    ) : null
  );

  // Render top guide for active platform
  const renderActiveGuide = () => {
    if (selectedPlatform === 'android') {
      return (
        <section className={GUIDE_CARD_CLASS}>
          <GuideHeader icon={AndroidIcon} title="Android" subtitle="Native APK" />

          <a
            href={apkDownloadUrl}
            download={isDirectApk ? 'apollo.apk' : undefined}
            className={`${PRIMARY_CTA_CLASS} text-base`}
          >
            <Download size={20} />
            <span>Download APK</span>
          </a>
        </section>
      );
    }

    if (selectedPlatform === 'ios') {
      return (
        <section className={GUIDE_CARD_CLASS}>
          <GuideHeader icon={AppleIcon} title="iPhone / iPad" subtitle="Safari PWA" />

          <GuideStepList
            steps={[
              <>
                Open this page in <span className="font-semibold text-[var(--player-text-primary)]">Safari</span>.
              </>,
              <>
                Tap the <span className={KBD_PILL_CLASS}><Share size={12} /> Share</span> button in the bottom menu bar.
              </>,
              <>
                Scroll down and select <span className={KBD_PILL_CLASS}><PlusSquare size={12} /> Add to Home Screen</span>.
              </>,
              <>
                Tap <span className="font-semibold text-[var(--player-text-primary)]">Add</span> in the top-right corner to finish installing.
              </>,
            ]}
          />
        </section>
      );
    }

    if (selectedPlatform === 'macos') {
      return (
        <section className={GUIDE_CARD_CLASS}>
          <GuideHeader
            icon={AppleIcon}
            title="macOS"
            subtitle="Desktop PWA"
            rightSlot={(
              <div className="self-start sm:self-auto flex rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-canvas)] p-0.5">
                <button
                  type="button"
                  onClick={() => setMacBrowserTab('safari')}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
                    macBrowserTab === 'safari'
                      ? 'bg-[var(--player-bg-active-segment)] text-[var(--player-accent-text)]'
                      : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  Safari
                </button>
                <button
                  type="button"
                  onClick={() => setMacBrowserTab('chrome')}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
                    macBrowserTab === 'chrome'
                      ? 'bg-[var(--player-bg-active-segment)] text-[var(--player-accent-text)]'
                      : 'text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  Chromium
                </button>
              </div>
            )}
          />

          {macBrowserTab === 'safari' ? (
            <GuideStepList
              steps={[
                <>
                  In the Safari top menu bar, click <span className="font-semibold text-[var(--player-text-primary)]">File</span>.
                </>,
                <>
                  Select <span className="font-semibold text-[var(--player-text-primary)]">Add to Dock...</span>.
                </>,
                <>
                  Click <span className="font-semibold text-[var(--player-text-primary)]">Add</span> to install Apollo as a standalone Mac app.
                </>,
              ]}
            />
          ) : (
            <div className="space-y-4">
              {renderPwaInstallButton()}
              <GuideStepList
                steps={[
                  <>
                    In Chrome, Edge, or Brave, click <span className="font-semibold text-[var(--player-text-primary)]">Install Apollo</span> inside the address bar.
                  </>,
                  <>
                    Click <span className="font-semibold text-[var(--player-text-primary)]">Install</span> to add Apollo to your Mac Applications.
                  </>,
                ]}
              />
            </div>
          )}
        </section>
      );
    }

    if (selectedPlatform === 'windows') {
      return (
        <section className={GUIDE_CARD_CLASS}>
          <GuideHeader icon={WindowsIcon} title="Windows" subtitle="Desktop PWA" />

          <div className="space-y-4">
            {renderPwaInstallButton()}
            <GuideStepList
              steps={[
                <>
                  In Chrome, Edge, or Brave, click the <span className="font-semibold text-[var(--player-text-primary)]">App Available / Install</span> icon in the address bar.
                </>,
                <>
                  Click <span className="font-semibold text-[var(--player-text-primary)]">Install</span> to integrate Apollo with your taskbar and start menu.
                </>,
              ]}
            />
          </div>
        </section>
      );
    }

    if (selectedPlatform === 'linux') {
      return (
        <section className={GUIDE_CARD_CLASS}>
          <GuideHeader icon={LinuxIcon} title="Linux" subtitle="Desktop PWA" />

          <div className="space-y-4">
            {renderPwaInstallButton()}
            <GuideStepList
              steps={[
                'Open in Google Chrome, Chromium, Brave, or Microsoft Edge.',
                <>
                  Click the <span className="font-semibold text-[var(--player-text-primary)]">Install</span> icon in the address bar.
                </>,
                'Confirm installation to add Apollo to your system applications menu.',
              ]}
            />
          </div>
        </section>
      );
    }

    return null;
  };

  return (
    <div
      ref={scrollContainerRef}
      className="player-theme player-showcase-surface h-full w-full flex flex-col bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)] overflow-y-auto"
      data-player-theme="dark-gold"
    >
      {/* Header with only Apollo Brand Wordmark */}
      <header className="relative z-20 border-b border-[var(--player-border-subtle)] bg-transparent py-4 flex items-center">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 flex items-center">
          <BrandWordmark className="h-9" />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-7 sm:px-6 sm:py-10 max-w-3xl mx-auto w-full space-y-9">
        {/* Active installation guide displayed at the top */}
        {renderActiveGuide()}

        {/* Category 1: Mobile */}
        <section className="space-y-3.5">
          <h2 className="text-lg font-bold text-[var(--player-text-primary)] tracking-tight flex items-center gap-2.5">
            <Smartphone size={20} className="text-[var(--player-accent-text)]" />
            <span>Mobile</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <PlatformCard
              active={selectedPlatform === 'android'}
              icon={AndroidIcon}
              title="Android"
              badge="APK"
              href={apkDownloadUrl}
              download={isDirectApk ? 'apollo.apk' : undefined}
              onClick={() => handleSelectPlatform('android')}
              trailingIcon={Download}
            />

            <PlatformCard
              active={selectedPlatform === 'ios'}
              icon={AppleIcon}
              title="iPhone / iPad"
              badge="PWA"
              onClick={() => handleSelectPlatform('ios')}
            />
          </div>
        </section>

        {/* Category 2: Desktop */}
        <section className="space-y-3.5">
          <h2 className="text-lg font-bold text-[var(--player-text-primary)] tracking-tight flex items-center gap-2.5">
            <Laptop size={20} className="text-[var(--player-accent-text)]" />
            <span>Desktop</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <PlatformCard
              active={selectedPlatform === 'macos'}
              icon={AppleIcon}
              title="macOS"
              badge="PWA"
              onClick={() => handleSelectPlatform('macos')}
            />

            <PlatformCard
              active={selectedPlatform === 'windows'}
              icon={WindowsIcon}
              title="Windows"
              badge="PWA"
              onClick={() => handleSelectPlatform('windows')}
            />

            <PlatformCard
              active={selectedPlatform === 'linux'}
              icon={LinuxIcon}
              title="Linux"
              badge="PWA"
              onClick={() => handleSelectPlatform('linux')}
            />
          </div>
        </section>

        {/* Category 3: Alternative - Web mentioned ONLY ONCE at the very bottom */}
        <section className="space-y-3.5 border-t border-[var(--player-border-subtle)] pt-6 pb-4">
          <h2 className="text-base font-bold text-[var(--player-text-primary)] tracking-tight flex items-start gap-2.5">
            <Globe size={19} className="mt-0.5 shrink-0 text-[var(--player-accent-text)]" />
            <span>If you have no space or trust and are with a slightly to significantly worse experince</span>
          </h2>

          <PlatformCard
            icon={WebIcon}
            title="Web"
            badge="Browser"
            onClick={handleOpenWeb}
          />
        </section>
      </main>
    </div>
  );
}
