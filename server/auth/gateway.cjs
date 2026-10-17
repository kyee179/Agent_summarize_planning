const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { localApiSecurity } = require('../security.cjs');
const { createStore } = require('../store.cjs');
const { createIntegrations } = require('../integrations/service.cjs');
const { createTelemetry } = require('../observability.cjs');
const { createRegistry } = require('./registry.cjs');
const { createHostedAuth, validateConfig } = require('./hosted.cjs');
const SESSION_HEADER = 'x-calendar-session';
const COOKIE = 'calendar_session';
const ended = () => Object.assign(new Error('Your workspace session ended. Open a profile or sign in again.'), { status: 401 });
const conflict = message => Object.assign(new Error(message), { status: 409 });
const invalid = message => Object.assign(new Error(message), { status: 400 });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function createProfileGateway({ dataFile, apiToken, allowedOrigins = [], buildApp, clock = () => new Date().toISOString(), env = process.env,
  authOptions = {}, vault, credentialsFactory, onChange = () => {} }) {
  const root = path.dirname(path.resolve(dataFile)), profilesRoot = path.join(root, 'profiles');
  const now = () => Date.parse(clock());
  const registry = createRegistry(path.join(root, 'accounts.sqlite'), { clock: now });
  const configFile = path.join(root, 'hosted-auth.json');
  let config = null, configError = false, active = null, session = null, generation = 0, restoring = null, closed = false;
  try {
    if (fs.existsSync(configFile)) config = validateConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')));
    else if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) config = validateConfig({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  } catch { configError = true; }
  const provider = () => {
    if (!config) throw Object.assign(new Error('Connect the hosted account service first, or continue with a local profile.'), { status: 503 });
    return createHostedAuth(config, { ...authOptions, clock: now });
  };
  const safeProfile = profile => ({ id: profile.id, kind: profile.kind, name: profile.name, email: profile.email || null, onboardingComplete: profile.onboardingComplete });
  function fileFor(profile) {
    if (profile.id === 'local') return dataFile;
    if (!/^[0-9a-f-]{36}$/i.test(profile.id)) throw invalid('Invalid profile.');
    const directory = path.resolve(profilesRoot, profile.id);
    if (!directory.startsWith(path.resolve(profilesRoot) + path.sep)) throw invalid('Invalid profile path.');
    if (fs.existsSync(directory) && !fs.realpathSync(directory).startsWith(path.resolve(profilesRoot) + path.sep)) throw invalid('Profile storage must remain inside this device workspace.');
    return path.join(directory, 'calendar.sqlite');
  }
  function assertActive(context, allowExpiredToken = false) {
    if (!context.active || active !== context || !session || session.context !== context || session.expiresAt <= now() || (!allowExpiredToken && context.tokens && context.tokens.expiresAt <= now())) throw ended();
  }
  function deactivate({ forget = false } = {}) {
    generation++;
    const previous = active; active = null; session = null;
    if (previous) {
      previous.active = false; previous.controller.abort();
      try { previous.service?.close(); } catch { /* A stopped integration cannot extend a session. */ }
      try { previous.rawStore.close(); } catch { /* Closing is idempotent at the manager boundary. */ }
    }
    if (forget) vault?.clear();
    onChange(null);
  }
  function remember(context, wanted) {
    if (!wanted || !context.tokens) return;
    if (!vault?.available()) throw invalid('Secure OS storage is unavailable. Clear Keep me signed in to continue.');
    vault.write({ profileId: context.profile.id, issuer: context.tokens.identity.issuer, refreshToken: context.tokens.refreshToken });
  }
  function activate(profile, tokens = null, remembered = false) {
    const file = fileFor(profile), context = { profile, tokens, remembered, active: true, controller: new AbortController(), analysisRunning: false, verifiedAt: now() };
    context.env = profile.id === 'local' ? { ...env } : {};
    if (profile.providerChoice) context.env.AI_PROVIDER = profile.providerChoice;
    context.credentials = credentialsFactory?.({ file: path.join(path.dirname(file), profile.id === 'local' ? 'profile-credentials.encrypted' : 'credentials.encrypted'), env: context.env });
    context.credentials?.load();
    context.rawStore = createStore(file, { profileId: profile.id, seedDemo: false, ...(profile.id === 'local' ? {} : { legacyFile: path.join(path.dirname(file), 'never-auto-import.json') }) });
    active = context;
    const token = crypto.randomBytes(32).toString('hex');
    session = { hash: hash(token), context, expiresAt: now() + 24 * 3600000 };
    context.store = new Proxy(context.rawStore, { get(target, key) {
      const value = target[key];
      return typeof value === 'function' ? (...args) => { assertActive(context); return value.apply(target, args); } : value;
    } });
    try {
      remember(context, remembered);
      context.service = createIntegrations(context.store, { env: context.env, clock, ...authOptions.integrationOptions });
      context.telemetry = createTelemetry({ directory: path.join(path.dirname(file), 'telemetry') });
      context.app = buildApp({ store: context.store, apiToken, allowedOrigins, clock, integrations: context.service, integrationOptions: { env: context.env }, telemetry: context.telemetry });
      onChange(context.store);
      return { token, context };
    } catch (error) { deactivate(); throw error; }
  }
  function tokenFrom(req) {
    const header = req.get(SESSION_HEADER);
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (header && cookie && header !== cookie) return null;
    const token = header || cookie;
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  function authenticated(req) {
    const token = tokenFrom(req);
    if (session?.expiresAt <= now()) deactivate();
    if (!token || !session) return null;
    if (!crypto.timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(session.hash, 'hex'))) return null;
    return session.context;
  }
  function setSession(res, result) {
    res.setHeader(SESSION_HEADER, result?.token || '');
    res.setHeader('Set-Cookie', `${COOKIE}=${result?.token || ''}; HttpOnly; SameSite=Strict; Path=/api${result ? '' : '; Max-Age=0'}`);
  }
  function status(context) {
    return { provider: { configured: Boolean(config), projectUrl: config?.url || null, configurationError: configError },
      secureStorage: Boolean(vault?.available()), localProfiles: registry.locals().map(profile => ({ ...safeProfile(profile), hasData: fs.existsSync(fileFor(profile)) })),
      session: context?.active ? safeProfile(context.profile) : null,
      ...(context?.active ? { usage: { ...registry.usage(context.profile.id), limit: context.store.getSettings().dailyAiRequestLimit },
        setup: context.credentials?.status() || { secureStorage: false, configured: {} }, preferences: context.store.getSettings(),
        existingServices: require('../journalAnalyzer.cjs').getPublicProviderConfig(context.store.getSettings(), context.env) } : {}) };
  }
  async function fresh(context) {
    assertActive(context, true);
    if (!context.tokens) return;
    if (context.refreshing) return context.refreshing;
    if (context.tokens.expiresAt > now() + 60000 && context.verifiedAt > now() - 5 * 60000) return;
    context.refreshing = (async () => {
      try {
        if (context.tokens.expiresAt <= now() + 60000) {
          const next = await provider().refresh(context.tokens.refreshToken);
          assertActive(context, true);
          if (next.identity.issuer !== context.profile.issuer || next.identity.subject !== context.profile.subject) throw ended();
          context.tokens = next; remember(context, context.remembered);
        } else { await provider().verify(context.tokens); assertActive(context); }
        context.verifiedAt = now();
      } catch { if (active === context) deactivate({ forget: true }); throw ended(); }
    })();
    try { await context.refreshing; } finally { context.refreshing = null; }
  }
  function startAnalysis(context, settings) {
    assertActive(context);
    if (context.analysisRunning) throw Object.assign(new Error('An analysis is already running for this profile.'), { status: 429 });
    const effective = require('../journalAnalyzer.cjs').getPublicProviderConfig(settings, context.env).effectiveAiProvider;
    if (effective !== 'local' && context.env[effective.toUpperCase() + '_API_KEY']) registry.reserve(context.profile.id, Math.min(100, settings.dailyAiRequestLimit || 10));
    context.analysisRunning = true;
    return () => { context.analysisRunning = false; };
  }
  async function signInResult(tokens, remembered, expectedGeneration) {
    if (generation !== expectedGeneration) throw ended();
    const profile = registry.account(tokens.identity);
    return activate(profile, tokens, remembered);
  }
  async function restore() {
    if (restoring) return restoring;
    const expectedGeneration = generation;
    restoring = (async () => {
      const saved = vault?.read();
      if (!saved || !config || saved.issuer !== config.url + '/auth/v1') return null;
      const tokens = await provider().refresh(saved.refreshToken);
      if (generation !== expectedGeneration || active) throw ended();
      const profile = registry.get(saved.profileId);
      if (!profile || profile.kind !== 'account' || profile.issuer !== tokens.identity.issuer || profile.subject !== tokens.identity.subject) throw ended();
      return activate(registry.account(tokens.identity), tokens, true);
    })();
    try { return await restoring; } catch { vault?.clear(); throw ended(); } finally { restoring = null; }
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(localApiSecurity(apiToken, allowedOrigins));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); if (['POST', 'PUT'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object body is required.' }); next(); });
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'study-calendar-api' }));
  app.get('/api/auth/status', async (req, res) => { const context = authenticated(req); if (context) await fresh(context); res.json(status(context)); });
  app.post('/api/auth/configure', (req, res) => {
    if (active) throw conflict('Sign out before changing the account service.');
    const next = validateConfig(req.body);
    fs.mkdirSync(root, { recursive: true });
    const temporary = configFile + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, configFile); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    config = next; configError = false; generation++; vault?.clear();
    res.json(status(null));
  });
  app.post('/api/auth/local', (req, res) => {
    const profile = req.body.profileId ? registry.get(req.body.profileId) : req.body.create ? registry.createLocal(req.body.name) : registry.get('local');
    if (!profile || profile.kind !== 'local') throw invalid('Choose a local profile. Account workspaces require sign-in.');
    deactivate({ forget: true });
    const result = activate(profile); setSession(res, result); res.json(status(result.context));
  });
  app.post('/api/auth/login', async (req, res) => {
    if (Object.keys(req.body).some(key => !['email', 'password', 'remember'].includes(key))) throw invalid('Unsupported sign-in field.');
    registry.attempt(req.body.email); deactivate({ forget: true }); const expected = generation;
    const tokens = await provider().signIn(req.body);
    const result = await signInResult(tokens, req.body.remember === true, expected);
    setSession(res, result); res.json(status(result.context));
  });
  app.post('/api/auth/signup', async (req, res) => {
    registry.attempt(req.body.email); deactivate({ forget: true }); const expected = generation;
    const data = await provider().signUp(req.body);
    if (generation !== expected) throw ended();
    if (!data.tokens) return res.status(202).json({ confirmationRequired: true, message: 'Check your email to confirm your account, then sign in.' });
    const result = await signInResult(data.tokens, req.body.remember === true, expected);
    setSession(res, result); res.status(201).json(status(result.context));
  });
  for (const [route, method] of [['confirm', 'confirmEmail'], ['resend', 'resendEmail'], ['reset-request', 'requestReset']]) app.post('/api/auth/' + route, async (req, res) => {
    registry.attempt(req.body.email); await provider()[method](req.body); res.json({ message: route === 'confirm' ? 'Email confirmed. You can sign in.' : 'If this address can receive account email, check its inbox.' });
  });
  app.post('/api/auth/recover', async (req, res) => {
    registry.attempt(req.body.email); deactivate({ forget: true }); const expected = generation;
    await provider().recoverPassword(req.body);
    if (generation !== expected) throw ended();
    setSession(res, null); res.json({ message: 'Password updated. Sign in with your new password.' });
  });
  app.post('/api/auth/restore', async (_req, res) => { if (active) throw conflict('A workspace is already open.'); const result = await restore(); setSession(res, result); res.json(status(result?.context)); });
  app.post('/api/auth/logout', async (req, res) => {
    if (active && !authenticated(req)) throw ended();
    const tokens = active?.tokens;
    deactivate({ forget: true }); setSession(res, null);
    if (tokens) await provider().revoke(tokens).catch(() => {});
    res.json({ signedOut: true });
  });
  app.use(async (req, res, next) => {
    const context = authenticated(req);
    if (!context) throw ended();
    await fresh(context);
    const originalJson = res.json.bind(res);
    res.json = body => {
      if (!context.active || active !== context) { res.status(401); return originalJson({ error: 'The previous workspace was closed. Open a profile or sign in again.' }); }
      return originalJson(body);
    };
    req.profileSession = { signal: context.controller.signal, assertCurrent: () => assertActive(context), startAnalysis: settings => startAnalysis(context, settings) };
    req.profileContext = context;
    next();
  });
  app.get('/api/account/services', (req, res) => res.json(req.profileContext.credentials?.status() || { secureStorage: false, configured: {} }));
  function reactivate(context, res) {
    const { profile, tokens, remembered } = context;
    deactivate();
    const result = activate(registry.get(profile.id), tokens, remembered); setSession(res, result);
    return result;
  }
  app.post('/api/account/services', (req, res) => {
    const context = req.profileContext;
    if (!context.credentials) throw conflict('Open the desktop app to save service credentials securely.');
    context.credentials.save(req.body);
    // The response intentionally rotates the session; bypass the previous-context response guard.
    const payload = { ...context.credentials.status(), sessionChanged: true, restartRequired: false };
    const originalJson = express.response.json;
    reactivate(context, res); originalJson.call(res, payload);
  });
  app.post('/api/account/onboarding', (req, res) => {
    const context = req.profileContext, input = req.body;
    const preferences = { timezone: input.timezone, defaultAvailability: input.defaultAvailability, planningLeadMinutes: input.planningLeadMinutes ?? 5, aiProvider: input.aiProvider || 'local' };
    if (!['local', 'glm', 'openai', 'groq', 'gemini'].includes(preferences.aiProvider)) throw invalid('Choose a supported AI service.');
    if (!Number.isInteger(preferences.planningLeadMinutes) || preferences.planningLeadMinutes < 1 || preferences.planningLeadMinutes > 120) throw invalid('Review time must be 1–120 minutes.');
    require('../contracts/validate.cjs').assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [], plan: { id: 'onboarding', state: 'proposal', timezone: preferences.timezone, targetDate: '2030-01-01', availability: preferences.defaultAvailability, bufferMinutes: 15, blocks: [], unscheduled: [], warnings: [] } });
    if (input.services) {
      if (!context.credentials) throw conflict('Use local rules or open the desktop app for secure service setup.');
      context.credentials.save({ ...input.services, AI_PROVIDER: preferences.aiProvider });
      context.credentials.load();
    }
    if (preferences.aiProvider !== 'local' && !context.env[preferences.aiProvider.toUpperCase() + '_API_KEY']) throw invalid('Connect the selected AI service or choose local rules.');
    context.store.updateSettings(preferences);
    registry.put({ ...context.profile, onboardingComplete: true, providerChoice: preferences.aiProvider });
    const result = reactivate(context, res); express.response.json.call(res, status(result.context));
  });
  app.post('/api/account/import-local', (req, res) => {
    const context = req.profileContext, source = registry.get(req.body.sourceId || 'local');
    if (context.profile.kind !== 'account' || req.body.confirm !== true || !source || source.kind !== 'local') throw invalid('Confirm copying a local profile into this signed-in workspace.');
    const file = fileFor(source);
    if (!fs.existsSync(file)) throw conflict('That local workspace has no saved data yet.');
    const snapshot = require('./portable.cjs').readSnapshot(file, source.id);
    res.json({ copied: context.store.importPortable(snapshot), originalPreserved: true });
  });
  app.get('/api/account/export', (req, res) => res.json(req.profileContext.store.portableSnapshot()));
  app.get('/api/account/status', (req, res) => res.json(status(req.profileContext)));
  app.post('/api/account/remove-local-data', async (req, res) => {
    const context = req.profileContext, profile = context.profile, tokens = context.tokens;
    if (profile.id === 'local') throw conflict('The original local profile is preserved. Export it and use your operating system to manage its files.');
    if (req.body.confirmName !== profile.name) throw invalid('Type the workspace name to confirm removal from this device.');
    const directory = path.dirname(fileFor(profile));
    if (!directory.startsWith(path.resolve(profilesRoot) + path.sep) || directory === path.resolve(profilesRoot)) throw invalid('Invalid profile path.');
    deactivate({ forget: true }); setSession(res, null);
    fs.rmSync(directory, { recursive: true, force: true }); registry.remove(profile.id);
    if (tokens) await provider().revoke(tokens).catch(() => {});
    express.response.json.call(res, { removedFromDevice: true, hostedAccountUnchanged: profile.kind === 'account' });
  });
  app.use((req, res, next) => req.profileContext.app(req, res, next));
  app.use((error, _req, res, _next) => { if (res.headersSent) return; res.status(error.status || 500).json({ error: error.status && error.status < 500 ? error.message : 'The account operation could not be completed. Try again.' }); });
  return { app, restore, get store() { return active?.store || null; },
    close() { if (closed) return; closed = true; deactivate(); registry.close(); },
    setupStatus(token) { const req = { get: key => key === SESSION_HEADER ? token : undefined, headers: {} }; const context = authenticated(req); if (!context) throw ended(); return context.credentials?.status() || { secureStorage: false, configured: {} }; }
  };
}
module.exports = { createProfileGateway, SESSION_HEADER };
