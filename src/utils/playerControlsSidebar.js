/**
 * Player Controls Sidebar state and layout helpers.
 */

export const CONTROLS_SIDEBAR_STORAGE_KEY = 'apollo.playerControlsSidebar';

export const CONTROLS_SIDEBAR_MODES = {
  DEFAULT: 'default',
  MINIMIZED: 'minimized',
};

const MINIMIZED_WIDTH = 64;
const DEFAULT_MIN_WIDTH = 240;

export const CONTROLS_SIDEBAR = {
  MINIMIZED_WIDTH,
  DEFAULT_MIN_WIDTH,
  DEFAULT_MAX_WIDTH: DEFAULT_MIN_WIDTH,
  DEFAULT_WIDTH: DEFAULT_MIN_WIDTH,
  FLIP_WIDTH: Math.round((MINIMIZED_WIDTH + DEFAULT_MIN_WIDTH) / 2),
  TOGGLE_ANIMATION_MS: 100,
};

const DEFAULT_CONTROLS_SIDEBAR_SETTINGS = {
  mode: CONTROLS_SIDEBAR_MODES.DEFAULT,
  width: CONTROLS_SIDEBAR.DEFAULT_WIDTH,
  playbackSpeed: 1.0,
  playbackTranspose: 0.0,
  lastPlaybackTranspose: 1.0,
};

export const PLAYBACK_TRANSPOSE_BOUNDS = {
  MIN: -12,
  MAX: 12,
  STEP: 1,
};

export function normalizePlaybackTransposeValue(transpose) {
  const num = Number(transpose);
  if (!Number.isFinite(num)) return 0.0;
  return Math.max(PLAYBACK_TRANSPOSE_BOUNDS.MIN, Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, num));
}

export function normalizePlaybackSpeedValue(speed) {
  const num = Number(speed);
  if (!Number.isFinite(num) || num <= 0) return 1.0;
  return Math.max(PLAYBACK_SPEED_BOUNDS.MIN, Math.min(PLAYBACK_SPEED_BOUNDS.MAX, num));
}

export function normalizeControlsSidebarMode(value) {
  return value === CONTROLS_SIDEBAR_MODES.MINIMIZED
    ? CONTROLS_SIDEBAR_MODES.MINIMIZED
    : CONTROLS_SIDEBAR_MODES.DEFAULT;
}

export function clampControlsSidebarWidth(width, mode = CONTROLS_SIDEBAR_MODES.DEFAULT) {
  const numeric = Number(width);
  if (mode === CONTROLS_SIDEBAR_MODES.MINIMIZED) {
    return CONTROLS_SIDEBAR.MINIMIZED_WIDTH;
  }
  if (!Number.isFinite(numeric)) return CONTROLS_SIDEBAR.DEFAULT_WIDTH;
  return Math.max(
    CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH,
    Math.min(CONTROLS_SIDEBAR.DEFAULT_MAX_WIDTH, Math.round(numeric))
  );
}

export function normalizeControlsSidebarSettings(settings = {}) {
  const mode = normalizeControlsSidebarMode(settings.mode);
  const speed = settings.playbackSpeed != null
    ? normalizePlaybackSpeedValue(settings.playbackSpeed)
    : DEFAULT_CONTROLS_SIDEBAR_SETTINGS.playbackSpeed;
  const transpose = settings.playbackTranspose != null
    ? normalizePlaybackTransposeValue(settings.playbackTranspose)
    : DEFAULT_CONTROLS_SIDEBAR_SETTINGS.playbackTranspose;
  const lastTranspose = settings.lastPlaybackTranspose != null
    ? normalizePlaybackTransposeValue(settings.lastPlaybackTranspose)
    : (Math.abs(transpose) > 1e-4 ? transpose : DEFAULT_CONTROLS_SIDEBAR_SETTINGS.lastPlaybackTranspose);
  return {
    mode,
    width: clampControlsSidebarWidth(
      settings.width ?? DEFAULT_CONTROLS_SIDEBAR_SETTINGS.width,
      CONTROLS_SIDEBAR_MODES.DEFAULT
    ),
    playbackSpeed: speed,
    playbackTranspose: transpose,
    lastPlaybackTranspose: lastTranspose,
  };
}

export function readControlsSidebarSettings() {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
      return { ...DEFAULT_CONTROLS_SIDEBAR_SETTINGS };
    }
    const raw = localStorage.getItem(CONTROLS_SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONTROLS_SIDEBAR_SETTINGS };
    return normalizeControlsSidebarSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONTROLS_SIDEBAR_SETTINGS };
  }
}

