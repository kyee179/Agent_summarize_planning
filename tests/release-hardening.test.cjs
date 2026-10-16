const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../server/store.cjs');
const { localRuleBasedAnalysis, analyzeJournal, inferTask } = require('../server/journalAnalyzer.cjs');
const { collectJournalEvidence } = require('../server/contracts/analysis.cjs');
const { createToolSession } = require('../server/agent/tools.cjs');
const { createCredentials } = require('../electron/credentials.cjs');
const { createReminders } = require('../electron/reminders.cjs');
const { assertScheduleCurrent } = require('../server/scheduler.cjs');
const settings = { timezone: 'UTC', aiProvider: 'local', defaultAvailability: [{ startsAt: '09:00', endsAt: '17:00' }] };
const journal = { id: 'j', type: 'daily', title: 'Synthetic', journalDate: '2030-01-07', content: 'I need to update my CV.', updatedAt: '2030-01-07T00:00:00Z' };
function fixture() { const store = createStore(':memory:'); store.updateSettings(settings); store.createJournal(journal); return store; }
function save(store, id) { return store.saveJournalAnalysis({ ...localRuleBasedAnalysis({ journal, settings }), id, journalId: journal.id, createdAt: '2030-01-07T08:00:00Z' }); }
function events(analysis) { return analysis.scheduleDrafts.map((draft, i) => ({ ...draft, id: `event-${analysis.id}-${i}`, sourceTaskId: draft.taskId, sourceAnalysisId: analysis.id, repeat: 'none' })); }

test('Chinese and mixed fallback distinguish future work from negation and completed work', () => {
  for (const text of ['我需要完成项目报告。', '明天我要更新CV。', '我计划准备面试。', 'I will review the project.']) assert.ok(inferTask(text), text);
  for (const text of ['我不需要更新CV，已经完成。', '我已经完成项目报告。', '不要安排面试。', 'I attended a meeting today.', 'The test passed yesterday.']) assert.equal(inferTask(text), null, text);
});

test('long paragraphs retain exact spans; evidence-budget omissions are visible', async () => {
  const input = { journal: { ...journal, content: '我需要完成项目报告' + '甲'.repeat(4100) + '😀。' }, settings };
  const result = await analyzeJournal(input);
  assert.equal(result.contract.evidence.length, 2);
  assert.equal(result.evidenceCoverage.partial, false);
  for (const span of result.evidenceCoverage.sources[0].spans) assert.equal(input.journal.content.slice(span.start, span.end), result.contract.evidence.find(e => e.id === span.evidenceId).excerpt);
  const partial = await analyzeJournal({ ...input, journal: { ...journal, content: '我需要完成项目报告。'.repeat(105) } });
  assert.equal(partial.evidenceCoverage.partial, true);
  assert.ok(partial.evidenceCoverage.sources[0].omittedCharacters > 0);
  assert.ok(partial.cautions.some(c => c.includes('Partial analysis')));
});

test('Chinese evidence paging stays under byte limits and makes progress without skipped IDs', () => {
  const input = { journal: { ...journal, content: ('甲'.repeat(2000) + '。').repeat(25) }, settings };
  const trustedEvidence = collectJournalEvidence(input);
  const session = createToolSession({ ...input, trustedEvidence, expectedPlan: { targetDate: journal.journalDate, timezone: 'UTC', availability: [], bufferMinutes: 15 } }, 'local', 'test');
  const ids = []; let offset = 0;
  do { const output = session.execute('read_evidence', { offset, limit: 20 }).output; assert.ok(Buffer.byteLength(JSON.stringify(output)) < 98304); ids.push(...output.evidence.map(e => e.id)); offset = output.nextOffset; } while (offset !== null);
  assert.deepEqual(ids, trustedEvidence.map(e => e.id));
});

test('CJK retrieval finds two-character and mixed-language queries with original excerpts', () => {
  const store = fixture();
  try {
    store.putMemoryDocument({ id: 'zh', title: '合成笔记', content: '我需要完成项目报告。更新CV以后准备面试。', updatedAt: journal.updatedAt });
    store.putMemoryDocument({ id: 'other', title: '其他', content: '报销费用。', updatedAt: journal.updatedAt });
    for (const query of ['项目报告', '报告', '面试', 'CV']) { const hits = store.lexicalMemory(query); assert.equal(hits.length, 1, query); assert.ok(hits[0].content.includes('项目报告')); }
  } finally { store.close(); }
});

