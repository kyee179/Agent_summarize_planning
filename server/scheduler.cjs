const crypto = require("node:crypto");
const { assertBundle, assertSchema, isInstant, ContractError } = require("./contracts/validate.cjs");
const { wallClockInstant, nextDate } = require("./contracts/time.cjs");
const { expandEvents } = require("./eventOccurrences.cjs");
const MINUTE = 60000;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function mergeIntervals(intervals) {
  const result = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.start >= interval.end) continue;
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}
function subtractIntervals(windows, busy) {
  const free = [];
  for (const window of windows) {
    let cursor = window.start;
    for (const occupied of busy) {
      if (occupied.end <= cursor) continue;
      if (occupied.start >= window.end) break;
      if (occupied.start > cursor) free.push({ start: cursor, end: Math.min(occupied.start, window.end) });
      cursor = Math.max(cursor, occupied.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) free.push({ start: cursor, end: window.end });
  }
  return free;
}
function planningRange(plan) {
  const start = Date.parse(wallClockInstant(plan.targetDate, "00:00", plan.timezone));
  const end = Date.parse(wallClockInstant(nextDate(plan.targetDate), "00:00", plan.timezone));
  const buffer = plan.bufferMinutes * MINUTE;
  return { from: new Date(start - buffer).toISOString(), to: new Date(end + buffer).toISOString(), start, end };
}
function calendarContext(plan, events) {
  const { start, end } = planningRange(plan), buffer = plan.bufferMinutes * MINUTE;
  const occurrences = expandEvents(events, { from: start - buffer, to: end + buffer, timezone: plan.timezone });
  const busy = mergeIntervals(occurrences.map((item) => ({ start: Math.max(start, item.start - buffer), end: Math.min(end, item.end + buffer) })));
  const windows = mergeIntervals(plan.availability.map((slot) => ({
    start: Date.parse(wallClockInstant(plan.targetDate, slot.startsAt, plan.timezone)),
    end: Date.parse(wallClockInstant(plan.targetDate, slot.endsAt, plan.timezone))
  })));
  // Only occupancy relevant to this day's availability invalidates a reviewed plan.
  const relevant = mergeIntervals(windows.flatMap((window) => busy.map((item) => ({ start: Math.max(window.start, item.start), end: Math.min(window.end, item.end) }))));
  return { busy, windows, calendarFingerprint: hash({ timezone: plan.timezone, targetDate: plan.targetDate, bufferMinutes: plan.bufferMinutes, busy: relevant }) };
}
function settingsFingerprint(settings, availabilitySource) {
  const slots = settings.defaultAvailability || [];
  return hash({ timezone: settings.timezone || "UTC", planningLeadMinutes: settings.planningLeadMinutes || 5, ...(availabilitySource === "settings" ? { availability:
    slots.map(({ startsAt, endsAt }) => [startsAt, endsAt]).sort((a, b) => compareId(a.join("/"), b.join("/"))) } : {}) });
}
function inputBundle(bundle) {
  // Validate task/evidence/estimate meaning without asking the model to allocate blocks.
  assertSchema("bundle", bundle);
  const copy = structuredClone(bundle);
  copy.plan.blocks = [];
  copy.plan.unscheduled = copy.tasks.map((task) => ({ taskId: task.id, reason: "needs_clarification", explanation: "Awaiting deterministic allocation." }));
  assertBundle(copy);
  return copy;
}

// Pure scheduling: same contract, events, and explicit notBefore give the same output.
function scheduleBundle(bundle, { events = [], notBefore = null } = {}) {
  const result = inputBundle(bundle), plan = result.plan;
  if (notBefore !== null && !isInstant(notBefore)) throw new ContractError([{ path: "/scheduling/notBefore", code: "time", message: "notBefore needs an ISO timestamp with timezone" }]);
  const context = calendarContext(plan, events);
  const earliest = notBefore === null ? -Infinity : Date.parse(notBefore);
  let free = subtractIntervals(context.windows, context.busy).map((slot) => ({ start: Math.max(slot.start, earliest), end: slot.end })).filter((slot) => slot.start < slot.end);
  plan.blocks = [];
  plan.unscheduled = [];
  const taskMap = new Map(result.tasks.map((task) => [task.id, task]));
  const estimates = new Map(result.estimates.map((estimate) => [estimate.id, estimate]));
  const allocated = new Map();
  const reject = (task, reason, explanation) => { plan.unscheduled.push({ taskId: task.id, reason, explanation }); };
  const pending = [];
  for (const task of [...result.tasks].sort((a, b) => compareId(a.id, b.id))) {
    const estimate = estimates.get(task.estimateId);
    if (["completed", "cancelled"].includes(task.status)) reject(task, "inactive", "This task is already completed or cancelled.");
    else if (task.status === "blocked") reject(task, "blocked", "Resolve the task's blocked state before scheduling.");
    else if (!estimate?.effortMinutes) reject(task, "unknown_estimate", "Confirm an effort estimate before allocating time.");
    else pending.push(task);
  }
  const score = { high: 3, medium: 2, low: 1, unknown: 0 };
  const order = (a, b) => (a.deadline ? Date.parse(a.deadline.at) : Infinity) - (b.deadline ? Date.parse(b.deadline.at) : Infinity) ||
    score[b.importance.level] - score[a.importance.level] || compareId(a.id, b.id);
  while (pending.length) {
    const ready = pending.filter((task) => task.dependsOn.every((id) => taskMap.get(id).status === "completed" ||
      (allocated.has(id) && estimates.get(taskMap.get(id).estimateId)?.scope === "remaining_task"))).sort(order);
    if (!ready.length) {
      pending.sort(order).forEach((task) => reject(task, "dependency", "A dependency is unavailable, blocked, or only has a next-session estimate."));
      break;
    }
    const task = ready[0];
    pending.splice(pending.indexOf(task), 1);
    const estimate = estimates.get(task.estimateId), minutes = estimate.effortMinutes.expected;
    const dependencyEnd = Math.max(earliest, ...task.dependsOn.map((id) => allocated.get(id)?.end ?? earliest));
    const deadline = task.deadline?.kind === "hard" ? Date.parse(task.deadline.at) : Infinity;
    const slot = free.map((window) => {
      const start = Math.ceil(Math.max(window.start, dependencyEnd) / MINUTE) * MINUTE;
      return { start, end: start + minutes * MINUTE, windowEnd: window.end };
    }).find((candidate) => candidate.end <= candidate.windowEnd && candidate.end <= deadline);
    if (!slot) {
      reject(task, "insufficient_capacity", task.deadline?.kind === "hard" ? "A full session cannot fit the free windows before the evidenced hard deadline." : "A full session cannot fit the remaining free windows after calendar events and buffers.");
      continue;
    }
    plan.blocks.push({ id: `block:${plan.blocks.length + 1}`, taskId: task.id, estimateId: estimate.id,
      startsAt: new Date(slot.start).toISOString(), endsAt: new Date(slot.end).toISOString(), effortMinutes: minutes,
      rationale: "Earliest available full session after existing commitments, buffers, and dependencies.",
      calendarType: task.importance.level === "high" ? "study" : "personal", notifyMinutesBefore: 15, notificationFormat: "Desktop notification" });
    allocated.set(task.id, slot);
    free = subtractIntervals(free, [{ start: slot.start - plan.bufferMinutes * MINUTE, end: slot.end + plan.bufferMinutes * MINUTE }]);
  }
  plan.blocks.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || compareId(a.taskId, b.taskId));
  plan.unscheduled.sort((a, b) => compareId(a.taskId, b.taskId));
  const missedTarget = plan.blocks.some((block) => {
    const deadline = taskMap.get(block.taskId).deadline;
    return deadline?.kind === "target" && Date.parse(block.endsAt) > Date.parse(deadline.at);
  });
  plan.warnings = missedTarget ? ["Some proposed sessions finish after their target deadline."] : [];
  assertBundle(result);
  return { contract: result, calendarFingerprint: context.calendarFingerprint };
}
function scheduleAnalysis(analysis, options = {}) {
  const { contract, calendarFingerprint } = scheduleBundle(analysis.contract, options);
  const { contractAnalysis } = require("./contracts/analysis.cjs");
  const scheduling = { version: 1, algorithm: "greedy-v1", calendarFingerprint,
    settingsFingerprint: settingsFingerprint(options.settings || { timezone: contract.plan.timezone }, options.availabilitySource || "request"),
    availabilitySource: options.availabilitySource || "request", notBefore: options.notBefore ?? null };
  return contractAnalysis({ ...analysis, scheduling }, contract);
}
function assertScheduleCurrent(analysis, events, settings, now = null) {
  const conflict = (message) => { throw Object.assign(new Error(message), { status: 409 }); };
  if (analysis.scheduling) {
    assertSchema("scheduling", analysis.scheduling);
    if (settingsFingerprint(settings, analysis.scheduling.availabilitySource) !== analysis.scheduling.settingsFingerprint) conflict("Planning settings changed; analyze again and review the new plan");
    const expected = scheduleBundle(analysis.contract, { events, notBefore: analysis.scheduling.notBefore });
    if (expected.calendarFingerprint !== analysis.scheduling.calendarFingerprint) conflict("Calendar availability changed; analyze again and review the new plan");
    const { isDeepStrictEqual } = require("node:util");
    if (!isDeepStrictEqual(expected.contract.plan, analysis.contract.plan)) conflict("Stored plan does not match deterministic scheduling; analyze again");
    if (now !== null && analysis.contract.plan.blocks.some((block) => Date.parse(block.startsAt) < Date.parse(now))) conflict("A planned start time has passed; analyze again for remaining availability");
  }
  const plan = analysis.contract?.plan;
  if (plan) {
    const { busy } = calendarContext(plan, events);
    if (plan.blocks.some((block) => busy.some((item) => Date.parse(block.startsAt) < item.end && Date.parse(block.endsAt) > item.start))) conflict("Drafts conflict with current calendar events; analyze again");
  }
}
function assertLegacyDraftsCurrent(drafts, events, timezone) {
  const from = Math.min(...drafts.map((draft) => Date.parse(draft.startsAt)));
  const to = Math.max(...drafts.map((draft) => Date.parse(draft.endsAt)));
  const busy = expandEvents(events, { from, to, timezone });
  const sorted = [...drafts].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const overlap = sorted.some((draft, i) => (i > 0 && Date.parse(draft.startsAt) < Date.parse(sorted[i - 1].endsAt)) ||
    busy.some((item) => Date.parse(draft.startsAt) < item.end && Date.parse(draft.endsAt) > item.start));
  if (overlap) throw Object.assign(new Error("Drafts conflict with current calendar events or each other; analyze again"), { status: 409 });
}
module.exports = { scheduleBundle, scheduleAnalysis, assertScheduleCurrent, assertLegacyDraftsCurrent, planningRange, calendarContext, settingsFingerprint, mergeIntervals, subtractIntervals };
