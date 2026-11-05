// All source text, outcomes and credentials in this file are invented fixtures.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { createStore } = require("../server/store.cjs");
const { preset, resolve, validate } = require("../server/workingCalendar.cjs");
const { estimate } = require("../server/effortEstimator.cjs");
const {
  localCandidates,
  candidates,
} = require("../server/sourceExtraction.cjs");
const { createGmail, SCOPE } = require("../server/integrations/gmail.cjs");
const { vault } = require("../server/integrations/google.cjs");
const { createWorkCapture } = require("../server/integrations/workCapture.cjs");
const workDetails = {
  category: "review",
  unit: "chart",
  quantity: 3,
  revise_or_create: "revise",
  complexity: 2,
  familiarity: 3,
};
const now = "2030-01-07T11:40:00Z";
function fixture(t) {
  const store = createStore(":memory:", { seedDemo: false });
  store.updateSettings({ timezone: "UTC", workingCalendar: preset() });
  t.after(() => store.close());
  return store;
}
function accepted(store, minutes = 60) {
  const source = store.importTaskSource(
    {
      kind: "email",
      externalId: "invented-message",
      text: "Please revise the three charts by Friday.",
    },
    now,
  );
  const candidate = store.saveTaskDiscovery(source.id, source.version, [
    { title: "Revise three charts", quote: source.text, minutes },
  ])[0];
  const task = store.reviewCandidate(candidate.id, {
    revision: candidate.revision,
    state: "accepted",
  });
  return { source, candidate, taskId: task.taskId };
}
test("weekly hours protect lunch even when per-plan availability spans the whole day", () => {
  assert.deepEqual(
    resolve({ workingCalendar: preset() }, "2030-01-07", [
      { startsAt: "00:00", endsAt: "24:00" },
    ]),
    [
      { startsAt: "09:00", endsAt: "12:30" },
      { startsAt: "14:00", endsAt: "18:00" },
    ],
  );
});
test("weekends, empty exceptions and explicit workday exceptions resolve distinctly", () => {
  const calendar = preset();
  assert.deepEqual(resolve({ workingCalendar: calendar }, "2030-01-06"), []);
  calendar.exceptions = [
    { date: "2030-01-07", intervals: [] },
    { date: "2030-01-06", intervals: [{ startsAt: "10:00", endsAt: "11:00" }] },
  ];
  assert.deepEqual(resolve({ workingCalendar: calendar }, "2030-01-07"), []);
  assert.equal(resolve({ workingCalendar: calendar }, "2030-01-06").length, 1);
});
test("working calendar rejects overlaps and duplicate exception dates", () => {
  const calendar = preset();
  calendar.weekdays[1].push({ startsAt: "10:00", endsAt: "11:00" });
  assert.throws(() => validate(calendar));
  const other = preset();
  other.exceptions = [
    { date: "2030-01-07", intervals: [] },
    { date: "2030-01-07", intervals: [] },
  ];
  assert.throws(() => validate(other));
});
test("legacy hours remain legacy when explicitly edited and are not overwritten by a weekly preset", (t) => {
  const store = fixture(t);
  store.updateSettings({
    defaultAvailability: [{ startsAt: "20:00", endsAt: "24:00" }],
  });
  assert.equal(store.getSettings().workingCalendar, null);
  assert.equal(resolve(store.getSettings(), "2030-01-06")[0].startsAt, "20:00");
});
test("same captured request is one candidate and acceptance is idempotent", (t) => {
  const store = fixture(t),
    item = accepted(store);
  store.saveTaskDiscovery(item.source.id, item.source.version, [
    { title: "Revise three charts", quote: item.source.text, minutes: 60 },
  ]);
  assert.equal(store.listCandidates().length, 1);
  assert.equal(store.listTasks().length, 1);
  const candidate = store.listCandidates()[0];
  store.reviewCandidate(candidate.id, {
    revision: candidate.revision,
    state: "accepted",
  });
  assert.equal(store.listTasks().length, 1);
});
test("two different requests in one source remain distinct tasks", (t) => {
  const store = fixture(t);
  const source = store.importTaskSource(
    {
      kind: "work_app",
      externalId: "fixture-window",
      text: "Please review PR 42. Please update the report.",
    },
    now,
  );
  const items = store.saveTaskDiscovery(source.id, source.version, [
    { title: "Review PR 42", quote: "Please review PR 42." },
    { title: "Update report", quote: "Please update the report." },
  ]);
  for (const c of items)
    store.reviewCandidate(c.id, { revision: c.revision, state: "accepted" });
  assert.equal(store.listTasks().length, 2);
});
test("source discovery rejects invented evidence and stale versions", (t) => {
  const store = fixture(t),
    { source } = accepted(store);
  assert.throws(
    () =>
      store.saveTaskDiscovery(source.id, source.version, [
        { title: "Invented", quote: "Not in this source" },
      ]),
    /exact supporting/,
  );
  assert.throws(
    () => store.saveTaskDiscovery(source.id, "old", []),
    /Source changed/,
  );
});
test("a source-only task fits after lunch and Apply replays without duplicate events", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store);
  const plan = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(plan.contract.schemaVersion, 2);
  assert.equal(
    plan.contract.plan.blocks[0].startsAt,
    "2030-01-07T14:00:00.000Z",
  );
  assert.equal(store.listJournals().length, 0);
  const first = store.applyTaskPlan(plan.id, now),
    again = store.applyTaskPlan(plan.id, now);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.events, first.events);
  assert.equal(store.listEvents().length, 1);
});
test("a 45-minute task can finish exactly at the break boundary", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store, 45);
  const plan = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(plan.contract.plan.blocks[0].endsAt, "2030-01-07T12:30:00.000Z");
});
test("changing source, task facts, settings or calendar rejects Apply without partial events", (t) => {
  for (const change of ["source", "task", "settings", "calendar"]) {
    const store = fixture(t),
      { taskId, source } = accepted(store);
    const plan = store.prepareTaskPlan(
      { taskIds: [taskId], targetDate: "2030-01-07" },
      now,
    );
    if (change === "source")
      store.importTaskSource(
        {
          kind: "email",
          externalId: "invented-message",
          text: "The previous request is cancelled.",
        },
        now,
      );
    if (change === "task")
      store.updateTask(taskId, {
        revision: 1,
        effort: { minutes: 90, scope: "next_session" },
      });
    if (change === "settings")
      store.updateSettings({ planningLeadMinutes: 10 });
    if (change === "calendar")
      store.createEvent({
        id: crypto.randomUUID(),
        title: "Invented meeting",
        startsAt: "2030-01-07T14:00:00Z",
        endsAt: "2030-01-07T15:00:00Z",
      });
    assert.throws(() => store.applyTaskPlan(plan.id, now), /changed/i);
    assert.equal(store.getSourcePlan(plan.id).applied, false);
    assert.equal(store.listEvents().length, change === "calendar" ? 1 : 0);
    if (change === "source") {
      assert.equal(store.listCandidates()[0].state, "needs_review");
      assert.notEqual(store.getSource(source.id).version, source.version);
    }
  }
});
test("confirmed hard deadline cannot be crossed to force a task into the day", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store, 90);
  store.updateTask(taskId, {
    revision: 1,
    deadline: { at: "2030-01-07T13:00:00Z", kind: "hard" },
    importance: "high",
  });
  const plan = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(plan.contract.plan.blocks.length, 0);
  assert.equal(
    plan.contract.plan.unscheduled[0].reason,
    "insufficient_capacity",
  );
});
test("removing captured content preserves accepted task identity and scrubs candidate/plan quotes", (t) => {
  const store = fixture(t),
    { taskId, source } = accepted(store),
    plan = store.prepareTaskPlan(
      { taskIds: [taskId], targetDate: "2030-01-07" },
      now,
    );
  store.revokeTaskSource(source.id);
  assert.equal(store.listTasks()[0].id, taskId);
  assert.equal(store.getSource(source.id).text, "");
  assert.ok(!JSON.stringify(store.listCandidates()).includes("Please revise"));
  assert.ok(
    !JSON.stringify(store.getSourcePlan(plan.id)).includes("Please revise"),
  );
  assert.throws(() => store.applyTaskPlan(plan.id, now), /Source changed/);
});
test("deleting an unrelated diary cannot cascade away a source-backed task", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store);
  store.createJournal({ id: "fixture-diary", content: "Invented diary" });
  store.deleteJournal("fixture-diary");
  assert.equal(store.listTasks()[0].id, taskId);
});
test("portable transfer preserves source-only tasks, working hours and source associations", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store),
    snapshot = store.portableSnapshot();
  assert.equal(snapshot.version, 2);
  const target = createStore(":memory:", {
    seedDemo: false,
    profileId: "other",
  });
  t.after(() => target.close());
  target.importPortable(snapshot);
  assert.equal(target.listTasks()[0].id, taskId);
  assert.equal(target.listSources().length, 1);
  assert.equal(
    target.prepareTaskPlan({ taskIds: [taskId], targetDate: "2030-01-07" }, now)
      .contract.tasks.length,
    1,
  );
});
test("history correction has a stable cold start and shrinks sparse personal evidence", () => {
  const features = {
    category: "report",
    scope: "remaining_task",
    unit: "three_charts",
    baselineVersion: "scoped-v1",
  };
  const history = Array.from({ length: 20 }, (_, i) => ({
    taskId: String(i),
    completed: true,
    actualMinutes: 90,
    baseline: 60,
    baselineVersion: "scoped-v1",
    features,
    completedAt: now,
  }));
  assert.equal(estimate({ baseline: 60, features, now }).minutes, 60);
  assert.equal(
    estimate({ baseline: 60, features, history: history.slice(0, 3), now })
      .minutes,
    70,
  );
  assert.equal(estimate({ baseline: 60, features, history, now }).minutes, 83);
  assert.equal(
    estimate({
      baseline: 60,
      features,
      history: history.map((x) => ({ ...x, completed: false })),
      now,
    }).minutes,
    60,
  );
  assert.equal(
    estimate({
      baseline: 60,
      features,
      history: history.map((x) => ({ ...x, taskId: "same-task" })),
      now,
    }).comparableTasks,
    1,
  );
});
test("old, incomparable and future effort labels do not dominate current estimates", () => {
  const features = {
    category: "report",
    scope: "remaining_task",
    unit: "charts",
  };
  const row = {
    taskId: "a",
    completed: true,
    actualMinutes: 600,
    baseline: 60,
    baselineVersion: "scoped-v1",
    features,
    completedAt: "2020-01-07T00:00:00Z",
  };
  assert.ok(
    estimate({ baseline: 60, features, history: [row], now }).minutes < 62,
  );
  assert.equal(
    estimate({
      baseline: 60,
      features,
      history: [{ ...row, completedAt: "2031-01-01T00:00:00Z" }],
      now,
    }).comparableTasks,
    0,
  );
  assert.equal(
    estimate({
      baseline: 60,
      features: { ...features, unit: "pages" },
      history: [row],
      now,
    }).comparableTasks,
    0,
  );
});
test("effort outcomes require a frozen plan, are idempotent and exclude incomplete work from learning", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store),
    plan = store.prepareTaskPlan(
      { taskIds: [taskId], targetDate: "2030-01-07" },
      now,
    );
  const input = {
    planId: plan.id,
    receipt: "invented-receipt",
    actualMinutes: 90,
    completed: true,
  };
  assert.deepEqual(
    store.recordTaskEffort(taskId, input, now),
    store.recordTaskEffort(taskId, input, now),
  );
  assert.throws(
    () => store.recordTaskEffort(taskId, { ...input, receipt: "other" }, now),
    /already exists/,
  );
  const next = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(next.estimateSnapshots[0].prediction.comparableTasks, 1);
  assert.equal(next.estimateSnapshots[0].prediction.minutes, 64);
});
test("local extraction excludes negated, cancelled and unassigned requests", () => {
  const values = localCandidates({
    text: "Please revise the report.\nCould someone review this?\nThe request is cancelled.\nI do not need to submit it.\n请你更新报告。",
  });
  assert.equal(values.length, 2);
});
test("relative source dates use source local date rather than the planning day", () => {
  const value = candidates(
    "Please send this tomorrow.",
    { sourceTimestamp: "2030-01-07T23:30:00Z" },
    "Asia/Shanghai",
  );
  assert.equal(value.deadlineDate, "2030-01-09");
  assert.equal(value.deadlineInstant, null);
});
test("Gmail uses its own encrypted namespace and syncs invented messages without touching Calendar", async (t) => {
  const store = fixture(t),
    env = {
      INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
      GOOGLE_CLIENT_ID: "invented-client",
    },
    calendar = { invented: "calendar-state" };
  store.setIntegrationState("googleTokens", calendar);
  store.saveMailTokens(
    vault(env).seal({
      access_token: "invented-access",
      expiresAt: Date.parse(now) + 600000,
      scope: SCOPE,
    }),
    "invented-connection",
  );
  const message = {
    id: "m1",
    threadId: "t1",
    internalDate: String(Date.parse(now)),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "Subject", value: "Invented charts" }],
      body: {
        data: Buffer.from("Please revise the three charts.").toString(
          "base64url",
        ),
      },
    },
  };
  const fetchImpl = async (url) =>
    new Response(
      JSON.stringify(
        url.includes("/profile")
          ? { historyId: "h1" }
          : url.includes("/messages?")
            ? { messages: [{ id: "m1" }] }
            : url.includes("/threads/")
              ? { messages: [message] }
              : message,
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const gmail = createGmail(store, { env, fetchImpl, clock: () => now });
  t.after(() => gmail.close());
  assert.equal((await gmail.sync({ consent: true })).imported, 1);
  assert.equal(store.listCandidates().length, 1);
  assert.deepEqual(store.integrationState("googleTokens"), calendar);
  await gmail.disconnect();
  assert.deepEqual(store.integrationState("googleTokens"), calendar);
  assert.equal(store.listSources()[0].revoked, true);
});
test("Windows capture is permission gated, deduplicates repeated invented helper reads and pauses", async (t) => {
  const store = fixture(t);
  let calls = 0;
  const helper = (_file, args, _options, callback) => {
    calls++;
    setImmediate(() =>
      callback(
        null,
        JSON.stringify(
          args.includes("list")
            ? {
                windows: [
                  { processId: 123, windowHandle: 456, app: "Fixture" },
                ],
              }
            : {
                processId: 123,
                windowHandle: 456,
                app: "Fixture",
                text: "Please update the report.",
                observedAt: now,
              },
        ),
      ),
    );
    return { kill() {} };
  };
  const capture = createWorkCapture(store, {
    platform: "win32",
    execFileImpl: helper,
    clock: () => now,
  });
  t.after(() => capture.close());
  await assert.rejects(capture.windows({}), /Permission/);
  assert.equal(calls, 0);
  await capture.start({ consent: true, processId: 123, windowHandle: 456 });
  await capture.capture();
  assert.equal(store.listSources().length, 1);
  assert.equal(store.listCandidates().length, 1);
  capture.stop();
  await capture.capture();
  assert.equal(calls, 2);
  assert.equal(capture.status().running, false);
});

