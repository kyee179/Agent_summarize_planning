import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

afterEach(() => { delete window.studyCalendar; vi.unstubAllGlobals(); });

describe("calendar request transport", () => {
  it("applies an analysis with one IPC request and no token in the renderer", async () => {
    const request = vi.fn().mockResolvedValue({ status: 201, body: { events: [{ id: "event" }], replayed: false } });
    window.studyCalendar = { request };
    expect(await api.applyDrafts("journal", "analysis")).toEqual({ events: [{ id: "event" }], replayed: false });
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/journals/journal/apply-drafts", {
      method: "POST", body: JSON.stringify({ analysisId: "analysis" })
    });
  });

  it("browser requests use the same origin without bearer credentials", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetch);
    await api.listEvents();
    expect(fetch.mock.calls[0][0]).toBe("/api/events?includeGoogle=true");
    expect(fetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("surfaces batch validation failures to the UI", async () => {
    window.studyCalendar = { request: vi.fn().mockResolvedValue({ status: 409, body: { error: "Analysis is stale" } }) };
    await expect(api.applyDrafts("j", "a")).rejects.toThrow("Analysis is stale");
  });
  it('retains conflict status and structured validation issues for recovery', async () => {
    window.studyCalendar = { request: vi.fn().mockResolvedValue({ status: 422, body: { error: 'Invalid plan', issues: [{ path: '/plan', message: 'Choose hours' }], requestId: 'synthetic' } }) };
    await expect(api.analyzeJournal('j')).rejects.toMatchObject({ status: 422, issues: [{ path: '/plan', message: 'Choose hours' }], requestId: 'synthetic' });
  });
});
