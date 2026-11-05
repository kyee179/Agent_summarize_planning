const VERSION = "history-shrinkage-v1";
function estimate({
  baseline,
  low = baseline / 2,
  high = baseline * 2,
  features,
  history = [],
  now = new Date().toISOString(),
}) {
  if (
    !Number.isFinite(baseline) ||
    baseline < 1 ||
    baseline > 525600 ||
    !features?.category ||
    !features?.scope
  )
    return {
      version: VERSION,
      minutes: null,
      basis: "unknown",
      reason: "Confirm deliverable, scope and a baseline before estimating.",
    };
  const distinct = [
    ...new Map(
      history.map((x, index) => [
        x.taskId
          ? [x.taskId, x.generation || 0, x.features?.scope].join(":")
          : x.id || index,
        x,
      ]),
    ).values(),
  ];
  const matches = distinct
    .filter(
      (x) =>
        x.completed === true &&
        x.actualMinutes > 0 &&
        x.baseline > 0 &&
        x.features?.category === features.category &&
        x.features?.scope === features.scope &&
        x.features?.unit === features.unit &&
        x.baselineVersion === (features.baselineVersion || "scoped-v1") &&
        Number.isFinite(Date.parse(x.completedAt)) &&
        Date.parse(x.completedAt) <= Date.parse(now),
    )
    .map((x) => ({
      r: Math.log(x.actualMinutes / x.baseline),
      w:
        2 **
        (-((Date.parse(now) - Date.parse(x.completedAt)) / 86400000) / 180),
    }))
    .sort((a, b) => a.r - b.r);
  const weight = matches.reduce((sum, x) => sum + x.w, 0);
  let correction = 0,
    cumulative = 0;
  for (const item of matches) {
    cumulative += item.w;
    if (cumulative >= weight / 2) {
      correction = item.r;
      break;
    }
  }
  const raw = baseline * Math.exp((weight / (weight + 5)) * correction);
  if (!Number.isFinite(raw) || raw > 525600)
    return {
      version: VERSION,
      minutes: null,
      basis: "unknown",
      reason: "Break this work into smaller scoped tasks.",
    };
  const predicted = Math.max(1, Math.round(raw));
  return {
    version: VERSION,
    baseline,
    rawMinutes: raw,
    minutes: predicted,
    low: Math.max(1, Math.floor(Math.min(low, predicted))),
    high: Math.min(525600, Math.ceil(Math.max(high, predicted))),
    basis: matches.length ? "personal_history" : "model",
    comparableTasks: matches.length,
    evidenceWeight: weight,
    calibrated: false,
    features,
  };
}
module.exports = { estimate, VERSION };
