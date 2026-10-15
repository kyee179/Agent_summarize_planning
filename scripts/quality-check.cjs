const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { loadSkills } = require('../server/agent/skills.cjs');
const { MAX_SCHEMA } = require('../server/recovery.cjs');
const { dataset, METRIC_VERSION } = require('../evaluation/runner.cjs');
const root = path.join(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'evaluation', 'release-policy.json'), 'utf8'));
const fail = (message) => { throw new Error(message); };
const privatePath = (file) => /(^|\/)(?:server\/data|telemetry|evaluation\/reports|google_setup)(\/|$)|\.(?:sqlite|db)(?:[.-]|$)|(^|\/)(?:secret\.txt|client_secret[^/]*\.json|credentials\.json)$|(^|\/)\.env(?:\.|$)/i.test(file) && !file.endsWith('.env.example');
function check() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 18) fail('Node >=24.18 is required.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const skills = loadSkills();
  if (policy.metricVersion !== METRIC_VERSION) fail('Evaluation metric version must match the reviewed release policy.');
  if (policy.appVersion !== pkg.version || policy.maxDatabaseSchema !== MAX_SCHEMA || policy.contractVersion !== 1 || policy.promptVersion !== skills.promptVersion) fail('Release policy must match app, database, contract and prompt versions.');
  if ((process.env.GITHUB_REF || '').startsWith('refs/tags/v') && process.env.GITHUB_REF !== `refs/tags/v${pkg.version}`) fail('Release tag must match package version.');
  for (const skill of skills.skills) if (policy.skills[skill.name]?.version !== skill.version || policy.skills[skill.name]?.sha256 !== skill.sha256) fail('Pinned skill content changed; review and update the release policy.');
  const policyHash = crypto.createHash('sha256').update(skills.policy).digest('hex');
  if (policy.policyHash !== policyHash) fail('Pinned prompt content changed; review and update the release policy.');
  if (dataset.schemaVersion !== 1 || dataset.datasetVersion !== policy.datasetVersion || dataset.analysis.filter((r) => r.split === 'gate').length < 12 || dataset.analysis.filter((r) => r.split === 'challenge').length < 8 || dataset.scheduler.length < 10 || dataset.memory.queries.length < 6) fail('Required evaluation coverage missing.');
  if (policy.datasetHash !== crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex')) fail('Dataset or thresholds changed; review and update the release policy.');
  for (const items of [dataset.analysis, dataset.scheduler, dataset.memory.queries]) if (new Set(items.map((item) => item.id)).size !== items.length) fail('Evaluation IDs must be unique.');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  if (files.some(privatePath)) fail('Private data or credentials path is tracked.');
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const value = fs.readFileSync(absolute, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{50,}|tvly-[a-zA-Z0-9_-]{20,}|GOCSPX-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,}|sk-[a-zA-Z0-9_-]{32,}|[a-f0-9]{32}\.[a-zA-Z0-9]{16})\b/.test(value)) fail(`Possible credential in tracked file: ${file}`);
  }
  console.log('Quality policy passed: version compatibility, prompt/skill pins, evaluation coverage and tracked-data/credential checks.');
}
if (require.main === module) { try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { check, privatePath };
