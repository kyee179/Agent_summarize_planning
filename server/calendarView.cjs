const { expandEvents } = require('./eventOccurrences.cjs');
const { ContractError, isInstant } = require('./contracts/validate.cjs');

// The display uses the scheduler's recurrence implementation, including conservative DST reservations.
function calendarOccurrences(events, { from, to, timezone }) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!isInstant(from) || !isInstant(to) || end <= start || end - start > 62 * 86400000) {
    throw new ContractError([{ path: '/events/range', code: 'range', message: 'Choose an event range of up to 62 days, with an exclusive end.' }]);
  }
  const anchors = new Map(events.map(event => [event.id, event]));
  return expandEvents(events, { from: start, to: end, timezone }).map(item => {
    const anchor = anchors.get(item.eventId);
    return { ...anchor, occurrenceId: `${anchor.id}@${item.start}`, anchorStartsAt: anchor.startsAt,
      anchorEndsAt: anchor.endsAt, startsAt: new Date(item.start).toISOString(), endsAt: new Date(item.end).toISOString() };
  });
}
function listCalendarOccurrences(store, options) {
  calendarOccurrences([], options); // Validate before issuing a bounded storage query.
  const events = store.listPlanningEvents(options).filter(event => options.includeGoogle || !event.readonly);
  return calendarOccurrences(events, options);
}
module.exports = { calendarOccurrences, listCalendarOccurrences };
