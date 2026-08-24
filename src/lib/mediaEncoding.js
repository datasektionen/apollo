import Flac from 'libflacjs/dist/libflac.js';
import { logAudioBufferStats, logLoadProgress, shortLoadId, withLoadStep } from './loadProgress';

export const SUPPORTED_IMPORT_EXTENSIONS = new Set(['wav', 'mp3', 'flac', 'ogg']);
export const SUPPORTED_IMPORT_ACCEPT = [
  '.wav',
  '.mp3',
  '.flac',
  '.ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/vorbis',
  'application/ogg',
].join(',');

const FLAC_BITS_PER_SAMPLE = 24;
const FLAC_COMPRESSION_LEVEL = 5;

let flacModulePromise = null;

function getFileBaseName(fileName = 'audio') {
  const trimmed = String(fileName || 'audio').trim() || 'audio';
  return trimmed.replace(/\.[^/.]+$/u, '') || 'audio';
}

function hasKnownExtension(fileName = '') {
  return /\.[^/.]+$/u.test(String(fileName || ''));
}

function mimeTypeForFormat(format) {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

export function replaceFileExtension(fileName, nextExtension) {
  const extension = String(nextExtension || '').trim().replace(/^\.+/u, '');
  const suffix = extension ? `.${extension}` : '';
  return `${getFileBaseName(fileName)}${suffix}`;
}

export function getAudioFormatFromFile({ fileName = '', mimeType = '' } = {}) {
  const lowerName = String(fileName || '').trim().toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.split('.').pop() : '';
  if (extension === 'wav') return 'wav';
  if (extension === 'flac') return 'flac';
  if (extension === 'mp3') return 'mp3';
  if (extension === 'ogg' || extension === 'oga') return 'ogg';

  const lowerMime = String(mimeType || '').trim().toLowerCase();
  if (lowerMime.includes('audio/wav') || lowerMime.includes('audio/x-wav') || lowerMime.includes('audio/wave')) {
    return 'wav';
  }
  if (lowerMime.includes('audio/flac') || lowerMime.includes('audio/x-flac')) {
    return 'flac';
  }
  if (lowerMime.includes('audio/mpeg') || lowerMime.includes('audio/mp3')) {
    return 'mp3';
  }
  if (lowerMime.includes('audio/ogg') || lowerMime.includes('audio/vorbis') || lowerMime.includes('application/ogg')) {
    return 'ogg';
  }

  return '';
}

function ensureFileNameExtension(fileName, format) {
  const safeFormat = String(format || '').trim().toLowerCase();
  if (safeFormat && hasKnownExtension(fileName)) {
    return replaceFileExtension(fileName, safeFormat);
  }
  return replaceFileExtension(fileName || 'audio', safeFormat || 'bin');
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function audioBufferToInterleavedInt32(audioBuffer, bitsPerSample = FLAC_BITS_PER_SAMPLE) {
  const channelCount = Math.max(1, Number(audioBuffer?.numberOfChannels) || 1);
  const frameCount = Math.max(0, Number(audioBuffer?.length) || 0);
  const result = new Int32Array(frameCount * channelCount);
  const positiveScale = (2 ** (bitsPerSample - 1)) - 1;
  const negativeScale = 2 ** (bitsPerSample - 1);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame] || 0));
      result[(frame * channelCount) + channel] = sample < 0
        ? Math.round(sample * negativeScale)
        : Math.round(sample * positiveScale);
    }
  }

  return result;
}

async function getFlacModule() {
  if (flacModulePromise) {
    return flacModulePromise;
  }

  flacModulePromise = new Promise((resolve, reject) => {
    try {
      const flac = Flac;
      if (typeof flac?.isReady === 'function' && flac.isReady()) {
        resolve(flac);
        return;
      }

      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (typeof flac?.off === 'function') {
          flac.off('ready', handleReady);
          flac.off('error', handleError);
        }
      };
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const handleReady = () => settle(resolve, flac);
      const handleError = (error) => settle(reject, error instanceof Error ? error : new Error('Failed to initialize FLAC encoder.'));

      timeoutId = setTimeout(() => {
        if (typeof flac?.isReady === 'function' && flac.isReady()) {
          handleReady();
          return;
        }
        handleError(new Error('Timed out while initializing FLAC encoder.'));
      }, 10000);

      if (typeof flac?.on === 'function') {
        flac.on('ready', handleReady);
        flac.on('error', handleError);
      } else {
        flac.onready = handleReady;
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to initialize FLAC encoder.'));
    }
  }).catch((error) => {
    flacModulePromise = null;
    throw error;
  });

  return flacModulePromise;
}

