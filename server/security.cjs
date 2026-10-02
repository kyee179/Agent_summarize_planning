const crypto = require("node:crypto");

const DEV_ORIGIN = "http://127.0.0.1:5173";

function validateToken(token) {
  if (typeof token !== "string" || token.length < 32 || /\s/.test(token)) {
    throw new Error("LOCAL_API_TOKEN must contain at least 32 characters without whitespace. Run pnpm setup:env.");
  }
  return token;
}

function browserRequestAllowed({ host, origin, fetchSite }, allowedHosts, allowedOrigins) {
  return allowedHosts.includes(host) &&
    (!origin || allowedOrigins.includes(origin)) && fetchSite !== "cross-site";
}

function localApiSecurity(token, allowedOrigins = []) {
  validateToken(token);
  const expected = Buffer.from(`Bearer ${token}`);
  return (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const port = req.socket.localPort;
    if (!browserRequestAllowed({
      host: req.headers.host,
      origin: req.headers.origin,
      fetchSite: req.headers["sec-fetch-site"]
    }, [`127.0.0.1:${port}`, `localhost:${port}`], allowedOrigins)) {
      return res.status(403).json({ error: "Untrusted local API request" });
    }
    // Readiness reveals no user data and needs no bearer token.
    if (req.method === "GET" && req.path === "/health") return next();
    if (!req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    const actual = Buffer.from(req.headers.authorization || "");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return res.status(401).json({ error: "Local API authentication required" });
    }
    next();
  };
}

module.exports = { DEV_ORIGIN, validateToken, browserRequestAllowed, localApiSecurity };
