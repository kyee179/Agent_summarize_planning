const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server/index.cjs");
const { createStore } = require("../server/store.cjs");

test("settings report GLM environment override and configured status without exposing its key", async (t) => {
  const names = ["AI_PROVIDER", "GLM_MODEL", "GLM_API_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.AI_PROVIDER = "glm"; process.env.GLM_MODEL = "glm-4-flash"; process.env.GLM_API_KEY = "synthetic-private-key";
  const store = createStore(":memory:");
  assert.equal(store.getSettings().aiProvider, "glm");
  store.updateSettings({ aiProvider: "local" });
  const token = "provider-test-token-at-least-32-characters";
  const server = createApp({ store, apiToken: token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve)); store.close();
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  });
  for (const method of ["GET", "PUT"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(method === "PUT" ? { body: JSON.stringify({ aiProvider: "groq" }) } : {})
    });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.effectiveAiProvider, "glm");
    assert.equal(body.aiModel, "glm-4-flash"); assert.equal(body.aiProviderOverride, true); assert.equal(body.aiProviderConfigured.glm, true);
    assert.ok(!JSON.stringify(body).includes("synthetic-private-key"));
  }
});
