const { createStore } = require("../server/store.cjs");
const { preset, resolve } = require("../server/workingCalendar.cjs");
const { estimate } = require("../server/effortEstimator.cjs");
function run() {
  const results = [];
  const record = (id, passed) => results.push({ id, passed });
  const slots = resolve({ workingCalendar: preset() }, "2030-01-07", [
    { startsAt: "00:00", endsAt: "24:00" },
  ]);
  record(
    "lunch-excluded",
    slots.length === 2 &&
      slots[0].endsAt === "12:30" &&
      slots[1].startsAt === "14:00",
  );
  record(
    "weekend-off",
    resolve({ workingCalendar: preset() }, "2030-01-06").length === 0,
  );
  const features = {
    category: "invented",
    scope: "next_session",
    unit: "chart",
  };
  const history = Array.from({ length: 20 }, (_, i) => ({
    taskId: String(i),
    completed: true,
    actualMinutes: 90,
    baseline: 60,
    baselineVersion: "scoped-v1",
    features,
    completedAt: "2030-01-07T00:00:00Z",
  }));
  record(
    "history-correction",
    estimate({ baseline: 60, features, history, now: "2030-01-07T00:00:00Z" })
      .minutes === 83,
  );
  const store = createStore(":memory:", { seedDemo: false });
  try {
    store.updateSettings({ timezone: "UTC", workingCalendar: preset() });
    const source = store.importTaskSource({
      kind: "email",
      externalId: "invented-evaluation",
      text: "Please revise the three charts.",
    });
    const [candidate] = store.saveTaskDiscovery(source.id, source.version, [
      { title: "Revise charts", quote: source.text, minutes: 60 },
    ]);
    const accepted = store.reviewCandidate(candidate.id, {
      revision: candidate.revision,
      state: "accepted",
    });
    const plan = store.prepareTaskPlan(
      { taskIds: [accepted.taskId], targetDate: "2030-01-07" },
      "2030-01-07T11:40:00Z",
    );
    record(
      "source-only-task",
      store.listJournals().length === 0 &&
        plan.contract.plan.blocks[0].startsAt === "2030-01-07T14:00:00.000Z",
    );
    store.saveTaskDiscovery(source.id, source.version, [
      { title: "Revise charts", quote: source.text, minutes: 60 },
    ]);
    record("capture-deduplication", store.listCandidates().length === 1);
    store.applyTaskPlan(plan.id, "2030-01-07T11:40:00Z");
    record(
      "apply-replay",
      store.applyTaskPlan(plan.id, "2030-01-07T11:40:00Z").replayed === true &&
        store.listEvents().length === 1,
    );
  } finally {
    store.close();
  }
  return {
    mode: "synthetic_mechanics_not_real_accuracy",
    cases: results,
    passRate: results.filter((x) => x.passed).length / results.length,
  };
}
module.exports = { run };
