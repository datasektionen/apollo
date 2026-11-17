import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useIsMobile, isMobileScreen } from '../useIsMobile';
import * as platformModule from '../../utils/platform';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function TestComponent({ onState }) {
  const isMobile = useIsMobile();
  React.useEffect(() => {
    onState(isMobile);
  }, [isMobile, onState]);
  return <div data-mobile={isMobile ? 'true' : 'false'}>{isMobile ? 'Mobile' : 'Desktop'}</div>;
}

describe('useIsMobile hook', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  let container = null;
  let root = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight });
    vi.restoreAllMocks();
  });

  it('detects desktop when innerWidth is >= 768 and not a mobile platform', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
    vi.spyOn(platformModule, 'detectPlatform').mockReturnValue({ isMobile: false });

    expect(isMobileScreen()).toBe(false);

    let recorded = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<TestComponent onState={(val) => { recorded = val; }} />);
    });

    expect(recorded).toBe(false);
    expect(container.textContent).toBe('Desktop');
  });

  it('detects mobile when innerWidth is < 768', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    vi.spyOn(platformModule, 'detectPlatform').mockReturnValue({ isMobile: false });

    expect(isMobileScreen()).toBe(true);

    let recorded = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<TestComponent onState={(val) => { recorded = val; }} />);
    });

    expect(recorded).toBe(true);
    expect(container.textContent).toBe('Mobile');
  });

  it('detects mobile when detectPlatform reports isMobile and width < 1024', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 900 });
    vi.spyOn(platformModule, 'detectPlatform').mockReturnValue({ isMobile: true });

    expect(isMobileScreen()).toBe(true);

    let recorded = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<TestComponent onState={(val) => { recorded = val; }} />);
    });

    expect(recorded).toBe(true);
  });

  it('updates reactively on window resize', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
    vi.spyOn(platformModule, 'detectPlatform').mockReturnValue({ isMobile: false });

    let recorded = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<TestComponent onState={(val) => { recorded = val; }} />);
    });

    expect(recorded).toBe(false);

    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 });
      window.dispatchEvent(new Event('resize'));
    });

    expect(recorded).toBe(true);
    expect(container.textContent).toBe('Mobile');
  });
});
