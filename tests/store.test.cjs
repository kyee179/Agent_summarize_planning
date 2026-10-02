const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createStore } = require("../server/store.cjs");

const journal = { id: "journal-1", content: "Need to study", type: "daily", journalDate: "2026-10-02", updatedAt: "2026-10-02T00:00:00Z" };
const event = { id: "event-1", title: "Study", startsAt: "2026-10-02T09:00:00Z", endsAt: "2026-10-02T10:00:00Z" };

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("JSON migration preserves records, is one-time, and leaves source unchanged", (t) => {
  const directory = fixture(t);
  const legacy = path.join(directory, "calendar.json");
  const data = JSON.stringify({ settings: { locale: "zh-CN" }, events: [event], journals: [journal],
    journalAnalyses: [{ id: "analysis-1", journalId: journal.id, scheduleDrafts: [] }] });
  fs.writeFileSync(legacy, data);
  const file = path.join(directory, "calendar.sqlite");
  let store = createStore(file);
  assert.deepEqual(store.listEvents(), [event]);
  assert.deepEqual(store.getJournal(journal.id), journal);
  assert.equal(store.getSettings().locale, "zh-CN");
  assert.equal(store.getJournalAnalysis(journal.id).id, "analysis-1");
  assert.equal(fs.readFileSync(legacy, "utf8"), data);
  store.deleteEvent(event.id);
  store.close();
  store = createStore(file);
  assert.equal(store.listEvents().length, 0);
  store.close();
});

test("invalid JSON fails migration and allows a corrected retry", (t) => {
  const directory = fixture(t);
  const legacy = path.join(directory, "calendar.json");
  const file = path.join(directory, "calendar.sqlite");
  fs.writeFileSync(legacy, "{broken");
  assert.throws(() => createStore(file));
  fs.writeFileSync(legacy, JSON.stringify({ events: [event], journals: [journal] }));
  const store = createStore(file);
  assert.equal(store.listEvents().length, 1);
  store.close();
});

test("failed SQL insert rolls back every event and the batch receipt", () => {
  const store = createStore(":memory:");
  try {
    store.createJournal(journal);
    store.saveJournalAnalysis({ id: "analysis-1", journalId: journal.id });
    const before = store.listEvents().length;
    assert.throws(() => store.applyAnalysis(journal.id, "analysis-1", () => [event, event]));
    assert.equal(store.listEvents().length, before);
    assert.equal(store.getAppliedBatch("analysis-1"), null);
  } finally { store.close(); }
});

test("receipt survives restart and returns original events after analysis changes", (t) => {
  const file = path.join(fixture(t), "calendar.sqlite");
  let store = createStore(file);
  store.createJournal(journal);
  store.saveJournalAnalysis({ id: "analysis-1", journalId: journal.id });
  const first = store.applyAnalysis(journal.id, "analysis-1", () => [event]);
  store.close();
  store = createStore(file);
  store.saveJournalAnalysis({ id: "analysis-2", journalId: journal.id });
  const retry = store.applyAnalysis(journal.id, "analysis-1", () => { throw new Error("must not run"); });
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.events, first.events);
  assert.equal(store.listEvents().filter((item) => item.id === event.id).length, 1);
  store.updateJournal(journal.id, { content: "Changed" });
  assert.equal(store.getJournalAnalysis(journal.id), null);
  assert.throws(() => store.applyAnalysis(journal.id, "analysis-2", () => []), /stale/);
  store.deleteJournal(journal.id);
  assert.equal(store.getAppliedBatch("analysis-1"), null);
  store.close();
});

test("online backup can be reopened with data intact", async (t) => {
  const directory = fixture(t);
  const store = createStore(path.join(directory, "source.sqlite"));
  store.createJournal(journal);
  const target = path.join(directory, "backup.sqlite");
  await store.backup(target);
  store.close();
  const restored = createStore(target);
  assert.deepEqual(restored.getJournal(journal.id), journal);
  restored.close();
});

test("simultaneous processes initialize one schema and apply one batch", async (t) => {
  const file = path.join(fixture(t), "calendar.sqlite");
  const modulePath = path.resolve(__dirname, "../server/store.cjs");
  const run = (script) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
  });
  const open = `const store = require(${JSON.stringify(modulePath)}).createStore(${JSON.stringify(file)});`;
  await Promise.all(Array.from({ length: 4 }, () => run(`${open} store.close();`)));
  let store = createStore(file);
  store.createJournal(journal);
  store.saveJournalAnalysis({ id: "multi", journalId: journal.id });
  store.close();
  const results = await Promise.all(Array.from({ length: 4 }, () => run(`${open}
    console.log(store.applyAnalysis(${JSON.stringify(journal.id)}, 'multi', () => [${JSON.stringify(event)}]).replayed); store.close();`)));
  assert.equal(results.filter((result) => result === "false").length, 1);
  assert.equal(results.filter((result) => result === "true").length, 3);
  store = createStore(file);
  assert.equal(store.listEvents().filter((item) => item.id === event.id).length, 1);
  store.close();
});
