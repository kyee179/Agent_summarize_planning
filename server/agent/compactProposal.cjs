const { ContractError } = require('../contracts/validate.cjs');
const text = { type: 'string', minLength: 1, maxLength: 500 };
const refs = { type: 'array', items: { type: 'string', maxLength: 128 }, uniqueItems: true, maxItems: 100 };
const schema = { type: 'object', additionalProperties: false,
  required: ['summary', 'summaryEvidenceIds', 'tasks'],
  properties: {
    summary: { ...text, maxLength: 2000 }, weeklySummary: { ...text, maxLength: 2000 }, summaryEvidenceIds: refs, weeklySummaryEvidenceIds: refs,
    cautions: { type: 'array', items: text, maxItems: 8 },
    tasks: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['title', 'evidenceIds', 'importance', 'effortMinutes', 'assumption'],
      properties: {
        title: text, evidenceIds: { ...refs, minItems: 1 }, importance: { enum: ['unknown', 'low', 'medium', 'high'] },
        effortMinutes: { anyOf: [{ type: 'null' }, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 525600 } }] },
        assumption: text, scope: { enum: ['next_session', 'remaining_task'] }, status: { enum: ['open', 'in_progress', 'blocked'] },
        dependsOn: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 8 } }
      } } }
  } };

/** Expand validated compact model judgments into canonical task/estimate v1 records. */
function expandProposal(proposal) {
  const estimates = [];
  const tasks = proposal.tasks.map((item, i) => {
    const id = `task:${i + 1}`, estimateId = item.effortMinutes === null ? null : `estimate:${i + 1}`;
    if (item.effortMinutes && !(item.effortMinutes[0] <= item.effortMinutes[1] && item.effortMinutes[1] <= item.effortMinutes[2])) {
      throw new ContractError([{ path: `/tasks/${i}/effortMinutes`, code: 'range', message: 'Effort must be low, expected, high in ascending order' }]);
    }
    if (estimateId) estimates.push({ id: estimateId, taskId: id, scope: item.scope || 'next_session', basis: 'model',
      effortMinutes: { low: item.effortMinutes[0], expected: item.effortMinutes[1], high: item.effortMinutes[2] }, confidence: 'low', evidenceIds: [],
      assumptions: [item.assumption], rationale: 'Tentative model effort; scope and duration require user review.' });
    return { id, title: item.title, description: item.title, status: item.status || 'open', evidenceIds: item.evidenceIds,
      importance: { level: item.importance, basis: item.importance === 'unknown' ? 'unknown' : 'inferred', reason: 'Tentative model interpretation; confirm against your goals.', evidenceIds: item.evidenceIds },
      deadline: null, estimateId, dependsOn: (item.dependsOn || []).map((n) => `task:${n}`),
      clarificationQuestions: ['Confirm remaining scope, effort, and any explicit deadline before applying.'] };
  });
  return { summary: proposal.summary, weeklySummary: proposal.weeklySummary ?? `Partial journal context from the selected entry: ${proposal.summary}`,
    summaryEvidenceIds: proposal.summaryEvidenceIds,
    weeklySummaryEvidenceIds: proposal.weeklySummaryEvidenceIds ?? proposal.summaryEvidenceIds, cautions: proposal.cautions || [], tasks, estimates };
}
/** Provide minimum reference counts when workflow-owned evidence is available. */
function wireSchema(context) {
  const result = structuredClone(schema);
  result.properties.summaryEvidenceIds.minItems = context.trustedEvidence.some((item) => item.sourceId === (context.journal.id || 'input-journal-0')) ? 1 : 0;
  result.properties.weeklySummaryEvidenceIds.minItems = context.trustedEvidence.length ? 1 : 0;
  result.properties.weeklySummaryEvidenceIds.description = 'Read source IDs supporting partial weekly context; include the selected journal ID references even when no related journals exist.';
  const journals = new Set(context.trustedEvidence.filter((item) => item.sourceType === 'journal').map((item) => item.sourceId));
  if (journals.size <= 1) {
    delete result.properties.weeklySummary; delete result.properties.weeklySummaryEvidenceIds;
  } else result.required.push('weeklySummary', 'weeklySummaryEvidenceIds');
  return result;
}
module.exports = { schema, wireSchema, expandProposal };
