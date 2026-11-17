import { useState, useEffect } from 'react';
import { detectPlatform } from '../utils/platform';

export const MOBILE_BREAKPOINT = 768;

/**
 * Returns true if the device or current viewport represents a mobile phone experience.
 */
export function isMobileScreen() {
  if (typeof window === 'undefined') return false;

  const platform = detectPlatform();
  // If native Capacitor or mobile device with narrow width or portrait orientation
  if (platform.isMobile && (window.innerWidth < 1024 || window.innerHeight > window.innerWidth)) {
    return true;
  }

  // Check CSS media query / viewport width
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  }

  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * React hook that dynamically tracks whether the current screen is mobile.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => isMobileScreen());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkMobile = () => {
      setIsMobile(isMobileScreen());
    };

    let mql = null;
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', checkMobile);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(checkMobile);
      }
    }

    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);

    return () => {
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', checkMobile);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(checkMobile);
        }
      }
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  return isMobile;
}
