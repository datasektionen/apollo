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
  ExternalLink,
} from 'lucide-react';
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

  const currentBrowser = detectedPlatform.browser;
  const apkDownloadUrl = versionState?.apkUrl || '/apollo.apk';
  const isDirectApk = apkDownloadUrl.endsWith('.apk') || apkDownloadUrl.includes('/apollo.apk');

  // Render top guide for active platform
  const renderActiveGuide = () => {
    if (selectedPlatform === 'android') {
      return (
        <section className="rounded-2xl border border-blue-500/80 bg-gray-800 p-5 sm:p-6 shadow-xl ring-1 ring-blue-500/30 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-700/80 text-white">
              <AndroidIcon size={26} />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Android</div>
              <span className="text-xs font-mono text-gray-400">Native APK</span>
            </div>
          </div>

          <a
            href={apkDownloadUrl}
            download={isDirectApk ? 'apollo.apk' : undefined}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 text-base shadow-lg transition-colors"
          >
            <Download size={20} />
            <span>Download APK</span>
          </a>
        </section>
      );
    }

    if (selectedPlatform === 'ios') {
      return (
        <section className="rounded-2xl border border-blue-500/80 bg-gray-800 p-5 sm:p-6 shadow-xl ring-1 ring-blue-500/30 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-700/80 text-white">
              <AppleIcon size={26} />
            </div>
            <div>
              <div className="text-lg font-bold text-white">iPhone / iPad</div>
              <span className="text-xs font-mono text-gray-400">Safari PWA</span>
            </div>
          </div>

          <ol className="space-y-3.5 text-sm text-gray-200">
            <li className="flex items-start gap-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                1
              </span>
              <span className="pt-0.5">
                Open this page in <span className="font-semibold text-white">Safari</span>.
              </span>
            </li>
            <li className="flex items-start gap-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                2
              </span>
              <span className="pt-0.5">
                Tap the <span className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 font-semibold text-white text-xs"><Share size={12} /> Share</span> button in the bottom menu bar.
              </span>
            </li>
            <li className="flex items-start gap-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                3
              </span>
              <span className="pt-0.5">
                Scroll down and select <span className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 font-semibold text-white text-xs"><PlusSquare size={12} /> Add to Home Screen</span>.
              </span>
            </li>
            <li className="flex items-start gap-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                4
              </span>
              <span className="pt-0.5">
                Tap <span className="font-semibold text-white">Add</span> in the top-right corner to finish installing.
              </span>
            </li>
          </ol>
        </section>
      );
    }

    if (selectedPlatform === 'macos') {
      return (
        <section className="rounded-2xl border border-blue-500/80 bg-gray-800 p-5 sm:p-6 shadow-xl ring-1 ring-blue-500/30 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-700/80 text-white">
                <AppleIcon size={26} />
              </div>
              <div>
                <div className="text-lg font-bold text-white">macOS</div>
                <span className="text-xs font-mono text-gray-400">Desktop PWA</span>
              </div>
            </div>

            <div className="flex rounded-lg bg-gray-900 p-1 border border-gray-700">
              <button
                type="button"
                onClick={() => setMacBrowserTab('safari')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  macBrowserTab === 'safari' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Safari
              </button>
              <button
                type="button"
                onClick={() => setMacBrowserTab('chrome')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  macBrowserTab === 'chrome' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Chromium
              </button>
            </div>
          </div>

          {macBrowserTab === 'safari' ? (
            <ol className="space-y-3.5 text-sm text-gray-200">
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  1
                </span>
                <span className="pt-0.5">
                  In the Safari top menu bar, click <span className="font-semibold text-white">File</span>.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <span className="pt-0.5">
                  Select <span className="font-semibold text-white">Add to Dock...</span>.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  3
                </span>
                <span className="pt-0.5">
                  Click <span className="font-semibold text-white">Add</span> to install Apollo as a standalone Mac app.
                </span>
              </li>
            </ol>
          ) : (
            <div className="space-y-4">
              {pwaState.isInstallable ? (
                <button
                  type="button"
                  onClick={handleInstallPwa}
                  disabled={installingPwa}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 text-sm shadow-lg transition-colors disabled:opacity-50"
                >
                  <Download size={18} />
                  <span>{installingPwa ? 'Installing...' : 'Install Apollo PWA'}</span>
                </button>
              ) : null}

              <ol className="space-y-3.5 text-sm text-gray-200">
                <li className="flex items-start gap-3.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    1
                  </span>
                  <span className="pt-0.5">
                    In Google Chrome, Edge, or Brave, click the <span className="font-semibold text-white">Install Apollo</span> icon in the right side of the address bar.
                  </span>
                </li>
                <li className="flex items-start gap-3.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    2
                  </span>
                  <span className="pt-0.5">
                    Click <span className="font-semibold text-white">Install</span> to add Apollo to your Mac Applications.
                  </span>
                </li>
              </ol>
            </div>
          )}
        </section>
      );
    }

    if (selectedPlatform === 'windows') {
      return (
        <section className="rounded-2xl border border-blue-500/80 bg-gray-800 p-5 sm:p-6 shadow-xl ring-1 ring-blue-500/30 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-700/80 text-white">
              <WindowsIcon size={26} />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Windows</div>
              <span className="text-xs font-mono text-gray-400">Desktop PWA</span>
            </div>
          </div>

          <div className="space-y-4">
            {pwaState.isInstallable ? (
              <button
                type="button"
                onClick={handleInstallPwa}
                disabled={installingPwa}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 text-sm shadow-lg transition-colors disabled:opacity-50"
              >
                <Download size={18} />
                <span>{installingPwa ? 'Installing...' : 'Install Apollo PWA'}</span>
              </button>
            ) : null}

            <ol className="space-y-3.5 text-sm text-gray-200">
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  1
                </span>
                <span className="pt-0.5">
                  In Chrome, Edge, or Brave, click the <span className="font-semibold text-white">App Available / Install</span> icon in the address bar.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <span className="pt-0.5">
                  Click <span className="font-semibold text-white">Install</span> to integrate Apollo with your taskbar and start menu.
                </span>
              </li>
            </ol>
          </div>
        </section>
      );
    }

    if (selectedPlatform === 'linux') {
      return (
        <section className="rounded-2xl border border-blue-500/80 bg-gray-800 p-5 sm:p-6 shadow-xl ring-1 ring-blue-500/30 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-700/80 text-white">
              <LinuxIcon size={26} />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Linux</div>
              <span className="text-xs font-mono text-gray-400">Desktop PWA</span>
            </div>
          </div>

          <div className="space-y-4">
            {pwaState.isInstallable ? (
              <button
                type="button"
                onClick={handleInstallPwa}
                disabled={installingPwa}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 text-sm shadow-lg transition-colors disabled:opacity-50"
              >
                <Download size={18} />
                <span>{installingPwa ? 'Installing...' : 'Install Apollo PWA'}</span>
              </button>
            ) : null}

            <ol className="space-y-3.5 text-sm text-gray-200">
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  1
                </span>
                <span className="pt-0.5">
                  Open in Google Chrome, Chromium, Brave, or Microsoft Edge.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <span className="pt-0.5">
                  Click the <span className="font-semibold text-white">Install</span> icon in the address bar.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  3
                </span>
                <span className="pt-0.5">
                  Confirm installation to add Apollo to your system applications menu.
                </span>
              </li>
            </ol>
          </div>
        </section>
      );
    }

    return null;
  };

  return (
    <div
      ref={scrollContainerRef}
      className="h-full w-full flex flex-col bg-gray-900 text-white overflow-y-auto"
    >
      {/* Header with only Apollo Brand Wordmark */}
      <header className="relative z-20 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center">
        <BrandWordmark className="h-9" />
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-8">
        {/* Active installation guide displayed at the top */}
        {renderActiveGuide()}

        {/* Category 1: Mobile */}
        <section className="space-y-3.5">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Smartphone size={22} className="text-blue-500" />
            <span>Mobile</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Android: whole brick is an anchor triggering APK download */}
            <a
              href={apkDownloadUrl}
              download={isDirectApk ? 'apollo.apk' : undefined}
              onClick={() => handleSelectPlatform('android')}
              className={`flex items-center justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                selectedPlatform === 'android'
                  ? 'border-blue-500 bg-gray-800 ring-1 ring-blue-500/40'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                  <AndroidIcon size={24} />
                </div>
                <div>
                  <span className="text-base font-semibold text-white">Android</span>
                  <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                    APK
                  </span>
                </div>
              </div>
              <Download size={18} className="text-gray-400" />
            </a>

            {/* iPhone / iPad: whole brick is a button */}
            <button
              type="button"
              onClick={() => handleSelectPlatform('ios')}
              className={`flex items-center justify-between rounded-xl border p-4 transition-all text-left cursor-pointer ${
                selectedPlatform === 'ios'
                  ? 'border-blue-500 bg-gray-800 ring-1 ring-blue-500/40'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                  <AppleIcon size={24} />
                </div>
                <div>
                  <span className="text-base font-semibold text-white">iPhone / iPad</span>
                  <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                    PWA
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          </div>
        </section>

        {/* Category 2: Desktop */}
        <section className="space-y-3.5">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Laptop size={22} className="text-blue-500" />
            <span>Desktop</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {/* macOS: whole brick is a button */}
            <button
              type="button"
              onClick={() => handleSelectPlatform('macos')}
              className={`flex items-center justify-between rounded-xl border p-4 transition-all text-left cursor-pointer ${
                selectedPlatform === 'macos'
                  ? 'border-blue-500 bg-gray-800 ring-1 ring-blue-500/40'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                  <AppleIcon size={24} />
                </div>
                <div>
                  <span className="text-base font-semibold text-white">macOS</span>
                  <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                    PWA
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>

            {/* Windows: whole brick is a button */}
            <button
              type="button"
              onClick={() => handleSelectPlatform('windows')}
              className={`flex items-center justify-between rounded-xl border p-4 transition-all text-left cursor-pointer ${
                selectedPlatform === 'windows'
                  ? 'border-blue-500 bg-gray-800 ring-1 ring-blue-500/40'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                  <WindowsIcon size={24} />
                </div>
                <div>
                  <span className="text-base font-semibold text-white">Windows</span>
                  <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                    PWA
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>

            {/* Linux: whole brick is a button */}
            <button
              type="button"
              onClick={() => handleSelectPlatform('linux')}
              className={`flex items-center justify-between rounded-xl border p-4 transition-all text-left cursor-pointer ${
                selectedPlatform === 'linux'
                  ? 'border-blue-500 bg-gray-800 ring-1 ring-blue-500/40'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                  <LinuxIcon size={24} />
                </div>
                <div>
                  <span className="text-base font-semibold text-white">Linux</span>
                  <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                    PWA
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          </div>
        </section>

        {/* Category 3: Alternative - Web mentioned ONLY ONCE at the very bottom */}
        <section className="space-y-3.5 pt-2">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Globe size={22} className="text-blue-500" />
            <span>If you have no space or trust and are with a slightly to significantly worse experince</span>
          </h2>

          <button
            type="button"
            onClick={handleOpenWeb}
            className="w-full flex items-center justify-between rounded-xl border border-gray-700 bg-gray-800/60 p-4 transition-all hover:border-gray-600 hover:bg-gray-800 text-left cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700/80 text-white">
                <WebIcon size={24} />
              </div>
              <div>
                <span className="text-base font-semibold text-white">Web</span>
                <span className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
                  Browser
                </span>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        </section>
      </main>
    </div>
  );
}
