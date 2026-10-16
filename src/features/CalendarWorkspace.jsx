import { format, addMonths } from 'date-fns';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, LockKeyhole, Plus, RefreshCw, Repeat2 } from 'lucide-react';
import { calendarDate, dateKey, dateLabel, eventsOnDay, occurrenceKey, timeLabel } from '../lib/dates.js';

export function EmptyState({ icon: Icon = CalendarDays, title, children, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function EventList({ events, timezone, onEdit }) {
  return <div className="event-list">{events.map(event => <button className="event-row" type="button" key={occurrenceKey(event)} onClick={() => onEdit(event)}>
    <span className="event-color" style={{ background: event.color || '#7c8799' }} /><span className="event-copy"><strong>{event.title}</strong><small>{timeLabel(event.startsAt, timezone)}–{timeLabel(event.endsAt, timezone)}{event.readonly ? ' · Google Calendar, read only' : event.repeat !== 'none' && event.repeat ? ' · Repeats' : ''}</small></span>{event.readonly ? <LockKeyhole size={14} /> : event.repeat && event.repeat !== 'none' ? <Repeat2 size={14} /> : <ArrowUpRight size={14} />}</button>)}</div>;
}

export function CalendarWorkspace({ workspace: w, mode, setMode, onAdd, onEdit }) {
  const selected = eventsOnDay(w.events, w.selectedDate, w.settings.timezone);
  const monthEvents = w.events.filter(e => dateKey(e.startsAt, w.settings.timezone).slice(0, 7) === format(w.activeMonth, 'yyyy-MM'));
  const grouped = [...new Set(w.days.map(day => dateKey(day)))].map(key => ({ key, events: eventsOnDay(w.events, key, w.settings.timezone) })).filter(x => x.events.length);
  return <><div className="workspace-toolbar"><div className="month-controls"><button type="button" className="icon-button" aria-label="Previous month" onClick={() => w.setActiveMonth(addMonths(w.activeMonth, -1))}><ChevronLeft size={18} /></button><h2>{format(w.activeMonth, 'MMMM yyyy')}</h2><button type="button" className="icon-button" aria-label="Next month" onClick={() => w.setActiveMonth(addMonths(w.activeMonth, 1))}><ChevronRight size={18} /></button></div>
    <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="Refresh calendar" disabled={w.eventLoading} onClick={w.reloadEvents}><RefreshCw size={16} /></button><button className="secondary-button" type="button" onClick={() => { w.setActiveMonth(calendarDate(w.today)); w.setSelectedDate(w.today); }}>Today</button><div className="segmented" role="group" aria-label="Calendar view">{['month', 'agenda'].map(view => <button type="button" key={view} aria-pressed={mode === view} onClick={() => setMode(view)}>{view === 'month' ? 'Month' : 'Agenda'}</button>)}</div></div></div>
    {w.eventLoading && <p role="status" className="helper">Refreshing calendar…</p>}
    <div className="calendar-layout"><section className="calendar-surface" aria-label={mode === 'month' ? 'Month calendar' : 'Agenda'}>
      {mode === 'month' ? <div className="month-grid">{w.days.slice(0, 7).map(day => <div className="weekday" key={dateKey(day)}>{format(day, 'EEE')}</div>)}
        {w.days.map(day => {
          const key = dateKey(day), items = eventsOnDay(w.events, key, w.settings.timezone);
          return <button type="button" key={key} className={`day-cell ${day.getMonth() !== w.activeMonth.getMonth() ? 'outside-month' : ''} ${key === w.today ? 'is-today' : ''} ${key === w.selectedDate ? 'is-selected' : ''}`} aria-label={`${dateLabel(key, { weekday: 'long' })}, ${items.length} events`} aria-pressed={key === w.selectedDate} onClick={() => w.setSelectedDate(key)} onDoubleClick={() => onAdd(key)}>
            <span className="day-number">{day.getDate()}</span><span className="day-events">{items.slice(0, 3).map(event => <span className={`month-event ${event.readonly ? 'read-only-event' : ''}`} key={occurrenceKey(event)} style={{ '--event-color': event.color || '#7c8799' }}>{!event.readonly && <span>{timeLabel(event.startsAt, w.settings.timezone)}</span>}{event.title}</span>)}{items.length > 3 && <span className="more-events">+{items.length - 3} more</span>}</span>
          </button>;
        })}</div> : grouped.length ? <div className="agenda-groups">{grouped.map(group => <section key={group.key}><h3>{dateLabel(group.key, { weekday: 'short' })}</h3><EventList events={group.events} timezone={w.settings.timezone} onEdit={onEdit} /></section>)}</div> : <EmptyState title="A little room in your calendar" action={<button className="secondary-button" onClick={() => onAdd(w.selectedDate)}>Add an event</button>}>There are no events in this date range.</EmptyState>}
      <div className="calendar-caption"><span><span className="legend-dot" />Local events</span><span><LockKeyhole size={12} />Google busy time</span><span>{monthEvents.length} starts this month</span></div>
    </section><aside className="day-inspector"><div className="section-heading"><div><p className="subtle-label">Selected day</p><h2>{dateLabel(w.selectedDate, { weekday: 'short' })}</h2></div><button className="icon-button" type="button" aria-label="Add event on selected day" onClick={() => onAdd(w.selectedDate)}><Plus size={18} /></button></div>{selected.length ? <EventList events={selected} timezone={w.settings.timezone} onEdit={onEdit} /> : <div className="quiet-empty"><Clock3 size={22} /><p>No commitments for this day.</p><button className="text-button" onClick={() => onAdd(w.selectedDate)}>Add an event</button></div>}<p className="helper">{w.settings.timezone}</p></aside></div>
  </>;
}
