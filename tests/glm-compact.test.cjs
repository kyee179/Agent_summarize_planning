const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToolText } = require('../server/agent/glmToolText.cjs');
const { wireSchema } = require('../server/agent/compactProposal.cjs');
const { createToolSession } = require('../server/agent/tools.cjs');
const { collectJournalEvidence, assertAnalysis } = require('../server/contracts/analysis.cjs');
const { ContractError } = require('../server/contracts/validate.cjs');
const { runWorkflow } = require('../server/agent/runtime.cjs');
const { createProvider } = require('../server/agent/providers.cjs');
const { loadSkills } = require('../server/agent/skills.cjs');
const { contains, actionMatch } = require('../evaluation/runner.cjs');
function context() {
  const journal = { id: 'j', type: 'daily', journalDate: '2030-01-07', content: 'I should update my CV.' };
  return { journal, trustedEvidence: collectJournalEvidence({ journal }), provider: 'glm', model: 'glm-4-flash',
    expectedPlan: { targetDate: journal.journalDate, timezone: 'UTC', availability: [{ startsAt: '09:00', endsAt: '17:00' }], bufferMinutes: 15 } };
}
function proposal(ctx) { return { summary: 'Update my CV.', summaryEvidenceIds: [ctx.trustedEvidence[0].id],
  tasks: [{ title: 'Update my CV', evidenceIds: [ctx.trustedEvidence[0].id], importance: 'medium', effortMinutes: [15, 30, 60], assumption: 'One revision session; confirm scope.' }] }; }
test('GLM JSON tool text accepts a whole bounded envelope, rejects prose and extra/multiple calls', () => {
  assert.equal(parseToolText('{"name":"read_evidence","parameters":{"offset":0,"limit":20}}', 1).name, 'read_evidence');
  assert.equal(parseToolText('```json\n{"name":"get_planning_context","arguments":{}}\n```', 2).id, 'glm-json:2');
  for (const text of ['Do this: {"name":"run_shell","parameters":{}}', '{"name":"read_evidence","parameters":{},"command":"x"}',
    '[{"name":"read_evidence","parameters":{}}]', '{"summary":"ordinary completion"}', '```json\n{}\n``` trailing']) assert.equal(parseToolText(text, 1), null);
});
test('compact proposals retain canonical validation, unknown deadlines/low confidence and explicitly partial weekly scope', () => {
  const ctx = context(), session = createToolSession(ctx, 'glm', 'glm-4-flash');
  assert.equal(wireSchema(ctx).properties.weeklySummary, undefined);
  session.execute('read_evidence', { offset: 0, limit: 20 }); session.execute('get_planning_context', {});
  const candidate = proposal(ctx); session.execute('preview_plan', { proposal: candidate });
  const finished = session.execute('finish_analysis', { previewId: 'preview:1' }).finished.analysis;
  assertAnalysis(finished); assert.equal(finished.contract.tasks[0].deadline, null); assert.equal(finished.contract.estimates[0].confidence, 'low');
  assert.match(finished.weeklySummary, /Partial journal context/);
  const bad = structuredClone(candidate); bad.tasks[0].deadline = '2030-01-07'; assert.throws(() => session.execute('preview_plan', { proposal: bad }), ContractError);
  const invalidRange = structuredClone(candidate); invalidRange.tasks[0].effortMinutes = [60, 30, 15]; assert.throws(() => session.execute('preview_plan', { proposal: invalidRange }), ContractError);
  const unknown = structuredClone(candidate); unknown.tasks[0].evidenceIds = ['invented']; assert.throws(() => session.execute('preview_plan', { proposal: unknown }), ContractError);
  const noEffort = structuredClone(candidate); noEffort.tasks[0].effortMinutes = null; session.execute('preview_plan', { proposal: noEffort });
  const output = session.execute('finish_analysis', { previewId: 'preview:2' }).finished.analysis; assert.equal(output.contract.estimates.length, 0); assert.equal(output.contract.plan.blocks.length, 0);
});
test('GLM native and JSON-envelope calls use one permission/state/budget-controlled workflow', async () => {
  const ctx = context(); let turn = 0;
  const calls = [{ name: 'read_evidence', parameters: { offset: 0, limit: 20 } }, { name: 'get_planning_context', parameters: {} },
    { name: 'preview_plan', parameters: { proposal: proposal(ctx) } }, { name: 'finish_analysis', parameters: { previewId: 'preview:1' } }];
  const adapter = createProvider({ provider: 'glm', model: 'glm-4-flash', apiKey: 'synthetic', baseUrl: 'https://example.test' }, async (_url, options) => {
    const body = JSON.parse(options.body); if (turn === 0) assert.deepEqual(body.tools.map((t) => t.function.name), ['read_evidence']);
    const item = calls[turn++]; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(item) } }] }));
  });
  const result = await runWorkflow(ctx, adapter, loadSkills()); assert.equal(result.metadata.outcome, 'completed'); assert.equal(result.metadata.toolCalls, 4);
  const forbidden = createProvider({ provider: 'glm', model: 'glm-4-flash', apiKey: 'synthetic', baseUrl: 'https://example.test' }, async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"name":"write_calendar","parameters":{}}' } }] })));
  assert.equal((await runWorkflow(ctx, forbidden, loadSkills())).metadata.stopReason, 'error_limit');
});
test('metric version 2 tolerates grammar but still rejects negation and changed actions', () => {
  assert.equal(actionMatch('Update CV', 'update my CV'), true); assert.equal(contains('I was updating the CV', 'update my CV'), true);
  assert.equal(actionMatch('Do not update CV', 'update my CV'), false); assert.equal(actionMatch('Delete my CV', 'update my CV'), false);
  assert.equal(actionMatch('Prepare interview', 'prepare the interview'), true);
});

test('compact summary references are constrained to the selected journal before optional retrieval', () => {
  const ctx = context();
  ctx.trustedEvidence.push({ ...ctx.trustedEvidence[0], id: 'related:1', sourceId: 'another-journal' });
  const schema = wireSchema(ctx);
  assert.deepEqual(schema.properties.summaryEvidenceIds.items.enum, [ctx.trustedEvidence[0].id]);
  assert.match(schema.properties.summary.description, /only the selected journal/);
  const session = createToolSession(ctx, 'glm', 'glm-4-flash');
  session.execute('read_evidence', { offset: 0, limit: 20 }); session.execute('get_planning_context', {});
  const candidate = { ...proposal(ctx), weeklySummary: 'Partial journal context.', weeklySummaryEvidenceIds: [ctx.trustedEvidence[0].id] };
  candidate.summaryEvidenceIds = ['related:1'];
  assert.throws(() => session.execute('preview_plan', { proposal: candidate }), ContractError);
  candidate.summaryEvidenceIds = [ctx.trustedEvidence[0].id];
  candidate.tasks[0].evidenceIds = ['related:1'];
  candidate.weeklySummaryEvidenceIds = ['related:1'];
  assert.doesNotThrow(() => session.execute('preview_plan', { proposal: candidate }));
  const finished = session.execute('finish_analysis', { previewId: 'preview:1' }).finished.analysis;
  assert.deepEqual(finished.contract.tasks[0].evidenceIds, ['related:1']);
  assertAnalysis(finished);
  const empty = wireSchema({ ...ctx, trustedEvidence: [] });
  assert.equal(empty.properties.summaryEvidenceIds.minItems, 0);
  assert.equal(empty.properties.summaryEvidenceIds.maxItems, 0);
});
