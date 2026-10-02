const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const { createApp } = require("../server/index.cjs");
const { createStore } = require("../server/store.cjs");
const { isAllowedRequest, trustedSender } = require("../electron/apiBridge.cjs");
const { browserRequestAllowed } = require("../server/security.cjs");

const token = "test-token-with-at-least-32-characters";
const draft = { title: "Study", startsAt: "2026-10-02T09:00:00Z", endsAt: "2026-10-02T10:00:00Z", calendarType: "study", notificationFormat: "Desktop notification" };

async function fixture(t) {
  const store = createStore(":memory:");
  const server = createApp({ store, apiToken: token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  async function request(route, body, options = {}) {
    if (options.headers?.Host) {
      return new Promise((resolve, reject) => {
        const raw = http.request(`${base}${route}`, { headers: { Authorization: `Bearer ${token}`, ...options.headers } }, (response) => {
          let content = "";
          response.on("data", (chunk) => { content += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(content) }));
        });
        raw.on("error", reject);
        raw.end();
      });
    }
    const response = await fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", ...options,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  store.createJournal({ id: "j", title: "Journal", content: "Study", type: "daily", journalDate: "2026-10-02" });
  store.saveJournalAnalysis({ id: "a", journalId: "j", scheduleDrafts: [draft, { ...draft, title: "Second" }] });
  return { store, request };
}

test("API rejects missing/wrong auth, hostile origins, null origin, cross-site and DNS rebinding hosts", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/events", undefined, { headers: { Authorization: "" } })).status, 401);
  assert.equal((await request("/api/events", undefined, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { Host: "evil.example" }]) {
    assert.equal((await request("/api/events", undefined, { headers })).status, 403, JSON.stringify(headers));
  }
  assert.equal((await request("/health", undefined, { headers: { Authorization: "" } })).status, 200);
  assert.equal((await request("/api/events")).status, 200);
});

test("approved batch is atomic and simultaneous retries create no duplicates", async (t) => {
  const { store, request } = await fixture(t);
  const before = store.listEvents().length;
  const results = await Promise.all(Array.from({ length: 3 }, () => request("/api/journals/j/apply-drafts", { analysisId: "a" })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 201]);
  assert.equal(store.listEvents().length, before + 2);
  assert.deepEqual(results[0].body.events, results[1].body.events);
  assert.equal((await request("/api/journals/j/analysis")).body.applied, true);
});

test("invalid second draft and stale analysis fail without writing any events", async (t) => {
  const { store, request } = await fixture(t);
  const before = store.listEvents().length;
  store.saveJournalAnalysis({ id: "b", journalId: "j", scheduleDrafts: [draft, { ...draft, endsAt: "not-a-date" }] });
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: "a" })).status, 409);
  assert.equal((await request("/api/journals/j/apply-drafts", { analysisId: "b" })).status, 400);
  assert.equal(store.listEvents().length, before);
  assert.equal(store.getAppliedBatch("b"), null);
  assert.equal((await request("/api/events", [])).status, 400);
  assert.equal((await request("/api/events", null)).status, 400);
});

test("event updates validate the merged time range and protect identity", async (t) => {
  const { request } = await fixture(t);
  const created = await request("/api/events", { ...draft, id: "spoofed" });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, "spoofed");
  assert.equal((await request(`/api/events/${created.body.id}`, { endsAt: "2026-10-02T08:00:00Z" }, { method: "PUT" })).status, 400);
  assert.equal((await request("/api/events", { ...draft, endsAt: draft.startsAt })).status, 400);
  assert.equal((await request("/api/events?from=invalid")).status, 400);
});

test("desktop IPC permits calendar routes and only the trusted main frame", () => {
  assert.equal(isAllowedRequest("/api/events?from=2026-10-02", "GET"), true);
  for (const route of ["https://evil.example/api/events", "//evil.example/api/events", "/api/../secrets", "/api/events#x"]) {
    assert.equal(isAllowedRequest(route, "GET"), false);
  }
  const mainFrame = { origin: "http://127.0.0.1:5173", url: "http://127.0.0.1:5173/" };
  const webContents = { mainFrame };
  assert.equal(trustedSender({ sender: webContents, senderFrame: mainFrame }, webContents, "C:/app/index.html", "http://127.0.0.1:5173"), true);
  assert.equal(trustedSender({ sender: webContents, senderFrame: { ...mainFrame } }, webContents, "C:/app/index.html", "http://127.0.0.1:5173"), false);
  assert.equal(browserRequestAllowed({ host: "127.0.0.1:5173", origin: "https://evil.example" }, ["127.0.0.1:5173"], ["http://127.0.0.1:5173"]), false);
});
