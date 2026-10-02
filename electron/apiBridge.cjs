const { pathToFileURL } = require("node:url");

function isAllowedRequest(route, method) {
  if (typeof route !== "string" || route.length > 4096) return false;
  const url = new URL(route, "http://127.0.0.1");
  if (url.origin !== "http://127.0.0.1" || url.hash || !route.startsWith("/api/")) return false;
  const base = /^\/api\/(time|settings|events|journals)$/.test(url.pathname);
  const item = /^\/api\/(events|journals)\/[^/]+$/.test(url.pathname);
  const action = /^\/api\/journals\/[^/]+\/(analysis|analyze|apply-drafts)$/.test(url.pathname);
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
