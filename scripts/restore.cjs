const { copyDatabase } = require('../server/recovery.cjs');
const [source, destination, maxVersionText = '2'] = process.argv.slice(2);
if (!source || !destination || !/^[12]$/.test(maxVersionText) || process.argv.length > 5) {
  console.error('Usage: pnpm restore:db <backup-file> <NEW-database-file> [max-schema: 1|2]'); process.exitCode = 1;
} else {
  copyDatabase(source, destination, { maxVersion: Number(maxVersionText) }).then(({ version }) => {
    console.log(`Recovery snapshot verified (schema ${version}). Stop the app/API, set CALENDAR_DB_PATH to this new file, then restart and verify calendar/journals. The previous database is preserved.`);
  }).catch(() => { console.error('Recovery failed: check backup integrity, schema compatibility, and a new destination path.'); process.exitCode = 1; });
}
