function isApplePlatform() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isPrimaryModifierPressed(event) {
  if (!event) return false;
  return isApplePlatform() ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
}

const NATIVE_SPACE_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'color',
]);

const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'password',
  'email',
  'url',
  'tel',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

/**
 * True when Space should type or use a native form control instead of play/pause.
 * Buttons and range sliders return false so Space can toggle transport.
 */
export function isTextEntryTarget(event) {
  const target = event?.target;
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;

  const tagName = String(target.tagName || '').toUpperCase();
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName !== 'INPUT') return false;

  const type = String(target.type || 'text').toLowerCase();
  return NATIVE_SPACE_INPUT_TYPES.has(type) || TEXT_ENTRY_INPUT_TYPES.has(type);
}

