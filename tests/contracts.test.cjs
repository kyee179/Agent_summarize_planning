const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { schemas } = require("../server/contracts/schemas.cjs");
const { assertSchema, assertBundle, ContractError, isInstant } = require("../server/contracts/validate.cjs");
const { collectJournalEvidence, assertAnalysis, contractAnalysis } = require("../server/contracts/analysis.cjs");
const { localRuleBasedAnalysis, normalizeRemoteAnalysis, analyzeJournal } = require("../server/journalAnalyzer.cjs");
const { createStore } = require("../server/store.cjs");
const { wallClockInstant } = require("../server/contracts/time.cjs");

const journal = { id: "j", type: "daily", journalDate: "2026-10-11", title: "Synthetic fixture",
  content: "I need to finish the project.", updatedAt: "2026-10-11T00:00:00Z" };
const input = { journal, settings: { timezone: "Asia/Shanghai" }, availability: [{ startsAt: "20:00", endsAt: "24:00" }] };
function sample() { return localRuleBasedAnalysis(input); }
function rejects(change, pattern) {
  const bundle = structuredClone(sample().contract);
  change(bundle);
  assert.throws(() => assertBundle(bundle), (error) => error instanceof ContractError && error.issues.some((issue) => pattern.test(issue.message)));
}

test("local analysis produces a grounded v1 contract and safe compatibility projection", () => {
  const analysis = sample();
  assertAnalysis(analysis);
  assert.equal(analysis.contract.schemaVersion, 1);
  assert.equal(analysis.contract.tasks[0].deadline, null);
  assert.equal(analysis.contract.tasks[0].importance.basis, "inferred");
  assert.equal(analysis.contract.estimates[0].basis, "local_heuristic");
  assert.equal(analysis.tasks[0].urgency, "unknown");
  assert.equal(analysis.scheduleDrafts[0].startsAt, "2026-10-11T12:00:00.000Z");
  assert.equal(analysis.contract.evidence[0].excerpt, "I need to finish the project");
  assert.equal(analysis.contract.plan.state, "proposal");
});

test("exported JSON schemas match the runtime source of truth", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/schemas/v1", `${name}.json`), "utf8")), schema);
  }
  assertAnalysis(JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/examples/analysis-v1.json"), "utf8")));
});

test("shape validation rejects unknown fields, coercion, unsupported versions and impossible dates", () => {
  const bundle = sample().contract;
  assert.throws(() => assertSchema("bundle", { ...bundle, schemaVersion: 2 }), ContractError);
  assert.throws(() => assertSchema("bundle", { ...bundle, extra: true }), ContractError);
  rejects((b) => { b.estimates[0].effortMinutes.expected = "90"; }, /integer/);
  rejects((b) => { b.plan.targetDate = "2026-02-30"; }, /format/);
  rejects((b) => { b.plan.timezone = "Invalid/Zone"; }, /format/);
  assert.equal(isInstant("2026-02-30T09:00:00Z"), false);
  assert.equal(isInstant("2026-10-11T25:00:00Z"), false);
  assert.equal(isInstant("2026-10-11T09:00:00+14:30"), false);
  assert.equal(isInstant("2026-10-11T09:00:00"), false);
});

test("semantic validation rejects broken links, duplicate IDs, cyclic dependencies and unaccounted tasks", () => {
  rejects((b) => { b.tasks[0].evidenceIds = ["missing"]; }, /Unknown reference/);
  rejects((b) => { b.tasks[0].estimateId = "missing"; }, /belong/);
  rejects((b) => { b.evidence.push(b.evidence[0]); }, /unique/);
  rejects((b) => { b.tasks[0].dependsOn = [b.tasks[0].id]; }, /itself/);
  rejects((b) => {
    const first = b.tasks[0];
    b.tasks.push({ ...first, id: "task:2", estimateId: null, dependsOn: [first.id] });
    first.dependsOn = ["task:2"];
    b.plan.unscheduled.push({ taskId: "task:2", reason: "dependency", explanation: "Wait" });
  }, /cycle/);
  rejects((b) => { b.plan.blocks = []; }, /explicit unscheduled reason/);
});

