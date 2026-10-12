const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const TOOLS = new Set(['read_evidence', 'get_planning_context', 'preview_plan', 'finish_analysis', 'search_personal_memory', 'research_web', 'unknown']);
const REASONS = new Set(['finished', 'local_provider', 'missing_credentials', 'unsupported_provider', 'validation', 'provider_error', 'timeout', 'turn_limit', 'tool_limit', 'error_limit', 'size_limit']);
const uuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
const number = (v, max = 1e9) => Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : undefined;

// Copy an explicit allowlist. Never serialize caller objects, errors, URLs, queries, or bodies.
function sanitize(event, clock) {
  if (!['request', 'provider', 'tool', 'analysis'].includes(event?.kind) || !uuid(event.traceId)) return null;
  const result = { version: 1, at: new Date(clock()).toISOString(), kind: event.kind, traceId: event.traceId, spanId: uuid(event.spanId) ? event.spanId : crypto.randomUUID() };
  if (event.kind !== 'request' && uuid(event.parentSpanId)) result.parentSpanId = event.parentSpanId;
  for (const key of ['durationMs', 'turn', 'toolCalls', 'toolErrors', 'requestBytes', 'inputTokens', 'outputTokens']) {
    const value = number(event[key]); if (value !== undefined) result[key] = value;
  }
  if (['ok', 'error', 'aborted'].includes(event.status)) result.status = event.status;
  if (['completed', 'local', 'fallback'].includes(event.outcome)) result.outcome = event.outcome;
  if (REASONS.has(event.reason)) result.reason = event.reason;
  if (TOOLS.has(event.tool)) result.tool = event.tool;
  if (['glm', 'openai', 'groq', 'gemini', 'local'].includes(event.provider)) result.provider = event.provider;
  if (typeof event.promptHash === 'string' && /^[a-f0-9]{64}$/.test(event.promptHash)) result.promptHash = event.promptHash;
  if (typeof event.promptVersion === 'string' && /^\d+\.\d+\.\d+$/.test(event.promptVersion)) result.promptVersion = event.promptVersion;
  if (['GET', 'POST', 'PUT', 'DELETE'].includes(event.method)) result.method = event.method;
  if (Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599) result.httpStatus = event.httpStatus;
  // These are Express route templates, never actual request paths or IDs.
  if (typeof event.route === 'string' && /^(\/health|\/api\/[a-z/-]+(?::id[a-z/-]*)?|unmatched)$/.test(event.route) && event.route.length <= 90) result.route = event.route;
  return result;
}

function createTelemetry({ directory = null, clock = Date.now, maxBytes = 262144, maxRecords = 512, windowMs = 600000, retentionMs = 7 * 86400000 } = {}) {
  let records = [], writeError = false;
  const totals = { requests: 0, analyses: 0, completed: 0, local: 0, fallback: 0, errors: 0, providerResponses: 0, usageReports: 0, inputTokens: 0, outputTokens: 0 };
  const files = directory ? [0, 1, 2, 3].map((i) => path.join(directory, `trace-${i}.jsonl`)) : [];
  function expire() {
    records = records.filter((item) => Date.parse(item.at) > clock() - windowMs).slice(-maxRecords);
    for (const file of files) if (fs.existsSync(file) && fs.statSync(file).mtimeMs <= clock() - retentionMs) fs.unlinkSync(file);
  }
  function emit(event) {
    try {
      const item = sanitize(event, clock); if (!item) return;
      records.push(item); expire();
      if (item.kind === 'request') { totals.requests++; if (item.httpStatus >= 500 || item.status === 'aborted') totals.errors++; }
      if (item.kind === 'analysis' && item.outcome) { totals.analyses++; totals[item.outcome]++; }
      if (item.kind === 'provider') {
        totals.providerResponses++;
        if (item.inputTokens !== undefined && item.outputTokens !== undefined) {
          totals.usageReports++; totals.inputTokens += item.inputTokens; totals.outputTokens += item.outputTokens;
        }
      }
      if (!directory) return;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const line = JSON.stringify(item) + '\n';
      if (fs.existsSync(files[0]) && fs.statSync(files[0]).size + Buffer.byteLength(line) > maxBytes) {
        if (fs.existsSync(files[3])) fs.unlinkSync(files[3]);
        for (let i = 2; i >= 0; i--) if (fs.existsSync(files[i])) fs.renameSync(files[i], files[i + 1]);
      }
      fs.appendFileSync(files[0], line, { mode: 0o600 }); writeError = false;
    } catch { writeError = true; } // Observability failure must not lose a journal or interrupt Apply.
  }
  function snapshot() {
    try { expire(); } catch { writeError = true; }
    const analyses = records.filter((item) => item.kind === 'analysis');
    const requests = records.filter((item) => item.kind === 'request' && item.route !== '/api/diagnostics' && item.route !== '/health');
    const samples = analyses.map((item) => item.durationMs || 0).sort((a, b) => a - b);
    const fallbackRate = analyses.length ? analyses.filter((item) => item.outcome === 'fallback').length / analyses.length : null;
    const errorRate = requests.length ? requests.filter((item) => item.httpStatus >= 500 || item.status === 'aborted').length / requests.length : null;
    const p95Ms = samples.length ? samples[Math.ceil(samples.length * 0.95) - 1] : null;
    const alerts = [];
    if (writeError) alerts.push('trace_storage_unavailable');
    if (analyses.length >= 5 && fallbackRate >= 0.2) alerts.push('high_fallback_rate');
    if (analyses.length >= 5 && p95Ms >= 30000) alerts.push('slow_analysis');
    if (requests.length >= 10 && errorRate >= 0.1) alerts.push('high_api_error_rate');
    return { version: 1, scope: 'current_process', windowMinutes: windowMs / 60000, sampleLimit: maxRecords, totals: { ...totals },
      window: { analysisSamples: analyses.length, requestSamples: requests.length, fallbackRate, errorRate, p95Ms }, alerts,
      persistence: directory ? 'local_rotating_files' : 'memory_only', writeError, recent: records.slice(-20) };
  }
  function middleware(req, res, next) {
    req.traceId = crypto.randomUUID(); req.rootSpanId = crypto.randomUUID();
    req.observe = (event) => emit({ ...event, traceId: req.traceId, parentSpanId: req.rootSpanId });
    res.setHeader('X-Request-ID', req.traceId);
    const start = performance.now(); let recorded = false;
    const finish = () => {
      if (recorded) return; recorded = true;
      req.observe({ kind: 'request', spanId: req.rootSpanId, method: req.method, route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
        durationMs: performance.now() - start, httpStatus: res.writableFinished ? res.statusCode : 499, status: res.writableFinished ? (res.statusCode >= 400 ? 'error' : 'ok') : 'aborted' });
    };
    res.once('finish', finish); res.once('close', finish); next();
  }
  return { emit, snapshot, middleware };
}

function safeObserve(observer, event) { try { observer?.(event); } catch { /* Observer is not part of workflow correctness. */ } }
module.exports = { createTelemetry, safeObserve, sanitize };
