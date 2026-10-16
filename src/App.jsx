import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, CircleHelp, House, Link2, Plus, Settings2, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useWorkspace } from './app/useWorkspace.js';
import { CalendarWorkspace, EmptyState, EventList } from './features/CalendarWorkspace.jsx';
import { JournalWorkspace } from './features/JournalWorkspace.jsx';
import { PlanWorkspace } from './features/PlanWorkspace.jsx';
import { SettingsWorkspace } from './features/SettingsWorkspace.jsx';
import { IntegrationSettings } from './components/IntegrationSettings.jsx';
import { AnalysisOptions } from './components/AnalysisOptions.jsx';
import { ConfirmDialog } from './components/Dialog.jsx';
import { EventDrawer } from './components/EventDrawer.jsx';
import { calendarDate, dateLabel, eventsOnDay, occurrenceKey, timeLabel } from './lib/dates.js';

const destinations = [
  { id: 'today', label: 'Today', icon: House, description: 'A little clarity for the day ahead.' },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, description: 'See your commitments. Make room for what matters.' },
  { id: 'journal', label: 'Journal', icon: BookOpen, description: 'Capture your day, one thought at a time.' },
  { id: 'plan', label: 'Plan', icon: Sparkles, description: 'Turn reflection into a plan you can review.' },
  { id: 'connections', label: 'Connections', icon: Link2, description: 'Choose the context that helps you plan.' },
  { id: 'settings', label: 'Settings', icon: Settings2, description: 'A calendar that works around you.' }
];