test("deadlines and completion need matching facts; activity cannot assert task facts", () => {
  rejects((b) => { b.tasks[0].deadline = { at: "2026-10-12T10:00:00Z", kind: "hard", evidenceIds: [b.evidence[0].id] }; }, /Deadline needs/);
  rejects((b) => { b.tasks[0].status = "completed"; }, /Completion/);
  rejects((b) => { b.evidence[0].sourceType = "activity"; b.evidence[0].facts = [{ field: "status", value: "completed" }]; }, /cannot assert/);
  const b = structuredClone(sample().contract);
  const at = "2026-10-12T10:00:00Z";
  b.evidence[0].facts = [{ field: "deadline", value: at }];
  b.tasks[0].deadline = { at, kind: "hard", evidenceIds: [b.evidence[0].id] };
  assertBundle(b);
  b.evidence[0].verification = "unverified";
  assert.throws(() => assertBundle(b), ContractError);
});

test("inferred importance cannot be promoted to a user commitment without supporting facts", () => {
  rejects((b) => { b.tasks[0].importance.basis = "user"; }, /Asserted importance/);
  rejects((b) => { b.tasks[0].importance.level = "unknown"; }, /Unknown importance/);
});

test("estimates preserve uncertainty, range ordering and source requirements", () => {
  rejects((b) => { b.estimates[0].effortMinutes.low = 200; }, /low\/high/);
  rejects((b) => { b.estimates[0].confidence = "high"; }, /cannot have high/);
  rejects((b) => { b.estimates[0].assumptions = []; }, /needs assumptions/);
  rejects((b) => { b.estimates[0].basis = "official_reference"; }, /appropriate source/);
  rejects((b) => { b.estimates[0].basis = "unknown"; }, /null effort/);
  const b = structuredClone(sample().contract);
  Object.assign(b.estimates[0], { basis: "unknown", effortMinutes: null, confidence: "unknown", assumptions: [] });
  b.plan.blocks = [];
  b.plan.unscheduled = [{ taskId: b.tasks[0].id, reason: "unknown_estimate", explanation: "Confirm effort first" }];
  assertBundle(b);
});

test("blocks must use the selected estimate, contain full effort, and fit availability", () => {
  rejects((b) => { b.plan.blocks[0].endsAt = b.plan.blocks[0].startsAt; }, /end must follow/);
  rejects((b) => { b.plan.blocks[0].effortMinutes = 30; }, /elapsed minutes/);
  rejects((b) => {
    b.plan.blocks[0].endsAt = "2026-10-11T12:30:00Z";
    b.plan.blocks[0].effortMinutes = 30;
  }, /silent truncation/);
  rejects((b) => { b.plan.blocks[0].startsAt = "2026-10-10T12:00:00Z"; }, /availability window/);
  rejects((b) => { b.tasks[0].status = "blocked"; }, /Only open/);
  rejects((b) => { b.plan.unscheduled.push({ taskId: b.tasks[0].id, reason: "blocked", explanation: "Wait" }); }, /both scheduled/);
  rejects((b) => {
    const at = "2026-10-11T12:30:00Z";
    b.evidence[0].facts = [{ field: "deadline", value: at }];
    b.tasks[0].deadline = { at, kind: "hard", evidenceIds: [b.evidence[0].id] };
  }, /hard deadline/);
  rejects((b) => {
    b.tasks.push({ ...b.tasks[0], id: "dependency", estimateId: null });
    b.tasks[0].dependsOn = ["dependency"];
    b.plan.unscheduled.push({ taskId: "dependency", reason: "needs_clarification", explanation: "Confirm scope" });
  }, /Dependencies need/);
});

test("overnight availability and timezone ambiguity fail explicitly; midnight is the next day", () => {
  rejects((b) => { b.plan.availability = [{ startsAt: "23:00", endsAt: "01:00" }]; }, /split overnight/);
  assert.equal(wallClockInstant("2026-10-11", "24:00", "Asia/Shanghai"), "2026-10-11T16:00:00.000Z");
  assert.throws(() => wallClockInstant("2026-03-08", "02:30", "America/New_York"), ContractError);
  assert.throws(() => wallClockInstant("2026-11-01", "01:30", "America/New_York"), ContractError);
});

