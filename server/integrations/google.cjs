const crypto = require('node:crypto');
const http = require('node:http');
const { json, error, range, hash } = require('./common.cjs');
const { isInstant, isCalendarDate, isTimezone } = require('../contracts/validate.cjs');
const { wallClockCandidates } = require('../contracts/time.cjs');
const SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];
function vault(env) {
  const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw error('Run pnpm setup:env to generate the local encryption key, then restart', 409);
  return {
    seal(value) {
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from('calendar-google-tokens-v1'));
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return { version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
    open(value) {
      try {
        if (value.version !== 1) throw new Error('version');
        const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'));
        cipher.setAAD(Buffer.from('calendar-google-tokens-v1')); cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
        return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString());
      } catch { throw error('Cannot decrypt Google connection; restore the original key or disconnect and reconnect', 409); }
    }
  };
}
function eventTimes(event, timezone) {
  if (isInstant(event.start?.dateTime) && isInstant(event.end?.dateTime)) return [event.start.dateTime, event.end.dateTime];
  if (isCalendarDate(event.start?.date) && isCalendarDate(event.end?.date) && isTimezone(timezone)) {
    const starts = wallClockCandidates(event.start.date, '00:00', timezone), ends = wallClockCandidates(event.end.date, '00:00', timezone);
    if (starts.length && ends.length) return [new Date(Math.min(...starts)).toISOString(), new Date(Math.max(...ends)).toISOString()];
  }
  throw error('Google returned an unsupported event time; no partial calendar cache was saved', 502);
}
function createGoogle(store, { fetchImpl, env = process.env, clock = () => new Date().toISOString() } = {}) {
  let pending = null, generation = 0, refreshPromise = null, syncing = false, connecting = false, lastOAuth = null;
  const configured = () => Boolean(env.GOOGLE_CLIENT_ID && Buffer.from(env.INTEGRATION_ENCRYPTION_KEY || '', 'base64').length === 32);
  function cancel() {
    generation++;
    if (pending || lastOAuth === 'waiting') lastOAuth = 'cancelled';
    if (pending) { clearTimeout(pending.timer); pending.server.close(); pending = null; }
  }
  async function tokenRequest(params) {
    return json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_CLIENT_SECRET ? { client_secret: env.GOOGLE_CLIENT_SECRET } : {}), ...params }).toString() }, { fetchImpl, maxBytes: 65536 });
  }
  function saveToken(data, old, expectedGeneration, previous) {
    if (generation !== expectedGeneration) throw error('Google connection was cancelled', 409);
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) throw error('Invalid Google token response', 502);
    const granted = String(data.scope || old?.scope || '').split(' ');
    if (!SCOPES.every((scope) => granted.includes(scope))) throw error('Both read-only Calendar permissions are required; reconnect', 409);
    const tokens = { access_token: data.access_token, refresh_token: data.refresh_token || old?.refresh_token || null,
      expiresAt: Date.parse(clock()) + data.expires_in * 1000, scope: granted.join(' ') };
    if (!old) store.connectGoogle(vault(env).seal(tokens), crypto.randomUUID());
    else store.refreshGoogleTokens(vault(env).seal(tokens), previous);
    return tokens;
  }
  async function accessToken() {
    const encrypted = store.integrationState('googleTokens');
    if (!encrypted) throw error('Connect Google Calendar first', 409);
    const tokens = vault(env).open(encrypted);
    if (tokens.expiresAt > Date.parse(clock()) + 60000) return tokens.access_token;
    if (!tokens.refresh_token) throw error('Google connection expired; reconnect', 409);
    if (!refreshPromise) {
      const current = generation;
      refreshPromise = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).then((data) => saveToken(data, tokens, current, encrypted).access_token).finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  async function pages(url, params, maxItems) {
    const items = [], visited = new Set(); let next;
    for (let page = 0; page < 10; page++) {
      const search = new URLSearchParams({ ...params, ...(next ? { pageToken: next } : {}) });
      const result = await json(`${url}?${search}`, { headers: { Authorization: `Bearer ${await accessToken()}` } }, { fetchImpl });
      if (!Array.isArray(result.items)) throw error('Invalid Google Calendar response', 502);
      items.push(...result.items);
      if (items.length > maxItems) throw error('Calendar result limit exceeded; select fewer calendars or a shorter range');
      next = result.nextPageToken;
      if (!next) return items;
      if (typeof next !== 'string' || visited.has(next)) throw error('Invalid Calendar pagination', 502);
      visited.add(next);
    }
    throw error('Calendar page limit exceeded; no partial sync was saved');
  }
  const calendars = async () => (await pages('https://www.googleapis.com/calendar/v3/users/me/calendarList', { maxResults: '100' }, 1000))
    .map((item) => ({ id: item.id, name: String(item.summary || item.id).slice(0, 300), timezone: item.timeZone || null }));
  return {
    status: () => ({ configured: configured(), connected: Boolean(store.integrationState('googleTokens')), pending: Boolean(pending), lastOAuth,
      sync: store.integrationState('googleSync'), scopes: SCOPES }),
    cancel, close: cancel, calendars,
    async connect(input) {
      if (input.consent !== true) throw error('Google connection requires explicit consent');
      if (!configured()) throw error('Configure GOOGLE_CLIENT_ID and run pnpm setup:env, then restart', 409);
      if (syncing || refreshPromise || connecting) throw error('Wait for the current Google request to finish', 409);
      cancel(); lastOAuth = 'waiting'; const current = generation;
      const state = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url');
      let redirect;
      const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'");
        const callback = new URL(req.url, redirect);
        if (req.method !== 'GET' || req.headers.host !== new URL(redirect).host || callback.pathname !== '/oauth/callback' ||
            callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== state || pending?.generation !== current) {
          res.writeHead(400); res.end('Invalid or expired authorization response.'); return;
        }
        // Consume a matching state once, before any asynchronous exchange.
        clearTimeout(pending.timer); pending = null; server.close();
        try {
          const code = callback.searchParams.get('code');
          if (callback.searchParams.has('error') || callback.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) throw error('Authorization declined', 400);
          saveToken(await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }), null, current);
          if (generation !== current) throw error('Cancelled', 409);
          lastOAuth = 'connected'; res.end('Google Calendar connected. Return to the app and refresh connection status.');
        } catch { if (generation === current) lastOAuth = 'failed'; res.writeHead(400); res.end('Connection failed or declined. Return to the app and reconnect.'); }
      });
      server.headersTimeout = 5000; server.requestTimeout = 10000;
      connecting = true;
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
      finally { connecting = false; }
      if (current !== generation) { server.close(); throw error('Google connection cancelled', 409); }
      redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      const timer = setTimeout(() => { if (pending?.generation === current) { lastOAuth = 'expired'; cancel(); } }, 300000); timer.unref();
      pending = { generation: current, server, timer };
      const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '),
        state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
      return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, expiresAt: new Date(Date.parse(clock()) + 300000).toISOString() };
    },
    async sync(input) {
      if (input.consent !== true) throw error('Calendar import requires explicit consent');
      if (syncing || pending || refreshPromise) throw error('Wait for the current Google operation to finish', 409);
      const selectedRange = range(input);
      if (!Array.isArray(input.calendarIds) || !input.calendarIds.length || input.calendarIds.length > 4 || new Set(input.calendarIds).size !== input.calendarIds.length ||
          input.calendarIds.some((id) => typeof id !== 'string' || id.length > 500)) throw error('Select 1–4 calendars');
      const current = generation, connectionId = store.integrationState('googleConnection')?.id || null; syncing = true;
      try {
        const available = await calendars(); const events = [];
        for (const id of input.calendarIds) {
          const calendar = available.find((item) => item.id === id);
          if (!calendar) throw error('Selected calendar is no longer available; refresh calendars');
          const data = await pages(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`,
            { timeMin: selectedRange.from, timeMax: selectedRange.to, singleEvents: 'true', showDeleted: 'false', maxResults: '250' }, 2000);
          for (const event of data) {
            if (event.status === 'cancelled' || event.transparency === 'transparent' || event.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
            const [startsAt, endsAt] = eventTimes(event, event.start?.timeZone || calendar.timezone);
            if (Date.parse(endsAt) <= Date.parse(startsAt) || typeof event.id !== 'string') throw error('Invalid calendar interval', 502);
            events.push({ id: `google:${hash([id, event.id]).slice(0, 40)}`, title: 'Google Calendar busy', startsAt, endsAt, repeat: 'none', calendarType: 'other',
              color: '#64748b', source: 'google', readonly: true, notificationFormat: 'Google Calendar · read only', notifyMinutesBefore: 0 });
          }
        }
        if (events.length > 2000) throw error('Too many busy events; choose a shorter range');
        if (current !== generation) throw error('Google connection changed during sync', 409);
        return store.replaceGoogleBusy(events, { calendarIds: input.calendarIds, ...selectedRange, syncedAt: clock(), connectionId });
      } finally { syncing = false; }
    },
    async disconnect() {
      cancel(); lastOAuth = null;
      const encrypted = store.integrationState('googleTokens'); let tokens;
      try { if (encrypted) tokens = vault(env).open(encrypted); } catch { /* Local deletion must work if the key was lost. */ }
      store.disconnectGoogle();
      if (!tokens) return { disconnected: true, revoked: false };
      try {
        await json('https://oauth2.googleapis.com/revoke', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }).toString() }, { fetchImpl, allowEmpty: true, maxBytes: 65536 });
        return { disconnected: true, revoked: true };
      } catch { return { disconnected: true, revoked: false, warning: 'Local data removed. Revoke app access in your Google account if remote revocation failed.' }; }
    }
  };
}
module.exports = { createGoogle, vault, eventTimes, SCOPES };
