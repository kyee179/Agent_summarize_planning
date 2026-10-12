const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../server/store.cjs');
const { copyDatabase, inspectDatabase } = require('../server/recovery.cjs');
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-recovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function downgrade(db) { db.exec('DROP TABLE memory_fts; DROP TABLE memory_chunks; DROP TABLE memory_documents; DROP TABLE integration_state; DROP TABLE activity; DROP TABLE google_busy; PRAGMA user_version=1;'); }

test('backup includes live committed WAL, restores to a new path, and preserves source and previous destination', async (t) => {
  let store; t.after(() => store?.close());
  const dir = directory(t), source = path.join(dir, 'source.sqlite'), saved = path.join(dir, 'saved.sqlite'), restored = path.join(dir, 'restored.sqlite');
  store = createStore(source);
  store.createJournal({ id: 'before', content: 'Synthetic committed WAL entry' });
  await copyDatabase(source, saved);
  store.createJournal({ id: 'after', content: 'Keep the later original record' });
  await copyDatabase(saved, restored);
  const recovery = createStore(restored); assert.ok(recovery.getJournal('before')); assert.equal(recovery.getJournal('after'), null); recovery.close();
  assert.ok(store.getJournal('after'));
  await assert.rejects(copyDatabase(source, saved), /new database path/);
  await assert.rejects(copyDatabase(source, source), /new database path/);
  fs.writeFileSync(restored + '.new-wal', 'sidecar');
  await assert.rejects(copyDatabase(source, restored + '.new'), /sidecars/);
});
test('migration preserves a readable v1 snapshot; backup does not migrate v1; max schema rejects newer data', async (t) => {
  const dir = directory(t), source = path.join(dir, 'source.sqlite'); let store = createStore(source);
  store.createJournal({ id: 'kept', content: 'Synthetic migration record' }); store.close();
  let db = new DatabaseSync(source); downgrade(db); db.close();
  const backup = path.join(dir, 'v1.sqlite'); await copyDatabase(source, backup, { maxVersion: 1 });
  assert.equal(inspectDatabase(source, 1).version, 1);
  store = createStore(source); assert.ok(store.getJournal('kept')); store.close();
  const snapshots = fs.readdirSync(dir).filter((file) => file.includes('.before-v1-')); assert.equal(snapshots.length, 1);
  assert.equal(inspectDatabase(path.join(dir, snapshots[0]), 1).version, 1);
  await assert.rejects(copyDatabase(source, path.join(dir, 'incompatible.sqlite'), { maxVersion: 1 }), /incompatible/);
  db = new DatabaseSync(source); db.exec('PRAGMA user_version=99'); db.close();
  assert.throws(() => createStore(source), /newer app/);
  await assert.rejects(copyDatabase(source, path.join(dir, 'future.sqlite')), /incompatible/);
  assert.equal(fs.existsSync(path.join(dir, 'future.sqlite')), false);
});
test('restore rejects corrupt and foreign databases before creating a destination', async (t) => {
  const dir = directory(t), source = path.join(dir, 'bad.sqlite'), target = path.join(dir, 'new.sqlite'); fs.writeFileSync(source, 'not sqlite');
  await assert.rejects(copyDatabase(source, target)); assert.equal(fs.existsSync(target), false);
  const foreign = path.join(dir, 'foreign.sqlite'), db = new DatabaseSync(foreign); db.exec('PRAGMA user_version=2'); db.close();
  await assert.rejects(copyDatabase(foreign, target), /required/); assert.equal(fs.existsSync(target), false);
});
