import { t, useLocale, getLocale } from '../i18n/index.js';
export function PlanningTasks({ analysis, selectedTaskId = null, onEdit }) {
  useLocale();
  const contract = analysis.contract;
  if (!contract) {
    return <section><h3>{t("Tasks")}</h3><p className="caution">{t("Saved legacy analysis. Analyze again to see evidence and estimate uncertainty.")}</p>
      {analysis.tasks?.map((task, index) => <div className="task-pill" key={index}><strong>{task.title}</strong>
        <small>{t(task.priority)}{t(" priority · ")}{task.estimatedMinutes ?? t("Unknown")}{t(" min")}</small></div>)}</section>;
  }
  const estimates = new Map(contract.estimates.map((item) => [item.id, item]));
  const evidence = new Map(contract.evidence.map((item) => [item.id, item]));
  return <>
    <section><h3>{t("Tasks")}</h3>{contract.tasks.length ? contract.tasks.filter(task => !selectedTaskId || task.id === selectedTaskId).map((task) => {
      const estimate = estimates.get(task.estimateId), range = estimate?.effortMinutes;
      const sourceIds = [...new Set([...task.evidenceIds, ...task.importance.evidenceIds,
        ...(task.deadline?.evidenceIds || []), ...(estimate?.evidenceIds || [])])];
      return <div className="task-pill" key={task.id}>
        <strong>{task.title}</strong>
        {onEdit && analysis.persistentTasks?.some(item => item.id === task.id) && <button type="button" className="text-button" onClick={() => onEdit(task)}>{t("Confirm or edit facts")}</button>}
        <small>{t(task.importance.level)}{t(" importance (")}{t(task.importance.basis)}) · {t(task.status.replaceAll("_", " "))}</small>
        <small>{range ? t("{p0} min planning estimate ({p1}–{p2} min range)", {p0: range.expected, p1: range.low, p2: range.high}) : t("Effort unknown")}</small>
        {estimate && <small>{t(estimate.confidence)}{t(" confidence · ")}{t(estimate.basis.replaceAll("_", " "))} · {t(estimate.scope.replaceAll("_", " "))}</small>}
        <small>{task.deadline ? t("Deadline: {p0}", {p0: new Intl.DateTimeFormat(getLocale(), { timeZone: contract.plan.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(task.deadline.at))}) : t("Deadline unknown")}</small>
        <details><summary>{t("Evidence and assumptions")}</summary>
          <p>{task.importance.reason}</p>
          {sourceIds.map((id) => {
            const source = evidence.get(id);
            return <blockquote key={id}><p>{source.excerpt}</p><small>{t(source.sourceType)} · {t(source.verification.replaceAll("_", " "))}</small>
              {source.locator && <a href={source.locator} target="_blank" rel="noreferrer">{t("Open source")}</a>}</blockquote>;
          })}
          {estimate?.assumptions.map((assumption) => <p key={assumption}>{assumption}</p>)}
          {task.clarificationQuestions.map((question) => <p key={question}>{question}</p>)}
        </details>
      </div>;
    }) : <p className="empty-state">{t("No tasks extracted.")}</p>}</section>
    {contract.plan.unscheduled.length > 0 && <section><h3>{t("Unscheduled work")}</h3>{contract.plan.unscheduled.map((item) => <p key={item.taskId}>
      <strong>{contract.tasks.find((task) => task.id === item.taskId).title}</strong>: {item.explanation}
    </p>)}</section>}
  </>;
}
