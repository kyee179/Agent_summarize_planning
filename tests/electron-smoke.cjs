const { app } = require("electron");
const path = require("node:path");
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
        const analysis = await call('/api/journals/' + journal.id + '/analyze', { method: 'POST', body: '{}' });
        if (analysis.status !== 201 || !analysis.body.scheduleDrafts.length) throw new Error('Analysis failed');
        const body = JSON.stringify({ analysisId: analysis.body.id });
        const route = '/api/journals/' + journal.id + '/apply-drafts';
        const first = await call(route, { method: 'POST', body });
        const retry = await call(route, { method: 'POST', body });
        if (first.status !== 201 || retry.status !== 200 || !retry.body.replayed) throw new Error('Batch replay failed');
        const events = await call('/api/events');
        if (events.body.filter(event => event.sourceAnalysisId === analysis.body.id).length !== first.body.events.length) throw new Error('Duplicate events');
        let rejected = false;
        try { await call('https://evil.example/api/events'); } catch { rejected = true; }
        if (!rejected) throw new Error('External IPC route accepted');
        return { events: first.body.events.length, pageRendered: document.querySelector('main') !== null };
      })()`);
      if (!result.pageRendered) throw new Error("React did not render");
      console.log("Desktop smoke passed: SQLite, main/preload/renderer IPC, analysis, batch replay, isolation, and rendered UI.");
      app.quit();
    } catch (error) {
      console.error(`Desktop smoke failed: ${error.message}`);
      process.exitCode = 1;
      app.exit(1);
    }
  });
});
require(path.join(__dirname, "..", "electron", "main.cjs"));
