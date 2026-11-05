const {execFile}=require('node:child_process');const path=require('node:path');
const {error}=require('./common.cjs');
function createWorkCapture(store,{platform=process.platform,execFileImpl=execFile,clock=()=>new Date().toISOString()}={}){
  let selected=null,timer=null,generation=0,running=false,lastCapturedAt=null,lastError=null,child=null;
  const helper=path.join(__dirname,'windows-work-content.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const call=args=>new Promise((resolve,reject)=>{child=execFileImpl('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,...args],{windowsHide:true,timeout:15000,maxBuffer:512000,encoding:'utf8'},(err,stdout)=>{child=null;try{const value=JSON.parse(stdout.replace(/^\uFEFF/,''));if(err||value.error)reject(error(value.error||'Capture unavailable',409));else resolve(value);}catch{reject(error('Capture helper unavailable',409));}});});
  function stop(){generation++;selected=null;clearInterval(timer);timer=null;if(child){child.kill();child=null;}return {paused:true};}
  async function capture(){if(!selected||running)return;running=true;const current=generation;try{const value=await call(['-Mode','read','-ProcessId',String(selected.processId),'-WindowHandle',String(selected.windowHandle),...(selected.allowOcr?['-AllowOcr']:[])]);if(current!==generation)return;const source=store.importTaskSource({kind:'work_app',externalId:`${value.app}:${value.processId}:${value.windowHandle}`,title:value.app,text:value.text,sourceTimestamp:value.observedAt},clock());store.saveTaskDiscovery(source.id,source.version,require('../sourceExtraction.cjs').localCandidates(source));lastCapturedAt=clock();lastError=null;}catch(e){if(current===generation)lastError=e.message;}finally{running=false;}}
  return {status:()=>({available:platform==='win32',running:Boolean(selected),selected:selected?{app:selected.app}:null,lastCapturedAt,lastError}),
    async windows(input){if(platform!=='win32')throw error('Window capture is available on Windows',409);if(input.consent!==true)throw error('Permission is needed to list work-app windows');return call(['-Mode','list']);},
    async start(input){if(platform!=='win32')throw error('Window capture is available on Windows',409);if(input.consent!==true||!Number.isSafeInteger(input.processId)||input.processId<1||!Number.isSafeInteger(input.windowHandle)||input.windowHandle<1)throw error('Choose a window and allow its text to be captured');stop();selected={processId:input.processId,windowHandle:input.windowHandle,app:String(input.app||'Selected app').slice(0,100),allowOcr:input.allowOcr===true};await capture();timer=setInterval(capture,60000);timer.unref();return this.status();},
    stop,close:stop,capture};
}
module.exports={createWorkCapture};
