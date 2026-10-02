async function request(path, options = {}) {
  let status, body;
  if (window.studyCalendar?.request) {
    ({ status, body } = await window.studyCalendar.request(path, options));
  } else {
    const response = await fetch(path, {
      ...options, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(120000)
    });
    status = response.status;
    body = status === 204 ? null : await response.json().catch(() => ({}));
  }
  if (status >= 400) throw new Error(body?.errors?.join(", ") || body?.error || `Request failed with ${status}`);
  return body;
}

export const api = {
  getTime: () => request("/api/time"),
  getSettings: () => request("/api/settings"),
  updateSettings: (settings) => request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  listEvents: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request(`/api/events?${params.toString()}`);
  },
  createEvent: (event) => request("/api/events", { method: "POST", body: JSON.stringify(event) }),
  updateEvent: (id, event) => request(`/api/events/${id}`, { method: "PUT", body: JSON.stringify(event) }),
  deleteEvent: (id) => request(`/api/events/${id}`, { method: "DELETE" }),
  listJournals: ({ type, bookmarked } = {}) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (bookmarked !== undefined) params.set("bookmarked", String(bookmarked));
    return request(`/api/journals?${params.toString()}`);
  },
  createJournal: (journal) => request("/api/journals", { method: "POST", body: JSON.stringify(journal) }),
  updateJournal: (id, journal) => request(`/api/journals/${id}`, { method: "PUT", body: JSON.stringify(journal) }),
  deleteJournal: (id) => request(`/api/journals/${id}`, { method: "DELETE" }),
  analyzeJournal: (id, options = {}) => request(`/api/journals/${id}/analyze`, { method: "POST", body: JSON.stringify(options) }),
  getJournalAnalysis: (id) => request(`/api/journals/${id}/analysis`),
  applyDrafts: (id, analysisId) => request(`/api/journals/${id}/apply-drafts`, {
    method: "POST", body: JSON.stringify({ analysisId })
  })
};
