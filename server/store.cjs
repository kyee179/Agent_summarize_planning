const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const integrationStorage = require("./integrations/storage.cjs");
const { defaultData, ensureShape } = require("./defaults.cjs");
const { assertAnalysis, assertEvidenceCurrent } = require("./contracts/analysis.cjs");
const { assertScheduleCurrent, planningRange } = require("./scheduler.cjs");

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function createStore(filePath, { legacyFile = path.join(path.dirname(filePath), "calendar.json") } = {}) {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function putEvent(event) {
    db.prepare("INSERT INTO events(id, starts_at, ends_at, data) VALUES (?, ?, ?, ?)")
      .run(event.id, new Date(event.startsAt).getTime(), new Date(event.endsAt).getTime(), JSON.stringify(event));
    return event;
  }
  function putJournal(journal) {
    db.prepare("INSERT INTO journals(id, data) VALUES (?, ?)").run(journal.id, JSON.stringify(journal));
    return journal;
  }
  function putAnalysis(analysis) {
    // Legacy imports remain readable. New contract records are validated before persistence.
    if (analysis.contract !== undefined) {
      assertAnalysis(analysis);
      extra.assertSupplementalEvidence(analysis.contract);
      extra.assertCalendarCoverage(planningRange(analysis.contract.plan));
      assertEvidenceCurrent(analysis.contract, (id) => parse(db.prepare("SELECT data FROM journals WHERE id=?").get(id)));
      if (analysis.scheduling) assertScheduleCurrent(analysis, planningEvents(planningRange(analysis.contract.plan)),
        parse(db.prepare("SELECT data FROM settings WHERE id=1").get()));
    }
    db.prepare(`INSERT INTO analyses(journal_id, id, data) VALUES (?, ?, ?)
      ON CONFLICT(journal_id) DO UPDATE SET id=excluded.id, data=excluded.data`)
      .run(analysis.journalId, analysis.id, JSON.stringify(analysis));
    return analysis;
  }
  const parse = (row) => row ? JSON.parse(row.data) : null;
  function planningEvents({ from, to }) {
    // Old recurrence anchors must be included even if their original interval is outside this day.
    return db.prepare(`SELECT data FROM events WHERE (ends_at > ? AND starts_at < ?)
      OR (starts_at < ? AND json_extract(data, '$.repeat') IS NOT NULL AND json_extract(data, '$.repeat') != 'none')`)
      .all(Date.parse(from), Date.parse(to), Date.parse(to)).map(parse).concat(extra.googleBusy({ from, to }));
  }

  const extra = integrationStorage.attach(db, transaction, (id) => parse(db.prepare("SELECT data FROM journals WHERE id=?").get(id)));

  try {
    // Acquire the writer lock before reading the version: two app processes may start together.
    transaction(() => {
      const version = db.prepare("PRAGMA user_version").get().user_version;
      if (version > 2) throw new Error("Database was created by a newer app; refusing to downgrade.");
      if (version === 2) return;
      if (version === 1) { integrationStorage.migrate(db); return; }
      db.exec(`
        CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE events (id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
          data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX events_time ON events(starts_at, ends_at);
        CREATE TABLE journals (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE analyses (journal_id TEXT PRIMARY KEY REFERENCES journals(id) ON DELETE CASCADE,
          id TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE applied_batches (analysis_id TEXT PRIMARY KEY, journal_id TEXT NOT NULL,
          data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      integrationStorage.migrate(db);
      // Import with the schema in one transaction; preserve the original JSON.
      const imported = filePath !== ":memory:" && fs.existsSync(legacyFile);
      const data = ensureShape(imported ? JSON.parse(fs.readFileSync(legacyFile, "utf8")) : defaultData);
      db.prepare("INSERT INTO settings VALUES(1, ?)").run(JSON.stringify(data.settings));
      data.events.forEach(putEvent);
      data.journals.forEach(putJournal);
      data.journalAnalyses.forEach(putAnalysis);
      db.prepare("INSERT INTO metadata VALUES('initial_source', ?)").run(imported ? legacyFile : "defaults");

    });
  } catch (error) {
    db.close();
    throw error;
  }

  const store = {
    ...extra,
    getSettings: () => parse(db.prepare("SELECT data FROM settings WHERE id=1").get()),
    updateSettings(patch) {
      return transaction(() => {
        const settings = { ...store.getSettings(), ...patch };
        db.prepare("UPDATE settings SET data=? WHERE id=1").run(JSON.stringify(settings));
        return settings;
      });
    },
    listEvents({ from, to } = {}) {
      return db.prepare("SELECT data FROM events WHERE ends_at >= ? AND starts_at <= ? ORDER BY starts_at")
        .all(from ? new Date(from).getTime() : -8640000000000000,
          to ? new Date(to).getTime() : 8640000000000000).map(parse);
    },
    listPlanningEvents: planningEvents,
    getEvent: (id) => parse(db.prepare("SELECT data FROM events WHERE id=?").get(id)),
    createEvent: putEvent,
    updateEvent(id, patch) {
      return transaction(() => {
        const current = store.getEvent(id);
        if (!current) return null;
        const event = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
        db.prepare("UPDATE events SET starts_at=?, ends_at=?, data=? WHERE id=?")
          .run(new Date(event.startsAt).getTime(), new Date(event.endsAt).getTime(), JSON.stringify(event), id);
        return event;
      });
    },
    deleteEvent: (id) => db.prepare("DELETE FROM events WHERE id=?").run(id).changes > 0,
    listJournals({ type, bookmarked } = {}) {
      return db.prepare("SELECT data FROM journals").all().map(parse)
        .filter((journal) => (!type || journal.type === type) &&
          (bookmarked === undefined || journal.bookmarked === bookmarked))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    },
    getJournal: (id) => parse(db.prepare("SELECT data FROM journals WHERE id=?").get(id)),
    createJournal: putJournal,
    updateJournal(id, patch) {
      return transaction(() => {
        const current = store.getJournal(id);
        if (!current) return null;
        const journal = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
        db.prepare("UPDATE journals SET data=? WHERE id=?").run(JSON.stringify(journal), id);
        if (journal.content !== current.content || journal.journalDate !== current.journalDate || journal.type !== current.type) {
          db.prepare("DELETE FROM analyses WHERE journal_id=?").run(id);
        }
        return journal;
      });
    },
    deleteJournal(id) {
      return transaction(() => {
        db.prepare("DELETE FROM applied_batches WHERE journal_id=?").run(id);
        return db.prepare("DELETE FROM journals WHERE id=?").run(id).changes > 0;
      });
    },
    saveJournalAnalysis: (analysis) => transaction(() => putAnalysis(analysis)),
    getJournalAnalysis: (id) => parse(db.prepare("SELECT data FROM analyses WHERE journal_id=?").get(id)),
    getAppliedBatch: (id) => parse(db.prepare("SELECT data FROM applied_batches WHERE analysis_id=?").get(id)),
    applyAnalysis(journalId, analysisId, buildEvents) {
      return transaction(() => {
        const receipt = store.getAppliedBatch(analysisId);
        if (receipt) {
          if (receipt.journalId !== journalId) throw conflict("Analysis belongs to a different journal");
          return { ...receipt, replayed: true };
        }
        const analysis = store.getJournalAnalysis(journalId);
        if (!analysis || analysis.id !== analysisId) throw conflict("Analysis is stale; analyze this journal again");
        if (analysis.contract) {
          extra.assertSupplementalEvidence(analysis.contract);
          extra.assertCalendarCoverage(planningRange(analysis.contract.plan));
        }
        const events = buildEvents(analysis);
        events.forEach(putEvent);
        const result = { analysisId, journalId, events, appliedAt: new Date().toISOString() };
        db.prepare("INSERT INTO applied_batches VALUES(?, ?, ?)").run(analysisId, journalId, JSON.stringify(result));
        return { ...result, replayed: false };
      });
    },
    backup: (destination) => backup(db, destination),
    close: () => db.close()
  };
  return store;
}

module.exports = { createStore, defaultData, ensureShape };
