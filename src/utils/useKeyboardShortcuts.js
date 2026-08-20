import { useEffect } from 'react';
import { isPrimaryModifierPressed, isTextEntryTarget } from './keyboard';

/**
 * Keyboard shortcuts hook
 * Handles global keyboard shortcuts for the editor
 */
function useKeyboardShortcuts({
  enabled = false,
  onPlayPause,
  onStop,
  onRecord,
  onUndo,
  onRedo,
  onToggleLoop,
  onDeleteTrack,
  onAddTrack,
  onAddSubtrack,
  onIndentRight,
  onIndentLeft,
  onToggleFold,
  onToggleFoldRecursive,
}) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Space toggles play/pause and suppresses native button activation.
      // Text fields, checkboxes, and selects keep their native Space behavior.
      if (e.code === 'Space') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTextEntryTarget(e)) return;
        e.preventDefault();
        if (e.repeat) return;
        onPlayPause?.();
        return;
      }

      // Ignore if typing in an input field
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }

      // R - Record
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onRecord?.();
      }

      // L - Toggle Loop
      if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleLoop?.();
      }

      // Ctrl/Cmd + Z - Undo
      if (e.code === 'KeyZ' && isPrimaryModifierPressed(e) && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
      }

      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo
      if (
        (e.code === 'KeyY' && isPrimaryModifierPressed(e)) ||
        (e.code === 'KeyZ' && isPrimaryModifierPressed(e) && e.shiftKey)
      ) {
        e.preventDefault();
        onRedo?.();
      }

      // Ctrl/Cmd + Backspace - Delete selected track
      if (e.code === 'Backspace' && isPrimaryModifierPressed(e)) {
        e.preventDefault();
        onDeleteTrack?.();
      }

      // Ctrl/Cmd + Right - Indent selected row
      if (e.code === 'ArrowRight' && isPrimaryModifierPressed(e) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onIndentRight?.();
      }

      // Ctrl/Cmd + Left - Outdent selected row
      if (e.code === 'ArrowLeft' && isPrimaryModifierPressed(e) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onIndentLeft?.();
      }

      // N - Create new track (from selected track position)
      // Shift+N - Create new subtrack (convert selected empty track into group)
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          onAddSubtrack?.();
        } else {
          onAddTrack?.();
        }
      }

      // F - Toggle fold for selected/parent group
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        if (e.altKey && e.shiftKey) {
          e.preventDefault();
          onToggleFoldRecursive?.();
          return;
        }
        if (!e.altKey && !e.shiftKey) {
          e.preventDefault();
          onToggleFold?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    enabled,
    onPlayPause,
    onStop,
    onRecord,
    onUndo,
    onRedo,
    onToggleLoop,
    onDeleteTrack,
    onAddTrack,
    onAddSubtrack,
    onIndentRight,
    onIndentLeft,
    onToggleFold,
    onToggleFoldRecursive,
  ]);
}

export default useKeyboardShortcuts;
