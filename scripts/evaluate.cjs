const fs = require('node:fs');
const path = require('node:path');
const { runEvaluation } = require('../evaluation/runner.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || !['--live', '--live-zh'].includes(args[0]))) throw new Error('Usage: pnpm eval, pnpm eval:live or pnpm eval:chinese:live');
  const live = args.length === 1, language = args[0] === '--live-zh' ? 'zh-CN' : null;
  if (live) require('../server/environment.cjs').loadEnvironment();
  const report = await runEvaluation({ live, language, onCase: live ? (item) => console.log(`${item.id}: ${item.outcome}/${item.reason}, ${item.wallMs} ms`) : undefined });
  const directory = path.join(__dirname, '..', 'evaluation', 'reports'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, language === 'zh-CN' ? 'live-chinese.json' : live ? 'live.json' : 'offline.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`${report.mode}: ${report.passed ? 'PASS' : 'FAIL'}; dataset ${report.datasetVersion}; prompt ${report.promptVersion}`);
  for (const gate of report.gates) console.log(`${gate.passed ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.value} (minimum ${gate.minimum})`);
  if (!live) console.log('Challenge cases (diagnostic): ' + JSON.stringify(report.analysis.challenge));
  if (live) console.log('Remote outcomes: ' + report.analysis.cases.map((r) => `${r.id}=${r.outcome}/${r.reason}`).join(', '));
  if (!report.passed) process.exitCode = 1;
}
main().catch(() => { console.error('Evaluation runner failed; check runtime, dataset and configuration.'); process.exitCode = 1; });
