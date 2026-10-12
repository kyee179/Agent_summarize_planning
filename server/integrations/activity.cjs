const { json, range, hash, error } = require('./common.cjs');
const { isInstant } = require('../contracts/validate.cjs');
const ENDPOINT = 'http://127.0.0.1:5600/api/0';
function overlap(a, b) { return a[0] < b[1] && b[0] < a[1]; }
function normalize(buckets, streams, selectedRange) {
  const start = Date.parse(selectedRange.from), end = Date.parse(selectedRange.to);
  const active = [], observed = [], windows = [];
  for (const bucket of buckets) {
    const events = streams[bucket.id];
    if (!Array.isArray(events)) throw error('Invalid ActivityWatch response', 502);
    for (const event of events) {
      if (!isInstant(event.timestamp) || typeof event.duration !== 'number' || !Number.isFinite(event.duration) || event.duration < 0) throw error('Invalid ActivityWatch interval; no partial import was saved', 502);
      const a = Math.max(start, Date.parse(event.timestamp));
      const b = Math.min(end, Date.parse(event.timestamp) + Number(event.duration) * 1000);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw error('Invalid ActivityWatch interval', 502);
      if (b <= a) continue;
      if (bucket.type === 'afkstatus') { if (event.data?.status === 'not-afk') active.push([a, b]); continue; }
      let label;
      if (bucket.type === 'currentwindow') label = String(event.data?.app || 'Unknown app').slice(0, 100);
      else if (bucket.type === 'web.tab.current') {
        try { const url = new URL(event.data?.url); if (!['https:', 'http:'].includes(url.protocol)) continue; label = url.hostname.slice(0, 200); }
        catch { continue; }
      } else continue;
      const item = { bucketId: bucket.id, kind: bucket.type === 'currentwindow' ? 'app' : 'domain', label, a, b };
      if (item.kind === 'app') windows.push(item); else observed.push(item);
    }
  }
  if (!buckets.some((bucket) => bucket.type === 'afkstatus')) throw error('Select an AFK bucket to exclude idle periods');
  // Sweep interval boundaries to avoid double counting overlapping heartbeats and app/browser streams.
  const all = [...windows, ...observed];
  const boundaries = [...new Set([...all.flatMap((x) => [x.a, x.b]), ...active.flat()])].sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const slot = [boundaries[i], boundaries[i + 1]];
    if (!active.some((a) => overlap(a, slot))) continue;
    // Browser domain takes precedence; app and domain time is not added together.
    const candidates = all.filter((x) => overlap([x.a, x.b], slot)).sort((a, b) =>
      (a.kind === 'domain' ? 0 : 1) - (b.kind === 'domain' ? 0 : 1) || a.bucketId.localeCompare(b.bucketId) || a.label.localeCompare(b.label));
    const item = candidates[0]; if (!item) continue;
    const last = segments.at(-1);
    if (last && last.label === item.label && last.bucketId === item.bucketId && last.b === slot[0]) last.b = slot[1];
    else segments.push({ ...item, a: slot[0], b: slot[1] });
  }
  if (segments.length > 1000) throw error('Too much activity; import a shorter range');
  return segments.map(({ a, b, ...item }) => {
    const startsAt = new Date(a).toISOString(), endsAt = new Date(b).toISOString();
    return { id: `aw:${hash([item.bucketId, startsAt, endsAt, item.label]).slice(0, 40)}`, ...item, startsAt, endsAt,
      excerpt: `Observed ${item.kind} ${item.label} while not AFK from ${startsAt} to ${endsAt} (${Math.round((b - a) / 1000)} seconds). This does not prove productive work or completion.` };
  });
}
function createActivity(store, { fetchImpl, clock = () => new Date().toISOString() } = {}) {
  let generation = 0, importing = false;
  async function buckets() {
    const data = await json(`${ENDPOINT}/buckets/`, {}, { fetchImpl });
    return Object.entries(data).filter(([, b]) => ['afkstatus', 'currentwindow', 'web.tab.current'].includes(b.type))
      .map(([id, b]) => ({ id, type: b.type, name: String(b.name || id).slice(0, 200) }));
  }
  return { buckets,
    purge() { generation++; store.purgeActivity(); },
    async ingest(input) {
      if (input.consent !== true) throw error('Activity import requires explicit consent');
      if (importing) throw error('Activity import is already running', 409);
      const selectedRange = range(input, 7);
      const now = clock();
      if (Date.parse(selectedRange.from) < Date.parse(now) - 30 * 86400000 || Date.parse(selectedRange.to) > Date.parse(now) + 60000) throw error('Import activity from the last 30 days');
      if (!Array.isArray(input.bucketIds) || !input.bucketIds.length || input.bucketIds.length > 4 || new Set(input.bucketIds).size !== input.bucketIds.length || input.bucketIds.some((id) => typeof id !== 'string' || id.length > 200)) throw error('Select 1–4 buckets');
      const current = generation; importing = true;
      try {
      const selected = (await buckets()).filter((bucket) => input.bucketIds.includes(bucket.id));
      if (selected.length !== input.bucketIds.length || selected.filter((b) => b.type === 'afkstatus').length !== 1) throw error('Select existing buckets and exactly one matching AFK bucket');
      if (selected.some((b) => b.type === 'web.tab.current') && input.includeDomains !== true) throw error('Browser domains require separate consent');
      const streams = {};
      for (const bucket of selected) {
        // Request one extra result to detect truncation; never persist a partial snapshot.
        const params = new URLSearchParams({ start: selectedRange.from, end: selectedRange.to, limit: '2001' });
        const events = await json(`${ENDPOINT}/buckets/${encodeURIComponent(bucket.id)}/events?${params}`, {}, { fetchImpl });
        if (!Array.isArray(events) || events.length > 2000) throw error('Activity limit exceeded; import a shorter range');
        streams[bucket.id] = events;
      }
      const records = normalize(selected, streams, selectedRange);
      if (current !== generation) throw error('Activity import was cancelled by removal', 409);
      return store.replaceActivity(records, { consent: true, bucketIds: input.bucketIds, includeDomains: input.includeDomains === true }, selectedRange, now);
      } finally { importing = false; }
    },
    evidence(selectedRange) {
      if (!store.integrationState('activity')?.consent) return [];
      const cutoff = Date.parse(clock()) - 30 * 86400000;
      return store.listActivity(selectedRange).filter((item) => Date.parse(item.endsAt) >= cutoff).slice(0, 20).map((item) => ({
        id: item.id, sourceType: 'activity', sourceId: item.id, sourceVersion: hash(item), locator: null,
        excerpt: item.excerpt, observedAt: clock(), sourceTimestamp: item.startsAt, verification: 'source_matched', facts: []
      }));
    }
  };
}
module.exports = { normalize, createActivity };
