import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, RefreshCw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { AnalysisSummaries } from '../components/AnalysisSummaries.jsx';
import { PlanningTasks } from '../components/PlanningTasks.jsx';
import { DayTimeline } from '../components/DayTimeline.jsx';
import { sourceSummary } from '../components/AnalysisOptions.jsx';
import { dayRange, dateLabel } from '../lib/dates.js';
import { EmptyState } from './CalendarWorkspace.jsx';

export function PlanWorkspace({ workspace: w, onCustomize, onJournal, onEvent, onSelectJournal }) {
  const [snapshot, setSnapshot] = useState({ date: null, events: [], error: '', loading: false });
  const [selectedTask, setSelectedTask] = useState(null);
  const analysis = w.analysis;
  const target = analysis?.contract?.plan.targetDate || w.options.targetDate;
  const zone = analysis?.contract?.plan.timezone || w.settings.timezone;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (!target) return;
    setSnapshot({ date: target, events: [], loading: true, error: '' });
    api.listEvents({ ...dayRange(target, zone), expand: true }).then(events => {
      if (active) setSnapshot({ date: target, events, loading: false, error: '' });
    }).catch(error => { if (active) setSnapshot({ date: target, events: [], loading: false, error: error.message }); });
    return () => { active = false; };
  }, [target, zone, analysis?.id, analysis?.applied, refresh]);
  useEffect(() => { setSelectedTask(null); }, [analysis?.id]);
  const drafts = analysis?.contract ? analysis.contract.plan.blocks.map((block, index) => ({ ...block, id: `proposal-${index}`, title: analysis.contract.tasks.find(task => task.id === block.taskId)?.title || analysis.scheduleDrafts?.[index]?.title || 'Proposed work' })) : (analysis?.scheduleDrafts || []).map((block, index) => ({ ...block, id: `proposal-${index}` }));
  const minutes = drafts.reduce((sum, item) => sum + (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000, 0);
  const canApply = w.phase === 'ready' && !w.dirty && drafts.length > 0 && !snapshot.loading && !snapshot.error;
  return <><section className="plan-preparation"><div><p className="subtle-label">Source journal</p>{w.journals.length > 0 ? <select aria-label="Source journal" value={w.journal.id || ''} disabled={w.busy} onChange={e => { const entry = w.journals.find(x => x.id === e.target.value); if (entry) onSelectJournal(entry); }}><option value="" disabled>Choose a journal</option>{w.journals.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select> : <h2>{w.journal.title || 'Choose a journal to begin'}</h2>}<p>{sourceSummary(w.options)}</p></div><div className="toolbar-actions"><button type="button" className="secondary-button" onClick={onCustomize} disabled={w.busy}><SlidersHorizontal size={16} />Customize analysis</button><button type="button" className="primary-button" onClick={w.generate} disabled={w.busy || !w.journal.content.trim()}><Sparkles size={16} />{w.phase === 'generating' ? 'Generating…' : w.phase === 'saving' ? 'Saving…' : analysis ? 'Generate new plan' : 'Generate summary and plan'}</button></div>
      <p className="plan-target">Plan for {target ? dateLabel(target, { weekday: 'short' }) : 'a selected day'} in {zone}. Calendar writes require your review.</p></section>
    {['generating', 'saving', 'loading'].includes(w.phase) ? <div className="generation-state" role="status"><span className="loading-ring" /><h2>{w.phase === 'saving' ? 'Saving your journal' : w.phase === 'loading' ? 'Loading your saved analysis' : 'Preparing your summary and plan'}</h2><p>{w.phase === 'loading' ? 'Retrieving the latest plan for this journal.' : 'Reviewing the permitted context and finding room around your commitments.'}</p></div> : !analysis ? <EmptyState icon={Sparkles} title={w.phase === 'error' ? 'Your journal is safe. Try again.' : 'A plan starts with your journal.'} action={<button className="secondary-button" type="button" onClick={onJournal}>{w.journal.content ? 'Back to journal' : 'Write a journal'}</button>}>Choose your sources and available hours, then generate a plan to review.</EmptyState> : <>
      <div className="plan-result-heading"><span className={`badge ${w.phase === 'applied' ? 'success-badge' : w.phase === 'stale' ? 'warning-badge' : ''}`}>{w.phase === 'applied' ? 'Added to calendar' : w.phase === 'stale' ? 'Review needs updating' : 'Ready for review'}</span><span className="helper">{analysis.provider === 'local' ? 'Prepared with local rules' : `Prepared with ${analysis.model || analysis.provider}`}</span></div>
      {w.phase === 'stale' && <div className="inline-status warning" role="alert"><strong>This plan needs to be generated again.</strong><span>Your calendar, source information, settings, or available time changed. Review the new result before adding it.</span></div>}
      {w.dirty && <div className="inline-status warning"><strong>Your journal has unsaved changes.</strong><span>Generate a new plan to use the updated entry.</span></div>}
      <div className="plan-layout"><div className="plan-main"><section className="timeline-surface"><div className="section-heading"><div><p className="subtle-label">Calendar comparison</p><h2>{dateLabel(target, { weekday: 'long' })}</h2></div><button className="icon-button" type="button" aria-label="Refresh calendar comparison" onClick={() => setRefresh(x => x + 1)}><RefreshCw size={16} /></button></div>
        {snapshot.loading ? <p role="status" className="helper">Loading current commitments…</p> : snapshot.error ? <div className="inline-status error" role="alert"><strong>Calendar comparison could not load.</strong><span>{snapshot.error}</span><button className="text-button" onClick={() => setRefresh(x => x + 1)}>Try again</button></div> : <DayTimeline date={target} timezone={zone} events={snapshot.events} proposed={analysis.applied ? [] : drafts} selectedId={selectedTask} onSelect={item => item.taskId ? setSelectedTask(item.taskId) : onEvent(item)} />}
      </section><section className="summary-surface"><AnalysisSummaries analysis={analysis} /></section></div><aside className="plan-inspector"><div className="section-heading"><div><p className="subtle-label">Why this plan</p><h2>Work to review</h2></div>{selectedTask && <button className="text-button" type="button" onClick={() => setSelectedTask(null)}>Show all</button>}</div><PlanningTasks analysis={analysis} selectedTaskId={selectedTask} />
        {analysis.cautions?.length > 0 && <section><h3>Keep in mind</h3>{analysis.cautions.map(item => <p className="caution" key={item}>{item}</p>)}</section>}
        {analysis.contract?.plan.warnings?.length > 0 && <section><h3>Scheduling notes</h3>{analysis.contract.plan.warnings.map(item => <p className="caution" key={item}>{item}</p>)}</section>}
        <p className="helper">{analysis.contract?.plan.bufferMinutes ?? 15}-minute buffers protect space between commitments. Select a proposed block to inspect its evidence.</p>
      </aside></div>
      <footer className="apply-bar"><div><strong>{analysis.applied ? 'Your plan is on the calendar.' : `${drafts.length} proposed ${drafts.length === 1 ? 'block' : 'blocks'}, ${Math.round(minutes)} minutes`}</strong><p>{analysis.applied ? 'You can edit the resulting local events in Calendar.' : 'Adds the complete reviewed plan to your local calendar.'}</p></div>{analysis.applied ? <button className="secondary-button" type="button" onClick={() => w.setPage('calendar')}>Open calendar<ArrowUpRight size={16} /></button> : <button className="primary-button" type="button" disabled={!canApply || w.busy} onClick={w.apply}><Check size={17} />{w.phase === 'applying' ? 'Adding…' : 'Add all to local calendar'}</button>}</footer>
    </>}
  </>;
}
