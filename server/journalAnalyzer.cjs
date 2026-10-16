const language = require('./language.cjs');
const { performance } = require("node:perf_hooks");
const { safeObserve } = require("./observability.cjs");
const { assertSchema, assertBundle, ContractError } = require("./contracts/validate.cjs");
const { collectJournalEvidence, contractAnalysis, assertAnalysis } = require("./contracts/analysis.cjs");
const { scheduleBundle } = require("./scheduler.cjs");
const { loadSkills, buildMessages } = require("./agent/skills.cjs");
const { LIMITS, runWorkflow, workflowMetadata } = require("./agent/runtime.cjs");
const { createProvider } = require("./agent/providers.cjs");


const priorityWeights = [
  { pattern: /deadline|assessment|interview|urgent|must|have to|截止|面试|紧急|必须/i, priority: "high", urgency: "high", minutes: 90 },
  { pattern: /dissertation|experiment|supervisor|graduation/i, priority: "high", urgency: "medium", minutes: 120 },
  { pattern: /job|cv|application|company/i, priority: "medium", urgency: "medium", minutes: 75 },
  { pattern: /project|coding|vibe coding|portfolio|项目|编程|报告/i, priority: "medium", urgency: "low", minutes: 90 },
  { pattern: /relationship|health|rest|family/i, priority: "medium", urgency: "medium", minutes: 45 }
];

function splitSentences(text) {
  return language.sentenceSpans(text).map(span => String(text).slice(span.start,span.end));
}

function inferTask(sentence) {
  if (!language.isAction(sentence)) return null;
  const matched = priorityWeights.find((weight) => weight.pattern.test(language.normalize(sentence))) || {
    priority: "low",
    urgency: "low",
    minutes: 45
  };

  return {
    title: [...sentence].length > 86 ? `${[...sentence].slice(0, 83).join('')}...` : sentence,
    priority: matched.priority,
    urgency: matched.urgency,
    estimatedMinutes: matched.minutes,
    confidence: matched.priority === "low" ? "low" : "medium",
    reason: "Detected from journal wording and planning keywords."
  };
}

function localRuleBasedAnalysis(input = {}) {
  const { journal, settings = {}, availability = settings.defaultAvailability || [{ startsAt: "20:00", endsAt: "24:00" }] } = input;
  const evidence = input.trustedEvidence || collectJournalEvidence(input);
  const chinese = language.outputLanguage(journal?.content, input.outputLanguage) === 'zh-CN';
  const selectedId = journal?.id || "input-journal-0";
  const selectedEvidence = evidence.filter((item) => item.sourceId === selectedId);
  const detected = evidence.filter((item) => item.sourceType === "journal").map((item) => language.actionClauses(item.excerpt).map(clause => ({ evidence: item, clause, task: inferTask(clause) }))).flat().filter((item) => item.task);
  const unique = new Map();
  for (const item of detected) { const key=language.actionKey(item.clause); if (!unique.has(key)) unique.set(key,item); }
  const selectedTasks=[...unique.values()].slice(0,8);
  const tasks = selectedTasks.map(({ evidence: item, task, clause }, i) => ({
    id: `task:${i + 1}`, title: task.title, description: clause, status: "open", evidenceIds: [item.id],
    importance: { level: task.priority, basis: "inferred", reason: chinese ? '根据明确的待办或未完成语句推断；请核对重要性。' : task.reason, evidenceIds: [item.id] },
    deadline: null, estimateId: `estimate:${i + 1}`, dependsOn: [],
    clarificationQuestions: chinese ? ['请确认剩余工作和预计用时。', '是否有明确的截止时间或前置任务？'] : ["Confirm the remaining work and effort estimate.", "Is there an explicit deadline or dependency?"]
  }));
  const estimates = selectedTasks.map(({ task }, i) => ({
    id: `estimate:${i + 1}`, taskId: tasks[i].id, scope: "next_session", basis: "local_heuristic",
    effortMinutes: { low: Math.max(1, Math.floor(task.estimatedMinutes / 2)), expected: task.estimatedMinutes, high: task.estimatedMinutes * 2 },
    confidence: "low", evidenceIds: [],
    assumptions: [chinese ? '这是单次工作时段的粗略估计，并非实测时长或已核实事实。' : 'Keyword estimate for one work session; not a measured duration or a researched fact.'],
    rationale: chinese ? '本地规则的暂定用时；应用前请确认工作范围。' : 'Provisional effort from the local keyword baseline; confirm scope before applying.'
  }));
  const plan = {
    id: "plan:1", state: "proposal", timezone: settings.timezone || "UTC",
    targetDate: input.targetDate || journal?.journalDate || new Date().toISOString().slice(0, 10), bufferMinutes: 15,
    availability,
    blocks: [], unscheduled: [], warnings: []
  };
  assertSchema("plan", plan);
  assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [], plan });
  const { contract } = scheduleBundle({ schemaVersion: 1, evidence, tasks, estimates, plan }, {
    events: input.existingEvents || [], notBefore: input.notBefore ?? null
  });
  const summary = selectedEvidence.length
    ? `${chinese ? '所选日记记载：' : 'Reported in the selected journal: '}${selectedEvidence.slice(0, 3).map((item) => item.excerpt).join(". ").slice(0, 9000)}.`
    : chinese ? '所选日记没有可分析的文本。' : 'No usable text was found in the selected journal.';

  return contractAnalysis({
    provider: "local",
    model: "rule-based-v1",
    summary,
    weeklySummary: chinese ? `仅包含所提供日记的部分上下文，不能代表完整一周。识别出 ${tasks.length} 项可能的后续工作。` : summarizeWeekly(evidence.filter((item) => item.sourceType === "journal").map((item) => item.excerpt), tasks),
    cautions: [
      chinese ? '本地规则仅提供粗略估计；未确认的截止时间保持未知，重要性属于推断。' : 'Local fallback uses tentative keyword estimates; deadlines remain unknown and importance is inferred.',
      chinese ? '应用前请检查建议时段和假设；安排时段不代表任务已完成。' : 'Review proposed sessions and assumptions before applying; allocations do not imply task completion.'
    ]
  }, contract, { trustedEvidence: evidence });
}

