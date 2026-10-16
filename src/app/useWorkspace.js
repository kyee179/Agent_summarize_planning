import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildMonthDays } from '../calendarUtils.js';
import { calendarDate, dateKey, dayRange, deviceTimezone, shiftDate } from '../lib/dates.js';

export function emptyJournal(timezone = deviceTimezone) {
  const journalDate = dateKey(new Date(), timezone);
  return { id: null, type: 'daily', journalDate, title: '', content: '', bookmarked: false, tags: [] };
}
export function journalPayload(journal) {
  return { type: journal.type, journalDate: journal.journalDate, title: journal.title, content: journal.content, bookmarked: journal.bookmarked, tags: journal.tags || [] };
}
const signature = journal => JSON.stringify(journalPayload(journal));

export function useWorkspace() {
  const [page, setPage] = useState('today');
  const [settings, setSettings] = useState({ timezone: deviceTimezone, weekStartsOn: 0, defaultNotifyMinutesBefore: 15, aiProvider: 'glm', defaultAvailability: [] });
  const [activeMonth, setActiveMonth] = useState(calendarDate(dateKey(new Date())));
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [events, setEvents] = useState([]), [nearbyEvents, setNearbyEvents] = useState([]);
  const [journals, setJournals] = useState([]), [connections, setConnections] = useState(null);
  const [journal, setJournal] = useState(() => emptyJournal());
  const [savedSignature, setSavedSignature] = useState(() => signature(emptyJournal()));
  const [analysis, setAnalysis] = useState(null), [phase, setPhase] = useState('idle');
  const [loading, setLoading] = useState(true), [eventLoading, setEventLoading] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [notice, setNotice] = useState(null), [journalState, setJournalState] = useState('New entry');
  const [options, setOptions] = useState({ targetDate: dateKey(new Date()), customAvailability: false, startsAt: '09:00', endsAt: '17:00', includeActivity: false, allowMemory: false, allowWebResearch: false });
  const [now, setNow] = useState(new Date());
  const eventSequence = useRef(0), journalSequence = useRef(0), running = useRef(false);
  const busy = ['saving', 'generating', 'applying', 'loading'].includes(phase);
  const dirty = signature(journal) !== savedSignature;
  const today = dateKey(now, settings.timezone);
  const days = useMemo(() => buildMonthDays(activeMonth, settings.weekStartsOn), [activeMonth, settings.weekStartsOn]);
  const range = useMemo(() => ({ from: dayRange(dateKey(days[0]), settings.timezone).from,
    to: dayRange(shiftDate(dateKey(days.at(-1)), 1), settings.timezone).from }), [days, settings.timezone]);

  const notify = useCallback((message, tone = 'success') => setNotice({ message, tone }), []);
  const reloadEvents = useCallback(async () => {
    const sequence = ++eventSequence.current;
    setEventLoading(true);
    try {
      const nextRange = { from: dayRange(today, settings.timezone).from, to: dayRange(shiftDate(today, 8), settings.timezone).from };
      const [monthData, nextData] = await Promise.all([api.listEvents({ ...range, expand: true }), api.listEvents({ ...nextRange, expand: true })]);
      if (sequence === eventSequence.current) { setEvents(monthData); setNearbyEvents(nextData); }
    } catch (error) { if (sequence === eventSequence.current) notify(`Calendar could not load. ${error.message}`, 'error'); }
    finally { if (sequence === eventSequence.current) setEventLoading(false); }
  }, [range, today, settings.timezone, notify]);

  const load = useCallback(async () => {
    setLoading(true); setLoadingError('');
    try {
      const [preferences, entries, status] = await Promise.all([api.getSettings(), api.listJournals(), api.integrationStatus()]);
      setSettings(preferences); setJournals(entries); setConnections(status);
      const localToday = dateKey(new Date(), preferences.timezone);
      setActiveMonth(calendarDate(localToday)); setSelectedDate(localToday);
      setJournal(current => current.id || current.content || current.title ? current : emptyJournal(preferences.timezone));
      setSavedSignature(signature(emptyJournal(preferences.timezone)));
      setOptions(current => ({ ...current, targetDate: localToday }));
    } catch (error) { setLoadingError(error.message); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) reloadEvents(); }, [loading, reloadEvents]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function invalidate() { setPhase(current => analysis && current !== 'applied' ? 'stale' : current); }
  function newJournal() {
    ++journalSequence.current;
    const entry = emptyJournal(settings.timezone);
    setJournal(entry); setSavedSignature(signature(entry)); setAnalysis(null); setPhase('idle'); setJournalState('New entry'); setPage('journal');
  }
  async function selectJournal(entry) {
    const sequence = ++journalSequence.current;
    setJournal(entry); setSavedSignature(signature(entry)); setAnalysis(null); setJournalState('Saved'); setPhase('loading');
    try {
      const result = await api.getJournalAnalysis(entry.id);
      if (sequence === journalSequence.current) { setAnalysis(result); setPhase(result ? result.applied ? 'applied' : 'ready' : 'idle'); }
    } catch (error) {
      if (sequence === journalSequence.current) { setPhase('idle'); if (error.status !== 404) notify(`Could not load the saved analysis. ${error.message}`, 'error'); }
    }
  }
  async function saveJournal() {
    if (journal.id && !dirty) return journal;
    if (!journal.title.trim() || !journal.content.trim()) { setJournalState('Add a title and some journal text before saving.'); return null; }
    setJournalState('Saving…');
    try {
      const result = journal.id ? await api.updateJournal(journal.id, journalPayload(journal)) : await api.createJournal(journalPayload(journal));
      setJournal(result); setSavedSignature(signature(result)); setAnalysis(null); setJournalState('Saved');
      setJournals(current => [result, ...current.filter(x => x.id !== result.id)].sort((a, b) => b.journalDate.localeCompare(a.journalDate)));
      setPhase('idle');
      return result;
    } catch (error) { setJournalState(`Save failed. ${error.message}`); return null; }
  }
  async function save() {
    if (running.current) return;
    if (journal.id && !dirty) return journal;
    running.current = true; setPhase('saving');
    try { return await saveJournal(); } finally { running.current = false; setPhase(current => current === 'saving' ? 'idle' : current); }
  }
  async function generate() {
    if (running.current) return;
    if (!options.targetDate) return notify('Choose a planning date in Customize analysis.', 'error');
    if (options.customAvailability && (!options.startsAt || !options.endsAt || options.startsAt >= options.endsAt)) return notify('Available hours must end after they start.', 'error');
    running.current = true; setPhase('saving'); setNotice(null);
    try {
      const saved = await saveJournal();
      if (!saved) { setPhase('idle'); return; }
      setPhase('generating'); setPage('plan');
      const request = { targetDate: options.targetDate, includeActivity: options.includeActivity, allowMemory: options.allowMemory, allowWebResearch: options.allowWebResearch };
      if (options.customAvailability) request.availability = [{ label: 'This plan', startsAt: options.startsAt, endsAt: options.endsAt }];
      const result = await api.analyzeJournal(saved.id, request);
      setAnalysis(result); setPhase('ready'); notify('Your plan is ready to review.');
    } catch (error) { setPhase(analysis ? 'stale' : 'error'); notify(error.message, 'error'); }
    finally { running.current = false; }
  }
  async function apply() {
    if (running.current || dirty || !analysis?.scheduleDrafts?.length || phase !== 'ready') return;
    running.current = true; setPhase('applying');
    try {
      await api.applyDrafts(analysis.journalId, analysis.id);
      setAnalysis(current => ({ ...current, applied: true })); setPhase('applied');
      const target = analysis.contract?.plan.targetDate || options.targetDate;
      setSelectedDate(target); setActiveMonth(calendarDate(target));
      await reloadEvents(); notify('All proposed blocks were added to your local calendar.');
    } catch (error) { setPhase(error.status === 409 ? 'stale' : 'ready'); notify(error.message, 'error'); }
    finally { running.current = false; }
  }
  async function removeJournal() {
    if (!journal.id || running.current) return;
    running.current = true;
    try { await api.deleteJournal(journal.id); setJournals(current => current.filter(x => x.id !== journal.id)); newJournal(); notify('Journal deleted.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { running.current = false; }
  }
  async function updateSettings(patch) {
    const result = await api.updateSettings(patch); setSettings(result); invalidate(); notify('Settings saved.');
  }
  function changeJournal(patch) { setJournal(current => ({ ...current, ...patch })); setJournalState('Unsaved changes'); }
  return { page, setPage, settings, events, nearbyEvents, journals, connections, setConnections, journal, analysis, phase, busy, dirty,
    loading, loadingError, eventLoading, notice, setNotice, notify, journalState, options, setOptions, today, now, days, range, activeMonth, setActiveMonth,
    selectedDate, setSelectedDate, reloadEvents, load, invalidate, newJournal, selectJournal, save, generate, apply, removeJournal, updateSettings, changeJournal };
}