function v3Fixture(t) {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    { DatabaseSync } = require("node:sqlite");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timeframes-v3-"));
  t.after(() =>
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    }),
  );
  const file = path.join(directory, "invented.sqlite");
  const store = createStore(file, { seedDemo: false });
  store.createJournal({
    id: "old-journal",
    content: "Invented existing diary",
    updatedAt: now,
  });
  store.createEvent({
    id: "old-event",
    startsAt: "2030-01-07T09:00:00Z",
    endsAt: "2030-01-07T10:00:00Z",
  });
  store.close();
  const db = new DatabaseSync(file);
  db.exec(`DROP TABLE task_plans; DROP TABLE effort_records; DROP TABLE task_candidates; DROP TABLE task_sources; DROP TABLE source_items;
    CREATE TABLE old_tasks(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,identity TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(profile_id,journal_id,identity));
    DROP TABLE durable_tasks; ALTER TABLE old_tasks RENAME TO durable_tasks; PRAGMA user_version=3;`);
  const id = "task:" + crypto.randomUUID(),
    record = {
      id,
      profileId: "local",
      journalId: "old-journal",
      identity: "old-identity",
      title: "Existing work",
      status: "open",
      confirmed: {},
      revision: 1,
      generation: 0,
    };
  db.prepare("INSERT INTO durable_tasks VALUES(?,?,?,?,?)").run(
    id,
    "local",
    "old-journal",
    "old-identity",
    JSON.stringify(record),
  );
  db.prepare("INSERT INTO task_sessions VALUES(?,?,?)").run("old-event", id, 0);
  db.prepare("INSERT INTO task_analyses VALUES(?,?)").run("old-analysis", id);
  db.prepare("INSERT INTO applied_batches VALUES(?,?,?)").run(
    "old-analysis",
    "old-journal",
    JSON.stringify({
      analysisId: "old-analysis",
      journalId: "old-journal",
      events: [{ id: "old-event" }],
    }),
  );
  db.close();
  return { file, directory, id };
}
test("realistic v3 foreign keys migrate with stable tasks, event sessions and a readable snapshot", (t) => {
  const { file, directory, id } = v3Fixture(t),
    store = createStore(file);
  try {
    assert.equal(store.health().schemaVersion, 4);
    assert.equal(store.listTasks()[0].id, id);
    assert.deepEqual(store.listTasks()[0].sessionEventIds, ["old-event"]);
    assert.equal(
      store.getAppliedBatch("old-analysis").events[0].id,
      "old-event",
    );
    const fs = require("node:fs"),
      path = require("node:path"),
      snapshot = fs
        .readdirSync(directory)
        .find((name) => name.includes("before-v3-"));
    assert.ok(snapshot);
    assert.equal(
      require("../server/recovery.cjs").inspectDatabase(
        path.join(directory, snapshot),
        3,
      ).version,
      3,
    );
    store.deleteJournal("old-journal");
    assert.equal(store.listTasks()[0].id, id);
    assert.equal(store.listTasks()[0].sessionEventIds[0], "old-event");
  } finally {
    store.close();
  }
});
test("failed v3 migration rolls back rebuilt task links and schema version atomically", (t) => {
  const { file, id } = v3Fixture(t),
    { DatabaseSync } = require("node:sqlite");
  let db = new DatabaseSync(file);
  db.exec("CREATE TABLE source_items(id TEXT)");
  db.close();
  assert.throws(() => createStore(file), /already exists/);
  db = new DatabaseSync(file);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    assert.equal(
      db.prepare("SELECT task_id FROM task_sessions").get().task_id,
      id,
    );
    assert.equal(
      db.prepare("SELECT journal_id FROM durable_tasks").get().journal_id,
      "old-journal",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
test("remaining-work estimates keep a separate baseline from a short work session", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store, 60);
  store.updateTask(taskId, {
    revision: 1,
    effort: { minutes: 240, scope: "remaining_task" },
  });
  const total = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(total.estimateSnapshots[0].baseline, 240);
  assert.equal(total.estimateSnapshots[0].features.scope, "remaining_task");
  store.updateTask(taskId, {
    revision: 2,
    effort: { minutes: 45, scope: "next_session" },
  });
  const session = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(session.estimateSnapshots[0].baseline, 60);
  assert.equal(session.contract.estimates[0].effortMinutes.expected, 45);
  assert.equal(session.estimateSnapshots[0].features.scope, "next_session");
  store.updateTask(taskId, { revision: 3, effort: null });
  assert.equal(
    store.prepareTaskPlan({ taskIds: [taskId], targetDate: "2030-01-07" }, now)
      .contract.estimates.length,
    0,
  );
});
test("connected-mail plans require a recent sync both at preview and Apply", (t) => {
  const store = fixture(t);
  store.saveMailTokens({ invented: true }, "connection");
  const [source] = store.importMailBatch(
    [
      {
        kind: "email",
        accountKey: "connection",
        externalId: "freshness",
        text: "Please update the report.",
      },
    ],
    {
      connectionId: "connection",
      historyId: "h",
      syncedAt: "2030-01-07T10:00:00Z",
    },
  );
  const [c] = store.saveTaskDiscovery(source.id, source.version, [
    { title: "Report", quote: source.text, minutes: 60 },
  ]);
  const { taskId } = store.reviewCandidate(c.id, {
    revision: c.revision,
    state: "accepted",
  });
  assert.throws(
    () =>
      store.prepareTaskPlan(
        { taskIds: [taskId], targetDate: "2030-01-07" },
        now,
      ),
    /Refresh Gmail/,
  );
  store.setIntegrationState("gmailSync", {
    connectionId: "connection",
    syncedAt: now,
  });
  const plan = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.throws(
    () => store.applyTaskPlan(plan.id, "2030-01-07T12:15:00Z"),
    /Refresh Gmail/,
  );
  assert.equal(store.listEvents().length, 0);
});
test("switching mail accounts retires old account content but preserves selected imports and Calendar", (t) => {
  const store = fixture(t);
  store.saveMailTokens({ invented: true }, "old");
  const selected = store.importTaskSource({
    kind: "email",
    externalId: "selected",
    text: "Please review my selected document.",
  });
  const [old] = store.importMailBatch(
    [
      {
        kind: "email",
        accountKey: "old",
        externalId: "old-mail",
        text: "Please update old account report.",
      },
    ],
    { connectionId: "old", syncedAt: now },
  );
  store.setIntegrationState("googleTokens", { invented: "calendar" });
  store.saveMailTokens({ invented: "new-token" }, "new");
  assert.equal(store.getSource(old.id).revoked, true);
  assert.equal(store.getSource(selected.id).revoked, false);
  assert.equal(store.integrationState("gmailSync"), null);
  assert.deepEqual(store.integrationState("googleTokens"), {
    invented: "calendar",
  });
});
test("HTML-only mail becomes inert source text and multipart alternatives are not duplicated", async (t) => {
  for (const multipart of [false, true]) {
    const store = fixture(t),
      env = {
        INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
        GOOGLE_CLIENT_ID: "invented-client",
      };
    store.saveMailTokens(
      vault(env).seal({
        access_token: "invented-access",
        expiresAt: Date.parse(now) + 600000,
        scope: SCOPE,
      }),
      "html-connection",
    );
    const html = {
        mimeType: "text/html",
        body: {
          data: Buffer.from(
            "<script>malicious code</script><p>Please revise the report &amp; charts.</p>",
          ).toString("base64url"),
        },
      },
      plain = {
        mimeType: "text/plain",
        body: {
          data: Buffer.from("Please revise the report & charts.").toString(
            "base64url",
          ),
        },
      };
    const message = {
      id: "html",
      threadId: "thread",
      internalDate: String(Date.parse(now)),
      payload: multipart
        ? { mimeType: "multipart/alternative", parts: [plain, html] }
        : html,
    };
    const fetchImpl = async (url) =>
      new Response(
        JSON.stringify(
          url.includes("/profile")
            ? { historyId: "h" }
            : url.includes("/messages?")
              ? { messages: [{ id: "html" }] }
              : url.includes("/threads/")
                ? { messages: [message] }
                : message,
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const gmail = createGmail(store, { env, fetchImpl, clock: () => now });
    t.after(() => gmail.close());
    await gmail.sync({ consent: true });
    assert.equal(
      store.listSources()[0].text,
      "Please revise the report & charts.",
    );
    assert.equal(store.listCandidates().length, 1);
  }
});

test("reviewed work details connect measured outcomes to the automatic estimate and training export", (t) => {
  const store = fixture(t),
    first = accepted(store, 60);
  store.updateTask(first.taskId, {
    revision: 1,
    effort: { minutes: 60, scope: "remaining_task" },
    estimateFeatures: workDetails,
  });
  const plan = store.prepareTaskPlan(
    { taskIds: [first.taskId], targetDate: "2030-01-07" },
    now,
  );
  const outcome = store.recordTaskEffort(
    first.taskId,
    {
      planId: plan.id,
      receipt: "reviewed-outcome",
      actualMinutes: 90,
      completed: true,
    },
    "2030-01-07T13:10:00Z",
  );
  assert.equal(outcome.features.complete, true);
  assert.equal(outcome.features.quantity, 3);
  assert.equal(outcome.estimatedAt, now);
  assert.equal(outcome.baseline, 60);
  const source = store.importTaskSource(
    {
      kind: "email",
      externalId: "second-reviewed-request",
      text: "Please revise three other charts.",
    },
    "2030-01-07T13:30:00Z",
  );
  const [candidate] = store.saveTaskDiscovery(source.id, source.version, [
    { title: "Other charts", quote: source.text, minutes: 60 },
  ]);
  const second = store.reviewCandidate(candidate.id, {
    revision: candidate.revision,
    state: "accepted",
  });
  store.updateTask(second.taskId, {
    revision: 1,
    effort: { minutes: 60, scope: "remaining_task" },
    estimateFeatures: workDetails,
    useEstimatedEffort: true,
    estimateScope: "remaining_task",
  });
  const learned = store.prepareTaskPlan(
    { taskIds: [second.taskId], targetDate: "2030-01-07" },
    "2030-01-07T13:30:00Z",
  );
  assert.equal(learned.contract.estimates[0].basis, "personal_history");
  assert.equal(learned.contract.estimates[0].effortMinutes.expected, 64);
  assert.equal(learned.estimateSnapshots[0].baseline, 60);
  assert.equal(store.portableSnapshot().outcomes[0].features.unit, "chart");
  store.updateTask(second.taskId, {
    revision: 2,
    effort: { minutes: 120, scope: "remaining_task" },
    estimateFeatures: { ...workDetails, quantity: 6 },
    useEstimatedEffort: true,
  });
  assert.equal(
    store.prepareTaskPlan(
      { taskIds: [second.taskId], targetDate: "2030-01-07" },
      "2030-01-07T13:30:00Z",
    ).estimateSnapshots[0].prediction.comparableTasks,
    0,
  );
});
test("unknown total effort does not reuse a known short-session baseline", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store, 60);
  store.updateTask(taskId, {
    revision: 1,
    useEstimatedEffort: true,
    estimateScope: "remaining_task",
  });
  const plan = store.prepareTaskPlan(
    { taskIds: [taskId], targetDate: "2030-01-07" },
    now,
  );
  assert.equal(plan.contract.estimates.length, 0);
  assert.equal(plan.contract.plan.unscheduled[0].reason, "unknown_estimate");
});
test("estimation descriptors reject invalid or invented field shapes", (t) => {
  const store = fixture(t),
    { taskId } = accepted(store, 60);
  assert.throws(
    () =>
      store.updateTask(taskId, {
        revision: 1,
        estimateFeatures: { ...workDetails, quantity: 0 },
      }),
    /valid estimation/,
  );
  assert.throws(
    () =>
      store.updateTask(taskId, {
        revision: 1,
        estimateFeatures: { ...workDetails, authority: "invented" },
      }),
    /valid estimation/,
  );
  assert.equal(store.listTasks()[0].revision, 1);
});
