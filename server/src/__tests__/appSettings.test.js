import { describe, expect, it } from 'vitest';
import {
  getEffectiveAppSettingsForMode,
  normalizeAppSettings,
} from '../appSettings.js';

describe('application show settings', () => {
  it('normalizes empty messages to a usable shared message', () => {
    const settings = normalizeAppSettings({
      noAccessMessage: ' ',
      playerNoAccessMessage: '',
      dawNoAccessMessage: null,
    });

    expect(settings.noAccessMessage).toBe('You do not currently have any permissions. Please contact an admin if you should.');
    expect(settings.playerNoAccessMessage).toBe(settings.noAccessMessage);
    expect(settings.dawNoAccessMessage).toBe(settings.noAccessMessage);
  });

  it('selects mode-specific defaults only when split settings are enabled', () => {
    const settings = {
      defaultShowId: 'show-shared',
      splitPlayerDawDefaults: true,
      playerDefaultShowId: 'show-player',
      dawDefaultShowId: 'show-daw',
      noAccessMessage: 'Shared message.',
      playerNoAccessMessage: 'Player message.',
      dawNoAccessMessage: 'DAW message.',
    };

    expect(getEffectiveAppSettingsForMode(settings, 'player')).toEqual({
      defaultShowId: 'show-player',
      noAccessMessage: 'Player message.',
    });
    expect(getEffectiveAppSettingsForMode(settings, 'daw')).toEqual({
      defaultShowId: 'show-daw',
      noAccessMessage: 'DAW message.',
    });
    expect(getEffectiveAppSettingsForMode(settings, 'shared')).toEqual({
      defaultShowId: 'show-shared',
      noAccessMessage: 'Shared message.',
    });
  });
});
