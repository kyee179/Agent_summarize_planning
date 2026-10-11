const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scheduleBundle, scheduleAnalysis, assertScheduleCurrent, calendarContext } = require("../server/scheduler.cjs");
const { expandEvents } = require("../server/eventOccurrences.cjs");
const { localRuleBasedAnalysis, normalizeRemoteAnalysis } = require("../server/journalAnalyzer.cjs");
const { assertBundle, ContractError } = require("../server/contracts/validate.cjs");
const { wallClockInstant } = require("../server/contracts/time.cjs");
const { createStore } = require("../server/store.cjs");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const at = (clock, date = "2026-10-11") => `${date}T${clock}:00Z`;

function fixture(specs = [{ id: "t", minutes: 90 }], availability = [{ startsAt: "09:00", endsAt: "17:00" }]) {
  const evidence = [{ id: "e", sourceType: "user", sourceId: "fixture", sourceVersion: "1", locator: null,
    excerpt: "Synthetic confirmed tasks", observedAt: at("00:00"), sourceTimestamp: null, verification: "user_confirmed", facts: [] }];
  const tasks = specs.map((spec) => {
    if (spec.deadline) evidence[0].facts.push({ field: "deadline", value: spec.deadline });
    if (spec.status === "completed" || spec.status === "cancelled") evidence[0].facts.push({ field: "status", value: spec.status });
    return { id: spec.id, title: spec.id, description: "Synthetic task", status: spec.status || "open", evidenceIds: ["e"],
      importance: { level: spec.importance || "medium", basis: "inferred", reason: "Fixture ordering", evidenceIds: ["e"] },
      deadline: spec.deadline ? { at: spec.deadline, kind: spec.deadlineKind || "hard", evidenceIds: ["e"] } : null,
      estimateId: `estimate:${spec.id}`, dependsOn: spec.dependsOn || [], clarificationQuestions: [] };
  });
  const estimates = specs.map((spec) => ({ id: `estimate:${spec.id}`, taskId: spec.id, scope: spec.scope || "remaining_task",
    basis: spec.minutes === null ? "unknown" : "model", effortMinutes: spec.minutes === null ? null : { low: spec.minutes, expected: spec.minutes, high: spec.minutes },
    confidence: spec.minutes === null ? "unknown" : "low", evidenceIds: [], assumptions: ["Synthetic estimate"], rationale: "Fixture" }));
  return { schemaVersion: 1, evidence, tasks, estimates, plan: { id: "plan", state: "proposal", timezone: "UTC",
    targetDate: "2026-10-11", availability, bufferMinutes: 15, blocks: [], unscheduled: [], warnings: [] } };
}
function event(id, start, end, repeat = "none", extra = {}) {
  return { id, title: id, startsAt: at(start), endsAt: at(end), repeat, ...extra };
}
const run = (bundle, events = [], notBefore = null) => scheduleBundle(bundle, { events, notBefore }).contract;

test("scheduler subtracts existing events plus buffers and chooses the earliest full free session", () => {
  const output = run(fixture(), [event("meeting", "09:00", "10:00")]);
  assert.equal(output.plan.blocks[0].startsAt, at("10:15").replace("Z", ".000Z"));
  assert.equal(output.plan.blocks[0].endsAt, at("11:45").replace("Z", ".000Z"));
  assertBundle(output);
});

test("overlapping/unsorted availability and events are merged without double-counting capacity", () => {
  const windows = [{ startsAt: "11:00", endsAt: "14:00" }, { startsAt: "09:00", endsAt: "12:00" }];
  const events = [event("b", "10:30", "11:30"), event("a", "10:00", "11:00")];
  const output = run(fixture([{ id: "t", minutes: 120 }], windows), events);
  assert.equal(output.plan.blocks[0].startsAt, at("11:45").replace("Z", ".000Z"));
  const reordered = run(fixture([{ id: "t", minutes: 120 }], [...windows].reverse()), [...events].reverse());
  assert.deepEqual(reordered.plan.blocks, output.plan.blocks);
  const spanning = run(fixture([{ id: "t", minutes: 240 }], windows));
  assert.equal(spanning.plan.blocks[0].startsAt, at("09:00").replace("Z", ".000Z"));
  assert.equal(spanning.plan.blocks[0].endsAt, at("13:00").replace("Z", ".000Z"));
});

test("oversized tasks do not stop smaller ready tasks from using the remaining gaps", () => {
  const output = run(fixture([{ id: "large", minutes: 120, importance: "high" }, { id: "small", minutes: 30, importance: "low" }], [{ startsAt: "09:00", endsAt: "10:00" }]));
  assert.equal(output.plan.blocks[0].taskId, "small");
  assert.equal(output.plan.unscheduled[0].taskId, "large");
  assert.equal(output.plan.unscheduled[0].reason, "insufficient_capacity");
});

