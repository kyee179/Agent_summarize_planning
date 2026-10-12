const { pathToFileURL } = require("node:url");

function isAllowedRequest(route, method) {
  if (typeof route !== "string" || route.length > 4096) return false;
  const url = new URL(route, "http://127.0.0.1");
  if (url.origin !== "http://127.0.0.1" || url.hash || !route.startsWith("/api/")) return false;
  const base = /^\/api\/(time|settings|events|journals)$/.test(url.pathname);
  const item = /^\/api\/(events|journals)\/[^/]+$/.test(url.pathname);
  const action = /^\/api\/journals\/[^/]+\/(analysis|analyze|apply-drafts)$/.test(url.pathname);
  const integrationRoutes = {
    '/api/integrations/status': ['GET'], '/api/integrations/activity/buckets': ['GET'], '/api/integrations/activity/import': ['POST'],
    '/api/integrations/activity': ['DELETE'], '/api/integrations/google/connect': ['POST'], '/api/integrations/google/cancel': ['POST'],
    '/api/integrations/google/calendars': ['GET'], '/api/integrations/google/sync': ['POST'], '/api/integrations/google': ['DELETE'],
    '/api/memory': ['GET', 'POST'], '/api/memory/index': ['POST'], '/api/memory/search': ['POST'], '/api/research/search': ['POST']
  };
  if (integrationRoutes[url.pathname]?.includes(method)) return true;
  if (/^\/api\/memory\/memory%3A[0-9a-f-]{36}$/i.test(url.pathname) && method === 'DELETE') return true;
  return (base && ["GET", "POST", "PUT"].includes(method)) ||
    (item && ["PUT", "DELETE"].includes(method)) ||
    (action && (url.pathname.endsWith("/analysis") ? method === "GET" : method === "POST"));
}

function trustedSender(event, webContents, filePath, devUrl) {
  const frame = event.senderFrame;
  if (!frame || event.sender !== webContents || frame !== webContents.mainFrame) return false;
  if (devUrl) return frame.origin === new URL(devUrl).origin;
  return frame.url.split("#")[0] === pathToFileURL(filePath).href;
}

module.exports = { isAllowedRequest, trustedSender };