test('persistent task IDs and sessions stop repeated planning, with an explicit new-session choice', () => {
  const store = fixture();
  try {
    const first = save(store, 'first'), taskId = first.contract.tasks[0].id;
    store.applyAnalysis('j', first.id, events);
    const repeated = save(store, 'second');
    assert.equal(repeated.contract.tasks[0].id, taskId);
    assert.equal(repeated.scheduleDrafts.length, 0);
    const record = store.listTasks('j')[0]; assert.equal(record.sessionEventIds.length, 1);
    store.updateTask(taskId, { revision: record.revision, requestNewSession: true });
    const another = save(store, 'third'); assert.equal(another.scheduleDrafts.length, 1);
    assert.notEqual(another.scheduleDrafts[0].startsAt, first.scheduleDrafts[0].startsAt);
  } finally { store.close(); }
});

test('confirmed effort, deadline, importance and completion govern scheduling and stale Apply', () => {
  const store = fixture();
  try {
    const first = save(store, 'first'), record = first.persistentTasks[0];
    store.updateTask(record.id, { revision: record.revision, deadline: { at: '2030-01-07T10:00:00Z', kind: 'hard' }, effort: { minutes: 30, scope: 'remaining_task' }, importance: 'high' });
    assert.throws(() => store.applyAnalysis('j', 'first', events), /Task facts/);
    const confirmed = save(store, 'confirmed');
    assert.equal(confirmed.contract.tasks[0].deadline.at, '2030-01-07T10:00:00Z');
    assert.equal(confirmed.contract.estimates[0].effortMinutes.expected, 30);
    assert.equal(confirmed.contract.tasks[0].importance.basis, 'user');
    assert.ok(confirmed.contract.evidence.some(e => e.verification === 'user_confirmed'));
    const current = store.listTasks('j')[0];
    store.updateTask(current.id, { revision: current.revision, status: 'completed' });
    const completed = save(store, 'completed'); assert.equal(completed.scheduleDrafts.length, 0); assert.equal(completed.contract.tasks[0].status, 'completed');
  } finally { store.close(); }
});

test('task edit rejects stale revisions, nonexistent dependencies and dependency cycles', () => {
  const store = fixture();
  try {
    const first = save(store, 'first').persistentTasks[0];
    assert.throws(() => store.updateTask(first.id, { revision: 0, status: 'completed' }), /Task changed/);
    assert.throws(() => store.updateTask(first.id, { revision: first.revision, dependsOn: [first.id] }), /dependencies/);
    assert.throws(() => store.updateTask(first.id, { revision: first.revision, deadline: { at: 'tomorrow', kind: 'hard' } }), /explicit deadline/);
    const otherJournal = { ...journal, id: 'other', content: 'I must prepare the interview.' }; store.createJournal(otherJournal);
    const other = store.saveJournalAnalysis({ ...localRuleBasedAnalysis({ journal: otherJournal, settings }), journalId: 'other', id: 'other-analysis' }).persistentTasks[0];
    store.updateTask(first.id, { revision: first.revision, dependsOn: [other.id] });
    assert.throws(() => store.updateTask(other.id, { revision: other.revision, dependsOn: [first.id] }), /cycle/);
  } finally { store.close(); }
});