test("ready tasks order by deadline, importance, then stable ID regardless of input order", () => {
  const specs = [{ id: "z", minutes: 30, importance: "high" }, { id: "b", minutes: 30 }, { id: "a", minutes: 30 }, { id: "deadline", minutes: 30, importance: "low", deadline: at("12:00") }];
  const output = run(fixture(specs));
  assert.deepEqual(output.plan.blocks.map((block) => block.taskId), ["deadline", "z", "a", "b"]);
  assert.deepEqual(run(fixture([...specs].reverse())).plan.blocks, output.plan.blocks);
});

test("hard deadlines are enforced while missed targets warn; insufficient effort is never truncated", () => {
  const hard = run(fixture([{ id: "hard", minutes: 90, deadline: at("10:00") }]));
  assert.equal(hard.plan.blocks.length, 0);
  assert.match(hard.plan.unscheduled[0].explanation, /hard deadline/);
  const target = run(fixture([{ id: "target", minutes: 90, deadline: at("10:00"), deadlineKind: "target" }]));
  assert.equal(target.plan.blocks[0].effortMinutes, 90);
  assert.match(target.plan.warnings[0], /target deadline/);
});

test("dependency chains allocate full remaining tasks before dependents regardless of importance", () => {
  const output = run(fixture([{ id: "dependent", minutes: 30, importance: "high", dependsOn: ["prerequisite"] }, { id: "prerequisite", minutes: 60, importance: "low" }]));
  assert.deepEqual(output.plan.blocks.map((block) => block.taskId), ["prerequisite", "dependent"]);
  assert.equal(output.plan.blocks[1].startsAt, at("10:15").replace("Z", ".000Z"));
});

test("blocked/unknown/inactive tasks and next-session prerequisites propagate explicit reasons", () => {
  const specs = [{ id: "session", minutes: 30, scope: "next_session" }, { id: "wait", minutes: 30, dependsOn: ["session"] },
    { id: "blocked", minutes: 30, status: "blocked" }, { id: "unknown", minutes: null }, { id: "done", minutes: 30, status: "completed" }];
  const output = run(fixture(specs));
  const reasons = Object.fromEntries(output.plan.unscheduled.map((item) => [item.taskId, item.reason]));
  assert.deepEqual(reasons, { blocked: "blocked", done: "inactive", unknown: "unknown_estimate", wait: "dependency" });
  assert.equal(output.plan.blocks[0].taskId, "session");
  const completed = run(fixture([{ id: "done", minutes: 30, status: "completed" }, { id: "next", minutes: 30, dependsOn: ["done"] }]));
  assert.equal(completed.plan.blocks[0].taskId, "next");
});

test("cross-midnight events and buffers from outside the target day still block availability", () => {
  const bundle = fixture([{ id: "t", minutes: 30 }], [{ startsAt: "00:00", endsAt: "03:00" }]);
  const output = run(bundle, [event("overnight", "23:00", "01:00", "none", { startsAt: at("23:00", "2026-10-10") })]);
  assert.equal(output.plan.blocks[0].startsAt, at("01:15").replace("Z", ".000Z"));
  const adjacent = run(bundle, [event("outside", "22:00", "23:55", "none", { startsAt: at("22:00", "2026-10-10"), endsAt: at("23:55", "2026-10-10") })]);
  assert.equal(adjacent.plan.blocks[0].startsAt, at("00:10").replace("Z", ".000Z"));
});

test("zero-buffer boundaries use half-open intervals and exact fits are accepted", () => {
  const bundle = fixture([{ id: "t", minutes: 60 }], [{ startsAt: "10:00", endsAt: "11:00" }]);
  bundle.plan.bufferMinutes = 0;
  assert.equal(run(bundle, [event("meeting", "09:00", "10:00")]).plan.blocks.length, 1);
});

test("explicit notBefore is rounded up to a minute and elapsed days remain unscheduled", () => {
  assert.equal(run(fixture([{ id: "t", minutes: 30 }]), [], "2026-10-11T09:20:30Z").plan.blocks[0].startsAt, at("09:21").replace("Z", ".000Z"));
  assert.equal(run(fixture(), [], at("00:00", "2026-10-12")).plan.blocks.length, 0);
});

test("the store loads recurring anchors outside a normal date query", () => {
  const store = createStore(":memory:");
  try {
    store.createEvent(event("weekly", "09:00", "10:00", "weekly", { startsAt: at("09:00", "2026-10-04"), endsAt: at("10:00", "2026-10-04") }));
    const range = { from: at("00:00"), to: at("00:00", "2026-10-12") };
    assert.equal(store.listEvents(range).some((item) => item.id === "weekly"), false);
    assert.equal(store.listPlanningEvents(range).some((item) => item.id === "weekly"), true);
  } finally { store.close(); }
});

