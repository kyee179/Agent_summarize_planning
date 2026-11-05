const formatters = new Map();
export const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function zonedParts(value = new Date(), timezone = deviceTimezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }));
  const p = Object.fromEntries(formatters.get(timezone).formatToParts(new Date(value)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export function dateKey(value, timezone = deviceTimezone) { return zonedParts(value, timezone).date; }
export function shiftDate(key, count) { return new Date(Date.parse(`${key}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
export function calendarDate(key) { return new Date(`${key}T12:00:00`); }
export function inputTime(instant, timezone) { const p = zonedParts(instant, timezone); return `${p.date}T${p.time.slice(0, 5)}`; }

// Match named-zone clocks, rejecting DST gaps/repeated clocks instead of silently moving an event.
export function wallTimeToISO(input, timezone = deviceTimezone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error('Choose a valid date and time.');
  const wanted = Date.parse(`${input}:00Z`);
  if (!Number.isFinite(wanted)) throw new Error('Choose a valid date and time.');
  let guess = wanted;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(guess, timezone);
    guess += wanted - Date.parse(`${p.date}T${p.time}Z`);
  }
  const candidates = new Set();
  for (let offset = -180; offset <= 180; offset += 30) {
    const candidate = guess + offset * 60000;
    if (inputTime(candidate, timezone) === input) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error('This time is skipped or repeated by a clock change. Choose a different time.');
  return new Date([...candidates][0]).toISOString();
}

export function dayRange(key, timezone = deviceTimezone) {
  return { from: wallTimeToISO(`${key}T00:00`, timezone), to: wallTimeToISO(`${shiftDate(key, 1)}T00:00`, timezone) };
}
export function timeLabel(instant, timezone) { return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant)); }
export function dateLabel(key, options = {}) {
  if (!key || !Number.isFinite(calendarDate(key).getTime())) return 'Choose a date';
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', ...options }).format(calendarDate(key));
}
export function eventsOnDay(events, key, timezone) {
  const { from, to } = dayRange(key, timezone);
  return events.filter(e => Date.parse(e.startsAt) < Date.parse(to) && Date.parse(e.endsAt) > Date.parse(from));
}
export function occurrenceKey(event) { return event.occurrenceId || `${event.id}:${event.startsAt}`; }

export function googleReadiness(status, targetDate, timezone) {
  const google = status?.google;
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return { ready: false, label: 'Choose a planning date' };
  if (!google?.connected) return { ready: true, label: google?.pending ? 'Connecting in browser' : 'Local calendar' };
  const sync = google.sync;
  const range = dayRange(targetDate, timezone);
  const ready = sync?.calendarIds?.length > 0 && Date.parse(sync.syncedAt) >= Date.now() - 30 * 60000 &&
    Date.parse(sync.from) <= Date.parse(range.from) - 15 * 60000 && Date.parse(sync.to) >= Date.parse(range.to) + 15 * 60000;
  return { ready, label: ready ? 'Google Calendar is ready for this day' : 'Refresh Google Calendar for this day' };
}
