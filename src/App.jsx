import { useEffect, useMemo, useRef, useState } from "react";
import { addMinutes, format, isSameDay, parseISO } from "date-fns";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  MapPin,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
  Umbrella,
  X
} from "lucide-react";
import { api } from "./api.js";
import { PlanningTasks } from "./components/PlanningTasks.jsx";
import {
  buildMonthDays,
  eventToReminderLine,
  formatTimeRange,
  getDayState,
  getEventsForDay,
  getMonthRange,
  shiftMonth,
  toLocalInputValue
} from "./calendarUtils.js";

const categoryOptions = [
  { value: "personal", label: "Personal", color: "#2563eb" },
  { value: "study", label: "Study", color: "#16a34a" },
  { value: "vacation", label: "Vacation", color: "#f59e0b" },
  { value: "holiday", label: "Holiday", color: "#dc2626" },
  { value: "birthday", label: "Birthday", color: "#9333ea" },
  { value: "other", label: "Other", color: "#475569" }
];

const repeatOptions = ["none", "daily", "weekly", "monthly", "yearly"];
const notificationOptions = ["Desktop notification", "Silent reminder", "Email later", "AI summary later"];
const providerLabels = { local: "Local rules", openai: "OpenAI", gemini: "Gemini", groq: "Groq" };

function createEmptyForm(day = new Date()) {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = addMinutes(start, 30);
  return {
    id: null,
    title: "",
    startsAt: toLocalInputValue(start),
    endsAt: toLocalInputValue(end),
    calendarType: "personal",
    location: "",
    notes: "",
    color: "#2563eb",
    notifyMinutesBefore: 15,
    notificationFormat: "Desktop notification",
    repeat: "none"
  };
}

function createEmptyJournal(type = "daily") {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: null,
    type,
    journalDate: today,
    title: type === "weekly" ? `Week of ${today}` : `Journal ${today}`,
    content: "",
    bookmarked: false,
    tags: []
  };
}

function formFromEvent(event) {
  return { ...event, startsAt: toLocalInputValue(event.startsAt), endsAt: toLocalInputValue(event.endsAt) };
}

function journalPayload(journal) {
  return {
    type: journal.type,
    journalDate: journal.journalDate,
    title: journal.title,
    content: journal.content,
    bookmarked: journal.bookmarked,
    tags: journal.tags || []
  };
}

