const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../server/store.cjs');
const { createApp } = require('../server/index.cjs');
const { createActivity, normalize } = require('../server/integrations/activity.cjs');
const { createMemory, cosine, fuse } = require('../server/integrations/memory.cjs');
const { createGoogle, vault, SCOPES, eventTimes } = require('../server/integrations/google.cjs');
const { createResearch } = require('../server/integrations/research.cjs');
const { createIntegrations } = require('../server/integrations/service.cjs');
const { json, publicUrl, hash } = require('../server/integrations/common.cjs');
const { collectJournalEvidence, assertAnalysis } = require('../server/contracts/analysis.cjs');
const { localRuleBasedAnalysis } = require('../server/journalAnalyzer.cjs');
const { createToolSession, permittedTools } = require('../server/agent/tools.cjs');
const { runWorkflow, LIMITS } = require('../server/agent/runtime.cjs');
const { loadSkills } = require('../server/agent/skills.cjs');
const { isAllowedRequest } = require('../electron/apiBridge.cjs');
const { scheduleAnalysis, assertScheduleCurrent, planningRange } = require('../server/scheduler.cjs');
const now = '2026-10-12T12:00:00Z', clock = () => now;
const selectedRange = { from: '2026-10-12T09:00:00Z', to: '2026-10-12T10:00:00Z' };
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function storeFixture(t) { const store = createStore(':memory:'); t.after(() => store.close()); return store; }
const buckets = [{ id: 'window', type: 'currentwindow' }, { id: 'browser', type: 'web.tab.current' }, { id: 'afk', type: 'afkstatus' }];
const streams = {
  window: [{ timestamp: selectedRange.from, duration: 3600, data: { app: 'Chrome', title: 'SECRET WINDOW TITLE' } }],
  browser: [{ timestamp: selectedRange.from, duration: 1800, data: { url: 'https://example.com/private/path?token=SECRET#secret', title: 'SECRET PAGE' } }],
  afk: [{ timestamp: selectedRange.from, duration: 1200, data: { status: 'not-afk' } }]
};
test('SQLite v1 migrates atomically to v2, preserves records, and rejects future versions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-migration-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.sqlite'); let store = createStore(file);
  store.createJournal({ id: 'kept', content: 'Synthetic note' }); store.close();
  let db = new DatabaseSync(file);
  db.exec('DROP TABLE memory_fts; DROP TABLE memory_chunks; DROP TABLE memory_documents; DROP TABLE integration_state; DROP TABLE activity; DROP TABLE google_busy; PRAGMA user_version=1;'); db.close();
  store = createStore(file); assert.equal(store.getJournal('kept').content, 'Synthetic note'); assert.deepEqual(store.memoryChunks(), []); store.close();
  db = new DatabaseSync(file); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2); db.exec('PRAGMA user_version=3'); db.close();
  assert.throws(() => createStore(file), /newer app/);
});
test('a failed v1 migration rolls back its version and every newly created table', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-rollback-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.sqlite'), original = createStore(file); original.close();
  const db = new DatabaseSync(file);
  db.exec('DROP TABLE memory_fts; DROP TABLE memory_chunks; DROP TABLE memory_documents; DROP TABLE integration_state; DROP TABLE activity; DROP TABLE google_busy; PRAGMA user_version=1; CREATE TABLE memory_documents(id TEXT PRIMARY KEY);'); db.close();
  assert.throws(() => createStore(file), /already exists/);
  const restored = new DatabaseSync(file); assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='integration_state'").get().n, 0); restored.close();
});
test('activity normalization excludes AFK, redacts titles/paths, and counts overlaps once', () => {
  const records = normalize(buckets, streams, selectedRange);
  assert.equal(records.length, 1); assert.equal(records[0].label, 'example.com');
  assert.equal(Date.parse(records[0].endsAt) - Date.parse(records[0].startsAt), 1200000);
  assert.ok(!JSON.stringify(records).includes('SECRET')); assert.ok(!JSON.stringify(records).includes('/private'));
  assert.match(records[0].excerpt, /does not prove/);
});
test('activity requires bucket/domain consent and rejects truncated import without replacing data', async (t) => {
  const store = storeFixture(t); let huge = false;
  const activity = createActivity(store, { clock, fetchImpl: async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/buckets/')) return respond(Object.fromEntries(buckets.map((b) => [b.id, b])));
    return respond(huge ? Array(2001).fill(streams.window[0]) : streams[u.pathname.split('/').at(-2)]);
  } });
  const input = { ...selectedRange, bucketIds: buckets.map((b) => b.id), includeDomains: true, consent: true };
  await assert.rejects(activity.ingest({ ...input, consent: false }), /consent/);
  await assert.rejects(activity.ingest({ ...input, includeDomains: false }), /separate consent/);
  assert.equal((await activity.ingest(input)).imported, 1);
  assert.equal((await activity.ingest(input)).imported, 1); assert.equal(store.listActivity(selectedRange).length, 1);
  huge = true; await assert.rejects(activity.ingest(input), /limit/); assert.equal(store.listActivity(selectedRange).length, 1);
  const evidence = activity.evidence(selectedRange); assert.deepEqual(evidence[0].facts, []);
  store.assertSupplementalEvidence({ evidence }); store.purgeActivity();
  assert.throws(() => store.assertSupplementalEvidence({ evidence }), /changed/);
});
test('activity retention expires persisted observations and consent stays explicit', (t) => {
  const store = storeFixture(t); const records = normalize(buckets, streams, selectedRange);
  store.replaceActivity(records, { consent: true }, selectedRange, now);
  store.expireActivity('2026-11-13T00:00:00Z'); assert.deepEqual(store.listActivity(selectedRange), []);
  store.purgeActivity(); assert.equal(store.integrationState('activity').consent, false);
});
test('removing activity while ingestion runs prevents re-creation after a late response', async (t) => {
  const store = storeFixture(t); let release, entered;
  const started = new Promise((r) => { entered = r; });
  const activity = createActivity(store, { clock, fetchImpl: async (url) => {
    if (url.endsWith('/buckets/')) { entered(); return new Promise((resolve) => { release = () => resolve(respond(Object.fromEntries(buckets.map((b) => [b.id, b])))); }); }
    return respond(streams[new URL(url).pathname.split('/').at(-2)]);
  } });
  const pending = activity.ingest({ ...selectedRange, bucketIds: buckets.map((b) => b.id), includeDomains: true, consent: true });
  await started; activity.purge(); release(); await assert.rejects(pending, /cancelled/);
  assert.equal(store.listActivity(selectedRange).length, 0); assert.equal(store.integrationState('activity').consent, false);
});
test('hybrid memory retrieves paraphrases with local embeddings and exposes lexical degradation', async (t) => {
  const store = storeFixture(t);
  store.putMemoryDocument({ id: 'memory:a', title: 'Rest', content: 'Go to bed earlier for good sleep', updatedAt: now });
  store.putMemoryDocument({ id: 'memory:b', title: 'Project', content: 'Finish the software release', updatedAt: now });
  let unavailable = false, digest = 'a';
  const memory = createMemory(store, { clock, env: {}, fetchImpl: async (url, options) => {
    if (unavailable) throw new Error('offline');
    if (url.endsWith('/api/tags')) return respond({ models: [{ name: 'nomic-embed-text:latest', digest: digest.repeat(64) }] });
    assert.equal(url, 'http://127.0.0.1:11434/api/embed');
    const input = JSON.parse(options.body).input;
    assert.ok(input.every((text) => /^search_(document|query): /.test(text)));
    return respond({ embeddings: input.map((text) => /bed|rest/i.test(text) ? [1, 0] : [0, 1]) });
  } });
  assert.equal((await memory.index({ consent: true, semantic: true })).mode, 'hybrid');
  const results = await memory.search({ query: 'rest better' });
  assert.equal(results.mode, 'hybrid'); assert.equal(results.items[0].sourceId, 'memory:a');
  assert.ok(!('embedding' in results.items[0])); assert.deepEqual(results.evidence[0].facts, []);
  digest = 'b'; const changed = await memory.search({ query: 'software' }); assert.equal(changed.mode, 'lexical'); assert.match(changed.warning, /model changed/);
  unavailable = true; const degraded = await memory.search({ query: 'software' });
  assert.equal(degraded.mode, 'lexical'); assert.match(degraded.warning, /unavailable/); assert.equal(degraded.items[0].sourceId, 'memory:b');
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1], [1, 0]), -1);
  assert.equal(fuse([{ id: 'b' }, { id: 'a' }], [{ id: 'a' }], 2)[0].id, 'a');
});
test('journal edits/deletes exclude stale memory; document edits fail source revalidation', async (t) => {
  const store = storeFixture(t);
  store.createJournal({ id: 'j', title: 'J', type: 'daily', journalDate: '2026-10-12', content: 'Project baseline', updatedAt: now });
  const memory = createMemory(store, { env: {}, clock });
  await memory.index({ consent: true, semantic: false });
  assert.equal((await memory.search({ query: 'baseline' })).items.length, 1);
  store.updateJournal('j', { content: 'Project changed' }); assert.equal((await memory.search({ query: 'baseline' })).items.length, 0);
  store.deleteJournal('j'); assert.equal(store.memoryChunks().length, 0);
  const note = store.putMemoryDocument({ id: 'memory:x', title: 'Scope', content: 'Ship the release', updatedAt: now });
  const evidence = (await memory.search({ query: 'release' })).evidence;
  store.assertSupplementalEvidence({ evidence }); store.putMemoryDocument({ ...note, content: 'Different scope' });
  assert.throws(() => store.assertSupplementalEvidence({ evidence }), /changed/);
  assert.doesNotThrow(() => store.lexicalMemory('" OR * injection')); // Terms are escaped rather than interpolated into SQL/FTS syntax.
});
test('missing or malformed embeddings keep keyword memory usable', async (t) => {
  const store = storeFixture(t); store.putMemoryDocument({ id: 'memory:n', title: 'T', content: 'Keyword', updatedAt: now });
  const memory = createMemory(store, { env: {}, fetchImpl: async (url) => url.endsWith('/api/tags') ? respond({ models: [{ name: 'nomic-embed-text:latest', digest: 'a'.repeat(64) }] }) : respond({ embeddings: [[0, 0]] }) });
  const report = await memory.index({ consent: true, semantic: true });
  assert.equal(report.mode, 'lexical'); assert.equal(report.embedded, 0); assert.equal((await memory.search({ query: 'Keyword' })).items.length, 1);
});
test('Google vault encrypts tokens, authenticates ciphertext, and rejects missing keys', () => {
  const env = { INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') }, secret = { access_token: 'SYNTHETIC_TOKEN' };
  const encrypted = vault(env).seal(secret); assert.ok(!JSON.stringify(encrypted).includes(secret.access_token)); assert.deepEqual(vault(env).open(encrypted), secret);
  assert.throws(() => vault(env).open({ ...encrypted, data: Buffer.from('tampered').toString('base64') }), /decrypt/);
  assert.throws(() => vault({}), /encryption key/);
});
function googleFixture(t, fetchImpl) {
  const store = storeFixture(t), env = { GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-secret', INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') };
  const google = createGoogle(store, { env, fetchImpl, clock }); t.after(() => google.close());
  return { store, env, google };
}
test('Google loopback OAuth validates state, uses PKCE, encrypts tokens and rejects replay', async (t) => {
  let verifier;
  const { google, store } = googleFixture(t, async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); verifier = new URLSearchParams(options.body).get('code_verifier');
    return respond({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: SCOPES.join(' ') });
  });
  await assert.rejects(google.connect({}), /consent/);
  const connection = await google.connect({ consent: true }), auth = new URL(connection.authorizationUrl);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256'); assert.ok(!auth.href.includes('synthetic-secret'));
  const callback = new URL(auth.searchParams.get('redirect_uri')); callback.searchParams.set('state', 'wrong'); callback.searchParams.set('code', 'synthetic-code');
  assert.equal((await fetch(callback)).status, 400); assert.equal(google.status().pending, true);
  callback.searchParams.set('state', auth.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200); assert.equal(google.status().connected, true);
  assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.ok(!JSON.stringify(store.integrationState('googleTokens')).includes('synthetic-access'));
  assert.ok(!JSON.stringify(google.status()).includes('synthetic-refresh'));
  assert.throws(() => store.assertCalendarCoverage(selectedRange, now), /Select calendars/);
  await assert.rejects(fetch(callback));
});
test('Google OAuth remains pending during token exchange, blocks parallel connect/sync and consumes state only once', async (t) => {
  let release, entered, calls = 0; const started = new Promise((r) => { entered = r; });
  const { google, store } = googleFixture(t, async () => { calls++; entered(); return new Promise((r) => { release = () => r(respond({ access_token: 'synthetic', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: SCOPES.join(' ') })); }); });
  const connection = await google.connect({ consent: true }), auth = new URL(connection.authorizationUrl);
  const callback = new URL(auth.searchParams.get('redirect_uri')); callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'synthetic');
  const request = fetch(callback); await started;
  assert.equal(google.status().pending, true); assert.equal(google.status().lastOAuth, 'exchanging'); assert.equal(google.status().connected, false);
  await assert.rejects(google.connect({ consent: true }), /Wait/);
  await assert.rejects(google.sync({ consent: true }), /Wait/);
  assert.equal((await fetch(callback)).status, 400); assert.equal(calls, 1);
  release(); assert.equal((await request).status, 200);
  assert.equal(google.status().pending, false); assert.equal(google.status().lastOAuth, 'connected'); assert.equal(google.status().connected, true);
  assert.ok(store.integrationState('googleTokens'));
});

