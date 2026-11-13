import { t, useLocale, messageText } from '../i18n/index.js';
import { BookOpen, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import { sourceSummary } from '../components/AnalysisOptions.jsx';
import { dateLabel } from '../lib/dates.js';
import { textCount } from '../lib/text.js';
import { useEffect, useState } from 'react';

export function JournalWorkspace({ workspace: w, onSelect, onNew, onDelete, onPrepare, onCustomize }) {
  useLocale();
  const [composing,setComposing]=useState(false);
  const count=textCount(w.journal.content);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [historyOpen, setHistoryOpen] = useState(() => window.innerWidth > 1000);
  useEffect(() => { const resize = () => setHistoryOpen(window.innerWidth > 1000); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const filtered = w.journals.filter(entry => (filter === 'all' || filter === 'bookmarked' ? filter !== 'bookmarked' || entry.bookmarked : entry.type === filter) && `${entry.title} ${entry.content}`.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase()));
  return <div className="journal-workspace"><details className="journal-library" open={historyOpen} onToggle={e => setHistoryOpen(e.currentTarget.open)}><summary className="journal-library-heading"><span>{t("Your entries")}</span><span className="count-label">{w.journals.length}</span></summary>
    <label className="search-field"><Search size={16} /><span className="sr-only">{t("Search journals")}</span><input placeholder={t("Search entries")} value={query} onChange={e => setQuery(e.target.value)} /></label>
    <label className="sr-only" htmlFor="journal-filter">{t("Filter journals")}</label><select id="journal-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t("All entries")}</option><option value="daily">{t("Daily")}</option><option value="weekly">{t("Weekly")}</option><option value="bookmarked">{t("Bookmarked")}</option></select>
    <div className="journal-history">{filtered.map(entry => <button type="button" className={`journal-row ${entry.id === w.journal.id ? 'active' : ''}`} disabled={w.busy} key={entry.id} onClick={() => onSelect(entry)}>
      <span>{entry.bookmarked ? <Star size={15} fill="currentColor" /> : <BookOpen size={15} />}</span><span><strong>{entry.title}</strong><small>{dateLabel(entry.journalDate, { month: 'short' })} · {t(entry.type)}</small></span></button>)}{!filtered.length && <p className="helper">{w.journals.length ? t("No matching entries.") : t("Your saved journals will appear here.")}</p>}</div>
    <button className="secondary-button" type="button" disabled={w.busy} onClick={onNew}>{t("New journal")}</button>
  </details><form className="journal-editor" onSubmit={e => { e.preventDefault(); if(!composing) w.save(); }} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}>
    <header className="journal-heading"><div><p className="subtle-label">{w.journal.type === 'weekly' ? t("Weekly reflection") : t("Daily reflection")}</p><h2>{dateLabel(w.journal.journalDate, { weekday: 'long' })}</h2></div><button className={`icon-button ${w.journal.bookmarked ? 'starred' : ''}`} type="button" aria-label={t("Bookmark journal")} aria-pressed={w.journal.bookmarked} disabled={w.busy} onClick={() => w.changeJournal({ bookmarked: !w.journal.bookmarked })}><Star size={19} fill={w.journal.bookmarked ? 'currentColor' : 'none'} /></button></header>
    <fieldset disabled={w.busy} className="editor-fields"><div className="field-grid"><label>{t("Entry date")}<input type="date" required value={w.journal.journalDate} onChange={e => w.changeJournal({ journalDate: e.target.value })} /></label><label>{t("Entry type")}<select value={w.journal.type} onChange={e => w.changeJournal({ type: e.target.value })}><option value="daily">{t("Daily")}</option><option value="weekly">{t("Weekly")}</option></select></label></div>
      <label className="journal-title-label"><span className="sr-only">{t("Journal title")}</span><input className="journal-title" placeholder={t("Give your day a title")} required maxLength={300} value={w.journal.title} onChange={e => w.changeJournal({ title: e.target.value })} /></label>
      <label className="journal-content-label"><span className="sr-only">{t("Journal text")}</span><textarea className="journal-textarea" placeholder={t("What happened today? What did you learn, and what would you like to make time for next?")} required value={w.journal.content} onChange={e => w.changeJournal({ content: e.target.value })} /></label>
    </fieldset>
    <div className="journal-save-state"><span role="status">{w.dirty && w.journalState === 'Saved' ? t("Unsaved changes") : messageText(w.journalState)}</span><span>{count.count} {t(count.unit)}</span></div>
    <div className="journal-actions"><button type="button" className="text-button danger-text" disabled={!w.journal.id || w.busy} onClick={onDelete}><Trash2 size={15} />{t("Delete entry")}</button><div><button className="secondary-button" type="submit" disabled={w.busy || composing}>{w.phase === 'saving' ? t("Saving…") : t("Save journal")}</button><button className="primary-button" type="button" disabled={w.busy || composing} onClick={onPrepare}><Sparkles size={16} />{t("Prepare plan")}</button></div></div>
    <div className="journal-analysis-prompt"><div><strong>{t("Turn reflection into a realistic next step.")}</strong><p>{sourceSummary(w.options)}</p></div><button className="text-button" type="button" disabled={w.busy} onClick={onCustomize}>{t("Customize analysis")}</button></div>
  </form></div>;
}
