const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
app.setPath('userData', process.env.CALENDAR_SMOKE_DIRECTORY);
app.setPath('sessionData', process.env.CALENDAR_SMOKE_DIRECTORY);
app.disableHardwareAcceleration();

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      window.webContents.setBackgroundThrottling(false);
      const run = code => window.webContents.executeJavaScript(`(async () => {
        const until = async (condition, label) => { for(let i=0;i<160;i++){ if(condition())return; await new Promise(r=>setTimeout(r,25)); } throw new Error(label); };
        const button = text => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
        ${code}
      })()`);
      const capture = async (name, width = 1280) => {
        window.setMinimumSize(320, 480); window.setContentSize(width, 840);
        await run(`window.scrollTo(0,0); await new Promise(r=>setTimeout(r,100));
          if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Language layout overflow: ${name}');
          const control=document.querySelector('.language-switch');
          if(!control||control.getBoundingClientRect().right>innerWidth+1)throw new Error('Language button inaccessible');`);
        if(process.env.CALENDAR_UI_CAPTURE_DIRECTORY){
          fs.mkdirSync(process.env.CALENDAR_UI_CAPTURE_DIRECTORY,{recursive:true});
          fs.writeFileSync(path.join(process.env.CALENDAR_UI_CAPTURE_DIRECTORY,name+'.png'),(await window.webContents.capturePage()).toPNG());
        }
      };
      await run(`await until(()=>document.querySelector('.auth-card'),'Welcome missing');document.querySelector('.language-switch').click();
        await until(()=>document.documentElement.lang==='zh-CN','Language did not switch');
        if(!button('离线使用')||!button('登录'))throw new Error('Chinese welcome missing');`);
      await capture('zh-welcome'); await capture('zh-welcome-mobile',390);
      const loaded = new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
      window.webContents.reload(); await loaded;
      await run(`await until(()=>document.querySelector('.auth-card'),'Reload welcome missing');
        if(document.documentElement.lang!=='zh-CN'||!button('离线使用'))throw new Error('Language persistence failed');
        button('离线使用').click(); await until(()=>document.querySelector('.onboarding-card'),'Onboarding missing');
        if(!document.body.innerText.includes('安排好你的每一天'))throw new Error('Chinese onboarding missing');`);
      await capture('zh-onboarding'); await capture('zh-onboarding-mobile',390);
      await run(`for(let step=0;step<3;step++){document.querySelector('.onboarding-card form').requestSubmit();await new Promise(r=>setTimeout(r,160));}
        await until(()=>document.querySelector('.primary-nav')&&!document.querySelector('.workspace-loading'),'Workspace missing');
        if(document.documentElement.lang!=='zh-CN')throw new Error('Onboarding lost language');
        const call=window.studyCalendar.request;
        const result=await call('/api/journals',{method:'POST',body:JSON.stringify({type:'daily',journalDate:'2030-01-07',title:'Today',content:'I need to review the synthetic project. 明天复查。'})});
        if(result.status!==201)throw new Error('Synthetic journal setup failed');`);
      // A remount loads the invented journal and verifies a persisted language inside the workspace.
      const workspaceLoaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
      window.webContents.reload(); await workspaceLoaded;
      await run(`await until(()=>document.querySelector('.primary-nav')&&!document.querySelector('.workspace-loading'),'Reload workspace missing');`);
      for(const [name,label] of [['today','今天'],['calendar','日历'],['journal','日记'],['plan','计划'],['tasks','任务'],['connections','连接'],['settings','设置']]){
        await run(`const nav=[...document.querySelectorAll('nav button')].find(b=>b.textContent==='${label}');if(!nav)throw new Error('Missing translated navigation');nav.click();await new Promise(r=>setTimeout(r,140));`);
        await capture('zh-'+name); await capture('zh-'+name+'-mobile',390);
      }
      window.setContentSize(1280,840);
      await run(`button('日记').click();await until(()=>document.querySelector('.journal-row'),'Journal row missing');document.querySelector('.journal-row').click();
        await until(()=>document.querySelector('.journal-title')?.value==='Today','User title changed');
        const textarea=document.querySelector('.journal-textarea');
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
        setter.call(textarea,'Unsaved English. 未保存中文。');textarea.dispatchEvent(new Event('input',{bubbles:true}));
        await until(()=>document.body.innerText.includes('未保存的更改'),'Dirty state missing');
        document.querySelector('.language-switch').click();
        await until(()=>document.documentElement.lang==='en','English switch failed');
        if(textarea.value!=='Unsaved English. 未保存中文。'||document.querySelector('.journal-title').value!=='Today')throw new Error('Toggle changed user data');
        if(!button('Save journal'))throw new Error('English journal missing');
        document.querySelector('.language-switch').click();await until(()=>Boolean(button('自定义分析')),'Chinese analysis control missing');button('自定义分析').click();
        await until(()=>document.querySelector('dialog'),'Analysis dialog missing');
        if(document.querySelector('dialog select').value!=='auto')throw new Error('UI language changed analysis language');
        if(document.querySelector('dialog input[role="switch"]:checked'))throw new Error('Toggle changed permissions');`);
      await capture('zh-analysis-options');
      await run(`button('完成').click();document.querySelector('.account-button').click();
        await until(()=>Boolean(button('切换工作区')),'Account dialog missing');button('切换工作区').click();
        await until(()=>Boolean(button('关闭工作区')),'Unsaved close confirmation missing');button('关闭工作区').click();
        await until(()=>document.querySelector('.auth-card'),'Sign-out failed');
        if(document.documentElement.lang!=='zh-CN')throw new Error('Sign-out lost language');`);
      console.log('Language smoke passed: Chinese welcome/onboarding, reload persistence, seven workspace pages at 1280/390px, English return, unsaved journal and analysis permission preservation.');
      app.quit();
    } catch(error) { console.error('Language smoke failed: '+error.message); app.exit(1); }
  });
});
require(path.join(__dirname,'..','electron','main.cjs'));
