/**
 * Chrome/Safari treat canvases, images, and large DOM snapshots as native
 * drag sources. That ghost-image drag replaces mousemove and breaks custom
 * mouse-drag editors (timeline marquee, clip move/crop, and similar screens).
 */

export function isIntentionalHtml5Drag(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('[draggable="true"]'));
}

export function preventUnwantedNativeDragStart(event) {
  if (isIntentionalHtml5Drag(event)) return false;
  event?.preventDefault?.();
  return true;
}

export function installNativeDragGuard(target = typeof document === 'undefined' ? null : document) {
  if (!target?.addEventListener) return () => {};
  const handleDragStart = (event) => {
    preventUnwantedNativeDragStart(event);
  };
  target.addEventListener('dragstart', handleDragStart);
  return () => target.removeEventListener('dragstart', handleDragStart);
}
