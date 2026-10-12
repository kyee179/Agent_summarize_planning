const path = require('node:path');
const { copyDatabase } = require('../server/recovery.cjs');
const { loadEnvironment } = require('../server/environment.cjs');
loadEnvironment();
const source = process.env.CALENDAR_DB_PATH || path.join(__dirname, '..', 'server', 'data', 'calendar.sqlite');
const destination = process.argv[2];
if (!destination || process.argv.length > 3) {
  console.error('Usage: pnpm backup:db <NEW-backup-file>'); process.exitCode = 1;
} else {
  copyDatabase(source, destination).then(() => console.log('SQLite snapshot verified; no schema migration performed.'))
    .catch(() => { console.error('Backup failed: check source integrity and a new destination path.'); process.exitCode = 1; });
}
