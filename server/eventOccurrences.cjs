const { ContractError, isInstant, isTimezone, isCalendarDate } = require("./contracts/validate.cjs");
const { localParts, wallClockCandidates } = require("./contracts/time.cjs");
const DAY = 86400000;
const repeats = new Set(["none", "daily", "weekly", "monthly", "yearly"]);
const dateNumber = (date) => Date.parse(`${date}T00:00:00Z`);
function invalid(message) { return new ContractError([{ path: "/events", code: "calendar", message }]); }

// Expand only the bounded range, using the source's original calendar day as the anchor.
// Month-end and leap-day instances that do not exist are skipped, not moved.
function expandEvents(events, { from, to, timezone }) {
  if (!Array.isArray(events) || events.length > 10000) throw invalid("Planning supports at most 10000 candidate events");
  const occurrences = [];
  let candidates = 0;
  function add(event, start, duration) {
    const end = start + duration;
    if (start < to && end > from) occurrences.push({ eventId: event.id, start, end });
  }
  for (const event of events) {
    if (typeof event.id !== "string" || !isInstant(event.startsAt) || !isInstant(event.endsAt)) throw invalid("An existing event has invalid identity or timestamps; correct it before planning");
    const baseStart = Date.parse(event.startsAt), duration = Date.parse(event.endsAt) - baseStart;
    const repeat = event.repeat ?? "none";
    if (duration <= 0 || !repeats.has(repeat)) throw invalid("An existing event has invalid duration or repeat frequency");
    if (repeat === "none") { add(event, baseStart, duration); continue; }
    if (baseStart >= to) continue;
    if (duration > 366 * DAY) throw invalid("Recurring events longer than 366 days need correction before planning");
    const zone = event.recurrenceTimezone || timezone;
    if (!isTimezone(zone)) throw invalid("An existing recurring event has an invalid timezone");
    const anchor = localParts(baseStart, zone);
    const [year, month, day] = anchor.date.split("-").map(Number);
    const clock = `${anchor.clock}:${anchor.second}.${String(((baseStart % 1000) + 1000) % 1000).padStart(3, "0")}`;
    // Two calendar days of margin account for timezone transitions and UTC/local boundaries.
    const lowerDate = localParts(from - duration - 2 * DAY, zone).date;
    const upperDate = localParts(to + 2 * DAY, zone).date;
    const lower = dateNumber(lowerDate), upper = dateNumber(upperDate);
    const anchorDay = dateNumber(anchor.date);
    const dates = [];
    if (repeat === "daily" || repeat === "weekly") {
      const step = repeat === "daily" ? DAY : 7 * DAY;
      const first = Math.max(0, Math.floor((lower - anchorDay) / step));
      const last = Math.floor((upper - anchorDay) / step);
      for (let i = first; i <= last; i++) dates.push(new Date(anchorDay + i * step).toISOString().slice(0, 10));
    } else {
      const [lowerYear, lowerMonth] = lowerDate.split("-").map(Number);
      const [upperYear, upperMonth] = upperDate.split("-").map(Number);
      const first = repeat === "monthly" ? Math.max(year * 12 + month - 1, lowerYear * 12 + lowerMonth - 1) : Math.max(year, lowerYear);
      const last = repeat === "monthly" ? upperYear * 12 + upperMonth - 1 : upperYear;
      for (let i = first; i <= last; i++) {
        const candidateYear = repeat === "monthly" ? Math.floor(i / 12) : i;
        const candidateMonth = repeat === "monthly" ? i % 12 + 1 : month;
        const date = `${String(candidateYear).padStart(4, "0")}-${String(candidateMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (isCalendarDate(date)) dates.push(date);
      }
    }
    for (const date of dates) {
      if (++candidates > 4096) throw invalid("Recurring expansion exceeded 4096 candidates; narrow or simplify the calendar");
      // The original occurrence has an explicit offset; do not invent its other DST offset.
      const starts = date === anchor.date ? [baseStart] : wallClockCandidates(date, clock, zone);
      // Nonexistent clocks are skipped. Both ambiguous offsets are busy, conservatively.
      for (const start of starts) if (start >= baseStart) add(event, start, duration);
    }
  }
  return occurrences.sort((a, b) => a.start - b.start || a.end - b.end || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
}
module.exports = { expandEvents };
