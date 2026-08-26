import { useState } from 'react';
import { FileAudio, Guitar, Metronome, User, Users, Waves, X } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import {
  IMPORT_DESTINATION_MODES,
  IMPORT_DROP_TYPES,
  IMPORT_FILE_DRAG_TYPE,
  buildImportPreviewRows,
  getImportInheritedRole,
  getImportNodeKey,
  getImportSlotKey,
  importDestinationLocksType,
  importNodeHasDescendants,
  isFirstImportNodeInParent,
  isLastImportNodeInParent,
  resolveImportDropPlacement,
} from '../utils/importTrackMatch';
import { getDefaultIconByRole, getRoleColorClass } from '../utils/trackRoles';

const ROLE_ICONS = {
  guitar: Guitar,
  user: User,
  users: Users,
  metronome: Metronome,
  wave: Waves,
};

function RoleIcon({ role, size = 16 }) {
  const Icon = ROLE_ICONS[getDefaultIconByRole(role)] || Waves;
  return <Icon size={size} className="shrink-0" />;
}

function ghostHint(row) {
  if (row.ghostType === 'new-child') return `Child of ${row.node?.name || 'track'}`;
  if (row.ghostType === 'new-sibling') return `Beside ${row.node?.name || 'track'}`;
  return 'New Track';
}

function FileChip({
  entry,
  dragging,
  onRemove,
  onFileDragStart,
  onFileDragEnd,
}) {
  return (
    <div
      data-import-file={entry.id}
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        try {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(IMPORT_FILE_DRAG_TYPE, entry.id);
        } catch {
          // jsdom may not implement DataTransfer
        }
        onFileDragStart(entry.id);
      }}
      onDragEnd={() => onFileDragEnd()}
      className={`max-w-[11rem] inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[11px] border cursor-grab active:cursor-grabbing select-none ${
        dragging
          ? 'opacity-50 bg-gray-700 text-gray-200 border-gray-600'
          : 'bg-gray-700 text-gray-100 border-gray-600'
      }`}
      title={`${entry.file.name} · Drag to place`}
    >
      <FileAudio size={10} className="flex-shrink-0" />
      <span className="truncate">{entry.file.name}</span>
      <button
        type="button"
        draggable={false}
        className="flex-shrink-0 text-current/80 hover:text-red-300"
        title="Remove file"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(entry.id);
        }}
      >
        <X size={10} />
      </button>
    </div>
  );
}

function DropZone({ dropKey, className, onDragOver, onDrop }) {
  return (
    <div
      data-import-drop={dropKey}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={className}
    />
  );
}

