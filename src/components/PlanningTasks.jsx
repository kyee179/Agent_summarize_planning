export function PlanningTasks({ analysis, selectedTaskId = null, onEdit }) {
  const contract = analysis.contract;
  if (!contract) {
    return <section><h3>Tasks</h3><p className="caution">Saved legacy analysis. Analyze again to see evidence and estimate uncertainty.</p>
      {analysis.tasks?.map((task, index) => <div className="task-pill" key={index}><strong>{task.title}</strong>
        <small>{task.priority} priority · {task.estimatedMinutes ?? "Unknown"} min</small></div>)}</section>;
  }
  const estimates = new Map(contract.estimates.map((item) => [item.id, item]));
  const evidence = new Map(contract.evidence.map((item) => [item.id, item]));
  return <>
    <section><h3>Tasks</h3>{contract.tasks.length ? contract.tasks.filter(task => !selectedTaskId || task.id === selectedTaskId).map((task) => {
      const estimate = estimates.get(task.estimateId), range = estimate?.effortMinutes;
      const sourceIds = [...new Set([...task.evidenceIds, ...task.importance.evidenceIds,
        ...(task.deadline?.evidenceIds || []), ...(estimate?.evidenceIds || [])])];
      return <div className="task-pill" key={task.id}>
        <strong>{task.title}</strong>
        {onEdit && analysis.persistentTasks?.some(item => item.id === task.id) && <button type="button" className="text-button" onClick={() => onEdit(task)}>Confirm or edit facts</button>}
        <small>{task.importance.level} importance ({task.importance.basis}) · {task.status.replaceAll("_", " ")}</small>
        <small>{range ? `${range.expected} min expected (${range.low}–${range.high} min range)` : "Effort unknown"}</small>
        {estimate && <small>{estimate.confidence} confidence · {estimate.basis.replaceAll("_", " ")} · {estimate.scope.replaceAll("_", " ")}</small>}
        <small>{task.deadline ? `Deadline: ${new Intl.DateTimeFormat(undefined, { timeZone: contract.plan.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(task.deadline.at))}` : "Deadline unknown"}</small>
        <details><summary>Evidence and assumptions</summary>
          <p>{task.importance.reason}</p>
          {sourceIds.map((id) => {
            const source = evidence.get(id);
            return <blockquote key={id}><p>{source.excerpt}</p><small>{source.sourceType} · {source.verification.replaceAll("_", " ")}</small>
              {source.locator && <a href={source.locator} target="_blank" rel="noreferrer">Open source</a>}</blockquote>;
          })}
          {estimate?.assumptions.map((assumption) => <p key={assumption}>{assumption}</p>)}
          {task.clarificationQuestions.map((question) => <p key={question}>{question}</p>)}
        </details>
      </div>;
    }) : <p className="empty-state">No tasks extracted.</p>}</section>
    {contract.plan.unscheduled.length > 0 && <section><h3>Unscheduled work</h3>{contract.plan.unscheduled.map((item) => <p key={item.taskId}>
      <strong>{contract.tasks.find((task) => task.id === item.taskId).title}</strong>: {item.explanation}
    </p>)}</section>}
  </>;
}
