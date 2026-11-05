const { ContractError } = require('../contracts/validate.cjs');
const text = { type: 'string', minLength: 1, maxLength: 500 };
const refs = { type: 'array', items: { type: 'string', maxLength: 128 }, uniqueItems: true, maxItems: 100 };
const schema = { type: 'object', additionalProperties: false,
  required: ['summary', 'summaryEvidenceIds', 'tasks'],
  properties: {
    summary: { ...text, maxLength: 2000 }, weeklySummary: { ...text, maxLength: 2000 }, summaryEvidenceIds: refs, weeklySummaryEvidenceIds: refs,
    cautions: { type: 'array', items: text, maxItems: 8 },
    tasks: { type: 'array', description: 'Use [] when the source contains only negated, cancelled, completed or speculative work. Never create a task just to fill this array.', minItems: 0, maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['title', 'evidenceIds', 'importance', 'effortMinutes', 'assumption'],
      properties: {
        title: text, evidenceIds: { ...refs, minItems: 1 }, importance: { enum: ['unknown', 'low', 'medium', 'high'] },
        effortMinutes: { anyOf: [{ type: 'null' }, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 525600 } }] },
        assumption: text, scope: { enum: ['next_session', 'remaining_task'] }, status: { enum: ['open', 'in_progress', 'blocked'] },
        dependsOn: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 8 } }
      } } }
  } };

/** Expand validated compact model judgments into canonical task/estimate v1 records. */
function expandProposal(proposal, context = {}) {
  const chinese = context.outputLanguage === 'zh-CN';
  const estimates = [];
  const tasks = (proposal.tasks || []).map((item, i) => {
    const id = `task:${i + 1}`, estimateId = item.effortMinutes === null ? null : `estimate:${i + 1}`;
    if (item.effortMinutes && !(item.effortMinutes[0] <= item.effortMinutes[1] && item.effortMinutes[1] <= item.effortMinutes[2])) {
      throw new ContractError([{ path: `/tasks/${i}/effortMinutes`, code: 'range', message: 'Effort must be low, expected, high in ascending order' }]);
    }
    if (estimateId) estimates.push({ id: estimateId, taskId: id, scope: item.scope || 'next_session', basis: 'model',
      effortMinutes: { low: item.effortMinutes[0], expected: item.effortMinutes[1], high: item.effortMinutes[2] }, confidence: 'low', evidenceIds: [],
      assumptions: [item.assumption], rationale: chinese ? '模型给出的暂定用时；范围和时长需要用户确认。' : 'Tentative model effort; scope and duration require user review.' });
    return { id, title: item.title, description: item.title, status: item.status || 'open', evidenceIds: item.evidenceIds,
      importance: { level: item.importance, basis: item.importance === 'unknown' ? 'unknown' : 'inferred', reason: chinese ? '模型给出的暂定判断；请根据你的目标确认。' : 'Tentative model interpretation; confirm against your goals.', evidenceIds: item.evidenceIds },
      deadline: null, estimateId, dependsOn: (item.dependsOn || []).map((n) => `task:${n}`),
      clarificationQuestions: [chinese ? '应用前，请确认剩余范围、用时和明确的截止时间。' : 'Confirm remaining scope, effort, and any explicit deadline before applying.'] };
  });
  return { summary: proposal.summary, weeklySummary: proposal.weeklySummary ?? (context.outputLanguage === 'zh-CN' ? `所选日记的部分上下文（不代表完整一周）：${proposal.summary}` : `Partial journal context from the selected entry: ${proposal.summary}`),
    summaryEvidenceIds: proposal.summaryEvidenceIds,
    weeklySummaryEvidenceIds: proposal.weeklySummaryEvidenceIds ?? proposal.summaryEvidenceIds, cautions: proposal.cautions || [], tasks, estimates };
}
/** Advertise selected-journal citation boundaries and minimum source counts. */
function wireSchema(context) {
  const result = structuredClone(schema);
  // Reinforce an explicit no-action source in the advertised tool schema as well as validation.
  if (!context.memorySearch && !context.webResearch && context.trustedEvidence.length && context.trustedEvidence.every(item => item.sourceType === 'journal' && require('../language.cjs').explicitNonAction(item.excerpt))) {
    // GLM's native argument generator can fill empty object arrays with placeholder tasks.
    // Omit that field entirely for this proven no-action case; canonical expansion supplies [].
    delete result.properties.tasks;
    result.required = result.required.filter(key => key !== 'tasks');
  }
  // Reference branches share an items object; isolate the journal-only restriction.
  result.properties.summaryEvidenceIds = { ...result.properties.summaryEvidenceIds, items: { ...result.properties.summaryEvidenceIds.items } };
  const selectedIds = context.trustedEvidence.filter((item) => item.sourceId === (context.journal.id || 'input-journal-0')).map((item) => item.id);
  result.properties.summary.description = 'Summarize only the selected journal in one or two short sentences. Preserve salient source action phrases, negation and technical terms (for example 更新CV), using the requested output language. Retrieved memory/web belong to task context, not this summary.';
  if (!result.properties.tasks) result.properties.summary.description += ' This is a summary-only proposal of explicit non-action; no task field is permitted.';
  result.properties.summaryEvidenceIds.description = 'Cite only the selected-journal evidence IDs declared here. Do not include retrieved memory or web evidence.';
  result.properties.summaryEvidenceIds.minItems = selectedIds.length ? 1 : 0;
  if (selectedIds.length) result.properties.summaryEvidenceIds.items.enum = selectedIds;
  else result.properties.summaryEvidenceIds.maxItems = 0;
  result.properties.weeklySummaryEvidenceIds.minItems = context.trustedEvidence.length ? 1 : 0;
  result.properties.weeklySummaryEvidenceIds.description = 'Read source IDs supporting partial weekly context; include the selected journal ID references even when no related journals exist.';
  const journals = new Set(context.trustedEvidence.filter((item) => item.sourceType === 'journal').map((item) => item.sourceId));
  if (journals.size <= 1) {
    delete result.properties.weeklySummary; delete result.properties.weeklySummaryEvidenceIds;
  } else result.required.push('weeklySummary', 'weeklySummaryEvidenceIds');
  return result;
}
module.exports = { schema, wireSchema, expandProposal };
