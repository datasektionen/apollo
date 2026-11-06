import {
  createWaveformBuilder, createWaveformFingerprint, chooseWaveformBlockSize, estimateWaveformBytes,
  waveformByteLength, validateWaveformPyramid, WAVEFORM_CHUNK_SAMPLES, DEFAULT_WAVEFORM_BYTES, yieldWaveformTask,
  WAVEFORM_BASE_BLOCK_SIZE, WAVEFORM_PAGE_SAMPLES, WAVEFORM_SOURCE_BYTES,
} from './waveformData';
import { waveformPersistence, normalizeWaveformRevision } from './waveformPersistence';


const RECORDING_INITIAL_CAPACITY = 2 ** 22; // ~87 s at 48 kHz before the first doubling.
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
 * A source overview is limited to maxSourceBytes unless that would exceed maxBaseBlockSize. Overviews
 * coarser than WAVEFORM_BASE_BLOCK_SIZE get base-128 detail pages only for requested visible ranges.
 */
export function createWaveformService({
  workerFactory = defaultWorkerFactory,
  persistence = waveformPersistence,
  yieldControl = yieldWaveformTask,
  maxResidentBytes = DEFAULT_WAVEFORM_BYTES,
  maxSourceBytes = Math.min(maxResidentBytes / 2, WAVEFORM_SOURCE_BYTES),
  maxDetailBytes = Math.floor(maxResidentBytes / 4),
  detailPageSamples = WAVEFORM_PAGE_SAMPLES,
  maxDetailQueue = 64,
  maxSources = 256,
  maxPendingSources = 128,
  maxRecordingBuilders = 8,
  recordingInitialCapacity = RECORDING_INITIAL_CAPACITY,
  maxBaseBlockSize = 4096,
  workerTimeoutMs = 15000,
  cacheReadTimeoutMs = 150,
} = {}) {
  if (!Number.isFinite(maxResidentBytes) || maxResidentBytes < 2048
    || !Number.isFinite(maxSourceBytes) || maxSourceBytes <= 0 || maxSourceBytes > maxResidentBytes
    || !Number.isFinite(maxDetailBytes) || maxDetailBytes < 0 || maxDetailBytes > maxResidentBytes
    || !Number.isSafeInteger(detailPageSamples) || detailPageSamples < WAVEFORM_BASE_BLOCK_SIZE
    || Math.log2(detailPageSamples) % 1 !== 0
    || !Number.isSafeInteger(maxDetailQueue) || maxDetailQueue < 1
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
  // Detail pages across all sources in LRU order (page -> owner), plus the in-progress reservation.
  const detailLru = new Map();
  let detailBytes = 0;
  let detailQueue = [];
  let detailRunning = false;
  const counters = {
    jobsStarted: 0, jobsCompleted: 0, jobsCancelled: 0, workerFailures: 0, fallbackJobs: 0,
    chunksCopied: 0, samplesScanned: 0, peakStagingBytes: 0, evictions: 0, errors: 0,
    trustedCacheHits: 0, cacheReadTimeouts: 0, persistenceSkipped: 0,
    detailPagesBuilt: 0, detailPagesEvicted: 0, detailSamplesScanned: 0, detailRequestsDeclined: 0, detailErrors: 0,
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
  function footprint() { return residentBytes + activeSummaryBytes + recordingBytes + ioBytes() + detailBytes; }
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
    dropPages(entry);
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
  function evictPage(page, owner) {
    detailLru.delete(page);
    if (owner.pages.get(page.index) === page) owner.pages.delete(page.index);
    detailBytes -= page.bytes;
    counters.detailPagesEvicted += 1;
  }
  function dropPages(entry) {
    entry.pageGeneration += 1;
    for (const page of entry.pages.values()) {
      detailLru.delete(page);
      detailBytes -= page.bytes;
    }
    entry.pages.clear();
  }
  function reserveDetail(bytes) {
    const fits = () => detailBytes + bytes <= maxDetailBytes && footprint() + bytes <= maxResidentBytes;
    for (const [page, owner] of detailLru) {
      if (fits()) break;
      evictPage(page, owner);
    }
    if (!fits()) return false;
    detailBytes += bytes;
    return true;
  }
  function wantsDetail(entry, generation) {
    return current(entry) && entry.pageGeneration === generation && entry.state.status === 'ready'
      && entry.state.pyramid.baseBlockSize > WAVEFORM_BASE_BLOCK_SIZE;
  }
  /** Cooperative and main-thread: a page reads borrowed PCM in chunk-sized tasks, never a full source. */
  async function pumpDetail() {
    if (detailRunning || disposed) return;
    detailRunning = true;
    try {
      while (detailQueue.length && !disposed) {
        const { entry, index, generation } = detailQueue.shift();
        const buffer = entry.bufferRef.deref();
        if (!buffer || !wantsDetail(entry, generation) || entry.pages.has(index)) continue;
        const start = index * detailPageSamples;
        const length = Math.min(detailPageSamples, buffer.length - start);
        const bytes = estimateWaveformBytes(length, buffer.numberOfChannels);
        if (length <= 0 || !reserveDetail(bytes)) continue;
        let page;
        try {
          const builder = createWaveformBuilder({ sampleRate: buffer.sampleRate, length, numberOfChannels: buffer.numberOfChannels });
          for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
            for (let offset = 0; offset < length; offset += WAVEFORM_CHUNK_SAMPLES) {
              await yieldControl();
              if (disposed || !wantsDetail(entry, generation)) throw abortError();
              const end = Math.min(offset + WAVEFORM_CHUNK_SAMPLES, length);
              builder.append(channelIndex, offset, buffer.getChannelData(channelIndex).subarray(start + offset, start + end));
              counters.detailSamplesScanned += end - offset;
            }
          }
          page = { index, start, length, pyramid: builder.finish(), bytes };
        } catch (error) {
          if (error?.name !== 'AbortError') counters.detailErrors += 1;
        }
        if (page) {
          entry.pages.set(index, page);
          detailLru.set(page, entry);
          counters.detailPagesBuilt += 1;
        } else detailBytes -= bytes;
      }
    } finally { detailRunning = false; }
  }
  function dropSummary(entry) {
    dropPages(entry);
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
    dropPages(entry);
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
    // Detail pages are optional refinements, so they always go before any summary.
    for (const [page, owner] of detailLru) {
      if (footprint() + bytes <= maxResidentBytes) break;
      evictPage(page, owner);
    }
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
    let baseBlockSize;
    try { baseBlockSize = chooseWaveformBlockSize(length, numberOfChannels, Math.max(0, Math.min(maxSourceBytes, available))); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      baseBlockSize = Infinity;
    }
    // Only the raw-edge bound, not the per-source share, may refuse a very long source.
    if (baseBlockSize > maxBaseBlockSize && estimateWaveformBytes(length, numberOfChannels, maxBaseBlockSize)
      <= Math.min(maxResidentBytes / 2, available)) baseBlockSize = maxBaseBlockSize;
    if (baseBlockSize === Infinity) throw capacityError('No room for another waveform summary');
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
      let adopted = false;
      if (entry && !entry.removed && revisionProvided && entry.revisionKey !== normalized) {
        // A provisional recording summary was built from this exact buffer; its first media revision names it.
        if (entry.provisional && entry.revisionKey === undefined && normalized && blobId != null) {
          entry.revisionKey = normalized;
          entry.revision = revisionSnapshot(normalized);
          entry.cacheBlobId = blobId;
          if (entry.stats) {
            entry.stats = Object.freeze({ ...entry.stats, revision: entry.revision });
            if (entry.state.status === 'ready') entry.state.stats = entry.stats;
          }
          adopted = true;
        } else remove(entry, 'replaced');
      }
      if (!entry || entry.removed) {
        entry = {
          token: `decoded:${++nextIdentity}`, lifecycle, aliases: new Set(), bufferRef: weakReference(audioBuffer),
          controller: new AbortController(), bytes: 0, pins: 0, priority: 0, admitted: false, observed: false,
          state: { status: 'loading', pyramid: undefined, error: undefined }, pending: false,
          jobId: ++nextJob, revisionKey: normalized,
          revision: revisionSnapshot(normalized),
          cacheBlobId: blobId, pages: new Map(), pageGeneration: 0,
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
      if (entry.provisional && blobId != null && entry.aliases.has(entry.token)) {
        // The cache alias now owns the source, so releasing it frees the summary.
        entry.aliases.delete(entry.token);
        if (aliases.get(entry.token) === entry.token) aliases.delete(entry.token);
        if (latestAliases.get(entry.token)?.deref() === entry) latestAliases.delete(entry.token);
      }
      if (adopted) entry.provisional = false;
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
        if (adopted && entry.state.status === 'ready' && persistence?.saveRevision) {
          const { pyramid } = entry.state;
          startIO(entry, 'write', entry.bytes,
            (signal) => persistence.saveRevision(entry.cacheBlobId, entry.revision, pyramid, { signal }), pyramid);
        }
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
    /**
     * Visible working set for an overview coarser than WAVEFORM_BASE_BLOCK_SIZE. Returns a live
     * sample -> page lookup, or undefined when no pages apply or the range exceeds half the page budget.
     * Requested pages become most recent; missing ones build in the background, latest request first.
     */
    requestDetail(blobId, audioBuffer, startSample, endSample) {
      const entry = lookup(blobId, audioBuffer);
      const pyramid = entry?.state.pyramid;
      if (!pyramid || pyramid.baseBlockSize <= WAVEFORM_BASE_BLOCK_SIZE || !(endSample > startSample)) return undefined;
      const first = Math.max(0, Math.floor(startSample / detailPageSamples));
      const last = Math.min(Math.ceil(pyramid.length / detailPageSamples), Math.ceil(endSample / detailPageSamples)) - 1;
      const pageBytes = estimateWaveformBytes(Math.min(detailPageSamples, pyramid.length), pyramid.numberOfChannels);
      if (last < first || (last - first + 1) * pageBytes * 2 > maxDetailBytes) {
        counters.detailRequestsDeclined += 1;
        return undefined;
      }
      const missing = [];
      for (let index = first; index <= last; index += 1) {
        const page = entry.pages.get(index);
        if (page) {
          detailLru.delete(page);
          detailLru.set(page, entry);
        } else missing.push({ entry, index, generation: entry.pageGeneration });
      }
      if (missing.length) {
        const queued = new Set(missing.map(({ index }) => index));
        // The budget already bounds this request; the queue cap only discards older requests.
        detailQueue = [...missing, ...detailQueue.filter((job) => job.entry !== entry || !queued.has(job.index))
          .slice(0, Math.max(0, maxDetailQueue - missing.length))];
        void pumpDetail();
      }
      const { pages } = entry;
      return (sample) => pages.get(Math.floor(sample / detailPageSamples));
    },
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
        dropPages(entry);
        residentBytes -= entry.bytes;
        entry.bytes = 0;
        if (admit(entry)) queue(entry);
      }
      return entry.state;
    },
    /**
     * Background recording work, NOT an audio-capture callback API. maxLength is a hard sample cap;
     * omit it for a take of unknown length, whose capacity doubles (coarsening if the budget requires).
     * Await append(Float32Array[channel][]) before mutating/reusing those input arrays or appending again.
     * finish(audioBuffer, { revision }?) trusts that buffer's PCM equals the appended prefix. It reads
     * only PCM never appended plus at most one partial tail bucket, and publishes the final pyramid.
     * A null blobId publishes a provisional source that the buffer's first cache alias and revision adopt.
     */
    createRecordingBuilder(blobId, { sampleRate, numberOfChannels, maxLength }) {
      if (disposed) throw abortError();
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError('Invalid recording sample rate');
      if (recordings.size >= maxRecordingBuilders) throw capacityError('Too many recording waveform builders');
      const growable = maxLength === undefined;
      let capacity = growable ? recordingInitialCapacity : maxLength;
      const available = maxResidentBytes - pinnedBytes() - ioBytes() - recordingBytes - activeSummaryBytes;
      const budget = Math.max(0, Math.min(maxResidentBytes / 2, maxSourceBytes, available / 2));
      const baseBlockSize = chooseWaveformBlockSize(capacity, numberOfChannels, budget);
      if (baseBlockSize > maxBaseBlockSize) throw capacityError('Recording capacity would exceed the raw-edge refinement bound');
      const bytes = estimateWaveformBytes(capacity, numberOfChannels, baseBlockSize);
      evictFor(bytes * 2);
      let builder = createWaveformBuilder({ sampleRate, length: capacity, numberOfChannels, baseBlockSize });
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
      function setReservation(next) {
        recordingBytes += next - reservation;
        reservation = next;
      }
      function growTo(required) {
        let next = capacity;
        while (next < required) next *= 2;
        for (;;) {
          const needed = estimateWaveformBytes(next, numberOfChannels, builder.baseBlockSize) * 2;
          try {
            if (needed > Math.min(maxResidentBytes / 2, maxSourceBytes * 2)) throw capacityError('Recording summary exceeds its share of the byte budget');
            if (needed > reservation) evictFor(needed - reservation);
            setReservation(needed);
            break;
          } catch (error) {
            if (error?.code !== 'WAVEFORM_CAPACITY' || builder.baseBlockSize * 2 > maxBaseBlockSize || !builder.coarsen()) throw error;
            setReservation(estimateWaveformBytes(capacity, numberOfChannels, builder.baseBlockSize) * 2);
          }
        }
        builder.grow(next);
        capacity = next;
      }
      async function appendChannels(channelData, from, to) {
        for (let start = from; start < to; start += WAVEFORM_CHUNK_SAMPLES) {
          await yieldControl();
          checkRecording();
          const size = Math.min(WAVEFORM_CHUNK_SAMPLES, to - start);
          if (position + size > capacity) growTo(position + size);
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
      }
      const session = {
        async append(channelData) {
          checkRecording();
          if (busy) throw new Error('Await the previous recording append before appending or finishing');
          if (!Array.isArray(channelData) || channelData.length !== numberOfChannels
            || channelData.some((samples) => !ArrayBuffer.isView(samples)
              || Object.prototype.toString.call(samples) !== '[object Float32Array]'
              || samples.length !== channelData[0].length)
            || (!growable && position + channelData[0].length > maxLength)) throw new RangeError('Invalid or over-capacity recording chunk');
          busy = true;
          try { await appendChannels(channelData, 0, channelData[0].length); }
          finally { busy = false; }
        },
        async finish(audioBuffer, options = {}) {
          checkRecording();
          if (busy) throw new Error('Await the previous recording append before finishing');
          if (!audioBuffer || !Number.isSafeInteger(audioBuffer.length) || (!growable && audioBuffer.length > maxLength)
            || audioBuffer.sampleRate !== sampleRate
            || audioBuffer.numberOfChannels !== numberOfChannels) throw new TypeError('Recording AudioBuffer metadata does not match appended PCM');
          busy = true;
          finalizing = true;
          try {
            if (audioBuffer.length > position) {
              const pcm = Array.from({ length: numberOfChannels }, (_, c) => audioBuffer.getChannelData(c));
              await appendChannels(pcm, position, audioBuffer.length);
            }
            const pyramid = await builder.finishAt(audioBuffer.length, { signal: controller.signal, yieldControl, audioBuffer });
            checkRecording();
            service.ensureSource(blobId, audioBuffer, options);
            const entry = lookup(blobId, audioBuffer);
            checkRecording();
            if (!entry?.admitted) throw entry?.state.error || capacityError('Recording source could not be admitted');
            if (entry === running) throw new Error('Release an active extraction before adopting its recording buffer');
            check(entry);
            residentBytes -= entry.bytes;
            entry.bytes = 0;
            if (blobId == null && entry.aliases.size === 1) entry.provisional = true;
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
        getStats: () => ({ length: position, maxLength, capacity, baseBlockSize: builder?.baseBlockSize ?? baseBlockSize,
          reservedBytes: reservation, busy, closed }),
      };
      recordings.add(session);
      return session;
    },
    clear() {
      lifecycle += 1;
      latestAliases.clear();
      for (const recording of [...recordings]) recording.cancel();
      for (const entry of [...entries.values()]) remove(entry);
      detailQueue = [];
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
        maxResidentBytes, maxSourceBytes, maxBaseBlockSize, maxRawEdgeSamples: maxBaseBlockSize * 2,
        detailPages: detailLru.size, detailBytes, maxDetailBytes, detailPageSamples, detailQueueDepth: detailQueue.length,
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

/**
 * Pin each decoded stem and resolve when its overview is ready or has failed.
 * Call the returned release after mounted views have pinned the same buffers.
 */
export function settleWaveformSources(service, entries, { isCancelled, onProgress } = {}) {
  const unique = [];
  const seen = new Set();
  for (const entry of entries || []) {
    if (!entry?.audioBuffer || entry.blobId == null || seen.has(entry.blobId)) continue;
    seen.add(entry.blobId);
    unique.push(entry);
  }
  const releases = [];
  const pending = new Set(unique.map((entry) => String(entry.blobId)));
  let settled = 0;
  const report = () => onProgress?.({ ready: settled, total: unique.length });
  const note = (blobId) => {
    const id = String(blobId);
    if (!pending.has(id)) return;
    pending.delete(id);
    settled += 1;
    report();
  };
  report();
  if (!unique.length) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    let finished = false;
    let poll = 0;
    const release = () => { for (const unpin of releases) unpin(); };
    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearInterval(poll);
      resolve(release);
    };
    const unsubscribe = service.subscribe((event) => {
      if (isCancelled?.()) { finish(); return; }
      if (event?.type !== 'ready' && event?.type !== 'error') return;
      for (const id of event.blobIds || []) note(id);
      if (!pending.size) finish();
    });
    poll = setInterval(() => {
      if (isCancelled?.()) { finish(); return; }
      for (const entry of unique) {
        const state = service.getSource(entry.blobId, entry.audioBuffer);
        if (!state || state.status === 'ready' || state.status === 'error') note(entry.blobId);
      }
      if (!pending.size) finish();
    }, 50);
    for (const entry of unique) {
      if (finished) break;
      service.ensureSource(entry.blobId, entry.audioBuffer, { priority: 1 });
      releases.push(service.pinSource(entry.blobId, entry.audioBuffer));
      const state = service.getSource(entry.blobId, entry.audioBuffer);
      if (!state || state.status === 'ready' || state.status === 'error') note(entry.blobId);
      if (!pending.size) finish();
    }
    if (!finished && isCancelled?.()) finish();
  });
}

export const waveformService = createWaveformService();
export default waveformService;
