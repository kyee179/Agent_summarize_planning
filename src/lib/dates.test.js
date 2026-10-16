import { describe, it, expect } from 'vitest';
import { dateKey, dayRange, eventsOnDay, googleReadiness, wallTimeToISO } from './dates.js';
describe('named timezone presentation', () => {
  it('uses the selected timezone across date boundaries and local input conversion', () => {
    expect(dateKey('2030-01-01T18:00:00Z', 'Asia/Shanghai')).toBe('2030-01-02');
    expect(wallTimeToISO('2030-01-02T09:00', 'Asia/Shanghai')).toBe('2030-01-02T01:00:00.000Z');
    expect(eventsOnDay([{ startsAt: '2030-01-01T15:00:00Z', endsAt: '2030-01-01T18:00:00Z' }], '2030-01-02', 'Asia/Shanghai')).toHaveLength(1);
  });
  it('rejects nonexistent and ambiguous editor clocks and preserves 23-hour days', () => {
    expect(() => wallTimeToISO('2026-03-08T02:30', 'America/New_York')).toThrow(/clock change/);
    expect(() => wallTimeToISO('2026-11-01T01:30', 'America/New_York')).toThrow(/clock change/);
    const range = dayRange('2026-03-08', 'America/New_York');
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(23 * 3600000);
  });
  it('distinguishes a connected Google account from fresh target-day coverage', () => {
    const status = { google: { connected: true, sync: { calendarIds: ['primary'], syncedAt: new Date().toISOString(), from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' } } };
    expect(googleReadiness(status, '2030-01-01', 'UTC').ready).toBe(false);
    status.google.sync.from = '2029-12-31T23:45:00Z'; status.google.sync.to = '2030-01-02T00:15:00Z';
    expect(googleReadiness(status, '2030-01-01', 'UTC').ready).toBe(true);
    status.google.sync.syncedAt = new Date(Date.now() - 31 * 60000).toISOString();
    expect(googleReadiness(status, '2030-01-01', 'UTC').ready).toBe(false);
  });
});
