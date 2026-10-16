import { useRef, useState } from 'react';
import { LockKeyhole, Save, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { dateLabel, inputTime, timeLabel, wallTimeToISO } from '../lib/dates.js';
import { Dialog, ConfirmDialog } from './Dialog.jsx';

const categories = [ ['personal', 'Personal', '#2563eb'], ['study', 'Study', '#1d8653'], ['vacation', 'Vacation', '#b86912'], ['holiday', 'Holiday', '#c53e4c'], ['birthday', 'Birthday', '#8854c0'], ['other', 'Other', '#64748b'] ];
export function EventDrawer({ entry, settings, onClose, onSaved }) {
  const record = entry.record;
  const [form, setForm] = useState(() => ({ id: record?.id, title: record?.title || '',
    startsAt: record ? inputTime(record.anchorStartsAt || record.startsAt, settings.timezone) : `${entry.date}T09:00`,
    endsAt: record ? inputTime(record.anchorEndsAt || record.endsAt, settings.timezone) : `${entry.date}T09:30`,
    calendarType: record?.calendarType || 'personal', color: record?.color || '#2563eb', repeat: record?.repeat || 'none',
    notifyMinutesBefore: record?.notifyMinutesBefore ?? settings.defaultNotifyMinutesBefore, notificationFormat: record?.notificationFormat || 'Desktop notification',
    location: record?.location || '', notes: record?.notes || '', ...(record?.recurrenceTimezone ? { recurrenceTimezone: record.recurrenceTimezone } : {}) }));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  function change(patch) { setDirty(true); setForm(current => ({ ...current, ...patch })); }
  function close() { if (dirty) setConfirm('discard'); else onClose(); }
  async function save(event) {
    event.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setMessage('');
    try {
      const payload = { ...form, startsAt: wallTimeToISO(form.startsAt, settings.timezone), endsAt: wallTimeToISO(form.endsAt, settings.timezone), notifyMinutesBefore: Number(form.notifyMinutesBefore) };
      if (Date.parse(payload.endsAt) <= Date.parse(payload.startsAt)) throw new Error('The event must end after it starts.');
      if (form.id) await api.updateEvent(form.id, payload); else await api.createEvent(payload);
      await onSaved();
    } catch (error) { setMessage(error.message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await api.deleteEvent(form.id); await onSaved(); }
    catch (error) { setMessage(error.message); setConfirm(null); }
    finally { pending.current = false; setBusy(false); }
  }
  return <><Dialog title={record?.readonly ? 'Google Calendar busy time' : form.id ? 'Edit event' : 'Add event'} onClose={close} busy={busy} className="event-dialog">
    {record?.readonly ? <div className="dialog-body"><span className="badge"><LockKeyhole size={13} />Read only</span><h3>{record.title}</h3><p>{dateLabel(inputTime(record.startsAt, settings.timezone).slice(0, 10))}</p><p>{timeLabel(record.startsAt, settings.timezone)}–{timeLabel(record.endsAt, settings.timezone)}</p><p className="helper">{settings.timezone}. This busy interval protects your available time. Manage the original event in Google Calendar.</p></div> : <form onSubmit={save}>
      <div className="dialog-body"><fieldset disabled={busy} className="editor-fields"><label>Title<input required autoFocus maxLength={300} value={form.title} onChange={e => change({ title: e.target.value })} placeholder="What would you like to make time for?" /></label>
        {form.repeat !== 'none' && form.id && <div className="inline-status warning"><strong>Editing the repeating series</strong><span>These are the original event’s times. Changes affect all occurrences.</span></div>}
        <div className="field-grid"><label>Starts<input required type="datetime-local" value={form.startsAt} onChange={e => change({ startsAt: e.target.value })} /></label><label>Ends<input required type="datetime-local" value={form.endsAt} onChange={e => change({ endsAt: e.target.value })} /></label></div><p className="helper">Times in {settings.timezone}</p>
        <div className="field-grid"><label>Category<select value={form.calendarType} onChange={e => change({ calendarType: e.target.value, color: categories.find(x => x[0] === e.target.value)[2] })}>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Repeat<select value={form.repeat} onChange={e => change({ repeat: e.target.value })}>{['none', 'daily', 'weekly', 'monthly', 'yearly'].map(value => <option key={value} value={value}>{value === 'none' ? 'Does not repeat' : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
        <label>Location<input value={form.location} onChange={e => change({ location: e.target.value })} placeholder="Optional" /></label><label>Notes<textarea rows={3} value={form.notes} onChange={e => change({ notes: e.target.value })} placeholder="Anything you want to remember" /></label>
        <div className="field-grid"><label>Remind me, minutes before<input required type="number" min={0} max={10080} value={form.notifyMinutesBefore} onChange={e => change({ notifyMinutesBefore: e.target.value })} /></label><label>Reminder type<select value={form.notificationFormat} onChange={e => change({ notificationFormat: e.target.value })}><option>Desktop notification</option><option>Silent reminder</option>{!['Desktop notification', 'Silent reminder'].includes(form.notificationFormat) && <option>{form.notificationFormat}</option>}</select></label></div></fieldset>
        {message && <p role="alert" className="form-error">{message}</p>}</div><footer className="dialog-actions">{form.id && <button className="text-button danger-text" type="button" disabled={busy} onClick={() => setConfirm('delete')}><Trash2 size={15} />Delete event</button>}<button className="primary-button" type="submit" disabled={busy}><Save size={16} />{busy ? 'Saving…' : 'Save event'}</button></footer></form>}
  </Dialog>{confirm && <ConfirmDialog title={confirm === 'delete' ? 'Delete this event?' : 'Discard event changes?'} message={confirm === 'delete' ? form.repeat === 'none' ? 'The local event will be removed from your calendar.' : 'The complete repeating series will be removed.' : 'Your changes have not been saved.'} confirmLabel={confirm === 'delete' ? 'Delete event' : 'Discard changes'} busy={busy} onClose={() => setConfirm(null)} onConfirm={confirm === 'delete' ? remove : onClose} />}</>;
}
