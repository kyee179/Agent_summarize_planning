const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("explicit env path works from another cwd and preserves process environment", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-env-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  fs.writeFileSync(file, "CALENDAR_ENV_TEST=new\nCALENDAR_ENV_KEEP=file\n");
  const loader = path.resolve(__dirname, "../server/environment.cjs");
  const result = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(loader)}).loadEnvironment(${JSON.stringify(file)}); console.log(process.env.CALENDAR_ENV_TEST, process.env.CALENDAR_ENV_KEEP)`], {
    cwd: directory, encoding: "utf8", env: { ...process.env, CALENDAR_ENV_KEEP: "process" }
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "new process");
});
