const { assertBundle } = require('../contracts/validate.cjs');
const allowedSettings = ['timezone', 'locale', 'weekStartsOn', 'defaultNotifyMinutesBefore', 'planningLeadMinutes', 'defaultAvailability', 'workingCalendar'];
const conflict = message => Object.assign(new Error(message), { status: 409 });
function attach(db, transaction, profileId) {
  const rows = table => db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(row.data));
  function snapshot() {
    const data = { version: 2, sources:rows('source_items'), candidates:rows('task_candidates'), outcomes:rows('effort_records'), taskSources:db.prepare('SELECT task_id AS taskId,source_id AS sourceId FROM task_sources').all(), settings: Object.fromEntries(Object.entries(rows('settings')[0]).filter(([key]) => allowedSettings.includes(key))),
      events: rows('events'), journals: rows('journals'), tasks: rows('durable_tasks'), notes: rows('memory_documents'),
      sessions: db.prepare('SELECT event_id AS eventId,task_id AS taskId,generation FROM task_sessions').all() };
    if (Buffer.byteLength(JSON.stringify(data)) > 20 * 1024 * 1024) throw conflict('This workspace exceeds the 20 MB portable export limit. Use a database backup.');
    return data;
  }
  return {
    portableSnapshot: snapshot,
    importPortable(data) {
      if (![1,2].includes(data.version) || ['events', 'journals', 'tasks', 'notes', 'sessions'].some(key => !Array.isArray(data[key]) || data[key].length > (key === 'notes' ? 100 : 10000))) throw conflict('Unsupported or oversized local workspace.');
      const settings = Object.fromEntries(Object.entries(data.settings || {}).filter(([key]) => allowedSettings.includes(key)));
      if(settings.workingCalendar) settings.workingCalendar=require('../workingCalendar.cjs').validate(settings.workingCalendar);
      assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [], plan: { id: 'import', state: 'proposal', targetDate: '2030-01-01', timezone: settings.timezone || 'UTC', availability: settings.defaultAvailability || [], bufferMinutes: 15, blocks: [], unscheduled: [], warnings: [] } });
      for(const key of ['sources','candidates','outcomes','taskSources'])if(data[key]!==undefined&&(!Array.isArray(data[key])||data[key].length>10000))throw conflict('Invalid portable source/outcome collection.');
      return transaction(() => {
        for (const table of ['events', 'journals', 'durable_tasks', 'memory_documents']) if (db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n) throw conflict('Import is available only into an empty workspace. Your local original is unchanged.');
        const current = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
        db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({ ...current, ...settings, aiProvider: 'local' }));
        for (const item of data.journals) db.prepare('INSERT INTO journals VALUES(?,?)').run(item.id, JSON.stringify(item));
        for (const item of data.events) db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(item.id, Date.parse(item.startsAt), Date.parse(item.endsAt), JSON.stringify(item));
        for (const item of data.tasks) {
          const task = { ...item, profileId };
          db.prepare('INSERT INTO durable_tasks VALUES(?,?,?,?,?)').run(task.id, profileId, task.journalId ?? null, task.identity, JSON.stringify(task));
        }
        for(const source of data.sources||[])db.prepare('INSERT INTO source_items VALUES(?,?,?)').run(source.id,profileId,JSON.stringify(source));
        for(const candidate of data.candidates||[])db.prepare('INSERT INTO task_candidates VALUES(?,?,?,?)').run(candidate.id,profileId,candidate.sourceId,JSON.stringify(candidate));
        for(const link of data.taskSources||[])db.prepare('INSERT INTO task_sources VALUES(?,?)').run(link.taskId,link.sourceId);
        for(const outcome of data.outcomes||[])db.prepare('INSERT INTO effort_records VALUES(?,?,?)').run(outcome.id,outcome.taskId,JSON.stringify(outcome));
        for (const item of data.sessions) db.prepare('INSERT INTO task_sessions VALUES(?,?,?)').run(item.eventId, item.taskId, item.generation);
        for (const item of data.notes) db.prepare('INSERT INTO memory_documents VALUES(?,?)').run(item.id, JSON.stringify(item));
        return { journals: data.journals.length, events: data.events.length, tasks: data.tasks.length, notes: data.notes.length };
      });
    }
  };
}
function readSnapshot(file, profileId) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== 4) throw conflict('Open this local profile first to migrate it safely before copying.');
    db.exec('BEGIN');
    const result = attach(db, () => { throw conflict('This source is read-only.'); }, profileId).portableSnapshot();
    db.exec('COMMIT'); return result;
  } finally { db.close(); }
}
module.exports = { attach, readSnapshot };
