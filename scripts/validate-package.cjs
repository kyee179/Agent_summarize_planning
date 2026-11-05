const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const root = path.join(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function auditPackage(executable) {
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const asar = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('@electron/asar');
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  const entries = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  const { privatePath } = require('./quality-check.cjs');
  assert.deepEqual(entries.filter(privatePath), [], 'Private paths in app package');
  for (const file of ['dist/index.html', 'electron/main.cjs', 'electron/preload.cjs', 'electron/profileDirectory.cjs', 'server/auth/hosted.cjs', 'server/sourceRoutes.cjs', 'server/sourceTasks.cjs', 'server/integrations/workCapture.cjs', 'server/skills/registry.json', 'server/skills/prompts/1.4.0/policy.md', 'server/skills/daily-summary/1.1.0/SKILL.md', 'server/skills/task-planning/1.2.0/SKILL.md']) assert.ok(entries.includes(file), 'Missing packaged runtime file: ' + file);
  assert.ok(fs.existsSync(archive + '.unpacked/server/integrations/windows-activity.ps1'), 'Missing external Windows helper');
  const captureHelper=archive+'.unpacked/server/integrations/windows-work-content.ps1';
  assert.ok(fs.existsSync(captureHelper),'Missing external work-content helper');
  assert.equal(sha(fs.readFileSync(captureHelper)),sha(fs.readFileSync(path.join(root,'server/integrations/windows-work-content.ps1'))),'Work-content helper differs from reviewed source');
  if(process.platform==='win32'){
    const result=JSON.parse(require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',captureHelper,'-Mode','read','-SyntheticFixture'],{encoding:'utf8',windowsHide:true,timeout:20000}));
    assert.equal(result.text,'Please revise the three synthetic charts.','Packaged native text capture failed');
  }
  const runtime = {};
  for (const file of entries.filter(file => /^(electron|server|dist)\//.test(file))) {
    const stat = asar.statFile(archive, path.normalize(file)); if (stat.files || stat.link || stat.unpacked) continue;
    const bytes = asar.extractFile(archive, path.normalize(file)); const source = path.join(root, file);
    assert.ok(fs.existsSync(source), 'Unexpected runtime content: ' + file);
    assert.equal(sha(bytes), sha(fs.readFileSync(source)), 'Package/source mismatch: ' + file);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[a-zA-Z0-9]{30,}|sb_secret_[a-zA-Z0-9_-]{16,})\b/.test(bytes.toString()), 'Credential signature in package');
    runtime[file] = sha(bytes);
  }
  return { archiveSha256: sha(fs.readFileSync(archive)), packagedEntries: entries.length, verifiedRuntimeFiles: Object.keys(runtime).length, runtimeDigest: sha(JSON.stringify(runtime)) };
}
async function connect(url) {
  const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); });
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  return { close: () => socket.close(), async evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; } };
}
async function runApp(executable, directory, expression) {
  const env = { ...process.env, CALENDAR_PROFILE_DIRECTORY: directory, CALENDAR_DB_PATH: path.join(directory, 'calendar.sqlite'), CALENDAR_SMOKE_TEST: '1', AI_PROVIDER: 'local' };
  for (const key of Object.keys(env)) if (/(?:API_KEY|CLIENT_SECRET|CLIENT_ID|ENCRYPTION_KEY|API_TOKEN)$/.test(key) || /^(?:SUPABASE_|ELECTRON_|WEB_SEARCH_PROVIDER)/.test(key)) delete env[key];
  const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let output = '', port; child.stderr.on('data', data => { output = (output + data.toString()).slice(-32768); const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (match) port = Number(match[1]); });
  const exited = once(child, 'exit'); let closed = false; child.once('exit', () => { closed = true; }); let client;
  try {
    for (let i = 0; i < 200 && !port && !closed; i++) await pause(100);
    assert.ok(port, 'Packaged app did not start its isolated debugging endpoint');
    let target;
    for (let i = 0; i < 100 && !target && !closed; i++) { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()); target = pages.find(page => page.type === 'page' && page.url.startsWith('file:')); if (!target) await pause(50); }
    assert.ok(target, 'Packaged frontend did not load'); client = await connect(target.webSocketDebuggerUrl);
    const result = await Promise.race([client.evaluate(expression), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Packaged acceptance timed out')), 40000); timer.unref(); })]);
    // Exercise the normal main-process shutdown and SQLite close path.
    await Promise.race([client.evaluate('window.close()'), pause(1000)]); client.close(); client = null;
    await Promise.race([exited, pause(10000)]); assert.ok(closed, 'App did not close normally');
    return result;
  } finally { client?.close(); if (!closed) { child.kill(); await Promise.race([exited, pause(5000)]); } }
}
const setup = `const until = async (condition, label) => { for (let i=0;i<200;i++) { if (condition()) return; await new Promise(resolve=>setTimeout(resolve,25)); } throw new Error(label); };
  const click = text => { const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent===text); if(!button) throw new Error('Missing button '+text); button.click(); };
  const call = async (route, body, method=body?'POST':'GET') => { const result=await window.studyCalendar.request(route,{method,...(body?{body:JSON.stringify(body)}:{})}); if(result.status>=400) throw new Error(route+': '+result.status); return result; };
  await until(()=>document.querySelector('.auth-card'),'Locked welcome');
  if((await window.studyCalendar.request('/api/events')).status!==401) throw new Error('Unlocked startup');
  click('Continue offline');
  await until(()=>document.querySelector('.onboarding-card')||document.querySelector('.primary-nav'),'Profile opened');
  if(document.querySelector('.onboarding-card')) { for(let step=0;step<3;step++){ document.querySelector('.onboarding-card form').requestSubmit(); await new Promise(resolve=>setTimeout(resolve,80)); } }
  await until(()=>document.querySelector('.primary-nav')&&!document.querySelector('.workspace-loading'),'Workspace ready');`;

async function validate(executable, reportFile) {
  executable = fs.realpathSync(executable); const audit = await auditPackage(executable);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-package-validation-'));
  try {
    const fresh = await runApp(executable, path.join(directory, 'fresh'), `(async()=>{${setup}
      await call('/api/settings',{timezone:'UTC'},'PUT');
      const journal=(await call('/api/journals',{type:'daily',journalDate:'2030-01-07',title:'合成发布检查',content:'我需要完成项目报告。今天检查了ＡＰＩ接口。😀'})).body;
      const analysis=(await call('/api/journals/'+journal.id+'/analyze',{targetDate:'2030-01-07'})).body;
      if(analysis.outputLanguage!=='zh-CN'||analysis.contract.tasks.length!==1||!analysis.summary.includes('项目报告'))throw new Error('Chinese packaged analysis');
      const route='/api/journals/'+journal.id+'/apply-drafts', input={analysisId:analysis.id};
      if((await call(route,input)).status!==201||(await call(route,input)).body.replayed!==true)throw new Error('Apply replay');
      const tasks=(await call('/api/tasks')).body; if(!tasks[0]?.sessionEventIds.length)throw new Error('Task linkage');
      const source=(await call('/api/task-sources',{consent:true,kind:'email',externalId:'packaged-invented-mail',text:'Please revise the three charts.'})).body;
      const discovery=(await call('/api/task-sources/'+encodeURIComponent(source.id)+'/discover',{allowAI:false})).body;
      if(discovery.candidates.length!==1)throw new Error('Packaged task discovery');const candidate=discovery.candidates[0];
      const accepted=(await call('/api/task-candidates/'+encodeURIComponent(candidate.id)+'/review',{state:'accepted',revision:candidate.revision})).body;
      await call('/api/tasks/'+encodeURIComponent(accepted.taskId),{revision:1,effort:{minutes:60,scope:'remaining_task'},useEstimatedEffort:true,estimateScope:'remaining_task',estimateFeatures:{category:'review',unit:'chart',quantity:3,revise_or_create:'revise',complexity:2,familiarity:3}},'PUT');
      const sourcePlan=(await call('/api/task-plans',{taskIds:[accepted.taskId],targetDate:'2030-01-07'})).body;
      if(sourcePlan.contract.schemaVersion!==2||sourcePlan.contract.plan.blocks.length!==1)throw new Error('Packaged source-only plan');
      const sourceApply='/api/task-plans/'+encodeURIComponent(sourcePlan.id)+'/apply';await call(sourceApply,{});if(!(await call(sourceApply,{})).body.replayed)throw new Error('Packaged source Apply replay');
      await call('/api/tasks/'+encodeURIComponent(accepted.taskId)+'/effort',{planId:sourcePlan.id,receipt:'packaged-invented-outcome',actualMinutes:90,completed:true});
      const timing=(await call('/api/account/export')).body.outcomes;if(!timing?.[0]?.features.complete||timing[0].features.quantity!==3||!timing[0].estimatedAt)throw new Error('Packaged training-data export');
      await call('/api/memory',{title:'Synthetic memory',content:'火星接口发布核验'});
      if((await call('/api/memory/search',{query:'火星接口'})).body.items.length!==1)throw new Error('Packaged CJK retrieval');
      const status=await window.studyCalendar.setupStatus(); if(status.secureStorage){await window.studyCalendar.saveSetup({AI_PROVIDER:'local',GLM_API_KEY:'synthetic-package-private-key'});window.dispatchEvent(new Event('calendar:auth-changed'));await new Promise(resolve=>setTimeout(resolve,100));await until(()=>document.querySelector('.primary-nav'),'Setup reload');}
      return {journalId:journal.id,secureStorage:status.secureStorage,taskCount:(await call('/api/tasks')).body.length,sourceTaskPipeline:true,reviewedOutcomes:timing.length};})()`);
    const restarted = await runApp(executable, path.join(directory, 'fresh'), `(async()=>{${setup}
      const journals=(await call('/api/journals')).body;if(journals.length!==1||journals[0].content!=='我需要完成项目报告。今天检查了ＡＰＩ接口。😀')throw new Error('Restart persistence');
      const analysis=(await call('/api/journals/'+journals[0].id+'/analyze',{targetDate:'2030-01-07'})).body;if(analysis.scheduleDrafts.length)throw new Error('Duplicate planning after restart');
      const services=await window.studyCalendar.setupStatus();if(${fresh.secureStorage}&&!services.configured.GLM_API_KEY)throw new Error('Secure setup restart');
      const exported=(await call('/api/account/export')).body;if(JSON.stringify(exported).includes('synthetic-package-private-key'))throw new Error('Credential in export');
      return {journals:journals.length,duplicateDrafts:analysis.scheduleDrafts.length};})()`);
    const file = path.join(directory, 'fresh', 'calendar.sqlite');
    const recovery = require('../server/recovery.cjs'); const integrity = recovery.inspectDatabase(file);
    const copied = path.join(directory, 'restored.sqlite'); await recovery.copyDatabase(file, copied); assert.equal(recovery.inspectDatabase(copied).integrity, 'ok');
    const legacy = path.join(directory, 'legacy'); fs.mkdirSync(legacy);
    const legacyFile = path.join(legacy, 'calendar.sqlite'); const store = require('../server/store.cjs').createStore(legacyFile, { seedDemo: false });
    store.createJournal({ id:'legacy',type:'daily',journalDate:'2030-01-07',title:'Synthetic older database',content:'合成旧版日记保留。',createdAt:'2030-01-07T00:00:00Z',updatedAt:'2030-01-07T00:00:00Z' }); store.putMemoryDocument({id:'legacy-note',title:'旧笔记',content:'火星接口旧版资料',updatedAt:'2030-01-07T00:00:00Z'});store.close();
    const db = new DatabaseSync(legacyFile); db.exec('DROP TABLE task_plans; DROP TABLE effort_records; DROP TABLE task_candidates; DROP TABLE task_sources; DROP TABLE source_items; DROP TABLE task_sessions; DROP TABLE task_analyses; DROP TABLE durable_tasks; DROP TABLE reminder_receipts; PRAGMA user_version=2; DELETE FROM memory_fts;');db.close();
    const migration = await runApp(executable, legacy, `(async()=>{${setup}const journals=(await call('/api/journals')).body;if(journals[0]?.content!=='合成旧版日记保留。')throw new Error('Migration lost text');if((await call('/api/memory/search',{query:'火星接口'})).body.items.length!==1)throw new Error('Migration lost search');return {journalPreserved:true,searchPreserved:true};})()`);
    const snapshot = fs.readdirSync(legacy).find(file=>file.includes('.before-v2-'));assert.ok(snapshot,'Pre-migration snapshot missing');assert.equal(recovery.inspectDatabase(path.join(legacy,snapshot),2).version,2);assert.equal(recovery.inspectDatabase(legacyFile).version,4);
    const report={schemaVersion:1,platform:process.platform,validatedAt:new Date().toISOString(),executable:path.basename(executable),...audit,fresh:{secureStorage:fresh.secureStorage,taskCount:fresh.taskCount,sourceTaskPipeline:fresh.sourceTaskPipeline,reviewedOutcomes:fresh.reviewedOutcomes},restarted,migration,integrity,backupRestore:'passed',preMigrationSnapshot:'verified-v2',limits:['Synthetic local data only','Hosted service deferred','Native IME and notification delivery require manual acceptance','No clean-machine or other-OS claim']};
    fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));return report;
  } finally { assert.ok(directory.startsWith(path.join(os.tmpdir(),'calendar-package-validation-')));fs.rmSync(directory,{recursive:true,force:true}); }
}
if(require.main===module){const [executable,reportFile]=process.argv.slice(2);if(!executable||!reportFile)throw new Error('Usage: node scripts/validate-package.cjs <packaged executable> <report.json>');validate(executable,path.resolve(reportFile)).catch(error=>{console.error('Package validation failed: '+error.message);process.exitCode=1;});}
module.exports={auditPackage,validate};
