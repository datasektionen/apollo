import {
  createWaveformBuilder, createWaveformFingerprint, chooseWaveformBlockSize, estimateWaveformBytes,
  waveformByteLength, validateWaveformPyramid, WAVEFORM_CHUNK_SAMPLES, DEFAULT_WAVEFORM_BYTES, yieldWaveformTask,
} from './waveformData';
import { waveformPersistence, normalizeWaveformRevision } from './waveformPersistence';


const abortError = () => Object.assign(new Error('Waveform source released'), { name: 'AbortError' });
const capacityError = (message) => Object.assign(new Error(message), {
  name: 'WaveformCapacityError', code: 'WAVEFORM_CAPACITY', retryable: true,
});
const errorState = (error) => ({ status: 'error', pyramid: undefined, error });
const defaultWorkerFactory = () => typeof Worker === 'undefined'
  ? undefined : new Worker(new URL('./waveform.worker.js', import.meta.url), { type: 'module' });
const weakReference = (value) => typeof WeakRef === 'undefined' ? { deref: () => value } : new WeakRef(value);
function revisionSnapshot(normalized) {
  if (!normalized) return undefined;
  const [kind, token, blobSize, blobType] = JSON.parse(normalized);
  return Object.freeze({ [kind === 'revision' ? 'waveformRevision' : 'createdAt']: token, blobSize, blobType });
}

/**
 * One serial extraction lane, with a separate bounded (one operation) persistence lane.
 * ensureSource(id, buffer, { revision }) accepts normalizeWaveformRevision's trusted-media contract.
 * A trusted revision is checked BEFORE reading PCM. Unversioned objects use full content hashing.
 * pinSource(id, buffer) protects mounted consumers; its disposer is NOT releaseSource().
 * Capacity failures are stable until capacity changes, or retrySource() is explicitly requested.
 */
