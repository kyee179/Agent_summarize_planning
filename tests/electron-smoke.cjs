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
        await call('/api/settings', { method: 'PUT', body: JSON.stringify({timezone: 'UTC'}) });
        const meeting = await call('/api/events', { method: 'POST', body: JSON.stringify({
          title: 'Existing recurring commitment', startsAt: '2029-12-25T20:00:00Z', endsAt: '2029-12-25T21:00:00Z',
          calendarType: 'personal', repeat: 'weekly', notificationFormat: 'Desktop notification'
        }) });
        if (meeting.status !== 201) throw new Error('Meeting setup failed');
        const analysis = await call('/api/journals/' + journal.id + '/analyze', { method: 'POST', body: JSON.stringify({ targetDate: '2030-01-01' }) });
        if (analysis.status !== 201 || !analysis.body.scheduleDrafts.length) throw new Error('Analysis failed');
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
        return { events: first.body.events.length, pageRendered: document.querySelector('main') !== null };
      })()`);
      if (!result.pageRendered) throw new Error("React did not render");
      console.log("Desktop smoke passed: recurring-event scheduling, stale-calendar rejection, SQLite, main/preload/renderer IPC, batch replay, isolation, and rendered UI.");
      app.quit();
    } catch (error) {
      console.error(`Desktop smoke failed: ${error.message}`);
      process.exitCode = 1;
      app.exit(1);
    }
  });
});
require(path.join(__dirname, "..", "electron", "main.cjs"));
