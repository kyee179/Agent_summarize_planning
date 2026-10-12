const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run only on the disposable Linux GitHub runner, before Electron smoke.
// Keep Chromium's sandbox enabled and configure its downloaded helper precisely.
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('This setup is only for Linux GitHub Actions runners.');
const modules = fs.realpathSync(path.join(__dirname, '..', 'node_modules'));
const helper = fs.realpathSync(path.join(path.dirname(require('electron')), 'chrome-sandbox'));
const relative = path.relative(modules, helper);
if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(helper) !== 'chrome-sandbox') throw new Error('Sandbox helper must be inside this checkout\'s installed dependencies.');
execFileSync('sudo', ['chown', 'root:root', helper], { stdio: 'inherit' });
execFileSync('sudo', ['chmod', '4755', helper], { stdio: 'inherit' });
const stat = fs.statSync(helper);
if (stat.uid !== 0 || (stat.mode & 0o7777) !== 0o4755) throw new Error('Sandbox helper permissions were not configured.');
console.log('CI Electron sandbox helper configured.');
