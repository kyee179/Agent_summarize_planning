const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadEnvironment } = require("../server/environment.cjs");
loadEnvironment();
process.env.LOCAL_API_TOKEN ||= crypto.randomBytes(32).toString("hex");
const concurrentlyPackage = require.resolve("concurrently/package.json");
const concurrentlyBin = path.join(path.dirname(concurrentlyPackage), require(concurrentlyPackage).bin.concurrently);
const child = spawn(process.execPath, [concurrentlyBin,
  "-k", "pnpm:dev:api", "pnpm:dev:web", "pnpm:dev:electron"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => { process.exitCode = code || 0; });