test('reminder receipts survive closing and reopening SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-receipts-')), file = path.join(dir, 'synthetic.sqlite');
  try { let store = createStore(file); assert.equal(store.claimReminder('occurrence:1', journal.updatedAt), true); store.close(); store = createStore(file); assert.equal(store.claimReminder('occurrence:1', journal.updatedAt), false); store.close(); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('API budgets review time from generation completion and protects new routes', async t => {
  const { createApp } = require('../server/index.cjs');
  const previous = process.env.AI_PROVIDER; process.env.AI_PROVIDER = 'local';
  const store = fixture(); let now = '2030-01-07T09:00:50Z';
  const service = { context: () => { now = '2030-01-07T09:01:06Z'; return {}; }, status: () => ({}), close: () => {} };
  const token = 'synthetic-release-loopback-token-32';
  const server = createApp({ store, apiToken: token, clock: () => now, integrations: service }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); if (previous === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = previous; });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/tasks')).status, 401);
  const response = await fetch(base + '/api/journals/j/analyze', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201); const analysis = await response.json(); assert.equal(analysis.contract.plan.blocks[0].startsAt, '2030-01-07T09:07:00.000Z');
  const result = await fetch(base + '/api/journals/j/apply-drafts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId: analysis.id }) });
  assert.equal(result.status, 201);
});

test('v2 upgrade preserves data and rebuilds CJK search under a verified pre-migration snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-migration-')), file = path.join(dir, 'synthetic.sqlite');
  try {
    let store = createStore(file); store.createJournal(journal); store.putMemoryDocument({ id: 'zh', title: '笔记', content: '完成项目报告。', updatedAt: journal.updatedAt }); store.close();
    const db = new DatabaseSync(file); db.exec('DROP TABLE task_sessions; DROP TABLE task_analyses; DROP TABLE durable_tasks; DROP TABLE reminder_receipts; PRAGMA user_version=2; DELETE FROM memory_fts;'); db.close();
    store = createStore(file); assert.equal(store.getJournal('j').content, journal.content); assert.equal(store.health().schemaVersion, 3); assert.equal(store.lexicalMemory('报告').length, 1); store.close();
    assert.ok(fs.readdirSync(dir).some(f => f.includes('before-v2-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v2 upgrade adopts old applied sessions so their work is not scheduled again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-adoption-')), file = path.join(dir, 'synthetic.sqlite');
  try {
    let store = createStore(file); store.updateSettings(settings); store.createJournal(journal);
    const first = save(store, 'legacy'); store.applyAnalysis('j', first.id, events); store.close();
    const db = new DatabaseSync(file); db.exec('DROP TABLE task_sessions; DROP TABLE task_analyses; DROP TABLE durable_tasks; DROP TABLE reminder_receipts; PRAGMA user_version=2;'); db.close();
    store = createStore(file); const next = save(store, 'new'); assert.equal(next.scheduleDrafts.length, 0); assert.equal(next.persistentTasks[0].sessionEventIds.length, 1); store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('date and effort suggestions stay unconfirmed and relative dates use the source date', () => {
  const { candidates } = require('../server/taskCandidates.cjs');
  const values = candidates('明天需要完成报告，预计30分钟。', { date: '2030-01-07', timezone: 'Asia/Shanghai' });
  assert.equal(values.deadlineDate, '2030-01-08'); assert.equal(values.deadlineTime, null); assert.equal(values.effortMinutes, 30); assert.equal(values.confirmation, 'required');
});

test('reminders catch up after sleep, persist across restart, and retry failed delivery', () => {
  const store = fixture(); let now = Date.parse('2030-01-07T09:02:00Z'), attempts = 0, delivered = 0;
  try {
    store.createEvent({ id: 'reminder', title: 'Synthetic reminder', startsAt: '2030-01-07T09:00:00Z', endsAt: '2030-01-07T10:00:00Z', notifyMinutesBefore: 0, notificationFormat: 'Desktop notification', repeat: 'daily', recurrenceTimezone: 'UTC' });
    const make = () => createReminders({ store, clock: () => now, notify: () => { if (++attempts === 1) throw Error('OS unavailable'); delivered++; } });
    make().check(); assert.equal(delivered, 0); make().check(); assert.equal(delivered, 1); make().check(); assert.equal(delivered, 1);
    now += 86400000; make().check(); assert.equal(delivered, 2);
  } finally { store.close(); }
});

test('secure setup stores ciphertext, exposes presence only, preserves keys, and refuses plaintext fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-vault-')), file = path.join(dir, 'credentials.encrypted');
  // Test double for the OS encryptor: production uses Electron safeStorage in the main process.
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };
  const value = 'synthetic-provider-credential';
  try {
    const env = {}, first = createCredentials({ file, safeStorage, env });
    first.save({ AI_PROVIDER: 'glm', GLM_API_KEY: value }); assert.ok(!fs.readFileSync(file).includes(value));
    first.save({ GLM_API_KEY: '' });
    const second = createCredentials({ file, safeStorage, env }); second.load(); assert.equal(env.GLM_API_KEY, value); assert.equal(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64').length, 32);
    assert.ok(!JSON.stringify(second.status()).includes(value)); assert.throws(() => second.save({ arbitraryPath: 'bad' }), /Unsupported/);
    assert.throws(() => createCredentials({ file, safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' }, platform: 'linux' }).save({ AI_PROVIDER: 'local' }), /unavailable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lead time remains strict at Apply rather than silently moving a reviewed plan', () => {
  const store = fixture();
  try {
    const result = save(store, 'lead');
    assert.throws(() => assertScheduleCurrent(result, [], settings, '2030-01-07T09:00:01Z'), /start time has passed/);
  } finally { store.close(); }
});
