import { describe, expect, it } from 'vitest';
import {
  CONTROLS_SIDEBAR,
  CONTROLS_SIDEBAR_MODES,
  PLAYBACK_SPEED_BOUNDS,
  PLAYBACK_SPEED_DRAG_BOUNDS,
  PLAYBACK_SPEED_SEQUENCE,
  PLAYBACK_TRANSPOSE_BOUNDS,
  clampControlsSidebarWidth,
  commitControlsSidebarDrag,
  controlsSidebarProgress,
  formatPlaybackSpeed,
  formatPlaybackTranspose,
  getNextPlaybackSpeed,
  normalizeControlsSidebarMode,
  normalizeControlsSidebarSettings,
  normalizePlaybackTransposeValue,
  parsePlaybackSpeedInput,
  parsePlaybackTransposeInput,
  resolveControlsSidebarDrag,
} from '../playerControlsSidebar';

describe('playerControlsSidebar utils', () => {
  it('normalizes modes properly', () => {
    expect(normalizeControlsSidebarMode('minimized')).toBe(CONTROLS_SIDEBAR_MODES.MINIMIZED);
    expect(normalizeControlsSidebarMode('default')).toBe(CONTROLS_SIDEBAR_MODES.DEFAULT);
    expect(normalizeControlsSidebarMode('unknown')).toBe(CONTROLS_SIDEBAR_MODES.DEFAULT);
  });

  it('clamps width correctly for default and minimized modes', () => {
    expect(clampControlsSidebarWidth(100, CONTROLS_SIDEBAR_MODES.MINIMIZED)).toBe(CONTROLS_SIDEBAR.MINIMIZED_WIDTH);
    expect(clampControlsSidebarWidth(100, CONTROLS_SIDEBAR_MODES.DEFAULT)).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
    expect(clampControlsSidebarWidth(500, CONTROLS_SIDEBAR_MODES.DEFAULT)).toBe(CONTROLS_SIDEBAR.DEFAULT_MAX_WIDTH);
    // When max is the same as min when expanded:
    expect(CONTROLS_SIDEBAR.DEFAULT_MAX_WIDTH).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
    expect(clampControlsSidebarWidth(280, CONTROLS_SIDEBAR_MODES.DEFAULT)).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
  });

  it('normalizes settings object', () => {
    const normalized = normalizeControlsSidebarSettings({
      mode: 'minimized',
      width: 300,
      playbackSpeed: 0.75,
      playbackTranspose: 2.5,
      lastPlaybackTranspose: 3.5,
    });
    expect(normalized.mode).toBe(CONTROLS_SIDEBAR_MODES.MINIMIZED);
    expect(normalized.width).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
    expect(normalized.playbackSpeed).toBe(0.75);
    expect(normalized.playbackTranspose).toBe(2.5);
    expect(normalized.lastPlaybackTranspose).toBe(3.5);

    const defaultNormalized = normalizeControlsSidebarSettings({});
    expect(defaultNormalized.playbackSpeed).toBe(1.0);
    expect(defaultNormalized.playbackTranspose).toBe(0.0);
    expect(defaultNormalized.lastPlaybackTranspose).toBe(1.0);
  });

  it('calculates progress between minimized and default_min', () => {
    expect(controlsSidebarProgress(CONTROLS_SIDEBAR.MINIMIZED_WIDTH)).toBe(0);
    expect(controlsSidebarProgress(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH)).toBe(1);
    expect(controlsSidebarProgress(CONTROLS_SIDEBAR.FLIP_WIDTH)).toBeCloseTo(0.5, 1);
  });

  it('resolves dragging with flip threshold', () => {
    const underThreshold = resolveControlsSidebarDrag({ pointerWidth: CONTROLS_SIDEBAR.FLIP_WIDTH - 10 });
    expect(underThreshold.mode).toBe(CONTROLS_SIDEBAR_MODES.MINIMIZED);
    expect(underThreshold.width).toBe(CONTROLS_SIDEBAR.MINIMIZED_WIDTH);

    const overThreshold = resolveControlsSidebarDrag({ pointerWidth: CONTROLS_SIDEBAR.FLIP_WIDTH + 10 });
    expect(overThreshold.mode).toBe(CONTROLS_SIDEBAR_MODES.DEFAULT);
    expect(overThreshold.width).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);

    const customWidth = resolveControlsSidebarDrag({ pointerWidth: 300 });
    expect(customWidth.mode).toBe(CONTROLS_SIDEBAR_MODES.DEFAULT);
    expect(customWidth.width).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
  });

  it('commits drag values cleanly', () => {
    const committedMin = commitControlsSidebarDrag({ mode: 'minimized', width: 300 });
    expect(committedMin.mode).toBe(CONTROLS_SIDEBAR_MODES.MINIMIZED);
    expect(committedMin.width).toBe(CONTROLS_SIDEBAR.MINIMIZED_WIDTH);

    const committedDef = commitControlsSidebarDrag({ mode: 'default', width: 320 });
    expect(committedDef.mode).toBe(CONTROLS_SIDEBAR_MODES.DEFAULT);
    expect(committedDef.width).toBe(CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH);
  });

  describe('playback speed helpers', () => {
    it('defines exact sequence as requested', () => {
      expect(PLAYBACK_SPEED_SEQUENCE).toEqual([
        0.5,
        0.65,
        0.75,
        5 / 6,
        0.9,
        0.95,
        1,
        1.05,
        1.1,
        1.25,
        1.5,
      ]);
      expect(PLAYBACK_SPEED_BOUNDS).toEqual({ MIN: 0.1, MAX: 10 });
      expect(PLAYBACK_SPEED_DRAG_BOUNDS).toEqual({ MIN: 0.5, MAX: 1.5, STEP: 0.01 });
    });

    it('cycles through sequence to the next bigger step, wrapping to 0.5', () => {
      expect(getNextPlaybackSpeed(0.5)).toBe(0.65);
      expect(getNextPlaybackSpeed(0.65)).toBe(0.75);
      expect(getNextPlaybackSpeed(0.75)).toBe(5 / 6);
      expect(getNextPlaybackSpeed(5 / 6)).toBe(0.9);
      expect(getNextPlaybackSpeed(0.9)).toBe(0.95);
      expect(getNextPlaybackSpeed(0.95)).toBe(1);
      expect(getNextPlaybackSpeed(1)).toBe(1.05);
      expect(getNextPlaybackSpeed(1.05)).toBe(1.1);
      expect(getNextPlaybackSpeed(1.1)).toBe(1.25);
      expect(getNextPlaybackSpeed(1.25)).toBe(1.5);
      expect(getNextPlaybackSpeed(1.5)).toBe(0.5);
    });

    it('handles intermediate or out-of-sequence speeds by selecting next bigger step', () => {
      expect(getNextPlaybackSpeed(0.1)).toBe(0.5);
      expect(getNextPlaybackSpeed(0.7)).toBe(0.75);
      expect(getNextPlaybackSpeed(0.8)).toBe(5 / 6);
      expect(getNextPlaybackSpeed(0.83)).toBe(5 / 6);
      expect(getNextPlaybackSpeed(1.2)).toBe(1.25);
      expect(getNextPlaybackSpeed(1.4)).toBe(1.5);
      expect(getNextPlaybackSpeed(1.8)).toBe(0.5);
      expect(getNextPlaybackSpeed(10)).toBe(0.5);
    });

    it('formats playback speed correctly rounded to 2 decimals without x', () => {
      expect(formatPlaybackSpeed(1)).toBe('1');
      expect(formatPlaybackSpeed(0.5)).toBe('0.5');
      expect(formatPlaybackSpeed(5 / 6)).toBe('0.83');
      expect(formatPlaybackSpeed(0.833333)).toBe('0.83');
      expect(formatPlaybackSpeed(1.05)).toBe('1.05');
      expect(formatPlaybackSpeed(2.5)).toBe('2.5');
      expect(formatPlaybackSpeed(10)).toBe('10');
      expect(formatPlaybackSpeed(0.1)).toBe('0.1');
      expect(formatPlaybackSpeed(null)).toBe('1');
    });

    it('parses manual speed inputs within bounds 0.1 to 10', () => {
      // standard decimal
      expect(parsePlaybackSpeedInput('.5')).toBe(0.5);
      expect(parsePlaybackSpeedInput('0.65')).toBe(0.65);
      expect(parsePlaybackSpeedInput('0.83')).toBe(5 / 6);
      expect(parsePlaybackSpeedInput('0.833')).toBe(5 / 6);
      expect(parsePlaybackSpeedInput('1')).toBe(1);
      expect(parsePlaybackSpeedInput('1.05')).toBe(1.05);
      expect(parsePlaybackSpeedInput('1.5x')).toBe(1.5);
      expect(parsePlaybackSpeedInput('2.5')).toBe(2.5);
      expect(parsePlaybackSpeedInput('10')).toBe(10);
      expect(parsePlaybackSpeedInput('0.1')).toBe(0.1);

      // does not support division
      expect(parsePlaybackSpeedInput('5/6')).toBeNull();
      expect(parsePlaybackSpeedInput('1/2')).toBeNull();

      // clamping
      expect(parsePlaybackSpeedInput('0.05')).toBe(0.1);
      expect(parsePlaybackSpeedInput('12x')).toBe(10);

      // percentages
      expect(parsePlaybackSpeedInput('150%')).toBe(1.5);
      expect(parsePlaybackSpeedInput('75%')).toBe(0.75);
      expect(parsePlaybackSpeedInput('83.3%')).toBe(5 / 6);
      expect(parsePlaybackSpeedInput('100')).toBe(1); // treated as 100% since > 10
      expect(parsePlaybackSpeedInput('80')).toBe(0.8); // treated as 80% since > 10

      // invalid
      expect(parsePlaybackSpeedInput('')).toBeNull();
      expect(parsePlaybackSpeedInput('   ')).toBeNull();
      expect(parsePlaybackSpeedInput('abc')).toBeNull();
    });
  });

  describe('playback transpose helpers', () => {
    it('defines bounds correctly [-12, 12]', () => {
      expect(PLAYBACK_TRANSPOSE_BOUNDS).toEqual({ MIN: -12, MAX: 12, STEP: 1 });
    });

    it('normalizes transpose values clamping between -12 and +12', () => {
      expect(normalizePlaybackTransposeValue(0)).toBe(0);
      expect(normalizePlaybackTransposeValue(2.5)).toBe(2.5);
      expect(normalizePlaybackTransposeValue(-3.75)).toBe(-3.75);
      expect(normalizePlaybackTransposeValue(15)).toBe(12);
      expect(normalizePlaybackTransposeValue(-20)).toBe(-12);
      expect(normalizePlaybackTransposeValue('invalid')).toBe(0);
    });

    it('formats transpose semitones accurately', () => {
      expect(formatPlaybackTranspose(0)).toBe('0 st');
      expect(formatPlaybackTranspose(2)).toBe('+2 st');
      expect(formatPlaybackTranspose(2.5)).toBe('+2.5 st');
      expect(formatPlaybackTranspose(-1.25)).toBe('-1.25 st');
      expect(formatPlaybackTranspose(12)).toBe('+12 st');
      expect(formatPlaybackTranspose(-12)).toBe('-12 st');
      expect(formatPlaybackTranspose(null)).toBe('0 st');
    });

    it('parses manual transpose inputs allowing decimal values clamped to [-12, 12]', () => {
      expect(parsePlaybackTransposeInput('0')).toBe(0);
      expect(parsePlaybackTransposeInput('+2')).toBe(2);
      expect(parsePlaybackTransposeInput('3.5')).toBe(3.5);
      expect(parsePlaybackTransposeInput('-2.75')).toBe(-2.75);
      expect(parsePlaybackTransposeInput('+1.2 st')).toBe(1.2);
      expect(parsePlaybackTransposeInput('-4 semitones')).toBe(-4);
      expect(parsePlaybackTransposeInput('15')).toBe(12);
      expect(parsePlaybackTransposeInput('-25')).toBe(-12);
      expect(parsePlaybackTransposeInput('')).toBeNull();
      expect(parsePlaybackTransposeInput('abc')).toBeNull();
    });
  });
});
