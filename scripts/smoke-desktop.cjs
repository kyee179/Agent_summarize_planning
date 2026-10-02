const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-desktop-"));
const environment = { ...process.env, CALENDAR_SMOKE_TEST: "1", AI_PROVIDER: "local",
  CALENDAR_SMOKE_DIRECTORY: directory, CALENDAR_DB_PATH: path.join(directory, "calendar.sqlite") };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_START_URL;
const child = spawn(require("electron"), [path.join(__dirname, "..", "tests", "electron-smoke.cjs")], {
  env: environment, stdio: "inherit", windowsHide: true
});
const timer = setTimeout(() => child.kill(), 45000);
child.on("error", (error) => { console.error(error.message); });
child.on("close", (code) => {
  clearTimeout(timer);
  fs.rmSync(directory, { recursive: true, force: true });
  process.exitCode = code === 0 ? 0 : 1;
});
