const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execute = promisify(execFile);
const { createStore } = require('../server/store.cjs');
const { createApp } = require('../server/index.cjs');
const { createTelemetry } = require('../server/observability.cjs');
const root = path.join(__dirname, '..');
const cli = (name, args, env) => execute(process.execPath, [path.join(root, 'scripts', `${name}.cjs`), ...args], { env: { ...process.env, ...env }, cwd: os.tmpdir(), windowsHide: true, timeout: 10000 });

test('backup and restore commands work from another cwd and refuse destination replacement', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-cli-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite'), saved = path.join(dir, 'saved.sqlite'), restored = path.join(dir, 'recovered.sqlite');
  const store = createStore(source); store.createJournal({ id: 'kept', content: 'Synthetic CLI snapshot' }); store.close();
  const output = await cli('backup', [saved], { CALENDAR_DB_PATH: source }); assert.match(output.stdout, /verified/);
  await cli('restore', [saved, restored, '3'], {});
  const copy = createStore(restored); assert.ok(copy.getJournal('kept')); copy.close();
  await assert.rejects(cli('restore', [saved, restored, '3'], {}), (error) => error.code === 1 && !error.stdout.includes('verified'));
});
test('monitor CLI distinguishes healthy, alerted and unauthenticated local API without printing traces', async (t) => {
  const store = createStore(':memory:'), telemetry = createTelemetry(), token = crypto.randomBytes(32).toString('hex');
  const app = createApp({ store, telemetry, apiToken: token }); const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(async () => { await new Promise((r) => server.close(r)); app.locals.closeIntegrations(); store.close(); });
  const env = { LOCAL_API_TOKEN: token, PORT: String(server.address().port) };
  const output = await cli('monitor', [], env); assert.equal(JSON.parse(output.stdout).ready, true); assert.ok(!output.stdout.includes('traceId')); assert.ok(!output.stdout.includes(token));
  for (let i = 0; i < 5; i++) telemetry.emit({ kind: 'analysis', traceId: crypto.randomUUID(), outcome: 'fallback', reason: 'timeout', durationMs: 60000 });
  await assert.rejects(cli('monitor', [], env), (error) => error.code === 1 && JSON.parse(error.stdout).alerts.includes('high_fallback_rate'));
  await assert.rejects(cli('monitor', [], { ...env, LOCAL_API_TOKEN: '0'.repeat(64) }), (error) => error.code === 2 && !error.stderr.includes(token));
  const health = store.health; store.health = () => { throw new Error('synthetic failure'); };
  await assert.rejects(cli('monitor', [], env), (error) => error.code === 1 && JSON.parse(error.stdout).ready === false); store.health = health;
});