test("recurrence expands daily, weekly, monthly and yearly anchors in their named timezone", () => {
  const from = Date.parse(at("00:00")), to = Date.parse(at("00:00", "2026-10-12"));
  for (const [repeat, date] of [["daily", "2020-01-01"], ["weekly", "2026-10-04"], ["monthly", "2026-01-11"], ["yearly", "2020-10-11"]]) {
    const events = [event(repeat, "09:00", "10:00", repeat, { startsAt: at("09:00", date), endsAt: at("10:00", date), recurrenceTimezone: "UTC" })];
    const instances = expandEvents(events, { from, to, timezone: "Asia/Shanghai" });
    assert.equal(instances.length, 1);
    assert.equal(instances[0].start, Date.parse(at("09:00")));
  }
});

test("month-end and leap-day repeats skip invalid dates without anchor drift or phantom instances", () => {
  const events = [event("month", "09:00", "10:00", "monthly", { startsAt: at("09:00", "2026-01-31"), endsAt: at("10:00", "2026-01-31") }),
    event("leap", "11:00", "12:00", "yearly", { startsAt: at("11:00", "2024-02-29"), endsAt: at("12:00", "2024-02-29") })];
  const range = (from, to) => expandEvents(events, { from: Date.parse(from), to: Date.parse(to), timezone: "UTC" });
  assert.equal(range(at("00:00", "2026-02-01"), at("00:00", "2026-03-01")).length, 0);
  assert.equal(range(at("00:00", "2026-03-31"), at("00:00", "2026-04-01"))[0].eventId, "month");
  assert.equal(range(at("00:00", "2028-02-29"), at("00:00", "2028-03-01"))[0].eventId, "leap");
});

test("daily recurrence keeps local wall time across DST, skips gaps, and reserves both ambiguous offsets", () => {
  const spring = event("spring", "07:30", "08:00", "daily", { startsAt: at("07:30", "2026-03-07"), endsAt: at("08:00", "2026-03-07"), recurrenceTimezone: "America/New_York" });
  const range = (event, date, next) => expandEvents([event], { from: Date.parse(at("00:00", date)), to: Date.parse(at("00:00", next)), timezone: "UTC" });
  assert.equal(range(spring, "2026-03-08", "2026-03-09").length, 0);
  assert.equal(range(spring, "2026-03-09", "2026-03-10")[0].start, Date.parse(at("06:30", "2026-03-09")));
  const fall = event("fall", "05:30", "06:00", "daily", { startsAt: at("05:30", "2026-10-31"), endsAt: at("06:00", "2026-10-31"), recurrenceTimezone: "America/New_York" });
  assert.deepEqual(range(fall, "2026-11-01", "2026-11-02").map((item) => item.start), [Date.parse(at("05:30", "2026-11-01")), Date.parse(at("06:30", "2026-11-01"))]);
  assert.throws(() => wallClockInstant("2026-11-01", "01:30", "America/New_York"), ContractError);
});

test("recurrences preserve seconds, milliseconds and multi-day overlap", () => {
  const events = [event("seconds", "09:00", "10:00", "daily", { startsAt: "2026-10-01T09:00:12.345Z", endsAt: "2026-10-02T10:00:12.345Z" })];
  const occurrences = expandEvents(events, { from: Date.parse(at("00:00")), to: Date.parse(at("00:00", "2026-10-12")), timezone: "UTC" });
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].start, Date.parse("2026-10-10T09:00:12.345Z"));
});

test("malformed calendars and excessive recurrence duration fail closed", () => {
  assert.throws(() => run(fixture(), [{ id: "bad", startsAt: "invalid", endsAt: at("10:00") }]), ContractError);
  assert.throws(() => run(fixture(), [event("bad", "09:00", "10:00", "unsupported")]), ContractError);
  assert.throws(() => run(fixture(), [event("long", "09:00", "10:00", "daily", { startsAt: at("09:00", "2020-01-01"), endsAt: at("10:00", "2022-01-01") })]), ContractError);
});

