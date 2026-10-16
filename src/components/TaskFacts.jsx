import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { api } from '../api.js';
import { inputTime, wallTimeToISO } from '../lib/dates.js';

export function TaskFacts({ task, record, tasks, timezone, onClose, onSaved }) {
  const confirmed = record.confirmed;
  const [title, setTitle] = useState(record.title), [status, setStatus] = useState(record.status);
  const [deadline, setDeadline] = useState(confirmed.deadline ? inputTime(confirmed.deadline.at, timezone) : '');
  const [kind, setKind] = useState(confirmed.deadline?.kind || 'hard');
  const [minutes, setMinutes] = useState('effort' in confirmed ? confirmed.effort?.minutes ?? '' : record.candidates?.effortMinutes ?? ''), [scope, setScope] = useState(confirmed.effort?.scope || 'next_session');
  const [importance, setImportance] = useState(confirmed.importance || task.importance.level);
  const [dependencies, setDependencies] = useState(confirmed.dependsOn || task.dependsOn);
  const [again, setAgain] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try {
      const patch = { revision: record.revision, title, status, deadline: deadline ? { at: wallTimeToISO(deadline, timezone), kind } : null,
        effort: minutes !== '' ? { minutes: Number(minutes), scope } : null, dependsOn: dependencies, requestNewSession: again };
      patch.importance = importance === 'unknown' ? null : importance;
      await api.updateTask(task.id, patch); onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <Dialog title="Confirm task facts" onClose={onClose} busy={saving}><form onSubmit={submit}><div className="dialog-body"><p>These are your confirmed facts. Generate a new plan after saving; existing calendar events keep their reviewed times.</p>
    {record.candidates?.deadlineDate && <p className="caution">Source date suggestion: {record.candidates.deadlineDate} {record.candidates.deadlineTime || '(time unspecified)'} in {record.candidates.timezone}. Check the source and choose an explicit time below to confirm it.</p>}
    <fieldset disabled={saving} className="editor-fields"><label>Task title<input required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Task status<select value={status} onChange={e => setStatus(e.target.value)}>{['open', 'in_progress', 'blocked', 'completed', 'cancelled'].map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label>
      <label>Confirmed deadline ({timezone})<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
      <label>Deadline type<select value={kind} onChange={e => setKind(e.target.value)}><option value="hard">Must finish by this time</option><option value="target">Preferred target</option></select></label>
      <label>Confirmed effort in minutes<input type="number" min={1} max={525600} value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
      <label>Effort covers<select value={scope} onChange={e => setScope(e.target.value)}><option value="next_session">One work session</option><option value="remaining_task">All remaining work</option></select></label>
      <label>Importance<select value={importance} onChange={e => setImportance(e.target.value)}>{['unknown', 'low', 'medium', 'high'].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <fieldset><legend>Depends on</legend>{tasks.filter(t => t.id !== task.id).map(t => <label className="check-row" key={t.id}><input type="checkbox" checked={dependencies.includes(t.id)} onChange={e => setDependencies(current => e.target.checked ? [...current, t.id] : current.filter(id => id !== t.id))} />{t.title}</label>)}</fieldset>
      {record.sessionEventIds.length > 0 && <label className="check-row"><input type="checkbox" checked={again} onChange={e => setAgain(e.target.checked)} />I want another work session for this task</label>}
    </fieldset>{error && <p role="alert">{error}</p>}</div><footer className="dialog-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Confirm and save facts'}</button></footer></form></Dialog>;
}