function App() {
  const [activeDate, setActiveDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [journals, setJournals] = useState([]);
  const [settings, setSettings] = useState({ weekStartsOn: 0, defaultNotifyMinutesBefore: 15, aiProvider: "local" });
  const [clock, setClock] = useState(new Date());
  const [serverTime, setServerTime] = useState(null);
  const [view, setView] = useState("month");
  const [form, setForm] = useState(createEmptyForm(new Date()));
  const [journalForm, setJournalForm] = useState(createEmptyJournal("daily"));
  const [activeAnalysis, setActiveAnalysis] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [status, setStatus] = useState("Ready");
  const notifiedEvents = useRef(new Set());

  const monthRange = useMemo(() => getMonthRange(activeDate, settings.weekStartsOn), [activeDate, settings.weekStartsOn]);
  const days = useMemo(() => buildMonthDays(activeDate, settings.weekStartsOn), [activeDate, settings.weekStartsOn]);
  const selectedEvents = useMemo(() => getEventsForDay(events, selectedDay), [events, selectedDay]);
  const agendaEvents = useMemo(() => [...events].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)), [events]);
  const bookmarkedJournals = useMemo(() => journals.filter((journal) => journal.bookmarked), [journals]);

  const metrics = useMemo(() => {
    const todayEvents = events.filter((event) => isSameDay(parseISO(event.startsAt), new Date()));
    return {
      today: todayEvents.length,
      journals: journals.length,
      starred: bookmarkedJournals.length
    };
  }, [events, journals, bookmarkedJournals]);

  async function loadEvents(range = monthRange) {
    try {
      const data = await api.listEvents(range);
      setEvents(data);
      setStatus("Synced with local API");
    } catch (error) {
      setStatus(`API unavailable: ${error.message}`);
    }
  }

  async function loadJournals() {
    try {
      const data = await api.listJournals();
      setJournals(data);
    } catch (error) {
      setStatus(`Journal load failed: ${error.message}`);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getTime(), api.listJournals()])
      .then(([settingsData, timeData, journalData]) => {
        setSettings(settingsData);
        setServerTime(timeData);
        setJournals(journalData);
      })
      .catch((error) => setStatus(`Startup warning: ${error.message}`));
  }, []);

  useEffect(() => {
    loadEvents(monthRange);
  }, [monthRange.from, monthRange.to]);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();
  }, []);

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const now = Date.now();
    events.forEach((event) => {
      const notifyAt = new Date(event.startsAt).getTime() - Number(event.notifyMinutesBefore || 0) * 60_000;
      const key = `${event.id}:${notifyAt}`;
      if (notifyAt <= now && now - notifyAt < 60_000 && !notifiedEvents.current.has(key)) {
        notifiedEvents.current.add(key);
        new Notification(event.title, { body: eventToReminderLine(event), tag: key });
      }
    });
  }, [clock, events]);

  function startNewEvent(day = selectedDay) {
    setSelectedDay(day);
    setForm(createEmptyForm(day));
    setIsEditing(true);
  }

  function editEvent(event) {
    setForm(formFromEvent(event));
    setIsEditing(true);
  }

  async function saveEvent(event) {
    event.preventDefault();
    const payload = {
      ...form,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      notifyMinutesBefore: Number(form.notifyMinutesBefore)
    };

    try {
      if (form.id) {
        await api.updateEvent(form.id, payload);
        setStatus("Reminder updated");
      } else {
        await api.createEvent(payload);
        setStatus("Reminder created");
      }
      setIsEditing(false);
      setForm(createEmptyForm(selectedDay));
      await loadEvents();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteEvent(eventId) {
    try {
      await api.deleteEvent(eventId);
      setStatus("Reminder deleted");
      await loadEvents();
      setIsEditing(false);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function changeCategory(value) {
    const category = categoryOptions.find((option) => option.value === value);
    setForm((current) => ({ ...current, calendarType: value, color: category?.color || current.color }));
  }

  async function saveJournal(event) {
    event?.preventDefault();
    try {
      const saved = journalForm.id
        ? await api.updateJournal(journalForm.id, journalPayload(journalForm))
        : await api.createJournal(journalPayload(journalForm));
      setJournalForm(saved);
      setActiveAnalysis(null);
      setStatus("Journal saved");
      await loadJournals();
      return saved;
    } catch (error) {
      setStatus(error.message);
      return null;
    }
  }

  async function toggleBookmark() {
    const next = { ...journalForm, bookmarked: !journalForm.bookmarked };
    setJournalForm(next);
    if (next.id) {
      try {
        const saved = await api.updateJournal(next.id, journalPayload(next));
        setJournalForm(saved);
        await loadJournals();
        setStatus(saved.bookmarked ? "Journal bookmarked" : "Bookmark removed");
      } catch (error) {
        setStatus(error.message);
      }
    }
  }

  async function analyzeCurrentJournal() {
    const saved = await saveJournal();
    if (!saved) return;
    setIsAnalyzing(true);
    try {
      const analysis = await api.analyzeJournal(saved.id);
      setActiveAnalysis(analysis);
      setStatus(`Analysis ready via ${analysis.provider}`);
      await loadJournals();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function applyScheduleDrafts() {
    if (!activeAnalysis?.scheduleDrafts?.length || isApplying || activeAnalysis.applied) return;
    setIsApplying(true);
    try {
      await api.applyDrafts(activeAnalysis.journalId, activeAnalysis.id);
      setActiveAnalysis((current) => current?.id === activeAnalysis.id ? { ...current, applied: true } : current);
      setStatus("Draft plan applied to calendar");
      await loadEvents();
      setView("month");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsApplying(false);
    }
  }

  async function selectJournal(journal) {
    setJournalForm(journal);
    setActiveAnalysis(null);
    try {
      const analysis = await api.getJournalAnalysis(journal.id);
      setActiveAnalysis(analysis);
    } catch {
      setActiveAnalysis(null);
    }
  }

  async function deleteJournal() {
    if (!journalForm.id) return;
    try {
      await api.deleteJournal(journalForm.id);
      setJournalForm(createEmptyJournal(journalForm.type));
      setActiveAnalysis(null);
      await loadJournals();
      setStatus("Journal deleted");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Calendar summary">
        <div className="brand-row">
          <CalendarDays size={28} aria-hidden="true" />
          <div>
            <h1>Study Calendar</h1>
            <p>{format(clock, "EEEE, MMMM d, yyyy")}</p>
          </div>
        </div>

        <section className="time-panel" aria-label="Current time">
          <Clock size={20} aria-hidden="true" />
          <div>
            <strong>{format(clock, "h:mm:ss a")}</strong>
            <span>{serverTime?.timezone || settings.timezone || "Local time"}</span>
          </div>
        </section>

        <div className="quick-stats" aria-label="Calendar totals">
          <div><span>{metrics.today}</span><p>Today</p></div>
          <div><span>{metrics.journals}</span><p>Journals</p></div>
          <div><span>{metrics.starred}</span><p>Starred</p></div>
        </div>

        <section className="selected-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Selected</span>
              <h2>{format(selectedDay, "MMM d")}</h2>
            </div>
            <button className="icon-button" type="button" title="Add reminder" onClick={() => startNewEvent(selectedDay)}>
              <Plus size={18} />
            </button>
          </div>

          <div className="event-list compact-list">
            {selectedEvents.length === 0 ? <p className="empty-state">No reminders yet.</p> : selectedEvents.map((event) => (
              <button className="event-row" type="button" key={event.id} onClick={() => editEvent(event)}>
                <span className="color-dot" style={{ background: event.color }} />
                <span><strong>{event.title}</strong><small>{formatTimeRange(event)}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="selected-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Precious</span>
              <h2>Bookmarks</h2>
            </div>
            <Star size={18} aria-hidden="true" />
          </div>
          <div className="event-list compact-list">
            {bookmarkedJournals.length === 0 ? <p className="empty-state">No bookmarked journals.</p> : bookmarkedJournals.slice(0, 4).map((journal) => (
              <button className="event-row" type="button" key={journal.id} onClick={() => { setView("journals"); selectJournal(journal); }}>
                <span className="color-dot journal-dot" />
                <span><strong>{journal.title}</strong><small>{journal.type} - {journal.journalDate}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="status-line" aria-live="polite">{status}</section>
      </aside>

      <section className="calendar-workspace">
        <header className="toolbar">
          <div className="month-controls">
            {view !== "journals" && (
              <>
                <button className="icon-button" type="button" title="Previous month" onClick={() => setActiveDate(shiftMonth(activeDate, -1))}><ChevronLeft size={20} /></button>
                <button className="today-button" type="button" onClick={() => { setActiveDate(new Date()); setSelectedDay(new Date()); }}>Today</button>
                <button className="icon-button" type="button" title="Next month" onClick={() => setActiveDate(shiftMonth(activeDate, 1))}><ChevronRight size={20} /></button>
              </>
            )}
            <h2>{view === "journals" ? "Journals & AI Planning" : format(activeDate, "MMMM yyyy")}</h2>
          </div>

          <div className="toolbar-actions">
            <div className="segmented" role="tablist" aria-label="Calendar view">
              <button type="button" className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Month</button>
              <button type="button" className={view === "agenda" ? "active" : ""} onClick={() => setView("agenda")}>Agenda</button>
              <button type="button" className={view === "journals" ? "active" : ""} onClick={() => setView("journals")}>Journals</button>
            </div>
            {view !== "journals" ? (
              <button className="primary-button" type="button" onClick={() => startNewEvent(selectedDay)}><Plus size={18} />Add</button>
            ) : (
              <button className="primary-button" type="button" onClick={() => { setJournalForm(createEmptyJournal("daily")); setActiveAnalysis(null); }}><Plus size={18} />New</button>
            )}
          </div>
        </header>

        {view === "month" && (
          <section className="month-grid" aria-label="Month calendar">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => <div className="weekday" key={dayName}>{dayName}</div>)}
            {days.map((day) => {
              const state = getDayState(day, activeDate);
              const dayEvents = getEventsForDay(events, day).slice(0, 4);
              const isSelected = isSameDay(day, selectedDay);
              return (
                <button type="button" className={`day-cell ${state.isCurrentMonth ? "" : "muted"} ${state.isToday ? "today" : ""} ${isSelected ? "selected" : ""}`} key={day.toISOString()} onClick={() => setSelectedDay(day)} onDoubleClick={() => startNewEvent(day)}>
                  <span className="day-number">{format(day, "d")}</span>
                  <span className="cell-events">
                    {dayEvents.map((event) => <span className="event-chip" key={event.id} style={{ borderLeftColor: event.color }}>{event.calendarType === "vacation" && <Umbrella size={12} />}{event.title}</span>)}
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {view === "agenda" && (
          <section className="agenda-list" aria-label="Agenda">
            {agendaEvents.length === 0 ? <p className="empty-state">No reminders in this month range.</p> : agendaEvents.map((event) => (
              <article className="agenda-item" key={event.id}>
                <div className="agenda-date"><span>{format(parseISO(event.startsAt), "MMM")}</span><strong>{format(parseISO(event.startsAt), "d")}</strong></div>
                <div className="agenda-body">
                  <div className="agenda-title-row"><span className="color-dot" style={{ background: event.color }} /><h3>{event.title}</h3><button className="icon-button" type="button" title="Edit reminder" onClick={() => editEvent(event)}><Edit3 size={16} /></button></div>
                  <p><Clock size={14} /> {formatTimeRange(event)}</p>
                  {event.location && <p><MapPin size={14} /> {event.location}</p>}
                  <small>{eventToReminderLine(event)}</small>
                </div>
              </article>
            ))}
          </section>
        )}

        {view === "journals" && (
          <section className="journal-workspace" aria-label="Journal planner">
            <aside className="journal-list">
              <div className="panel-heading"><div><span className="eyebrow">History</span><h2>Saved Journals</h2></div><BookOpen size={20} /></div>
              {journals.length === 0 ? <p className="empty-state">No journals yet.</p> : journals.map((journal) => (
                <button className={`journal-row ${journalForm.id === journal.id ? "active" : ""}`} type="button" key={journal.id} onClick={() => selectJournal(journal)}>
                  <span>{journal.bookmarked ? <Star size={15} fill="currentColor" /> : <BookOpen size={15} />}</span>
                  <span><strong>{journal.title}</strong><small>{journal.type} - {journal.journalDate}</small></span>
                </button>
              ))}
            </aside>

            <form className="journal-editor" onSubmit={saveJournal}>
              <div className="panel-heading">
                <div><span className="eyebrow">Reflect</span><h2>{journalForm.id ? "Edit Journal" : "New Journal"}</h2></div>
                <button className={`icon-button ${journalForm.bookmarked ? "starred" : ""}`} type="button" title="Bookmark journal" onClick={toggleBookmark}><Star size={18} fill={journalForm.bookmarked ? "currentColor" : "none"} /></button>
              </div>

              <div className="field-grid">
                <label>Type<select value={journalForm.type} onChange={(event) => setJournalForm({ ...journalForm, type: event.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
                <label>Date<input type="date" value={journalForm.journalDate} onChange={(event) => setJournalForm({ ...journalForm, journalDate: event.target.value })} /></label>
              </div>

              <label>Title<input required value={journalForm.title} onChange={(event) => setJournalForm({ ...journalForm, title: event.target.value })} /></label>
              <label>Journal<textarea className="journal-textarea" required rows="12" value={journalForm.content} onChange={(event) => setJournalForm({ ...journalForm, content: event.target.value })} placeholder="Write what happened, what remains unfinished, and anything that may need planning." /></label>

              <div className="ai-settings-row">
                <label>AI provider<select value={settings.aiProvider || "local"} onChange={async (event) => { const next = { ...settings, aiProvider: event.target.value }; setSettings(next); setSettings(await api.updateSettings({ aiProvider: event.target.value })); }}>
                  <option value="local">Local rules</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="groq">Groq</option>
                </select></label>
                <div className="provider-status">
                  <Sparkles size={16} /> {providerLabels[settings.aiProvider || "local"]} {settings.aiProviderConfigured?.[settings.aiProvider] ? "configured" : settings.aiProvider === "local" ? "ready" : "needs API key"}
                </div>
              </div>

              <div className="editor-actions">
                {journalForm.id && <button className="danger-button" type="button" onClick={deleteJournal}><Trash2 size={16} />Delete</button>}
                <button className="today-button" type="submit"><Save size={16} />Save</button>
                <button className="primary-button" type="button" onClick={analyzeCurrentJournal} disabled={isAnalyzing}><Sparkles size={16} />{isAnalyzing ? "Analyzing" : "Analyze"}</button>
              </div>
            </form>

            <aside className="analysis-panel">
              <div className="panel-heading"><div><span className="eyebrow">Draft</span><h2>AI Plan</h2></div><CheckCircle2 size={20} /></div>
              {!activeAnalysis ? <p className="empty-state">Save and analyze a journal to create a draft plan.</p> : (
                <div className="analysis-content">
                  <section><h3>Summary</h3><p>{activeAnalysis.summary}</p></section>
                  <section><h3>Weekly summary</h3><p>{activeAnalysis.weeklySummary}</p></section>
                  <PlanningTasks analysis={activeAnalysis} />
                  {activeAnalysis.scheduling && <p>Scheduled around calendar events on {activeAnalysis.contract.plan.targetDate}, with {activeAnalysis.contract.plan.bufferMinutes}-minute buffers.</p>}
                  <section><h3>Schedule drafts</h3>{activeAnalysis.contract && <p>Times in {activeAnalysis.contract.plan.timezone}. Review before applying.</p>}{activeAnalysis.scheduleDrafts?.length ? activeAnalysis.scheduleDrafts.map((draft, index) => <div className="draft-card" key={`${draft.title}-${index}`}><strong>{draft.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone: activeAnalysis.contract?.plan.timezone || settings.timezone, dateStyle: "medium", timeStyle: "short" }).formatRange(new Date(draft.startsAt), new Date(draft.endsAt))}</small><p>{draft.rationale}</p></div>) : <p className="empty-state">No schedule drafts produced.</p>}</section>
                  {activeAnalysis.cautions?.length > 0 && <section><h3>Cautions</h3>{activeAnalysis.cautions.map((item) => <p className="caution" key={item}>{item}</p>)}</section>}
                  {activeAnalysis.contract?.plan.warnings.length > 0 && <section><h3>Planning warnings</h3>{activeAnalysis.contract.plan.warnings.map((item) => <p className="caution" key={item}>{item}</p>)}</section>}
                  <button className="primary-button full-width" type="button" onClick={applyScheduleDrafts} disabled={!activeAnalysis.scheduleDrafts?.length || isApplying || activeAnalysis.applied}><CheckCircle2 size={16} />{isApplying ? "Applying..." : activeAnalysis.applied ? "Drafts applied" : "Apply Drafts"}</button>
                </div>
              )}
            </aside>
          </section>
        )}
      </section>

      {isEditing && (
        <aside className="editor-panel" aria-label="Reminder editor">
          <form onSubmit={saveEvent}>
            <div className="editor-heading"><div><span className="eyebrow">Reminder</span><h2>{form.id ? "Edit" : "Create"}</h2></div><button className="icon-button" type="button" title="Close editor" onClick={() => setIsEditing(false)}><X size={18} /></button></div>
            <label>Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Study algorithms" /></label>
            <div className="field-grid"><label>Starts<input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label><label>Ends<input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label></div>
            <div className="field-grid"><label>Category<select value={form.calendarType} onChange={(event) => changeCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Repeat<select value={form.repeat} onChange={(event) => setForm({ ...form, repeat: event.target.value })}>{repeatOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>
            <label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Library" /></label>
            <div className="field-grid"><label>Notify before<input type="number" min="0" value={form.notifyMinutesBefore} onChange={(event) => setForm({ ...form, notifyMinutesBefore: event.target.value })} /></label><label>Notification format<select value={form.notificationFormat} onChange={(event) => setForm({ ...form, notificationFormat: event.target.value })}>{notificationOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>
            <label>Notes<textarea rows="4" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Add useful details" /></label>
            <div className="reminder-preview"><Bell size={16} /><span>time: {form.startsAt ? format(new Date(form.startsAt), "p") : "a"} to {form.endsAt ? format(new Date(form.endsAt), "p") : "b"}; {form.title || "title"}; {form.notificationFormat}</span></div>
            <div className="editor-actions">{form.id && <button className="danger-button" type="button" onClick={() => deleteEvent(form.id)}><Trash2 size={16} />Delete</button>}<button className="primary-button" type="submit"><Save size={16} />Save</button></div>
          </form>
        </aside>
      )}
    </main>
  );
}

export default App;
