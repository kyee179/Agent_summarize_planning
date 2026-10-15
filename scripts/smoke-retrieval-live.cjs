const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const { createStore } = require('../server/store.cjs');
const { createMemory } = require('../server/integrations/memory.cjs');
const { createResearch } = require('../server/integrations/research.cjs');
const { collectJournalEvidence, assertAnalysis } = require('../server/contracts/analysis.cjs');
const { runWorkflow } = require('../server/agent/runtime.cjs');
const { createProvider } = require('../server/agent/providers.cjs');
const { loadSkills } = require('../server/agent/skills.cjs');

// Opt-in network smoke. Never opens the app DB, personal journals, or Google tokens.
// A test-only subset of already-authorized tools selects retrieval paths explicitly.
// This verifies integration execution, not the model's natural tool-selection quality.
async function main() {
  if (!process.env.GLM_API_KEY) throw new Error('missing_glm_key');
  if (!process.env.TAVILY_API_KEY) throw new Error('missing_tavily_key');
  const store = createStore(':memory:');
  try {
    const targetDate = '2030-01-07';
    store.putMemoryDocument({
      id: 'memory:synthetic-oauth', title: 'Google Calendar OAuth checklist',
      content: 'Synthetic scope note: review Google desktop OAuth state, PKCE, read-only Calendar scopes and encrypted token storage. Only one review session is in scope. No deadline or measured effort has been confirmed.',
      updatedAt: new Date().toISOString()
    });
    const memory = createMemory(store, { env: {} }); // Exercises actual SQLite FTS, without an embedding service.
    await memory.index({ consent: true, semantic: false });
    const research = createResearch({ env: { ...process.env, WEB_SEARCH_PROVIDER: 'tavily' } });
    let memoryCalls = 0, webCalls = 0, memoryHits = 0, credits = 0;
    let memorySucceeded = false, webSucceeded = false;
    const journal = {
      id: 'synthetic-forced-path', type: 'daily', journalDate: targetDate,
      content: 'I need to review Google Calendar desktop OAuth documentation and draft a connection checklist. My scope note is indexed as Google Calendar OAuth checklist. The task deadline is unknown.'
    };
    const context = {
      journal, provider: 'glm', model: 'glm-4-flash',
      trustedEvidence: collectJournalEvidence({ journal }),
      expectedPlan: { targetDate, timezone: 'UTC', availability: [{ startsAt: '09:00', endsAt: '17:00' }], bufferMinutes: 15 },
      existingEvents: [],
      memorySearch: async (args, signal) => {
        memoryCalls++;
        const result = await memory.search(args, signal);
        memoryHits += result.items.length;
        return result;
      },
      webResearch: async (args, signal) => {
        webCalls++;
        // Limit this diagnostic to public documentation; reject accidental identifiers.
        if (/GOCSPX-|tvly-|@/.test(args.query) || !/google|calendar|oauth|documentation/i.test(args.query)) throw new Error('invalid_probe_query');
        const result = await research.search({ ...args, consent: true }, signal);
        credits += result.usage.credits || 0;
        return result;
      }
    };
    const native = createProvider({
      provider: 'glm', model: 'glm-4-flash', apiKey: process.env.GLM_API_KEY,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4'
    });
    const adapter = {
      ...native,
      encode(messages, tools, limits) {
        let selected = tools;
        if (!memorySucceeded && tools.some((tool) => tool.name === 'search_personal_memory')) selected = tools.filter((tool) => tool.name === 'search_personal_memory');
        else if (!webSucceeded && tools.some((tool) => tool.name === 'research_web')) selected = tools.filter((tool) => tool.name === 'research_web');
        return native.encode(messages, selected, limits);
      },
      continuation(instruction) {
        if (instruction.startsWith('preview_plan') && !memorySucceeded) return native.continuation('search_personal_memory with query "Google Calendar OAuth checklist" before previewing in this synthetic integration probe');
        if (instruction.startsWith('preview_plan') && !webSucceeded) return native.continuation('research_web with query "Google Calendar desktop OAuth official documentation" before previewing in this synthetic integration probe');
        return native.continuation(instruction);
      },
      toolResult(call, output) {
        if (Array.isArray(output.evidence)) {
          if (call.name === 'search_personal_memory') memorySucceeded = true;
          if (call.name === 'research_web') webSucceeded = true;
        }
        return native.toolResult(call, output);
      }
    };
    const started = Date.now();
    const run = await runWorkflow(context, adapter, loadSkills());
    if (run.analysis) assertAnalysis({ ...run.analysis, agentWorkflow: run.metadata });
    const citations = run.analysis?.research || [];
    const lowConfidenceCitations = citations.length > 0 && citations.every((item) => item.confidence === 'low' && item.claimStatus === 'snippet_only');
    const passed = run.metadata.outcome === 'completed' && memoryHits > 0 && webCalls > 0 && lowConfidenceCitations;
    const report = {
      observedAt: new Date().toISOString(), result: passed ? 'passed' : 'failed',
      testKind: 'forced_path_integration_with_live_providers',
      productionToolSelectionUnchanged: true, provider: 'glm', model: 'glm-4-flash',
      outcome: run.metadata.outcome, stopReason: run.metadata.stopReason, elapsedMs: Date.now() - started,
      memoryMode: 'lexical', memoryToolCalls: memoryCalls, memoryHits,
      webToolCalls: webCalls, tavilyReportedCredits: credits,
      workflowTools: run.metadata.trace.map((item) => item.tool).filter(Boolean),
      evidenceSourceTypes: [...new Set((run.analysis?.contract.evidence || []).map((item) => item.sourceType))],
      visibleCitations: citations.length, lowConfidenceCitations, contractValid: Boolean(run.analysis),
      realGoogleDataUsed: false, personalDataSentToAI: false, realCalendarWrites: 0
    };
    const output = path.join(root, 'evaluation/reports/retrieval-live.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (!passed) process.exitCode = 1;
  } finally { store.close(); }
}
main().catch((error) => {
  const setup = ['missing_glm_key', 'missing_tavily_key'].includes(error.message) ? error.message : null;
  console.error(JSON.stringify({ result: 'failed', setup, errorType: error.name }));
  process.exitCode = 1;
});
