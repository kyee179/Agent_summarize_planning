const { WorkflowError } = require("./runtime.cjs");

async function readJson(response, maxBytes) {
  // Bound the actual body, not merely Content-Length, which may be absent or false.
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new WorkflowError("size_limit");
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks).toString("utf8");
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } else {
    // Also supports small deterministic test doubles; real fetch uses the stream path.
    text = response.text ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(text) > maxBytes) throw new WorkflowError("size_limit");
  }
  try { return JSON.parse(text); } catch { throw new WorkflowError("validation"); }
}

function createProvider(config, fetchImpl = (...args) => fetch(...args)) {
  const gemini = config.provider === "gemini";
  let turn = 0;
  function request(messages, tools, limits) {
    if (!gemini) return { url: `${config.baseUrl}/chat/completions`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: { model: config.model, temperature: 0.2, max_completion_tokens: limits.maxOutputTokens,
        parallel_tool_calls: false, tool_choice: "required", messages,
        tools: tools.map((tool) => ({ type: "function", function: { ...tool, strict: config.provider === "openai" } })) } };
    return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: { systemInstruction: { parts: [{ text: messages[0].content }] },
        contents: messages.slice(1).map((message) => message.native || { role: "user", parts: [{ text: message.content }] }),
        tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
        generationConfig: { temperature: 0.2, maxOutputTokens: limits.maxOutputTokens } } };
  }
  return {
    encode: request,
    async complete(encoded, { signal, maxResponseBytes }) {
      turn++;
      const response = await fetchImpl(encoded.url, { method: "POST", headers: encoded.headers, body: JSON.stringify(encoded.body), signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new WorkflowError("provider_error"); }
      const data = await readJson(response, maxResponseBytes);
      if (gemini) {
        const content = data.candidates?.[0]?.content;
        const calls = content?.parts?.filter((part) => part.functionCall).map((part, i) => ({
          id: part.functionCall.id || `gemini:${turn}:${i}`, name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args), nativeId: part.functionCall.id
        })) || [];
        if (!content || data.candidates[0].finishReason !== "STOP") throw new WorkflowError("validation");
        return { calls, message: { role: "assistant", native: content } };
      }
      const choice = data.choices?.[0], message = choice?.message;
      if (!message || (choice.finish_reason && choice.finish_reason !== "tool_calls")) throw new WorkflowError("validation");
      if (message.tool_calls?.some((call) => call.type !== "function")) throw new WorkflowError("validation");
      return { calls: message.tool_calls?.map((call) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })) || [],
        message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls } };
    },
    toolResult(call, output) {
      if (gemini) return { role: "tool", native: { role: "user", parts: [{ functionResponse: {
        name: call.name, ...(call.nativeId ? { id: call.nativeId } : {}), response: output
      } }] } };
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(output) };
    }
  };
}
module.exports = { createProvider, readJson };
