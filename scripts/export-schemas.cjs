const fs = require("node:fs");
const path = require("node:path");
const { schemas } = require("../server/contracts/schemas.cjs");
const directory = path.join(__dirname, "..", "docs", "schemas", "v1");
fs.mkdirSync(directory, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(schema, null, 2)}\n`);
}
console.log("Exported task, evidence, estimate, plan, and bundle JSON Schemas v1.");
