const { listCalendarOccurrences } = require('../server/calendarView.cjs');
const DAY = 86400000;
// Catch up due reminders from the last 24 hours. Receipts survive process/renderer restarts.
function createReminders({ store, notify, supported = () => true, clock = Date.now }) {
  function check() {
    if (!supported()) return;
    const now = clock(), timezone = store.getSettings().timezone;
    const items = listCalendarOccurrences(store, { from: new Date(now - DAY).toISOString(), to: new Date(now + 8 * DAY).toISOString(), timezone, includeGoogle: false });
    for (const item of items) {
      if (item.readonly || item.notificationFormat !== 'Desktop notification') continue;
      const due = Date.parse(item.startsAt) - Number(item.notifyMinutesBefore || 0) * 60000;
      const key = `${item.occurrenceId}:${due}`;
      if (due > now || due < now - DAY) continue;
      // One database claim prevents duplicates from multiple windows/processes.
      if (store.claimReminder(key, new Date(now).toISOString())) {
        try { notify({ title: item.title, body: new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.startsAt)), tag: key }); }
        catch { store.releaseReminder(key); }
      }
    }
  }
  let timer;
  return { check, start() { check(); timer = setInterval(() => { try { check(); } catch { console.warn('Reminder check will retry.'); } }, 15000); timer.unref(); }, stop() { clearInterval(timer); } };
}
module.exports = { createReminders };
