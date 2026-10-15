import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { ResearchSources } from './ResearchSources.jsx';

function localTime(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function Selection({ items, selected, setSelected, label }) {
  return <fieldset><legend>{label}</legend>{items.map((item) => <label className="consent-row" key={item.id}>
    <input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
    {item.name} {item.type && <small>({item.type})</small>}
  </label>)}</fieldset>;
}
export function IntegrationSettings({ onCalendarChanged, researchEnabled = false, onResearchToggle }) {
  const googlePoll = useRef(null);
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [buckets, setBuckets] = useState([]), [bucketIds, setBucketIds] = useState([]), [domains, setDomains] = useState(false), [activityConsent, setActivityConsent] = useState(false);
  const [calendars, setCalendars] = useState([]), [calendarIds, setCalendarIds] = useState([]), [googleConsent, setGoogleConsent] = useState(false), [authorization, setAuthorization] = useState(null);
  const [from, setFrom] = useState(localTime(new Date().setHours(0, 0, 0, 0))), [to, setTo] = useState(localTime(new Date()));
  const [notes, setNotes] = useState([]), [title, setTitle] = useState(''), [content, setContent] = useState(''), [indexConsent, setIndexConsent] = useState(false), [semantic, setSemantic] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState(''), [memoryResult, setMemoryResult] = useState(null);
  const [researchQuery, setResearchQuery] = useState(''), [researchConsent, setResearchConsent] = useState(false), [researchResult, setResearchResult] = useState(null);
  const researchProvider = status?.research?.provider || 'Tavily';
  async function refresh() {
    const [newStatus, newNotes] = await Promise.all([api.integrationStatus(), api.memoryNotes()]);
    setStatus(newStatus); setNotes(newNotes);
    await onCalendarChanged?.();
  }
  useEffect(() => { let active = true;
    Promise.all([api.integrationStatus(), api.memoryNotes()]).then(([s, n]) => { if (active) { setStatus(s); setNotes(n); } }).catch((e) => { if (active) setMessage(e.message); });
    return () => { active = false; clearInterval(googlePoll.current); };
  }, []);
  async function run(action) {
    setBusy(true); setMessage('');
    try { const report = await action(); await refresh(); setMessage(typeof report === 'string' ? report : 'Done.'); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  async function connectGoogle() {
    const pending = await api.connectGoogle(); setAuthorization(pending);
    await api.openGoogleConsent(pending.authorizationUrl);
    clearInterval(googlePoll.current);
    let polling = false;
    googlePoll.current = setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const current = await api.integrationStatus(); setStatus(current);
        if (current.google.connected && !current.google.pending && current.google.lastOAuth === 'connected') {
          clearInterval(googlePoll.current); googlePoll.current = null; setAuthorization(null);
          try { await api.quickGoogleSync(); await refresh(); setMessage('Google Calendar connected. Your primary calendar is reserved for today and the next seven days.'); }
          catch (e) { setMessage('Google connected. ' + e.message); }
        } else if (!current.google.pending && ['failed', 'expired', 'cancelled'].includes(current.google.lastOAuth)) {
          clearInterval(googlePoll.current); googlePoll.current = null; setAuthorization(null);
          setMessage('Google authorization ended. Press Connect Google Calendar to try again.');
        }
      } catch (e) { clearInterval(googlePoll.current); googlePoll.current = null; setMessage(e.message); }
      finally { polling = false; }
    }, 1500);
    return 'Complete Google sign-in in your system browser. Connection and primary-calendar sync will finish here automatically.';
  }
  const selectedRange = () => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  return <section className="integration-settings" aria-label="Sources and connections">
    <h2>Sources and connections</h2>
    <p>Configure sources here, then choose what each analysis may use. Imported activity stays local unless you include it in an AI analysis. Removing source data leaves already applied calendar events and backups intact.</p>
    <button type="button" disabled={busy} onClick={() => run(refresh)}>Refresh connection status</button>
    <p role="status" aria-live="polite">{message}</p>
    <div className="field-grid"><label>Import / sync from<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>Import / sync to<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
    <small>Range times use your computer’s timezone. Activity: up to 7 days from the last 30 days. Calendar: up to 31 days; include the full planning date plus 15 minutes before and after for scheduling buffers.</small>
    <div className="connection-buttons" aria-label="Optional connections">
      <section><h3>Google Calendar</h3>
        <p>Read-only busy times from your primary calendar. Sign in through your browser; no Google password is stored here.</p>
        <button type="button" disabled={busy || !status?.google?.configured || status?.google?.connected || status?.google?.pending}
          onClick={() => { setGoogleConsent(true); run(connectGoogle); }}>Connect Google Calendar</button>
        <button type="button" disabled={busy || !status?.google?.connected} onClick={() => run(async () => { await api.quickGoogleSync(); return 'Primary calendar refreshed for today and the next seven days.'; })}>Refresh Google Calendar</button>
        <button type="button" disabled={busy || !status?.google?.connected} onClick={() => run(async () => { clearInterval(googlePoll.current); await api.disconnectGoogle(); setAuthorization(null); return 'Google disconnected and busy times removed.'; })}>Turn off Google Calendar</button>
        {!status?.google?.configured && <p>The app owner must configure Google OAuth once before customers can sign in.</p>}
      </section>
      <section><h3>Desktop activity</h3>
        <p>Optional Windows tracking records foreground app names and approximate active intervals locally. It excludes window titles, website addresses and keystrokes. Recording stops when this app closes. You choose separately whether an analysis can use it.</p>
        <button type="button" disabled={busy || !status?.desktopActivity?.available || status?.desktopActivity?.running} onClick={() => run(async () => { await api.startDesktopActivity(); return 'Desktop activity enabled for this app session. No separate download is needed.'; })}>Enable desktop activity</button>
        <button type="button" disabled={busy || !status?.desktopActivity?.running} onClick={() => run(async () => { await api.stopDesktopActivity(); return 'Desktop activity paused. Existing local observations are retained.'; })}>Pause desktop activity</button>
        <button type="button" disabled={busy} onClick={() => run(async () => { await api.purgeActivity(); return 'Activity tracking stopped and imported observations removed.'; })}>Delete activity data</button>
        <p>{status?.desktopActivity?.running ? 'Recording app names locally' : 'Recording off'} · {status?.desktopActivity?.lastError || '30-day retention'}{status?.desktopActivity?.sampleState === 'idle' && ' · Idle periods are excluded'}</p>
      </section>
      <section><h3>Web research</h3><p>{researchProvider} supplies links and snippets only when you enable web research for an analysis or approve a manual query below.</p>
        {onResearchToggle && <button type="button" role="switch" aria-checked={researchEnabled} disabled={!status?.research?.configured} onClick={onResearchToggle}>{researchEnabled ? 'Turn off web research' : 'Enable web research for analysis'}</button>}
        <a href="https://app.tavily.com/" target="_blank" rel="noreferrer">Set up Tavily account</a>
        <p>{status?.research?.configured ? 'Web research ready; use the analysis source switch to turn it on.' : 'The app owner must add a Tavily API key before live search can run.'}</p>
      </section>
    </div>
    <details><summary>Advanced ActivityWatch import</summary>
      <p>For browser domains or an existing ActivityWatch history, install and start ActivityWatch locally (port 5600). The built-in option above needs no ActivityWatch download. A browser extension alone still needs a local ActivityWatch server. Select buckets from the same device, including exactly one AFK bucket. Only app names and optionally browser domains are imported. Window titles and full URLs are removed.</p>
      <a href="https://activitywatch.net/downloads/" target="_blank" rel="noreferrer">ActivityWatch downloads</a>
      <button type="button" disabled={busy} onClick={() => run(async () => { setBuckets(await api.activityBuckets()); return 'Select buckets to import.'; })}>Find local buckets</button>
      <Selection label="Activity buckets" items={buckets} selected={bucketIds} setSelected={setBucketIds} />
      <label className="consent-row"><input type="checkbox" checked={domains} onChange={(e) => setDomains(e.target.checked)} />Allow browser domain names</label>
      <label className="consent-row"><input type="checkbox" checked={activityConsent} onChange={(e) => setActivityConsent(e.target.checked)} />Import selected activity for this range; retain for up to 30 days</label>
      <button type="button" disabled={busy || !activityConsent || !bucketIds.length} onClick={() => run(async () => { const result = await api.importActivity({ ...selectedRange(), bucketIds, includeDomains: domains, consent: true }); return `Imported ${result.imported} non-overlapping activity intervals. Observation does not prove completion.`; })}>Import activity</button>
      <button type="button" disabled={busy} onClick={() => run(async () => { await api.purgeActivity(); setActivityConsent(false); return 'Imported activity removed and consent cleared.'; })}>Remove imported activity</button>
      <p>Last import: {status?.activity?.lastImportedAt || 'None'}</p>
    </details>
    <details><summary>Google Calendar — read only</summary>
      <p>Create a Google Cloud OAuth client of type Desktop app, enable Calendar API, and add your account as a test user. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the local .env, run pnpm setup:env, then restart. Tokens are encrypted locally.</p>
      <p>{status?.google?.configured ? 'OAuth configured' : 'Credentials needed'} · {status?.google?.pending ? 'Connecting' : status?.google?.connected ? 'Connected' : 'Disconnected'} {status?.google?.lastOAuth && `· ${status.google.lastOAuth}`}</p>
      <label className="consent-row"><input type="checkbox" checked={googleConsent} onChange={(e) => setGoogleConsent(e.target.checked)} />Allow read-only Calendar access and import selected calendars as busy time</label>
      <button type="button" disabled={busy || !googleConsent || !status?.google?.configured} onClick={() => run(async () => { return connectGoogle(); })}>Connect selected calendars with Google</button>
      {authorization && <p><a href={authorization.authorizationUrl} target="_blank" rel="noreferrer">Open Google consent in browser</a> · Expires {authorization.expiresAt}</p>}
      <button type="button" disabled={busy} onClick={() => run(async () => { clearInterval(googlePoll.current); await api.cancelGoogle(); setAuthorization(null); return 'Pending authorization cancelled.'; })}>Cancel authorization</button>
      <button type="button" disabled={busy || !status?.google?.connected} onClick={() => run(async () => { setCalendars(await api.googleCalendars()); return 'Select calendars to sync.'; })}>Load calendars</button>
      <Selection label="Calendars to reserve" items={calendars} selected={calendarIds} setSelected={setCalendarIds} />
      <button type="button" disabled={busy || !googleConsent || !calendarIds.length} onClick={() => run(async () => { const result = await api.syncGoogle({ ...selectedRange(), calendarIds, consent: true }); return `Reserved ${result.imported} Google busy events. Sync expires after 30 minutes; refresh before planning or Apply.`; })}>Sync busy times</button>
      <button type="button" disabled={busy || !status?.google?.connected} onClick={() => run(async () => { const result = await api.disconnectGoogle(); setAuthorization(null); setCalendars([]); setCalendarIds([]); return result.warning || 'Google disconnected; imported busy times removed.'; })}>Disconnect Google</button>
      <p>Last sync: {status?.google?.sync?.syncedAt || 'None'}. Google events reserve scheduling capacity; no Google event writes are performed.</p>
    </details>
    <details><summary>Personal memory</summary>
      <p>Add goals, project scope, or measured effort as notes. Indexing includes your local journals. For semantic search, install Ollama and run: <code>ollama pull {status?.memory?.model || 'nomic-embed-text'}</code>. Embeddings stay on localhost.</p>
      <label>Memory title<input maxLength="300" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Memory text<textarea rows="4" maxLength="12000" value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <button type="button" disabled={busy || !title.trim() || !content.trim()} onClick={() => run(async () => { await api.saveMemory({ title, content }); setTitle(''); setContent(''); return 'Memory saved and keyword indexed.'; })}>Save memory note</button>
      {notes.map((note) => <p key={note.id}>{note.title} <button type="button" disabled={busy} onClick={() => run(async () => { await api.deleteMemory(note.id); return 'Memory note removed.'; })}>Delete note</button></p>)}
      <label className="consent-row"><input type="checkbox" checked={indexConsent} onChange={(e) => setIndexConsent(e.target.checked)} />Index my journals and memory notes locally</label>
      <label className="consent-row"><input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} />Also create local Ollama embeddings</label>
      <button type="button" disabled={busy || !indexConsent} onClick={() => run(async () => { const r = await api.indexMemory(semantic); return `${r.chunks} chunks indexed; ${r.embedded} embedded; ${r.mode} mode. ${r.warning || ''}`; })}>Rebuild memory index</button>
      <p>{status?.memory?.chunks || 0} current chunks · {status?.memory?.embedded || 0} embedded. Reindex after journal edits; stale chunks are excluded.</p>
      <label>Search personal memory<input maxLength="400" value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)} /></label>
      <button type="button" disabled={busy || !memoryQuery.trim()} onClick={() => run(async () => { setMemoryResult(await api.searchMemory(memoryQuery)); return 'Memory search complete.'; })}>Search local memory</button>
      {memoryResult && <section><p>Retrieval mode: {memoryResult.mode}. {memoryResult.warning} Relevance scores are ranking scores.</p>{memoryResult.items.map((item) => <blockquote key={item.id}><strong>{item.title}</strong><p>{item.content}</p><small>{item.sourceType} · {item.sourceId} · relevance {item.relevance}</small></blockquote>)}{!memoryResult.items.length && <p>No matches. Add notes or rebuild the index.</p>}</section>}
    </details>
    <details><summary>Web research</summary>
      <p>Add TAVILY_API_KEY to the ignored local configuration and restart. {status?.research?.configured ? 'Search configured.' : 'Search key needed.'} Results contain public source links, snippets, and low confidence until the page is verified.</p>
      <label>Research query<input maxLength="400" value={researchQuery} onChange={(e) => setResearchQuery(e.target.value)} /></label>
      <label className="consent-row"><input type="checkbox" checked={researchConsent} onChange={(e) => setResearchConsent(e.target.checked)} />Send this query to {researchProvider}</label>
      <button type="button" disabled={busy || !researchConsent || !researchQuery.trim() || !status?.research?.configured} onClick={() => run(async () => { const r = await api.research(researchQuery); setResearchResult(r); return `${r.results.length} sources found.${r.usage?.credits !== null && r.usage?.credits !== undefined ? ` Provider reported ${r.usage.credits} credits.` : ''}`; })}>Research with citations</button>
      <ResearchSources results={researchResult?.results} />
    </details>
  </section>;
}
