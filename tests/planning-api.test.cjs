const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server/index.cjs");
const { createStore } = require("../server/store.cjs");
const { assertAnalysis } = require("../server/contracts/analysis.cjs");
const { localRuleBasedAnalysis } = require("../server/journalAnalyzer.cjs");
async function fixture(t) {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "local";
  const store = createStore(":memory:");
  store.updateSettings({ timezone: "Asia/Shanghai" });
  const apiToken = "synthetic-planning-test-token-32-characters";
  let currentTime = "2026-10-11T08:00:00Z";
  const server = createApp({ store, apiToken, clock: () => currentTime }).listen(0, "127.0.0.1");
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
  return { request, store, setTime: (value) => { currentTime = value; } };
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

test("Analyze avoids an old weekly anchor and serializes scheduling context", async (t) => {
  const { request } = await fixture(t);
  const meeting = await request("/api/events", { title: "Repeating meeting", startsAt: "2026-10-04T12:00:00Z", endsAt: "2026-10-04T13:00:00Z",
    repeat: "weekly", calendarType: "personal", notificationFormat: "Desktop notification" });
  assert.equal(meeting.status, 201);
  assert.equal(meeting.body.recurrenceTimezone, "Asia/Shanghai");
  const analysis = await request("/api/journals/j/analyze", {});
  assert.equal(analysis.status, 201);
  assert.equal(analysis.body.scheduling.algorithm, "greedy-v1");
  assert.equal(analysis.body.scheduling.availabilitySource, "settings");
  assert.equal(analysis.body.contract.plan.blocks[0].startsAt, "2026-10-11T13:15:00.000Z");
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id })).status, 201);
});

test("calendar occupancy changes return 409 and write neither events nor receipt", async (t) => {
  const { request, store } = await fixture(t);
  const analysis = await request("/api/journals/j/analyze", {});
  const first = analysis.body.contract.plan.blocks[0];
  store.createEvent({ id: "late-meeting", startsAt: first.startsAt, endsAt: first.endsAt });
  const count = store.listEvents().length;
  const applied = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(applied.status, 409);
  assert.match(applied.body.error, /Calendar availability changed/);
  assert.equal(store.listEvents().length, count);
  assert.equal(store.getAppliedBatch(analysis.body.id), null);
});

test("default availability/timezone changes invalidate settings plans while request availability is independent", async (t) => {
  const { request, store } = await fixture(t);
  const analysis = await request("/api/journals/j/analyze", {});
  store.updateSettings({ defaultAvailability: [{ startsAt: "21:00", endsAt: "24:00" }] });
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id })).status, 409);
  const explicit = await request("/api/journals/j/analyze", { availability: [{ startsAt: "20:00", endsAt: "24:00" }] });
  store.updateSettings({ defaultAvailability: [] });
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: explicit.body.id })).status, 201);
  store.updateSettings({ defaultAvailability: [{ startsAt: "20:00", endsAt: "24:00" }] });
  const next = await request("/api/journals/j/analyze", {});
  store.updateSettings({ timezone: "UTC" });
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: next.body.id })).status, 409);
});

test("two different reviewed plans cannot concurrently claim the same free calendar window", async (t) => {
  const { request, store } = await fixture(t);
  store.createJournal({ id: "j2", type: "daily", title: "Other", journalDate: "2026-10-11", content: "I should do the project.", updatedAt: "2026-10-11T00:00:00Z" });
  const a = await request("/api/journals/j/analyze", {}), b = await request("/api/journals/j2/analyze", {});
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const results = await Promise.all([request("/api/journals/j/apply-drafts", { analysisId: a.body.id }), request("/api/journals/j2/apply-drafts", { analysisId: b.body.id })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const winner = results.find((result) => result.status === 201).body;
  assert.equal(store.listEvents().filter((event) => [a.body.id, b.body.id].includes(event.sourceAnalysisId)).length, winner.events.length);
});

test("unrelated events/title edits do not invalidate a plan and retries survive later calendar edits", async (t) => {
  const { request, store } = await fixture(t);
  store.createEvent({ id: "meeting", title: "Before", startsAt: "2026-10-11T12:00:00Z", endsAt: "2026-10-11T13:00:00Z" });
  const analysis = await request("/api/journals/j/analyze", {});
  store.updateEvent("meeting", { title: "After" });
  store.createEvent({ id: "other-day", startsAt: "2026-10-12T12:00:00Z", endsAt: "2026-10-12T13:00:00Z" });
  const first = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(first.status, 201);
  store.createEvent({ id: "changed", startsAt: "2026-10-11T14:00:00Z", endsAt: "2026-10-11T15:00:00Z" });
  const retry = await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.events, first.body.events);
});

test("elapsed starts are rejected and historical journals default to today's date", async (t) => {
  const { request, store, setTime } = await fixture(t);
  const analysis = await request("/api/journals/j/analyze", {});
  setTime("2026-10-11T12:01:00Z");
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: analysis.body.id })).status, 409);
  store.updateJournal("j", { journalDate: "2026-10-02" });
  const today = await request("/api/journals/j/analyze", {});
  assert.equal(today.status, 201);
  assert.equal(today.body.contract.plan.targetDate, "2026-10-11");
  assert.equal(today.body.contract.plan.blocks[0].startsAt, "2026-10-11T12:01:00.000Z");
  const past = await request("/api/journals/j/analyze", { targetDate: "2026-10-02" });
  assert.equal(past.body.contract.plan.blocks.length, 0);
  assert.equal((await request("/api/journals/j/analyze", { targetDate: "2026-02-30" })).status, 422);
});

