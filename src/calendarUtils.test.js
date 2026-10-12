import { describe, expect, it } from "vitest";
import { buildMonthDays, eventToReminderLine, getEventsForDay } from "./calendarUtils.js";

describe("calendar utilities", () => {
  it("builds a complete month grid", () => {
    const days = buildMonthDays(new Date("2026-07-08T12:00:00"));
    expect(days.length).toBeGreaterThanOrEqual(35);
    expect(days[0].getDay()).toBe(0);
  });

  it("selects events by day", () => {
    const events = [
      { id: "1", startsAt: "2026-07-08T09:00:00.000Z", endsAt: "2026-07-08T10:00:00.000Z" },
      { id: "2", startsAt: "2026-07-09T09:00:00.000Z", endsAt: "2026-07-09T10:00:00.000Z" }
    ];
    expect(getEventsForDay(events, new Date("2026-07-08T13:00:00.000Z"))).toHaveLength(1);
  });

  it("renders the requested reminder format", () => {
    const line = eventToReminderLine({
      title: "Read React docs",
      startsAt: "2026-07-08T09:00:00.000Z",
      endsAt: "2026-07-08T10:00:00.000Z",
      notificationFormat: "Desktop notification"
    });
    expect(line).toContain("time:");
    expect(line).toContain("Read React docs");
    expect(line).toContain("Desktop notification");
  });
  it('shows imported multi-day busy time on every overlapping local day, excluding its end date', () => {
    const day = new Date('2026-07-08T12:00:00');
    const events = [{ id: 'google', readonly: true, startsAt: new Date('2026-07-07T00:00:00').toISOString(), endsAt: new Date('2026-07-09T00:00:00').toISOString() }];
    expect(getEventsForDay(events, day)).toHaveLength(1);
    expect(getEventsForDay(events, new Date('2026-07-09T12:00:00'))).toHaveLength(0);
  });
});