function summarizeWeekly(sentences, tasks) {
  const themes = [];
  if (sentences.some((sentence) => /job|cv|application|assessment|interview/i.test(sentence))) themes.push("job search");
  if (sentences.some((sentence) => /dissertation|experiment|supervisor|graduation/i.test(sentence))) themes.push("dissertation");
  if (sentences.some((sentence) => /coding|project|portfolio/i.test(sentence))) themes.push("project work");
  if (sentences.some((sentence) => /relationship|stress|problem|health/i.test(sentence))) themes.push("personal wellbeing");

  if (themes.length === 0) return "Partial journal context: no dominant theme was detected locally. This is not a complete weekly review.";
  return `Partial journal context includes ${themes.join(", ")}. ${tasks.length} possible follow-up task${tasks.length === 1 ? "" : "s"} were detected. The supplied notes do not establish complete weekly coverage.`;
}

function getProviderConfig(settings = {}) {
  const provider = process.env.AI_PROVIDER || settings.aiProvider || "glm";
  return {
    provider,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    groqKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    glmKey: process.env.GLM_API_KEY,
    glmModel: process.env.GLM_MODEL || "glm-4-flash"
  };
}

function normalizeRemoteAnalysis(result, provider, model, fallbackContext) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
    Object.keys(result).some((key) => !["summary", "weeklySummary", "cautions", "contract"].includes(key))) {
    throw new ContractError([{ path: "/", code: "shape", message: "Unexpected provider response fields" }]);
  }
  const contract = result.contract;
  const analysis = contractAnalysis({ provider, model, summary: result.summary,
    weeklySummary: result.weeklySummary, cautions: result.cautions }, contract, {
    trustedEvidence: fallbackContext.trustedEvidence, expectedPlan: fallbackContext.expectedPlan
  });
  assertAnalysis(analysis);
  const scheduled = scheduleBundle(analysis.contract, { events: fallbackContext.existingEvents || [], notBefore: fallbackContext.notBefore ?? null });
  return contractAnalysis(analysis, scheduled.contract);
}

