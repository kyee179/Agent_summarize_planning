const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { createStore } = require('../server/store.cjs');
const { createDesktopActivity } = require('../server/integrations/desktopActivity.cjs');
const { createResearch } = require('../server/integrations/research.cjs');
const { createIntegrations } = require('../server/integrations/service.cjs');
const { vault } = require('../server/integrations/google.cjs');
const { isAllowedRequest } = require('../electron/apiBridge.cjs');
const now = '2026-10-15T12:00:00Z';
const response = (body) => new Response(JSON.stringify(body));
function fakeProcess() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.kill = () => { child.killed = true; child.emit('close'); }; return child;
}
test('built-in activity requires consent, filters idle/gaps, creates immutable local observations and pauses', async (t) => {
  const store = createStore(':memory:'); t.after(() => store.close()); let ms = Date.parse(now), ticks = 0, calls = 0; const child = fakeProcess();
  const collector = createDesktopActivity(store, { platform: 'win32', clock: () => new Date(ms).toISOString(), monotonic: () => ticks,
    spawnImpl: (exe, args, options) => { calls++; assert.match(exe, /powershell\.exe$/i); assert.ok(args.includes('-File')); assert.equal(options.windowsHide, true); queueMicrotask(() => child.stdout.emit('data', '{"ready":true}\n')); return child; } });
  await assert.rejects(collector.start({ consent: false }), /consent/); assert.equal(calls, 0);
  await collector.start({ consent: true }); assert.equal(collector.status().running, true);
  for (let i = 0; i < 14; i++) { child.stdout.emit('data', JSON.stringify({ app: 'Code', idleSeconds: 1, title: 'PRIVATE WINDOW' }) + '\n'); ms += 5000; ticks += 5000; }
  child.stdout.emit('data', '{"app":"Code","idleSeconds":100}\n');
  const records = store.listActivity({ from: now, to: new Date(ms).toISOString() }); assert.equal(records.length, 2);
  assert.ok(!JSON.stringify(records).includes('PRIVATE')); assert.equal(records[0].kind, 'app');
  const version = JSON.stringify(records);
  ms += 120000; ticks += 120000; child.stdout.emit('data', '{"app":"Code","idleSeconds":1}\n');
  collector.stop(); assert.ok(child.killed); assert.equal(collector.status().running, false);
  assert.equal(JSON.stringify(store.listActivity({ from: now, to: new Date(ms).toISOString() })), version);
});
test('cancelled or failed activity starts cannot revive capture or expose helper errors', async (t) => {
  const store = createStore(':memory:'); t.after(() => store.close()); const child = fakeProcess();
  const collector = createDesktopActivity(store, { platform: 'win32', spawnImpl: () => child });
  const pending = collector.start({ consent: true }); collector.stop(); await assert.rejects(pending, /cancelled/);
  child.stdout.emit('data', '{"ready":true}\n'); assert.equal(collector.status().running, false);
  const failing = createDesktopActivity(store, { platform: 'win32', spawnImpl: () => { throw new Error('PRIVATE OS ERROR'); } });
  await assert.rejects(failing.start({ consent: true }), /could not start/); assert.ok(!JSON.stringify(failing.status()).includes('PRIVATE'));
  await assert.rejects(createDesktopActivity(store, { platform: 'linux' }).start({ consent: true }), /Windows/);
});
test('Tavily search uses a fixed authenticated endpoint and bounded basic search; snippets stay unverified', async () => {
  let calls = 0;
  const research = createResearch({ env: { TAVILY_API_KEY: 'synthetic-only' }, clock: () => now, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.tavily.com/search'); assert.equal(options.headers.Authorization, 'Bearer synthetic-only');
    const body = JSON.parse(options.body); assert.equal(body.query, 'project duration'); assert.equal(body.search_depth, 'basic'); assert.equal(body.auto_parameters, false);
    assert.equal(body.include_answer, false); assert.equal(body.include_raw_content, false); assert.equal(body.max_results, 3); assert.equal(body.api_key, undefined);
    return response({ results: [{ title: 'Official guide', url: 'https://example.com/docs', content: '<b>Planning guidance</b>', score: 0.99 },
      { title: 'Local', url: 'http://localhost/private', content: 'PRIVATE' }], usage: { credits: 1 } });
  } });
  await assert.rejects(research.search({ query: 'project duration' }), /consent/); assert.equal(calls, 0);
  const result = await research.search({ query: 'project duration', consent: true }); assert.equal(result.results.length, 1); assert.equal(result.usage.credits, 1);
  assert.equal(result.provider, 'tavily'); assert.equal(result.results[0].confidence, 'low'); assert.deepEqual(result.evidence[0].facts, []);
  assert.ok(!JSON.stringify(result).includes('synthetic-only')); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('one-button Google sync chooses the actual primary calendar and reserves eight local days including buffers', async (t) => {
  const store = createStore(':memory:'); t.after(() => store.close());
  // App timezone is explicit; CI hosts may default to UTC.
  store.updateSettings({ timezone: 'Asia/Shanghai' });
  const env = { GOOGLE_CLIENT_ID: 'synthetic', INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') };
  store.setIntegrationState('googleTokens', vault(env).seal({ access_token: 'synthetic', expiresAt: Date.parse(now) + 3600000 }));
  let requestedCalendar = null;
  const service = createIntegrations(store, { env, clock: () => now, fetchImpl: async (url) => {
    const target = new URL(url);
    if (target.pathname.endsWith('calendarList')) return response({ items: [{ id: 'other', summary: 'Other' }, { id: 'primary-id', summary: 'Primary', primary: true, timeZone: 'UTC' }] });
    requestedCalendar = target.pathname; return response({ items: [] });
  } }); t.after(() => service.close());
  await assert.rejects(service.quickGoogleSync({ consent: false }), /consent/);
  const result = await service.quickGoogleSync({ consent: true }); assert.match(requestedCalendar, /primary-id/);
  assert.deepEqual(result.calendarIds, ['primary-id']); assert.equal(result.from, '2026-10-14T15:45:00.000Z'); assert.equal(result.to, '2026-10-22T16:15:00.000Z');
  assert.equal(isAllowedRequest('/api/integrations/google/quick-sync', 'POST'), true); assert.equal(isAllowedRequest('/api/integrations/activity/desktop/start', 'POST'), true);
});
