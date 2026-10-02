const path = require("node:path");
const fs = require("node:fs");
const { createStore } = require("../server/store.cjs");
const { loadEnvironment } = require("../server/environment.cjs");
loadEnvironment();
const source = process.env.CALENDAR_DB_PATH || path.join(__dirname, "..", "server", "data", "calendar.sqlite");
const destination = process.argv[2];
if (!destination || !fs.existsSync(source) || fs.existsSync(destination) || path.resolve(source) === path.resolve(destination)) {
  throw new Error("Usage: pnpm backup:db <new-backup-file>; source must exist and destination must be new.");
}
const store = createStore(source);
store.backup(destination).then(() => console.log("SQLite backup completed.")).finally(() => store.close());
