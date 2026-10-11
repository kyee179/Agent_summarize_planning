const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server/index.cjs");
const { createStore } = require("../server/store.cjs");
const { assertAnalysis } = require("../server/contracts/analysis.cjs");
async function fixture(t) {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "local";
  const store = createStore(":memory:");
  store.updateSettings({ timezone: "Asia/Shanghai" });
  const apiToken = "synthetic-planning-test-token-32-characters";
  const server = createApp({ store, apiToken }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve)); store.close();
    if (previousProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = previousProvider;
  });
  const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  store.createJournal({ id: "j", type: "daily", title: "Fixture", journalDate: "2026-10-11", content: "I need to do the project.", updatedAt: "2026-10-11T00:00:00Z" });
  store.createJournal({ id: "weekly", type: "weekly", title: "Related", journalDate: "2026-10-05", content: "I should finish the experiment.", updatedAt: "2026-10-11T00:00:00Z" });
  return { request, store };
}

test("API persists a versioned contract and applies events with task/estimate traceability", async (t) => {
  const { request, store } = await fixture(t);
  const analysis = await request("/api/journals/j/analyze", {});
  assert.equal(analysis.status, 201);
  assertAnalysis(analysis.body);
  assert.equal((await request("/api/journals/j/analysis")).body.contractStatus, "versioned");
  const result = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(result.status, 201);
  assert.equal(result.body.events[0].planningSchemaVersion, 1);
  assert.ok(result.body.events[0].sourceTaskId);
  assert.ok(result.body.events[0].sourceEstimateId);
  store.updateJournal("weekly", { content: "Changed after application" });
  const retry = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.events, result.body.events);
});

test("related evidence changes invalidate application with no partial events", async (t) => {
  const { request, store } = await fixture(t);
  const analysis = await request("/api/journals/j/analyze", {});
  assert.equal(analysis.status, 201);
  store.updateJournal("weekly", { content: "Different source wording" });
  const before = store.listEvents().length;
  const result = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /Source evidence changed/);
  assert.equal(store.listEvents().length, before);
  assert.equal(store.getAppliedBatch(analysis.body.id), null);
});

test("invalid planning input/settings return structured issues and never save an analysis", async (t) => {
  const { request, store } = await fixture(t);
  for (const availability of [null, "evening", [{ startsAt: "20:00", endsAt: "19:00" }], [{ startsAt: "25:00", endsAt: "26:00" }]]) {
    const result = await request("/api/journals/j/analyze", { availability });
    assert.equal(result.status, 422);
    assert.ok(result.body.issues.length);
    assert.equal(store.getJournalAnalysis("j"), null);
  }
  assert.equal((await request("/api/settings", { timezone: "Unknown/Zone" }, "PUT")).status, 422);
  assert.equal(store.getSettings().timezone, "Asia/Shanghai");
  assert.equal((await request("/api/settings", { defaultAvailability: [] }, "PUT")).status, 200);
  const empty = await request("/api/journals/j/analyze", {});
  assert.equal(empty.status, 201);
  assert.equal(empty.body.scheduleDrafts.length, 0);
  assert.ok(empty.body.contract.plan.unscheduled.length);
});

test("legacy saved analyses retain their stage 1 read/apply behavior", async (t) => {
  const { request, store } = await fixture(t);
  store.saveJournalAnalysis({ id: "old", journalId: "j", scheduleDrafts: [{ title: "Legacy", startsAt: "2026-10-11T12:00:00Z", endsAt: "2026-10-11T13:00:00Z" }] });
  assert.equal((await request("/api/journals/j/analysis")).body.contractStatus, "legacy");
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: "old" })).status, 201);
});
