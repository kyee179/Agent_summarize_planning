import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek
} from "date-fns";

export function buildMonthDays(activeDate, weekStartsOn = 0) {
  const monthStart = startOfMonth(activeDate);
  const monthEnd = endOfMonth(activeDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });
  const days = [];
  let current = gridStart;

  while (current <= gridEnd) {
    days.push(current);
    current = addDays(current, 1);
  }

  return days;
}

export function getMonthRange(activeDate, weekStartsOn = 0) {
  const days = buildMonthDays(activeDate, weekStartsOn);
  return {
    from: days[0].toISOString(),
    to: days[days.length - 1].toISOString()
  };
}

export function shiftMonth(activeDate, amount) {
  return addMonths(activeDate, amount);
}

export function formatTimeRange(event) {
  const start = parseISO(event.startsAt);
  const end = parseISO(event.endsAt);
  return `${format(start, "p")} to ${format(end, "p")}`;
}

export function getEventsForDay(events, day) {
  return events.filter((event) => isSameDay(parseISO(event.startsAt), day));
}

export function getDayState(day, activeDate) {
  return {
    isCurrentMonth: isSameMonth(day, activeDate),
    isToday: isToday(day)
  };
}

export function toLocalInputValue(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 16);
}

export function fromDateAndTime(date, time) {
  return new Date(`${date}T${time || "09:00"}`).toISOString();
}

export function eventToReminderLine(event) {
  return `time: ${formatTimeRange(event)}; ${event.title}; ${event.notificationFormat}`;
}
