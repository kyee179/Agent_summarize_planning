const { terms: searchTerms, indexedText } = require('./searchText.cjs');
const { hash, error } = require('./common.cjs');
const { sourceVersion } = require('../contracts/analysis.cjs');
function migrate(db) {
  db.exec(`
    CREATE TABLE integration_state (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE activity (id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE google_busy (id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE memory_documents (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE memory_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, title, content, tokenize='unicode61');
    PRAGMA user_version = 2;
  `);
}
function attach(db, transaction, getJournal) {
  const parse = (row) => row ? JSON.parse(row.data) : null;
  const state = (id) => parse(db.prepare('SELECT data FROM integration_state WHERE id=?').get(id));
  const setState = (id, data) => db.prepare('INSERT INTO integration_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(data));
  const doc = (id) => parse(db.prepare('SELECT data FROM memory_documents WHERE id=?').get(id));
  const chunkCurrent = (item) => item.sourceType === 'journal'
    ? sourceVersion(getJournal(item.sourceId) || {}) === item.sourceVersion
    : doc(item.sourceId)?.version === item.sourceVersion;
  function clearChunks(id) {
    db.prepare('DELETE FROM memory_fts WHERE id IN (SELECT id FROM memory_chunks WHERE source_id=?)').run(id);
    db.prepare('DELETE FROM memory_chunks WHERE source_id=?').run(id);
  }
  function indexSource(source) {
    clearChunks(source.id);
    const version = source.sourceType === 'journal' ? sourceVersion(source) : source.version;
    // Bounded overlapping text chunks; no executable document/file ingestion.
    for (let start = 0; start < source.content.length; start += 900) {
      const content = source.content.slice(start, start + 1200);
      const id = `chunk:${hash([source.id, version, start]).slice(0, 40)}`;
      const chunk = { id, sourceId: source.id, sourceType: source.sourceType || 'document', sourceVersion: version,
        title: source.title || 'Journal', content, updatedAt: source.updatedAt, embedding: null, model: null };
      db.prepare('INSERT INTO memory_chunks VALUES(?,?,?)').run(id, source.id, JSON.stringify(chunk));
      db.prepare('INSERT INTO memory_fts VALUES(?,?,?)').run(id, indexedText(chunk.title), indexedText(content));
    }
  }
  return {
    integrationState: state,
    setIntegrationState: (id, data) => transaction(() => setState(id, data)),
    listActivity({ from, to }) { return db.prepare('SELECT data FROM activity WHERE ends_at>? AND starts_at<? ORDER BY starts_at,id LIMIT 1000')
      .all(Date.parse(from), Date.parse(to)).map(parse); },
    replaceActivity(records, config, selectedRange, now) {
      return transaction(() => {
        // One selected snapshot replaces overlapping observations; repeating import is idempotent.
        db.prepare('DELETE FROM activity WHERE ends_at>? AND starts_at<?').run(Date.parse(selectedRange.from), Date.parse(selectedRange.to));
        db.prepare('DELETE FROM activity WHERE ends_at<?').run(Date.parse(now) - 30 * 86400000);
        for (const item of records) db.prepare('INSERT OR REPLACE INTO activity VALUES(?,?,?,?)').run(item.id, Date.parse(item.startsAt), Date.parse(item.endsAt), JSON.stringify(item));
        setState('activity', { ...config, lastImportedAt: now, retentionDays: 30 });
        return { imported: records.length, retentionDays: 30 };
      });
    },
    purgeActivity() { return transaction(() => {
      db.exec("DELETE FROM analyses WHERE EXISTS (SELECT 1 FROM json_each(analyses.data,'$.contract.evidence') e WHERE json_extract(e.value,'$.sourceType')='activity'); DELETE FROM activity");
      setState('activity', { consent: false });
    }); },
    expireActivity(now) { return transaction(() => {
      const cutoff = Date.parse(now) - 30 * 86400000;
      db.prepare(`DELETE FROM analyses WHERE EXISTS (SELECT 1 FROM json_each(analyses.data,'$.contract.evidence') e
        LEFT JOIN activity a ON a.id=json_extract(e.value,'$.sourceId') WHERE json_extract(e.value,'$.sourceType')='activity' AND (a.id IS NULL OR a.ends_at<?))`).run(cutoff);
      db.prepare('DELETE FROM activity WHERE ends_at<?').run(cutoff);
    }); },
    googleBusy({ from, to }) { return db.prepare('SELECT data FROM google_busy WHERE ends_at>? AND starts_at<?').all(Date.parse(from), Date.parse(to)).map(parse); },
    connectGoogle(encrypted, connectionId) { return transaction(() => {
      setState('googleTokens', encrypted); setState('googleConnection', { id: connectionId });
      db.exec('DELETE FROM google_busy'); setState('googleSync', { calendarIds: [], syncedAt: null, connectionId });
    }); },
    refreshGoogleTokens(encrypted, previous) { return transaction(() => {
      if (hash(state('googleTokens')) !== hash(previous)) throw error('Google connection changed during refresh; retry', 409);
      setState('googleTokens', encrypted);
    }); },
    replaceGoogleBusy(events, config) { return transaction(() => {
      if (config.connectionId !== undefined && config.connectionId !== (state('googleConnection')?.id || null)) throw error('Google connection changed during sync', 409);
      db.exec('DELETE FROM google_busy');
      for (const item of events) db.prepare('INSERT INTO google_busy VALUES(?,?,?,?)').run(item.id, Date.parse(item.startsAt), Date.parse(item.endsAt), JSON.stringify(item));
      setState('googleSync', config);
      return { imported: events.length, ...config };
    }); },
    disconnectGoogle() { return transaction(() => { db.exec("DELETE FROM google_busy; DELETE FROM integration_state WHERE id IN ('googleTokens','googleSync','googleConnection')"); }); },
    assertCalendarCoverage(selectedRange, now = new Date().toISOString()) {
      const sync = state('googleSync');
      if (!state('googleTokens')) return;
      if (!sync?.calendarIds?.length) throw error('Select calendars and sync Google Calendar before planning', 409);
      if (sync.connectionId !== undefined && sync.connectionId !== (state('googleConnection')?.id || null)) throw error('Google connection changed; sync again', 409);
      if (!sync.syncedAt || Date.parse(sync.syncedAt) < Date.parse(now) - 30 * 60000 ||
          Date.parse(sync.from) > Date.parse(selectedRange.from) || Date.parse(sync.to) < Date.parse(selectedRange.to)) {
        throw error('Sync selected Google calendars for the full planning day, including scheduling buffers (15 minutes before and after); cache expires after 30 minutes', 409);
      }
    },
    getMemoryDocument: doc,
    listMemoryDocuments: () => db.prepare('SELECT data FROM memory_documents ORDER BY id').all().map(parse),
    putMemoryDocument(input) { return transaction(() => {
      const item = { ...input, version: hash([input.title, input.content]), sourceType: 'document' };
      const count = db.prepare('SELECT count(*) AS n FROM memory_documents').get().n;
      if (!doc(input.id) && count >= 100) throw error('Memory supports at most 100 notes');
      const otherChunks = db.prepare('SELECT count(*) AS n FROM memory_chunks WHERE source_id!=?').get(input.id).n;
      if (otherChunks + Math.ceil(input.content.length / 900) > 1000) throw error('Memory index supports at most 1000 chunks; shorten or remove notes');
      db.prepare('INSERT INTO memory_documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, JSON.stringify(item));
      indexSource(item); return item;
    }); },
    deleteMemoryDocument(id) { return transaction(() => {
      clearChunks(id);
      db.prepare("DELETE FROM analyses WHERE EXISTS (SELECT 1 FROM json_each(analyses.data,'$.contract.evidence') e WHERE json_extract(e.value,'$.sourceType')='document' AND json_extract(e.value,'$.sourceId')=?)").run(id);
      return db.prepare('DELETE FROM memory_documents WHERE id=?').run(id).changes > 0;
    }); },
    reindexMemory(journals) { return transaction(() => {
      const sources = [...db.prepare('SELECT data FROM memory_documents').all().map(parse), ...journals.map((item) => ({ ...item, sourceType: 'journal' }))];
      if (sources.length > 200 || sources.reduce((sum, s) => sum + Math.ceil(s.content.length / 900), 0) > 1000) throw error('Index supports 200 sources / 1000 chunks; shorten notes or journals');
      db.exec('DELETE FROM memory_chunks; DELETE FROM memory_fts'); sources.forEach(indexSource);
      return { sources: sources.length, chunks: db.prepare('SELECT count(*) AS n FROM memory_chunks').get().n };
    }); },
    memoryChunks: () => db.prepare('SELECT data FROM memory_chunks LIMIT 1000').all().map(parse).filter(chunkCurrent),
    lexicalMemory(text) {
      const allTerms = searchTerms(text);
      const terms = allTerms.filter(term => !/^\p{Script=Han}$/u.test(term) || allTerms.every(t => [...t].length === 1)).slice(0, 80);
      if (!terms.length) return [];
      const match = terms.map((term) => `"${term}"`).join(' OR ');
      return db.prepare('SELECT c.data FROM memory_fts f JOIN memory_chunks c ON c.id=f.id WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts),c.id LIMIT 100')
        .all(match).map(parse).filter(chunkCurrent);
    },
    saveEmbeddings(chunks, vectors, model, embeddingModel) { return transaction(() => {
      chunks.forEach((chunk, i) => {
        const current = parse(db.prepare('SELECT data FROM memory_chunks WHERE id=?').get(chunk.id));
        if (current && chunkCurrent(current)) db.prepare('UPDATE memory_chunks SET data=? WHERE id=?').run(JSON.stringify({ ...current, embedding: vectors[i], model, embeddingModel }), chunk.id);
      });
    }); },
    assertSupplementalEvidence(contract) {
      for (const item of contract.evidence) {
        if (item.sourceType === 'activity') {
          const source = parse(db.prepare('SELECT data FROM activity WHERE id=?').get(item.sourceId));
          if (!source || Date.parse(source.endsAt) < Date.now() - 30 * 86400000 || hash(source) !== item.sourceVersion || source.excerpt !== item.excerpt) throw error('Activity evidence changed; analyze again', 409);
        }
        if (item.sourceType === 'document') {
          const source = doc(item.sourceId);
          if (!source || source.version !== item.sourceVersion || !source.content.includes(item.excerpt)) throw error('Personal memory changed; analyze again', 409);
        }
      }
    }
  };
}
module.exports = { migrate, attach };
