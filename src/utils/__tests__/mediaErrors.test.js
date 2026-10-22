import { describe, expect, it } from 'vitest';
import { createClip, createEmptyProject, createTrack } from '../../types/project';
import { attachTrackNode, createGroupNode } from '../trackTree';
import { buildBlobReferenceErrorMessage, formatMediaDownloadFailure, isClipMediaMissing } from '../mediaErrors';

describe('formatMediaDownloadFailure', () => {
  it('names the media, project, status, and server message', () => {
    const message = formatMediaDownloadFailure({
      mediaId: 'cbd5ce29-ce23-4e5f-a4b0-5df1627be659',
      projectId: '179f22cc-0994-4c6f-a3d6-5810a6b7ce27',
      error: {
        status: 403,
        serverError: 'That media is not available through the selected project',
      },
    });

    expect(message).toContain('cbd5ce29-ce23-4e5f-a4b0-5df1627be659');
    expect(message).toContain('179f22cc-0994-4c6f-a3d6-5810a6b7ce27');
    expect(message).toContain('HTTP 403');
    expect(message).toContain('That media is not available through the selected project');
    expect(message).toContain('quarantine');
  });

  it('keeps other download failures to the status and server message', () => {
    expect(formatMediaDownloadFailure({
      mediaId: 'blob-a',
      error: { status: 404, message: 'Media not found' },
    })).toBe('Failed to download media blob-a (HTTP 404): Media not found');
  });
});

describe('isClipMediaMissing', () => {
  it('treats clips without a blob id as missing', () => {
    expect(isClipMediaMissing({ id: 'clip-1' }, new Set())).toBe(true);
  });

  it('does not mark a clip missing when its buffer is already in cache', () => {
    const cache = new Map([['blob-a', {}]]);
    expect(isClipMediaMissing({ blobId: 'blob-a' }, new Set(['blob-a']), cache)).toBe(false);
  });

  it('marks a clip missing only after its blob failed to load', () => {
    expect(isClipMediaMissing({ blobId: 'blob-a' }, new Set(['blob-a']))).toBe(true);
    expect(isClipMediaMissing({ blobId: 'blob-a' }, new Set(['blob-b']))).toBe(false);
  });
});

describe('buildBlobReferenceErrorMessage', () => {
  it('uses the full track hierarchy and clip ordinal for a single clip', () => {
    const altoTrack = {
      ...createTrack('Alto 1'),
      clips: [
        createClip('blob-a', 0, 1000),
        createClip('blob-b', 1000, 1000),
      ],
    };

    let project = createEmptyProject('Hierarchy Test');
    project = { ...project, tracks: [altoTrack] };
    project = createGroupNode(project, 'Choir');
    const choirGroup = project.trackTree.find((node) => node.kind === 'group');
    project = createGroupNode(project, 'Altos', choirGroup.id);
    const altosGroup = project.trackTree.find((node) => node.kind === 'group' && node.parentId === choirGroup.id);
    project = attachTrackNode(project, altoTrack.id, altosGroup.id);

    expect(buildBlobReferenceErrorMessage(project, 'blob-b', 'clip audio')).toBe(
      'Failed to load clip audio for Choir / Altos / Alto 1 (second clip).'
    );
  });

  it('lists every affected clip when the same blob is reused', () => {
    const altoTrack = {
      ...createTrack('Alto 1'),
      clips: [createClip('shared-blob', 0, 1000)],
    };
    const sopranoTrack = {
      ...createTrack('Soprano 2'),
      clips: [
        createClip('other-blob', 0, 1000),
        createClip('other-blob-2', 1000, 1000),
        createClip('shared-blob', 2000, 1000),
      ],
    };

    let project = createEmptyProject('Shared Blob Test');
    project = { ...project, tracks: [altoTrack, sopranoTrack] };
    project = createGroupNode(project, 'Choir');
    const choirGroup = project.trackTree.find((node) => node.kind === 'group');
    project = createGroupNode(project, 'Altos', choirGroup.id);
    project = createGroupNode(project, 'Sopranos', choirGroup.id);
    const altosGroup = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Altos');
    const sopranosGroup = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Sopranos');
    project = attachTrackNode(project, altoTrack.id, altosGroup.id);
    project = attachTrackNode(project, sopranoTrack.id, sopranosGroup.id);

    expect(buildBlobReferenceErrorMessage(project, 'shared-blob', 'clip audio')).toBe(
      'Failed to load clip audio for 2 clips: Choir / Altos / Alto 1 (first clip); Choir / Sopranos / Soprano 2 (third clip).'
    );
  });
});
