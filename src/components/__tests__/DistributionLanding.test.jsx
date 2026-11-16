import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DistributionLanding from '../DistributionLanding';
import * as versionManager from '../../lib/versionManager';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe('DistributionLanding Component', () => {
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

  it('renders landing page with 3 main categories and no marketing text or header version/button', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DistributionLanding />
        </MemoryRouter>
      );
    });

    // Brand logo
    const brandLogo = container.querySelector('img[alt="Apollo"]');
    expect(brandLogo).not.toBeNull();

    // No version in header
    const header = container.querySelector('header');
    expect(header.textContent).not.toContain('v1.0.0');
    expect(header.textContent).not.toContain('Open Web Player');

    // 3 main categories with bigger titles
    expect(container.textContent).toContain('Mobile');
    expect(container.textContent).toContain('Desktop');
    expect(container.textContent).toContain('If you have no space or trust and are with a slightly to significantly worse experince');

    // No footer
    expect(container.querySelector('footer')).toBeNull();

    // Platforms
    expect(container.textContent).toContain('Android');
    expect(container.textContent).toContain('iPhone / iPad');
    expect(container.textContent).toContain('macOS');
    expect(container.textContent).toContain('Windows');
    expect(container.textContent).toContain('Linux');

    // Web option under Alternative at bottom
    expect(container.textContent).toContain('Web');
  });

  it('provides Android APK download directly via link brick with no step guide', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DistributionLanding />
        </MemoryRouter>
      );
    });

    const downloadLinks = container.querySelectorAll('a[href="/apollo.apk"]');
    expect(downloadLinks.length).toBeGreaterThan(0);
    expect(downloadLinks[0].getAttribute('download')).toBe('apollo.apk');
  });

  it('switches top guide to iOS when clicking iPhone / iPad brick', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DistributionLanding />
        </MemoryRouter>
      );
    });

    const iosBrick = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('iPhone / iPad')
    );
    expect(iosBrick).toBeDefined();

    await act(async () => {
      iosBrick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Top guide shows iOS Safari steps
    expect(container.textContent).toContain('Safari PWA');
    expect(container.textContent).toContain('Add to Home Screen');
  });

  it('switches top guide to Windows when clicking Windows brick', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DistributionLanding />
        </MemoryRouter>
      );
    });

    const winBrick = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Windows')
    );
    expect(winBrick).toBeDefined();

    await act(async () => {
      winBrick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Desktop PWA');
  });

  it('links to external GitHub Release APK when configured in version manager', async () => {
    const customUrl = 'https://github.com/datasektionen/apollo/releases/latest/download/apollo.apk';
    vi.spyOn(versionManager, 'getVersionState').mockReturnValue({ apkUrl: customUrl });
    vi.spyOn(versionManager, 'subscribeVersionStatus').mockImplementation((cb) => {
      cb({ apkUrl: customUrl });
      return () => {};
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DistributionLanding />
        </MemoryRouter>
      );
    });

    const releaseLinks = Array.from(container.querySelectorAll(`a[href="${customUrl}"]`));
    expect(releaseLinks.length).toBeGreaterThan(0);
    expect(releaseLinks.some((l) => l.textContent.includes('Android'))).toBe(true);

    // Clicking Android card should also activate top guide with direct download button
    await act(async () => {
      releaseLinks[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const allReleaseLinks = Array.from(container.querySelectorAll(`a[href="${customUrl}"]`));
    expect(allReleaseLinks.some((l) => l.textContent.includes('Download APK'))).toBe(true);
  });
});
