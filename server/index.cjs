const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { loadEnvironment } = require("./environment.cjs");
const { localApiSecurity } = require("./security.cjs");
const { createTelemetry } = require("./observability.cjs");
const { loadSkills } = require("./agent/skills.cjs");
const { createStore } = require("./store.cjs");
const { createIntegrations, routes: integrationRoutes } = require("./integrations/service.cjs");
const { analyzeJournal, getPublicProviderConfig } = require("./journalAnalyzer.cjs");
const { assertBundle, assertSchema, ContractError, isInstant, isCalendarDate, isTimezone } = require("./contracts/validate.cjs");
const { assertAnalysis, assertEvidenceCurrent, projectContract } = require("./contracts/analysis.cjs");
const { localParts } = require("./contracts/time.cjs");
const { scheduleAnalysis, assertScheduleCurrent, assertLegacyDraftsCurrent, planningRange } = require("./scheduler.cjs");

const VALID_TYPES = new Set(["personal", "study", "vacation", "holiday", "birthday", "other"]);
const VALID_REPEAT = new Set(["none", "daily", "weekly", "monthly", "yearly"]);
const VALID_JOURNAL_TYPES = new Set(["daily", "weekly"]);

function isIsoDate(value) {
  return typeof value === "string" && isInstant(value);
}

function isDateOnly(value) {
  return typeof value === "string" && isCalendarDate(value);
}

function validateEventPayload(payload, { partial = false } = {}) {
  const errors = [];
  const requireField = (field) => {
    if (!partial && payload[field] === undefined) errors.push(`${field} is required`);
  };

  ["title", "startsAt", "endsAt", "calendarType", "notificationFormat"].forEach(requireField);

  if (payload.title !== undefined && (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 500)) errors.push("title must be a nonempty string of at most 500 characters");
  if (payload.startsAt !== undefined && !isIsoDate(payload.startsAt)) errors.push("startsAt must be an ISO date string");
  if (payload.endsAt !== undefined && !isIsoDate(payload.endsAt)) errors.push("endsAt must be an ISO date string");
  if (isIsoDate(payload.startsAt) && isIsoDate(payload.endsAt) && new Date(payload.endsAt) <= new Date(payload.startsAt)) errors.push("endsAt must be after startsAt");
  if (payload.calendarType !== undefined && !VALID_TYPES.has(payload.calendarType)) errors.push(`calendarType must be one of ${Array.from(VALID_TYPES).join(", ")}`);
  if (payload.repeat !== undefined && !VALID_REPEAT.has(payload.repeat)) errors.push(`repeat must be one of ${Array.from(VALID_REPEAT).join(", ")}`);
  if (payload.recurrenceTimezone !== undefined && !isTimezone(payload.recurrenceTimezone)) errors.push("recurrenceTimezone must be a named timezone");
  if (payload.notifyMinutesBefore !== undefined && (!Number.isInteger(payload.notifyMinutesBefore) || payload.notifyMinutesBefore < 0 || payload.notifyMinutesBefore > 10080)) errors.push("notifyMinutesBefore must be an integer between 0 and 10080");
  for (const field of ["notificationFormat", "location", "notes", "color"]) {
    if (payload[field] !== undefined && typeof payload[field] !== "string") errors.push(`${field} must be a string`);
  }

  return errors;
}

function validateJournalPayload(payload, { partial = false } = {}) {
  const errors = [];
  const requireField = (field) => {
    if (!partial && payload[field] === undefined) errors.push(`${field} is required`);
  };

  ["type", "journalDate", "title", "content"].forEach(requireField);

  if (payload.type !== undefined && !VALID_JOURNAL_TYPES.has(payload.type)) errors.push("type must be daily or weekly");
  if (payload.journalDate !== undefined && !isDateOnly(payload.journalDate)) errors.push("journalDate must be YYYY-MM-DD");
  if (payload.title !== undefined && (typeof payload.title !== "string" || !payload.title.trim())) errors.push("title must be a nonempty string");
  if (payload.content !== undefined && (typeof payload.content !== "string" || !payload.content.trim())) errors.push("content must be a nonempty string");
  if (payload.tags !== undefined && (!Array.isArray(payload.tags) || payload.tags.some((tag) => typeof tag !== "string"))) errors.push("tags must be strings");
  if (payload.bookmarked !== undefined && typeof payload.bookmarked !== "boolean") errors.push("bookmarked must be a boolean");

  return errors;
}

