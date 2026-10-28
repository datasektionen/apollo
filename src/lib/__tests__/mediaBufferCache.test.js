import { describe, expect, it, vi } from 'vitest';
import { MediaBufferCache, getMediaRevision, mediaWaveformRevision, rememberMediaRevision } from '../mediaBufferCache';

const revision = (id) => ({ waveformRevision: id, blobSize: 100, blobType: 'audio/wav' });

describe('media buffer lifecycle', () => {
  it('remains Map compatible and publishes only logical changes', () => {
    const onSet = vi.fn();
    const onDelete = vi.fn();
    const onClear = vi.fn();
    const cache = new MediaBufferCache({ onSet, onDelete, onClear });
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    const first = {};
    const second = {};
    expect(cache.set('a', first)).toBe(cache);
    expect(cache).toBeInstanceOf(Map);
    expect([...cache]).toEqual([['a', first]]);
    cache.set('a', first);
    expect(onSet).toHaveBeenCalledTimes(1);
    cache.set('a', second);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['ready', 'replaced']);
    expect(cache.delete('missing')).toBe(false);
    expect(cache.delete('a')).toBe(true);
    expect(onDelete).toHaveBeenCalledWith('a', second);
    unsubscribe();
    cache.clear();
    expect(onClear).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('passes a persisted revision on first registration without reading PCM', () => {
    const buffer = { getChannelData: vi.fn(() => { throw new Error('Playback PCM must not be read'); }) };
    const onSet = vi.fn();
    rememberMediaRevision(buffer, revision('v1'));
    const cache = new MediaBufferCache({ onSet });
    cache.set('audio', buffer);
    expect(onSet).toHaveBeenCalledWith('audio', buffer, { revision: revision('v1') });
    expect(getMediaRevision(buffer)).toEqual(revision('v1'));
    expect(buffer.getChannelData).not.toHaveBeenCalled();
  });

  it('updates existing cached buffers after delayed local PCM persistence', () => {
    const buffer = {};
    const onSet = vi.fn();
    const cache = new MediaBufferCache({ onSet });
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.set('audio', buffer);
    rememberMediaRevision(buffer, revision('persisted'));
    expect(onSet).toHaveBeenLastCalledWith('audio', buffer, { revision: revision('persisted') });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'revision', blobId: 'audio' }));
  });

  it('cleans revision listeners on replacement, deletion and clear', () => {
    const onSet = vi.fn();
    const cache = new MediaBufferCache({ onSet });
    const old = {};
    const replacement = {};
    cache.set('a', old);
    cache.set('a', replacement);
    rememberMediaRevision(old, revision('old'));
    expect(onSet).toHaveBeenCalledTimes(2);
    cache.delete('a');
    rememberMediaRevision(replacement, revision('deleted'));
    expect(onSet).toHaveBeenCalledTimes(2);
    cache.set('a', old);
    cache.clear();
    rememberMediaRevision(old, revision('cleared'));
    expect(onSet).toHaveBeenCalledTimes(3);
  });

  it('isolates failing UI subscribers', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = new MediaBufferCache();
    const notified = vi.fn();
    cache.subscribe(() => { throw new Error('unmounted view'); });
    cache.subscribe(notified);
    expect(() => cache.set('a', {})).not.toThrow();
    expect(notified).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('trusts only explicitly versioned persisted media', () => {
    const blob = new Blob(['pcm'], { type: 'audio/wav' });
    expect(mediaWaveformRevision({ createdAt: Date.now(), blob })).toBeUndefined();
    expect(mediaWaveformRevision({ waveformRevision: 'unique', blob })).toEqual({
      waveformRevision: 'unique', blobSize: 3, blobType: 'audio/wav',
    });
    expect(mediaWaveformRevision(null)).toBeUndefined();
  });
});
