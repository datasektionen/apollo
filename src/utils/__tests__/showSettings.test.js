import { describe, expect, it } from 'vitest';
import {
  getConfiguredShowId,
  getNoAccessMessage,
  SHOW_SETTINGS_MODES,
} from '../showSettings';

describe('show settings', () => {
  it('uses shared settings when Player and DAW are not split', () => {
    const accessSummary = {
      showSettings: {
        defaultShowId: 'show-main',
        splitPlayerDawDefaults: false,
      },
      emptyAccessMessage: 'No access yet.',
      playerNoAccessMessage: 'Player-specific message should not apply.',
      dawNoAccessMessage: 'DAW-specific message should not apply.',
    };

    expect(getConfiguredShowId(accessSummary, SHOW_SETTINGS_MODES.PLAYER)).toBe('show-main');
    expect(getConfiguredShowId(accessSummary, SHOW_SETTINGS_MODES.DAW)).toBe('show-main');
    expect(getNoAccessMessage(accessSummary, SHOW_SETTINGS_MODES.PLAYER)).toBe('No access yet.');
    expect(getNoAccessMessage(accessSummary, SHOW_SETTINGS_MODES.DAW)).toBe('No access yet.');
  });

  it('uses mode-specific settings when split is enabled', () => {
    const accessSummary = {
      showSettings: {
        splitPlayerDawDefaults: true,
        playerDefaultShowId: 'show-player',
        dawDefaultShowId: 'show-daw',
        playerNoAccessMessage: 'Player has no access.',
        dawNoAccessMessage: 'DAW has no access.',
      },
    };

    expect(getConfiguredShowId(accessSummary, SHOW_SETTINGS_MODES.PLAYER)).toBe('show-player');
    expect(getConfiguredShowId(accessSummary, SHOW_SETTINGS_MODES.DAW)).toBe('show-daw');
    expect(getNoAccessMessage(accessSummary, SHOW_SETTINGS_MODES.PLAYER)).toBe('Player has no access.');
    expect(getNoAccessMessage(accessSummary, SHOW_SETTINGS_MODES.DAW)).toBe('DAW has no access.');
  });
});
