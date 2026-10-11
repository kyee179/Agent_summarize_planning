const Ajv = require("ajv");
const { schemas } = require("./schemas.cjs");
const { isDeepStrictEqual } = require("node:util");

function isCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function isInstant(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  return Boolean(match && isCalendarDate(match[1]) && !/[+-]14:(?!00)/.test(match[5]) && Number.isFinite(Date.parse(value)));
}
function isTimezone(value) {
  if (typeof value !== "string" || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; } catch { return false; }
}
const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
ajv.addFormat("instant", { type: "string", validate: isInstant });
ajv.addFormat("calendar-date", { type: "string", validate: isCalendarDate });
ajv.addFormat("iana-timezone", { type: "string", validate: isTimezone });
ajv.addFormat("http-url", { type: "string", validate: (value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
} });
Object.values(schemas).forEach((schema) => ajv.addSchema(schema));
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.getSchema(schema.$id)]));

class ContractError extends Error {
  constructor(issues) {
    super("Planning contract validation failed");
    this.name = "ContractError";
    this.status = 422;
    this.issues = issues;
  }
}
function assertSchema(name, value) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown schema: ${name}`);
  if (!validate(value)) throw new ContractError(validate.errors.map(({ instancePath, keyword, message }) => ({ path: instancePath || "/", code: keyword, message })));
  return value;
}

// JSON Schema checks individual shapes. These checks enforce links and domain meaning.
function assertBundle(bundle, { trustedEvidence, expectedPlan } = {}) {
  assertSchema("bundle", bundle);
  const issues = [];
  const check = (condition, path, message) => { if (!condition) issues.push({ path, code: "semantic", message }); };
  if (expectedPlan) {
    for (const field of ["timezone", "targetDate", "availability", "bufferMinutes"]) {
      check(isDeepStrictEqual(bundle.plan[field], expectedPlan[field]), `/plan/${field}`, "Plan must preserve the workflow's planning constraints");
    }
  }
  const index = (records, name) => {
    const map = new Map();
    records.forEach((record, i) => {
      check(!map.has(record.id), `/${name}/${i}/id`, "IDs must be unique within their collection");
      map.set(record.id, record);
    });
    return map;
  };
  const evidence = index(bundle.evidence, "evidence");
  const tasks = index(bundle.tasks, "tasks");
  const estimates = index(bundle.estimates, "estimates");
  index(bundle.plan.blocks, "plan/blocks");
  const refs = (values, map, path) => values.forEach((id) => check(map.has(id), path, `Unknown reference: ${id}`));
  const supports = (ids, field, value) => ids.some((id) => {
    const item = evidence.get(id);
    return item && item.verification !== "unverified" && !["activity", "model"].includes(item.sourceType) &&
      item.facts.some((fact) => fact.field === field && fact.value === value);
  });
  if (trustedEvidence) {
    const trusted = new Map(trustedEvidence.map((item) => [item.id, item]));
    for (const item of bundle.evidence) {
      check(isDeepStrictEqual(item, trusted.get(item.id)), "/evidence", "Evidence must match the workflow-owned source snapshot");
    }
  }
  bundle.evidence.forEach((item, i) => {
    check(!["activity", "model"].includes(item.sourceType) || item.facts.length === 0, `/evidence/${i}/facts`, "Activity and model output cannot assert task facts");
    check(item.sourceType !== "web" || item.locator !== null, `/evidence/${i}/locator`, "Web evidence needs a source URL");
  });
  bundle.tasks.forEach((task, i) => {
    const path = `/tasks/${i}`;
    refs(task.evidenceIds, evidence, `${path}/evidenceIds`);
    refs(task.importance.evidenceIds, evidence, `${path}/importance/evidenceIds`);
    refs(task.dependsOn, tasks, `${path}/dependsOn`);
    check(!task.dependsOn.includes(task.id), `${path}/dependsOn`, "A task cannot depend on itself");
    check((task.importance.basis === "unknown") === (task.importance.level === "unknown"), `${path}/importance`, "Unknown importance needs unknown basis and level");
    if (["user", "commitment"].includes(task.importance.basis)) {
      check(supports(task.importance.evidenceIds, "importance", task.importance.level), `${path}/importance`, "Asserted importance needs matching verified evidence");
    }
    if (["completed", "cancelled"].includes(task.status)) {
      check(supports(task.evidenceIds, "status", task.status), `${path}/status`, "Completion/cancellation needs explicit evidence; browsing is insufficient");
    }
    if (task.deadline) {
      refs(task.deadline.evidenceIds, evidence, `${path}/deadline/evidenceIds`);
      check(supports(task.deadline.evidenceIds, "deadline", task.deadline.at), `${path}/deadline`, "Deadline needs matching verified evidence");
    }
    if (task.estimateId !== null) check(estimates.get(task.estimateId)?.taskId === task.id, `${path}/estimateId`, "Estimate must belong to this task");
  });
  // Validate the dependency graph with three colors, in linear time.
  const colors = new Map();
  const visit = (id) => {
    if (colors.get(id) === 1) { check(false, "/tasks/dependsOn", "Task dependencies contain a cycle"); return; }
    if (colors.get(id) === 2 || !tasks.has(id)) return;
    colors.set(id, 1); tasks.get(id).dependsOn.forEach(visit); colors.set(id, 2);
  };
  tasks.forEach((_, id) => visit(id));
  bundle.estimates.forEach((estimate, i) => {
    const path = `/estimates/${i}`;
    check(tasks.get(estimate.taskId)?.estimateId === estimate.id, `${path}/taskId`, "Estimate must be selected by its task");
    refs(estimate.evidenceIds, evidence, `${path}/evidenceIds`);
    check((estimate.basis === "unknown") === (estimate.effortMinutes === null), path, "Unknown estimates have null effort; known estimates need a range");
    if (estimate.effortMinutes) {
      const { low, expected, high } = estimate.effortMinutes;
      check(low <= expected && expected <= high, `${path}/effortMinutes`, "Expected effort must lie within the low/high range");
      check(estimate.confidence !== "unknown", `${path}/confidence`, "Known effort needs an explicit confidence");
    } else check(estimate.confidence === "unknown", `${path}/confidence`, "Unknown effort needs unknown confidence");
    if (["model", "local_heuristic"].includes(estimate.basis)) {
      check(estimate.confidence !== "high" && estimate.assumptions.length > 0, path, "Inferred effort needs assumptions and cannot have high confidence");
    }
    if (["personal_history", "project_estimate", "official_reference"].includes(estimate.basis)) {
      const expectedSource = { personal_history: ["history"], project_estimate: ["user", "document", "journal"], official_reference: ["web", "document"] }[estimate.basis];
      check(estimate.evidenceIds.some((id) => {
        const item = evidence.get(id);
        return item && expectedSource.includes(item.sourceType) && item.verification !== "unverified" &&
          item.facts.some((fact) => fact.field === "effort_minutes");
      }), path, "Evidence-based effort needs a verified duration fact from the appropriate source");
    }
  });
  const { wallClockInstant } = require("./time.cjs");
  const windows = [];
  for (const [i, window] of bundle.plan.availability.entries()) {
    check(window.startsAt < window.endsAt, `/plan/availability/${i}`, "Availability must end after it starts; split overnight windows");
    if (window.startsAt < window.endsAt) {
      windows.push({ start: Date.parse(wallClockInstant(bundle.plan.targetDate, window.startsAt, bundle.plan.timezone)),
        end: Date.parse(wallClockInstant(bundle.plan.targetDate, window.endsAt, bundle.plan.timezone)) });
    }
  }
  const scheduled = new Set();
  const mergedWindows = [];
  for (const window of windows.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = mergedWindows.at(-1);
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else mergedWindows.push({ ...window });
  }
  const totals = new Map();
  bundle.plan.blocks.forEach((block, i) => {
    const task = tasks.get(block.taskId), estimate = estimates.get(block.estimateId);
    const path = `/plan/blocks/${i}`;
    check(Boolean(task), `${path}/taskId`, "Block must reference a task");
    check(Boolean(estimate?.effortMinutes) && task?.estimateId === estimate?.id, `${path}/estimateId`, "Block needs this task's known estimate");
    check(!task || ["open", "in_progress"].includes(task.status), path, "Only open or in-progress tasks may be scheduled");
    check(Date.parse(block.endsAt) > Date.parse(block.startsAt), path, "Block end must follow start");
    if (task?.deadline?.kind === "hard") check(Date.parse(block.endsAt) <= Date.parse(task.deadline.at), path, "Block must finish by its evidenced hard deadline");
    check(Date.parse(block.endsAt) - Date.parse(block.startsAt) === block.effortMinutes * 60000, path, "Block effort must equal its elapsed minutes");
    check(mergedWindows.some((window) => Date.parse(block.startsAt) >= window.start && Date.parse(block.endsAt) <= window.end), path, "Block must fit a supplied availability window on the target date");
    totals.set(block.taskId, (totals.get(block.taskId) || 0) + block.effortMinutes);
    scheduled.add(block.taskId);
  });
  for (const taskId of scheduled) {
    const estimate = estimates.get(tasks.get(taskId)?.estimateId);
    check(totals.get(taskId) === estimate?.effortMinutes?.expected, "/plan/blocks", "Scheduled effort must cover the expected estimate without silent truncation");
    const firstStart = Math.min(...bundle.plan.blocks.filter((block) => block.taskId === taskId).map((block) => Date.parse(block.startsAt)));
    for (const dependencyId of tasks.get(taskId)?.dependsOn || []) {
      const dependency = tasks.get(dependencyId);
      const dependencyEstimate = estimates.get(dependency?.estimateId);
      const blocks = bundle.plan.blocks.filter((block) => block.taskId === dependencyId);
      check(dependency?.status === "completed" || (dependencyEstimate?.scope === "remaining_task" && blocks.length > 0 &&
        blocks.every((block) => Date.parse(block.endsAt) <= firstStart)), "/plan/blocks", "Dependencies need completed evidence or a full remaining-task allocation before dependent work");
    }
  }
  const chronological = [...bundle.plan.blocks].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (let i = 1; i < chronological.length; i++) {
    check(Date.parse(chronological[i].startsAt) >= Date.parse(chronological[i - 1].endsAt) + bundle.plan.bufferMinutes * 60000,
      "/plan/blocks", "Proposed blocks must not overlap and must preserve the buffer");
  }
  const unscheduled = new Set();
  bundle.plan.unscheduled.forEach((item, i) => {
    check(tasks.has(item.taskId), `/plan/unscheduled/${i}`, "Unscheduled entry must reference a task");
    check(!scheduled.has(item.taskId) && !unscheduled.has(item.taskId), `/plan/unscheduled/${i}`, "Task cannot be both scheduled and unscheduled, or repeated");
    unscheduled.add(item.taskId);
  });
  for (const task of bundle.tasks) check(scheduled.has(task.id) || unscheduled.has(task.id), "/plan", `Task needs a block or an explicit unscheduled reason: ${task.id}`);
  if (issues.length) throw new ContractError(issues);
  return bundle;
}
module.exports = { assertSchema, assertBundle, ContractError, isInstant, isCalendarDate, isTimezone };
