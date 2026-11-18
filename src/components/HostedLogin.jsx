import { useEffect, useRef, useState } from 'react';
import { BrandWordmark } from './BrandLogo';

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
        </div>
        <div className="min-h-0 flex-[33]" aria-hidden="true" />
      </div>
    </div>
  );
}

export default HostedLogin;
