const crypto = require('node:crypto');
const { createActivity } = require('./activity.cjs');
const { createGoogle } = require('./google.cjs');
const { createMemory } = require('./memory.cjs');
const { createResearch } = require('./research.cjs');
const { error } = require('./common.cjs');
const { wallClockInstant, nextDate } = require('../contracts/time.cjs');
function createIntegrations(store, options = {}) {
  const activity = createActivity(store, options), google = createGoogle(store, options), memory = createMemory(store, options), research = createResearch(options);
  const clock = options.clock || (() => new Date().toISOString());
  store.expireActivity(clock());
  const retention = setInterval(() => {
    try { store.expireActivity(clock()); } catch { console.warn('Activity retention cleanup failed; will retry next hour.'); }
  }, 3600000); retention.unref();
  return { activity, google, memory, research, close: () => { clearInterval(retention); google.close(); },
    status: () => ({ activity: { ...store.integrationState('activity'), endpoint: 'http://127.0.0.1:5600', installedRequired: true },
      google: google.status(), memory: { model: memory.model, chunks: store.memoryChunks().length, embedded: store.memoryChunks().filter((c) => c.embedding && c.embeddingModel === memory.model).length },
      research: { configured: research.configured, provider: 'Brave Search', confidence: 'low', claimStatus: 'snippet_only' } }),
    context(input, journal, settings) {
      for (const key of ['includeActivity', 'allowMemory', 'allowWebResearch']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw error(`${key} must be a boolean`);
      const supplementalEvidence = input.includeActivity ? activity.evidence({ from: wallClockInstant(journal.journalDate, '00:00', settings.timezone), to: wallClockInstant(nextDate(journal.journalDate), '00:00', settings.timezone) }) : [];
      return { supplementalEvidence,
        memorySearch: input.allowMemory ? (args, signal) => memory.search(args, signal) : null,
        webResearch: input.allowWebResearch ? (args, signal) => research.search({ ...args, consent: true }, signal) : null };
    }
  };
}
function routes(app, store, service, clock) {
  app.get('/api/integrations/status', (_req, res) => res.json(service.status()));
  app.get('/api/integrations/activity/buckets', async (_req, res) => res.json(await service.activity.buckets()));
  app.post('/api/integrations/activity/import', async (req, res) => res.json(await service.activity.ingest(req.body)));
  app.delete('/api/integrations/activity', (_req, res) => { service.activity.purge(); res.status(204).send(); });
  app.post('/api/integrations/google/connect', async (req, res) => res.json(await service.google.connect(req.body)));
  app.post('/api/integrations/google/cancel', (_req, res) => { service.google.cancel(); res.json({ cancelled: true }); });
  app.get('/api/integrations/google/calendars', async (_req, res) => res.json(await service.google.calendars()));
  app.post('/api/integrations/google/sync', async (req, res) => res.json(await service.google.sync(req.body)));
  app.delete('/api/integrations/google', async (_req, res) => res.json(await service.google.disconnect()));
  app.get('/api/memory', (_req, res) => res.json(store.listMemoryDocuments()));
  app.post('/api/memory', (req, res) => {
    const { title, content } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 300 || typeof content !== 'string' || !content.trim() || content.length > 12000) throw error('Memory requires a title (1–300 chars) and text (1–12000 chars)');
    res.status(201).json(store.putMemoryDocument({ id: `memory:${crypto.randomUUID()}`, title: title.trim(), content: content.trim(), updatedAt: clock() }));
  });
  app.delete('/api/memory/:id', (req, res) => { if (!store.deleteMemoryDocument(req.params.id)) throw error('Memory not found', 404); res.status(204).send(); });
  app.post('/api/memory/index', async (req, res) => res.json(await service.memory.index(req.body)));
  app.post('/api/memory/search', async (req, res) => res.json(await service.memory.search(req.body)));
  app.post('/api/research/search', async (req, res) => res.json(await service.research.search(req.body)));
}
module.exports = { createIntegrations, routes };