export function createWaveformService({
  workerFactory = defaultWorkerFactory,
  persistence = waveformPersistence,
  yieldControl = yieldWaveformTask,
  maxResidentBytes = DEFAULT_WAVEFORM_BYTES,
  maxSources = 256,
  maxPendingSources = 128,
  maxRecordingBuilders = 8,
  maxBaseBlockSize = 4096,
  workerTimeoutMs = 15000,
  cacheReadTimeoutMs = 150,
} = {}) {
  if (!Number.isFinite(maxResidentBytes) || maxResidentBytes < 2048
    || !Number.isSafeInteger(maxSources) || maxSources < 1
    || !Number.isSafeInteger(maxPendingSources) || maxPendingSources < 1
    || !Number.isSafeInteger(maxRecordingBuilders) || maxRecordingBuilders < 1
    || !Number.isSafeInteger(maxBaseBlockSize) || maxBaseBlockSize < 128 || Math.log2(maxBaseBlockSize) % 1 !== 0
    || !Number.isFinite(cacheReadTimeoutMs) || cacheReadTimeoutMs < 0) throw new RangeError('Invalid waveform service limits');
  const objects = new WeakMap(); // Includes weakly-held eviction descriptors for demand-driven retry.
  const entries = new Map();
  const aliases = new Map();
  // Weak bindings preserve replacement identity even after metadata LRU eviction, without owning PCM.
  const latestAliases = new Map();
  function pruneAliases() {
    for (const [key, ref] of latestAliases) if (!ref.deref()) latestAliases.delete(key);
  }
  const listeners = new Set();
  const recordings = new Set();
  let nextIdentity = 0;
  let nextJob = 0;
  let capacityEpoch = 0;
  let lifecycle = 0;
  let running;
  let io;
  let scheduled = false;
  let capacityRetryScheduled = false;
  let capacityScan;
  let disposed = false;
  let residentBytes = 0;
  let activeSummaryBytes = 0;
  let recordingBytes = 0;
  let stagingBytes = 0;
  const counters = {
    jobsStarted: 0, jobsCompleted: 0, jobsCancelled: 0, workerFailures: 0, fallbackJobs: 0,
    chunksCopied: 0, samplesScanned: 0, peakStagingBytes: 0, evictions: 0, errors: 0,
    trustedCacheHits: 0, cacheReadTimeouts: 0, persistenceSkipped: 0,
  };
  const aliasFor = (blobId, entry) => blobId == null ? entry?.token : `blob:${String(blobId)}`;
  function lookup(blobId, buffer) {
    const entry = buffer ? objects.get(buffer)
      : entries.get(aliases.get(aliasFor(blobId))) || latestAliases.get(aliasFor(blobId))?.deref();
    const key = aliasFor(blobId, entry);
    if (!entry || entry.removed || entry.lifecycle !== lifecycle || !entry.aliases.has(key)) return undefined;
    const bound = latestAliases.get(key)?.deref();
    return bound && bound !== entry ? undefined : entry;
  }
  function notify(type, entry) {
    const event = { type, blobIds: [...entry.aliases].filter((key) => key.startsWith('blob:')).map((key) => key.slice(5)), sourceId: entry.token, source: entry.state };
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* A view cannot break extraction or other subscribers. */ }
    }
  }
  function touch(entry) {
    if (!entry.admitted) return;
    entries.delete(entry.token);
    entries.set(entry.token, entry);
  }
  function current(entry) { return !entry.controller.signal.aborted && entries.get(entry.token) === entry && !disposed; }
  function check(entry) { if (!current(entry)) throw abortError(); }
  function ioBytes() {
    if (!io) return 0;
    // A write holds the same pyramid, not a second JS copy. Keep accounting if its source is removed.
    return io.kind === 'write' && io.entry.bytes && io.entry.state.pyramid === io.pyramid ? 0 : io.bytes;
  }
  function footprint() { return residentBytes + activeSummaryBytes + recordingBytes + ioBytes(); }
  function pinnedBytes(exclude) {
    return [...entries.values()].reduce((sum, entry) => sum + (entry !== exclude && entry.pins ? entry.bytes : 0), 0);
  }
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; void pump(); }, 0);
  }
  function queue(entry) {
    if (entry.removed || entry.lifecycle !== lifecycle || disposed) return;
    residentBytes -= entry.bytes;
    entry.bytes = 0;
    entry.state = { status: 'loading', pyramid: undefined, error: undefined };
    entry.pending = false;
    entry.jobId = ++nextJob;
    entry.controller = new AbortController();
    entry.retryRequested = false;
    notify('loading', entry);
    schedule();
  }
  function scheduleCapacityRetry() {
    if (capacityRetryScheduled || disposed) return;
    capacityRetryScheduled = true;
    setTimeout(retryObservedCapacity, 0);
  }
  function retryObservedCapacity() {
    capacityRetryScheduled = false;
    if (disposed) return;
    // The weak alias registry includes sources denied admission. Never turn peak-only reads into
    // observations, and visit at most one queue-sized batch per task, coalescing capacity changes.
    capacityScan ||= latestAliases.values();
    const scan = capacityScan;
    for (let work = 0; work < maxPendingSources; work += 1) {
      const next = scan.next();
      if (next.done) { if (capacityScan === scan) capacityScan = undefined; return; }
      const entry = next.value.deref();
      if (!entry || entry.removed || entry.lifecycle !== lifecycle || !entry.aliases.size
        || (!entry.pins && !entry.observed) || entry === running
        || entry.state.error?.code !== 'WAVEFORM_CAPACITY') continue;
      if (entry.failedEpoch === capacityEpoch && (entry.admitted
        || (entries.size >= maxSources && !admissionVictim(true)))) continue;
      // Do not cancel a newly queued recovery to admit the next waiter in the same batch.
      if (admit(entry, true)) {
        queue(entry);
        if (current(entry)) notify('capacity', entry);
      }
      // Admission can evict an unpinned source and change capacity. Restart on the next task,
      // rather than recursively admitting inside remove() or scanning a stale generation.
      if (capacityScan !== scan) { scheduleCapacityRetry(); return; }
    }
    scheduleCapacityRetry();
  }
  function capacityChanged() {
    capacityEpoch += 1;
    capacityScan = undefined;
    scheduleCapacityRetry();
    schedule();
  }
  function dropSummary(entry) {
    residentBytes -= entry.bytes;
    entry.bytes = 0;
    counters.evictions += 1;
    entry.state = errorState(Object.assign(new Error('Waveform summary evicted; next demand reloads it'), {
      code: 'WAVEFORM_EVICTED', retryable: true,
    }));
    notify('evicted', entry);
  }
  function remove(entry, type = 'removed', forget = true) {
    if (entry.removed) return;
    entries.delete(entry.token);
    entry.admitted = false;
    for (const key of entry.aliases) {
      if (aliases.get(key) === entry.token) aliases.delete(key);
      if ((forget || typeof WeakRef === 'undefined') && latestAliases.get(key)?.deref() === entry) latestAliases.delete(key);
    }
    if (entry.state.status === 'loading') counters.jobsCancelled += 1;
    entry.controller.abort();
    entry.cancelWorker?.();
    residentBytes -= entry.bytes;
    entry.bytes = 0;
    entry.removed = forget;
    if (!forget) {
      counters.evictions += 1;
      entry.state = errorState(Object.assign(new Error('Waveform source evicted; next demand retries admission'), {
        code: 'WAVEFORM_EVICTED', retryable: true,
      }));
    }
    notify(type, entry);
    if (forget) {
      entry.stats = undefined;
      entry.state = errorState(abortError());
    }
    capacityChanged();
  }
  function evictFor(bytes, exclude) {
    for (const entry of entries.values()) {
      if (footprint() + bytes <= maxResidentBytes) break;
      if (entry !== exclude && entry !== running && entry !== io?.entry && !entry.pins && entry.bytes) dropSummary(entry);
    }
    if (footprint() + bytes > maxResidentBytes) throw capacityError('Pinned/active waveform summaries exhaust the byte budget');
  }
  function admissionVictim(automatic) {
    return [...entries.values()].find((candidate) => !candidate.pins && candidate !== running
      && (!automatic || candidate.state.status !== 'loading'));
  }
  function admit(entry, automatic = false) {
    if (entry.admitted) return true;
    while (entries.size >= maxSources) {
      const victim = admissionVictim(automatic);
      if (!victim) {
        entry.state = errorState(capacityError('Pinned waveform sources exhaust the source limit'));
        entry.failedEpoch = capacityEpoch;
        return false;
      }
      remove(victim, 'evicted', false);
    }
    entry.admitted = true;
    entries.set(entry.token, entry);
    for (const key of entry.aliases) {
      aliases.set(key, entry.token);
      latestAliases.set(key, weakReference(entry));
    }
    return true;
  }
  function demand(entry) {
    if (entry.state.error?.code === 'WAVEFORM_CAPACITY' && entry.failedEpoch === capacityEpoch) return;
    if (entry.state.error?.retryable && admit(entry)) queue(entry);
  }

  // Only one physical storage operation may remain outstanding, even if a timeout/abort wins.
  // A non-cooperative backend keeps its reservation and disables further IO until it settles.
  function startIO(entry, kind, bytes, operation, pyramid) {
    if (!persistence || io || !current(entry)) { counters.persistenceSkipped += 1; return undefined; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const sourceSignal = entry.controller.signal;
    sourceSignal.addEventListener('abort', abort, { once: true });
    const task = { entry, kind, bytes, pyramid, controller };
    io = task;
    task.promise = Promise.resolve().then(() => controller.signal.aborted ? undefined : operation(controller.signal))
      .catch(() => undefined).finally(() => {
        sourceSignal.removeEventListener('abort', abort);
        if (io === task) io = undefined;
        capacityChanged();
      });
    return task;
  }
  function waitForRead(task, entry) {
    if (!task) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        entry.controller.signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => { task.controller.abort(); finish(undefined); };
      const timer = setTimeout(() => {
        counters.cacheReadTimeouts += 1;
        task.controller.abort();
        finish(undefined);
      }, cacheReadTimeoutMs);
      entry.controller.signal.addEventListener('abort', onAbort, { once: true });
      task.promise.then(finish);
      if (entry.controller.signal.aborted) onAbort();
    });
  }

  function makeWorkerClient(entry) {
    const worker = workerFactory?.();
    if (!worker) return undefined;
    let pending;
    let requestId = 0;
    let stopped = false;
    function fail(error) {
      if (!pending) return;
      clearTimeout(pending.timer);
      const reject = pending.reject;
      pending = undefined;
      reject(error);
    }
    worker.onmessage = ({ data }) => {
      if (!pending || data.jobId !== entry.jobId || data.requestId !== pending.requestId) return;
      const { resolve, reject, timer } = pending;
      clearTimeout(timer);
      pending = undefined;
      if (data.type === 'error') reject(new Error(data.error)); else resolve(data);
    };
    worker.onerror = (event) => { event.preventDefault?.(); fail(new Error(event.message || 'Waveform worker failed')); };
    worker.onmessageerror = () => fail(new Error('Waveform worker message could not be decoded'));
    const stop = () => {
      if (stopped) return;
      stopped = true;
      fail(abortError());
      worker.terminate();
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
    };
    entry.cancelWorker = stop;
    return {
      request(type, payload = {}, transfers = []) {
        check(entry);
        return new Promise((resolve, reject) => {
          const id = ++requestId;
          pending = { requestId: id, resolve, reject,
            timer: setTimeout(() => fail(new Error('Waveform worker timed out')), workerTimeoutMs) };
          try { worker.postMessage({ type, jobId: entry.jobId, requestId: id, ...payload }, transfers); }
          catch (error) { fail(error); }
        });
      },
      stop,
    };
  }
  async function extract(entry, buffer, metadata, client) {
    let builder;
    let fingerprint;
    if (client) await client.request('start', { metadata });
    else {
      counters.fallbackJobs += 1;
      builder = createWaveformBuilder(metadata);
      fingerprint = createWaveformFingerprint(metadata);
    }
    for (let channelIndex = 0; channelIndex < metadata.numberOfChannels; channelIndex += 1) {
      const pcm = buffer.getChannelData(channelIndex);
      if (!ArrayBuffer.isView(pcm) || Object.prototype.toString.call(pcm) !== '[object Float32Array]'
        || pcm.length !== metadata.length) throw new TypeError('Invalid AudioBuffer channel data');
      for (let startSample = 0; startSample < metadata.length; startSample += WAVEFORM_CHUNK_SAMPLES) {
        await yieldControl();
        check(entry);
        const samples = pcm.slice(startSample, Math.min(startSample + WAVEFORM_CHUNK_SAMPLES, metadata.length));
        const copiedBytes = samples.byteLength;
        stagingBytes += copiedBytes;
        counters.peakStagingBytes = Math.max(counters.peakStagingBytes, stagingBytes);
        counters.chunksCopied += 1;
        counters.samplesScanned += samples.length;
        try {
          if (client) await client.request('chunk', { channelIndex, startSample, samples }, [samples.buffer]);
          else {
            builder.append(channelIndex, startSample, samples);
            try { await fingerprint?.append(samples); } catch { fingerprint = undefined; }
          }
        } finally { stagingBytes -= copiedBytes; }
      }
    }
    check(entry);
    if (client) return client.request('finish');
    let hash;
    try { hash = await fingerprint?.finish(); } catch { /* Persistence is optional. */ }
    return { pyramid: builder.finish(), fingerprint: hash };
  }
  function metadataFor(entry, buffer) {
    const { sampleRate, length, numberOfChannels } = buffer;
    const available = maxResidentBytes - pinnedBytes(entry) - ioBytes() - recordingBytes;
    const budget = Math.min(maxResidentBytes / 2, available);
    let baseBlockSize;
    try { baseBlockSize = chooseWaveformBlockSize(length, numberOfChannels, Math.max(0, budget)); }
    catch (error) {
      if (error instanceof RangeError) throw capacityError('No room for another waveform summary');
      throw error;
    }
    if (baseBlockSize > maxBaseBlockSize) throw capacityError('Waveform budget would exceed the bounded raw-edge refinement cost');
    return { sampleRate, length, numberOfChannels, baseBlockSize };
  }
  const validResult = (pyramid, metadata) => validateWaveformPyramid(pyramid)
    && pyramid.sampleRate === metadata.sampleRate && pyramid.length === metadata.length
    && pyramid.numberOfChannels === metadata.numberOfChannels && pyramid.baseBlockSize === metadata.baseBlockSize
    && waveformByteLength(pyramid) === estimateWaveformBytes(metadata.length, metadata.numberOfChannels, metadata.baseBlockSize);
  function publish(entry, pyramid, fingerprint, cacheHit) {
    check(entry);
    entry.bytes = waveformByteLength(pyramid);
    residentBytes += entry.bytes;
    activeSummaryBytes = 0;
    entry.pending = false;
    const stats = Object.freeze({
      sampleRate: pyramid.sampleRate, length: pyramid.length, numberOfChannels: pyramid.numberOfChannels,
      sourcePeak: pyramid.sourcePeak, channelPeaks: Object.freeze([...pyramid.channelPeaks]),
      byteLength: entry.bytes, fingerprint, revision: entry.revision, cacheHit,
    });
    // Lightweight source facts outlive both summary-buffer eviction and metadata admission.
    entry.stats = stats;
    entry.state = { status: 'ready', pyramid, error: undefined, stats };
    counters.jobsCompleted += 1;
    touch(entry);
    notify('ready', entry);
  }
  async function pump() {
    if (running || disposed) return;
    const loading = [...entries.values()].filter((candidate) => candidate.state.status === 'loading')
      .sort((a, b) => (b.pins > 0) - (a.pins > 0) || b.priority - a.priority || a.jobId - b.jobId);
    loading.forEach((candidate, index) => { candidate.pending = index < maxPendingSources; });
    const entry = loading[0];
    if (!entry) return;
    running = entry;
    counters.jobsStarted += 1;
    let client;
    try {
      check(entry);
      const buffer = entry.bufferRef.deref();
      if (!buffer) { remove(entry); return; }
      let metadata = metadataFor(entry, buffer);
      if (entry.revision && persistence?.loadRevision && entry.cacheBlobId != null && !io) {
        const bytes = estimateWaveformBytes(metadata.length, metadata.numberOfChannels, metadata.baseBlockSize);
        evictFor(bytes, entry);
        const task = startIO(entry, 'read', bytes,
          (signal) => persistence.loadRevision(entry.cacheBlobId, entry.revision, metadata, { signal, maxBaseBlockSize }));
        const cached = await waitForRead(task, entry);
        check(entry);
        if (cached?.baseBlockSize >= metadata.baseBlockSize && cached.baseBlockSize <= maxBaseBlockSize
          && validResult(cached, { ...metadata, baseBlockSize: cached.baseBlockSize })
          && waveformByteLength(cached) <= bytes) {
          counters.trustedCacheHits += 1;
          publish(entry, cached, undefined, true);
          return;
        }
        // A timed-out, non-cooperative read still owns a reservation. Adapt around it, never hide it.
        metadata = metadataFor(entry, buffer);
      }
      const bytes = estimateWaveformBytes(metadata.length, metadata.numberOfChannels, metadata.baseBlockSize);
      evictFor(bytes, entry);
      activeSummaryBytes = bytes;
      let result;
      try {
        client = makeWorkerClient(entry);
        if (client) {
          result = await extract(entry, buffer, metadata, client);
          if (!validResult(result?.pyramid, metadata)) throw new Error('Invalid waveform worker result');
        }
      } catch (error) {
        client?.stop();
        client = undefined;
        check(entry);
        counters.workerFailures += 1;
        result = undefined;
        await yieldControl();
        check(entry);
      }
      client?.stop();
      client = undefined;
      if (!result) result = await extract(entry, buffer, metadata, undefined);
      check(entry);
      if (!validResult(result?.pyramid, metadata)) throw new Error('Invalid waveform extraction result');
      // Publish before ANY post-extraction IndexedDB operation. Storage never gates this readiness.
      publish(entry, result.pyramid, result.fingerprint, false);
      if (!entry.retryRequested && current(entry)) {
        if (entry.revision && persistence?.saveRevision && entry.cacheBlobId != null) {
          startIO(entry, 'write', bytes,
            (signal) => persistence.saveRevision(entry.cacheBlobId, entry.revision, result.pyramid, { signal }), result.pyramid);
        } else if (result.fingerprint && persistence?.save) {
          startIO(entry, 'write', bytes,
            (signal) => persistence.save(result.fingerprint, result.pyramid, { signal }), result.pyramid);
        }
      }
    } catch (error) {
      if (current(entry)) {
        counters.errors += 1;
        entry.pending = false;
        entry.failedEpoch = capacityEpoch;
        entry.state = errorState(error);
        notify('error', entry);
      }
    } finally {
      client?.stop();
      entry.cancelWorker = undefined;
      activeSummaryBytes = 0;
      stagingBytes = 0;
      running = undefined;
      if (entry.retryRequested && entry.admitted && !entry.removed && !disposed) queue(entry);
      // An unpinned active source becomes an admission victim only now. Rescan without advancing
      // capacityEpoch: a failed byte-budget job must never schedule another identical extraction.
      capacityScan = undefined;
      scheduleCapacityRetry();
      schedule();
    }
  }

  const service = {
    ensureSource(blobId, audioBuffer, options = {}) {
      if (disposed || !audioBuffer || typeof audioBuffer !== 'object') return undefined;
      let entry = objects.get(audioBuffer);
      if (entry?.lifecycle !== lifecycle) entry = undefined;
      const revisionProvided = Object.prototype.hasOwnProperty.call(options, 'revision');
      const normalized = revisionProvided ? normalizeWaveformRevision(options.revision) : entry?.revisionKey;
      if (entry && !entry.removed && revisionProvided && entry.revisionKey !== normalized) remove(entry, 'replaced');
      if (!entry || entry.removed) {
        entry = {
          token: `decoded:${++nextIdentity}`, lifecycle, aliases: new Set(), bufferRef: weakReference(audioBuffer),
          controller: new AbortController(), bytes: 0, pins: 0, priority: 0, admitted: false, observed: false,
          state: { status: 'loading', pyramid: undefined, error: undefined }, pending: false,
          jobId: ++nextJob, revisionKey: normalized,
          revision: revisionSnapshot(normalized),
          cacheBlobId: blobId,
        };
        objects.set(audioBuffer, entry);
      }
      const key = aliasFor(blobId, entry);
      const previous = latestAliases.get(key)?.deref();
      if (previous && previous !== entry) {
        previous.aliases.delete(key);
        aliases.delete(key);
        if (!previous.aliases.size) remove(previous, 'replaced'); else notify('replaced', previous);
      }
      entry.aliases.add(key);
      latestAliases.set(key, weakReference(entry));
      if (nextIdentity % 64 === 0 && latestAliases.size > maxSources * 2) pruneAliases();
      entry.priority = Math.max(entry.priority, Number.isFinite(options.priority) ? options.priority : 0);
      if (!entry.admitted && entry.state.error?.code === 'WAVEFORM_CAPACITY' && entry.failedEpoch === capacityEpoch) return entry.state;
      const wasAdmitted = entry.admitted;
      if (admit(entry)) {
        aliases.set(key, entry.token);
        if (!wasAdmitted) {
          entry.controller = new AbortController();
          entry.state = { status: 'loading', pyramid: undefined, error: undefined };
          notify('loading', entry);
        } else demand(entry);
        touch(entry);
        schedule();
      } else notify('error', entry);
      return entry.state;
    },
    getSource(blobId, audioBuffer) {
      const entry = lookup(blobId, audioBuffer);
      if (!entry) return undefined;
      entry.observed = true;
      demand(entry);
      touch(entry);
      return entry.state;
    },
    /** Passive normalization/diagnostic read: no admission, observation, jobs, LRU touch or events. */
    getSourceStats(blobId, audioBuffer) { return lookup(blobId, audioBuffer)?.stats; },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** A mounted view must pin; multiple pins share one source and each disposer is idempotent. */
    pinSource(blobId, audioBuffer, options) {
      if (disposed || !audioBuffer) return () => {};
      let entry = lookup(blobId, audioBuffer);
      if (!entry || options) {
        service.ensureSource(blobId, audioBuffer, options);
        entry = lookup(blobId, audioBuffer);
      }
      if (!entry) return () => {};
      entry.pins += 1;
      demand(entry);
      notify('pinned', entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.pins -= 1;
        if (!entry.removed && entry.lifecycle === lifecycle) {
          if (!entry.pins) entry.observed = false;
          notify('unpinned', entry);
          capacityChanged();
        }
      };
    },
    /** Explicit alias ownership release (not a per-view unmount). Also invalidates pins on that source. */
    releaseSource(blobId, audioBuffer) {
      const entry = lookup(blobId, audioBuffer);
      if (!entry) return;
      const key = aliasFor(blobId, entry);
      if (aliases.get(key) === entry.token) aliases.delete(key);
      if (latestAliases.get(key)?.deref() === entry) latestAliases.delete(key);
      if (entry.aliases.size === 1) remove(entry);
      entry.aliases.delete(key);
      if (entry.aliases.size) notify('removed', entry);
    },
    retrySource(blobId, audioBuffer, options) {
      const entry = lookup(blobId, audioBuffer);
      if (!entry) return service.ensureSource(blobId, audioBuffer, options);
      entry.observed = true;
      if (options && Object.prototype.hasOwnProperty.call(options, 'revision')
        && normalizeWaveformRevision(options.revision) !== entry.revisionKey) {
        return service.ensureSource(blobId, audioBuffer, options);
      }
      entry.stats = undefined;
      if (entry === running) {
        entry.retryRequested = true;
        entry.controller.abort();
        entry.cancelWorker?.();
      } else {
        entry.controller.abort();
        residentBytes -= entry.bytes;
        entry.bytes = 0;
        if (admit(entry)) queue(entry);
      }
      return entry.state;
    },
    /**
     * Background recording work, NOT an audio-capture callback API. maxLength is a hard sample cap.
     * Await append(Float32Array[channel][]) before mutating/reusing those input arrays or appending again.
     * finish(audioBuffer, { revision }?) trusts that buffer contains exactly the appended PCM; it reads
     * metadata only, publishes the final pyramid, and never rescans playback PCM. No live preview yet.
     */
    createRecordingBuilder(blobId, { sampleRate, numberOfChannels, maxLength }) {
      if (disposed) throw abortError();
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError('Invalid recording sample rate');
      if (recordings.size >= maxRecordingBuilders) throw capacityError('Too many recording waveform builders');
      const available = maxResidentBytes - pinnedBytes() - ioBytes() - recordingBytes - activeSummaryBytes;
      const budget = Math.max(0, Math.min(maxResidentBytes / 2, available / 2));
      const baseBlockSize = chooseWaveformBlockSize(maxLength, numberOfChannels, budget);
      if (baseBlockSize > maxBaseBlockSize) throw capacityError('Recording capacity would exceed the raw-edge refinement bound');
      const bytes = estimateWaveformBytes(maxLength, numberOfChannels, baseBlockSize);
      evictFor(bytes * 2);
      let builder = createWaveformBuilder({ sampleRate, length: maxLength, numberOfChannels, baseBlockSize });
      let reservation = bytes * 2; // Capacity summary + final compact summary during finalization.
      recordingBytes += reservation;
      counters.jobsStarted += 1;
      const controller = new AbortController();
      let position = 0;
      let busy = false;
      let closed = false;
      let finalizing = false;
      function checkRecording() { if (closed || controller.signal.aborted || disposed) throw abortError(); }
      function releaseRecording() {
        builder = undefined;
        recordingBytes -= reservation;
        reservation = 0;
        recordings.delete(session);
        capacityChanged();
      }
      const session = {
        async append(channelData) {
          checkRecording();
          if (busy) throw new Error('Await the previous recording append before appending or finishing');
          if (!Array.isArray(channelData) || channelData.length !== numberOfChannels
            || channelData.some((samples) => !ArrayBuffer.isView(samples)
              || Object.prototype.toString.call(samples) !== '[object Float32Array]'
              || samples.length !== channelData[0].length)
            || position + channelData[0].length > maxLength) throw new RangeError('Invalid or over-capacity recording chunk');
          busy = true;
          try {
            for (let start = 0; start < channelData[0].length; start += WAVEFORM_CHUNK_SAMPLES) {
              await yieldControl();
              checkRecording();
              const size = Math.min(WAVEFORM_CHUNK_SAMPLES, channelData[0].length - start);
              for (let c = 0; c < numberOfChannels; c += 1) {
                const samples = channelData[c].slice(start, start + size);
                stagingBytes += samples.byteLength;
                counters.peakStagingBytes = Math.max(counters.peakStagingBytes, stagingBytes);
                counters.chunksCopied += 1;
                counters.samplesScanned += size;
                try { builder.append(c, position, samples); }
                finally { stagingBytes -= samples.byteLength; }
              }
              position += size;
            }
          } finally { busy = false; }
        },
        async finish(audioBuffer, options = {}) {
          checkRecording();
          if (busy) throw new Error('Await the previous recording append before finishing');
          if (!audioBuffer || audioBuffer.length !== position || audioBuffer.sampleRate !== sampleRate
            || audioBuffer.numberOfChannels !== numberOfChannels) throw new TypeError('Recording AudioBuffer metadata does not match appended PCM');
          busy = true;
          finalizing = true;
          try {
            const pyramid = await builder.finishAt(position, { signal: controller.signal, yieldControl });
            checkRecording();
            service.ensureSource(blobId, audioBuffer, options);
            const entry = lookup(blobId, audioBuffer);
            checkRecording();
            if (!entry?.admitted) throw entry?.state.error || capacityError('Recording source could not be admitted');
            if (entry === running) throw new Error('Release an active extraction before adopting its recording buffer');
            check(entry);
            residentBytes -= entry.bytes;
            entry.bytes = 0;
            // Transfer ownership without a gap in accounting or an intermediate observer notification.
            builder = undefined;
            recordingBytes -= reservation;
            reservation = 0;
            recordings.delete(session);
            closed = true;
            publish(entry, pyramid, undefined, false);
            if (entry.revision && persistence?.saveRevision && current(entry)) {
              startIO(entry, 'write', entry.bytes,
                (signal) => persistence.saveRevision(entry.cacheBlobId, entry.revision, pyramid, { signal }), pyramid);
            }
            capacityChanged();
            return entry.state;
          } catch (error) {
            closed = true;
            controller.abort();
            releaseRecording();
            throw error;
          } finally { busy = false; finalizing = false; }
        },
        cancel() {
          if (closed) return;
          closed = true;
          counters.jobsCancelled += 1;
          controller.abort();
          // A finalizer retains its capacity arrays until its next cooperative cancellation check.
          if (!finalizing) releaseRecording();
        },
        getStats: () => ({ length: position, maxLength, baseBlockSize, reservedBytes: reservation, busy, closed }),
      };
      recordings.add(session);
      return session;
    },
    clear() {
      lifecycle += 1;
      latestAliases.clear();
      for (const recording of [...recordings]) recording.cancel();
      for (const entry of [...entries.values()]) remove(entry);
      io?.controller.abort();
    },
    dispose() { disposed = true; service.clear(); listeners.clear(); },
    getStats() {
      pruneAliases();
      return {
        ...counters, sources: entries.size, residentBytes, activeSummaryBytes, stagingBytes,
        persistenceBytes: ioBytes(), recordingBytes, recordingBuilders: recordings.size,
        accountedBytes: footprint(), pinnedBytes: pinnedBytes(),
        pinnedSources: [...entries.values()].filter((entry) => entry.pins > 0).length,
        pins: [...entries.values()].reduce((sum, entry) => sum + entry.pins, 0),
        maxResidentBytes, maxBaseBlockSize, maxRawEdgeSamples: maxBaseBlockSize * 2,
        maxStagingBytes: WAVEFORM_CHUNK_SAMPLES * 8,
        queueDepth: Math.min(maxPendingSources - (running?.state.status === 'loading' ? 1 : 0),
          [...entries.values()].filter((entry) => entry.state.status === 'loading' && entry !== running).length),
        deferredSources: Math.max(0, [...entries.values()].filter((entry) => entry.state.status === 'loading').length - maxPendingSources),
        activeJobs: running ? 1 : 0, persistenceJobs: io ? 1 : 0, listeners: listeners.size,
        persistence: persistence?.getStats?.(),
      };
    },
  };
  return service;
}

export const waveformService = createWaveformService();
export default waveformService;
