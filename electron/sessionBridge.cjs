// Only the main process sees the local session capability or provider tokens.
function createSessionBridge({ address, apiToken, fetchImpl = fetch }) {
  let token = null, epoch = 0, operation = 0, consentUrl = null;
  const pending = new Set();
  const stale = () => ({ status: 401, body: { error: 'The previous workspace was closed.' } });
  function changed() {
    epoch++; token = null; consentUrl = null;
    for (const request of pending) if (!request.rotates) request.controller.abort();
  }
  async function request(route, options = {}) {
    const method = options.method || 'GET';
    const rotates = method === 'POST' && /^\/api\/(auth\/(login|signup|local|logout|restore|recover)|account\/(onboarding|services|remove-local-data))$/.test(route);
    const sequence = rotates ? ++operation : operation, started = epoch;
    const controller = new AbortController(), item = { controller, rotates }; pending.add(item);
    try {
      const response = await fetchImpl(`http://127.0.0.1:${address().port}${route}`, { method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}`, ...(token ? { 'x-calendar-session': token } : {}) },
        body: options.body, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(120000), controller.signal]) });
      const body = response.status === 204 ? null : await response.json();
      if (sequence !== operation || (!rotates && started !== epoch)) return stale();
      const next = response.headers.get('x-calendar-session');
      if (next !== null) token = next || null;
      if (route === '/api/integrations/google/connect' && response.ok && typeof body?.authorizationUrl === 'string') consentUrl = body.authorizationUrl;
      return { status: response.status, body };
    } catch (error) { if (sequence !== operation || started !== epoch) return stale(); throw error; }
    finally { pending.delete(item); }
  }
  return { request, changed, restore: value => { token = value || null; },
    permitsConsent: url => Boolean(token && consentUrl && url === consentUrl),
    close() { changed(); for (const item of pending) item.controller.abort(); } };
}
module.exports = { createSessionBridge };
