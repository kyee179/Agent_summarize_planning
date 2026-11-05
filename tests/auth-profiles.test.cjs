const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createProfileGateway } = require('../server/auth/gateway.cjs');
const { createApp } = require('../server/index.cjs');
const { createCredentials } = require('../electron/credentials.cjs');
const { localRuleBasedAnalysis } = require('../server/journalAnalyzer.cjs');
const { createRegistry } = require('../server/auth/registry.cjs');
const { createPrivateVault } = require('../electron/privateVault.cjs');
const { validateConfig } = require('../server/auth/hosted.cjs');
const apiToken = 'synthetic-app-process-authentication-token';
const publicConfig = { url: 'https://synthetic-project.supabase.co', publishableKey: 'sb_publishable_' + 'x'.repeat(32) };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

const { hostedFixture } = require('./fixtures/hosted-auth.cjs');
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-auth-')), hosted = options.hosted || hostedFixture();
  let saved = null;
  const vault = { available: () => true, read: () => saved, write: value => { saved = structuredClone(value); }, clear: () => { saved = null; } };
  let gateway, server, base, token = null;
  async function start() { gateway = createProfileGateway({ dataFile: path.join(directory, 'calendar.sqlite'), apiToken, env: options.unconfigured ? {} : { SUPABASE_URL: publicConfig.url, SUPABASE_PUBLISHABLE_KEY: publicConfig.publishableKey, ...(options.env || {}) },
    buildApp: settings => createApp({ ...settings, ...(options.analyze ? { analyze: options.analyze } : {}) }), authOptions: { fetchImpl: hosted.fetch }, vault, ...(options.clock ? { clock: options.clock } : {}),
    credentialsFactory: settings => createCredentials({ ...settings, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString(), 'base64').toString() }, platform: 'win32' }) });
  server = gateway.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port; token = null; }
  await start();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); gateway.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function call(route, body, explicitToken = token, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + apiToken, 'content-type': 'application/json', ...(explicitToken ? { 'x-calendar-session': explicitToken } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const next = response.headers.get('x-calendar-session'); if (next !== null) token = next || null;
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), token: next };
  }
  const login = (address = 'a@example.test', remember = false) => call('/api/auth/login', { email: address, password: 'correct-password-123', remember });
  return { get gateway() { return gateway; }, directory, hosted, vault, call, login, async restart() { await new Promise(resolve => server.close(resolve)); gateway.close(); await start(); }, get token() { return token; }, get base() { return base; } };
}

