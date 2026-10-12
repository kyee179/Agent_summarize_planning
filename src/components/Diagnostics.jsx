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
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError('');
    try { setResult(await api.diagnostics()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="System health">
    <h2>System health</h2>
    <p>Local diagnostics record timing, tool names, outcomes and token counts. Journal text, browser activity, queries and credentials are excluded.</p>
    <button type="button" onClick={refresh} disabled={busy}>{busy ? 'Checking…' : 'Check health'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">{result.ready ? 'Database ready' : 'Database unavailable'} · app {result.appVersion} · schema {result.database.schemaVersion} · prompt {result.promptVersion}</p>
      <p>Last {result.telemetry.windowMinutes} minutes (up to {result.telemetry.sampleLimit} trace records): {result.telemetry.window.analysisSamples} analyses · fallback {result.telemetry.window.fallbackRate === null ? 'no samples' : `${Math.round(result.telemetry.window.fallbackRate * 100)}%`} · p95 {result.telemetry.window.p95Ms === null ? 'no samples' : `${result.telemetry.window.p95Ms} ms`}.</p>
      <p>Counts reset when the app restarts. Alerts require 5 analyses or 10 API requests. Trace files rotate locally; no remote exporter is enabled.</p>
      {result.alerts.length > 0 ? <ul>{result.alerts.map((alert) => <li key={alert}>{explanations[alert] || alert}</li>)}</ul> : <p>No current alerts. This does not measure summary correctness.</p>}
      <details><summary>Recent traces</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.telemetry.recent, null, 2)}</pre></details>
    </>}
  </section>;
}
