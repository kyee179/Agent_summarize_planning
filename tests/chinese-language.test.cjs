const test=require('node:test'),assert=require('node:assert/strict');
const {localRuleBasedAnalysis,analyzeJournal}=require('../server/journalAnalyzer.cjs');
const {candidates,number}=require('../server/chineseDates.cjs');
const {outputLanguage}=require('../server/language.cjs');
const {chunks}=require('../server/contracts/journalEvidence.cjs');
const {createStore}=require('../server/store.cjs');
const {createMemory}=require('../server/integrations/memory.cjs');
const {buildMessages,loadSkills}=require('../server/agent/skills.cjs');
const {expandProposal}=require('../server/agent/compactProposal.cjs');
const settings={timezone:'Asia/Shanghai',aiProvider:'local',defaultAvailability:[{startsAt:'09:00',endsAt:'18:00'}]};
const input=content=>({journal:{id:'zh',type:'daily',journalDate:'2030-01-07',content},settings});
test('mixed completed and unfinished Chinese clauses keep only explicit future actions',()=>{
  const result=localRuleBasedAnalysis(input('我已经完成项目报告，但还需要准备答辩。取消面试，不用准备了。'));
  assert.deepEqual(result.tasks.map(t=>t.title),['还需要准备答辩']); assert.match(result.summary,/所选日记/);
  for(const text of ['我准备了报告。','我已经准备好面试。','如果获得批准，就需要提交申请。','可能需要更新CV。','我不想准备面试。']) assert.equal(localRuleBasedAnalysis(input(text)).tasks.length,0,text);
});
test('normalization recognizes full-width text while citations keep original bytes',()=>{
  const text='我需要更新ＣＶ；我需要准备面试！';const result=localRuleBasedAnalysis(input(text));assert.equal(result.tasks.length,2);
  assert.ok(result.contract.evidence.every(e=>text.includes(e.excerpt)));assert.ok(result.tasks[0].title.includes('ＣＶ'));
});
test('repeated action mentions are deduplicated before local allocation',()=>{
  const result=localRuleBasedAnalysis(input('我需要完成项目报告。我应该完成项目报告。'));assert.equal(result.tasks.length,1);
});
test('decimal and full-width durations survive evidence splitting with exact offsets',()=>{
  const text='我需要用１．５小时完成报告；还需要检查CV。😀';const spans=chunks(text);
  assert.ok(spans[0].excerpt.includes('１．５')); for(const span of spans) assert.equal(text.slice(span.start,span.end),span.excerpt);
});
test('source-relative dates honor journal dates, year boundaries and leap years',()=>{
  const cases=[['明天下午需要提交报告','2030-01-07','2030-01-08',null],['下周五下午三点半需要提交报告','2030-01-07','2030-01-18','15:30'],['下下周一上午九点需要提交报告','2030-01-07','2030-01-21','09:00'],['后天需要提交报告','2028-02-28','2028-03-01',null],['明天需要提交报告','2029-12-31','2030-01-01',null],['三天后需要提交报告','2030-01-07','2030-01-10',null],['2030年1月9日下午3:30需要提交报告','2030-01-07','2030-01-09','15:30']];
  for(const [text,date,day,time] of cases){const value=candidates(text,{date,timezone:'Asia/Shanghai'});assert.equal(value.deadlineDate,day,text);assert.equal(value.deadlineTime,time,text);assert.equal(value.confirmation,'required');}
});
test('ambiguous or impossible dates and times are never silently resolved',()=>{
  for(const text of ['周五需要提交报告','2030年2月30日需要提交报告','明天三点需要提交报告','明天或后天需要提交报告']) {const value=candidates(text,{date:'2030-01-07',timezone:'UTC'});assert.equal(value.deadlineInstant,null,text);assert.ok(value.ambiguities.length,text);}
  assert.equal(candidates('明天下午需要提交报告',{date:'2030-01-07',timezone:'UTC'}).deadlineTime,null);
});
test('explicit offset and UTC candidates are converted without treating them as confirmed facts',()=>{
  assert.equal(candidates('2030-01-07T16:00:00+08:00需要提交报告',{date:'2030-01-07',timezone:'UTC'}).deadlineInstant,'2030-01-07T08:00:00.000Z');
  assert.equal(candidates('2030-01-07 at 12:00 UTC 需要提交报告',{date:'2030-01-07',timezone:'Asia/Shanghai'}).deadlineInstant,'2030-01-07T12:00:00.000Z');
});
test('Chinese numbers and durations distinguish effort from relative time limits',()=>{
  assert.equal(number('二十三'),23);assert.equal(number('两'),2);
  const cases=[['预计三十分钟完成',30],['预计一个半小时完成',90],['预计半小时完成',30],['预计1.5小时完成',90],['预计1小时30分钟完成',90],['30分钟后提交',null],['预计30到60分钟',null]];
  for(const [text,minutes] of cases) assert.equal(candidates(text,{date:'2030-01-07',timezone:'UTC'}).effortMinutes,minutes,text);
});
test('Chinese generated prose obeys requested language while protocol fields stay canonical',async()=>{
  const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='local';
  try {const result=await analyzeJournal({...input('我需要完成项目报告。'),outputLanguage:'zh-CN'});assert.equal(result.outputLanguage,'zh-CN');assert.match(result.weeklySummary,/部分上下文/);assert.equal(result.contract.tasks[0].status,'open');assert.equal(result.contract.tasks[0].deadline,null);
  const english=await analyzeJournal({...input('我需要完成项目报告。'),outputLanguage:'en'});assert.match(english.summary,/Reported/);
  const context={...input('我需要完成项目报告。'),outputLanguage:'zh-CN',trustedEvidence:result.contract.evidence};const messages=buildMessages(loadSkills(),context,{});assert.equal(JSON.parse(messages.messages[1].content).outputLanguage,'zh-CN');assert.match(messages.messages[0].content,/never translate the protocol/);
  assert.match(expandProposal({summary:'需要提交报告',summaryEvidenceIds:['e'],tasks:[]},{outputLanguage:'zh-CN'}).weeklySummary,/部分上下文/);
  }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('automatic output language uses journal content instead of retrieved context',()=>{
  assert.equal(outputLanguage('我需要更新CV'),'zh-CN');assert.equal(outputLanguage('I need to update my CV.'),'en');assert.equal(outputLanguage('I need to update my CV.','zh-CN'),'zh-CN');
});
test('durable date suggestions follow each source date, refresh timezone and stay separate from confirmed facts',()=>{
  const store=createStore(':memory:');
  const journal={id:'source-date',type:'daily',title:'合成',journalDate:'2030-01-07',content:'明天下午三点需要提交报告。',updatedAt:'2030-01-07T00:00:00Z'};
  try {store.updateSettings(settings);store.createJournal(journal);
    const save=(id,zone)=>store.saveJournalAnalysis({...localRuleBasedAnalysis({journal,settings:{...settings,timezone:zone},targetDate:'2030-02-01'}),id,journalId:journal.id});
    const first=save('first','Asia/Shanghai');const record=first.persistentTasks[0];
    assert.equal(record.candidates.deadlineInstant,'2030-01-08T07:00:00.000Z');assert.equal(first.contract.tasks[0].deadline,null);
    store.updateTask(record.id,{revision:record.revision,deadline:{at:'2030-01-10T00:00:00Z',kind:'hard'}});
    const second=save('second','UTC');assert.equal(second.persistentTasks[0].id,record.id);
    assert.equal(second.persistentTasks[0].candidates.deadlineInstant,'2030-01-08T15:00:00.000Z');
    assert.equal(second.contract.tasks[0].deadline.at,'2030-01-10T00:00:00Z');
    assert.equal(candidates('2030-01-08T15:00:00+08:00',{date:journal.journalDate,timezone:'UTC'}).timezone,'UTC+08:00');
  } finally {store.close();}
});
test('remote proposals cannot schedule work supported only by explicit Chinese negation or completion',()=>{
  const {createToolSession}=require('../server/agent/tools.cjs');
  for(const content of ['我不需要更新CV。','我已经完成报告。','如果获批，就需要提交申请。']) {
    const fixture=input(content),evidence=localRuleBasedAnalysis(fixture).contract.evidence;
    const session=createToolSession({...fixture,provider:'glm',outputLanguage:'zh-CN',memorySearch:async()=>({items:[],evidence:[]}),trustedEvidence:evidence,expectedPlan:{targetDate:'2030-01-07',timezone:'UTC',availability:[],bufferMinutes:15}},'glm','synthetic');
    session.execute('read_evidence',{offset:0,limit:20});session.execute('get_planning_context',{});
    const proposal={summary:'合成摘要',summaryEvidenceIds:evidence.map(e=>e.id),tasks:[{title:'更新CV',evidenceIds:evidence.map(e=>e.id),importance:'unknown',effortMinutes:null,assumption:'未知'}]};
    assert.throws(()=>session.execute('preview_plan',{proposal}),error=>error.issues.some(issue=>issue.code==='source_action'));
    proposal.tasks=[];assert.ok(session.execute('preview_plan',{proposal}).output.previewId);
  }
});
test('compact no-action mode removes the task field rather than accepting placeholder tasks',()=>{
  const {wireSchema}=require('../server/agent/compactProposal.cjs');
  const fixture=input('我不需要更新CV。'),evidence=localRuleBasedAnalysis(fixture).contract.evidence;
  const context={...fixture,trustedEvidence:evidence,outputLanguage:'zh-CN'};
  const schema=wireSchema(context);assert.equal(schema.properties.tasks,undefined);assert.ok(!schema.required.includes('tasks'));
  const result=expandProposal({summary:'不需要更新CV',summaryEvidenceIds:evidence.map(e=>e.id)},context);
  assert.deepEqual(result.tasks,[]);assert.deepEqual(result.estimates,[]);
});
test('memory chunk boundaries preserve surrogate pairs and edits invalidate cached vectors',()=>{
  const store=createStore(':memory:');
  try {const content='甲'.repeat(899)+'😀'+'乙'.repeat(298)+'😀'+'丙'.repeat(1000);
    store.putMemoryDocument({id:'unicode',title:'边界',content,updatedAt:'2030-01-07T00:00:00Z'});
    const chunks=store.memoryChunks(); assert.ok(chunks.length>=2);
    for(const chunk of chunks) {assert.equal(chunk.content.isWellFormed(),true);assert.ok(content.includes(chunk.content));}
    store.saveEmbeddings(chunks,chunks.map(()=>[1,0]),'revision','model');
    store.reindexMemory([]);assert.ok(store.memoryChunks().every(chunk=>chunk.embedding));
    store.putMemoryDocument({id:'unicode',title:'边界',content:content+'变更',updatedAt:'2030-01-07T01:00:00Z'});
    assert.ok(store.memoryChunks().every(chunk=>!chunk.embedding));
  } finally {store.close();}
});
test('semantic indexing retries process missing chunks without destroying compatible vectors',async()=>{
  const store=createStore(':memory:'); let requested=0;
  try{
    for(let i=0;i<30;i++)store.putMemoryDocument({id:'source-'+i,title:'合成',content:'甲 '.repeat(4500),updatedAt:'2030-01-07T00:00:00Z'});
    const memory=createMemory(store,{env:{},fetchImpl:async(url,options)=>new Response(JSON.stringify(url.endsWith('/api/tags')?{models:[{name:'nomic-embed-text:latest',digest:'a'.repeat(64)}]}:{embeddings:JSON.parse(options.body).input.map(()=>{requested++;return [1,0];})}),{status:200})});
    const first=await memory.index({consent:true,semantic:true});assert.equal(first.embedded,256);assert.equal(first.remaining,44);
    const second=await memory.index({consent:true,semantic:true});assert.equal(second.embedded,300);assert.equal(second.embeddedThisRun,44);assert.equal(requested,300);assert.equal(second.partial,false);
    const third=await memory.index({consent:true,semantic:true});assert.equal(third.embeddedThisRun,0);assert.equal(requested,300);
  }finally{store.close();}
});
