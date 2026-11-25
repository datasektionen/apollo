import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Plus, X } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import { SUPPORTED_IMPORT_ACCEPT } from '../lib/mediaEncoding';
import { createId } from '../utils/id';
import { isPrimaryModifierPressed } from '../utils/keyboard';
import ImportTrackMap from './ImportTrackMap';
import {
  IMPORT_DESTINATION_MODES,
  IMPORT_FILE_DRAG_TYPE,
  IMPORT_PARENT_NONE,
  assignImportDrop,
  destinationReplacesAudio,
  getImportAncestorPath,
  getImportParentKey,
  getImportSlotKey,
  importDestinationLocksType,
  guessImportDestinations,
  indentImportDestination,
  listImportTree,
  outdentImportDestination,
  toggleImportTrackReplaceMode,
} from '../utils/importTrackMatch';

function FileImport({
  onImport,
  onClose,
  project = null,
  manualChoirPartsEnabled = false,
  canCreateTracks = true,
  canEditTrack = null,
  canCreateTrackForDestination = null,
}) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const fileInputRef = useRef(null);

  const importTree = useMemo(() => listImportTree(project), [project]);

  useEffect(() => {
    if (files.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(null);
  }, [files, selectedEntryId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isPrimaryModifierPressed(event) || event.altKey || event.shiftKey) return;
      if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return;
      const entry = files.find((candidate) => candidate.id === selectedEntryId);
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.code === 'ArrowRight'
        ? indentImportDestination(entry.destination, importTree.nodes)
        : outdentImportDestination(entry.destination, importTree.nodes);
      const slotKey = getImportSlotKey(entry.destination, importTree.nodes);
      setFiles((prev) => prev.map((candidate) => (
        getImportSlotKey(candidate.destination, importTree.nodes) === slotKey
          ? { ...candidate, destination: { ...next } }
          : candidate
      )));
      setShowReplaceConfirm(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [files, selectedEntryId, importTree.nodes]);

  const choirRoleOptions = manualChoirPartsEnabled
    ? [
      { value: TRACK_ROLES.CHOIR, label: 'Choir' },
      { value: TRACK_ROLES.CHOIR_PART_1, label: 'Choir Part 1' },
      { value: TRACK_ROLES.CHOIR_PART_2, label: 'Choir Part 2' },
      { value: TRACK_ROLES.CHOIR_PART_3, label: 'Choir Part 3' },
      { value: TRACK_ROLES.CHOIR_PART_4, label: 'Choir Part 4' },
      { value: TRACK_ROLES.CHOIR_PART_5, label: 'Choir Part 5' },
    ]
    : [{ value: TRACK_ROLES.CHOIR, label: 'Choir' }];

  const roleOptions = [
    { value: TRACK_ROLES.INSTRUMENT, label: 'Instrument' },
    { value: TRACK_ROLES.LEAD, label: 'Lead' },
    ...choirRoleOptions,
    { value: TRACK_ROLES.METRONOME, label: 'Metronome' },
    { value: TRACK_ROLES.OTHER, label: 'Other' },
  ];

  const isInternalFileDrag = (e) => (
    Array.from(e.dataTransfer?.types || []).includes(IMPORT_FILE_DRAG_TYPE)
  );

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInternalFileDrag(e)) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isInternalFileDrag(e)) return;

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
      const ext = file.name.toLowerCase().split('.').pop();
      return ['wav', 'mp3', 'flac', 'ogg'].includes(ext);
    });

    handleFiles(droppedFiles);
  };

  const handleFileInput = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    handleFiles(selectedFiles);
    e.target.value = '';
  };

  const handleFiles = (newFiles) => {
    if (!newFiles.length) return;
    setShowReplaceConfirm(false);

    setFiles((prev) => {
      const claimedTrackIds = prev
        .map((entry) => entry.destination)
        .filter((destination) => (
          (destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
            || destination?.mode === IMPORT_DESTINATION_MODES.APPEND)
          && destination.trackId
        ))
        .map((destination) => destination.trackId);
      const destinations = guessImportDestinations(
        newFiles.map((file) => file.name),
        project,
        { claimedTrackIds },
      );
      const entries = newFiles.map((file, index) => ({
        id: createId(),
        file,
        destination: destinations[index],
      }));
      return [...prev, ...entries];
    });
  };

  const removeFile = (entryId) => {
    setFiles((prev) => prev.filter((entry) => entry.id !== entryId));
    setShowReplaceConfirm(false);
    setSelectedEntryId((current) => (current === entryId ? null : current));
  };

  const updateDestination = (entryId, destination) => {
    setFiles((prev) => prev.map((entry) => (
      entry.id === entryId ? { ...entry, destination } : entry
    )));
    setShowReplaceConfirm(false);
  };

  const replaceEntries = files.filter((entry) => destinationReplacesAudio(entry.destination, project));

  // Permission check mirroring Editor.handleFileImport / server write rules:
  // importing into an existing track needs edit access to that track, any
  // other destination creates a new track.
  const destinationAllowed = (destination) => {
    const targetsExisting = destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
      || destination?.mode === IMPORT_DESTINATION_MODES.APPEND;
    if (targetsExisting && destination?.trackId) {
      return typeof canEditTrack === 'function' ? Boolean(canEditTrack(destination.trackId)) : true;
    }
    if (typeof canCreateTrackForDestination === 'function') {
      return Boolean(canCreateTrackForDestination(destination));
    }
    return Boolean(canCreateTracks);
  };
  const blockedEntries = files.filter((entry) => !destinationAllowed(entry.destination));

  const runImport = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    try {
      await onImport(files.map((entry) => ({
        file: entry.file,
        destination: entry.destination,
      })));
      setFiles([]);
      setShowReplaceConfirm(false);
      onClose();
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    if (replaceEntries.length > 0 && !showReplaceConfirm) {
      setShowReplaceConfirm(true);
      return;
    }
    await runImport();
  };

  const destinationLabel = (entry) => {
    const destination = entry.destination;
    const parentKey = getImportParentKey(destination);
    const pathLabel = getImportAncestorPath(parentKey, importTree.nodes);
    if (parentKey === IMPORT_PARENT_NONE) {
      const roleLabel = roleOptions.find((option) => option.value === destination?.role)?.label;
      return roleLabel ? `New root · ${roleLabel}` : 'New root track';
    }
    if (destination?.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING) {
      return `New track beside ${pathLabel}`;
    }
    if (destination?.mode === IMPORT_DESTINATION_MODES.APPEND) {
      return `Append to ${pathLabel}`;
    }
    if (destination?.mode === IMPORT_DESTINATION_MODES.NEW_CHILD) {
      return `New child of ${pathLabel}`;
    }
    return pathLabel;
  };

  return (
    <div
      className="player-theme daw-theme fixed inset-0 bg-[var(--player-bg-scrim)] backdrop-blur-sm flex items-center justify-center z-[80] p-4"
      data-player-theme="dark-gold"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isInternalFileDrag(e)) return;
        const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
          const ext = file.name.toLowerCase().split('.').pop();
          return ['wav', 'mp3', 'flac', 'ogg'].includes(ext);
        });
        handleFiles(droppedFiles);
      }}
    >
      <div
        className={`bg-[var(--player-bg-surface)] border border-[var(--player-border-strong)] rounded-2xl ${
          files.length === 0 ? 'max-w-xl' : 'max-w-3xl'
        } w-full max-h-[90vh] overflow-hidden flex flex-col text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)] ${
          isDragging ? 'ring-2 ring-[var(--player-accent)] ring-inset' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="px-6 py-4 border-b border-[var(--player-border-subtle)] flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Import Audio Files</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--player-text-muted)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={SUPPORTED_IMPORT_ACCEPT}
            onChange={handleFileInput}
            className="hidden"
          />

          {files.length === 0 ? (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                isDragging
                  ? 'border-[var(--player-accent)] bg-[var(--player-accent-soft)]'
                  : 'border-[var(--player-border-default)] hover:border-[var(--player-border-strong)] bg-[var(--player-bg-surface-subtle)]'
              }`}
            >
              <Download size={44} className="mx-auto mb-4 text-[var(--player-accent-text)] opacity-80" />
              <p className="text-lg font-medium mb-1.5 text-[var(--player-text-primary)]">Drag and drop audio files here</p>
              <p className="text-sm text-[var(--player-text-muted)] mb-4">or</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="player-play-cta inline-block px-6 py-2 rounded-lg text-sm font-semibold cursor-pointer"
              >
                Choose Files
              </button>
              <p className="text-xs text-[var(--player-text-muted)] mt-4">Supported: WAV, FLAC, MP3, OGG/Vorbis</p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold text-[var(--player-text-secondary)]">
                Files to Import ({files.length})
              </h3>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] hover:bg-[var(--player-hover)] text-[var(--player-text-primary)] text-sm px-3 py-1.5 transition-colors"
                title="Add more audio files"
              >
                <Plus size={14} />
                Add files
              </button>
            </div>
          )}

          {files.length > 0 && (
            <ImportTrackMap
              nodes={importTree.nodes}
              files={files}
              project={project}
              roleOptions={roleOptions}
              onFileDragStart={setSelectedEntryId}
              onToggleTrackReplace={(trackId) => {
                setFiles((prev) => toggleImportTrackReplaceMode(prev, trackId, project));
                setShowReplaceConfirm(false);
              }}
              onAssignDrop={(entryId, drop) => {
                const entry = files.find((candidate) => candidate.id === entryId);
                if (!entry) return;
                let next = assignImportDrop(entry.destination, drop, importTree.nodes);
                if (
                  (next.mode === IMPORT_DESTINATION_MODES.EXISTING
                    || next.mode === IMPORT_DESTINATION_MODES.APPEND)
                  && next.trackId
                ) {
                  const other = files.find((candidate) => (
                    candidate.id !== entryId
                    && (candidate.destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
                      || candidate.destination?.mode === IMPORT_DESTINATION_MODES.APPEND)
                    && candidate.destination.trackId === next.trackId
                  ));
                  if (other) {
                    next = { ...next, mode: other.destination.mode };
                  }
                }
                updateDestination(entryId, next);
                setSelectedEntryId(entryId);
              }}
              onChangeRole={(destination, role) => {
                if (!destination) return;
                if (importDestinationLocksType(destination, importTree.nodes)) return;
                const slotKey = getImportSlotKey(destination, importTree.nodes);
                setFiles((prev) => prev.map((entry) => (
                  getImportSlotKey(entry.destination, importTree.nodes) === slotKey
                    ? { ...entry, destination: { ...entry.destination, role } }
                    : entry
                )));
                setShowReplaceConfirm(false);
              }}
              onRemoveFile={removeFile}
            />
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--player-border-subtle)] flex items-center justify-between">
          <p className={`text-sm ${blockedEntries.length ? 'text-[var(--player-warning-text)]' : 'text-[var(--player-text-muted)]'}`}>
            {blockedEntries.length
              ? `${blockedEntries.length} file${blockedEntries.length > 1 ? 's' : ''} target${blockedEntries.length > 1 ? '' : 's'} a track you cannot ${canCreateTracks ? 'edit' : 'create or edit'}`
              : files.length > 0
                ? `${files.length} file${files.length > 1 ? 's' : ''} ready to import`
                : 'No files selected'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] hover:bg-[var(--player-hover)] text-sm text-[var(--player-text-primary)] transition-colors"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                files.length === 0 || isProcessing || blockedEntries.length > 0
                  ? 'border border-transparent bg-white/[0.04] text-[var(--player-text-disabled)] cursor-not-allowed'
                  : 'player-play-cta'
              }`}
              disabled={files.length === 0 || isProcessing || blockedEntries.length > 0}
              title={blockedEntries.length ? 'Change the destination of the highlighted files first' : undefined}
            >
              {isProcessing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>

      {showReplaceConfirm && replaceEntries.length > 0 ? (
        <div
          className="absolute inset-0 z-[60] bg-[var(--player-bg-scrim)] backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overwrite-confirm-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="bg-[var(--player-bg-surface)] rounded-2xl max-w-md w-full border border-[var(--player-border-strong)] text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]">
            <div className="px-5 py-4 border-b border-[var(--player-border-subtle)] flex items-start gap-3">
              <AlertTriangle size={20} className="text-[var(--player-warning-text)] flex-shrink-0 mt-0.5" />
              <div>
                <h3 id="overwrite-confirm-title" className="text-lg font-semibold">
                  Overwrite existing audio?
                </h3>
                <p className="text-sm text-[var(--player-text-secondary)] mt-1">
                  {replaceEntries.length} file{replaceEntries.length > 1 ? 's' : ''} will overwrite existing track audio. This cannot be undone from this dialog.
                </p>
              </div>
            </div>
            <ul className="px-5 py-3 space-y-1 text-sm text-[var(--player-text-body)] max-h-40 overflow-auto">
              {replaceEntries.map((entry) => (
                <li key={entry.id} className="truncate">
                  {entry.file.name} → {destinationLabel(entry)}
                </li>
              ))}
            </ul>
            <div className="px-5 py-4 border-t border-[var(--player-border-subtle)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReplaceConfirm(false)}
                className="px-4 py-2 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] hover:bg-[var(--player-hover)] text-sm text-[var(--player-text-primary)] transition-colors"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runImport}
                className="px-4 py-2 rounded-lg bg-[var(--player-warning-solid)] hover:bg-[var(--player-warning-solid-hover)] text-[var(--player-accent-foreground)] text-sm font-semibold transition-colors disabled:opacity-50"
                disabled={isProcessing}
              >
                {isProcessing ? 'Importing...' : 'Overwrite and import'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default FileImport;