export default function App() {
  const w = useWorkspace();
  const [mode, setMode] = useState('month'), [optionsOpen, setOptionsOpen] = useState(false);
  const [event, setEvent] = useState(null), [confirmation, setConfirmation] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const notified = useRef(new Set());
  const current = destinations.find(item => item.id === w.page);
  const todayEvents = eventsOnDay(w.nearbyEvents, w.today, w.settings.timezone);
  const todayJournal = w.journals.find(entry => entry.journalDate === w.today && entry.type === 'daily');

  useEffect(() => {
    if (w.loading) return;
    const timer = setInterval(w.reloadEvents, 60000);
    return () => clearInterval(timer);
  }, [w.loading, w.reloadEvents]);
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    w.nearbyEvents.forEach(item => {
      if (item.readonly || item.notificationFormat !== 'Desktop notification') return;
      const at = Date.parse(item.startsAt) - Number(item.notifyMinutesBefore || 0) * 60000;
      const key = `${occurrenceKey(item)}:${at}`;
      if (at <= w.now.getTime() && w.now.getTime() - at < 60000 && !notified.current.has(key)) {
        notified.current.add(key);
        new Notification(item.title, { body: `${timeLabel(item.startsAt, w.settings.timezone)}–${timeLabel(item.endsAt, w.settings.timezone)} (${w.settings.timezone})`, tag: key });
      }
    });
  }, [w.now, w.nearbyEvents]);

  function guard(action) {
    if (w.busy) return;
    if (w.dirty) setConfirmation({ title: 'Keep your journal changes?', message: 'This entry has unsaved changes. Save it before switching, or discard these changes to continue.', action, confirmLabel: 'Discard changes' });
    else action();
  }
  function selectJournal(entry) {
    if (entry.id === w.journal.id) { w.setPage('journal'); return; }
    guard(() => { w.selectJournal(entry); w.setPage('journal'); });
  }
  function writeToday() {
    if (todayJournal) selectJournal(todayJournal);
    else if (!w.journal.id && w.journal.journalDate === w.today) w.setPage('journal');
    else guard(w.newJournal);
  }
  function newEvent(day = w.selectedDate) { setEvent({ date: day }); }
  async function prepare() { const saved = await w.save(); if (saved) w.setPage('plan'); }
  function changedCalendar() { w.invalidate(); return w.reloadEvents(); }
  async function confirmAction() {
    setConfirmBusy(true);
    try { await confirmation.action(); setConfirmation(null); }
    finally { setConfirmBusy(false); }
  }

  return <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar"><div className="brand"><span className="brand-icon"><CalendarDays size={23} /></span><div><strong>Calendar</strong><span>A little more intentional.</span></div></div>
      <nav className="primary-nav" aria-label="Main navigation">{destinations.slice(0, 4).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={w.page === id ? 'page' : undefined} onClick={() => w.setPage(id)}><Icon size={19} /><span>{label}</span>{id === 'plan' && w.phase === 'ready' && <span className="nav-indicator" aria-label="Plan ready for review" />}</button>)}</nav>
      <div className="sidebar-note"><span className="subtle-label">Your space to reflect</span><p>Start with your day.<br />Make time for what comes next.</p><button className="text-button" type="button" onClick={writeToday}>Write a journal<ArrowRight size={14} /></button></div>
      <nav className="secondary-nav" aria-label="Workspace preferences">{destinations.slice(4).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={w.page === id ? 'page' : undefined} onClick={() => w.setPage(id)}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><span>{w.settings.timezone}</span><small>Calendar App 2.0</small></div>
    </aside>
    <main className="workspace" id="workspace"><header className="page-header"><div><p className="page-context">Your workspace <ChevronRight size={12} /> {current.label}</p><h1>{current.label}</h1><p>{current.description}</p></div><div className="header-actions">{['today', 'calendar'].includes(w.page) && <button className="primary-button" type="button" onClick={() => newEvent(w.page === 'today' ? w.today : w.selectedDate)}><Plus size={17} />Add event</button>}{w.page === 'journal' && <button className="secondary-button" type="button" disabled={w.busy} onClick={() => guard(w.newJournal)}><Plus size={17} />New entry</button>}</div></header>
      {w.notice && <div className={`workspace-notice ${w.notice.tone}`} role={w.notice.tone === 'error' ? 'alert' : 'status'}><span>{w.notice.tone === 'error' ? <CircleHelp size={17} /> : <Check size={17} />}{w.notice.message}</span><button className="icon-button" type="button" aria-label="Dismiss message" onClick={() => w.setNotice(null)}><X size={16} /></button></div>}
      {w.loading ? <div className="workspace-loading" role="status"><span className="loading-ring" />Loading your workspace…</div> : w.loadingError ? <EmptyState title="Your workspace couldn’t load" action={<button className="primary-button" type="button" onClick={w.load}>Try again</button>}>{w.loadingError}</EmptyState> : <>
        {w.page === 'today' && <><section className="today-heading"><div><p className="subtle-label">{dateLabel(w.today, { weekday: 'long', month: undefined, day: undefined })}</p><h2>{dateLabel(w.today)}</h2><p>{todayEvents.length ? `${todayEvents.length} calendar ${todayEvents.length === 1 ? 'commitment' : 'commitments'} today. Your time, in one place.` : 'There is room to shape your day.'}</p></div><span className="today-date-mark">{calendarDate(w.today).getDate()}</span></section>
          <div className="today-layout"><section className="today-agenda"><div className="section-heading"><h2>On your calendar</h2><button className="text-button" type="button" onClick={() => { w.setActiveMonth(calendarDate(w.today)); w.setSelectedDate(w.today); w.setPage('calendar'); }}>Full calendar<ArrowRight size={14} /></button></div>{todayEvents.length ? <EventList events={todayEvents} timezone={w.settings.timezone} onEdit={item => setEvent({ record: item })} /> : <EmptyState title="Your day has some breathing room" action={<button className="secondary-button" type="button" onClick={() => newEvent(w.today)}>Add an event</button>}>Add a commitment, or start with a reflection.</EmptyState>}<p className="helper">Times in {w.settings.timezone}. Google busy time is read only.</p></section>
          <aside className="today-reflection"><span className="reflection-icon"><BookOpen size={24} /></span><p className="subtle-label">A moment for reflection</p><h2>What would you like<br />to carry forward?</h2><p>Capture what happened, what you learned, and the work that still needs your attention.</p><button className="primary-button" type="button" disabled={w.busy} onClick={writeToday}>{todayJournal ? 'Open today’s journal' : 'Write today’s journal'}<ArrowRight size={16} /></button><div className="reflection-divider" /><button className="reflection-link" type="button" onClick={() => w.setPage('plan')}><span className="setting-icon"><Sparkles size={17} /></span><span><strong>{w.phase === 'ready' ? 'Your plan is ready to review' : 'Make a plan from your journal'}</strong><small>Choose the context. Review every change.</small></span><ChevronRight size={16} /></button></aside></div>
        </>}
        {w.page === 'calendar' && <CalendarWorkspace workspace={w} mode={mode} setMode={setMode} onAdd={newEvent} onEdit={item => setEvent({ record: item })} />}
        {w.page === 'journal' && <JournalWorkspace workspace={w} onSelect={selectJournal} onNew={() => guard(w.newJournal)} onPrepare={prepare} onCustomize={() => setOptionsOpen(true)} onDelete={() => setConfirmation({ title: 'Delete this journal?', message: 'This removes the journal and its saved analysis. Applied calendar events are kept.', confirmLabel: 'Delete journal', action: w.removeJournal })} />}
        {w.page === 'plan' && <PlanWorkspace workspace={w} onCustomize={() => setOptionsOpen(true)} onJournal={() => w.setPage('journal')} onEvent={item => setEvent({ record: item })} onSelectJournal={entry => guard(() => w.selectJournal(entry))} />}
        <div hidden={w.page !== 'connections'}><IntegrationSettings settings={w.settings} targetDate={w.options.targetDate} onCalendarChanged={changedCalendar} onStatusChanged={w.setConnections} onCustomize={() => setOptionsOpen(true)} /></div>
        <div hidden={w.page !== 'settings'}><SettingsWorkspace settings={w.settings} onSave={w.updateSettings} /></div>
      </>}
      <footer className="workspace-footer"><span>Reflect. Make room. Move forward.</span><button className="text-button" type="button" onClick={() => setOptionsOpen(true)} disabled={w.loading || w.busy}><SlidersHorizontal size={14} />Customize analysis</button></footer>
    </main>
    {optionsOpen && <AnalysisOptions options={w.options} onChange={w.setOptions} status={w.connections} settings={w.settings} onClose={() => setOptionsOpen(false)} onConnections={() => { setOptionsOpen(false); w.setPage('connections'); }} />}
    {event && <EventDrawer entry={event} settings={w.settings} onClose={() => setEvent(null)} onSaved={async () => { setEvent(null); w.invalidate(); await w.reloadEvents(); w.notify('Calendar updated.'); }} />}
    {confirmation && <ConfirmDialog {...confirmation} onConfirm={confirmAction} onClose={() => setConfirmation(null)} busy={confirmBusy} />}
  </div>;
}
