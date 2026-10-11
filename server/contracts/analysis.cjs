const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { assertBundle, assertSchema, ContractError, isInstant } = require("./validate.cjs");

function sourceVersion(journal) {
  return crypto.createHash("sha256").update(JSON.stringify([
    journal.type, journal.journalDate, journal.title || "", journal.content
  ])).digest("hex");
}
function collectJournalEvidence({ journal, relatedJournals = [] }) {
  const observedAt = new Date().toISOString();
  const seen = new Set();
  const evidence = [];
  [journal, ...relatedJournals].filter(Boolean).forEach((source, sourceIndex) => {
    const sourceId = source.id || `input-journal-${sourceIndex}`;
    if (seen.has(sourceId)) return;
    seen.add(sourceId);
    const version = sourceVersion(source);
    const sentences = String(source.content || "").split(/[\n.!?。！？]+/).map((text) => text.trim()).filter(Boolean);
    sentences.forEach((excerpt, index) => {
      if (evidence.length >= 100 || excerpt.length > 4000) return;
      evidence.push({
        id: `e:${sourceIndex}:${index}`, sourceType: "journal", sourceId, sourceVersion: version,
        locator: null, excerpt, observedAt, sourceTimestamp: isInstant(source.updatedAt) ? source.updatedAt : null,
        verification: "source_matched", facts: []
      });
    });
  });
  return evidence;
}

// UI fields are a derived projection; the versioned contract owns meaning.
function projectContract(contract) {
  assertBundle(contract);
  const estimates = new Map(contract.estimates.map((estimate) => [estimate.id, estimate]));
  const tasks = new Map(contract.tasks.map((task) => [task.id, task]));
  return {
    tasks: contract.tasks.map((task) => {
      const estimate = estimates.get(task.estimateId);
      return {
        id: task.id, title: task.title, priority: task.importance.level, urgency: "unknown",
        estimatedMinutes: estimate?.effortMinutes?.expected ?? null,
        confidence: estimate?.confidence || "unknown", reason: task.importance.reason
      };
    }),
    scheduleDrafts: contract.plan.blocks.map((block) => ({
      id: block.id, taskId: block.taskId, estimateId: block.estimateId,
      title: tasks.get(block.taskId).title, startsAt: block.startsAt, endsAt: block.endsAt,
      calendarType: block.calendarType, notifyMinutesBefore: block.notifyMinutesBefore,
      notificationFormat: block.notificationFormat, source: "journal analysis",
      rationale: block.rationale, confidence: estimates.get(block.estimateId).confidence
    }))
  };
}
function contractAnalysis(result, contract, context = {}) {
  assertBundle(contract, context);
  return { ...result, contract, ...projectContract(contract) };
}
function assertAnalysis(analysis, context = {}) {
  if (!analysis.contract) throw new ContractError([{ path: "/contract", code: "required", message: "New analyses need a versioned planning contract" }]);
  assertBundle(analysis.contract, context);
  if (analysis.scheduling !== undefined) assertSchema("scheduling", analysis.scheduling);
  const projection = projectContract(analysis.contract);
  for (const name of ["tasks", "scheduleDrafts"]) {
    if (!isDeepStrictEqual(analysis[name], projection[name])) {
      throw new ContractError([{ path: `/${name}`, code: "projection", message: "Compatibility fields must match the canonical contract" }]);
    }
  }
  for (const name of ["summary", "weeklySummary"]) {
    if (typeof analysis[name] !== "string" || !analysis[name].trim() || analysis[name].length > 10000) {
      throw new ContractError([{ path: `/${name}`, code: "type", message: "Expected a nonempty summary of at most 10000 characters" }]);
    }
  }
  if (!Array.isArray(analysis.cautions) || analysis.cautions.length > 20 || analysis.cautions.some((text) => typeof text !== "string" || text.length > 2000)) {
    throw new ContractError([{ path: "/cautions", code: "type", message: "Expected at most 20 caution strings of at most 2000 characters" }]);
  }
  return analysis;
}
function assertEvidenceCurrent(contract, getJournal) {
  const stale = contract.evidence.some((item) => {
    if (item.sourceType !== "journal") return false;
    const journal = getJournal(item.sourceId);
    return !journal || sourceVersion(journal) !== item.sourceVersion || !journal.content.includes(item.excerpt);
  });
  if (stale) throw Object.assign(new Error("Source evidence changed; analyze this journal again"), { status: 409 });
}
module.exports = { sourceVersion, collectJournalEvidence, projectContract, contractAnalysis, assertAnalysis, assertEvidenceCurrent };
