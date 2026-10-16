import { BookOpen, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import { sourceSummary } from '../components/AnalysisOptions.jsx';
import { dateLabel } from '../lib/dates.js';
import { useEffect, useState } from 'react';

export function JournalWorkspace({ workspace: w, onSelect, onNew, onDelete, onPrepare, onCustomize }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [historyOpen, setHistoryOpen] = useState(() => window.innerWidth > 1000);
  useEffect(() => { const resize = () => setHistoryOpen(window.innerWidth > 1000); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const filtered = w.journals.filter(entry => (filter === 'all' || filter === 'bookmarked' ? filter !== 'bookmarked' || entry.bookmarked : entry.type === filter) && `${entry.title} ${entry.content}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="journal-workspace"><details className="journal-library" open={historyOpen} onToggle={e => setHistoryOpen(e.currentTarget.open)}><summary className="journal-library-heading"><span>Your entries</span><span className="count-label">{w.journals.length}</span></summary>
    <label className="search-field"><Search size={16} /><span className="sr-only">Search journals</span><input placeholder="Search entries" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <label className="sr-only" htmlFor="journal-filter">Filter journals</label><select id="journal-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All entries</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="bookmarked">Bookmarked</option></select>
    <div className="journal-history">{filtered.map(entry => <button type="button" className={`journal-row ${entry.id === w.journal.id ? 'active' : ''}`} disabled={w.busy} key={entry.id} onClick={() => onSelect(entry)}>
      <span>{entry.bookmarked ? <Star size={15} fill="currentColor" /> : <BookOpen size={15} />}</span><span><strong>{entry.title}</strong><small>{dateLabel(entry.journalDate, { month: 'short' })} · {entry.type}</small></span></button>)}{!filtered.length && <p className="helper">{w.journals.length ? 'No matching entries.' : 'Your saved journals will appear here.'}</p>}</div>
    <button className="secondary-button" type="button" disabled={w.busy} onClick={onNew}>New journal</button>
  </details><form className="journal-editor" onSubmit={e => { e.preventDefault(); w.save(); }}>
    <header className="journal-heading"><div><p className="subtle-label">{w.journal.type === 'weekly' ? 'Weekly reflection' : 'Daily reflection'}</p><h2>{dateLabel(w.journal.journalDate, { weekday: 'long' })}</h2></div><button className={`icon-button ${w.journal.bookmarked ? 'starred' : ''}`} type="button" aria-label="Bookmark journal" aria-pressed={w.journal.bookmarked} disabled={w.busy} onClick={() => w.changeJournal({ bookmarked: !w.journal.bookmarked })}><Star size={19} fill={w.journal.bookmarked ? 'currentColor' : 'none'} /></button></header>
    <fieldset disabled={w.busy} className="editor-fields"><div className="field-grid"><label>Entry date<input type="date" required value={w.journal.journalDate} onChange={e => w.changeJournal({ journalDate: e.target.value })} /></label><label>Entry type<select value={w.journal.type} onChange={e => w.changeJournal({ type: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label></div>
      <label className="journal-title-label"><span className="sr-only">Journal title</span><input className="journal-title" placeholder="Give your day a title" required maxLength={300} value={w.journal.title} onChange={e => w.changeJournal({ title: e.target.value })} /></label>
      <label className="journal-content-label"><span className="sr-only">Journal text</span><textarea className="journal-textarea" placeholder="What happened today? What did you learn, and what would you like to make time for next?" required value={w.journal.content} onChange={e => w.changeJournal({ content: e.target.value })} /></label>
    </fieldset>
    <div className="journal-save-state"><span role="status">{w.dirty && w.journalState === 'Saved' ? 'Unsaved changes' : w.journalState}</span><span>{w.journal.content.trim() ? w.journal.content.trim().split(/\s+/).length : 0} words</span></div>
    <div className="journal-actions"><button type="button" className="text-button danger-text" disabled={!w.journal.id || w.busy} onClick={onDelete}><Trash2 size={15} />Delete entry</button><div><button className="secondary-button" type="submit" disabled={w.busy}>{w.phase === 'saving' ? 'Saving…' : 'Save journal'}</button><button className="primary-button" type="button" disabled={w.busy} onClick={onPrepare}><Sparkles size={16} />Prepare plan</button></div></div>
    <div className="journal-analysis-prompt"><div><strong>Turn reflection into a realistic next step.</strong><p>{sourceSummary(w.options)}</p></div><button className="text-button" type="button" disabled={w.busy} onClick={onCustomize}>Customize analysis</button></div>
  </form></div>;
}