function normalizeEvent(payload, existing = {}) {
  const now = new Date().toISOString();
  return {
    ...existing,
    ...payload,
    title: String(payload.title ?? existing.title ?? "").trim(),
    calendarType: payload.calendarType ?? existing.calendarType ?? "personal",
    location: payload.location ?? existing.location ?? "",
    notes: payload.notes ?? existing.notes ?? "",
    color: payload.color ?? existing.color ?? "#2563eb",
    notifyMinutesBefore: Number(payload.notifyMinutesBefore ?? existing.notifyMinutesBefore ?? 15),
    notificationFormat: payload.notificationFormat ?? existing.notificationFormat ?? "Desktop notification",
    repeat: payload.repeat ?? existing.repeat ?? "none",
    createdAt: existing.createdAt ?? now,
    updatedAt: now
  };
}

function normalizeJournal(payload, existing = {}) {
  const now = new Date().toISOString();
  return {
    ...existing,
    ...payload,
    type: payload.type ?? existing.type ?? "daily",
    journalDate: payload.journalDate ?? existing.journalDate ?? now.slice(0, 10),
    title: String(payload.title ?? existing.title ?? "Untitled journal").trim(),
    content: String(payload.content ?? existing.content ?? "").trim(),
    bookmarked: Boolean(payload.bookmarked ?? existing.bookmarked ?? false),
    tags: Array.isArray(payload.tags) ? payload.tags : existing.tags || [],
    createdAt: existing.createdAt ?? now,
    updatedAt: now
  };
}

