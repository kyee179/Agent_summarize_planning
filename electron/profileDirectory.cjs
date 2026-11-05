const fs = require('node:fs');
const path = require('node:path');

// Explicit profiles support isolated packaged acceptance tests and separate local workspaces.
// They change storage location only; sign-in and the local API boundary remain required.
function configureProfileDirectory(app, directory) {
  if (!directory) return;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('CALENDAR_PROFILE_DIRECTORY must be an absolute directory.');
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('Choose a profile directory below the filesystem root.');
  fs.mkdirSync(resolved, { recursive: true });
  app.setPath('userData', resolved);
  app.setPath('sessionData', resolved);
}
module.exports = { configureProfileDirectory };
