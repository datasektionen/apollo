import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClip, createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import { attachTrackNode, createGroupNode, updateGroupNode } from '../../utils/trackTree';
import { GROUP_ROLE_CHOIRS } from '../../utils/trackRoles';
import FileImport from '../FileImport';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeAudioFile(name) {
  return new File(['wav'], name, { type: 'audio/wav' });
}

function makeFileList(files) {
  const list = {
    length: files.length,
    item: (index) => files[index] || null,
    [Symbol.iterator]: function* iterator() {
      for (const file of files) yield file;
    },
  };
  files.forEach((file, index) => {
    list[index] = file;
  });
  return list;
}

async function addFiles(input, files) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: makeFileList(files),
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function dragChipOnto(container, dropSelector) {
  const chip = container.querySelector('[data-import-file]');
  expect(chip).toBeTruthy();
  await act(async () => {
    chip.dispatchEvent(new Event('dragstart', { bubbles: true }));
  });
  const zone = container.querySelector(dropSelector);
  expect(zone).toBeTruthy();
  await act(async () => {
    zone.dispatchEvent(new Event('drop', { bubbles: true }));
  });
}

describe('FileImport destinations', () => {
  let view;

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('shows guessed files on the track tree and can drag them to a new root type', async () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    const project = attachTrackNode({ ...createEmptyProject('Import UI'), tracks: [piano] }, piano.id);
    const onImport = vi.fn().mockResolvedValue(undefined);

    view = render(
      <FileImport project={project} onImport={onImport} onClose={() => {}} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('piano_take.wav')]);

    expect(view.container.textContent).toContain('piano_take.wav');
    expect(view.container.textContent).not.toContain('Drag and drop audio files here');
    expect(view.container.textContent).toContain('Add files');
    expect(view.container.querySelector('[data-import-row="track:' + piano.id + '"]')?.textContent).toContain('Piano');
    expect(view.container.querySelector('[data-import-row="track:' + piano.id + '"]')?.textContent).toContain('piano_take.wav');
    expect(view.container.textContent).not.toContain('clip');
    expect(view.container.textContent).not.toContain('New Track');

    await dragChipOnto(view.container, '[data-import-drop="new-root"]');

    expect(view.container.textContent).toContain('New Track');
    const typeSelect = view.container.querySelector('select[aria-label="Import track type"]');
    expect(typeSelect).toBeTruthy();

    await act(async () => {
      typeSelect.value = TRACK_ROLES.LEAD;
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0][0].destination).toEqual({
      mode: 'new-root',
      role: TRACK_ROLES.LEAD,
    });
  });

  it('asks for extra confirmation before overwriting audio', async () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    const project = attachTrackNode({ ...createEmptyProject('Import UI'), tracks: [piano] }, piano.id);
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    view = render(
      <FileImport project={project} onImport={onImport} onClose={onClose} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('piano.wav')]);

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const confirmDialog = view.container.querySelector('[role="dialog"][aria-labelledby="overwrite-confirm-title"]');
    expect(confirmDialog).toBeTruthy();
    expect(confirmDialog.textContent).toContain('Overwrite existing audio?');

    const confirmButton = Array.from(confirmDialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Overwrite and import');
    await act(async () => {
      confirmButton.click();
    });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0][0].destination.trackId).toBe(piano.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('places a group match as a new child and shows the group color and icon', async () => {
    let project = createEmptyProject('Groups');
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = updateGroupNode(project, choir.id, { role: GROUP_ROLE_CHOIRS });
    const onImport = vi.fn().mockResolvedValue(undefined);

    view = render(
      <FileImport project={project} onImport={onImport} onClose={() => {}} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('choir.wav')]);

    const groupRow = view.container.querySelector(`[data-import-row="group:${choir.id}"]`);
    expect(groupRow?.textContent).toContain('Choir');
    expect(groupRow?.querySelector('.bg-green-600')).toBeTruthy();
    expect(view.container.textContent).toContain('Child of Choir');
    expect(view.container.querySelector('select[aria-label="Import track type"]')).toBeNull();

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport.mock.calls[0][0][0].destination).toEqual({
      mode: 'new-child',
      parentGroupId: choir.id,
      role: TRACK_ROLES.CHOIR,
    });
  });

  it('can drag a file onto a nested track as a new sibling or a new child', async () => {
    const soprano = createTrack('Soprano', TRACK_ROLES.CHOIR);
    let project = { ...createEmptyProject('Import UI'), tracks: [soprano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Choir');
    project = createGroupNode(project, 'Sopranos', choir.id);
    const sopranos = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Sopranos');
    project = attachTrackNode(project, soprano.id, sopranos.id);
    const onImport = vi.fn().mockResolvedValue(undefined);

    view = render(
      <FileImport project={project} onImport={onImport} onClose={() => {}} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('other.wav')]);

    expect(view.container.textContent).toContain('Choir');
    expect(view.container.textContent).toContain('Sopranos');
    expect(view.container.textContent).toContain('Soprano');
    expect(view.container.textContent).toContain('New Track');
    expect(view.container.querySelector('select[aria-label="Import track type"]')).toBeTruthy();

    await dragChipOnto(view.container, `[data-import-drop="before:track:${soprano.id}"]`);
    expect(view.container.textContent).toContain('Child of Sopranos');
    expect(view.container.textContent).not.toContain('Beside Soprano');
    expect(view.container.textContent).not.toContain('New Track');
    expect(view.container.querySelector('select[aria-label="Import track type"]')).toBeNull();

    await dragChipOnto(view.container, `[data-import-drop="inside:group:${sopranos.id}"]`);
    expect(view.container.textContent).toContain('Child of Sopranos');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'ArrowRight',
        key: 'ArrowRight',
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(view.container.textContent).toContain('Child of Soprano');

    await dragChipOnto(view.container, `[data-import-drop="inside:group:${choir.id}"]`);
    expect(view.container.textContent).toContain('Child of Choir');

    await dragChipOnto(view.container, `[data-import-drop="after:group:${choir.id}"]`);
    expect(view.container.textContent).toContain('Beside Choir');

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport.mock.calls[0][0][0].destination).toEqual({
      mode: 'new-sibling',
      groupId: choir.id,
      role: TRACK_ROLES.OTHER,
    });
  });

  it('toggles overwrite vs append from the track name, not per file', async () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    const project = attachTrackNode({ ...createEmptyProject('Import UI'), tracks: [piano] }, piano.id);
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    view = render(
      <FileImport project={project} onImport={onImport} onClose={onClose} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('piano.wav')]);

    const toggle = view.container.querySelector(`[data-import-replace-toggle="${piano.id}"]`);
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle.click();
    });

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(view.container.querySelector('[role="dialog"][aria-labelledby="overwrite-confirm-title"]')).toBeNull();
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0][0].destination.mode).toBe('append');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops between sibling tracks as one child of the parent group', async () => {
    const trumpet = createTrack('Trumpet', TRACK_ROLES.INSTRUMENT);
    const trombone = createTrack('Trombone', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Band'), tracks: [trumpet, trombone] };
    project = createGroupNode(project, 'Band');
    const band = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, trumpet.id, band.id);
    project = attachTrackNode(project, trombone.id, band.id);
    const onImport = vi.fn().mockResolvedValue(undefined);

    view = render(
      <FileImport project={project} onImport={onImport} onClose={() => {}} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('horn_a.wav'), makeAudioFile('horn_b.wav')]);

    await dragChipOnto(view.container, `[data-import-drop="after:track:${trumpet.id}"]`);
    expect(view.container.textContent).toContain('Child of Band');
    expect(view.container.textContent).not.toContain('Beside Trumpet');
    expect(view.container.textContent).not.toContain('Beside Trombone');
    expect(view.container.querySelector(`[data-import-drop="before:track:${trombone.id}"]`)).toBeNull();

    const secondChip = Array.from(view.container.querySelectorAll('[data-import-file]'))
      .find((chip) => chip.getAttribute('data-import-file') !== view.container.querySelector('[data-import-file]')?.getAttribute('data-import-file'));
    await act(async () => {
      secondChip.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    const ghost = Array.from(view.container.querySelectorAll('[data-import-row]'))
      .find((row) => row.textContent.includes('Child of Band'));
    await act(async () => {
      ghost.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    expect(ghost.textContent).toContain('horn_a.wav');
    expect(ghost.textContent).toContain('horn_b.wav');

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport.mock.calls[0][0].map((item) => item.destination)).toEqual([
      {
        mode: 'new-child',
        parentGroupId: band.id,
        afterId: trumpet.id,
        role: TRACK_ROLES.OTHER,
      },
      {
        mode: 'new-child',
        parentGroupId: band.id,
        afterId: trumpet.id,
        role: TRACK_ROLES.OTHER,
      },
    ]);
  });

  it('indents a new root after a group into a visible child of that group', async () => {
    const instrument = createTrack('Instrument1', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Bandet'), tracks: [instrument] };
    project = createGroupNode(project, 'Bandet');
    const bandet = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, instrument.id, bandet.id);
    const onImport = vi.fn().mockResolvedValue(undefined);

    view = render(
      <FileImport project={project} onImport={onImport} onClose={() => {}} />
    );

    const input = view.container.querySelector('input[type="file"]');
    await addFiles(input, [makeAudioFile('extra.wav')]);
    expect(view.container.textContent).toContain('New Track');

    await dragChipOnto(view.container, `[data-import-drop="after:group:${bandet.id}"]`);
    expect(view.container.textContent).toContain('Beside Bandet');
    expect(view.container.querySelector('select[aria-label="Import track type"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'ArrowRight',
        key: 'ArrowRight',
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(view.container.textContent).toContain('Child of Bandet');
    expect(view.container.textContent).not.toContain('Beside Bandet');
    expect(view.container.querySelector(`[data-import-row="ghost:child:${bandet.id}:end"]`)).toBeTruthy();
    expect(view.container.querySelector('select[aria-label="Import track type"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'ArrowRight',
        key: 'ArrowRight',
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(view.container.textContent).toContain('Child of Instrument1');

    const importButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Import');
    await act(async () => {
      importButton.click();
    });

    expect(onImport.mock.calls[0][0][0].destination).toEqual({
      mode: 'new-child',
      parentTrackId: instrument.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
  });
});
