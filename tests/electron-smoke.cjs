const { app } = require("electron");
const path = require("node:path");
const fs = require('node:fs');
app.setPath("userData", process.env.CALENDAR_SMOKE_DIRECTORY);
app.setPath("sessionData", process.env.CALENDAR_SMOKE_DIRECTORY);
app.disableHardwareAcceleration();

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (typeof window.studyCalendar?.request !== 'function') throw new Error('Missing preload bridge');
        if ('apiToken' in window.studyCalendar || typeof window.require !== 'undefined') throw new Error('Renderer isolation failed');
        const call = window.studyCalendar.request;
        const response = await call('/api/journals', { method: 'POST', body: JSON.stringify({
          type: 'daily', journalDate: '2026-10-02', title: 'Smoke', content: 'I need to study the project tomorrow.'
        }) });
        if (response.status !== 201) throw new Error('Journal save failed');
        const journal = response.body;
        await call('/api/settings', { method: 'PUT', body: JSON.stringify({timezone: 'UTC'}) });
        const meeting = await call('/api/events', { method: 'POST', body: JSON.stringify({
          title: 'Existing recurring commitment', startsAt: '2029-12-25T20:00:00Z', endsAt: '2029-12-25T21:00:00Z',
          calendarType: 'personal', repeat: 'weekly', notificationFormat: 'Desktop notification'
        }) });
        if (meeting.status !== 201) throw new Error('Meeting setup failed');
        const analysis = await call('/api/journals/' + journal.id + '/analyze', { method: 'POST', body: JSON.stringify({ targetDate: '2030-01-01' }) });
         if (analysis.status !== 201 || !analysis.body.scheduleDrafts.length) throw new Error('Analysis failed');
         if (analysis.body.agentWorkflow?.outcome !== 'local' || analysis.body.agentWorkflow.skills.length !== 2) throw new Error('Skill provenance failed');
        if (analysis.body.scheduleDrafts[0].startsAt !== '2030-01-01T21:15:00.000Z' || analysis.body.scheduling.algorithm !== 'greedy-v1') throw new Error('Deterministic scheduling failed');
        const body = JSON.stringify({ analysisId: analysis.body.id });
        const route = '/api/journals/' + journal.id + '/apply-drafts';
        const interfering = await call('/api/events', { method: 'POST', body: JSON.stringify({
          title: 'New meeting', startsAt: '2030-01-01T21:15:00Z', endsAt: '2030-01-01T22:00:00Z',
          calendarType: 'personal', notificationFormat: 'Desktop notification'
        }) });
        if ((await call(route, { method: 'POST', body })).status !== 409) throw new Error('Stale calendar accepted');
        await call('/api/events/' + interfering.body.id, { method: 'DELETE' });
        const first = await call(route, { method: 'POST', body });
        const retry = await call(route, { method: 'POST', body });
        if (first.status !== 201 || retry.status !== 200 || !retry.body.replayed) throw new Error('Batch replay failed');
        const events = await call('/api/events');
        if (events.body.filter(event => event.sourceAnalysisId === analysis.body.id).length !== first.body.events.length) throw new Error('Duplicate events');
        let rejected = false;
        try { await call('https://evil.example/api/events'); } catch { rejected = true; }
        if (!rejected) throw new Error('External IPC route accepted');
        const integrationStatus = await call('/api/integrations/status');
        if (integrationStatus.status !== 200 || 'access_token' in integrationStatus.body.google) throw new Error('Integration status failed');
        if (!('desktopActivity' in integrationStatus.body) || !('separateDownloadRequired' in integrationStatus.body.desktopActivity)) throw new Error('Built-in activity status unavailable');
        const health = await call('/api/diagnostics');
        if (health.status !== 200 || !health.body.ready || health.body.telemetry.totals.local < 1) throw new Error('Monitoring IPC failed');
        if (!health.body.telemetry.recent.some(trace => trace.kind === 'analysis' && trace.outcome === 'local')) throw new Error('Analysis tracing failed');
        if (JSON.stringify(health.body).includes('I should')) throw new Error('Private text entered monitoring');
        const note = await call('/api/memory', { method: 'POST', body: JSON.stringify({ title: 'Synthetic scope', content: 'Review the synthetic release checklist.' }) });
        if (note.status !== 201) throw new Error('Memory note save failed');
        const search = await call('/api/memory/search', { method: 'POST', body: JSON.stringify({ query: 'checklist' }) });
        if (search.status !== 200 || search.body.mode !== 'lexical' || search.body.items.length !== 1) throw new Error('Local memory retrieval failed');
        if ((await call('/api/memory/' + encodeURIComponent(note.body.id), { method: 'DELETE' })).status !== 204) throw new Error('Memory deletion IPC failed');
        const pause = () => new Promise(resolve => setTimeout(resolve, 50));
        const until = async (condition, label) => { for (let i = 0; i < 150; i++) { if (condition()) return; await pause(); } throw new Error(label); };
        const navigate = name => Array.from(document.querySelectorAll('nav button')).find(button => button.textContent === name).click();
        navigate('Settings');
        await until(() => document.querySelector('input[list="timezones"]'), 'Settings did not load');
        const changeInput = (element, value) => { Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
        changeInput(document.querySelector('input[list="timezones"]'), 'UTC');
        Array.from(document.querySelector('.preferences-form').querySelectorAll('button')).find(button => button.textContent === 'Save settings').click();
        await until(() => document.querySelector('.settings-save').textContent.includes('Settings saved.'), 'Settings UI save failed');
        navigate('Journal');
        await until(() => document.querySelector('.journal-textarea'), 'Journal editor missing');
        changeInput(document.querySelector('.journal-title'), 'Planning the next release');
        changeInput(document.querySelector('.journal-textarea'), 'I need to study the project. I reviewed the agent workflow today and want to make room for focused work.');
        Array.from(document.querySelector('.journal-editor').querySelectorAll('button')).find(button => button.textContent === 'Save journal').click();
        await until(() => document.querySelector('.journal-save-state').textContent.startsWith('Saved'), 'Journal UI save failed');
        const customize = document.querySelector('.journal-analysis-prompt button'); customize.click();
        await until(() => document.querySelector('dialog[open]'), 'Analysis customization did not open');
        const sheet = document.querySelector('dialog[open]');
        if (sheet.querySelectorAll('[role="switch"]').length !== 3 || sheet.querySelector('[role="switch"]:checked')) throw new Error('Optional source defaults changed');
        const dateInput = sheet.querySelector('input[type="date"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(dateInput, '2030-01-08');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        Array.from(sheet.querySelectorAll('button')).find(button => button.textContent === 'Done').click();
        navigate('Plan');
        await until(() => document.querySelector('.plan-preparation'), 'Plan workspace did not open');
        const generate = Array.from(document.querySelector('.plan-preparation').querySelectorAll('button')).find(button => button.textContent.includes('Generate'));
        generate.click();
        await until(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Add all to local calendar' && !button.disabled), 'UI plan generation failed');
        if (!document.querySelector('.timeline') || !document.querySelector('.proposed-block')) throw new Error('Calendar comparison missing');
        if (!document.querySelector('.timeline').textContent.includes('Existing recurring commitment')) throw new Error('Recurring calendar comparison missing');
        navigate('Connections');
        await until(() => !document.querySelector('[aria-label="Sources and connections"]').parentElement.hidden, 'Connections page did not open');
        const connections = document.querySelector('[aria-label="Sources and connections"]');
        if (!connections || !connections.textContent.includes('Start recording') || !connections.textContent.includes('Google Calendar')) throw new Error('Simple connection controls missing');
        const activity = (await call('/api/integrations/status')).body.desktopActivity;
        if (activity.running) throw new Error('UI started activity recording without consent');
        navigate('Settings');
        document.querySelector('.settings-workspace > details').open = true;
        const healthPanel = document.querySelector('[aria-label="System health"]'); healthPanel.querySelector('button').click();
        await until(() => healthPanel.textContent.includes('Database ready'), 'Monitoring UI check failed');
        navigate('Plan');
        return { events: first.body.events.length, pageRendered: document.querySelector('main') !== null };
      })()`);
      if (!result.pageRendered) throw new Error("React did not render");
      if (process.env.CALENDAR_UI_CAPTURE_DIRECTORY) {
        window.webContents.setBackgroundThrottling(false);
        await window.webContents.executeJavaScript(`(() => { const style = document.createElement('style'); style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.append(style); })()`);
        fs.mkdirSync(process.env.CALENDAR_UI_CAPTURE_DIRECTORY, { recursive: true });
        const capture = async (page, name, width = 1280) => {
          window.setMinimumSize(320, 480); window.setContentSize(width, 840);
          await window.webContents.executeJavaScript(`(async () => {
            Array.from(document.querySelectorAll('nav button')).find(button => button.textContent === ${JSON.stringify(page)}).click();
            for (let i=0; i<80 && document.querySelector('h1')?.textContent !== ${JSON.stringify(page)}; i++) await new Promise(resolve => setTimeout(resolve, 25));
            document.querySelector('[aria-label="Dismiss message"]')?.click();
            window.scrollTo(0,0);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await new Promise(resolve => setTimeout(resolve, 150));
            const overflow = document.documentElement.scrollWidth > innerWidth + 2;
            if (overflow) throw new Error('Horizontal overflow on ${name}');
          })()`);
          const screenshot = await window.webContents.capturePage();
          fs.writeFileSync(path.join(process.env.CALENDAR_UI_CAPTURE_DIRECTORY, name + '.png'), screenshot.toPNG());
        };
        for (const page of ['Today', 'Calendar', 'Journal', 'Plan', 'Connections', 'Settings']) await capture(page, page.toLowerCase());
        for (const page of ['Today', 'Journal', 'Plan', 'Connections']) await capture(page, 'mobile-' + page.toLowerCase(), 390);
        await capture('Journal', 'journal');
        await window.webContents.executeJavaScript(`document.querySelector('.journal-analysis-prompt button').click()`);
        await new Promise(resolve => setTimeout(resolve, 150));
        fs.writeFileSync(path.join(process.env.CALENDAR_UI_CAPTURE_DIRECTORY, 'analysis-options.png'), (await window.webContents.capturePage()).toPNG());
      }
      console.log("Desktop smoke passed: scheduling, stale-calendar rejection, SQLite, IPC, batch replay, isolation, local memory, integration setup, tracing and monitoring UI.");
      app.quit();
    } catch (error) {
      console.error(`Desktop smoke failed: ${error.message}`);
      process.exitCode = 1;
      app.exit(1);
    }
  });
});
require(path.join(__dirname, "..", "electron", "main.cjs"));
