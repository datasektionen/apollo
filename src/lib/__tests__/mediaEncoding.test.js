import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_IMPORT_ACCEPT,
  SUPPORTED_IMPORT_EXTENSIONS,
  audioBufferFromPlanarPcm,
  audioBufferToPlanarPcmBlob,
  getAudioFormatFromFile,
  getServerUploadDescriptor,
  isFlacArrayBuffer,
  isPlanarPcmArrayBuffer,
  prefersSoftwareFlacDecode,
  replaceFileExtension,
} from '../mediaEncoding';

describe('mediaEncoding import policy', () => {
  it('supports wav, flac, mp3 and ogg/vorbis import types', () => {
    expect(SUPPORTED_IMPORT_EXTENSIONS).toEqual(new Set(['wav', 'mp3', 'flac', 'ogg']));
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('.ogg');
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('audio/ogg');
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('audio/vorbis');
  });

  it('detects source formats from extension and mime type', () => {
    expect(getAudioFormatFromFile({ fileName: 'take.wav' })).toBe('wav');
    expect(getAudioFormatFromFile({ fileName: 'take.flac' })).toBe('flac');
    expect(getAudioFormatFromFile({ fileName: 'take.mp3' })).toBe('mp3');
    expect(getAudioFormatFromFile({ fileName: 'take.ogg' })).toBe('ogg');
    expect(getAudioFormatFromFile({ fileName: 'noext', mimeType: 'audio/ogg; codecs=vorbis' })).toBe('ogg');
    expect(getAudioFormatFromFile({ fileName: 'noext', mimeType: 'audio/x-flac' })).toBe('flac');
  });

  it('replaces filename extensions predictably', () => {
    expect(replaceFileExtension('demo.wav', 'flac')).toBe('demo.flac');
    expect(replaceFileExtension('demo', 'wav')).toBe('demo.wav');
    expect(replaceFileExtension(' demo.track.mp3 ', '.ogg')).toBe('demo.track.ogg');
  });

  it('maps imported wav files to flac on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.wav',
      sourceMimeType: 'audio/wav',
    })).toEqual({
      sourceFormat: 'wav',
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'stem.flac',
    });
  });

  it('preserves imported flac, mp3 and ogg payloads on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.flac',
      sourceMimeType: 'audio/flac',
    })).toEqual({
      sourceFormat: 'flac',
      serverFormat: 'flac',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'stem.flac',
    });

    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.mp3',
      sourceMimeType: 'audio/mpeg',
    })).toEqual({
      sourceFormat: 'mp3',
      serverFormat: 'mp3',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/mpeg',
      serverUploadFileName: 'stem.mp3',
    });

    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.ogg',
      sourceMimeType: 'audio/ogg',
    })).toEqual({
      sourceFormat: 'ogg',
      serverFormat: 'ogg',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/ogg',
      serverUploadFileName: 'stem.ogg',
    });
  });

  it('always stores recordings as flac on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'recording',
      sourceFileName: 'recording.wav',
    })).toEqual({
      sourceFormat: 'recording',
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'recording.flac',
    });
  });

  it('round-trips planar PCM with memcpy into an AudioBuffer-like object', async () => {
    const frames = 6;
    const left = new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5, -0.6]);
    const right = new Float32Array([0.05, 0.15, 0.25, 0.35, 0.45, 0.55]);
    const original = {
      numberOfChannels: 2,
      length: frames,
      sampleRate: 44100,
      getChannelData: (channel) => (channel === 0 ? left : right),
    };
    const blob = audioBufferToPlanarPcmBlob(original);
    const arrayBuffer = await blob.arrayBuffer();
    expect(isPlanarPcmArrayBuffer(arrayBuffer)).toBe(true);

    const restored = audioBufferFromPlanarPcm(arrayBuffer, (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (channel) => data[channel],
      };
    });
    expect(restored.sampleRate).toBe(44100);
    expect(Array.from(restored.getChannelData(0))).toEqual(Array.from(left));
    expect(Array.from(restored.getChannelData(1))).toEqual(Array.from(right));
  });

  it('detects native FLAC files and Safari software-decode preference', () => {
    const flac = new Uint8Array([0x66, 0x4C, 0x61, 0x43, 0, 0, 0, 0]).buffer;
    expect(isFlacArrayBuffer(flac)).toBe(true);
    expect(isFlacArrayBuffer(new ArrayBuffer(8))).toBe(false);
    expect(prefersSoftwareFlacDecode(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    )).toBe(true);
    expect(prefersSoftwareFlacDecode(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )).toBe(false);
    expect(prefersSoftwareFlacDecode(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36'
    )).toBe(false);
  });

  it('round-trips 24-bit FLAC through the software decoder', async () => {
    const { audioBufferToFlacBlob, decodeFlacArrayBuffer } = await import('../mediaEncoding');
    const frames = 48;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      left[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
      right[i] = Math.cos((i / frames) * Math.PI * 2) * 0.25;
    }
    const original = {
      numberOfChannels: 2,
      length: frames,
      sampleRate: 44100,
      getChannelData: (channel) => (channel === 0 ? left : right),
    };
    const blob = await audioBufferToFlacBlob(original);
    const arrayBuffer = await blob.arrayBuffer();
    expect(isFlacArrayBuffer(arrayBuffer)).toBe(true);

    const restored = await decodeFlacArrayBuffer(arrayBuffer, (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (channel) => data[channel],
      };
    });
    expect(restored.numberOfChannels).toBe(2);
    expect(restored.sampleRate).toBe(44100);
    expect(restored.length).toBe(frames);
    for (let i = 0; i < frames; i += 1) {
      expect(restored.getChannelData(0)[i]).toBeCloseTo(left[i], 4);
      expect(restored.getChannelData(1)[i]).toBeCloseTo(right[i], 4);
    }
  });
});
