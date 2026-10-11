const { ContractError } = require("./validate.cjs");
const formatters = new Map();
function localParts(instant, timezone) {
  if (!formatters.has(timezone)) {
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  }
  const values = Object.fromEntries(formatters.get(timezone).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, clock: `${values.hour}:${values.minute}`, second: values.second };
}
function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
// Convert wall-clock availability to an instant. Reject gaps/ambiguous clocks at DST transitions.
function wallClockCandidates(date, clock, timezone) {
  if (clock === "24:00") { date = nextDate(date); clock = "00:00"; }
  const fullClock = clock.length === 5 ? `${clock}:00` : clock;
  const wanted = Date.parse(`${date}T${fullClock}Z`);
  const milliseconds = ((wanted % 1000) + 1000) % 1000;
  const matches = (parts) => parts.date === date && `${parts.clock}:${parts.second}` === fullClock.slice(0, 8);
  let guess = wanted;
  for (let i = 0; i < 4; i++) {
    const parts = localParts(guess, timezone);
    guess += wanted - (Date.parse(`${parts.date}T${parts.clock}:${parts.second}Z`) + milliseconds);
  }
  const candidates = new Set();
  // Include half-hour DST transitions as well as common hour transitions.
  for (let offset = -180; offset <= 180; offset += 30) {
    const candidate = guess + offset * 60000, parts = localParts(candidate, timezone);
    if (matches(parts)) candidates.add(candidate);
  }
  return [...candidates].sort((a, b) => a - b);
}
function wallClockInstant(date, clock, timezone) {
  const candidates = wallClockCandidates(date, clock, timezone);
  if (candidates.length !== 1) throw new ContractError([{ path: "/plan/availability", code: "timezone", message: "Availability hits an ambiguous or nonexistent local time; choose another clock time" }]);
  return new Date(candidates[0]).toISOString();
}
module.exports = { localParts, nextDate, wallClockInstant, wallClockCandidates };
