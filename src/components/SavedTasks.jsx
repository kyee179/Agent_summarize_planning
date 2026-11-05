import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function SavedTasks({ journalId, analysisId, busy, onChanged }) {
  const [tasks, setTasks] = useState([]), [error, setError] = useState(''), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!journalId) { setTasks([]); return; }
    Promise.resolve(api.listTasks(journalId)).then(items => { if (active) setTasks(items || []); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [journalId, analysisId, revision]);
  async function update(task, reopen) {
    if (pending || busy) return;
    setPending(true); setError('');
    try { await api.updateTask(task.id, { revision: task.revision, status: reopen ? 'open' : 'completed', requestNewSession: reopen }); setRevision(r => r + 1); onChanged(); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  }
  return <>{error && <p role="alert">{error}</p>}{tasks.length > 0 && <details className="advanced-section"><summary>Tracked tasks · {tasks.length}</summary>{tasks.map(task => <div className="task-pill" key={task.id}><strong>{task.title}</strong><small>{task.status.replaceAll('_', ' ')} · {task.sessionEventIds.length} calendar sessions</small><button className="text-button" type="button" disabled={busy || pending} onClick={() => update(task, ['completed', 'cancelled'].includes(task.status))}>{['completed', 'cancelled'].includes(task.status) ? 'Reopen and allow another session' : 'Mark completed'}</button></div>)}<p className="helper">Changing task status keeps existing calendar events. Generate a new plan to use the updated status.</p></details>}</>;
}
