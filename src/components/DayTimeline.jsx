import { dayRange, occurrenceKey, timeLabel } from '../lib/dates.js';

function layout(items, start, end) {
  const sorted = items.map(item => ({ ...item, start: Math.max(start, Date.parse(item.startsAt)), end: Math.min(end, Date.parse(item.endsAt)) })).filter(x => x.end > x.start).sort((a, b) => a.start - b.start);
  let group = [], lanes = [], groupEnd = -Infinity;
  const finish = () => { group.forEach(item => { item.lanes = lanes.length; }); group = []; lanes = []; };
  for (const item of sorted) {
    if (item.start >= groupEnd) finish();
    let lane = lanes.findIndex(end => end <= item.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = item.end; item.lane = lane; group.push(item); groupEnd = Math.max(groupEnd, item.end);
  }
  finish();
  return sorted;
}

export function DayTimeline({ date, timezone, events = [], proposed = [], onSelect, selectedId }) {
  const range = dayRange(date, timezone), midnight = Date.parse(range.from), nextMidnight = Date.parse(range.to);
  const all = [...events, ...proposed];
  const first = all.length ? Math.min(...all.map(e => Math.max(midnight, Date.parse(e.startsAt)))) : midnight + 9 * 3600000;
  const last = all.length ? Math.max(...all.map(e => Math.min(nextMidnight, Date.parse(e.endsAt)))) : midnight + 18 * 3600000;
  const start = midnight + Math.floor((Math.max(midnight, first - 3600000) - midnight) / 3600000) * 3600000;
  const end = Math.min(nextMidnight, midnight + Math.ceil((Math.max(last + 3600000, start + 4 * 3600000) - midnight) / 3600000) * 3600000);
  const height = Math.max(320, (end - start) / 3600000 * 52);
  const ticks = []; for (let t = start; t < end; t += 3600000) ticks.push(t);
  const columns = [{ name: 'Current calendar', items: events }, { name: 'Proposed plan', items: proposed, draft: true }];
  return <div className="timeline" aria-label={`Calendar comparison for ${date}`}><div className="timeline-head"><span>{timezone}</span>{columns.map(column => <strong key={column.name}>{column.name}</strong>)}</div>
    <div className="timeline-grid" style={{ '--timeline-height': `${height}px` }}><div className="time-ruler">{ticks.map(t => <span key={t} style={{ top: `${(t - start) / (end - start) * 100}%` }}>{timeLabel(t, timezone)}</span>)}</div>
      {columns.map(column => <div className="timeline-lane" key={column.name} style={{ height }}>
        {ticks.map(t => <div className="hour-line" key={t} style={{ top: `${(t - start) / (end - start) * 100}%` }} />)}
        {layout(column.items, start, end).map(item => <button type="button" key={occurrenceKey(item)} className={`timeline-block ${column.draft ? 'proposed-block' : 'commitment-block'} ${selectedId === item.taskId ? 'selected-block' : ''}`} style={{ top: `${(item.start - start) / (end - start) * 100}%`, height: `${Math.max(18, (item.end - item.start) / (end - start) * height - 2)}px`, left: `calc(${item.lane / item.lanes * 100}% + 4px)`, width: `calc(${100 / item.lanes}% - 8px)` }} onClick={() => onSelect?.(item)} aria-label={`${item.title}, ${timeLabel(item.startsAt, timezone)} to ${timeLabel(item.endsAt, timezone)}, ${column.draft ? 'proposed' : item.readonly ? 'read only' : 'calendar event'}`}>
          <strong>{item.title}</strong><span>{timeLabel(item.startsAt, timezone)}–{timeLabel(item.endsAt, timezone)}</span><small>{column.draft ? 'Proposed' : item.readonly ? 'Read only' : item.repeat && item.repeat !== 'none' ? 'Repeating event' : 'Calendar event'}</small></button>)}
        {!column.items.length && <span className="empty-lane">{column.draft ? 'Proposed blocks appear here' : 'No calendar commitments'}</span>}
      </div>)}
    </div></div>;
}
