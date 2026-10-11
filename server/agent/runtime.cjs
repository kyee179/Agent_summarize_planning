const { performance } = require("node:perf_hooks");
const { ContractError } = require("../contracts/validate.cjs");
const { tools, createToolSession } = require("./tools.cjs");
const { buildMessages } = require("./skills.cjs");

// Server policy: requests, prompts, provider replies, and tool results cannot increase it.
const LIMITS = Object.freeze({ maxTurns: 12, maxToolCalls: 16, maxToolErrors: 3,
  timeoutMs: 60000, requestTimeoutMs: 15000, maxOutputTokens: 4096,
  maxArgumentBytes: 65536, maxToolResultBytes: 98304, maxResponseBytes: 262144,
  maxTranscriptBytes: 524288, maxRequestBytes: 786432, maxTotalRequestBytes: 3145728 });
class WorkflowError extends Error {
  constructor(reason) { super("Agent workflow stopped"); this.reason = reason; }
}
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
const sizeCheck = (value, limit) => { if (bytes(value) > limit) throw new WorkflowError("size_limit"); };

function workflowMetadata(skills, promptHash, stats, outcome, stopReason, refs = {}) {
  return { version: 1, promptVersion: skills.promptVersion, promptHash,
    skills: skills.skills.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    outcome, stopReason, turns: stats.turns, toolCalls: stats.toolCalls, toolErrors: stats.toolErrors,
    elapsedMs: stats.elapsedMs, requestBytes: stats.requestBytes,
    summaryEvidenceIds: refs.summaryEvidenceIds || [], weeklySummaryEvidenceIds: refs.weeklySummaryEvidenceIds || [], trace: stats.trace };
}

async function boundedRequest(adapter, encoded, limits, remaining) {
  const controller = new AbortController();
  let timer;
  try {
    // Race enforces the wall-clock limit even for a transport that ignores abort.
    return await Promise.race([
      adapter.complete(encoded, { signal: controller.signal, maxResponseBytes: limits.maxResponseBytes }),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WorkflowError("timeout")); }, Math.min(remaining, limits.requestTimeoutMs)); })
    ]);
  } finally { clearTimeout(timer); }
}

async function runWorkflow(context, adapter, skills, { limits = LIMITS, now = () => performance.now() } = {}) {
  // Test overrides may only reduce hard policy. There is no HTTP configuration surface.
  for (const [key, value] of Object.entries(LIMITS)) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > value) throw new Error("Invalid workflow limit");
  }
  const start = now();
  const stats = { turns: 0, toolCalls: 0, toolErrors: 0, elapsedMs: 0, requestBytes: 0, trace: [] };
  const { messages, promptHash } = buildMessages(skills, context, limits);
  const session = createToolSession(context, context.provider, context.model);
  const callIds = new Set();
  const remaining = () => {
    const time = limits.timeoutMs - (now() - start);
    if (time <= 0) throw new WorkflowError("timeout");
    return time;
  };
  try {
    while (stats.turns < limits.maxTurns) {
      remaining(); sizeCheck(messages, limits.maxTranscriptBytes);
      const encoded = adapter.encode(messages, tools, limits);
      sizeCheck(encoded.body, limits.maxRequestBytes);
      const requestSize = bytes(encoded.body);
      if (stats.requestBytes + requestSize > limits.maxTotalRequestBytes) throw new WorkflowError("size_limit");
      stats.requestBytes += requestSize; stats.turns++;
      const response = await boundedRequest(adapter, encoded, limits, remaining());
      remaining(); sizeCheck(response, limits.maxResponseBytes);
      // Execute one call per turn. Reject parallel batches before executing anything.
      if (response.calls?.length !== 1) throw new WorkflowError("validation");
      const call = response.calls[0];
      if (typeof call.id !== "string" || !call.id || call.id.length > 128 || callIds.has(call.id) ||
          typeof call.name !== "string" || call.name.length > 128 || typeof call.arguments !== "string") throw new WorkflowError("validation");
      callIds.add(call.id);
      if (stats.toolCalls >= limits.maxToolCalls) throw new WorkflowError("tool_limit");
      stats.toolCalls++;
      sizeCheck(call.arguments, limits.maxArgumentBytes);
      messages.push(response.message);
      let result;
      try {
        if (call.name === "preview_plan") session.invalidatePreview();
        let args;
        try { args = JSON.parse(call.arguments); } catch { throw new ContractError([{ path: "/", code: "json", message: "Arguments must be valid JSON" }]); }
        result = session.execute(call.name, args);
        sizeCheck(result.output, limits.maxToolResultBytes);
        stats.trace.push({ turn: stats.turns, tool: tools.some((tool) => tool.name === call.name) ? call.name : "unknown", status: "ok" });
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        stats.toolErrors++;
        stats.trace.push({ turn: stats.turns, tool: tools.some((tool) => tool.name === call.name) ? call.name : "unknown", status: "error" });
        if (stats.toolErrors >= limits.maxToolErrors) throw new WorkflowError("error_limit");
        // Safe repair feedback; no exception messages, source text, credentials, or raw arguments.
        result = { output: { error: "validation", issues: error.issues.slice(0, 8).map(({ path, code }) => ({ path, code })),
          instruction: "Correct the arguments using the tool schemas and pinned skill instructions." } };
      }
      remaining();
      messages.push(adapter.toolResult(call, result.output));
      sizeCheck(messages, limits.maxTranscriptBytes);
      if (result.finished) {
        stats.elapsedMs = Math.max(0, Math.floor(now() - start));
        return { analysis: result.finished.analysis,
          metadata: workflowMetadata(skills, promptHash, stats, "completed", "finished", result.finished) };
      }
      if (stats.toolCalls >= limits.maxToolCalls) throw new WorkflowError("tool_limit");
    }
    throw new WorkflowError("turn_limit");
  } catch (error) {
    stats.elapsedMs = Math.max(0, Math.floor(now() - start));
    const reason = error instanceof WorkflowError ? error.reason : error instanceof ContractError ? "validation" : "provider_error";
    return { metadata: workflowMetadata(skills, promptHash, stats, "fallback", reason) };
  }
}
module.exports = { LIMITS, WorkflowError, workflowMetadata, runWorkflow };
