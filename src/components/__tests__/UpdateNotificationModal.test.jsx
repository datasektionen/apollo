import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateNotificationModal from '../UpdateNotificationModal';
import * as versionManager from '../../lib/versionManager';
import * as platformUtils from '../../utils/platform';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe('UpdateNotificationModal Component', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    root = null;
  });

  it('renders nothing when no update is available', async () => {
    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({ isUpdateAvailable: false, isForceUpdate: false });
      return () => {};
    });

    await act(async () => {
      root.render(<UpdateNotificationModal />);
    });

    expect(container.textContent).toBe('');
  });

  it('does not render soft update banner in regular web browser mode', async () => {
    vi.spyOn(platformUtils, 'isStandaloneApp').mockReturnValue(false);
    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({
        isUpdateAvailable: true,
        isForceUpdate: false,
        clientVersion: '1.0.0',
        serverVersion: '1.1.0',
        releaseNotes: 'Performance enhancements',
      });
      return () => {};
    });

    await act(async () => {
      root.render(<UpdateNotificationModal />);
    });

    expect(container.textContent).toBe('');
  });

  it('renders soft update banner in standalone app mode when non-breaking update is available', async () => {
    vi.spyOn(platformUtils, 'isStandaloneApp').mockReturnValue(true);
    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({
        isUpdateAvailable: true,
        isForceUpdate: false,
        clientVersion: '1.0.0',
        serverVersion: '1.1.0',
        releaseNotes: 'Performance enhancements',
      });
      return () => {};
    });

    await act(async () => {
      root.render(<UpdateNotificationModal />);
    });

    expect(container.textContent).toContain('Update Available');
    expect(container.textContent).toContain('v1.1.0');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('renders forced update modal with blocking backdrop when force update is required', async () => {
    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({
        isUpdateAvailable: true,
        isForceUpdate: true,
        clientVersion: '0.9.0',
        serverVersion: '1.0.0',
        releaseNotes: 'Breaking architectural changes',
      });
      return () => {};
    });

    await act(async () => {
      root.render(<UpdateNotificationModal />);
    });

    expect(container.textContent).toContain('Update Required');
    expect(container.textContent).toContain('v0.9.0');
    expect(container.textContent).toContain('v1.0.0');
    expect(container.textContent).toContain('Update Apollo Now');
    expect(container.textContent).toContain('Breaking architectural changes');
  });

  it('calls applyUpdate when user clicks update button', async () => {
    const applySpy = vi.spyOn(versionManager, 'applyUpdate').mockResolvedValue(undefined);

    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({
        isUpdateAvailable: true,
        isForceUpdate: true,
        clientVersion: '0.9.0',
        serverVersion: '1.0.0',
      });
      return () => {};
    });

    await act(async () => {
      root.render(<UpdateNotificationModal />);
    });

    const updateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Update Apollo Now')
    );
    expect(updateBtn).toBeDefined();

    await act(async () => {
      updateBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(applySpy).toHaveBeenCalled();
  });
});
