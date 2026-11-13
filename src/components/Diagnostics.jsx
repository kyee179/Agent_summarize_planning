import { t, useLocale, messageText } from '../i18n/index.js';
import { useState } from 'react';
import { api } from '../api.js';

const explanations = {
  high_fallback_rate: 'Frequent AI fallback: check provider credentials and failed workflow reasons.',
  slow_analysis: 'Analysis latency is high. Review provider spans and timeouts.',
  high_api_error_rate: 'API failures are frequent. Review request status codes and database readiness.',
  trace_storage_unavailable: 'Trace files could not be written. Check disk space and directory permissions.',
  database_unavailable: 'Database check failed. Stop writes and follow the recovery guide.',
  google_cache_needs_sync: 'Google Calendar cache needs a fresh sync before planning.'
};
export function Diagnostics() {
  useLocale();
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError('');
    try { setResult(await api.diagnostics()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label={t("System health")}>
    <h2>{t("System health")}</h2>
    <p>{t("Local diagnostics record timing, tool names, outcomes and token counts. Journal text, browser activity, queries and credentials are excluded.")}</p>
    <button type="button" onClick={refresh} disabled={busy}>{busy ? t("Checking…") : t("Check health")}</button>
    {error && <p role="alert">{messageText(error)}</p>}
    {result && <>
      <p role="status">{result.ready ? t("Database ready") : t("Database unavailable")}{t(" · app ")}{result.appVersion}{t(" · schema ")}{result.database.schemaVersion}{t(" · prompt ")}{result.promptVersion}</p>
      <p>{t("Last ")}{result.telemetry.windowMinutes}{t(" minutes (up to ")}{result.telemetry.sampleLimit}{t(" trace records): ")}{result.telemetry.window.analysisSamples}{t(" analyses · fallback ")}{result.telemetry.window.fallbackRate === null ? t("no samples") : `${Math.round(result.telemetry.window.fallbackRate * 100)}%`}{t(" · p95 ")}{result.telemetry.window.p95Ms === null ? t("no samples") : t("{p0} ms", {p0: result.telemetry.window.p95Ms})}.</p>
      <p>{t("Counts reset when the app restarts. Alerts require 5 analyses or 10 API requests. Trace files rotate locally; no remote exporter is enabled.")}</p>
      {result.alerts.length > 0 ? <ul>{result.alerts.map((alert) => <li key={alert}>{explanations[alert] || alert}</li>)}</ul> : <p>{t("No current alerts. This does not measure summary correctness.")}</p>}
      <details><summary>{t("Recent traces")}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.telemetry.recent, null, 2)}</pre></details>
    </>}
  </section>;
}
