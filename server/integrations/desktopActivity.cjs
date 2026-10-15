const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { hash, error } = require('./common.cjs');

/** Optional Windows foreground-app sampler. No window titles, URLs or keystrokes are read. */
function createDesktopActivity(store, { spawnImpl = spawn, platform = process.platform, clock = () => new Date().toISOString(), monotonic = () => performance.now() } = {}) {
  let child = null, ready = false, startPromise = null, generation = 0, last = null, segment = null, lastCapturedAt = null, lastError = null, timer = null, cancelStart = null, samples = 0, sampleState = 'waiting';
  function flush() {
    if (!segment || segment.end <= segment.start) { segment = null; return; }
    const startsAt = new Date(segment.start).toISOString(), endsAt = new Date(segment.end).toISOString();
    const record = { id: `desktop:${hash([startsAt, endsAt, segment.app]).slice(0, 40)}`, bucketId: 'desktop-local', kind: 'app', label: segment.app, startsAt, endsAt,
      excerpt: `Sampled foreground app ${segment.app} while not idle from ${startsAt} to ${endsAt}. Sampling is approximate and does not prove productive work or completion.` };
    store.replaceActivity([record], { ...store.integrationState('activity'), consent: true, collector: 'desktop-local' }, { from: startsAt, to: endsAt }, clock());
    lastCapturedAt = endsAt; segment = null;
  }
  function sample(value) {
    const now = Date.parse(clock()), tick = monotonic();
    const app = typeof value.app === 'string' && /^[\p{L}\p{N}_. -]{1,100}$/u.test(value.app) ? value.app : null;
    samples++; sampleState = !app ? 'no_foreground_app' : value.idleSeconds >= 60 ? 'idle' : 'active';
    if (!app || !Number.isFinite(value.idleSeconds) || value.idleSeconds < 0 || value.idleSeconds >= 60 || !Number.isFinite(now)) { flush(); last = null; return; }
    if (last && last.app === app && tick - last.tick >= 0 && tick - last.tick <= 15000 && now > last.at && now - last.at <= 15000) {
      if (!segment) segment = { app, start: last.at, end: now };
      else segment.end = now;
      if (segment.end - segment.start >= 60000) flush();
    } else flush();
    last = { app, at: now, tick };
  }
  function stop() {
    cancelStart?.(); cancelStart = null;
    generation++; clearTimeout(timer); timer = null;
    const current = child; child = null; ready = false;
    try { flush(); } catch { lastError = 'Activity storage unavailable; tracking stopped.'; }
    last = null; current?.kill();
  }
  return {
    status: () => ({ available: platform === 'win32', running: ready, starting: Boolean(startPromise), lastCapturedAt, lastError, samples, sampleState,
      fields: ['foreground_app_name', 'idle_seconds'], retentionDays: 30, separateDownloadRequired: false }),
    stop, close: stop,
    async start(input) {
      if (input.consent !== true) throw error('Desktop activity tracking requires explicit consent');
      if (platform !== 'win32') throw error('Built-in desktop activity is currently available on Windows. Use ActivityWatch on this platform.', 409);
      if (ready) return { enabled: true };
      if (startPromise) throw error('Desktop activity is already starting', 409);
      lastError = null;
      const current = ++generation;
      startPromise = new Promise((resolve, reject) => {
        let settled = false, buffer = '';
        cancelStart = () => { if (!settled) { settled = true; reject(error('Desktop activity start cancelled', 409)); } };
        function fail() {
          if (current !== generation || settled) return;
          settled = true; lastError = 'Windows activity helper could not start. Check local PowerShell policy.'; stop(); reject(error(lastError, 409));
        }
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const helper = path.join(__dirname, 'windows-activity.ps1').replace(/\.asar([\\/])/, '.asar.unpacked$1');
        try { child = spawnImpl(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', helper],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { fail(); return; }
        timer = setTimeout(fail, 10000); timer.unref();
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          if (current !== generation) return;
          buffer += chunk;
          if (Buffer.byteLength(buffer) > 8192) { fail(); stop(); return; }
          let boundary;
          while ((boundary = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, boundary).trim(); buffer = buffer.slice(boundary + 1);
            if (!line) continue;
            let value; try { value = JSON.parse(line); } catch { fail(); stop(); return; }
            if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(); stop(); return; }
            if (value.ready === true && !settled) { settled = true; ready = true; cancelStart = null; clearTimeout(timer); resolve({ enabled: true }); }
            else if (ready) { try { sample(value); } catch { lastError = 'Activity storage unavailable; tracking stopped.'; stop(); } }
          }
        });
        child.stderr.on('data', () => { /* Never retain PowerShell exception text. */ });
        child.once('error', fail);
        child.once('close', () => { if (current !== generation) return; if (!settled) fail(); else { lastError = 'Desktop activity helper stopped.'; stop(); } });
      });
      try { return await startPromise; } finally { startPromise = null; }
    }
  };
}
module.exports = { createDesktopActivity };
