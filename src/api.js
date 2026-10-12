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
  integrationStatus: () => request('/api/integrations/status'),
  activityBuckets: () => request('/api/integrations/activity/buckets'),
  importActivity: (body) => request('/api/integrations/activity/import', { method: 'POST', body: JSON.stringify(body) }),
  purgeActivity: () => request('/api/integrations/activity', { method: 'DELETE' }),
  connectGoogle: () => request('/api/integrations/google/connect', { method: 'POST', body: JSON.stringify({ consent: true }) }),
  cancelGoogle: () => request('/api/integrations/google/cancel', { method: 'POST', body: '{}' }),
  googleCalendars: () => request('/api/integrations/google/calendars'),
  syncGoogle: (body) => request('/api/integrations/google/sync', { method: 'POST', body: JSON.stringify(body) }),
  disconnectGoogle: () => request('/api/integrations/google', { method: 'DELETE' }),
  memoryNotes: () => request('/api/memory'),
  saveMemory: (body) => request('/api/memory', { method: 'POST', body: JSON.stringify(body) }),
  deleteMemory: (id) => request(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  indexMemory: (semantic) => request('/api/memory/index', { method: 'POST', body: JSON.stringify({ consent: true, semantic }) }),
  searchMemory: (query) => request('/api/memory/search', { method: 'POST', body: JSON.stringify({ query }) }),
  research: (query) => request('/api/research/search', { method: 'POST', body: JSON.stringify({ query, consent: true }) }),
  getTime: () => request("/api/time"),
  getSettings: () => request("/api/settings"),
  updateSettings: (settings) => request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  listEvents: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    params.set('includeGoogle', 'true');
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