export function writeControlsSidebarSettings(settings) {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    const existing = readControlsSidebarSettings();
    localStorage.setItem(
      CONTROLS_SIDEBAR_STORAGE_KEY,
      JSON.stringify(normalizeControlsSidebarSettings({ ...existing, ...settings }))
    );
  } catch {
    // Ignore storage failures
  }
}

export function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

export function controlsSidebarProgress(width) {
  const span = CONTROLS_SIDEBAR.DEFAULT_MIN_WIDTH - CONTROLS_SIDEBAR.MINIMIZED_WIDTH;
  const numeric = Number(width);
  if (!Number.isFinite(numeric) || span <= 0) return 1;
  return Math.max(0, Math.min(1, (numeric - CONTROLS_SIDEBAR.MINIMIZED_WIDTH) / span));
}

export function resolveControlsSidebarDrag({
  pointerWidth,
}) {
  const measured = Math.round(Number(pointerWidth) || CONTROLS_SIDEBAR.DEFAULT_WIDTH);

  if (measured > CONTROLS_SIDEBAR.FLIP_WIDTH) {
    return {
      mode: CONTROLS_SIDEBAR_MODES.DEFAULT,
      width: clampControlsSidebarWidth(measured),
    };
  }

  return {
    mode: CONTROLS_SIDEBAR_MODES.MINIMIZED,
    width: CONTROLS_SIDEBAR.MINIMIZED_WIDTH,
  };
}

export function commitControlsSidebarDrag({
  mode,
  width,
}) {
  if (normalizeControlsSidebarMode(mode) === CONTROLS_SIDEBAR_MODES.MINIMIZED) {
    return {
      mode: CONTROLS_SIDEBAR_MODES.MINIMIZED,
      width: CONTROLS_SIDEBAR.MINIMIZED_WIDTH,
    };
  }
  return {
    mode: CONTROLS_SIDEBAR_MODES.DEFAULT,
    width: clampControlsSidebarWidth(width),
  };
}

export const PLAYBACK_SPEED_SEQUENCE = [
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
];

export const PLAYBACK_SPEED_BOUNDS = {
  MIN: 0.1,
  MAX: 10,
};

export const PLAYBACK_SPEED_DRAG_BOUNDS = {
  MIN: 0.5,
  MAX: 1.5,
  STEP: 0.01,
};

export function getNextPlaybackSpeed(currentSpeed) {
  const current = Number(currentSpeed);
  if (!Number.isFinite(current)) return PLAYBACK_SPEED_SEQUENCE[0];
  const EPSILON = 0.0001;
  const next = PLAYBACK_SPEED_SEQUENCE.find((step) => step > current + EPSILON);
  if (next !== undefined) {
    return next;
  }
  return PLAYBACK_SPEED_SEQUENCE[0];
}

export function formatPlaybackSpeed(speed) {
  if (speed == null) return '1';
  const num = Number(speed);
  if (!Number.isFinite(num) || num <= 0) return '1';
  const rounded = Number(num.toFixed(2));
  return String(rounded);
}

export function parsePlaybackSpeedInput(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  if (text.includes('/')) return null;

  const hasPercent = text.includes('%');
  const hasX = /x$/i.test(text);
  const cleaned = text.replace(/%/g, '').replace(/x$/i, '').trim();
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;

  let value = parsed;
  if (hasPercent) {
    value = parsed / 100;
  } else if (!hasX && parsed > PLAYBACK_SPEED_BOUNDS.MAX) {
    value = parsed / 100;
  }

  // If user enters 0.83, 0.833, or 83.3%, snap to exact 5 / 6
  if (Math.abs(value - (5 / 6)) < 0.005) {
    return 5 / 6;
  }

  value = Math.max(PLAYBACK_SPEED_BOUNDS.MIN, Math.min(PLAYBACK_SPEED_BOUNDS.MAX, value));
  return Math.round(value * 100) / 100;
}

export function formatPlaybackTranspose(transpose) {
  if (transpose == null) return '0 st';
  const num = Number(transpose);
  if (!Number.isFinite(num) || Math.abs(num) < 1e-4) return '0 st';
  const clamped = Math.max(PLAYBACK_TRANSPOSE_BOUNDS.MIN, Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, num));
  const rounded = Number(clamped.toFixed(2));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded} st`;
}

export function parsePlaybackTransposeInput(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/st$/i, '').replace(/semitones?$/i, '').trim();
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(PLAYBACK_TRANSPOSE_BOUNDS.MIN, Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, parsed));
  return Math.round(clamped * 100) / 100;
}

