import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWaveformRenderer } from '../waveformFeature';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('waveform rollout selection', () => {
  it.each([
    [undefined, '', 'modern'],
    ['modern', '', 'modern'],
    ['legacy', '', 'legacy'],
    ['invalid', '', 'modern'],
    ['LEGACY', '', 'modern'],
    ['modern', '?waveformRenderer=legacy', 'legacy'],
    ['legacy', '?waveformRenderer=modern', 'modern'],
    ['modern', '?other=1&waveformRenderer=legacy&extra=2', 'legacy'],
    ['legacy', '?waveformRenderer=invalid', 'legacy'],
    ['modern', '?waveformRenderer=invalid', 'modern'],
    ['modern', '?waveformRenderer=', 'modern'],
  ])('selects %s / %s -> %s', (buildRenderer, search, expected) => {
    vi.stubEnv('VITE_WAVEFORM_RENDERER', buildRenderer);
    expect(getWaveformRenderer({ search })).toBe(expected);
  });

  it('supports an explicit configuration without browser globals', () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('VITE_WAVEFORM_RENDERER', 'legacy');
    expect(getWaveformRenderer()).toBe('legacy');
    expect(getWaveformRenderer({ buildRenderer: 'modern', search: '' })).toBe('modern');
  });
});
