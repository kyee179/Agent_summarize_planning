const crypto = require('node:crypto');
const { assertSchema, isInstant } = require('./contracts/validate.cjs');
const { contractAnalysis } = require('./contracts/analysis.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
const conflict = message => Object.assign(new Error(message), { status: 409 });
const invalid = message => Object.assign(new Error(message), { status: 400 });

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS durable_tasks (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    identity TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(profile_id,journal_id,identity));
    CREATE TABLE IF NOT EXISTS task_analyses (analysis_id TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE,
    PRIMARY KEY(analysis_id,task_id));
    CREATE TABLE IF NOT EXISTS task_sessions (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE, generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reminder_receipts (id TEXT PRIMARY KEY, delivered_at TEXT NOT NULL);
    PRAGMA user_version=3;`);
  // Adopt previously applied work without changing its calendar timestamps or replay receipts.
  const legacy = new Map();
  for (const row of db.prepare('SELECT e.data,b.journal_id FROM events e JOIN applied_batches b ON b.analysis_id=json_extract(e.data,\'$.sourceAnalysisId\')').all()) {
    const event = JSON.parse(row.data);
    if (!db.prepare('SELECT 1 FROM journals WHERE id=?').get(row.journal_id)) continue;
    const key = hash([event.sourceAnalysisId, event.sourceTaskId || event.title]);
    let item = legacy.get(key);
    if (!item) {
      item = { id: `task:${crypto.randomUUID()}`, profileId: 'local', journalId: row.journal_id, identity: `legacy:${key}`, sourceKey: null,
        title: event.title, status: 'open', confirmed: {}, revision: 1, generation: 0, createdAt: event.createdAt || new Date().toISOString() };
      db.prepare('INSERT INTO durable_tasks VALUES(?,?,?,?,?)').run(item.id, 'local', row.journal_id, item.identity, JSON.stringify(item));
      db.prepare('INSERT INTO task_analyses VALUES(?,?)').run(event.sourceAnalysisId, item.id);
      legacy.set(key, item);
    }
    db.prepare('INSERT INTO task_sessions VALUES(?,?,0)').run(event.id, item.id);
  }
}

// A database is one explicit local profile. Future login selects a different profile/database.
function attach(db, transaction) {
  const profile = 'local';
  const get = id => {
    if (typeof id !== 'string') return null;
    const row = db.prepare('SELECT data FROM durable_tasks WHERE id=? AND profile_id=?').get(id, profile);
    return row ? JSON.parse(row.data) : null;
  };
  const list = journalId => db.prepare('SELECT data FROM durable_tasks WHERE profile_id=? ORDER BY id').all(profile)
    .map(row => JSON.parse(row.data)).filter(item => !journalId || item.journalId === journalId);
  const put = item => db.prepare(`INSERT INTO durable_tasks VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
    .run(item.id, profile, item.journalId, item.identity, JSON.stringify(item));
  const sessions = item => db.prepare('SELECT event_id FROM task_sessions WHERE task_id=? AND generation=? ORDER BY event_id').all(item.id, item.generation).map(r => r.event_id);
  function assertCurrent(analysis) {
    for (const snapshot of analysis.taskRevisions || []) {
      const item = get(snapshot.id);
      if (!item || item.revision !== snapshot.revision || item.generation !== snapshot.generation || hash(sessions(item)) !== snapshot.sessionsHash)
        throw conflict('Task facts or scheduled sessions changed; generate and review a new plan');
    }
  }
  function reconcile(analysis) {
    const contract = structuredClone(analysis.contract), byId = new Map(contract.evidence.map(e => [e.id, e]));
    // Old confirmed evidence is replaced with a new revision-bound snapshot.
    contract.evidence = contract.evidence.filter(e => !(e.sourceType === 'user' && e.sourceId.startsWith('task:')));
    const mapping = new Map(), records = new Map(), revisions = [];
    const aliases = new Map(), unique = new Map();
    for (const task of contract.tasks) {
      const key = hash([normalize(task.title), [...task.evidenceIds].sort(), task.status, [...task.dependsOn].sort()]);
      const previous = unique.get(key);
      if (previous && JSON.stringify(previous.dependsOn) === JSON.stringify(task.dependsOn)) {
        aliases.set(task.id, previous.id); previous.evidenceIds = [...new Set([...previous.evidenceIds, ...task.evidenceIds])];
      } else unique.set(key, task);
    }
    const candidates = [...unique.values()].map(task => ({ task, sourceKey: hash(task.evidenceIds.map(id => byId.get(id)).filter(e => e?.sourceType === 'journal').map(e => normalize(e.excerpt)).sort()) }));
    contract.estimates = contract.estimates.filter(e => !aliases.has(e.taskId));
    const known = list(analysis.journalId), used = new Set();
    for (const { task, sourceKey } of candidates) {
      const identity = hash([sourceKey, normalize(task.title), [...task.dependsOn].sort()]);
      let item = known.find(t => !used.has(t.id) && t.identity === identity);
      const sameTitle = known.filter(t => !used.has(t.id) && normalize(t.title) === normalize(task.title));
      if (!item && sameTitle.length === 1 && candidates.filter(c => normalize(c.task.title) === normalize(task.title)).length === 1) item = sameTitle[0];
      const sameSource = known.filter(t => !used.has(t.id) && t.sourceKey === sourceKey);
      if (!item && sameSource.length === 1 && candidates.filter(t => t.sourceKey === sourceKey).length === 1) item = sameSource[0];
      if (!item) {
        const source = task.evidenceIds.map(id => byId.get(id)).find(e => e?.sourceType === 'journal');
        const sourceJournal = source ? JSON.parse(db.prepare('SELECT data FROM journals WHERE id=?').get(source.sourceId)?.data || '{}') : {};
        item = { id: `task:${crypto.randomUUID()}`, profileId: profile, journalId: analysis.journalId, identity, sourceKey,
          title: task.title, status: 'open', revision: 1, generation: 0, confirmed: {},
          candidates: require('./taskCandidates.cjs').candidates(source?.excerpt || task.description, { date: sourceJournal.journalDate, timezone: contract.plan.timezone }),
          ambiguousMatch: sameTitle.length > 1 || sameSource.length > 1,
          createdAt: analysis.createdAt || new Date().toISOString() };
        put(item); known.push(item);
      }
      mapping.set(task.id, item.id); records.set(item.id, item);
      used.add(item.id);
      revisions.push({ id: item.id, revision: item.revision, generation: item.generation, sessionsHash: hash(sessions(item)) });
      if (!analysis.id) throw Error('Persistent analysis needs an ID');
      db.prepare('INSERT OR IGNORE INTO task_analyses VALUES(?,?)').run(analysis.id, item.id);
    }
    for (const [alias, id] of aliases) mapping.set(alias, mapping.get(id));
    const estimates = new Map(contract.estimates.map(e => [e.taskId, e]));
    contract.tasks = candidates.map(({ task }) => {
      const id = mapping.get(task.id), item = records.get(id), confirmed = item.confirmed;
      const updated = { ...task, id, title: item.title, dependsOn: (confirmed.dependsOn ?? task.dependsOn.map(d => mapping.get(d))) };
      const previousEstimate = estimates.get(task.id);
      if (previousEstimate) { previousEstimate.taskId = id; previousEstimate.id = `estimate:${id.slice(5)}`; updated.estimateId = previousEstimate.id; }
      const facts = [];
      if (confirmed.status !== undefined) facts.push({ field: 'status', value: item.status });
      if (confirmed.deadline) facts.push({ field: 'deadline', value: confirmed.deadline.at });
      if (confirmed.effort) facts.push({ field: 'effort_minutes', value: confirmed.effort.minutes });
      if (confirmed.importance) facts.push({ field: 'importance', value: confirmed.importance });
      const evidenceId = `confirmed:${id.slice(5)}`;
      if (Object.keys(confirmed).length) {
        if (contract.evidence.length >= 100) throw invalid('Evidence budget is full; analyze a smaller journal before confirming facts');
        contract.evidence.push({ id: evidenceId, sourceType: 'user', sourceId: id, sourceVersion: String(item.revision), locator: null,
          excerpt: JSON.stringify(confirmed).slice(0, 4000), observedAt: new Date().toISOString(), sourceTimestamp: null, verification: 'user_confirmed', facts });
        updated.evidenceIds = [...new Set([...task.evidenceIds.filter(e => byId.get(e)?.sourceType !== 'user'), evidenceId])];
      }
      updated.status = confirmed.status ?? task.status;
      if (item.ambiguousMatch && !Object.keys(confirmed).length) {
        updated.status = 'blocked'; updated.clarificationQuestions = ['Multiple saved tasks may match this candidate. Review and confirm its identity before scheduling.'];
      }
      if (updated.dependsOn.some(d => !records.has(d))) {
        updated.dependsOn = updated.dependsOn.filter(d => records.has(d));
        if (!['completed', 'cancelled'].includes(updated.status)) {
          updated.status = 'blocked';
          updated.clarificationQuestions = ['A confirmed dependency is absent from this analysis. Include its source before scheduling this task.'];
        }
      }
      if (sessions(item).length && !['completed', 'cancelled'].includes(updated.status)) {
        updated.status = 'blocked';
        updated.clarificationQuestions = ['Already has a calendar session. Complete it, delete its event, or explicitly request another session.'];
      }
      if ('deadline' in confirmed) updated.deadline = confirmed.deadline ? { ...confirmed.deadline, evidenceIds: [evidenceId] } : null;
      if (confirmed.importance) updated.importance = { level: confirmed.importance, basis: 'user', reason: 'Confirmed by you.', evidenceIds: [evidenceId] };
      if ('effort' in confirmed) {
        if (!previousEstimate) { const e = { id: `estimate:${id.slice(5)}`, taskId: id }; contract.estimates.push(e); estimates.set(task.id, e); updated.estimateId = e.id; }
        const e = estimates.get(task.id);
        Object.assign(e, { scope: confirmed.effort?.scope || 'next_session', basis: confirmed.effort ? 'project_estimate' : 'unknown',
          effortMinutes: confirmed.effort ? { low: confirmed.effort.minutes, expected: confirmed.effort.minutes, high: confirmed.effort.minutes } : null,
          confidence: confirmed.effort ? 'medium' : 'unknown', evidenceIds: confirmed.effort ? [evidenceId] : [], assumptions: [], rationale: 'User-confirmed effort and scope.' });
      }
      return updated;
    });
    // Clear the old allocations before validating the remapped dependency graph.
    contract.plan.blocks = [];
    contract.plan.unscheduled = contract.tasks.map(t => ({ taskId: t.id, reason: 'needs_clarification', explanation: 'Awaiting scheduling' }));
    return { ...contractAnalysis(analysis, contract), taskRevisions: revisions, persistentTasks: [...records.values()].map(item => ({ ...item, sessionEventIds: sessions(item) })) };
  }
  return {
    listTasks: journalId => list(journalId).map(item => ({ ...item, sessionEventIds: sessions(item) })),
    reconcileTasks: reconcile, assertTasksCurrent: assertCurrent,
    linkTaskSessions(analysis, events) {
      assertCurrent(analysis);
      for (const event of events) if (get(event.sourceTaskId)) db.prepare('INSERT INTO task_sessions VALUES(?,?,?)').run(event.id, event.sourceTaskId, get(event.sourceTaskId).generation);
    },
    updateTask(id, patch) { return transaction(() => {
      const item = get(id);
      if (!item) throw Object.assign(new Error('Task not found'), { status: 404 });
      if (!patch || Array.isArray(patch) || patch.revision !== item.revision) throw conflict('Task changed; reload before editing');
      const allowed = new Set(['revision', 'title', 'status', 'deadline', 'effort', 'importance', 'dependsOn', 'requestNewSession']);
      if (Object.keys(patch).some(k => !allowed.has(k))) throw invalid('Unknown task field');
      if ('title' in patch && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 500)) throw invalid('Title must contain 1–500 characters');
      if ('status' in patch && !['open', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(patch.status)) throw invalid('Invalid task status');
      if ('deadline' in patch && patch.deadline !== null && (!patch.deadline || !isInstant(patch.deadline.at) || !['hard', 'target'].includes(patch.deadline.kind))) throw invalid('Choose an explicit deadline and timezone');
      if ('effort' in patch && patch.effort !== null && (!Number.isInteger(patch.effort?.minutes) || patch.effort.minutes < 1 || patch.effort.minutes > 525600 || !['next_session', 'remaining_task'].includes(patch.effort.scope))) throw invalid('Invalid effort or scope');
      if ('importance' in patch && patch.importance !== null && !['low', 'medium', 'high'].includes(patch.importance)) throw invalid('Invalid importance');
      if ('dependsOn' in patch && (!Array.isArray(patch.dependsOn) || patch.dependsOn.length > 100 || new Set(patch.dependsOn).size !== patch.dependsOn.length || patch.dependsOn.some(d => d === id || !get(d)))) throw invalid('Choose valid task dependencies');
      if ('requestNewSession' in patch && typeof patch.requestNewSession !== 'boolean') throw invalid('Invalid session request');
      const confirmed = { ...item.confirmed };
      for (const key of ['status', 'deadline', 'effort', 'importance', 'dependsOn']) if (key in patch) confirmed[key] = patch[key];
      if (confirmed.importance === null) delete confirmed.importance;
      const updated = { ...item, title: patch.title?.trim() || item.title, status: patch.status || item.status, confirmed, revision: item.revision + 1,
        generation: item.generation + (patch.requestNewSession === true ? 1 : 0) };
      const graph = new Map(list().map(t => [t.id, t.id === id ? updated.confirmed.dependsOn || [] : t.confirmed.dependsOn || []]));
      const visiting = new Set(), done = new Set();
      const visit = key => { if (visiting.has(key)) throw invalid('Dependencies cannot contain a cycle'); if (done.has(key)) return; visiting.add(key); for (const d of graph.get(key) || []) visit(d); visiting.delete(key); done.add(key); };
      for (const key of graph.keys()) visit(key);
      // Keep confirmed values within the existing evidence schema.
      assertSchema('task', { id, title: updated.title, description: '', status: updated.status, evidenceIds: ['confirmed'],
        importance: { level: 'unknown', basis: 'unknown', reason: 'Pending', evidenceIds: [] }, deadline: null, estimateId: null, dependsOn: confirmed.dependsOn || [], clarificationQuestions: [] });
      put(updated); return { ...updated, sessionEventIds: sessions(updated) };
    }); },
    claimReminder(id, at) { return transaction(() => {
      db.prepare('DELETE FROM reminder_receipts WHERE delivered_at<?').run(new Date(Date.parse(at) - 30 * 86400000).toISOString());
      return Boolean(db.prepare('INSERT OR IGNORE INTO reminder_receipts VALUES(?,?)').run(id, at).changes);
    }); },
    releaseReminder(id) { db.prepare('DELETE FROM reminder_receipts WHERE id=?').run(id); }
  };
}
module.exports = { migrate, attach };