function ImportTrackMap({
  nodes,
  files,
  project,
  roleOptions,
  onAssignDrop,
  onChangeRole,
  onToggleTrackReplace,
  onRemoveFile,
  onFileDragStart,
}) {
  const [draggingEntryId, setDraggingEntryId] = useState(null);
  const [activeDrop, setActiveDrop] = useState(null);
  const rows = buildImportPreviewRows(nodes, files);
  const isDraggingFile = Boolean(draggingEntryId);

  const handleDragOver = (event, drop) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {
      // jsdom
    }
    setActiveDrop(drop);
  };

  const handleDrop = (event, drop) => {
    event.preventDefault();
    event.stopPropagation();
    let entryId = draggingEntryId;
    try {
      entryId = event.dataTransfer.getData(IMPORT_FILE_DRAG_TYPE) || entryId;
    } catch {
      // jsdom
    }
    if (entryId) onAssignDrop(entryId, drop);
    setDraggingEntryId(null);
    setActiveDrop(null);
  };

  const dropForNode = (node, type) => ({ type, node });

  const renderDropZones = (node) => {
    if (!isDraggingFile || !node) return null;
    const key = getImportNodeKey(node);
    const isLastInParent = isLastImportNodeInParent(nodes, node);
    const isFirstInParent = isFirstImportNodeInParent(nodes, node);
    const afterType = isLastInParent && node.parentId
      ? IMPORT_DROP_TYPES.AFTER_PARENT
      : IMPORT_DROP_TYPES.AFTER;
    const middleType = node.kind === 'group' ? IMPORT_DROP_TYPES.INSIDE : IMPORT_DROP_TYPES.ON;
    const showBefore = !node.parentId || isFirstInParent;

    return (
      <>
        {showBefore ? (
          <DropZone
            dropKey={`${IMPORT_DROP_TYPES.BEFORE}:${key}`}
            className="absolute inset-x-0 top-0 h-[25%] z-10"
            onDragOver={(event) => handleDragOver(event, dropForNode(node, IMPORT_DROP_TYPES.BEFORE))}
            onDrop={(event) => handleDrop(event, dropForNode(node, IMPORT_DROP_TYPES.BEFORE))}
          />
        ) : null}
        <DropZone
          dropKey={`${middleType}:${key}`}
          className={`absolute inset-x-0 z-10 ${showBefore ? 'top-[25%]' : 'top-0'} bottom-[25%]`}
          onDragOver={(event) => handleDragOver(event, dropForNode(node, middleType))}
          onDrop={(event) => handleDrop(event, dropForNode(node, middleType))}
        />
        <DropZone
          dropKey={`${afterType}:${key}`}
          className="absolute inset-x-0 bottom-0 h-[25%] z-10"
          onDragOver={(event) => handleDragOver(event, dropForNode(node, afterType))}
          onDrop={(event) => handleDrop(event, dropForNode(node, afterType))}
        />
      </>
    );
  };

  const chipProps = {
    onRemove: onRemoveFile,
    onFileDragStart: (entryId) => {
      setDraggingEntryId(entryId);
      onFileDragStart?.(entryId);
    },
    onFileDragEnd: () => {
      setDraggingEntryId(null);
      setActiveDrop(null);
    },
  };

  return (
    <div
      className="rounded-lg border border-gray-700 overflow-hidden bg-gray-900"
      onDragOver={(event) => {
        if (!isDraggingFile) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {rows.map((row) => {
        if (row.kind === 'ghost') {
          const destination = row.destination || row.files?.[0]?.destination;
          const inheritedRole = getImportInheritedRole(destination, nodes);
          const role = inheritedRole
            || destination?.role
            || row.files?.[0]?.destination?.role
            || TRACK_ROLES.INSTRUMENT;
          const lockType = importDestinationLocksType(destination, nodes);
          const slotFiles = row.files || (row.entry ? [row.entry] : []);
          const joining = activeDrop?.type === IMPORT_DROP_TYPES.JOIN
            && getImportSlotKey(activeDrop.destination, nodes) === getImportSlotKey(row.destination, nodes);
          return (
            <div
              key={row.key}
              data-import-row={row.key}
              data-import-drop={`join:${row.key}`}
              className={`relative flex items-center gap-1.5 border-b border-dashed border-gray-700 px-2 py-0.5 ${
                joining ? 'bg-blue-900/50' : 'bg-gray-900/80'
              }`}
              style={{ paddingLeft: `${8 + row.depth * 12}px` }}
              onDragOver={(event) => handleDragOver(event, {
                type: IMPORT_DROP_TYPES.JOIN,
                destination: row.destination,
                node: row.node,
              })}
              onDrop={(event) => handleDrop(event, {
                type: IMPORT_DROP_TYPES.JOIN,
                destination: row.destination,
                node: row.node,
              })}
            >
              <div className={`w-5 h-5 rounded border border-dashed flex items-center justify-center flex-shrink-0 ${
                lockType
                  ? `${getRoleColorClass(role)} text-white border-transparent`
                  : 'border-blue-400/70 text-blue-300'
              }`}>
                <RoleIcon role={role} size={11} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate text-blue-100">{ghostHint(row)}</p>
              </div>
              {lockType ? null : (
                <select
                  aria-label="Import track type"
                  data-import-role-select=""
                  value={role}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onChangeRole(destination, event.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0 text-[10px] relative z-20 focus:outline-none focus:border-blue-500"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <div className={`flex flex-wrap gap-0.5 justify-end max-w-[14rem] relative ${isDraggingFile ? 'z-0' : 'z-20'}`}>
                {slotFiles.map((entry) => (
                  <FileChip
                    key={entry.id}
                    entry={entry}
                    dragging={entry.id === draggingEntryId}
                    {...chipProps}
                  />
                ))}
              </div>
            </div>
          );
        }

        const role = row.node.role || TRACK_ROLES.OTHER;
        const isGroup = row.kind === 'group';
        const rowKey = getImportNodeKey(row.node);
        const activeType = activeDrop?.node && getImportNodeKey(activeDrop.node) === rowKey
          ? activeDrop.type
          : null;
        const highlightOn = activeType === IMPORT_DROP_TYPES.ON || activeType === IMPORT_DROP_TYPES.INSIDE;
        const lineBefore = activeType === IMPORT_DROP_TYPES.BEFORE;
        const lineAfter = activeType === IMPORT_DROP_TYPES.AFTER || activeType === IMPORT_DROP_TYPES.AFTER_PARENT;
        const track = !isGroup
          ? (project?.tracks || []).find((candidate) => candidate.id === row.node.id)
          : null;
        const canToggleReplace = Boolean(
          !isGroup
          && row.files.length
          && track
          && (track.clips?.length || 0) > 0
        );
        const overwrite = row.files.some((entry) => (
          entry.destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
        ));

        return (
          <div
            key={row.key}
            data-import-row={row.key}
            className={`relative flex items-center gap-1.5 border-b border-gray-800 px-2 py-0.5 ${
              highlightOn ? 'bg-blue-900/50' : 'hover:bg-gray-800/70'
            }`}
            style={{ paddingLeft: `${8 + row.depth * 12}px` }}
            onDragOver={(event) => {
              if (!isDraggingFile) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
              const type = resolveImportDropPlacement(row.node, ratio, {
                hasDescendants: importNodeHasDescendants(nodes, row.node),
                isLastInParent: isLastImportNodeInParent(nodes, row.node),
                isFirstInParent: isFirstImportNodeInParent(nodes, row.node),
              });
              handleDragOver(event, dropForNode(row.node, type));
            }}
            onDrop={(event) => {
              if (!isDraggingFile && !activeDrop) return;
              const drop = activeDrop?.node && getImportNodeKey(activeDrop.node) === rowKey
                ? activeDrop
                : dropForNode(row.node, IMPORT_DROP_TYPES.ON);
              handleDrop(event, drop);
            }}
          >
            {lineBefore ? (
              <div className="absolute left-1 right-1 top-0 h-0.5 bg-blue-400 z-20 pointer-events-none" />
            ) : null}
            {lineAfter ? (
              <div
                className="absolute left-1 right-1 bottom-0 h-0.5 bg-blue-400 z-20 pointer-events-none"
                style={activeType === IMPORT_DROP_TYPES.AFTER_PARENT ? { left: `${Math.max(4, 8 + ((row.node.depth || 1) - 1) * 12)}px` } : undefined}
              />
            ) : null}
            {renderDropZones(row.node)}
            <div className={`w-5 h-5 rounded ${getRoleColorClass(role)} text-white flex items-center justify-center flex-shrink-0 relative z-0`}>
              <RoleIcon role={role} size={11} />
            </div>
            <p className={`flex-1 min-w-0 text-xs truncate relative z-0 ${isGroup ? 'font-semibold' : 'font-medium'}`}>
              {row.node.name}
            </p>
            {canToggleReplace ? (
              <button
                type="button"
                data-import-replace-toggle={row.node.id}
                className={`flex-shrink-0 px-1.5 py-px rounded text-[10px] font-medium border relative z-20 ${
                  overwrite
                    ? 'bg-amber-900/70 text-amber-100 border-amber-500/50'
                    : 'bg-gray-800 text-gray-300 border-gray-600'
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleTrackReplace(row.node.id);
                }}
              >
                {overwrite ? 'Overwrite' : 'Append'}
              </button>
            ) : null}
            <div className={`flex flex-wrap gap-0.5 justify-end max-w-[14rem] relative ${isDraggingFile ? 'z-0' : 'z-20'}`}>
              {row.files.map((entry) => (
                <FileChip
                  key={entry.id}
                  entry={entry}
                  dragging={entry.id === draggingEntryId}
                  {...chipProps}
                />
              ))}
            </div>
          </div>
        );
      })}

      {isDraggingFile ? (
        <div
          data-import-drop="new-root"
          data-import-row="new-root"
          onDragOver={(event) => handleDragOver(event, { type: IMPORT_DROP_TYPES.NEW_ROOT })}
          onDrop={(event) => handleDrop(event, { type: IMPORT_DROP_TYPES.NEW_ROOT })}
          className={`w-full min-h-[10px] border-t border-dashed ${
            activeDrop?.type === IMPORT_DROP_TYPES.NEW_ROOT
              ? 'bg-blue-700/30 border-blue-500'
              : 'border-gray-700'
          }`}
        />
      ) : null}
    </div>
  );
}

export default ImportTrackMap;
