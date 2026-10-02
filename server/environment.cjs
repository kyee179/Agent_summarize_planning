const fs = require("node:fs");
const path = require("node:path");

// Explicit path: launching from a different working directory must still work.
function loadEnvironment(file = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

module.exports = { loadEnvironment };