test("calendar changes during provider work are rejected before persistence", async (t) => {
  const { request, store } = await fixture(t);
  const previousFetch = global.fetch, provider = process.env.AI_PROVIDER, key = process.env.GROQ_API_KEY;
  t.after(() => {
    global.fetch = previousFetch;
    if (provider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = provider;
    if (key === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = key;
  });
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "synthetic-only";
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.groq.com/")) return previousFetch(url, options);
    store.createEvent({ id: "while-researching", startsAt: "2026-10-11T12:00:00Z", endsAt: "2026-10-11T13:00:00Z" });
    // Invalid provider output intentionally uses the normal local fallback.
    return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
  };
  const result = await request("/api/journals/j/analyze", {});
  assert.equal(result.status, 409);
  assert.equal(store.getJournalAnalysis("j"), null);
});

test("legacy drafts receive live calendar conflict checks and event timestamps reject impossible dates", async (t) => {
  const { request, store } = await fixture(t);
  store.saveJournalAnalysis({ id: "legacy", journalId: "j", scheduleDrafts: [{ title: "Old", startsAt: "2026-10-11T12:00:00Z", endsAt: "2026-10-11T13:00:00Z" }] });
  store.createEvent({ id: "existing", startsAt: "2026-10-11T12:15:00Z", endsAt: "2026-10-11T12:45:00Z" });
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: "legacy" })).status, 409);
  const invalid = await request("/api/events", { title: "Impossible", startsAt: "2026-02-30T10:00:00Z", endsAt: "2026-02-30T11:00:00Z", calendarType: "study", notificationFormat: "Desktop notification" });
  assert.equal(invalid.status, 400);
});

test("API persists a completed tool workflow and preserves review/apply/replay behavior", async (t) => {
  const { request, store } = await fixture(t);
  const eventCount = store.listEvents().length;
  const originalFetch = global.fetch, originalKey = process.env.GROQ_API_KEY;
  t.after(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalKey; });
  process.env.AI_PROVIDER = "groq"; process.env.GROQ_API_KEY = "synthetic";
  let turn = 0, evidence;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.groq.com/")) return originalFetch(url, options);
    const body = JSON.parse(options.body); turn++;
    let name, args;
    if (turn === 1) { name = "read_evidence"; args = { offset: 0, limit: 20 }; }
    if (turn === 2) {
      evidence = JSON.parse(body.messages.at(-1).content).evidence;
      name = "get_planning_context"; args = {};
    }
    if (turn === 3) {
      const plan = JSON.parse(body.messages.at(-1).content);
      const baseline = localRuleBasedAnalysis({ journal: store.getJournal("j"), trustedEvidence: evidence,
        settings: { timezone: plan.timezone }, availability: plan.availability, targetDate: plan.targetDate });
      name = "preview_plan"; args = { proposal: { summary: "The journal reports planned project work.", weeklySummary: "Partial context includes project work and an experiment.", cautions: [],
        summaryEvidenceIds: evidence.filter((item) => item.sourceId === "j").map((item) => item.id), weeklySummaryEvidenceIds: evidence.map((item) => item.id),
        tasks: baseline.contract.tasks, estimates: baseline.contract.estimates } };
    }
    if (turn === 4) { name = "finish_analysis"; args = { previewId: JSON.parse(body.messages.at(-1).content).previewId }; }
    return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null,
      tool_calls: [{ id: `wire:${turn}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }));
  };
  const result = await request("/api/journals/j/analyze", { maxTurns: 999, tools: ["write_calendar"] });
  assert.equal(result.status, 201); assertAnalysis(result.body);
  assert.equal(result.body.provider, "groq"); assert.equal(result.body.agentWorkflow.outcome, "completed");
  assert.equal(result.body.agentWorkflow.turns, 4); assert.equal(store.listEvents().length, eventCount);
  assert.deepEqual(store.getJournalAnalysis("j").agentWorkflow, result.body.agentWorkflow);
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: result.body.id })).status, 201);
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: result.body.id })).status, 200);
});
