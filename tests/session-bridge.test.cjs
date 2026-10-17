const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionBridge } = require('../electron/sessionBridge.cjs');
const response = (body, token) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(token ? { 'x-calendar-session': token } : {}) } });

test('desktop bridge keeps capabilities private and drops late data or late sign-in from the previous workspace', async () => {
  const queued = [];
  const bridge = createSessionBridge({ address: () => ({ port: 1 }), apiToken: 'synthetic', fetchImpl: (_url, options) => new Promise(resolve => queued.push({ options, resolve })) });
  const login = bridge.request('/api/auth/login', { method: 'POST' }); bridge.changed(); queued.shift().resolve(response({ session: { id: 'a' } }, 'a'.repeat(64)));
  assert.equal((await login).status, 200);
  const old = bridge.request('/api/journals'); const first = queued.shift(); assert.equal(first.options.headers['x-calendar-session'], 'a'.repeat(64));
  const switchAccount = bridge.request('/api/auth/login', { method: 'POST' }); bridge.changed();
  const second = queued.shift(); second.resolve(response({ session: { id: 'b' } }, 'b'.repeat(64))); await switchAccount;
  first.resolve(response([{ title: 'private A' }])); assert.equal((await old).status, 401); assert.equal(first.options.signal.aborted, true);
  const lateLogin = bridge.request('/api/auth/login', { method: 'POST' }); const late = queued.shift();
  const logout = bridge.request('/api/auth/logout', { method: 'POST' }); bridge.changed(); queued.shift().resolve(response({ signedOut: true })); await logout;
  late.resolve(response({ session: { id: 'a' } }, 'a'.repeat(64))); assert.equal((await lateLogin).status, 401);
  const after = bridge.request('/api/auth/status'); const request = queued.shift(); assert.equal(request.options.headers['x-calendar-session'], undefined); request.resolve(response({ session: null })); await after;
});

test('Google consent is bound to a connection started by the active workspace', async () => {
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic';
  const bridge = createSessionBridge({ address: () => ({ port: 1 }), apiToken: 'synthetic', fetchImpl: async () => response({ authorizationUrl: url }) });
  bridge.restore('a'.repeat(64)); assert.equal(bridge.permitsConsent(url), false);
  await bridge.request('/api/integrations/google/connect', { method: 'POST' }); assert.equal(bridge.permitsConsent(url), true);
  assert.equal(bridge.permitsConsent(url + 'changed'), false); bridge.changed(); assert.equal(bridge.permitsConsent(url), false);
});
