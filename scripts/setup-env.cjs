const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadEnvironment } = require("../server/environment.cjs");
const { validateToken } = require("../server/security.cjs");

const root = path.join(__dirname, "..");
const file = path.join(root, ".env");
if (!fs.existsSync(file)) fs.copyFileSync(path.join(root, ".env.example"), file);
loadEnvironment(file);
let valid = false;
try { validateToken(process.env.LOCAL_API_TOKEN); valid = true; } catch { /* Generate below. */ }
if (!valid) {
  const content = fs.readFileSync(file, "utf8");
  const entry = `LOCAL_API_TOKEN=${crypto.randomBytes(32).toString("hex")}`;
  fs.writeFileSync(file, /^LOCAL_API_TOKEN=.*$/m.test(content)
    ? content.replace(/^LOCAL_API_TOKEN=.*$/m, entry) : `${content}\n${entry}\n`);
}
const encryption = Buffer.from(process.env.INTEGRATION_ENCRYPTION_KEY || '', 'base64');
if (!process.env.INTEGRATION_ENCRYPTION_KEY) {
  const content = fs.readFileSync(file, 'utf8');
  const entry = `INTEGRATION_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64')}`;
  fs.writeFileSync(file, /^INTEGRATION_ENCRYPTION_KEY=.*$/m.test(content)
    ? content.replace(/^INTEGRATION_ENCRYPTION_KEY=.*$/m, entry) : `${content}\n${entry}\n`);
} else if (encryption.length !== 32) {
  throw new Error('INTEGRATION_ENCRYPTION_KEY must encode 32 bytes. Restore the original key; do not rotate it while connected.');
}
console.log("Local .env is ready. Credentials are never printed or exposed to Vite.");
