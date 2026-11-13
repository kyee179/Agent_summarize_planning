import { t, useLocale, messageText } from '../i18n/index.js';
import { useRef, useState } from 'react';
import { LockKeyhole, Save, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { dateLabel, inputTime, timeLabel, wallTimeToISO } from '../lib/dates.js';
import { Dialog, ConfirmDialog } from './Dialog.jsx';

const categories = [ ['personal', 'Personal', '#2563eb'], ['study', 'Study', '#1d8653'], ['vacation', 'Vacation', '#b86912'], ['holiday', 'Holiday', '#c53e4c'], ['birthday', 'Birthday', '#8854c0'], ['other', 'Other', '#64748b'] ];
export function EventDrawer({ entry, settings, onClose, onSaved }) {
  useLocale();
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
  return <><Dialog title={record?.readonly ? t("Google Calendar busy time") : form.id ? t("Edit event") : t("Add event")} onClose={close} busy={busy} className="event-dialog">
    {record?.readonly ? <div className="dialog-body"><span className="badge"><LockKeyhole size={13} />{t("Read only")}</span><h3>{record.title}</h3><p>{dateLabel(inputTime(record.startsAt, settings.timezone).slice(0, 10))}</p><p>{timeLabel(record.startsAt, settings.timezone)}–{timeLabel(record.endsAt, settings.timezone)}</p><p className="helper">{settings.timezone}{t(". This busy interval protects your available time. Manage the original event in Google Calendar.")}</p></div> : <form onSubmit={save}>
      <div className="dialog-body"><fieldset disabled={busy} className="editor-fields"><label>{t("Title")}<input required autoFocus maxLength={300} value={form.title} onChange={e => change({ title: e.target.value })} placeholder={t("What would you like to make time for?")} /></label>
        {form.repeat !== 'none' && form.id && <div className="inline-status warning"><strong>{t("Editing the repeating series")}</strong><span>{t("These are the original event’s times. Changes affect all occurrences.")}</span></div>}
        <div className="field-grid"><label>{t("Starts")}<input required type="datetime-local" value={form.startsAt} onChange={e => change({ startsAt: e.target.value })} /></label><label>{t("Ends")}<input required type="datetime-local" value={form.endsAt} onChange={e => change({ endsAt: e.target.value })} /></label></div><p className="helper">{t("Times in ")}{settings.timezone}</p>
        <div className="field-grid"><label>{t("Category")}<select value={form.calendarType} onChange={e => change({ calendarType: e.target.value, color: categories.find(x => x[0] === e.target.value)[2] })}>{categories.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label><label>{t("Repeat")}<select value={form.repeat} onChange={e => change({ repeat: e.target.value })}>{['none', 'daily', 'weekly', 'monthly', 'yearly'].map(value => <option key={value} value={value}>{value === 'none' ? t("Does not repeat") : t(value[0].toUpperCase() + value.slice(1))}</option>)}</select></label></div>
        <label>{t("Location")}<input value={form.location} onChange={e => change({ location: e.target.value })} placeholder={t("Optional")} /></label><label>{t("Notes")}<textarea rows={3} value={form.notes} onChange={e => change({ notes: e.target.value })} placeholder={t("Anything you want to remember")} /></label>
        <div className="field-grid"><label>{t("Remind me, minutes before")}<input required type="number" min={0} max={10080} value={form.notifyMinutesBefore} onChange={e => change({ notifyMinutesBefore: e.target.value })} /></label><label>{t("Reminder type")}<select value={form.notificationFormat} onChange={e => change({ notificationFormat: e.target.value })}><option value={"Desktop notification"}>{t("Desktop notification")}</option><option value={"Silent reminder"}>{t("Silent reminder")}</option>{!['Desktop notification', 'Silent reminder'].includes(form.notificationFormat) && <option value={form.notificationFormat}>{form.notificationFormat}</option>}</select></label></div></fieldset>
        {message && <p role="alert" className="form-error">{messageText(message)}</p>}</div><footer className="dialog-actions">{form.id && <button className="text-button danger-text" type="button" disabled={busy} onClick={() => setConfirm('delete')}><Trash2 size={15} />{t("Delete event")}</button>}<button className="primary-button" type="submit" disabled={busy}><Save size={16} />{busy ? t("Saving…") : t("Save event")}</button></footer></form>}
  </Dialog>{confirm && <ConfirmDialog title={confirm === 'delete' ? t("Delete this event?") : t("Discard event changes?")} message={confirm === 'delete' ? form.repeat === 'none' ? t("The local event will be removed from your calendar.") : t("The complete repeating series will be removed.") : t("Your changes have not been saved.")} confirmLabel={confirm === 'delete' ? t("Delete event") : t("Discard changes")} busy={busy} onClose={() => setConfirm(null)} onConfirm={confirm === 'delete' ? remove : onClose} />}</>;
}