function createApp({ store, apiToken, allowedOrigins = [], clock = () => new Date().toISOString(), integrations, integrationOptions = {}, telemetry = createTelemetry() }) {
  const app = express();
  const service = integrations || createIntegrations(store, { ...integrationOptions, clock });
  app.locals.closeIntegrations = () => service.close();
  app.disable("x-powered-by");
  app.use(telemetry.middleware);
  app.use(localApiSecurity(apiToken, allowedOrigins));
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    if (["POST", "PUT"].includes(req.method) && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
      return res.status(400).json({ error: "A JSON object body is required" });
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "study-calendar-api" });
  });

  app.get('/api/diagnostics', (_req, res) => {
    let database;
    try { database = store.health(); } catch { database = { ready: false, schemaVersion: null }; }
    let sync = null, connected = false, provider = getPublicProviderConfig();
    if (database.ready) {
      try { sync = store.integrationState('googleSync'); connected = Boolean(store.integrationState('googleTokens')); provider = getPublicProviderConfig(store.getSettings()); }
      catch { database = { ready: false, schemaVersion: database.schemaVersion }; }
    }
    const googleCacheStale = connected && (!sync?.syncedAt || !sync?.calendarIds?.length || Date.parse(sync.syncedAt) < Date.parse(clock()) - 30 * 60000);
    const snapshot = telemetry.snapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.status(database.ready ? 200 : 503).json({ version: 1, ready: database.ready, database,
      appVersion: require('../package.json').version, promptVersion: loadSkills().promptVersion,
      provider, googleCacheStale, telemetry: snapshot,
      alerts: [...snapshot.alerts, ...(!database.ready ? ['database_unavailable'] : []), ...(googleCacheStale ? ['google_cache_needs_sync'] : [])] });
  });

  integrationRoutes(app, store, service, clock);

  app.get("/api/time", (_req, res) => {
    const now = new Date();
    res.json({
      now: now.toISOString(),
      localTime: now.toLocaleTimeString(),
      localDate: now.toLocaleDateString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    });
  });

  app.get("/api/settings", (_req, res) => {
    const settings = store.getSettings();
    res.json({ ...settings, ...getPublicProviderConfig(settings), aiProviderConfigured: getConfiguredProviders() });
  });

  app.put("/api/settings", (req, res) => {
    const allowed = ["timezone", "locale", "weekStartsOn", "defaultNotifyMinutesBefore", "aiProvider", "dailyAiRequestLimit", "defaultAvailability"];
    const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (patch.timezone !== undefined || patch.defaultAvailability !== undefined) {
      const settings = { ...store.getSettings(), ...patch };
      assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [], plan: {
        id: "settings", state: "proposal", timezone: settings.timezone, targetDate: "2026-01-01", bufferMinutes: 15,
        availability: settings.defaultAvailability, blocks: [], unscheduled: [], warnings: []
      } });
    }
    const updated = store.updateSettings(patch);
    res.json({ ...updated, ...getPublicProviderConfig(updated), aiProviderConfigured: getConfiguredProviders() });
  });

  app.get("/api/events", (req, res) => {
    if ([req.query.from, req.query.to].some((value) => value !== undefined && !isIsoDate(value))) return res.status(400).json({ error: "Invalid date range" });
    const local = store.listEvents({ from: req.query.from, to: req.query.to });
    const imported = req.query.includeGoogle === 'true' ? store.googleBusy({ from: req.query.from || '0001-01-01T00:00:00Z', to: req.query.to || '9999-12-31T23:59:59Z' }) : [];
    if (req.query.expand === 'true') return res.json(require('./calendarView.cjs').listCalendarOccurrences(store, { from: req.query.from, to: req.query.to, timezone: store.getSettings().timezone, includeGoogle: req.query.includeGoogle === 'true' }));
    res.json([...local, ...imported].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
  });

  app.post("/api/events", (req, res) => {
    const errors = validateEventPayload(req.body);
    if (errors.length > 0) return res.status(400).json({ errors });

    const event = { ...normalizeEvent(editableEvent(req.body)), id: crypto.randomUUID() };
    if (event.repeat !== "none" && !event.recurrenceTimezone) event.recurrenceTimezone = store.getSettings().timezone;
    res.status(201).json(store.createEvent(event));
  });

  app.put("/api/events/:id", (req, res) => {
    const current = store.getEvent(req.params.id);
    if (!current) return res.status(404).json({ error: "Event not found" });
    const errors = validateEventPayload({ ...current, ...editableEvent(req.body) });
    if (errors.length > 0) return res.status(400).json({ errors });

    const patch = editableEvent(req.body);
    if ((patch.repeat ?? current.repeat) !== "none" && !patch.recurrenceTimezone && !current.recurrenceTimezone) patch.recurrenceTimezone = store.getSettings().timezone;
    if (patch.title !== undefined) patch.title = String(patch.title).trim();
    if (patch.notifyMinutesBefore !== undefined) patch.notifyMinutesBefore = Number(patch.notifyMinutesBefore);
    const event = store.updateEvent(req.params.id, patch);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  });

  app.delete("/api/events/:id", (req, res) => {
    const deleted = store.deleteEvent(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Event not found" });
    res.status(204).send();
  });

  app.get("/api/journals", (req, res) => {
    const bookmarked = req.query.bookmarked === undefined ? undefined : req.query.bookmarked === "true";
    res.json(store.listJournals({ type: req.query.type, bookmarked }));
  });

  app.post("/api/journals", (req, res) => {
    const errors = validateJournalPayload(req.body);
    if (errors.length > 0) return res.status(400).json({ errors });

    const journal = { ...normalizeJournal(editableJournal(req.body)), id: crypto.randomUUID() };
    res.status(201).json(store.createJournal(journal));
  });

  app.put("/api/journals/:id", (req, res) => {
    const errors = validateJournalPayload(req.body, { partial: true });
    if (errors.length > 0) return res.status(400).json({ errors });

    const journal = store.updateJournal(req.params.id, normalizeJournal(editableJournal(req.body), store.getJournal(req.params.id) || {}));
    if (!journal) return res.status(404).json({ error: "Journal not found" });
    res.json(journal);
  });

  app.delete("/api/journals/:id", (req, res) => {
    const deleted = store.deleteJournal(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Journal not found" });
    res.status(204).send();
  });

  app.get("/api/journals/:id/analysis", (req, res) => {
    const analysis = store.getJournalAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    res.json({ ...analysis, contractStatus: analysis.contract ? "versioned" : "legacy", applied: Boolean(store.getAppliedBatch(analysis.id)) });
  });

  app.post("/api/journals/:id/apply-drafts", (req, res) => {
    if (typeof req.body.analysisId !== "string" || !req.body.analysisId) return res.status(400).json({ error: "analysisId is required" });
    if (!store.getJournal(req.params.id)) return res.status(404).json({ error: "Journal not found" });
    const result = store.applyAnalysis(req.params.id, req.body.analysisId, (analysis) => {
      let drafts = analysis.scheduleDrafts;
      if (analysis.contract !== undefined) {
        assertAnalysis(analysis);
        // This runs under the batch writer lock, including checks on related journal evidence.
        assertEvidenceCurrent(analysis.contract, store.getJournal);
        store.assertCalendarCoverage(planningRange(analysis.contract.plan), clock());
        drafts = projectContract(analysis.contract).scheduleDrafts;
        assertScheduleCurrent(analysis, store.listPlanningEvents(planningRange(analysis.contract.plan)), store.getSettings(), clock());
      }
      if (!Array.isArray(drafts) || !drafts.length || drafts.length > 100) {
        throw Object.assign(new Error("Analysis must contain between 1 and 100 drafts"), { status: 400 });
      }
      const events = drafts.map((draft, index) => {
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw Object.assign(new Error(`Draft ${index + 1} is invalid`), { status: 400 });
        const payload = {
          title: draft.title, startsAt: draft.startsAt, endsAt: draft.endsAt,
          calendarType: draft.calendarType || "study", location: "",
          notes: typeof draft.rationale === "string" ? draft.rationale : "Created from journal analysis draft.",
          color: draft.calendarType === "study" ? "#16a34a" : "#2563eb",
          notifyMinutesBefore: draft.notifyMinutesBefore ?? 15,
          notificationFormat: draft.notificationFormat || "Desktop notification", repeat: "none"
        };
        const errors = validateEventPayload(payload);
        if (errors.length) throw Object.assign(new Error(`Draft ${index + 1}: ${errors.join(", ")}`), { status: 400 });
        return { ...normalizeEvent(payload), id: crypto.randomUUID(), sourceAnalysisId: analysis.id,
          ...(analysis.contract ? { sourceTaskId: draft.taskId, sourceEstimateId: draft.estimateId, planningSchemaVersion: analysis.contract.schemaVersion } : {}) };
      });
      if (!analysis.contract) assertLegacyDraftsCurrent(events, store.listPlanningEvents({
        from: new Date(Math.min(...events.map((event) => Date.parse(event.startsAt)))).toISOString(),
        to: new Date(Math.max(...events.map((event) => Date.parse(event.endsAt)))).toISOString()
      }), store.getSettings().timezone);
      return events;
    });
    res.status(result.replayed ? 200 : 201).json(result);
  });

  app.post("/api/journals/:id/analyze", async (req, res) => {
    const journal = store.getJournal(req.params.id);
    if (!journal) return res.status(404).json({ error: "Journal not found" });

    const settings = store.getSettings();
    const asOf = clock();
    if (!isTimezone(settings.timezone)) throw new ContractError([{ path: "/settings/timezone", code: "timezone", message: "Configure a valid named timezone" }]);
    const today = localParts(Date.parse(asOf), settings.timezone).date;
    // Historical journals inform future work. A request can explicitly select another date.
    const targetDate = req.body.targetDate !== undefined ? req.body.targetDate : journal.journalDate > today ? journal.journalDate : today;
    const availability = req.body.availability !== undefined ? req.body.availability : settings.defaultAvailability;
    const inputPlan = { id: "input", state: "proposal", timezone: settings.timezone, targetDate, availability,
      bufferMinutes: 15, blocks: [], unscheduled: [], warnings: [] };
    assertSchema("plan", inputPlan);
    assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [], plan: inputPlan });
    store.assertCalendarCoverage(planningRange(inputPlan), asOf);
    const existingEvents = store.listPlanningEvents(planningRange(inputPlan));
    const relatedJournals = store.listJournals({ type: journal.type === "daily" ? "weekly" : undefined }).filter((item) => item.id !== journal.id).slice(0, 5);
    const interpreted = await analyzeJournal({
      ...service.context(req.body, journal, settings),
      observe: req.observe,
      journal,
      relatedJournals,
      settings,
      availability, targetDate, existingEvents, notBefore: asOf
    });
    const result = scheduleAnalysis(interpreted, { events: existingEvents, settings, notBefore: asOf,
      availabilitySource: req.body.availability !== undefined ? "request" : "settings" });
    const analysis = {
      ...result,
      id: crypto.randomUUID(),
      journalId: journal.id,
      createdAt: new Date().toISOString()
    };
    assertAnalysis(analysis);
    // Reject a result if its source was edited or deleted while the provider ran.
    const current = store.getJournal(journal.id);
    if (!current || current.updatedAt !== journal.updatedAt) return res.status(409).json({ error: "Journal changed during analysis; try again" });
    assertScheduleCurrent(analysis, store.listPlanningEvents(planningRange(analysis.contract.plan)), store.getSettings(), clock());
    res.status(201).json(store.saveJournalAnalysis(analysis));
  });

  app.use((error, req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({ error: status < 500 ? error.message : "Internal server error", requestId: req.traceId,
      ...(status === 422 && Array.isArray(error.issues) ? { issues: error.issues } : {}) });
  });

  return app;
}

