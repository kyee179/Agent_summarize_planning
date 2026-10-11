const { ContractError } = require("./validate.cjs");
function localParts(instant, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, clock: `${values.hour}:${values.minute}` };
}
function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
// Convert wall-clock availability to an instant. Reject gaps/ambiguous clocks at DST transitions.
function wallClockInstant(date, clock, timezone) {
  if (clock === "24:00") { date = nextDate(date); clock = "00:00"; }
  const wanted = Date.parse(`${date}T${clock}:00Z`);
  let guess = wanted;
  for (let i = 0; i < 4; i++) {
    const parts = localParts(guess, timezone);
    guess += wanted - Date.parse(`${parts.date}T${parts.clock}:00Z`);
  }
  const candidates = new Set();
  // Include half-hour DST transitions as well as common hour transitions.
  for (let offset = -180; offset <= 180; offset += 30) {
    const candidate = guess + offset * 60000, parts = localParts(candidate, timezone);
    if (parts.date === date && parts.clock === clock) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new ContractError([{ path: "/plan/availability", code: "timezone", message: "Availability hits an ambiguous or nonexistent local time; choose another clock time" }]);
  return new Date([...candidates][0]).toISOString();
}
module.exports = { localParts, nextDate, wallClockInstant };
