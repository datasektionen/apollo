import { createWaveformBuilder, estimateWaveformBytes, queryWaveformRange, WAVEFORM_BASE_BLOCK_SIZE, waveformByteLength } from './waveformData';

export const RECORDING_SUMMARY_SAMPLES_PER_TASK = 1024;
export const RECORDING_SUMMARY_BYTES = 16 * 1024 * 1024;
const empty = () => ({ min: 0, max: 0, sumSquares: 0, count: 0 });
const finite = (value) => Number.isFinite(value) ? value : 0;

/** Absolute capture-clock index. It borrows capture PCM, never copies it. Summary work runs in
 * tasks, not the worklet/message callback, and is disposable independently of audio capture.
 * Runs implement extractFrames' last-message-wins overlap and mono-to-stereo duplication rules.
 */
export function createRecordingWaveform({
  sampleRate, onChange = () => {}, maxBytes = RECORDING_SUMMARY_BYTES,
  scheduleTask = (callback) => { const id = setTimeout(callback, 0); return () => clearTimeout(id); },
} = {}) {
  let runs = [];
  let pending = [];
  let pendingIndex = 0;
  let active;
  let cancelTask;
  let disposed = false;
  let floor = -Infinity;
  let bytes = 0;
  let samplesScanned = 0;
  let summaries = new Map();
  const lowerBound = (frame) => {
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (runs[mid].endFrame <= frame) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  function insert(chunk) {
    const startFrame = Math.max(floor, chunk.startFrame);
    const endFrame = chunk.endFrame;
    if (endFrame <= startFrame) return;
    const first = lowerBound(startFrame);
    let last = first;
    while (last < runs.length && runs[last].startFrame < endFrame) last += 1;
    const replacement = [];
    if (runs[first]?.startFrame < startFrame) replacement.push({ ...runs[first], endFrame: startFrame });
    replacement.push({ startFrame, endFrame, chunk });
    if (last > first && runs[last - 1].endFrame > endFrame) replacement.push({ ...runs[last - 1], startFrame: endFrame });
    runs.splice(first, last - first, ...replacement);
  }
  function queue() {
    if (!cancelTask && !disposed && (active || pendingIndex < pending.length)) cancelTask = scheduleTask(run);
  }
  function run() {
    cancelTask = undefined;
    if (disposed) return;
    if (!active) {
      const chunk = pending[pendingIndex];
      pending[pendingIndex++] = undefined;
      if (pendingIndex === pending.length) { pending = []; pendingIndex = 0; }
      if (!chunk) return;
      if (chunk.endFrame <= floor) { queue(); return; }
      insert(chunk);
      const size = estimateWaveformBytes(chunk.endFrame - chunk.startFrame, chunk.channels.length);
      // Reserve the in-progress summary too. Evicted blocks remain exactly queryable via borrowed PCM.
      while (summaries.size && bytes + size > maxBytes) {
        const oldest = summaries.keys().next().value;
        bytes -= waveformByteLength(summaries.get(oldest));
        summaries.delete(oldest);
      }
      if (size > maxBytes) { onChange(); queue(); return; }
      active = {
        chunk, size, channel: 0, offset: 0,
        builder: createWaveformBuilder({ sampleRate, length: chunk.endFrame - chunk.startFrame,
          numberOfChannels: chunk.channels.length }),
      };
    }
    const { chunk, builder, channel, offset } = active;
    const end = Math.min(chunk.channels[channel].length, offset + RECORDING_SUMMARY_SAMPLES_PER_TASK);
    builder.append(channel, offset, chunk.channels[channel].subarray(offset, end));
    samplesScanned += end - offset;
    active.offset = end;
    if (end === chunk.channels[channel].length) { active.channel += 1; active.offset = 0; }
    if (active.channel === chunk.channels.length) {
      const pyramid = builder.finish();
      const size = waveformByteLength(pyramid);
      if (chunk.endFrame > floor) { summaries.set(chunk, pyramid); bytes += size; }
      active = undefined;
      onChange();
    }
    queue();
  }
  return {
    append(chunk) {
      if (disposed) return;
      pending.push(chunk);
      queue();
    },
    prune(retainFloor) {
      if (retainFloor <= floor) return;
      floor = retainFloor;
      const count = lowerBound(floor);
      if (count) runs.splice(0, count);
      for (const [chunk, pyramid] of summaries) {
        if (chunk.endFrame <= floor) { bytes -= waveformByteLength(pyramid); summaries.delete(chunk); }
      }
    },
    channelCount(start, end) {
      let channels = 1;
      for (let i = lowerBound(start); i < runs.length && runs[i].startFrame < end; i += 1) {
        channels = Math.max(channels, runs[i].chunk.channels.length);
      }
      return channels;
    },
    sampleAt(channel, frame) {
      const run = runs[lowerBound(frame)];
      if (!run || frame < run.startFrame) return 0;
      return finite(run.chunk.channels[Math.min(channel, run.chunk.channels.length - 1)][frame - run.chunk.startFrame]);
    },
    /** Each call reads <=128 raw samples or one chunk's summary. Gaps are extracted silence,
     * including their sample counts; cropped-away transients cannot bleed across run boundaries.
     */
    createRangeQuery(channel, start, end) {
      let position = Math.floor(start);
      const finish = Math.max(position, Math.ceil(end));
      const result = { min: Infinity, max: -Infinity, sumSquares: 0, count: 0 };
      return () => {
        if (disposed) return { done: true, result: empty(), rawSamples: 0 };
        let rawSamples = 0;
        if (position < finish) {
          const run = runs[lowerBound(position)];
          let range;
          if (!run || run.startFrame > position) {
            const next = Math.min(finish, run?.startFrame ?? finish);
            range = { ...empty(), count: next - position };
            position = next;
          } else {
            const chunk = run.chunk;
            const pyramid = summaries.get(chunk);
            const offset = position - chunk.startFrame;
            const limit = Math.min(finish, run.endFrame) - chunk.startFrame;
            const alignedEnd = Math.floor(limit / WAVEFORM_BASE_BLOCK_SIZE) * WAVEFORM_BASE_BLOCK_SIZE;
            const summarized = pyramid && offset % WAVEFORM_BASE_BLOCK_SIZE === 0 && alignedEnd > offset;
            const next = summarized ? alignedEnd : Math.min(limit, (Math.floor(offset / WAVEFORM_BASE_BLOCK_SIZE) + 1) * WAVEFORM_BASE_BLOCK_SIZE);
            const buffer = { length: chunk.endFrame - chunk.startFrame, sampleRate,
              numberOfChannels: chunk.channels.length, getChannelData: (c) => chunk.channels[c] };
            range = queryWaveformRange(summarized ? pyramid : undefined,
              Math.min(channel, chunk.channels.length - 1), offset, next, buffer);
            if (!summarized) rawSamples = next - offset;
            position = chunk.startFrame + next;
          }
          if (range.count) {
            result.min = Math.min(result.min, range.min);
            result.max = Math.max(result.max, range.max);
            result.sumSquares += range.sumSquares;
            result.count += range.count;
          }
        }
        const done = position >= finish;
        if (done && !result.count) result.min = result.max = 0;
        return { done, result, rawSamples };
      };
    },
    getEndFrame: () => runs.length ? runs[runs.length - 1].endFrame : -1,
    getStats: () => ({ bytes: bytes + (active?.size || 0), samplesScanned,
      pending: pending.length - pendingIndex + Number(Boolean(active)), runs: runs.length }),
    cancel() {
      disposed = true;
      cancelTask?.();
      cancelTask = undefined;
      pending = [];
      pendingIndex = 0;
      active = undefined;
      runs = [];
      summaries.clear();
      bytes = 0;
    },
  };
}

/** Draw a bounded visible surface, in resumable slices, without assembling a recording AudioBuffer. */
export function createRecordingDrawJob(context, {
  capture, sourceStartFrame, sourceMinFrame = sourceStartFrame, sourceEndFrame, sampleRate, numberOfChannels,
  pixelsPerMs, leftPx, widthPx, height, dpr, color = '#fca5a5',
}) {
  const samplesPerPx = sampleRate / (1000 * pixelsPerMs);
  if (!(samplesPerPx > 0) || !(widthPx > 0) || sourceEndFrame <= sourceStartFrame) return () => false;
  const frameAt = (x) => sourceStartFrame + (leftPx + x) * samplesPerPx;
  const detail = samplesPerPx / dpr <= 1;
  let channel = 0;
  let column = 0;
  let frame = Math.max(Math.floor(sourceMinFrame), Math.floor(frameAt(0)));
  let query;
  let previous;
  return () => {
    const lane = height / numberOfChannels;
    const y = (value) => (channel + 0.5) * lane - Math.max(-1, Math.min(1, value)) * Math.max(0, lane / 2 - 2);
    context.fillStyle = color;
    context.strokeStyle = color;
    context.lineWidth = 1 / dpr;
    let done;
    if (detail) {
      context.beginPath();
      if (previous) context.moveTo(previous.x, previous.y);
      const end = Math.min(sourceEndFrame, Math.ceil(frameAt(widthPx)));
      for (let i = 0; i < 64 && frame < end; i += 1, frame += 1) {
        const point = { x: (frame - sourceStartFrame) / samplesPerPx - leftPx, y: y(capture.sampleAt(channel, frame)) };
        if (previous) context.lineTo(point.x, point.y);
        else context.moveTo(point.x, point.y);
        previous = point;
      }
      context.stroke();
      done = frame >= end;
    } else {
      // Both summary operations and raw edge work are bounded, even for an hours-wide pixel.
      let rawSamples = 0;
      for (let i = 0; i < 16 && column / dpr < widthPx && rawSamples < 256; i += 1) {
        const x = column / dpr;
        const right = Math.min(widthPx, (column + 1) / dpr);
        query ||= capture.createRangeQuery(channel, Math.max(sourceMinFrame, frameAt(x)), Math.min(sourceEndFrame, frameAt(right)));
        const step = query();
        rawSamples += step.rawSamples;
        if (step.done) {
          const range = step.result;
          if (range.count) context.fillRect(x, y(range.max), right - x, Math.max(1 / dpr, y(range.min) - y(range.max)));
          query = undefined;
          column += 1;
        }
      }
      done = column / dpr >= widthPx;
    }
    if (done) {
      channel += 1;
      column = 0;
      frame = Math.max(Math.floor(sourceMinFrame), Math.floor(frameAt(0)));
      previous = undefined;
    }
    return channel < numberOfChannels;
  };
}