export function audioBufferToLocalWavBlob(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 4;
  const dataSize = numberOfChannels * length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  let offset = 0;
  writeAscii(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, bufferSize - 8, true); offset += 4;
  writeAscii(view, offset, 'WAVE'); offset += 4;
  writeAscii(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 3, true); offset += 2;
  view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  writeAscii(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      view.setFloat32(offset, audioBuffer.getChannelData(channel)[i], true);
      offset += 4;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function audioBufferToFlacBlob(audioBuffer) {
  const flac = await getFlacModule();
  const channelCount = Math.max(1, Number(audioBuffer?.numberOfChannels) || 1);
  const sampleRate = Math.max(1, Math.round(Number(audioBuffer?.sampleRate) || 44100));
  const frameCount = Math.max(0, Number(audioBuffer?.length) || 0);
  const interleavedSamples = audioBufferToInterleavedInt32(audioBuffer, FLAC_BITS_PER_SAMPLE);
  const encodedChunks = [];

  const encoder = flac.create_libflac_encoder(
    sampleRate,
    channelCount,
    FLAC_BITS_PER_SAMPLE,
    FLAC_COMPRESSION_LEVEL,
    0,
    false,
    0
  );

  if (!encoder) {
    throw new Error('Failed to initialize FLAC encoder.');
  }

  try {
    const initStatus = flac.init_encoder_stream(
      encoder,
      (buffer, bytes) => {
        if (!buffer || !bytes) return;
        encodedChunks.push(buffer.slice(0, bytes));
      },
      () => {}
    );
    if (initStatus !== 0) {
      throw new Error('Failed to initialize FLAC encoder.');
    }

    if (!flac.FLAC__stream_encoder_process_interleaved(encoder, interleavedSamples, frameCount)) {
      throw new Error('Failed to encode FLAC audio.');
    }
    if (!flac.FLAC__stream_encoder_finish(encoder)) {
      throw new Error('Failed to finalize FLAC audio.');
    }
    return new Blob(encodedChunks, { type: 'audio/flac' });
  } finally {
    flac.FLAC__stream_encoder_delete(encoder);
  }
}

export function getServerUploadDescriptor({ sourceKind = 'import', sourceFileName = '', sourceMimeType = '' } = {}) {
  if (sourceKind === 'recording') {
    return {
      sourceFormat: 'recording',
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: replaceFileExtension(sourceFileName || 'recording.wav', 'flac'),
    };
  }

  const sourceFormat = getAudioFormatFromFile({ fileName: sourceFileName, mimeType: sourceMimeType });
  if (!sourceFormat) {
    throw new Error(`Unsupported audio format for "${sourceFileName || 'media'}".`);
  }

  if (sourceFormat === 'wav') {
    return {
      sourceFormat,
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: replaceFileExtension(sourceFileName || 'audio.wav', 'flac'),
    };
  }

  return {
    sourceFormat,
    serverFormat: sourceFormat,
    shouldTranscode: false,
    serverUploadMimeType: sourceMimeType || mimeTypeForFormat(sourceFormat),
    serverUploadFileName: ensureFileNameExtension(sourceFileName || `audio.${sourceFormat}`, sourceFormat),
  };
}

export async function prepareMediaForImportSource({
  sourceBlob,
  sourceFileName,
  sourceMimeType,
  audioBuffer,
}) {
  const descriptor = getServerUploadDescriptor({
    sourceKind: 'import',
    sourceFileName,
    sourceMimeType,
  });
  const localCacheBlob = audioBufferToLocalWavBlob(audioBuffer);
  const localCacheFileName = replaceFileExtension(sourceFileName || 'audio.wav', 'wav');
  const serverUploadBlob = descriptor.shouldTranscode
    ? await audioBufferToFlacBlob(audioBuffer)
    : sourceBlob;

  return {
    ...descriptor,
    localCacheBlob,
    localCacheFileName,
    serverUploadBlob,
  };
}

export async function prepareRecordedMedia({
  audioBuffer,
  fileNameBase = 'recording',
}) {
  const descriptor = getServerUploadDescriptor({
    sourceKind: 'recording',
    sourceFileName: `${getFileBaseName(fileNameBase)}.wav`,
  });

  return {
    ...descriptor,
    localCacheBlob: audioBufferToLocalWavBlob(audioBuffer),
    localCacheFileName: replaceFileExtension(fileNameBase || 'recording', 'wav'),
    serverUploadBlob: await audioBufferToFlacBlob(audioBuffer),
  };
}

export async function cacheRemoteBlobAsLocalWav({
  blobId,
  remoteBlob,
  decodeAudioFile,
  storeMediaBlob,
  fileName = null,
}) {
  const arrayBuffer = await withLoadStep(
    `Read downloaded bytes into memory (${shortLoadId(blobId)})`,
    async () => remoteBlob.arrayBuffer(),
    {
      depth: 2,
      bytesFrom: (buffer) => buffer?.byteLength,
    }
  );
  const audioBuffer = await withLoadStep(
    `Decode compressed audio (${shortLoadId(blobId)})`,
    async () => decodeAudioFile(arrayBuffer),
    { depth: 2 }
  );
  logAudioBufferStats(audioBuffer, {
    depth: 2,
    label: `Decoded buffer (${shortLoadId(blobId)})`,
  });
  const localCacheFileName = fileName || `${blobId}.wav`;
  let localCacheBlob = null;
  let storedLocally = false;
  let storeError = null;

  try {
    localCacheBlob = await withLoadStep(
      `Encode float32 WAV (${shortLoadId(blobId)})`,
      async () => audioBufferToLocalWavBlob(audioBuffer),
      {
        depth: 2,
        bytesFrom: (blob) => blob?.size,
      }
    );
    await withLoadStep(
      `Write WAV to IndexedDB (${shortLoadId(blobId)})`,
      async () => storeMediaBlob(localCacheFileName, audioBuffer, localCacheBlob, blobId),
      { depth: 2 }
    );
    storedLocally = true;
  } catch (error) {
    storeError = error;
    logLoadProgress(
      `IndexedDB write failed (${shortLoadId(blobId)}): ${error?.message || error}`,
      { level: 'error', depth: 2 }
    );
  }

  return {
    audioBuffer,
    localCacheBlob,
    localCacheFileName,
    fallbackBlob: localCacheBlob || remoteBlob,
    storedLocally,
    storeError,
  };
}