test("short and empty availability leave tasks unscheduled rather than shorten work", () => {
  for (const availability of [[], [{ startsAt: "20:00", endsAt: "20:30" }]]) {
    const result = localRuleBasedAnalysis({ ...input, availability });
    assert.equal(result.scheduleDrafts.length, 0);
    assert.equal(result.contract.plan.unscheduled.length, 1);
  }
  assert.equal(localRuleBasedAnalysis({ ...input, journal: { ...journal, content: "I finished the project." } }).tasks.length, 0);
});

test("provider normalization rejects fabricated evidence and changing workflow constraints", () => {
  const analysis = sample();
  const context = { trustedEvidence: analysis.contract.evidence, expectedPlan: analysis.contract.plan };
  const remote = { summary: "Tasks found", weeklySummary: "Project work", cautions: [], contract: analysis.contract };
  assertAnalysis(normalizeRemoteAnalysis(remote, "test", "stub", context));
  const fabricated = structuredClone(remote);
  fabricated.contract.evidence[0].facts = [{ field: "effort_minutes", value: 90 }];
  assert.throws(() => normalizeRemoteAnalysis(fabricated, "test", "stub", context), ContractError);
  const moved = structuredClone(remote);
  moved.contract.plan.bufferMinutes = 0;
  assert.throws(() => normalizeRemoteAnalysis(moved, "test", "stub", context), ContractError);
  assert.throws(() => normalizeRemoteAnalysis({ ...remote, id: "spoofed" }, "test", "stub", context), ContractError);
});

test("invalid provider JSON contracts trigger a validated local fallback without real network calls", async (t) => {
  const previousFetch = global.fetch, previousProvider = process.env.AI_PROVIDER, previousKey = process.env.GROQ_API_KEY;
  t.after(() => {
    global.fetch = previousFetch;
    for (const [key, value] of [["AI_PROVIDER", previousProvider], ["GROQ_API_KEY", previousKey]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "synthetic-test-only";
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"contract":{"schemaVersion":999}}' } }] }) }; };
  const result = await analyzeJournal(input);
  assert.equal(result.provider, "local-fallback");
  assert.match(result.cautions[0], /contract validation/);
  assertAnalysis(result);
  await assert.rejects(() => analyzeJournal({ ...input, availability: [{ startsAt: "25:00", endsAt: "26:00" }] }), ContractError);
  assert.equal(calls, 1, "invalid inputs must be rejected before calling a provider");
});

test("store rejects a corrupt projection or stale source before replacing an analysis", () => {
  const store = createStore(":memory:");
  try {
    store.createJournal(journal);
    const analysis = { ...sample(), id: "a", journalId: journal.id };
    store.saveJournalAnalysis(analysis);
    const corrupt = structuredClone(analysis);
    corrupt.tasks[0].estimatedMinutes = 1;
    assert.throws(() => store.saveJournalAnalysis(corrupt), ContractError);
    assert.deepEqual(store.getJournalAnalysis(journal.id), analysis);
    store.updateJournal(journal.id, { content: "Changed source" });
    assert.throws(() => store.saveJournalAnalysis(analysis), /Source evidence changed/);
    assert.equal(store.getJournalAnalysis(journal.id), null);
  } finally { store.close(); }
});

test("workflow collects exact excerpts and detects related source changes", () => {
  const evidence = collectJournalEvidence({ ...input, relatedJournals: [{ ...journal, id: "related", content: "I should read the assessment." }] });
  assert.equal(evidence[1].sourceId, "related");
  assert.equal(evidence[1].facts.length, 0);
  assert.notEqual(evidence[0].sourceVersion, evidence[1].sourceVersion);
  const analysis = sample();
  assert.throws(() => assertAnalysis({ ...analysis, summary: 42 }), ContractError);
  assertAnalysis(contractAnalysis(analysis, analysis.contract));
});
