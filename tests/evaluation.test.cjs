const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runEvaluation, scoreAnalysis, inputFor, dataset, gates, schedulerBundle, scheduleSafe } = require('../evaluation/runner.cjs');
const { localRuleBasedAnalysis } = require('../server/journalAnalyzer.cjs');
const { scheduleBundle } = require('../server/scheduler.cjs');
const { privatePath } = require('../scripts/quality-check.cjs');

test('offline dataset passes actual analyzer/scheduler/FTS gates while reporting challenge failures', async () => {
  const result = await runEvaluation();
  assert.equal(result.passed, true, JSON.stringify(result.gates));
  assert.equal(result.analysis.gate.cases, 18); assert.equal(result.analysis.challenge.cases, 8);
  assert.ok(result.analysis.challenge.taskRecall < 1);
  assert.equal(result.retrieval.mode, 'actual_sqlite_lexical'); assert.equal(result.fusion.mode, 'synthetic_rank_mechanics');
  assert.equal(result.datasetHash.length, 64);
});
test('quality scores penalize missing tasks, duplicate proposals, fabricated facts and missing citations', () => {
  const item = dataset.analysis[0], result = localRuleBasedAnalysis(inputFor(item));
  result.agentWorkflow = { summaryEvidenceIds: result.contract.evidence.map((e) => e.id) };
  const first = scoreAnalysis(item, result); assert.equal(first.matched, 1);
  const duplicate = structuredClone(result); duplicate.contract.tasks.push(duplicate.contract.tasks[0]);
  const score = scoreAnalysis(item, duplicate); assert.equal(score.proposed, 2); assert.equal(score.matched, 1); assert.equal(score.valid, false);
  result.agentWorkflow.summaryEvidenceIds = ['invented']; assert.equal(scoreAnalysis(item, result).cited, false);
  result.contract.tasks[0].deadline = { at: '2030-01-07T12:00:00Z', kind: 'hard', evidenceIds: [] };
  assert.equal(scoreAnalysis(item, result).safe, false); assert.equal(scoreAnalysis(item, result).valid, false);
  assert.equal(gates({}, { metric: 1 })[0].passed, false);
});
test('live evaluation cannot pass by returning the validated local fallback', async () => {
  const result = await runEvaluation({ live: true, analyze: async (input) => ({ ...localRuleBasedAnalysis(input), agentWorkflow: { outcome: 'fallback', stopReason: 'timeout', summaryEvidenceIds: [] } }) });
  assert.equal(result.passed, false);
  assert.equal(result.gates.find((g) => g.metric === 'remoteCompletionRate').value, 0);
});
test('independent scheduling invariants catch a shifted conflicting allocation', () => {
  const item = dataset.scheduler[0];
  const output = scheduleBundle(schedulerBundle(item), { events: item.events }).contract;
  assert.equal(scheduleSafe(output, item.events), true);
  output.plan.blocks[0].startsAt = '2030-01-07T09:00:00Z'; output.plan.blocks[0].endsAt = '2030-01-07T10:30:00Z';
  assert.equal(scheduleSafe(output, item.events), false);
});
test('private data gate blocks telemetry, databases and env files but permits synthetic fixtures', () => {
  for (const file of ['google_setup/renamed-oauth.json', 'secret.txt', 'client_secret_desktop.json', 'credentials.json', 'credentials.encrypted', 'credentials.encrypted.tmp', '.env', '.env.local', 'server/data/private.json', 'calendar.sqlite-wal', 'telemetry/trace-0.jsonl', 'evaluation/reports/live.json']) assert.ok(privatePath(file), file);
  for (const file of ['.env.example', 'evaluation/dataset.v1.json', 'server/recovery.cjs']) assert.equal(privatePath(file), false);
});
