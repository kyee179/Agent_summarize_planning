const crypto = require('node:crypto');
const net = require('node:net');
const { isInstant } = require('../contracts/validate.cjs');
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function range(input, maxDays = 31) {
  if (!isInstant(input.from) || !isInstant(input.to) || Date.parse(input.to) <= Date.parse(input.from) ||
      Date.parse(input.to) - Date.parse(input.from) > maxDays * 86400000) throw error(`Choose a valid range of at most ${maxDays} days`);
  return { from: new Date(input.from).toISOString(), to: new Date(input.to).toISOString() };
}
function query(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 400) throw error('Enter a query of 1–400 characters');
  return value.trim();
}
function publicUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
        net.isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /^\d+\./.test(host) ||
        /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}
// Bound both the response stream and elapsed time, including transports that ignore abort.
async function json(url, options = {}, { fetchImpl = fetch, timeout = 10000, maxBytes = 2097152, signal, allowEmpty = false } = {}) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer;
  try {
    return await Promise.race([ (async () => {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: combined });
      if (!response.ok) throw error(`Integration request failed (HTTP ${response.status}); check setup or reconnect`, 502);
      if (Number(response.headers?.get('content-length')) > maxBytes) throw error('Integration response is too large', 502);
      const reader = response.body?.getReader();
      if (!reader) { if (allowEmpty) return {}; throw error('Integration returned no response stream', 502); }
      const parts = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { controller.abort(); throw error('Integration response is too large', 502); }
          parts.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      try { const text = Buffer.concat(parts).toString('utf8'); return allowEmpty && !text ? {} : JSON.parse(text); }
      catch { throw error('Integration returned invalid JSON', 502); }
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(error('Integration request timed out', 504)); }, timeout); }) ]);
  } catch (cause) {
    if (cause.status) throw cause;
    throw error('Integration unavailable; check local service or credentials', 502);
  } finally { clearTimeout(timer); }
}
module.exports = { error, hash, range, query, publicUrl, json };
