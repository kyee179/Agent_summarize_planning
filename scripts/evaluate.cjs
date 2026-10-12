const fs = require('node:fs');
const path = require('node:path');
const { runEvaluation } = require('../evaluation/runner.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--live')) throw new Error('Usage: pnpm eval or pnpm eval:live');
  const live = args[0] === '--live';
  if (live) require('../server/environment.cjs').loadEnvironment();
  const report = await runEvaluation({ live, onCase: live ? (item) => console.log(`${item.id}: ${item.outcome}/${item.reason}, ${item.wallMs} ms`) : undefined });
  const directory = path.join(__dirname, '..', 'evaluation', 'reports'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, live ? 'live.json' : 'offline.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`${report.mode}: ${report.passed ? 'PASS' : 'FAIL'}; dataset ${report.datasetVersion}; prompt ${report.promptVersion}`);
  for (const gate of report.gates) console.log(`${gate.passed ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.value} (minimum ${gate.minimum})`);
  if (!live) console.log('Challenge cases (diagnostic): ' + JSON.stringify(report.analysis.challenge));
  if (live) console.log('Remote outcomes: ' + report.analysis.cases.map((r) => `${r.id}=${r.outcome}/${r.reason}`).join(', '));
  if (!report.passed) process.exitCode = 1;
}
main().catch(() => { console.error('Evaluation runner failed; check runtime, dataset and configuration.'); process.exitCode = 1; });
