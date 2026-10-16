const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const MAX_SCHEMA = 3;
function inspectDatabase(file, maxVersion = MAX_SCHEMA) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (!Number.isInteger(maxVersion) || maxVersion < 1 || maxVersion > MAX_SCHEMA || version < 1 || version > maxVersion) throw new Error('Database schema is incompatible with the selected application.');
    if (db.prepare('PRAGMA quick_check').all().some((item) => item.quick_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((item) => item.name));
    const required = ['settings', 'events', 'journals', 'analyses', 'applied_batches', 'metadata', ...(version >= 2 ? ['integration_state', 'activity', 'google_busy', 'memory_documents', 'memory_chunks', 'memory_fts', ...(version >= 3 ? ['durable_tasks', 'task_analyses', 'task_sessions', 'reminder_receipts'] : [])] : [])];
    if (required.some((table) => !tables.has(table)) || !db.prepare('SELECT data FROM settings WHERE id=1').get()) throw new Error('Database is missing required application tables or settings.');
    return { version, integrity: 'ok' };
  } finally { db.close(); }
}

async function copyDatabase(source, destination, { maxVersion = MAX_SCHEMA } = {}) {
  const from = fs.realpathSync(source), to = path.resolve(destination);
  if (from === to || fs.existsSync(to) || fs.existsSync(to + '-wal') || fs.existsSync(to + '-shm')) throw new Error('Destination must be a new database path with no SQLite sidecars.');
  inspectDatabase(from, maxVersion);
  // Reserve the destination exclusively. Native backup includes committed WAL data.
  const fd = fs.openSync(to, 'wx', 0o600); fs.closeSync(fd);
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(db, to);
    return inspectDatabase(to, maxVersion);
  } catch (error) {
    // Retain a failed output for diagnosis; never reuse it as a recovery database.
    throw Object.assign(new Error('Snapshot failed; discard the incomplete destination and choose a new path.'), { cause: error });
  } finally { db.close(); }
}

function preMigrationSnapshot(db, file, version) {
  if (file === ':memory:' || version < 1 || version >= MAX_SCHEMA) return null;
  const destination = path.join(path.dirname(path.resolve(file)), `${path.basename(file)}.before-v${version}-${crypto.randomUUID()}.sqlite`);
  const fd = fs.openSync(destination, 'wx', 0o600); fs.closeSync(fd);
  // Synchronous SQLite snapshot happens before schema changes, with committed WAL included.
  db.prepare('VACUUM INTO ?').run(destination);
  inspectDatabase(destination, version);
  return destination;
}
module.exports = { copyDatabase, inspectDatabase, preMigrationSnapshot, MAX_SCHEMA };
