const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { analyzeJournal } = require('../server/journalAnalyzer.cjs');
const { assertAnalysis } = require('../server/contracts/analysis.cjs');
const { scheduleBundle } = require('../server/scheduler.cjs');
const { expandEvents } = require('../server/eventOccurrences.cjs');
const { wallClockInstant } = require('../server/contracts/time.cjs');
const { createStore } = require('../server/store.cjs');
const { createMemory, fuse } = require('../server/integrations/memory.cjs');
const { loadSkills } = require('../server/agent/skills.cjs');
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.v1.json'), 'utf8'));
const METRIC_VERSION = '3.0.0';
const defaultAvailability = [{ startsAt: '09:00', endsAt: '17:00' }];
const stopWords = new Set(['a', 'an', 'the', 'my', 'your', 'our', 'their', 'his', 'her', 'to', 'for', 'of', 'on', 'in', 'at']);
function normalizedWords(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((word) => !stopWords.has(word))
    .map((word) => /^[a-z]{5,}$/.test(word) ? word.replace(/(?:ing|ed|s)$/, '').replace(/e$/, '') : word);
}
// Version 3 also guards explicit Chinese negation/completion; source text stays unchanged.
function contains(text, phrase) {
  if (typeof text !== 'string') return false;
  if (text.toLowerCase().includes(phrase.toLowerCase())) return true;
  const expected = normalizedWords(phrase), actual = normalizedWords(text);
  return expected.length > 0 && actual.some((_, i) => expected.every((word, j) => word === actual[i + j]));
}
function actionMatch(text, phrase) {
  const negative = /\b(?:not|never|cancelled|canceled|don't)\b|不需要|无需|不用|不要|取消|已经完成|已完成|完成了/iu;
  return typeof text === 'string' && negative.test(text) === negative.test(phrase) && contains(text, phrase);
}
const fraction = (good, total) => total ? good / total : 1;

function inputFor(item) {
  return { journal: { id: `eval:${item.id}`, type: 'daily', journalDate: dataset.date, content: item.content },
    targetDate: dataset.date, relatedJournals: [], settings: { timezone: 'UTC' }, availability: defaultAvailability,
    notBefore: dataset.date + 'T00:00:00Z', existingEvents: item.events || [] };
}
function scoreAnalysis(item, result) {
  let valid = true;
  try { assertAnalysis(result); } catch { valid = false; }
  const tasks = result?.contract?.tasks || [], available = new Set(tasks.map((_, index) => index));
  let matched = 0;
  for (const phrase of item.tasks) {
    const index = [...available].find((i) => actionMatch(tasks[i].title, phrase));
    if (index !== undefined) { matched++; available.delete(index); }
  }
  const refs = result?.agentWorkflow?.summaryEvidenceIds || [];
  const evidence = result?.contract?.evidence || [];
  const cited = refs.every((id) => evidence.some((e) => e.id === id)) && (!item.content || refs.length > 0) &&
    tasks.every((task) => task.evidenceIds?.length && task.evidenceIds.every((id) => evidence.some((e) => e.id === id)));
  const estimates = result?.contract?.estimates || [];
  const safe = tasks.every((task) => task.deadline === null) && estimates.every((estimate) => estimate.confidence === 'low');
  const anchors = item.summaryAnchors.filter((phrase) => contains(result?.summary, phrase)).length;
  return { id: item.id, split: item.split, language: item.language || require('../server/language.cjs').outputLanguage(item.content), matched, expected: item.tasks.length, proposed: tasks.length,
    coveredAnchors: anchors, anchors: item.summaryAnchors.length, valid, cited, safe,
    chineseOutput: result?.outputLanguage === 'zh-CN' && /\p{Script=Han}/u.test(result?.summary || ''),
    explicitDeadlineExtracted: item.explicitDeadline ? tasks.some((task) => task.deadline?.at === item.explicitDeadline) : null,
    outcome: result?.agentWorkflow?.outcome || 'error', reason: result?.agentWorkflow?.stopReason || 'validation',
    durationMs: result?.agentWorkflow?.elapsedMs || 0, requestBytes: result?.agentWorkflow?.requestBytes || 0 };
}
function aggregate(rows) {
  const sum = (key) => rows.reduce((n, item) => n + item[key], 0);
  return { cases: rows.length, taskPrecision: fraction(sum('matched'), sum('proposed')), taskRecall: fraction(sum('matched'), sum('expected')),
    summaryAnchorCoverage: fraction(sum('coveredAnchors'), sum('anchors')), validity: fraction(rows.filter((r) => r.valid).length, rows.length),
    citationValidity: fraction(rows.filter((r) => r.cited).length, rows.length), uncertaintySafety: fraction(rows.filter((r) => r.safe).length, rows.length) };
}
function schedulerBundle(item) {
  const date = item.date || dataset.date;
  const evidence = [{ id: 'e', sourceType: 'user', sourceId: 'synthetic', sourceVersion: '1', locator: null, excerpt: 'Synthetic confirmed task specification',
    observedAt: date + 'T00:00:00Z', sourceTimestamp: null, verification: 'user_confirmed', facts: [] }];
  const tasks = item.tasks.map((spec) => {
    if (spec.deadline) evidence[0].facts.push({ field: 'deadline', value: spec.deadline });
    if (spec.status === 'completed') evidence[0].facts.push({ field: 'status', value: 'completed' });
    return { id: spec.id, title: spec.id, description: 'Synthetic work', status: spec.status || 'open', evidenceIds: ['e'],
      importance: { level: 'medium', basis: 'inferred', reason: 'Fixture', evidenceIds: ['e'] },
      deadline: spec.deadline ? { at: spec.deadline, kind: 'hard', evidenceIds: ['e'] } : null,
      estimateId: 'estimate:' + spec.id, dependsOn: spec.dependsOn || [], clarificationQuestions: [] };
  });
  const estimates = item.tasks.map((spec) => ({ id: 'estimate:' + spec.id, taskId: spec.id, scope: 'remaining_task', basis: spec.minutes === null ? 'unknown' : 'model',
    effortMinutes: spec.minutes === null ? null : { low: spec.minutes, expected: spec.minutes, high: spec.minutes },
    confidence: spec.minutes === null ? 'unknown' : 'low', evidenceIds: [], assumptions: ['Synthetic'], rationale: 'Synthetic' }));
  return { schemaVersion: 1, evidence, tasks, estimates, plan: { id: 'p', state: 'proposal', timezone: item.timezone || 'UTC', targetDate: date,
    availability: item.availability || defaultAvailability, bufferMinutes: 15, blocks: [], unscheduled: [], warnings: [] } };
}
function scheduleSafe(bundle, events, notBefore = null) {
  const { plan } = bundle, buffer = plan.bufferMinutes * 60000;
  const blocks = plan.blocks;
  const windows = plan.availability.map((slot) => [Date.parse(wallClockInstant(plan.targetDate, slot.startsAt, plan.timezone)), Date.parse(wallClockInstant(plan.targetDate, slot.endsAt, plan.timezone))]);
  const from = Date.parse(wallClockInstant(plan.targetDate, '00:00', plan.timezone)) - buffer;
  const occurrences = expandEvents(events, { from, to: from + 27 * 3600000, timezone: plan.timezone });
  return blocks.every((block, i) => {
    const start = Date.parse(block.startsAt), end = Date.parse(block.endsAt), task = bundle.tasks.find((t) => t.id === block.taskId);
    const estimate = bundle.estimates.find((e) => e.id === block.estimateId);
    return end - start === estimate.effortMinutes.expected * 60000 && end > start &&
      (!notBefore || start >= Date.parse(notBefore)) && windows.some(([a, b]) => start >= a && end <= b) &&
      occurrences.every((event) => end <= event.start - buffer || start >= event.end + buffer) &&
      blocks.every((other, j) => i === j || end + buffer <= Date.parse(other.startsAt) || start >= Date.parse(other.endsAt) + buffer) &&
      (!task.deadline || task.deadline.kind !== 'hard' || end <= Date.parse(task.deadline.at)) &&
      task.dependsOn.every((id) => bundle.tasks.find((t) => t.id === id).status === 'completed' || blocks.some((b) => b.taskId === id && Date.parse(b.endsAt) <= start));
  });
}
function gates(metrics, thresholds) {
  return Object.entries(thresholds).map(([metric, minimum]) => ({ metric, value: metrics[metric] ?? null, minimum,
    passed: Number.isFinite(metrics[metric]) && metrics[metric] >= minimum }));
}
async function runEvaluation({ live = false, language = null, analyze = analyzeJournal, onCase } = {}) {
  const previous = process.env.AI_PROVIDER;
  if (!live) process.env.AI_PROVIDER = 'local';
  const started = performance.now(), rows = [], usage = { reportedResponses: 0, inputTokens: 0, outputTokens: 0 };
  try {
    const selected = live && language === 'zh-CN' ? dataset.analysis.filter(item => ['zh-regression-01', 'zh-regression-02', 'zh-regression-11'].includes(item.id)) : dataset.analysis.slice(0, 3);
    for (const item of live ? selected : dataset.analysis) {
      const caseStarted = performance.now();
      try { rows.push(scoreAnalysis(item, await analyze({ ...inputFor(item), observe: (event) => {
        if (event.kind === 'provider' && Number.isSafeInteger(event.inputTokens) && Number.isSafeInteger(event.outputTokens)) {
          usage.reportedResponses++; usage.inputTokens += event.inputTokens; usage.outputTokens += event.outputTokens;
        }
      } }))); }
      catch { rows.push(scoreAnalysis(item, null)); }
      rows.at(-1).wallMs = Math.floor(performance.now() - caseStarted);
      onCase?.(rows.at(-1));
    }
  } finally { if (previous === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = previous; }
  const gateMetrics = aggregate(rows.filter((r) => r.split === 'gate'));
  const report = { schemaVersion: 1, metricVersion: METRIC_VERSION, datasetVersion: dataset.datasetVersion,
    datasetHash: crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex'), mode: live ? 'live_synthetic' : 'offline_local',
    promptVersion: loadSkills().promptVersion, usage: { ...usage, cost: null, note: 'Reported tokens only; missing/failed responses are not zero usage. No price table configured.' },
    limitations: ['Phrase metrics are proxies, not factual entailment.', 'No measured effort outcomes.', 'No actual embedding quality measurement.', 'Synthetic development set, not a held-out benchmark.'],
    analysis: { gate: gateMetrics, challenge: aggregate(rows.filter((r) => r.split === 'challenge')), cases: rows } };
  if (live) {
    report.gates = gates({ ...gateMetrics, remoteCompletionRate: fraction(rows.filter((r) => r.outcome === 'completed').length, rows.length) },
      { taskPrecision: 0.9, taskRecall: 0.9, summaryAnchorCoverage: 0.9, validity: 1, citationValidity: 1, remoteCompletionRate: 1 });
    if (language === 'zh-CN') report.gates.push(...gates({ chineseOutputRate: fraction(rows.filter(row => row.chineseOutput).length, rows.length) }, { chineseOutputRate: 1 }));
  } else {
    const schedules = dataset.scheduler.map((item) => {
      try {
        const output = scheduleBundle(schedulerBundle(item), { events: item.events || [], notBefore: item.notBefore || null }).contract;
        const exact = JSON.stringify(output.plan.blocks.map((b) => [b.taskId, b.startsAt])) === JSON.stringify(item.expected) &&
          JSON.stringify(output.plan.unscheduled.map((u) => [u.taskId, u.reason])) === JSON.stringify(item.unscheduled);
        return { id: item.id, passed: exact && scheduleSafe(output, item.events || [], item.notBefore) };
      } catch { return { id: item.id, passed: false }; }
    });
    const store = createStore(':memory:'); let retrieval;
    try {
      for (const item of dataset.memory.documents) store.putMemoryDocument({ ...item, updatedAt: dataset.date + 'T00:00:00Z' });
      const memory = createMemory(store, { env: {} });
      retrieval = [];
      for (const item of dataset.memory.queries) {
        const result = await memory.search({ query: item.query, limit: 3 });
        const ids = [...new Set(result.items.map((r) => r.sourceId))];
        const first = ids.findIndex((id) => item.relevant.includes(id));
        retrieval.push({ id: item.id, recall: fraction(item.relevant.filter((id) => ids.includes(id)).length, item.relevant.length),
          reciprocalRank: item.relevant.length ? (first < 0 ? 0 : 1 / (first + 1)) : (ids.length ? 0 : 1),
          absentCorrect: item.relevant.length > 0 || ids.length === 0 });
      }
    } finally { store.close(); }
    const fusion = dataset.memory.fusion.map((item) => ({ id: item.id, passed: JSON.stringify(fuse(item.lexical.map((id) => ({ id })), item.semantic.map((id) => ({ id })), 3).map((r) => r.id)) === JSON.stringify(item.expected) }));
    const metrics = { ...gateMetrics, schedulePassRate: fraction(schedules.filter((r) => r.passed).length, schedules.length),
      retrievalRecallAt3: retrieval.reduce((n, r) => n + (r.absentCorrect ? r.recall : 0), 0) / retrieval.length,
      retrievalMRR: retrieval.reduce((n, r) => n + r.reciprocalRank, 0) / retrieval.length, fusionPassRate: fraction(fusion.filter((r) => r.passed).length, fusion.length) };
    report.scheduler = schedules; report.retrieval = { mode: 'actual_sqlite_lexical', cases: retrieval }; report.fusion = { mode: 'synthetic_rank_mechanics', cases: fusion };
    report.gates = gates(metrics, dataset.gates);
  }
  report.passed = report.gates.every((gate) => gate.passed);
  report.elapsedMs = Math.floor(performance.now() - started);
  if (!live) {
    report.analysis.byLanguage={};
    for(const lang of [...new Set(rows.filter(row=>row.split==='gate').map(row=>row.language))]) {
      const scores=aggregate(rows.filter(row=>row.split==='gate'&&row.language===lang));report.analysis.byLanguage[lang]=scores;
      for(const metric of ['taskPrecision','taskRecall','summaryAnchorCoverage','validity','citationValidity','uncertaintySafety']) report.gates.push({metric:lang+':'+metric,value:scores[metric],minimum:dataset.gates[metric],passed:scores[metric]>=dataset.gates[metric]});
    }
    report.passed=report.gates.every(gate=>gate.passed);
  }
  return report;
}
module.exports = { dataset, METRIC_VERSION, inputFor, scoreAnalysis, aggregate, schedulerBundle, scheduleSafe, gates, runEvaluation, contains, actionMatch };
