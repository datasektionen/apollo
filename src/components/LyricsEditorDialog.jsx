import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createId } from '../utils/id';
import { mergeLyricTextLines } from '../utils/lyricText';
import { pruneShortEmptyLyricLines } from '../utils/lyricTimeline';

function LyricsEditorDialog({ open, project, updateProject, canEditLyrics = false, onClose }) {
  const [text, setText] = useState('');
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const textareaRef = useRef(null);
  const projectId = project?.projectId;

  useEffect(() => {
    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    setText((project?.lyrics?.lines || []).map((line) => line.text).join('\n'));
    const resetCaret = () => textareaRef.current?.setSelectionRange(0, 0);
    const usesAnimationFrame = typeof window.requestAnimationFrame === 'function';
    const resetHandle = usesAnimationFrame
      ? window.requestAnimationFrame(resetCaret)
      : window.setTimeout(resetCaret, 0);
    return () => {
      if (usesAnimationFrame) window.cancelAnimationFrame(resetHandle);
      else window.clearTimeout(resetHandle);
    };
  }, [open, projectId]);

  const textLines = text.split('\n');
  const longestLineLength = textLines.reduce((longest, line) => Math.max(longest, line.length), 0);
  const desiredWidth = Math.max(384, Math.min(720, Math.ceil(longestLineLength / 10) * 10 * 8.4 + 96));
  const dialogWidth = Math.min(desiredWidth, Math.max(280, viewportSize.width - 32));
  const maxTextareaRows = Math.max(4, Math.floor((viewportSize.height * 0.92 - 112) / 24));
  const textareaRows = Math.min(Math.max(4, textLines.length), maxTextareaRows);

  if (!open) return null;

  const buildLines = () => mergeLyricTextLines(text, project?.lyrics?.lines || [], createId);

  const closeAndSave = () => {
    if (canEditLyrics) {
      const existing = project?.lyrics?.lines || [];
      const existingText = existing.map((line) => line.text).join('\n');
      if (text !== existingText) {
        const durationMs = (project?.tracks || []).reduce((projectEnd, track) => (
          (track.clips || []).reduce((trackEnd, clip) => Math.max(
            trackEnd,
            Number(clip.timelineStartMs || 0) + Math.max(0, Number(clip.cropEndMs || 0) - Number(clip.cropStartMs || 0)),
          ), projectEnd)
        ), 0);
        const lines = pruneShortEmptyLyricLines(buildLines(), durationMs);
        updateProject((current) => ({
          ...current,
          lyrics: { ...(current.lyrics || {}), lines },
        }), 'Edit lyric text');
      }
    }
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAndSave();
      }}
    >
      <section
        className="flex max-h-[92vh] max-w-full flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 text-white shadow-2xl"
        style={{ width: `${dialogWidth}px`, maxWidth: 'calc(100vw - 2rem)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeAndSave();
          }
        }}
      >
        <header className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <h2 id="lyrics-dialog-title" className="text-base font-semibold">Lyrics</h2>
          <button className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white" onClick={closeAndSave} aria-label="Close lyrics editor">
            <X size={19} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4">
          <textarea
            ref={textareaRef}
            autoFocus
            value={text}
            disabled={!canEditLyrics}
            onChange={(event) => setText(event.target.value)}
            rows={textareaRows}
            placeholder={'One lyric line per row'}
            className="w-full resize-y rounded border border-gray-600 bg-gray-900 p-3 font-mono text-sm leading-6 text-white placeholder:text-gray-500 focus:border-gray-600 focus:outline-none focus:ring-0 disabled:opacity-50"
            aria-label="Lyrics, one line per row"
          />
        </div>

      </section>
    </div>
  );
}

export default LyricsEditorDialog;
