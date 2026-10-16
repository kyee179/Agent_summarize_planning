const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { calendarOccurrences } = require('../server/calendarView.cjs');
const { createApp } = require('../server/index.cjs');
const { createStore } = require('../server/store.cjs');
const token = 'synthetic-token-at-least-32-characters';

test('calendar expansion preserves editable series identity and includes later recurring and overnight occurrences', () => {
  const series = { id: 'weekly', title: 'Meeting', startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z', repeat: 'weekly', recurrenceTimezone: 'UTC' };
  const overnight = { id: 'overnight', title: 'Overnight', startsAt: '2030-01-07T23:00:00Z', endsAt: '2030-01-08T01:00:00Z' };
  const occurrences = calendarOccurrences([series, overnight], { from: '2030-01-08T00:00:00Z', to: '2030-01-09T00:00:00Z', timezone: 'UTC' });
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[1].id, 'weekly');
  assert.equal(occurrences[1].startsAt, '2030-01-08T09:00:00.000Z');
  assert.equal(occurrences[1].anchorStartsAt, series.startsAt);
  assert.notEqual(occurrences[0].occurrenceId, occurrences[1].occurrenceId);
  assert.throws(() => calendarOccurrences([series], { from: '2030-01-01T00:00:00Z', to: '2031-01-01T00:00:00Z', timezone: 'UTC' }), /validation/i);
});

test('calendar view conservatively displays both repeated DST clocks using scheduler rules', () => {
  const rows = calendarOccurrences([{ id: 'dst', startsAt: '2026-10-25T05:30:00Z', endsAt: '2026-10-25T06:00:00Z', repeat: 'weekly', recurrenceTimezone: 'America/New_York' }], { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z', timezone: 'America/New_York' });
  assert.deepEqual(rows.map(row => row.startsAt), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
});

test('expanded event query is authenticated, bounded, backward compatible, and includes the last displayed day', async t => {
  const store = createStore(':memory:');
  store.updateSettings({ timezone: 'UTC' });
  store.createEvent({ id: 'series', title: 'Synthetic series', startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z', repeat: 'weekly', recurrenceTimezone: 'UTC' });
  const server = createApp({ store, apiToken: token }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const route = '/api/events?expand=true&from=2030-01-08T00:00:00Z&to=2030-01-09T00:00:00Z';
  assert.equal((await fetch(base + route)).status, 401);
  const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 1); assert.equal(rows[0].startsAt, '2030-01-08T09:00:00.000Z');
  const legacy = await fetch(base + '/api/events', { headers: { Authorization: `Bearer ${token}` } }).then(result => result.json());
  assert.equal(legacy.find(item => item.id === 'series').startsAt, '2030-01-01T09:00:00Z'); assert.equal(legacy.find(item => item.id === 'series').occurrenceId, undefined);
  assert.equal((await fetch(base + '/api/events?expand=true', { headers: { Authorization: `Bearer ${token}` } })).status, 422);
});
