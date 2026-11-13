import { t, useLocale, messageText, getLocale } from '../i18n/index.js';
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { DurationControl } from "../components/DurationControl.jsx";
import { TaskFacts } from "../components/TaskFacts.jsx";
import { PlanningTasks } from "../components/PlanningTasks.jsx";

export function TaskInbox({ workspace: w }) {
  useLocale();
  const [data, setData] = useState({ sources: [], candidates: [] }),
    [tasks, setTasks] = useState([]),
    [selected, setSelected] = useState([]);
  const [input, setInput] = useState({
      kind: "email",
      externalId: "",
      title: "",
      text: "",
      sourceTimestamp: "",
      locator: "",
    }),
    [allowAI, setAllowAI] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [date, setDate] = useState(w.today),
    [plan, setPlan] = useState(null),
    [editing, setEditing] = useState(null),
    [windows, setWindows] = useState([]),
    [windowIndex, setWindowIndex] = useState(""),
    [ocr, setOcr] = useState(false);
  const [durations, setDurations] = useState({}),
    [actual, setActual] = useState(""),
    [completed, setCompleted] = useState(false),
    [outcomeTask, setOutcomeTask] = useState(""),
    [receipt, setReceipt] = useState(() => crypto.randomUUID());
  const [mailDays, setMailDays] = useState(7),
    [mailFolder, setMailFolder] = useState("INBOX"),
    [mailAuto, setMailAuto] = useState(false);
  const [timer, setTimer] = useState({
    taskId: null,
    startedAt: null,
    elapsed: 0,
  });
  const load = useCallback(async () => {
    const [sources, records] = await Promise.all([
      api.taskSources(),
      api.listTasks(),
    ]);
    setData(sources);
    setTasks(records);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    let active = true;
    Promise.all([api.taskSources(), api.listTasks()])
      .then(([sources, records]) => {
        if (active) {
          setData(sources);
          setTasks(records);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (
      !data.capture?.running &&
      !data.gmail?.pending &&
      !data.gmail?.autoRefreshing
    )
      return;
    const interval = setInterval(
      () => load().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(interval);
  }, [
    data.capture?.running,
    data.gmail?.pending,
    data.gmail?.autoRefreshing,
    load,
  ]);
  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDuration(task) {
    const minutes = Number(durations[task.id]);
    if (!Number.isInteger(minutes) || minutes < 1)
      throw Error("Choose a positive whole number of minutes.");
    await api.updateTask(task.id, {
      revision: task.revision,
      effort: {
        minutes,
        scope: task.confirmed?.effort?.scope || task.scope || "next_session",
      },
    });
    setPlan(null);
  }
  const sourceMap = new Map(data.sources.map((s) => [s.id, s]));
  const proposals = data.candidates.filter((c) =>
    ["suggested", "needs_review"].includes(c.state),
  );
  const asTask = (record) => ({
    id: record.id,
    title: record.title,
    importance: { level: record.confirmed?.importance || "unknown" },
    dependsOn: record.confirmed?.dependsOn || [],
  });
  function pauseTimer() {
    if (!timer.startedAt) return;
    const elapsed = timer.elapsed + (Date.now() - timer.startedAt);
    setTimer({ ...timer, startedAt: null, elapsed });
    setActual(String(Math.max(1, Math.ceil(elapsed / 60000))));
  }
  return (
    <div className="source-workspace">
      {editing && (
        <TaskFacts
          task={asTask(editing)}
          record={editing}
          tasks={tasks.map(asTask)}
          timezone={w.settings.timezone}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setPlan(null);
            load().catch((e) => setError(e.message));
          }}
        />
      )}
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>{t("Tasks from your sources")}</h2>
            <p className="muted">{t("Discover commitments from email and selected work apps, then review what belongs to you. ")}</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => run(load)}
          >{t("Refresh tasks ")}</button>
        </div>
        {error && (
          <p className="caution" role="alert">
            {messageText(error)}
          </p>
        )}
      </section>
      <div className="source-grid">
        <section className="settings-section">
          <h3>{t("Gmail · read only")}</h3>
          {data.gmail?.lastError && (
            <p className="caution">{messageText(data.gmail.lastError)}</p>
          )}
          {data.gmail?.pending && (
            <button
              className="text-button"
              type="button"
              onClick={() => run(() => api.gmailCancel())}
            >{t("Cancel connection ")}</button>
          )}
          <p className="helper">{t("Separate permission from Google Calendar. Imports plain-text message content locally; attachments are excluded. ")}</p>
          <div className="field-grid">
            <label>{t("Recent days ")}<input
                type="number"
                min={1}
                max={30}
                value={mailDays}
                onChange={(e) => setMailDays(Number(e.target.value))}
              />
            </label>
            <label>{t("Gmail folder ")}<select
                value={mailFolder}
                onChange={(e) => setMailFolder(e.target.value)}
              >
                {["INBOX", "STARRED", "IMPORTANT", "SENT"].map((folder) => (
                  <option key={folder} value={folder}>{folder}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={mailAuto}
              onChange={(e) => setMailAuto(e.target.checked)}
            />{t("After import, refresh this selection every 10 minutes while the workspace is open ")}</label>
          {data.gmail?.autoRefreshing && (
            <button
              className="text-button"
              type="button"
              onClick={() => run(() => api.gmailCancel())}
            >{t("Pause automatic refresh ")}</button>
          )}
          <p role="status">
            {data.gmail?.pending ? t("Waiting for Google consent…") : data.gmail?.connected ? t("Connected") : t("Not connected")}
          </p>
          <div className="toolbar-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || data.gmail?.pending}
              onClick={() =>
                run(async () => {
                  const result = await api.gmailConnect();
                  await api.openGoogleConsent(result.authorizationUrl);
                })
              }
            >{t("Connect Gmail ")}</button>
            {data.gmail?.connected && (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.gmailSync({
                        lookbackDays: mailDays,
                        label: mailFolder,
                        autoRefresh: mailAuto,
                      });
                      setPlan(null);
                    })
                  }
                >{t("Import recent changes ")}</button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.gmailDisconnect();
                      setPlan(null);
                    })
                  }
                >{t("Disconnect locally ")}</button>
              </>
            )}
          </div>
          {data.gmail?.sync && (
            <p className="helper">
              {t(data.gmail.sync.window)}{t(" · Last sync ")}{data.gmail.sync.syncedAt}
            </p>
          )}
        </section>
        <section className="settings-section">
          <h3>{t("Selected work app")}</h3>
          <p className="helper">{t("Reads exposed text from one selected window every minute. Capture starts off. Keep password managers and confidential windows excluded. ")}</p>
          <p role="status">
            {data.capture?.running ? t("Capturing {p0}", {p0: data.capture.selected?.app || t("selected app")}) : t("Capture paused")}
            {data.capture?.lastCapturedAt ? ` · ${data.capture.lastCapturedAt}` : ""}
          </p>
          {data.capture?.lastError && (
            <p className="caution">{messageText(data.capture.lastError)}</p>
          )}
          <div className="toolbar-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !data.capture?.available}
              onClick={() =>
                run(async () => {
                  const result = await api.captureWindows();
                  setWindows(result.windows);
                  setWindowIndex("");
                })
              }
            >{t("Choose a work-app window ")}</button>
            {data.capture?.running && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => run(() => api.captureStop())}
              >{t("Pause capture ")}</button>
            )}
          </div>
          {windows.length > 0 && (
            <>
              <label>{t("Window ")}<select
                  value={windowIndex}
                  onChange={(e) => setWindowIndex(e.target.value)}
                >
                  <option value="">{t("Choose an app")}</option>
                  {windows.map((item, index) => (
                    <option
                      key={`${item.processId}:${item.windowHandle}`}
                      value={index}
                    >
                      {item.app}{t(" · process ")}{item.processId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={ocr}
                  onChange={(e) => setOcr(e.target.checked)}
                />{t("Allow local OCR when accessible text is unavailable ")}</label>
              <button
                type="button"
                className="primary-button"
                disabled={busy || windowIndex === ""}
                onClick={() =>
                  run(() =>
                    api.captureStart({
                      ...windows[Number(windowIndex)],
                      allowOcr: ocr,
                    }),
                  )
                }
              >{t("Allow text capture for this window ")}</button>
            </>
          )}
        </section>
      </div>
      <details className="advanced-section">
        <summary>{t("Add selected email, document or app text")}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addTaskSource({
                ...input,
                externalId: input.externalId || crypto.randomUUID(),
                sourceTimestamp: input.sourceTimestamp || undefined,
              });
              setInput({ ...input, text: "", externalId: "" });
              setPlan(null);
            });
          }}
        >
          <label>{t("Source type ")}<select
              value={input.kind}
              onChange={(e) => setInput({ ...input, kind: e.target.value })}
            >
              <option value="email">{t("Email")}</option>
              <option value="work_app">{t("Work app")}</option>
              <option value="document">{t("Document")}</option>
            </select>
          </label>
          <label>{t("Title ")}<input
              value={input.title}
              maxLength={500}
              onChange={(e) => setInput({ ...input, title: e.target.value })}
            />
          </label>
          <label>{t("Original source time, optional ")}<input
              placeholder={t("2026-11-05T09:00:00+08:00")}
              value={input.sourceTimestamp}
              onChange={(e) =>
                setInput({ ...input, sourceTimestamp: e.target.value })
              }
            />
          </label>
          <label>{t("Source link, optional ")}<input
              type="url"
              value={input.locator}
              onChange={(e) => setInput({ ...input, locator: e.target.value })}
            />
          </label>
          <label>{t("Selected source text ")}<textarea
              required
              maxLength={40000}
              value={input.text}
              onChange={(e) => setInput({ ...input, text: e.target.value })}
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">{t("Store this selected content locally ")}</button>
        </form>
      </details>
      <section className="settings-section">
        <h3>{t("Sources and discovery")}</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={allowAI}
            onChange={(e) => setAllowAI(e.target.checked)}
          />{t("Allow the selected source text to be sent to my configured AI service when I choose Discover ")}</label>
        <p className="helper">{t("Local discovery suggests explicit requests. Ownership, cancelled requests and quoted old messages need review. Captures cover visible/exposed content only. ")}</p>
        {data.sources.map((source) => (
          <div className="source-task" key={source.id}>
            <strong>{source.title}</strong>
            {!source.revoked && (
              <details>
                <summary>{t("Read captured text")}</summary>
                <blockquote>{source.text}</blockquote>
              </details>
            )}
            <p className="helper">
              {t(source.kind.replaceAll("_", " "))} ·{" "}
              {source.revoked ? t("Removed") : source.observedAt}
            </p>
            <div className="toolbar-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || source.revoked}
                onClick={() => run(() => api.discoverTasks(source.id, allowAI))}
              >{t("Discover tasks ")}</button>
              <button
                type="button"
                className="text-button"
                disabled={busy || source.revoked}
                onClick={() =>
                  run(async () => {
                    await api.removeTaskSource(source.id);
                    setPlan(null);
                  })
                }
              >{t("Delete captured content ")}</button>
            </div>
          </div>
        ))}
      </section>
      <section className="settings-section">
        <h3>{t("Review suggestions · ")}{proposals.length}</h3>
        {proposals.length === 0 && (
          <p className="helper">{t("No pending suggestions.")}</p>
        )}
        {proposals.map((candidate) => (
          <div className="source-task" key={candidate.id}>
            <strong>{candidate.title}</strong>
            {candidate.state === "needs_review" && (
              <p className="caution">{t("Source changed. Review the current content and task status; this previous request is not reconfirmed. ")}</p>
            )}
            <blockquote>{candidate.quote}</blockquote>
            <p className="helper">
              {t(candidate.ownership)} · {sourceMap.get(candidate.sourceId)?.title}
            </p>
            {candidate.deadlineSuggestion?.deadlineDate && (
              <p className="helper">{t("Unconfirmed source date:")}{" "}
                {candidate.deadlineSuggestion.deadlineDate}
              </p>
            )}
            <div className="toolbar-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || candidate.state === "needs_review"}
                onClick={() =>
                  run(() =>
                    api.reviewCandidate(candidate.id, {
                      revision: candidate.revision,
                      state: "accepted",
                    }),
                  )
                }
              >{t("Accept as my task ")}</button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.reviewCandidate(candidate.id, {
                      revision: candidate.revision,
                      state: "dismissed",
                    }),
                  )
                }
              >{t("Dismiss ")}</button>
              <label>{t("Link to an existing task ")}<select
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value)
                      run(() =>
                        api.reviewCandidate(candidate.id, {
                          revision: candidate.revision,
                          state: "accepted",
                          taskId: e.target.value,
                        }),
                      );
                  }}
                >
                  <option value="">{t("Choose merge target…")}</option>
                  {tasks.map((task) => (
                    <option value={task.id} key={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </section>
      <section className="settings-section">
        <h3>{t("Your tasks")}</h3>
        {tasks.map((task) => (
          <div className="source-task" key={task.id}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(task.id)}
                disabled={busy}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, task.id]
                      : selected.filter((id) => id !== task.id),
                  );
                  setPlan(null);
                }}
              />
              {task.title}
            </label>
            <p className="helper">
              {t(task.status.replaceAll("_", " "))} ·{" "}
              {t((task.scope || task.confirmed?.effort?.scope || "Review scope").replaceAll("_", " "))}
            </p>
            <DurationControl
              value={
                durations[task.id] ??
                task.confirmed?.effort?.minutes ??
                task.baseline ??
                ""
              }
              onChange={(value) =>
                setDurations({ ...durations, [task.id]: value })
              }
              disabled={busy}
            />
            <div className="toolbar-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !durations[task.id]}
                onClick={() => run(() => saveDuration(task))}
              >{t("Save selected duration ")}</button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setEditing(task)}
              >{t("Review scope, deadline and status ")}</button>
            </div>
          </div>
        ))}
      </section>
      <section className="settings-section">
        <h3>{t("Prepare a draft")}</h3>
        <label>{t("Planning date (")}{w.settings.timezone})
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPlan(null);
            }}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() =>
            run(async () =>
              setPlan(
                await api.prepareTaskPlan({
                  taskIds: selected,
                  targetDate: date,
                }),
              ),
            )
          }
        >{t("Prepare selected tasks ")}</button>
        {plan && (
          <>
            <PlanningTasks analysis={{ contract: plan.contract }} />
            {plan.contract.plan.blocks.map((block) => (
              <p key={block.id}>
                {plan.contract.tasks.find((t) => t.id === block.taskId)?.title}{" "}
                ·{" "}
                {new Intl.DateTimeFormat(getLocale(), {
                  timeZone: w.settings.timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(block.startsAt))}
                –
                {new Intl.DateTimeFormat(getLocale(), {
                  timeZone: w.settings.timezone,
                  timeStyle: "short",
                }).format(new Date(block.endsAt))}
              </p>
            ))}
            <button
              className="primary-button"
              type="button"
              disabled={
                busy || plan.applied || !plan.contract.plan.blocks.length
              }
              onClick={() =>
                run(async () => {
                  setPlan(await api.applyTaskPlan(plan.id));
                  await w.reloadEvents();
                })
              }
            >
              {plan.applied ? t("Added to calendar") : t("Add reviewed draft to calendar")}
            </button>
          </>
        )}
      </section>
      <section className="settings-section">
        <h3>{t("Actual active effort")}</h3>
        <p className="helper">{t("Record the active total for the same scope and original plan. Include all sessions; exclude breaks and waiting. Calendar reservations and slider edits are kept separate. ")}</p>
        <label>{t("Task from the current plan ")}<select
            value={outcomeTask}
            disabled={Boolean(timer.startedAt)}
            onChange={(e) => {
              setOutcomeTask(e.target.value);
              setReceipt(crypto.randomUUID());
              setTimer({ taskId: null, startedAt: null, elapsed: 0 });
              setActual("");
            }}
          >
            <option value="">{t("Choose a planned task")}</option>
            {plan?.contract.tasks.map((task) => (
              <option value={task.id} key={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!outcomeTask || Boolean(timer.startedAt)}
            onClick={() =>
              setTimer({ ...timer, taskId: outcomeTask, startedAt: Date.now() })
            }
          >{t("Start / resume ")}</button>
          <button
            type="button"
            className="secondary-button"
            disabled={!timer.startedAt}
            onClick={pauseTimer}
          >{t("Pause ")}</button>
        </div>
        <p className="helper" role="status">
          {timer.startedAt ? t("Timer running on this screen. Pause before leaving.") : t("Timer paused. You may enter the active total manually.")}
        </p>
        <label>{t("Actual active minutes ")}<input
            type="number"
            min={1}
            max={525600}
            value={actual}
            disabled={Boolean(timer.startedAt)}
            onChange={(e) => setActual(e.target.value)}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => setCompleted(e.target.checked)}
          />{t("This completes the same scope estimated in the plan ")}</label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !outcomeTask || !actual || Boolean(timer.startedAt)}
          onClick={() =>
            run(async () => {
              await api.recordTaskEffort(outcomeTask, {
                planId: plan.id,
                actualMinutes: Number(actual),
                completed,
                receipt,
              });
              w.notify("Active-effort outcome saved.");
            })
          }
        >{t("Save measured outcome ")}</button>
      </section>
    </div>
  );
}