async function analyzeJournal(input = {}) {
  const started = performance.now();
  function finish(result) {
    result.evidenceCoverage = require('./contracts/journalEvidence.cjs').coverage(input, result.contract.evidence);
    if (result.evidenceCoverage.partial) result.cautions = [...result.cautions.slice(0, 18), input.outputLanguage === 'zh-CN' ? '仅完成部分分析：有日记文本超出证据预算。请查看覆盖范围，并拆分较长条目。' : 'Partial analysis: some journal text exceeds the evidence budget. Review coverage and analyze smaller entries.'];
    result.outputLanguage = input.outputLanguage;
    assertAnalysis(result);
    const meta = result.agentWorkflow;
    safeObserve(input.observe, { kind: 'analysis', outcome: meta.outcome, reason: meta.stopReason, durationMs: performance.now() - started,
      promptHash: meta.promptHash, promptVersion: meta.promptVersion, toolCalls: meta.toolCalls, toolErrors: meta.toolErrors });
    return result;
  }
  input = { ...input, outputLanguage: language.outputLanguage(input.journal?.content, input.outputLanguage) };
  const settings = input.settings || {};
  const config = getProviderConfig(settings);
  const availability = input.availability !== undefined ? input.availability : settings.defaultAvailability || [{ startsAt: "20:00", endsAt: "24:00" }];
  const expectedPlan = { targetDate: input.targetDate || input.journal?.journalDate, timezone: settings.timezone || "UTC", availability, bufferMinutes: 15 };
  // Validate workflow constraints before consuming provider budget.
  assertBundle({ schemaVersion: 1, evidence: [], tasks: [], estimates: [],
    plan: { id: "input", state: "proposal", ...expectedPlan, blocks: [], unscheduled: [], warnings: [] } });
  const supplementary = input.supplementalEvidence || [];
  // Reserve one confirmation record per permitted candidate task inside the unchanged 100-item contract.
  const trustedEvidence = [...collectJournalEvidence({ ...input, evidenceLimit: 92 - supplementary.length }), ...supplementary];
  const context = { ...input, availability, trustedEvidence, expectedPlan };
  const skills = loadSkills();
  const providers = {
    openai: { provider: "openai", apiKey: config.openaiKey, model: config.openaiModel, baseUrl: "https://api.openai.com/v1" },
    groq: { provider: "groq", apiKey: config.groqKey, model: config.groqModel, baseUrl: "https://api.groq.com/openai/v1" },
    gemini: { provider: "gemini", apiKey: config.geminiKey, model: config.geminiModel },
    glm: { provider: "glm", apiKey: config.glmKey, model: config.glmModel, baseUrl: "https://open.bigmodel.cn/api/paas/v4" }
  };
  const provider = Object.hasOwn(providers, config.provider) ? providers[config.provider] : null;
  let run;
  if (provider?.apiKey) {
    run = await runWorkflow({ ...context, provider: provider.provider, model: provider.model }, createProvider(provider), skills);
    if (run.analysis) {
      const result = { ...run.analysis, agentWorkflow: run.metadata };
      return finish(result);
    }
  }
  const fallback = localRuleBasedAnalysis(context);
  const reason = run?.metadata.stopReason || (config.provider === "local" ? "local_provider" : provider ? "missing_credentials" : "unsupported_provider");
  if (config.provider !== "local") {
    fallback.provider = "local-fallback";
    fallback.cautions = [input.outputLanguage === 'zh-CN' ? 'AI 工作流未能完成，已改用本地规则分析。请检查任务与证据。' : reason === "validation" || reason === "error_limit"
      ? "AI output failed contract validation; using the local fallback."
      : "AI workflow stopped (" + reason + "); using the local fallback.", ...fallback.cautions];
  }
  const selectedId = input.journal?.id || "input-journal-0";
  const refs = { summaryEvidenceIds: trustedEvidence.filter((item) => item.sourceId === selectedId).slice(0, 3).map((item) => item.id),
    weeklySummaryEvidenceIds: trustedEvidence.map((item) => item.id) };
  fallback.agentWorkflow = run ? { ...run.metadata, ...refs } : workflowMetadata(skills, buildMessages(skills, context, LIMITS).promptHash,
    { turns: 0, toolCalls: 0, toolErrors: 0, elapsedMs: 0, requestBytes: 0, trace: [] },
    config.provider === "local" ? "local" : "fallback", reason, refs);
  return finish(fallback);
}

function getPublicProviderConfig(settings = {}) {
  const config = getProviderConfig(settings);
  const models = { openai: config.openaiModel, groq: config.groqModel, gemini: config.geminiModel, glm: config.glmModel, local: "rule-based-v1" };
  return { effectiveAiProvider: config.provider, aiModel: Object.hasOwn(models, config.provider) ? models[config.provider] : null,
    aiProviderOverride: Boolean(process.env.AI_PROVIDER) };
}

module.exports = { analyzeJournal, inferTask, localRuleBasedAnalysis, splitSentences, normalizeRemoteAnalysis, getPublicProviderConfig };