test('cancelled OAuth cannot persist a late token exchange', async (t) => {
  let release, entered; const started = new Promise((r) => { entered = r; });
  const { google, store } = googleFixture(t, async () => { entered(); return new Promise((r) => { release = () => r(respond({ access_token: 'synthetic', expires_in: 3600, scope: SCOPES.join(' ') })); }); });
  const connection = await google.connect({ consent: true }), auth = new URL(connection.authorizationUrl);
  const callback = new URL(auth.searchParams.get('redirect_uri')); callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'synthetic');
  const request = fetch(callback); await started;
  assert.equal(google.status().pending, true); google.cancel(); assert.equal(google.status().pending, false);
  await google.connect({ consent: true }); release();
  assert.equal((await request).status, 400); assert.equal(store.integrationState('googleTokens'), null);
  assert.equal(google.status().pending, true); assert.equal(google.status().lastOAuth, 'waiting');
});
test('Google expands recurring instances, respects all-day zones/transparency, and preserves complete cache on failed pagination', async (t) => {
  let fail = false;
  const { google, env, store } = googleFixture(t, async (url, options) => {
    const u = new URL(url); assert.ok(options.headers.Authorization.startsWith('Bearer '));
    if (u.pathname.endsWith('calendarList')) return respond({ items: [{ id: 'selected', summary: 'Synthetic calendar', timeZone: 'Asia/Shanghai' }] });
    assert.equal(u.searchParams.get('singleEvents'), 'true');
    if (fail) return respond({ items: [], nextPageToken: 'repeated' });
    return respond({ items: [
      { id: 'all-day', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
      { id: 'instance', start: { dateTime: '2026-10-12T10:00:00+08:00' }, end: { dateTime: '2026-10-12T11:00:00+08:00' } },
      { id: 'free', transparency: 'transparent' }, { id: 'deleted', status: 'cancelled' }
    ] });
  });
  store.setIntegrationState('googleTokens', vault(env).seal({ access_token: 'synthetic', expiresAt: Date.parse(now) + 3600000 }));
  const input = { consent: true, calendarIds: ['selected'], from: '2026-10-11T16:00:00Z', to: '2026-10-12T16:00:00Z' };
  assert.equal((await google.sync(input)).imported, 2); const before = store.googleBusy(input);
  assert.equal(Date.parse(before.find((e) => e.id.includes(hash(['selected', 'all-day']).slice(0, 40))).startsAt), Date.parse(input.from));
  assert.equal(store.listPlanningEvents(input).filter((e) => e.source === 'google').length, 2); assert.equal(store.listEvents().some((e) => e.source === 'google'), false);
  store.assertCalendarCoverage(input, now); assert.throws(() => store.assertCalendarCoverage(input, '2026-10-12T13:00:00Z'), /Sync/);
  assert.throws(() => store.assertCalendarCoverage({ ...input, to: '2026-10-14T00:00:00Z' }, now), /Sync/);
  fail = true; await assert.rejects(google.sync(input), /pagination/); assert.deepEqual(store.googleBusy(input), before);
  assert.deepEqual(eventTimes({ start: { date: '2026-03-08' }, end: { date: '2026-03-09' } }, 'America/New_York'), ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
});
test('Google refresh keeps refresh token and disconnect deletes local tokens even if remote revoke fails', async (t) => {
  const { google, env, store } = googleFixture(t, async (url, options) => {
    if (url.includes('revoke')) throw new Error('offline');
    if (url.includes('/token')) { assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'synthetic-refresh'); return respond({ access_token: 'new-access', expires_in: 3600, scope: SCOPES.join(' ') }); }
    assert.equal(options.headers.Authorization, 'Bearer new-access'); return respond({ items: [] });
  });
  store.setIntegrationState('googleTokens', vault(env).seal({ access_token: 'old-access', refresh_token: 'synthetic-refresh', scope: SCOPES.join(' '), expiresAt: 0 }));
  await google.calendars(); assert.equal(vault(env).open(store.integrationState('googleTokens')).refresh_token, 'synthetic-refresh');
  const report = await google.disconnect(); assert.equal(report.revoked, false); assert.equal(store.integrationState('googleTokens'), null); assert.equal(google.status().connected, false);
});
test('web search requires consent/key, keeps visible unverified citations and rejects unsafe links', async () => {
  const research = createResearch({ env: { BRAVE_SEARCH_API_KEY: 'synthetic-brave' }, clock, fetchImpl: async (url, options) => {
    assert.ok(!url.includes('synthetic-brave')); assert.equal(options.headers['X-Subscription-Token'], 'synthetic-brave'); assert.equal(options.redirect, 'error');
    return respond({ web: { results: [{ title: 'Official page', url: 'https://example.com/docs', description: '<b>Scope</b> unknown' }, { title: 'Bad', url: 'http://127.0.0.1', description: 'bad' }] } });
  } });
  await assert.rejects(research.search({ query: 'task' }), /consent/);
  await assert.rejects(createResearch({ env: {} }).search({ query: 'task', consent: true }), /TAVILY/);
  const result = await research.search({ query: 'task', consent: true }); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].confidence, 'low'); assert.equal(result.results[0].claimStatus, 'snippet_only'); assert.equal(result.evidence[0].verification, 'unverified'); assert.deepEqual(result.evidence[0].facts, []);
  for (const url of ['https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@example.com', 'javascript:alert(1)', 'https://0x7f000001']) assert.equal(publicUrl(url), null);
});
test('integration requests enforce streaming byte and time limits without exposing raw errors', async () => {
  await assert.rejects(json('https://example.com', {}, { maxBytes: 3, fetchImpl: async () => respond({ long: 'value' }) }), /too large/);
  await assert.rejects(json('https://example.com', {}, { timeout: 10, fetchImpl: async () => new Promise(() => {}) }), /timed out/);
  await assert.rejects(json('https://example.com', {}, { fetchImpl: async () => { throw new Error('PRIVATE RAW EXCEPTION'); } }), (e) => !e.message.includes('PRIVATE'));
});
function context(overrides = {}) {
  const journal = { id: 'j', title: 'J', type: 'daily', journalDate: '2030-01-01', content: 'I need to do the project.', updatedAt: now };
  return { journal, trustedEvidence: collectJournalEvidence({ journal }), settings: { timezone: 'UTC' },
    expectedPlan: { targetDate: '2030-01-01', timezone: 'UTC', availability: [{ startsAt: '09:00', endsAt: '17:00' }], bufferMinutes: 15 }, provider: 'stub', model: 'stub', ...overrides };
}
function proposal(ctx, extraIds = []) {
  const baseline = localRuleBasedAnalysis({ ...ctx, availability: ctx.expectedPlan.availability });
  return { summary: 'Journal mentions a project.', weeklySummary: 'Partial context only.', cautions: [], tasks: baseline.contract.tasks, estimates: baseline.contract.estimates,
    summaryEvidenceIds: ctx.trustedEvidence.map((e) => e.id), weeklySummaryEvidenceIds: [...ctx.trustedEvidence.map((e) => e.id), ...extraIds] };
}
test('agent optional tools require permission, honor search budgets, and invalidate a previous preview', async () => {
  const note = { id: 'memory:test', sourceType: 'document', sourceId: 'memory:test', sourceVersion: 'v', excerpt: 'Scoped project note', locator: null, observedAt: now, sourceTimestamp: now, verification: 'source_matched', facts: [] };
  const ctx = context({ memorySearch: async () => ({ mode: 'lexical', evidence: [note] }) });
  assert.equal(permittedTools(context()).length, 4); assert.equal(permittedTools(ctx).length, 5);
  const session = createToolSession(ctx, 'stub', 'stub');
  assert.throws(() => session.execute('search_personal_memory', { query: 'project' }), (e) => e.issues.some((i) => /Read evidence/.test(i.message)));
  session.execute('read_evidence', { offset: 0, limit: 20 }); session.execute('get_planning_context', {});
  session.execute('preview_plan', { proposal: proposal(ctx) });
  await session.execute('search_personal_memory', { query: 'project' });
  assert.throws(() => session.execute('finish_analysis', { previewId: 'preview:1' }), (e) => e.issues.some((i) => /latest/.test(i.message)));
  session.execute('preview_plan', { proposal: proposal(ctx, [note.id]) });
  const result = session.execute('finish_analysis', { previewId: 'preview:2' }); assertAnalysis(result.finished.analysis);
  assert.ok(result.finished.analysis.contract.evidence.some((e) => e.id === note.id));
  await session.execute('search_personal_memory', { query: 'other' });
  assert.throws(() => session.execute('search_personal_memory', { query: 'third' }), (e) => e.issues.some((i) => /budget/.test(i.message)));
  assert.throws(() => session.execute('research_web', { query: 'project' }), (e) => e.issues.some((i) => /not permitted/.test(i.message)));
});
test('bounded async workflow completes research with visible citations and redacted trace', async () => {
  const result = await createResearch({ env: { BRAVE_SEARCH_API_KEY: 'synthetic' }, clock, fetchImpl: async () => respond({ web: { results: [{ title: 'Source', url: 'https://example.com/docs', description: 'Unverified duration range.' }] } }) }).search({ query: 'project', consent: true });
  const ctx = context({ webResearch: async () => result }), calls = [
    ['read_evidence', { offset: 0, limit: 20 }], ['get_planning_context', {}], ['research_web', { query: 'project' }],
    ['preview_plan', { proposal: proposal(ctx, result.evidence.map((e) => e.id)) }], ['finish_analysis', { previewId: 'preview:1' }]
  ]; let index = 0;
  const adapter = { encode(messages, tools) { assert.equal(tools.length, 5); return { body: { messages } }; },
    async complete() { const [name, args] = calls[index++]; return { calls: [{ id: `call:${index}`, name, arguments: JSON.stringify(args) }], message: { role: 'assistant' } }; },
    toolResult(call, output) { return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) }; } };
  const run = await runWorkflow(ctx, adapter, loadSkills()); assert.equal(run.metadata.outcome, 'completed');
  assertAnalysis({ ...run.analysis, agentWorkflow: run.metadata }); assert.equal(run.analysis.research[0].url, result.results[0].url);
  assert.equal(run.metadata.trace[2].tool, 'research_web'); assert.ok(!JSON.stringify(run.metadata).includes('Unverified duration'));
});
test('a stalled async tool uses the total workflow timeout and abort signal', async () => {
  let aborted = false, index = 0;
  const ctx = context({ memorySearch: async (_args, signal) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } });
  const calls = [['read_evidence', { offset: 0, limit: 20 }], ['get_planning_context', {}], ['search_personal_memory', { query: 'project' }]];
  const adapter = { encode: () => ({ body: {} }), async complete() { const [name, args] = calls[index++]; return { calls: [{ id: `${index}`, name, arguments: JSON.stringify(args) }], message: { role: 'assistant' } }; }, toolResult: () => ({ role: 'tool' }) };
  const run = await runWorkflow(ctx, adapter, loadSkills(), { limits: { ...LIMITS, timeoutMs: 30 } });
  assert.equal(run.metadata.stopReason, 'timeout'); assert.equal(run.analysis, undefined); assert.equal(aborted, true);
});
test('source revisions are revalidated inside both save and Apply transactions', async (t) => {
  const store = storeFixture(t), ctx = context(); store.createJournal(ctx.journal);
  const memory = createMemory(store, { env: {}, clock });
  const document = store.putMemoryDocument({ id: 'memory:a', title: 'Scope', content: 'Project requirements', updatedAt: now });
  const evidence = (await memory.search({ query: 'requirements' })).evidence;
  const analysis = { ...localRuleBasedAnalysis({ ...ctx, availability: ctx.expectedPlan.availability, trustedEvidence: [...ctx.trustedEvidence, ...evidence] }), id: 'analysis', journalId: 'j' };
  store.saveJournalAnalysis(analysis); store.putMemoryDocument({ ...document, content: 'Changed scope' });
  assert.throws(() => store.saveJournalAnalysis(analysis), /changed/);
  assert.throws(() => store.applyAnalysis('j', 'analysis', () => []), /changed/); assert.equal(store.getAppliedBatch('analysis'), null);
});
test('Google occupancy revisions and expired coverage reject Apply without a receipt or partial events', (t) => {
  const store = storeFixture(t), ctx = context(), syncedAt = new Date().toISOString(); store.createJournal(ctx.journal);
  const selectedRange = { from: '2029-12-31T23:45:00Z', to: '2030-01-02T00:15:00Z' };
  store.setIntegrationState('googleTokens', { synthetic: true });
  store.replaceGoogleBusy([], { ...selectedRange, calendarIds: ['synthetic'], syncedAt });
  const analysis = { ...scheduleAnalysis(localRuleBasedAnalysis({ ...ctx, availability: ctx.expectedPlan.availability }), { events: store.listPlanningEvents(selectedRange), settings: ctx.settings, availabilitySource: 'request' }), id: 'analysis', journalId: 'j' };
  store.updateSettings({ timezone: 'UTC' }); store.saveJournalAnalysis(analysis);
  const before = store.listEvents().length;
  store.replaceGoogleBusy([{ id: 'google:synthetic', startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z', repeat: 'none' }], { ...selectedRange, calendarIds: ['synthetic'], syncedAt });
  assert.throws(() => store.applyAnalysis('j', 'analysis', (candidate) => { assertScheduleCurrent(candidate, store.listPlanningEvents(planningRange(candidate.contract.plan)), store.getSettings()); return []; }), /Calendar availability changed/);
  assert.equal(store.getAppliedBatch('analysis'), null); assert.equal(store.listEvents().length, before);
  store.replaceGoogleBusy([], { ...selectedRange, calendarIds: ['synthetic'], syncedAt: '2020-01-01T00:00:00Z' });
  assert.throws(() => store.applyAnalysis('j', 'analysis', () => []), /Sync/); assert.equal(store.getAppliedBatch('analysis'), null);
});
test('integration API is authenticated, returns setup status without secrets, and IPC routes stay scoped', async (t) => {
  const store = storeFixture(t), token = 'synthetic-api-token-at-least-32-chars';
  const integrations = createIntegrations(store, { env: {}, clock, fetchImpl: async () => { throw new Error('offline'); } }); t.after(() => integrations.close());
  const app = createApp({ store, apiToken: token, clock, integrations }), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/integrations/status`)).status, 401);
  const response = await fetch(`${base}/api/integrations/status`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json(); assert.equal(body.google.configured, false); assert.equal(body.research.configured, false); assert.equal(body.memory.model, 'nomic-embed-text');
  for (const [route, method] of [['/api/integrations/status', 'GET'], ['/api/integrations/google/connect', 'POST'], ['/api/memory/search', 'POST'], ['/api/research/search', 'POST'], ['/api/memory/memory%3A12345678-1234-1234-1234-123456789abc', 'DELETE']]) assert.equal(isAllowedRequest(route, method), true);
  assert.equal(isAllowedRequest('/api/integrations/google/token', 'GET'), false); assert.equal(isAllowedRequest('/api/integrations/status', 'POST'), false);
  assert.equal(isAllowedRequest('https://evil.example/api/research/search', 'POST'), false);
  assert.throws(() => integrations.context({ allowMemory: 'yes' }, { journalDate: '2026-10-12' }, { timezone: 'UTC' }), /boolean/);
});
