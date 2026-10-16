import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, ChevronRight, Globe, Monitor, NotebookPen, Pause, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { ResearchSources } from './ResearchSources.jsx';
import { Dialog, ConfirmDialog } from './Dialog.jsx';
import { dateKey, dayRange, deviceTimezone, googleReadiness, shiftDate } from '../lib/dates.js';

function localInput(value) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function Selection({ items, selected, setSelected, label }) {
  return <fieldset><legend>{label}</legend>{items.map(item => <label className="check-row" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />{item.name} {item.type && <small>({item.type})</small>}</label>)}</fieldset>;
}

export function IntegrationSettings({ onCalendarChanged, onStatusChanged, onCustomize, settings = {}, targetDate }) {
  const poll = useRef(null), mounted = useRef(false), running = useRef(false), callbacks = useRef({ onCalendarChanged, onStatusChanged });
  callbacks.current = { onCalendarChanged, onStatusChanged };
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [authorization, setAuthorization] = useState(null), [help, setHelp] = useState(null), [noteOpen, setNoteOpen] = useState(false), [deleteNote, setDeleteNote] = useState(null);
  const [notes, setNotes] = useState([]), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [buckets, setBuckets] = useState([]), [bucketIds, setBucketIds] = useState([]), [domains, setDomains] = useState(false), [activityConsent, setActivityConsent] = useState(false);
  const [calendars, setCalendars] = useState([]), [calendarIds, setCalendarIds] = useState([]), [googleConsent, setGoogleConsent] = useState(false);
  const [from, setFrom] = useState(localInput(new Date().setHours(0, 0, 0, 0))), [to, setTo] = useState(localInput(new Date()));
  const [indexConsent, setIndexConsent] = useState(false), [semantic, setSemantic] = useState(false), [memoryQuery, setMemoryQuery] = useState(''), [memoryResult, setMemoryResult] = useState(null);
  const [researchQuery, setResearchQuery] = useState(''), [researchConsent, setResearchConsent] = useState(false), [researchResult, setResearchResult] = useState(null);
  const timezone = settings.timezone || deviceTimezone, planningDate = targetDate || dateKey(new Date(), timezone);
  const provider = status?.research?.provider || 'Tavily';
  const readiness = googleReadiness(status, planningDate, timezone);
  const googlePending = status?.google?.pending || Boolean(authorization) || status?.google?.lastOAuth === 'exchanging';

  async function refresh() {
    const [next, documents] = await Promise.all([api.integrationStatus(), api.memoryNotes()]);
    if (mounted.current) { setStatus(next); setNotes(documents); callbacks.current.onStatusChanged?.(next); }
    return next;
  }
  async function run(action, changesContext = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(''); setMessage('');
    try { const result = await action(); await refresh(); if (changesContext) await callbacks.current.onCalendarChanged?.(); if (mounted.current) setMessage(typeof result === 'string' ? result : 'Done.'); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function startPolling() {
    clearInterval(poll.current);
    let polling = false;
    poll.current = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const current = await api.integrationStatus();
        if (!mounted.current) return;
        setStatus(current); callbacks.current.onStatusChanged?.(current);
        if (current.google.connected && !current.google.pending && current.google.lastOAuth === 'connected') {
          if (running.current) return;
          clearInterval(poll.current); poll.current = null; setAuthorization(null);
          await run(async () => { await api.quickGoogleSync(); return 'Google Calendar connected. Your primary calendar is reserved for today and the next seven days.'; }, true);
        } else if (!current.google.pending && ['failed', 'expired', 'cancelled'].includes(current.google.lastOAuth)) {
          clearInterval(poll.current); poll.current = null; setAuthorization(null); setError('Google authorization ended. Connect Google Calendar to try again.');
        }
      } catch (failure) { clearInterval(poll.current); poll.current = null; if (mounted.current) setError(failure.message); }
      finally { polling = false; }
    }, 1500);
  }
  useEffect(() => {
    mounted.current = true;
    refresh().then(next => { if (mounted.current && next.google?.pending) startPolling(); }).catch(failure => { if (mounted.current) setError(failure.message); });
    return () => { mounted.current = false; clearInterval(poll.current); };
  }, []);
  async function connectGoogle() {
    const pending = await api.connectGoogle();
    setAuthorization(pending); setStatus(current => ({ ...current, google: { ...current?.google, pending: true } }));
    startPolling();
    try { await api.openGoogleConsent(pending.authorizationUrl); }
    catch { return 'Complete Google sign-in using the link below. The browser could not open automatically.'; }
    return 'Complete Google sign-in in your system browser. This page will update automatically.';
  }
  async function refreshGoogle() {
    const ids = status?.google?.sync?.calendarIds;
    if (ids?.length) {
      const start = dayRange(planningDate, timezone).from, end = dayRange(shiftDate(planningDate, 8), timezone).from;
      await api.syncGoogle({ consent: true, calendarIds: ids, from: new Date(Date.parse(start) - 15 * 60000).toISOString(), to: new Date(Date.parse(end) + 15 * 60000).toISOString() });
    } else await api.quickGoogleSync();
    return 'Calendar refreshed. Your selected commitments are reserved for planning.';
  }
  const selectedRange = () => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });

  return <section className="connections-workspace" aria-label="Sources and connections">
    <div className="connections-intro"><div><span className="badge"><Check size={12} />You choose what to share</span><h2>A little context. A more useful plan.</h2><p>Connect once, then choose what each analysis may use. Your optional AI sources start off.</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => run(refresh)}><RefreshCw size={15} />Refresh status</button></div>
    {error && <p className="inline-status error" role="alert">{error}</p>}{message && <p className="inline-status" role="status">{message}</p>}
    <div className="connection-grid">
      <article className="connection-card"><span className="connection-icon"><CalendarDays size={24} /></span><h3>Google Calendar</h3><p>Keep your plan clear of existing appointments. Busy times are read only.</p><span className={`connection-state ${status?.google?.connected ? 'is-connected' : ''}`}>{!status ? 'Checking connection…' : googlePending ? 'Connecting in your browser' : status.google?.connected ? readiness.label : status.google?.configured ? 'Not connected' : 'Setup needed'}</span>
        {!status?.google?.configured && status ? <button className="secondary-button" type="button" aria-label="Setup help for Google Calendar" onClick={() => setHelp('Google Calendar')}>Setup help</button> : <button className={status?.google?.connected ? 'secondary-button' : 'primary-button'} type="button" disabled={busy || !status || googlePending} onClick={() => run(status?.google?.connected ? refreshGoogle : connectGoogle, Boolean(status?.google?.connected))}>{googlePending ? 'Connecting…' : status?.google?.connected ? 'Refresh calendar' : 'Connect Google Calendar'}</button>}
        {authorization && <a className="text-button" href={authorization.authorizationUrl} target="_blank" rel="noreferrer">Continue Google sign-in<ArrowUpRight size={14} /></a>}
      </article>
      <article className="connection-card"><span className="connection-icon"><Monitor size={24} /></span><h3>App activity</h3><p>Record approximate time in apps. App names stay local until you include them in an analysis.</p><span className={`connection-state ${status?.desktopActivity?.running ? 'is-connected' : ''}`}>{status?.desktopActivity?.running ? 'Recording app names locally' : 'Recording off'}{status?.desktopActivity?.sampleState === 'idle' && ' · Idle periods excluded'}</span>
        {status && !status.desktopActivity?.available ? <button className="secondary-button" type="button" onClick={() => setHelp('App activity')}>Learn more</button> : <button className="secondary-button" type="button" disabled={busy || !status} onClick={() => run(async () => { if (status.desktopActivity.running) { await api.stopDesktopActivity(); return 'Recording paused. Your saved activity is kept.'; } await api.startDesktopActivity(); return 'Desktop activity enabled for this app session. Recording stops when this app closes.'; })}>{status?.desktopActivity?.running ? <><Pause size={15} />Pause recording</> : 'Start recording'}</button>}
      </article>
      <article className="connection-card"><span className="connection-icon"><NotebookPen size={24} /></span><h3>Goals and notes</h3><p>Add goals, project context, or lessons you want available to future planning.</p><span className="connection-state">{notes.length} saved {notes.length === 1 ? 'note' : 'notes'}</span><button className="secondary-button" type="button" disabled={busy} onClick={() => setNoteOpen(true)}><Plus size={15} />Add a note</button></article>
      <article className="connection-card"><span className="connection-icon"><Globe size={24} /></span><h3>Web search</h3><p>Find supporting information online when you permit it for an analysis.</p><span className={`connection-state ${status?.research?.configured ? 'is-connected' : ''}`}>{status?.research?.configured ? 'Ready when you need it' : 'Setup needed'}</span><button className="secondary-button" type="button" disabled={busy || !status} onClick={() => status?.research?.configured && onCustomize ? onCustomize() : setHelp('Web search')}>{status?.research?.configured && onCustomize ? 'Customize analysis' : 'Setup help'}</button></article>
    </div>
    <section className="saved-notes"><div className="section-heading"><div><h2>Your saved context</h2><p className="muted">Notes are available when you permit past journals and notes.</p></div><button className="secondary-button" type="button" disabled={busy || !status} onClick={() => run(async () => { const result = await api.indexMemory(false); return `${result.chunks} text sections are ready for local search. Choose whether an analysis may use them in Customize analysis.`; })}>Prepare past journals</button></div><p className="helper">Prepare a local search index to find relevant entries. Preparation sends no journal text to an AI service. Prepare again after journal edits.</p>{notes.length ? notes.map(note => <div className="saved-note" key={note.id}><NotebookPen size={17} /><div><strong>{note.title}</strong><p>{note.content}</p></div><button className="text-button danger-text" type="button" disabled={busy} onClick={() => setDeleteNote(note)}>Delete</button></div>) : <p className="helper">A goal or a short project note is a good place to start.</p>}</section>
    <details className="advanced-section"><summary>Manage connections and saved data</summary>
      <section className="management-section"><h3>Google Calendar</h3><p className="helper">{status?.google?.sync?.syncedAt ? `Last refreshed ${new Date(status.google.sync.syncedAt).toLocaleString()}. Refresh is required after 30 minutes or when coverage does not include your planning day.` : 'Connect your calendar to reserve busy times.'}</p>
        {googlePending && <button className="secondary-button" type="button" disabled={busy} onClick={() => run(async () => { clearInterval(poll.current); await api.cancelGoogle(); setAuthorization(null); return 'Sign-in cancelled.'; })}>Cancel sign-in</button>}
        <button className="secondary-button" type="button" disabled={busy || !status?.google?.connected} onClick={() => run(async () => { setCalendars(await api.googleCalendars()); return 'Choose the calendars you want planning to avoid.'; })}>Choose calendars</button>
        {calendars.length > 0 && <><Selection items={calendars} selected={calendarIds} setSelected={setCalendarIds} label="Calendars to reserve" /><label className="check-row"><input type="checkbox" checked={googleConsent} onChange={e => setGoogleConsent(e.target.checked)} />Allow read-only import of these calendars</label><button className="secondary-button" type="button" disabled={busy || !googleConsent || !calendarIds.length} onClick={() => run(async () => { const start = dayRange(planningDate, timezone).from, end = dayRange(shiftDate(planningDate, 8), timezone).from; await api.syncGoogle({ consent: true, calendarIds, from: new Date(Date.parse(start) - 900000).toISOString(), to: new Date(Date.parse(end) + 900000).toISOString() }); return 'Selected calendars refreshed.'; }, true)}>Save calendar selection</button></>}
        <button className="text-button danger-text" type="button" disabled={busy || !status?.google?.connected} onClick={() => setHelp('Disconnect Google Calendar')}>Disconnect Google Calendar</button></section>
      <section className="management-section"><h3>Recorded activity</h3><p className="helper">The built-in recorder saves app names, excludes idle periods, and stops when the app closes. It records no window titles, addresses, or keystrokes. Records expire after 30 days. Removing records keeps applied calendar events and backups.</p><button className="danger-button" type="button" disabled={busy} onClick={() => setHelp('Delete recorded activity')}>Delete recorded activity</button></section>
    </details>
    <details className="advanced-section"><summary>Advanced tools</summary>
      <details className="management-section"><summary>Prepare and search past entries</summary><p className="helper">Make past journals and notes searchable locally. Optional semantic search needs a locally installed Ollama model; keyword search works without it.</p><label className="check-row"><input type="checkbox" checked={indexConsent} onChange={e => setIndexConsent(e.target.checked)} />Index my journals and notes on this computer</label><label className="check-row"><input type="checkbox" checked={semantic} onChange={e => setSemantic(e.target.checked)} />Also use local Ollama embeddings</label><button className="secondary-button" type="button" disabled={busy || !indexConsent} onClick={() => run(async () => { const result = await api.indexMemory(semantic); return `${result.chunks} text sections prepared in ${result.mode} mode. ${result.warning || ''}`; })}>Make past entries searchable</button><p className="helper">{status?.memory?.chunks || 0} text sections indexed. Rebuild after journal edits; stale sections are excluded.</p><label>Search past journals and notes<input value={memoryQuery} maxLength={400} onChange={e => setMemoryQuery(e.target.value)} /></label><button className="secondary-button" type="button" disabled={busy || !memoryQuery.trim()} onClick={() => run(async () => { setMemoryResult(await api.searchMemory(memoryQuery)); return 'Search complete.'; })}>Search saved context</button>{memoryResult && <section><p className="helper">{memoryResult.mode} retrieval. {memoryResult.warning}</p>{memoryResult.items.map(item => <blockquote key={item.id}><strong>{item.title}</strong><p>{item.content}</p></blockquote>)}{!memoryResult.items.length && <p>No matches. Add notes or prepare past entries.</p>}</section>}</details>
      <details className="management-section"><summary>Search the web manually</summary><p className="helper">Results contain links and snippets with low confidence until the page is verified.</p><label>Research query<input maxLength={400} value={researchQuery} onChange={e => setResearchQuery(e.target.value)} /></label><label className="check-row"><input type="checkbox" checked={researchConsent} onChange={e => setResearchConsent(e.target.checked)} />Send this query to {provider}</label><button className="secondary-button" type="button" disabled={busy || !researchConsent || !researchQuery.trim() || !status?.research?.configured} onClick={() => run(async () => { const result = await api.research(researchQuery); setResearchResult(result); return `${result.results.length} sources found.${result.usage?.credits != null ? ` Reported search credits: ${result.usage.credits}.` : ''}`; })}>Research with citations</button><ResearchSources results={researchResult?.results} /></details>
      <details className="management-section"><summary>Import ActivityWatch history</summary><p className="helper">For existing ActivityWatch users. Its local server must be running. Choose buckets from one device with exactly one AFK bucket. Titles and full URLs are removed. Ranges use your computer’s timezone.</p><div className="field-grid"><label>Import from<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Import until<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label></div><button className="secondary-button" type="button" disabled={busy} onClick={() => run(async () => { setBuckets(await api.activityBuckets()); return 'Choose activity buckets.'; })}>Find local buckets</button><Selection items={buckets} selected={bucketIds} setSelected={setBucketIds} label="Activity buckets" /><label className="check-row"><input type="checkbox" checked={domains} onChange={e => setDomains(e.target.checked)} />Include browser domain names</label><label className="check-row"><input type="checkbox" checked={activityConsent} onChange={e => setActivityConsent(e.target.checked)} />Import this activity and retain it for up to 30 days</label><button className="secondary-button" type="button" disabled={busy || !activityConsent || !bucketIds.length} onClick={() => run(async () => { const result = await api.importActivity({ ...selectedRange(), bucketIds, includeDomains: domains, consent: true }); return `Imported ${result.imported} activity intervals. Observation does not prove completion.`; })}>Import activity</button></details>
      <details className="management-section"><summary>App owner setup</summary><p className="helper">Google requires a Desktop OAuth client configured by the app owner. Web research requires a configured search key. Credentials belong only in the app’s private local configuration. Semantic search requires Ollama with {status?.memory?.model || 'nomic-embed-text'}. Ask the app owner for setup help.</p></details>
    </details>
    <div className="connection-explainer"><span className="setting-icon"><Check size={17} /></span><p>Connecting and recording are separate from AI permission. Choose optional sources in <button className="text-button" type="button" disabled={!onCustomize} onClick={onCustomize}>Customize analysis<ChevronRight size={13} /></button>.</p></div>
    {noteOpen && <Dialog title="Add a note" busy={busy} onClose={() => setNoteOpen(false)}><form onSubmit={e => { e.preventDefault(); run(async () => { await api.saveMemory({ title, content }); setTitle(''); setContent(''); setNoteOpen(false); return 'Note saved and ready for keyword search.'; }); }}><div className="dialog-body"><label>Note title<input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Note text<textarea required rows={6} maxLength={12000} value={content} onChange={e => setContent(e.target.value)} /></label>{error && <p role="alert" className="form-error">{error}</p>}</div><footer className="dialog-actions"><button className="primary-button" disabled={busy || !title.trim() || !content.trim()} type="submit">{busy ? 'Saving…' : 'Save note'}</button></footer></form></Dialog>}
    {deleteNote && <ConfirmDialog title="Delete this note?" message="This also invalidates saved analyses that cite the note. Applied events are kept." confirmLabel="Delete note" busy={busy} onClose={() => setDeleteNote(null)} onConfirm={() => run(async () => { await api.deleteMemory(deleteNote.id); setDeleteNote(null); return 'Note deleted.'; }, true)} />}
    {help && (help.startsWith('Disconnect') || help.startsWith('Delete')) ? <ConfirmDialog title={`${help}?`} message={help.startsWith('Disconnect') ? 'The local Google connection and imported busy times will be removed. Your Google account events are kept.' : 'This stops recording and removes imported activity. Applied calendar events and backups are kept.'} confirmLabel={help.startsWith('Disconnect') ? 'Disconnect' : 'Delete recorded activity'} busy={busy} onClose={() => setHelp(null)} onConfirm={() => run(async () => { if (help.startsWith('Disconnect')) { clearInterval(poll.current); await api.disconnectGoogle(); setAuthorization(null); } else { await api.purgeActivity(); setActivityConsent(false); } setHelp(null); return 'Your choice was saved.'; }, true)} /> : help && <Dialog title={help === 'App activity' ? 'About app activity' : `${help} setup`} onClose={() => setHelp(null)}><div className="dialog-body"><p>{help === 'App activity' ? 'The built-in app recorder is available on Windows. It records app names only while this app is running. On other platforms, an existing ActivityWatch installation can be used through Advanced tools.' : `The app owner needs to configure ${help === 'Google Calendar' ? 'Google sign-in' : 'the web search service'} before this feature is available. You do not need to enter credentials into the journal.`}</p></div><footer className="dialog-actions"><button className="primary-button" type="button" onClick={() => setHelp(null)}>Got it</button></footer></Dialog>}
  </section>;
}
