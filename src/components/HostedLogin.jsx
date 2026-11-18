import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BrandWordmark } from './BrandLogo';

const ApolloMedia = registerPlugin('ApolloMedia');

const GLARE_RANGE_PX = 680;
const GLARE_FOLLOW_NEAR = 0.022;
const GLARE_FOLLOW_FAR = 0.16;
const GLARE_LAG_FAR_PX = 120;

function HostedLogin({
  onSsoLogin,
  loading = false,
  error = '',
}) {
  const buttonRef = useRef(null);
  const [glare, setGlare] = useState({ x: 50, y: 50, intensity: 0 });
  const [serverConfig, setServerConfig] = useState(null);
  const isNative = typeof Capacitor !== 'undefined' && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;
    ApolloMedia.getServerConfig?.()
      .then((cfg) => {
        if (cfg) setServerConfig(cfg);
      })
      .catch(() => {});
  }, [isNative]);

  const isDev = serverConfig ? Boolean(serverConfig.isDev) : (
    typeof window !== 'undefined' && (
      window.location.origin.includes('3000') ||
      window.location.origin.includes('localhost') ||
      !window.location.origin.includes('apollo.metaspexet.se')
    )
  );
  const currentDisplayUrl = serverConfig?.currentUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  const handleSwitchToProd = async () => {
    const prodUrl = serverConfig?.prodUrl || 'https://apollo.metaspexet.se';
    try {
      await ApolloMedia.setServerUrl?.({ url: prodUrl });
    } catch {
      window.location.assign(prodUrl);
    }
  };

  const handleSwitchToDev = async () => {
    const devUrl = serverConfig?.devUrl || 'https://192.168.1.218:3000';
    try {
      await ApolloMedia.setServerUrl?.({ url: devUrl });
    } catch {
      window.location.assign(devUrl);
    }
  };

  const handleCustomIp = async () => {
    const current = serverConfig?.currentUrl || window.location.origin;
    const input = window.prompt('Enter Apollo server URL or IP (e.g. https://192.168.1.218:3000 or https://apollo.metaspexet.se):', current);
    if (!input || !input.trim()) return;
    let target = input.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}:3000`;
    }
    try {
      await ApolloMedia.setServerUrl?.({ url: target });
    } catch {
      window.location.assign(target);
    }
  };

  useEffect(() => {
    const mouse = { x: 0, y: 0, active: false };
    const smoothed = { x: 0, y: 0, initialized: false };
    let frame = 0;

    const onMove = (event) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      mouse.active = true;
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const button = buttonRef.current;
      if (!button || !mouse.active) return;

      const rect = button.getBoundingClientRect();
      const nearestX = Math.min(Math.max(mouse.x, rect.left), rect.right);
      const nearestY = Math.min(Math.max(mouse.y, rect.top), rect.bottom);
      const dist = Math.hypot(mouse.x - nearestX, mouse.y - nearestY);
      const inside = dist <= 0.5;
      const intensity = inside ? 1 : Math.max(0, 1 - dist / GLARE_RANGE_PX);

      const localMouseX = mouse.x - rect.left;
      const localMouseY = mouse.y - rect.top;
      const targetX = localMouseX;
      const targetY = localMouseY;

      if (!smoothed.initialized) {
        smoothed.x = targetX;
        smoothed.y = targetY;
        smoothed.initialized = true;
      } else {
        const lag = Math.hypot(targetX - smoothed.x, targetY - smoothed.y);
        const far = Math.min(1, lag / GLARE_LAG_FAR_PX);
        const follow = GLARE_FOLLOW_NEAR + (GLARE_FOLLOW_FAR - GLARE_FOLLOW_NEAR) * far * far;
        smoothed.x += (targetX - smoothed.x) * follow;
        smoothed.y += (targetY - smoothed.y) * follow;
      }

      const next = {
        x: (smoothed.x / rect.width) * 100,
        y: (smoothed.y / rect.height) * 100,
        intensity,
      };
      setGlare((prev) => (
        Math.abs(prev.x - next.x) < 0.05
        && Math.abs(prev.y - next.y) < 0.05
        && Math.abs(prev.intensity - next.intensity) < 0.005
          ? prev
          : next
      ));
    };

    window.addEventListener('pointermove', onMove);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  const glareSize = 108 - glare.intensity * 46;
  const glarePeak = 0.12 + glare.intensity * 0.28;
  const glareMid = 0.04 + glare.intensity * 0.08;

  return (
    <div className="grid h-full grid-rows-[minmax(0,45fr)_auto_minmax(0,55fr)] justify-items-center bg-gray-900 p-6 text-white">
      <BrandWordmark className="row-start-2 h-24 w-auto max-w-[90vw] sm:h-32 md:h-40" />

      <div className="row-start-3 flex min-h-0 w-full flex-col items-center">
        <div className="min-h-0 flex-[67]" aria-hidden="true" />
        <div className="flex flex-col items-center gap-3">
        <button
          ref={buttonRef}
          type="button"
          onClick={onSsoLogin}
          disabled={loading}
          className="relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[#a98c4d] pl-5 pr-4 py-2.5 text-3xl font-semibold leading-none tracking-wide text-gray-950 shadow-[0_0_0_1px_rgba(122,98,46,0.55),0_10px_28px_rgba(0,0,0,0.45)] transition duration-150 hover:scale-[1.05] hover:shadow-[0_0_0_1px_rgba(169,140,77,0.45),0_0px_32px_rgba(122,98,46,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a98c4d]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 active:scale-[1.02] disabled:pointer-events-none disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              opacity: glare.intensity,
              background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255, 244, 220, ${glarePeak}) 0%, rgba(255, 230, 180, ${glareMid}) ${22 + glare.intensity * 10}%, transparent ${glareSize}%)`,
            }}
          />
          <span className="relative inline-flex items-center gap-1">
            <span className="-translate-y-px">{loading ? 'Redirecting...' : 'Sign in with SSO'}</span>
            {loading ? null : (
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 8h9M8.5 4l4 4-4 4" />
              </svg>
            )}
          </span>
        </button>

        {error ? <p className="max-w-xs text-center text-sm text-red-300">{error}</p> : null}

        {/* Native Environment Switcher (Dev Mock SSO vs Production Deployed SSO) */}
        {isNative ? (
          <div className="mt-3 flex flex-col items-center gap-1.5 rounded-2xl border border-gray-800 bg-gray-950/80 px-4 py-2.5 text-xs shadow-xl backdrop-blur max-w-sm w-full">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${isDev ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <span className="font-semibold text-gray-200">
                {isDev ? 'Dev Environment (Mock SSO)' : 'Production (Deployed SSO)'}
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-mono truncate max-w-[260px]">
              {currentDisplayUrl}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {isDev ? (
                <button
                  type="button"
                  onClick={handleSwitchToProd}
                  className="rounded-lg bg-blue-600/30 border border-blue-500/40 hover:bg-blue-600/50 px-3 py-1 text-blue-300 font-medium transition-colors"
                >
                  Switch to Production
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSwitchToDev}
                  className="rounded-lg bg-amber-600/30 border border-amber-500/40 hover:bg-amber-600/50 px-3 py-1 text-amber-300 font-medium transition-colors"
                >
                  Switch to Dev (Mock SSO)
                </button>
              )}
              <button
                type="button"
                onClick={handleCustomIp}
                className="rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700 px-2 py-1 text-gray-400 hover:text-white transition-colors"
                title="Configure custom server URL or IP"
              >
                Edit IP
              </button>
            </div>
          </div>
        ) : null}
        </div>
        <div className="min-h-0 flex-[33]" aria-hidden="true" />
      </div>
    </div>
  );
}

export default HostedLogin;
