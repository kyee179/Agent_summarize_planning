const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureProfileDirectory } = require('../electron/profileDirectory.cjs');

test('an explicit absolute profile isolates both app data and browser sessions before startup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-location-')), directory = path.join(root, 'isolated');
  try { const calls = []; configureProfileDirectory({ setPath: (...args) => calls.push(args) }, directory); assert.ok(fs.statSync(directory).isDirectory()); assert.deepEqual(calls, [['userData', directory], ['sessionData', directory]]); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('default profiles are unchanged and relative paths or filesystem roots are rejected before opening data', () => {
  const calls = [], app = { setPath: (...args) => calls.push(args) };
  configureProfileDirectory(app, undefined); assert.deepEqual(calls, []);
  assert.throws(() => configureProfileDirectory(app, 'relative-profile'), /absolute/);
  assert.throws(() => configureProfileDirectory(app, path.parse(process.cwd()).root), /filesystem root/); assert.deepEqual(calls, []);
});
