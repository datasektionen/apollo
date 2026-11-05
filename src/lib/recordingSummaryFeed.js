import { WAVEFORM_CHUNK_SAMPLES, yieldWaveformTask } from './waveformData';

const SILENCE = new Float32Array(WAVEFORM_CHUNK_SAMPLES);

/**
 * Builds one take segment's final waveform summary from capture chunks while recording, so
 * finishing publishes a ready source instead of rescanning the take. It mirrors extractFrames for
 * contiguous, fixed-layout capture, including uncaptured gaps as silence. An overlapping chunk or a
 * channel-layout change abandons the feed; the finalized buffer then takes the normal extraction path.
 * append() only enqueues borrowed chunks: summary work runs in later tasks, never the message handler.
 */
export function createRecordingSummaryFeed({
  service, sampleRate, sourceStartFrame, maxChannels, yieldControl = yieldWaveformTask,
}) {
  let session;
  let channelCount = 0;
  let position = sourceStartFrame;
  let endFrame = Infinity;
  let queue = [];
  let running;
  let failed = false;
  let accepting = true;

  function abandon() {
    failed = true;
    accepting = false;
    queue = [];
    session?.cancel();
    session = undefined;
  }
  async function appendSilence(frames) {
    for (let done = 0; done < frames; done += SILENCE.length) {
      const size = Math.min(SILENCE.length, frames - done);
      await session.append(Array.from({ length: channelCount }, () => SILENCE.subarray(0, size)));
    }
  }
  async function consume(chunk) {
    const from = Math.max(chunk.startFrame, sourceStartFrame);
    const to = Math.min(chunk.endFrame, endFrame);
    if (to <= from) return;
    if (from < position) throw new Error('Overlapping capture chunk');
    const channels = Math.min(maxChannels, chunk.channels.length);
    if (!session) {
      channelCount = channels;
      session = service.createRecordingBuilder(null, { sampleRate, numberOfChannels: channelCount });
    } else if (channels !== channelCount) throw new Error('Capture channel layout changed');
    if (from > position) await appendSilence(from - position);
    const offset = from - chunk.startFrame;
    await session.append(chunk.channels.slice(0, channelCount).map((data) => data.subarray(offset, offset + to - from)));
    position = to;
  }
  async function pump() {
    await yieldControl();
    while (queue.length && !failed) {
      try { await consume(queue.shift()); } catch { abandon(); }
    }
    running = undefined;
  }

  return {
    append(chunk) {
      if (!accepting) return;
      queue.push(chunk);
      running ||= pump();
    },
    /** Source frames at and beyond endFrame belong to the next segment. */
    close(frame) { endFrame = frame; },
    /** Resolves the published source state, or undefined if the buffer must be extracted normally. */
    async finish(audioBuffer) {
      accepting = false;
      while (running) await running;
      if (failed || !session || !audioBuffer) { abandon(); return undefined; }
      try { return await session.finish(audioBuffer); } catch { abandon(); return undefined; } finally { session = undefined; }
    },
    cancel: abandon,
    getStats: () => ({ position, endFrame, queued: queue.length, failed, channelCount }),
  };
}
