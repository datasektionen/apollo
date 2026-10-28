#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, cpus, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const project = fileURLToPath(new URL('../', import.meta.url));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const usage = `Usage: node scripts/waveform-benchmark.mjs [--fixture quick|reference|medium|stress] [--out artifacts/waveform] [--timeout-ms 120000] [--trace]\nRequires Node with built-in WebSocket and installed macOS Google Chrome. No npm/package changes needed.\nWrites results.json and settled.png, plus chrome-trace.json with --trace, in a project-contained output directory. Existing files with those names are overwritten.`;
const options = { fixture: 'quick', out: 'artifacts/waveform', timeoutMs: 120000, trace: false };
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--help') { console.log(usage); process.exit(0); }
  if (arg === '--trace') { options.trace = true; continue; }
  const value = process.argv[++i];
  if (!value) throw Error(`Missing value for ${arg}\n${usage}`);
  if (arg === '--fixture' && ['quick', 'reference', 'medium', 'stress'].includes(value)) options.fixture = value;
  else if (arg === '--out') options.out = value;
  else if (arg === '--timeout-ms' && Number.isInteger(Number(value)) && Number(value) >= 15000 && Number(value) <= 120000) options.timeoutMs = Number(value);
  else throw Error(`Invalid argument: ${arg} ${value}\n${usage}`);
}
if (typeof WebSocket !== 'function') throw Error('Node built-in WebSocket is unavailable; use Node 22.4+ (Node 24+ recommended).');
const output = path.resolve(project, options.out);
function contained(directory) {
  const relative = path.relative(project, directory);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
if (!contained(output)) throw Error('--out must be a subdirectory of this project');
// Reject symlink escapes as well as lexical ../ escapes before creating output.
let ancestor = output;
while (true) {
  try {
    const resolved = await realpath(ancestor);
    if (resolved !== await realpath(project) && !contained(resolved)) throw Error('--out resolves outside this project');
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ancestor = path.dirname(ancestor);
  }
}
await mkdir(output, { recursive: true });
// Do not leave a previous successful screenshot beside a new failed run.
await rm(path.join(output, 'settled.png'), { force: true });
await rm(path.join(output, 'chrome-trace.json'), { force: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out after ${ms}ms`)), ms); })])
    .finally(() => clearTimeout(timer));
}

class CDP {
  constructor(socket, errors) {
    this.socket = socket; this.pending = new Map(); this.nextId = 0; this.errors = errors;
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', ...message.params.exceptionDetails });
      else if (message.method === 'Tracing.tracingComplete') this.traceComplete = message.params;
      else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push({ kind: 'console.error', args: message.params.args.map((arg) => arg.value ?? arg.description) });
      } else if (message.method === 'Inspector.targetCrashed') errors.push({ kind: 'target-crashed' });
    });
    socket.addEventListener('close', () => this.rejectAll(Error('Chrome CDP socket closed')));
    socket.addEventListener('error', () => this.rejectAll(Error('Chrome CDP socket error')));
  }
  rejectAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, sessionId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() { this.rejectAll(Error('Harness shutting down')); this.socket.close(); }
}

let server; let child; let profile; let cdp; let socket; let sessionId;
let spawnFailure; let browserExited = false; let tracing = false;
const browserErrors = []; const cleanupErrors = [];
let chromeStderr = '';
const report = {
  runLabel: 'real-headless-chrome-run', startedAt: new Date().toISOString(), options,
  machine: { hostname: hostname(), platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, node: process.version },
  browserErrors, cleanupErrors, screenshot: null,
};
const start = Date.now();
let interrupted;
const abort = new Promise((_, reject) => { interrupted = reject; });
const onSignal = (signal) => interrupted(Error(`Interrupted by ${signal}`));
const onInt = () => onSignal('SIGINT'); const onTerm = () => onSignal('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
// Final safety net includes cleanup. The ordinary deadline reserves 10s for finally.
const hardStop = setTimeout(() => {
  child?.kill('SIGKILL'); socket?.close(); server?.httpServer?.closeAllConnections?.();
  console.error('Benchmark hard deadline reached; Chrome killed and Node terminating.');
  process.exit(1);
}, options.timeoutMs);
const evaluate = async (expression) => {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
async function collectTrace() {
  if (!tracing) return;
  tracing = false;
  await cdp.send('Tracing.end');
  const deadline = Date.now() + 15000;
  while (!cdp.traceComplete && Date.now() < deadline) await sleep(25);
  if (!cdp.traceComplete) throw Error('Chrome trace completion timed out after 15000ms');
  const { stream, dataLossOccurred } = cdp.traceComplete;
  if (!stream) throw Error('Chrome did not return a trace stream');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await cdp.send('IO.read', { handle: stream, size: 1024 * 1024 });
      const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
      bytes += data.length;
      if (bytes > 64 * 1024 * 1024) throw Error('Chrome trace exceeded the 64 MiB harness output bound');
      chunks.push(data);
      if (chunk.eof) break;
    }
    await writeFile(path.join(output, 'chrome-trace.json'), Buffer.concat(chunks));
    report.trace = { path: path.relative(project, path.join(output, 'chrome-trace.json')), bytes,
      dataLossOccurred, scope: 'Warm gestures; starts when runner observes the warm stage (up to 150ms after its start), ends on observation of the next stage. Tracing adds overhead; compare timings with an untraced run.' };
    if (dataLossOccurred) throw Error('Chrome reported trace data loss');
  } finally { await cdp.send('IO.close', { handle: stream }); }
}
try {
  await Promise.race([abort, bounded((async () => {
    profile = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'apollo-waveform-'));
    server = await createServer({
      configFile: false, root: project, plugins: [react()], cacheDir: path.join(profile, 'vite-cache'),
      clearScreen: false, logLevel: 'warn',
      optimizeDeps: { entries: ['scripts/waveform-benchmark.html'] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, hmr: false },
    });
    // Vite 5's server.listen() treats port 0 as falsy and falls back to 5173.
    // Its HTTP server's listen wrapper still initializes plugins/optimization;
    // call that wrapper directly so the OS really chooses an ephemeral port.
    await bounded(new Promise((resolve, reject) => {
      server.httpServer.once('error', reject);
      server.httpServer.once('listening', resolve);
      server.httpServer.listen(0, '127.0.0.1');
    }), 15000, 'Vite ephemeral listen');
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw Error('Vite did not bind a TCP port');
    const url = `http://127.0.0.1:${address.port}/scripts/waveform-benchmark.html?waveformRenderer=modern`;
    report.url = url;
    console.log(`Starting ${options.fixture} at ${url}`);
    child = spawn(chromePath, [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, '--window-size=1440,1500', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.once('error', (error) => { spawnFailure = error; });
    child.once('exit', (code, signal) => { browserExited = true; report.chromeExit = { code, signal }; });
    child.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-16000); });
    const discoveryDeadline = Date.now() + 15000;
    let port; let browserPath;
    while (Date.now() < discoveryDeadline) {
      if (spawnFailure) throw spawnFailure;
      if (browserExited) throw Error(`Chrome exited during startup: ${chromeStderr}`);
      try {
        [port, browserPath] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && browserPath?.startsWith('/devtools/browser/')) break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await sleep(50);
    }
    if (!port || !browserPath) throw Error('Chrome DevToolsActivePort discovery timed out');
    socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
    cdp = new CDP(socket, browserErrors);
    await bounded(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(Error('Cannot connect to Chrome DevTools')), { once: true });
    }), 5000, 'CDP connect');
    report.browser = await cdp.send('Browser.getVersion');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Inspector.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 2, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    const pageDeadline = Date.now() + 20000;
    while (Date.now() < pageDeadline && !(await evaluate('Boolean(window.__waveformBenchmark)'))) {
      if (browserErrors.length) throw Error(`Page boot failed: ${JSON.stringify(browserErrors)}`);
      await sleep(100);
    }
    if (!(await evaluate('Boolean(window.__waveformBenchmark)'))) throw Error('Harness page did not initialize in 20s');
    await evaluate(`void window.__waveformBenchmark.run(${JSON.stringify({ fixture: options.fixture, coldTimeoutMs: 60000 })})`);
    let progress;
    while (true) {
      const state = await evaluate('({state: window.__waveformBenchmark.state, progress: window.__waveformBenchmark.progress})');
      if (state.progress !== progress) { progress = state.progress; console.log(progress); }
      if (options.trace && progress === 'warm scroll / slider / modifier-wheel' && !tracing && !report.trace) {
        await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing', transferMode: 'ReturnAsStream' });
        tracing = true;
      } else if (tracing && progress !== 'warm scroll / slider / modifier-wheel') await collectTrace();
      if (state.state === 'done' || state.state === 'failed') break;
      if (browserExited) throw Error('Chrome exited during benchmark');
      await sleep(150);
    }
    report.page = await evaluate('window.__waveformBenchmark.result');
    await collectTrace();
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sessionId);
    await writeFile(path.join(output, 'settled.png'), Buffer.from(image.data, 'base64'));
    report.screenshot = { path: path.relative(project, path.join(output, 'settled.png')), settled: report.page?.passed === true };
    report.passed = report.page?.passed === true && browserErrors.length === 0;
  })(), options.timeoutMs - 10000, 'Overall benchmark')]);
} catch (error) {
  report.passed = false; report.failure = String(error.stack || error);
  console.error(report.failure);
  if (cdp && sessionId) {
    try { report.page = await bounded(evaluate('window.__waveformBenchmark?.result'), 1000, 'partial results'); } catch { /* Browser may never have started. */ }
  }
} finally {
  if (tracing) {
    try { await bounded(collectTrace(), 3000, 'partial trace collection'); }
    catch (error) { cleanupErrors.push(error.message); }
  }
  if (cdp && sessionId) {
    try { await bounded(evaluate('window.__waveformBenchmark?.dispose()'), 1500, 'page disposal'); }
    catch (error) { cleanupErrors.push(String(error.message)); }
  }
  if (cdp) {
    try { await bounded(cdp.send('Browser.close', {}, undefined, 1000), 1000, 'Browser.close'); } catch { /* Closing can drop CDP before its response. */ }
    cdp.close();
  }
  if (child && !browserExited) {
    child.kill('SIGTERM');
    const deadline = Date.now() + 1000;
    while (!browserExited && Date.now() < deadline) await sleep(25);
    if (!browserExited) {
      child.kill('SIGKILL');
      const killDeadline = Date.now() + 1000;
      while (!browserExited && Date.now() < killDeadline) await sleep(25);
      if (!browserExited) cleanupErrors.push('Chrome did not confirm exit after SIGKILL');
    }
  }
  if (server) {
    server.httpServer?.closeAllConnections?.();
    try { await bounded(server.close(), 2000, 'Vite close'); } catch (error) { cleanupErrors.push(error.message); }
  }
  if (profile) {
    try { await bounded(rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }), 1500, 'temporary profile removal'); }
    catch (error) { cleanupErrors.push(error.message); }
  }
  report.chromeStderr = chromeStderr;
  report.elapsedMs = Date.now() - start; report.finishedAt = new Date().toISOString();
  report.passed = report.passed === true && cleanupErrors.length === 0;
  try { await bounded(writeFile(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`), 1000, 'write results'); }
  finally { clearTimeout(hardStop); process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}
console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${path.relative(project, path.join(output, 'results.json'))}`);
process.exitCode = report.passed ? 0 : 1;