test("fingerprints ignore titles and unrelated days but detect new occupancy or changed planning settings", () => {
  const source = fixture(), events = [event("meeting", "09:00", "10:00")];
  const ctx = calendarContext(source.plan, events);
  assert.equal(ctx.calendarFingerprint, calendarContext(source.plan, [{ ...events[0], title: "Renamed" }]).calendarFingerprint);
  assert.equal(ctx.calendarFingerprint, calendarContext(source.plan, [...events, event("later", "09:00", "10:00", "none", { startsAt: at("09:00", "2026-10-12"), endsAt: at("10:00", "2026-10-12") })]).calendarFingerprint);
  const analysis = localRuleBasedAnalysis({ journal: { id: "j", journalDate: "2026-10-11", content: "I should do the project." }, settings: { timezone: "UTC" }, availability: source.plan.availability });
  const settings = { timezone: "UTC", defaultAvailability: source.plan.availability };
  const scheduled = scheduleAnalysis(analysis, { events, settings, availabilitySource: "settings", notBefore: at("08:00") });
  assertScheduleCurrent(scheduled, events, settings, at("08:10"));
  assert.throws(() => assertScheduleCurrent(scheduled, [...events, event("new", "14:00", "15:00")], settings), /Calendar availability changed/);
  assert.throws(() => assertScheduleCurrent(scheduled, events, { ...settings, timezone: "Asia/Shanghai" }), /settings changed/);
  assert.throws(() => assertScheduleCurrent(scheduled, events, settings, at("12:00")), /start time has passed/);
});

test("provider-proposed allocations are replaced by the same deterministic calendar policy", () => {
  const analysis = localRuleBasedAnalysis({ journal: { id: "j", journalDate: "2026-10-11", content: "I need to do the project." }, settings: { timezone: "UTC" }, availability: [{ startsAt: "09:00", endsAt: "17:00" }] });
  const remote = { summary: "Project work", weeklySummary: "Reflection", cautions: [], contract: analysis.contract };
  const context = { trustedEvidence: analysis.contract.evidence, expectedPlan: analysis.contract.plan, existingEvents: [event("meeting", "09:00", "11:00")] };
  const output = normalizeRemoteAnalysis(remote, "test", "fake", context);
  assert.equal(output.contract.plan.blocks[0].startsAt, at("11:15").replace("Z", ".000Z"));
});

test("generated schedules preserve invariants and permutation determinism over varied synthetic calendars", () => {
  let state = 42;
  const random = (max) => { state = (state * 1664525 + 1013904223) >>> 0; return state % max; };
  for (let trial = 0; trial < 30; trial++) {
    const specs = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, minutes: [30, 45, 60, 120][random(4)], importance: ["high", "medium", "low"][random(3)] }));
    const events = Array.from({ length: 4 }, (_, i) => {
      const start = Date.parse(at("09:00")) + random(400) * 60000;
      return { id: `e${i}`, startsAt: new Date(start).toISOString(), endsAt: new Date(start + (15 + random(60)) * 60000).toISOString() };
    });
    const output = run(fixture(specs), events);
    assertBundle(output);
    const { busy } = calendarContext(output.plan, events);
    for (const block of output.plan.blocks) assert.equal(busy.some((item) => Date.parse(block.startsAt) < item.end && Date.parse(block.endsAt) > item.start), false);
    assert.deepEqual(run(fixture([...specs].reverse()), [...events].reverse()).plan.blocks, output.plan.blocks);
  }
});

test("independent processes apply competing plans under one writer lock; only one wins", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-scheduling-race-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "calendar.sqlite");
  const settings = { timezone: "UTC", defaultAvailability: [{ startsAt: "20:00", endsAt: "24:00" }] };
  const store = createStore(file);
  try {
    store.updateSettings(settings);
    for (const id of ["j1", "j2"]) {
      const journal = { id, type: "daily", journalDate: "2026-10-11", content: "I should do the project." };
      store.createJournal(journal);
      const analysis = scheduleAnalysis(localRuleBasedAnalysis({ journal, settings, availability: settings.defaultAvailability }),
        { events: [], settings, availabilitySource: "settings", notBefore: at("08:00") });
      store.saveJournalAnalysis({ ...analysis, id: `a:${id}`, journalId: id });
    }
  } finally { store.close(); }
  const storePath = path.resolve(__dirname, "../server/store.cjs"), schedulerPath = path.resolve(__dirname, "../server/scheduler.cjs");
  const execute = (id) => new Promise((resolve, reject) => {
    const script = `const store = require(${JSON.stringify(storePath)}).createStore(${JSON.stringify(file)});
      const {assertScheduleCurrent, planningRange} = require(${JSON.stringify(schedulerPath)});
      try {
        store.applyAnalysis(${JSON.stringify(id)}, ${JSON.stringify(`a:${id}`)}, analysis => {
          assertScheduleCurrent(analysis, store.listPlanningEvents(planningRange(analysis.contract.plan)), store.getSettings(), ${JSON.stringify(at("08:00"))});
          return analysis.scheduleDrafts.map((draft, index) => ({...draft, id: ${JSON.stringify(id)} + ':' + index}));
        }); console.log('applied');
      } catch (error) { if (error.status !== 409) throw error; console.log('conflict'); }
      finally {store.close();}`;
    const child = spawn(process.execPath, ["-e", script], { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
  });
  assert.deepEqual((await Promise.all([execute("j1"), execute("j2")])).sort(), ["applied", "conflict"]);
});
