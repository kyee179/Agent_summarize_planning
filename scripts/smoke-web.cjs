const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { startServer } = require("../server/index.cjs");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-web-"));
  let api, web;
  try {
    process.env.LOCAL_API_TOKEN = crypto.randomBytes(32).toString("hex");
    api = startServer({ port: 0, dataFile: path.join(directory, "calendar.sqlite"), envFile: false });
    await once(api, "listening");
    process.env.PORT = String(api.address().port);
    const { createServer } = await import("vite");
    web = await createServer({ configFile: path.join(__dirname, "..", "vite.config.js") });
    await web.listen();
    const trusted = await fetch("http://127.0.0.1:5173/api/events");
    if (trusted.status !== 200 || !Array.isArray(await trusted.json())) throw new Error("Trusted proxy failed");
    const hostile = await fetch("http://127.0.0.1:5173/api/events", { headers: { Origin: "https://evil.example" } });
    if (hostile.status !== 403) throw new Error("Hostile origin passed proxy");
    const direct = await fetch(`http://127.0.0.1:${api.address().port}/api/events`);
    if (direct.status !== 401) throw new Error("Direct unauthenticated API access allowed");
    const module = await fetch("http://127.0.0.1:5173/src/api.js").then((response) => response.text());
    if (module.includes(process.env.LOCAL_API_TOKEN)) throw new Error("Token leaked to frontend");
    console.log("Browser smoke passed: trusted proxy, hostile origin denial, direct API authentication, no frontend token.");
  } finally {
    if (web) await web.close();
    if (api) await new Promise((resolve) => api.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
