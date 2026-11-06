import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DawSettingsPanel } from '../SettingsPanels';
import { DAW_VIEW_STORAGE_KEY, normalizeDawViewSettings, useDawViewSettings } from '../../hooks/useDawViewSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  const saved = new Map();
  globalThis.localStorage = {
    getItem: (key) => (saved.has(key) ? saved.get(key) : null),
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
  };
});
afterEach(() => {
  localStorage.removeItem(DAW_VIEW_STORAGE_KEY);
});

describe('DAW view settings', () => {
  it('keeps only the waveform choices and restores them', () => {
    expect(normalizeDawViewSettings({ displayMode: 'db', showRms: true, showClipping: true, stereo: true, showSamples: true }))
      .toEqual({ displayMode: 'db', showRms: true, showClipping: true, stereo: true });
    expect(normalizeDawViewSettings({ displayMode: 'fancy' }).displayMode).toBe('linear');
    expect(normalizeDawViewSettings({}).stereo).toBe(false);
  });

  it('edits the choices from the settings panel and stores them for the next visit', async () => {
    localStorage.setItem(DAW_VIEW_STORAGE_KEY, JSON.stringify({ displayMode: 'normalized', showRms: true }));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let current;
    function Harness() {
      const [settings, setSettings] = useDawViewSettings();
      current = settings;
      return <DawSettingsPanel settings={settings} setSettings={setSettings} />;
    }
    await act(async () => { root.render(<Harness />); });
    expect(current).toEqual({ displayMode: 'normalized', showRms: true, showClipping: false, stereo: false });
    const select = container.querySelector('select');
    select.value = 'db';
    await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
    const stereoInput = [...container.querySelectorAll('label')]
      .find((label) => label.textContent.includes('Stereo waveforms')).querySelector('input');
    await act(async () => stereoInput.click());
    const clipping = [...container.querySelectorAll('label')]
      .find((label) => label.textContent.includes('Source over-range')).querySelector('input');
    await act(async () => clipping.click());
    expect(current).toEqual({ displayMode: 'db', showRms: true, showClipping: true, stereo: true });
    expect(JSON.parse(localStorage.getItem(DAW_VIEW_STORAGE_KEY))).toEqual(current);
    await act(async () => root.unmount());
    container.remove();
  });
});
