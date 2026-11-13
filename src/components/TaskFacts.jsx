import { t, useLocale, messageText } from '../i18n/index.js';
import { useState } from "react";
import { EstimateFeatures } from "./EstimateFeatures.jsx";
import { DurationControl } from "./DurationControl.jsx";
import { Dialog } from "./Dialog.jsx";
import { api } from "../api.js";
import { inputTime, wallTimeToISO } from "../lib/dates.js";

export function TaskFacts({ task, record, tasks, timezone, onClose, onSaved }) {
  useLocale();
  const confirmed = record.confirmed;
  const [estimateFeatures, setEstimateFeatures] = useState(
    record.features?.reviewed
      ? {
          category:
            record.features.category === "unknown"
              ? ""
              : record.features.category,
          unit: record.features.declaredUnit || "",
          quantity: record.features.quantity,
          revise_or_create: record.features.revise_or_create || "",
          complexity: record.features.complexity,
          familiarity: record.features.familiarity,
        }
      : {},
  );
  const [useSuggested, setUseSuggested] = useState(!("effort" in confirmed));
  const [title, setTitle] = useState(record.title),
    [status, setStatus] = useState(record.status);
  const [deadline, setDeadline] = useState(
    confirmed.deadline ? inputTime(confirmed.deadline.at, timezone) : "",
  );
  const [kind, setKind] = useState(confirmed.deadline?.kind || "hard");
  const [minutes, setMinutes] = useState(
      "effort" in confirmed
        ? (confirmed.effort?.minutes ?? "")
        : (record.candidates?.effortMinutes ?? record.baseline ?? ""),
    ),
    [scope, setScope] = useState(confirmed.effort?.scope || record.scope || record.features?.scope || "next_session");
  const [importance, setImportance] = useState(
    confirmed.importance || task.importance.level,
  );
  const [dependencies, setDependencies] = useState(
    confirmed.dependsOn || task.dependsOn,
  );
  const [again, setAgain] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const patch = {
        revision: record.revision,
        title,
        status,
        deadline: deadline
          ? { at: wallTimeToISO(deadline, timezone), kind }
          : null,
        effort: minutes !== "" ? { minutes: Number(minutes), scope } : null,
        dependsOn: dependencies,
        requestNewSession: again,
        useEstimatedEffort: useSuggested,
        estimateScope: scope,
      };
      if (
        record.features?.reviewed ||
        Object.values(estimateFeatures).some(
          (value) => value !== null && value !== "",
        )
      )
        patch.estimateFeatures = estimateFeatures;
      patch.importance = importance === "unknown" ? null : importance;
      await api.updateTask(task.id, patch);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={t("Confirm task facts")} onClose={onClose} busy={saving}>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <p>{t("These are your confirmed facts. Generate a new plan after saving; existing calendar events keep their reviewed times. ")}</p>
          {record.candidates?.deadlineDate && (
            <p className="caution">{t("Source date suggestion: ")}{record.candidates.deadlineDate}{" "}
              {record.candidates.deadlineTime || t("(time unspecified)")}{t(" in")}{" "}
              {record.candidates.timezone}{t(". Check the source and choose an explicit time below to confirm it. ")}</p>
          )}
          {record.candidates?.deadlineInstant &&
            !record.candidates.ambiguities?.length && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setDeadline(
                    inputTime(record.candidates.deadlineInstant, timezone),
                  )
                }
              >{t("Use source date suggestion ")}</button>
            )}
          {record.candidates?.period && !record.candidates.deadlineTime && (
            <p className="helper">{t("The source names a time of day (")}{record.candidates.period}{t("), but no exact hour. Choose a time to confirm. ")}</p>
          )}
          {record.candidates?.ambiguities?.map((message) => (
            <p key={message} className="caution">
              {messageText(message)}
            </p>
          ))}
          <fieldset disabled={saving} className="editor-fields">
            <label>{t("Task title ")}<input
                required
                maxLength={500}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>{t("Task status ")}<select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "open",
                  "in_progress",
                  "blocked",
                  "completed",
                  "cancelled",
                ].map((v) => (
                  <option key={v} value={v}>
                    {t(v.replaceAll("_", " "))}
                  </option>
                ))}
              </select>
            </label>
            <label>{t("Confirmed deadline (")}{timezone})
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <label>{t("Deadline type ")}<select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="hard">{t("Must finish by this time")}</option>
                <option value="target">{t("Preferred target")}</option>
              </select>
            </label>
            <DurationControl
              label={t("Confirmed effort in minutes")}
              value={minutes}
              onChange={(value) => {
                setMinutes(value);
                setUseSuggested(false);
              }}
            />
            <label>{t("Effort covers ")}<select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="next_session">{t("One work session")}</option>
                <option value="remaining_task">{t("All remaining work")}</option>
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={useSuggested}
                onChange={(e) => setUseSuggested(e.target.checked)}
              />{t("Use the history-informed estimate instead of fixing a selected duration ")}</label>
            <EstimateFeatures
              value={estimateFeatures}
              onChange={setEstimateFeatures}
            />
            <label>{t("Importance ")}<select
                value={importance}
                onChange={(e) => setImportance(e.target.value)}
              >
                {["unknown", "low", "medium", "high"].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t("Depends on")}</legend>
              {tasks
                .filter((t) => t.id !== task.id)
                .map((t) => (
                  <label className="check-row" key={t.id}>
                    <input
                      type="checkbox"
                      checked={dependencies.includes(t.id)}
                      onChange={(e) =>
                        setDependencies((current) =>
                          e.target.checked
                            ? [...current, t.id]
                            : current.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.title}
                  </label>
                ))}
            </fieldset>
            {record.sessionEventIds.length > 0 && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={again}
                  onChange={(e) => setAgain(e.target.checked)}
                />{t("I want another work session for this task ")}</label>
            )}
          </fieldset>
          {error && <p role="alert">{messageText(error)}</p>}
        </div>
        <footer className="dialog-actions">
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? t("Saving…") : t("Confirm and save facts")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
