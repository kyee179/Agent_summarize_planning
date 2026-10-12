const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTelemetry, safeObserve } = require('../server/observability.cjs');
const { createStore } = require('../server/store.cjs');
const { createApp } = require('../server/index.cjs');
const { runWorkflow, LIMITS } = require('../server/agent/runtime.cjs');
const { createProvider } = require('../server/agent/providers.cjs');
const { loadSkills } = require('../server/agent/skills.cjs');
const { collectJournalEvidence } = require('../server/contracts/analysis.cjs');
const { isAllowedRequest } = require('../electron/apiBridge.cjs');

test('telemetry copies allowlisted fields only; rotates and expires bounded files and samples', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-telemetry-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.now(); const telemetry = createTelemetry({ directory, clock: () => now, maxBytes: 700, maxRecords: 8 });
  for (let i = 0; i < 30; i++) telemetry.emit({ kind: 'analysis', traceId: crypto.randomUUID(), outcome: 'fallback', reason: 'timeout', durationMs: 60000,
    text: 'PRIVATE JOURNAL', query: 'PRIVATE QUERY', credential: 'PRIVATE KEY', model: 'PRIVATE MODEL', route: '/api/journals/PRIVATE-ID/analyze', error: new Error('PRIVATE ERROR') });
  const result = telemetry.snapshot(); assert.equal(result.recent.length, 8); assert.ok(result.alerts.includes('high_fallback_rate')); assert.ok(result.alerts.includes('slow_analysis'));
  assert.ok(fs.readdirSync(directory).length <= 4);
  for (const file of fs.readdirSync(directory)) { const value = fs.readFileSync(path.join(directory, file), 'utf8'); assert.ok(!value.includes('PRIVATE')); assert.ok(Buffer.byteLength(value) <= 700); }
  now += 8 * 86400000; assert.equal(telemetry.snapshot().window.analysisSamples, 0); assert.deepEqual(fs.readdirSync(directory), []);
});
test('observer and trace-storage failures cannot interrupt workflow; provider failures emit timed spans', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-observer-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const blocked = path.join(directory, 'file'); fs.writeFileSync(blocked, 'x');
  const telemetry = createTelemetry({ directory: blocked });
  telemetry.emit({ kind: 'analysis', traceId: crypto.randomUUID(), outcome: 'local' }); assert.equal(telemetry.snapshot().writeError, true);
  assert.doesNotThrow(() => safeObserve(() => { throw new Error('observer'); }, {}));
  const journal = { id: 'synthetic', type: 'daily', journalDate: '2030-01-07', content: 'I need to test the project.' };
  const spans = [];
  const result = await runWorkflow({ journal, trustedEvidence: collectJournalEvidence({ journal }), provider: 'glm', model: 'glm-4-flash',
    expectedPlan: { timezone: 'UTC', targetDate: journal.journalDate, availability: [], bufferMinutes: 15 }, observe: (event) => spans.push(event) },
  { encode: () => ({ body: {} }), complete: async () => { throw new Error('PRIVATE TRANSPORT ERROR'); } }, loadSkills());
  assert.equal(result.metadata.stopReason, 'provider_error'); assert.equal(spans.length, 1); assert.equal(spans[0].status, 'error'); assert.ok(spans[0].durationMs >= 0);
  assert.ok(!JSON.stringify(spans).includes('PRIVATE'));
});
test('diagnostics remains authenticated, request IDs ignore caller input, and traces use route templates', async (t) => {
  const store = createStore(':memory:'), telemetry = createTelemetry();
  const token = 'a'.repeat(64); const app = createApp({ store, telemetry, apiToken: token });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(async () => { await new Promise((r) => server.close(r)); app.locals.closeIntegrations(); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/api/diagnostics')).status, 401);
  const bad = await fetch(url + '/api/journals/private-id/analysis?secret=PRIVATE', { headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': 'PRIVATE' } });
  assert.equal(bad.status, 404); assert.notEqual(bad.headers.get('X-Request-ID'), 'PRIVATE');
  const response = await fetch(url + '/api/diagnostics', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.ready, true); assert.equal(result.database.schemaVersion, 2); assert.equal(result.promptVersion, '1.1.0');
  assert.ok(!JSON.stringify(result).includes('private-id')); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(result.telemetry.recent.some((event) => event.route === '/api/journals/:id/analysis'));
  assert.equal(isAllowedRequest('/api/diagnostics', 'GET'), true); assert.equal(isAllowedRequest('/api/diagnostics', 'POST'), false);
  const previousHealth = store.health; store.health = () => { throw new Error('PRIVATE DB FAILURE'); };
  const unavailable = await fetch(url + '/api/diagnostics', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).ready, false); store.health = previousHealth;
});
test('provider-reported usage and successful tool spans are redacted and share the request parent', async () => {
  const traceId = crypto.randomUUID(), parentSpanId = crypto.randomUUID(), telemetry = createTelemetry();
  const journal = { id: 'synthetic', type: 'daily', journalDate: '2030-01-07', content: 'PRIVATE JOURNAL' };
  const provider = createProvider({ provider: 'glm', model: 'glm-4-flash', apiKey: 'PRIVATE KEY', baseUrl: 'https://example.test' }, async () => new Response(JSON.stringify({
    usage: { prompt_tokens: 20, completion_tokens: 3 }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'wire:1', type: 'function', function: { name: 'read_evidence', arguments: '{"offset":0,"limit":20}' } }] } }]
  })));
  const result = await runWorkflow({ journal, trustedEvidence: collectJournalEvidence({ journal }), provider: 'glm', model: 'glm-4-flash',
    expectedPlan: { timezone: 'UTC', targetDate: journal.journalDate, availability: [], bufferMinutes: 15 },
    observe: (event) => telemetry.emit({ ...event, traceId, parentSpanId }) }, provider, loadSkills(), { limits: { ...LIMITS, maxTurns: 1 } });
  assert.equal(result.metadata.stopReason, 'turn_limit');
  const snapshot = telemetry.snapshot(); assert.equal(snapshot.totals.inputTokens, 20); assert.equal(snapshot.totals.outputTokens, 3); assert.equal(snapshot.totals.usageReports, 1);
  assert.equal(snapshot.recent.length, 2); assert.ok(snapshot.recent.every((span) => span.parentSpanId === parentSpanId && span.traceId === traceId && span.status === 'ok'));
  assert.equal(snapshot.recent[1].tool, 'read_evidence'); assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});