function getConfiguredProviders() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    glm: Boolean(process.env.GLM_API_KEY),
    local: true
  };
}

function startServer(options = {}) {
  if (options.envFile !== false) loadEnvironment(options.envFile);
  const { port = process.env.PORT || 4010, dataFile = process.env.CALENDAR_DB_PATH || path.join(__dirname, "data", "calendar.sqlite"),
    apiToken = process.env.LOCAL_API_TOKEN, allowedOrigins = [], legacyFile } = options;
  // Authenticate before opening a database so a configuration error has no side effects.
  const { validateToken } = require("./security.cjs");
  validateToken(apiToken);
  const store = createStore(dataFile, { legacyFile });
  const telemetry = options.telemetry || createTelemetry({ directory: dataFile === ':memory:' ? null : path.join(path.dirname(path.resolve(dataFile)), 'telemetry') });
  const app = createApp({ store, apiToken, allowedOrigins, telemetry });
  const server = app.listen(Number(port), "127.0.0.1", () => {
    console.log(`Study Calendar API listening on http://127.0.0.1:${server.address().port}`);
  });
  server.on("close", () => { app.locals.closeIntegrations(); store.close(); });
  server.on("error", (error) => { app.locals.closeIntegrations(); store.close(); console.error(`Local API startup failed: ${error.code}`); });
  return server;
}

function pick(payload, fields) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => fields.includes(key)));
}
function editableEvent(payload) {
  return pick(payload, ["title", "startsAt", "endsAt", "calendarType", "location", "notes", "color", "notifyMinutesBefore", "notificationFormat", "repeat", "recurrenceTimezone"]);
}
function editableJournal(payload) {
  return pick(payload, ["type", "journalDate", "title", "content", "bookmarked", "tags"]);
}

if (require.main === module) startServer();

module.exports = { createApp, startServer, validateEventPayload, validateJournalPayload, normalizeEvent, normalizeJournal };
