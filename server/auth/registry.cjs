const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const conflict = message => Object.assign(new Error(message), { status: 409 });

function createRegistry(file, { clock = Date.now } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, kind TEXT NOT NULL, issuer TEXT, subject TEXT, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(issuer,subject));
    CREATE TABLE IF NOT EXISTS ai_usage (profile_id TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(profile_id,day));
    CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT NOT NULL, minute INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(key,minute));
    PRAGMA user_version=1;`);
  const parse = row => row ? JSON.parse(row.data) : null;
  const get = id => parse(db.prepare('SELECT data FROM profiles WHERE id=?').get(id));
  function put(profile) {
    db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(profile.id, profile.kind, profile.issuer || null, profile.subject || null, JSON.stringify(profile));
    return profile;
  }
  function createLocal(name, id = crypto.randomUUID()) {
    if (id !== 'local' && !/^[0-9a-f-]{36}$/i.test(id)) throw conflict('Invalid local profile.');
    if (get(id)) return get(id);
    if (db.prepare('SELECT count(*) AS n FROM profiles').get().n >= 50) throw conflict('This device supports up to 50 profiles.');
    return put({ id, kind: 'local', name: String(name || 'Local workspace').trim().slice(0, 100), onboardingComplete: false, createdAt: new Date(clock()).toISOString() });
  }
  createLocal('Local workspace', 'local');
  return {
    get, put, createLocal,
    locals: () => db.prepare("SELECT data FROM profiles WHERE kind='local' ORDER BY rowid").all().map(parse),
    account(identity) {
      const old = parse(db.prepare("SELECT data FROM profiles WHERE kind='account' AND issuer=? AND subject=?").get(identity.issuer, identity.subject));
      if (old) return put({ ...old, name: identity.name, email: identity.email });
      if (db.prepare('SELECT count(*) AS n FROM profiles').get().n >= 50) throw conflict('This device supports up to 50 profiles.');
      return put({ id: crypto.randomUUID(), kind: 'account', ...identity, onboardingComplete: false, createdAt: new Date(clock()).toISOString() });
    },
    usage(profileId) { const day = new Date(clock()).toISOString().slice(0, 10); return { day, used: db.prepare('SELECT used FROM ai_usage WHERE profile_id=? AND day=?').get(profileId, day)?.used || 0 }; },
    reserve(profileId, limit) {
      const day = new Date(clock()).toISOString().slice(0, 10);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO ai_usage VALUES(?,?,0)').run(profileId, day);
        const updated = db.prepare('UPDATE ai_usage SET used=used+1 WHERE profile_id=? AND day=? AND used<?').run(profileId, day, limit);
        if (!updated.changes) throw Object.assign(new Error('Daily AI request limit reached. It resets at 00:00 UTC; local rules remain available.'), { status: 429 });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      db.prepare('DELETE FROM ai_usage WHERE day<?').run(new Date(clock() - 35 * 86400000).toISOString().slice(0, 10));
    },
    attempt(address) {
      const key = crypto.createHash('sha256').update(String(address).toLowerCase()).digest('hex'), minute = Math.floor(clock() / 60000);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [bucket, limit] of [[key, 10], ['device', 60]]) {
          db.prepare('INSERT OR IGNORE INTO auth_attempts VALUES(?,?,0)').run(bucket, minute);
          if (!db.prepare('UPDATE auth_attempts SET used=used+1 WHERE key=? AND minute=? AND used<?').run(bucket, minute, limit).changes) throw Object.assign(new Error('Too many account requests. Wait a minute before trying again.'), { status: 429 });
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      db.prepare('DELETE FROM auth_attempts WHERE minute<?').run(minute - 60);
    },
    remove(id) { if (id === 'local') throw conflict('The original local profile must be preserved.'); db.prepare('DELETE FROM ai_usage WHERE profile_id=?').run(id); db.prepare('DELETE FROM profiles WHERE id=?').run(id); },
    close: () => db.close()
  };
}
module.exports = { createRegistry };