test('production gateway starts locked and opens an explicit empty local profile without hosted configuration', async t => {
  const f = await fixture(t, { unconfigured: true });
  assert.equal((await f.call('/api/auth/status')).body.provider.configured, false);
  assert.equal(fs.existsSync(path.join(f.directory, 'calendar.sqlite')), false);
  assert.equal((await f.call('/api/events')).status, 401);
  const local = await f.call('/api/auth/local', {});
  assert.equal(local.body.session.kind, 'local'); assert.match(local.cookie, /HttpOnly; SameSite=Strict/);
  assert.deepEqual((await f.call('/api/events')).body, []);
  assert.equal((await f.call('/api/settings')).body.aiProvider, 'local');
  const stale = f.token; await f.call('/api/auth/logout', {});
  assert.equal((await f.call('/api/events', null, stale)).status, 401);
});
test('verified accounts isolate journals, memory, events, task writes, exports and legacy credentials', async t => {
  const f = await fixture(t, { env: { GLM_API_KEY: 'synthetic-legacy-key', AI_PROVIDER: 'glm', TAVILY_API_KEY: 'synthetic-legacy-search' } });
  const first = await f.login(); assert.equal(first.status, 200, JSON.stringify(first.body));
  const a = first.body.session.id, aToken = f.token;
  assert.equal((await f.call('/api/settings')).body.aiProviderConfigured.glm, false);
  const journal = (await f.call('/api/journals', { type: 'daily', journalDate: '2030-01-07', title: 'A private', content: 'I need to review the project.' })).body;
  await f.call('/api/memory', { title: 'A secret note', content: '火星接口专属资料' });
  await f.call('/api/events', { title: 'A private event', startsAt: '2030-01-07T09:00:00Z', endsAt: '2030-01-07T10:00:00Z', calendarType: 'personal', notificationFormat: 'Silent' });
  const second = await f.login('b@example.test'); assert.notEqual(second.body.session.id, a);
  assert.equal((await f.call('/api/journals/' + journal.id + '/analysis')).status, 404);
  assert.equal((await f.call('/api/journals/' + journal.id + '/apply-drafts', { analysisId: 'from-a' })).status, 404);
  assert.equal((await f.call('/api/journals/' + journal.id, { title: 'Attempted edit' }, f.token, 'PUT')).status, 404);
  assert.equal((await f.call('/api/events', null, aToken)).status, 401);
  assert.deepEqual((await f.call('/api/memory/search', { query: '火星接口' })).body.items, []);
  assert.equal(JSON.stringify((await f.call('/api/account/export')).body).includes('A private'), false);
  assert.equal((await f.call('/api/auth/local', { profileId: a })).status, 400);
  await f.login(); assert.equal((await f.call('/api/journals')).body[0].id, journal.id);
  assert.equal((await f.call('/api/auth/login', { email: 'a@example.test', password: 'correct-password-123', profileId: second.body.session.id })).status, 400);
});
test('logout cancels a pending login and no late result can activate its account', async t => {
  const f = await fixture(t), gate = deferred(); f.hosted.pauseLogin(gate);
  const pending = f.login();
  while (!f.hosted.calls.some(call => call.grant === 'password')) await new Promise(resolve => setTimeout(resolve, 1));
  await f.call('/api/auth/logout', {}); gate.resolve();
  assert.equal((await pending).status, 401);
  assert.equal((await f.call('/api/auth/status')).body.session, null);
});
test('late analysis is discarded after account switch and cannot save into either profile', async t => {
  const gate = deferred(), started = deferred();
  const f = await fixture(t, { analyze: async input => { started.resolve(); await gate.promise; return localRuleBasedAnalysis(input); } });
  await f.login();
  const journal = (await f.call('/api/journals', { type: 'daily', journalDate: '2030-01-07', title: 'Delayed A', content: 'I need to review a project.' })).body;
  const pending = f.call('/api/journals/' + journal.id + '/analyze', { targetDate: '2030-01-07' }); await started.promise;
  await f.login('b@example.test'); gate.resolve();
  assert.equal((await pending).status, 401);
  assert.deepEqual((await f.call('/api/journals')).body, []);
  await f.login(); assert.equal((await f.call('/api/journals/' + journal.id + '/analysis')).status, 404);
});
test('remembered refresh tokens restore only their verified owner and logout forgets them', async t => {
  const f = await fixture(t); await f.login('a@example.test', true);
  const saved = f.vault.read(); assert.ok(saved.refreshToken); assert.equal(saved.accessToken, undefined);
  await f.restart();
  assert.equal((await f.call('/api/events')).status, 401);
  const restored = await f.call('/api/auth/restore', {}); assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.session.id, saved.profileId);
  assert.notEqual(f.vault.read().refreshToken, saved.refreshToken);
  await f.call('/api/auth/logout', {}); assert.equal(f.vault.read(), null);
  assert.equal((await f.call('/api/auth/restore', {})).body.session, null);
});
test('onboarding is persisted per account and copying local data preserves the original and excludes connection state', async t => {
  const f = await fixture(t);
  await f.call('/api/auth/local', {});
  const journal = (await f.call('/api/journals', { type: 'daily', journalDate: '2030-01-07', title: 'Local copy', content: '我需要完成项目报告。' })).body;
  const analysis = await f.call('/api/journals/' + journal.id + '/analyze', { targetDate: '2030-01-07' });
  assert.equal(analysis.status, 201);
  assert.equal((await f.call('/api/journals/' + journal.id + '/apply-drafts', { analysisId: analysis.body.id })).status, 201);
  const localTasks = (await f.call('/api/tasks')).body; assert.ok(localTasks[0].sessionEventIds.length);
  f.gateway.store.setIntegrationState('googleTokens', { encrypted: 'synthetic-never-copy' });
  const signedIn = await f.login();
  const copied = await f.call('/api/account/import-local', { sourceId: 'local', confirm: true }); assert.equal(copied.status, 200, JSON.stringify(copied.body));
  assert.equal((await f.call('/api/journals')).body[0].id, journal.id);
  const importedTasks = (await f.call('/api/tasks')).body;
  assert.equal(importedTasks[0].id, localTasks[0].id); assert.equal(importedTasks[0].profileId, signedIn.body.session.id);
  assert.deepEqual(importedTasks[0].sessionEventIds, localTasks[0].sessionEventIds);
  assert.equal(f.gateway.store.integrationState('googleTokens'), null);
  const before = f.token;
  const completed = await f.call('/api/account/onboarding', { timezone: 'Asia/Shanghai', defaultAvailability: [{ startsAt: '09:00', endsAt: '17:00' }], aiProvider: 'local', planningLeadMinutes: 10 });
  assert.equal(completed.body.session.onboardingComplete, true); assert.notEqual(f.token, before);
  const repeated = await f.call('/api/journals/' + journal.id + '/analyze', { targetDate: '2030-01-07' });
  assert.equal(repeated.status, 201); assert.equal(repeated.body.scheduleDrafts.length, 0);
  assert.equal((await f.call('/api/account/import-local', { confirm: true })).status, 409);
  await f.login('b@example.test'); assert.equal((await f.call('/api/account/status')).body.session.onboardingComplete, false);
  await f.call('/api/auth/local', {}); assert.equal((await f.call('/api/journals')).body[0].id, journal.id);
});
test('persistent request quotas are atomic per profile and survive registry restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-auth-')), file = path.join(directory, 'accounts.sqlite');
  try { let registry = createRegistry(file); registry.reserve('a', 1); assert.throws(() => registry.reserve('a', 1), error => error.status === 429); registry.reserve('b', 1); registry.close(); registry = createRegistry(file); assert.equal(registry.usage('a').used, 1); assert.throws(() => registry.reserve('a', 1), error => error.status === 429); registry.close(); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('analysis concurrency and the daily remote allowance are enforced before starting provider work', async t => {
  const gate = deferred(), started = deferred(); let calls = 0;
  const f = await fixture(t, { analyze: async input => { calls++; started.resolve(); await gate.promise; return localRuleBasedAnalysis(input); } });
  await f.login(); await f.call('/api/account/services', { AI_PROVIDER: 'glm', GLM_API_KEY: 'synthetic-remote-key' });
  await f.call('/api/settings', { dailyAiRequestLimit: 1 }, f.token, 'PUT');
  const journal = (await f.call('/api/journals', { type: 'daily', journalDate: '2030-01-07', title: 'Quota', content: 'I need to review the report.' })).body;
  const pending = f.call('/api/journals/' + journal.id + '/analyze', { targetDate: '2030-01-07' }); await started.promise;
  assert.equal((await f.call('/api/journals/' + journal.id + '/analyze', {})).status, 429); gate.resolve(); assert.equal((await pending).status, 201);
  assert.equal((await f.call('/api/journals/' + journal.id + '/analyze', {})).status, 429); assert.equal(calls, 1);
  await f.restart(); await f.login(); assert.equal((await f.call('/api/account/status')).body.usage.used, 1);
});

test('a remembered token cannot restore the device profile belonging to another verified account', async t => {
  const f = await fixture(t); const b = await f.login('b@example.test'); await f.login('a@example.test', true);
  f.vault.write({ ...f.vault.read(), profileId: b.body.session.id }); await f.restart();
  assert.equal((await f.call('/api/auth/restore', {})).status, 401); assert.equal(f.vault.read(), null);
  assert.equal((await f.call('/api/journals')).status, 401);
});

test('signup, confirmation, resend and password recovery use the hosted SDK and leave no workspace open', async t => {
  const f = await fixture(t);
  const input = { email: 'new@example.test', password: 'correct-password-123', name: 'New reader' };
  assert.equal((await f.call('/api/auth/signup', { ...input, password: 'short' })).status, 400);
  assert.equal((await f.call('/api/auth/signup', input)).status, 202);
  assert.equal((await f.call('/api/auth/status')).body.session, null);
  assert.equal((await f.call('/api/auth/confirm', { email: input.email, code: '12345678' })).status, 200);
  assert.equal((await f.call('/api/auth/resend', { email: input.email })).status, 200);
  assert.equal((await f.call('/api/auth/reset-request', { email: input.email })).status, 200);
  const recovered = await f.call('/api/auth/recover', { email: input.email, code: '12345678', password: 'new-secure-password-123' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal((await f.call('/api/auth/status')).body.session, null);
  assert.ok(f.hosted.calls.some(call => call.path.endsWith('/user') && call.method === 'PUT'));
});

test('wrong password and revoked sessions fail closed without opening another profile', async t => {
  let time = Date.now(); const f = await fixture(t, { clock: () => new Date(time).toISOString() });
  assert.equal((await f.call('/api/auth/login', { email: 'a@example.test', password: 'wrong' })).status, 401);
  assert.equal((await f.call('/api/events')).status, 401);
  await f.login('a@example.test', true); f.hosted.revoke(); time += 6 * 60000;
  assert.equal((await f.call('/api/journals')).status, 401);
  assert.equal(f.vault.read(), null);
  assert.equal((await f.call('/api/auth/status')).body.session, null);
});

test('concurrent near-expiry requests share a refresh and preserve the verified owner', async t => {
  let time = Date.now(); const f = await fixture(t, { clock: () => new Date(time).toISOString() });
  const signedIn = await f.login('a@example.test', true); time += 119.5 * 60000;
  const responses = await Promise.all([f.call('/api/journals'), f.call('/api/events'), f.call('/api/account/status')]);
  assert.ok(responses.every(value => value.status === 200), JSON.stringify(responses));
  assert.equal(f.hosted.calls.filter(call => call.grant === 'refresh_token').length, 1);
  assert.equal(responses[2].body.session.id, signedIn.body.session.id);
});

test('secure service configuration rotates the session and never carries keys into another account', async t => {
  const f = await fixture(t); await f.login(); const old = f.token;
  const saved = await f.call('/api/account/services', { AI_PROVIDER: 'glm', GLM_API_KEY: 'synthetic-profile-a-key' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.notEqual(f.token, old);
  assert.equal((await f.call('/api/settings')).body.aiProviderConfigured.glm, true);
  assert.equal((await f.call('/api/events', null, old)).status, 401);
  await f.login('b@example.test'); assert.equal((await f.call('/api/settings')).body.aiProviderConfigured.glm, false);
  await f.login(); assert.equal((await f.call('/api/settings')).body.aiProviderConfigured.glm, true);
  assert.equal(JSON.stringify((await f.call('/api/account/export')).body).includes('synthetic-profile-a-key'), false);
});

test('device data removal requires the exact name and removes only the current account workspace', async t => {
  const f = await fixture(t); await f.call('/api/auth/local', {});
  const localFile = path.join(f.directory, 'calendar.sqlite');
  const account = await f.login(); const directory = path.join(f.directory, 'profiles', account.body.session.id);
  const before = require('node:crypto').createHash('sha256').update(fs.readFileSync(localFile)).digest('hex');
  assert.equal((await f.call('/api/account/remove-local-data', { confirmName: 'wrong' })).status, 400);
  const removed = await f.call('/api/account/remove-local-data', { confirmName: account.body.session.name });
  assert.equal(removed.status, 200); assert.equal(removed.body.hostedAccountUnchanged, true);
  assert.equal(fs.existsSync(directory), false); assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(localFile)).digest('hex'), before);
  await f.call('/api/auth/local', {});
  assert.equal((await f.call('/api/account/remove-local-data', { confirmName: 'Local workspace' })).status, 409);
});

test('a browser session cookie grants access only with the process token and trusted origin', async t => {
  const f = await fixture(t); const opened = await f.call('/api/auth/local', {}), cookie = opened.cookie.split(';')[0];
  const request = headers => fetch(f.base + '/api/events', { headers: { Authorization: 'Bearer ' + apiToken, ...headers } });
  assert.equal((await request({ cookie })).status, 200);
  assert.equal((await request({ cookie, 'x-calendar-session': 'a'.repeat(64) })).status, 401);
  assert.equal((await request({ cookie, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(f.base + '/api/events', { headers: { cookie } })).status, 401);
});
test('only publishable hosted configuration is accepted and the encrypted vault never stores plaintext tokens', () => {
  assert.throws(() => validateConfig({ url: 'http://127.0.0.1', publishableKey: publicConfig.publishableKey }));
  assert.throws(() => validateConfig({ ...publicConfig, publishableKey: 'sb_secret_' + 'x'.repeat(32) }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-vault-')), file = path.join(directory, 'session.encrypted');
  try {
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString(), 'base64').toString() };
    const vault = createPrivateVault({ file, safeStorage, platform: 'win32' }); vault.write({ refreshToken: 'synthetic-refresh-private' });
    assert.equal(fs.readFileSync(file).includes('synthetic-refresh-private'), false); assert.equal(vault.read().refreshToken, 'synthetic-refresh-private'); vault.clear(); assert.equal(vault.read(), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
