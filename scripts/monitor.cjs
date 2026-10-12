const { loadEnvironment } = require('../server/environment.cjs');
loadEnvironment();
async function main() {
  const port = Number(process.env.PORT || 4010);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !process.env.LOCAL_API_TOKEN) throw new Error('Configure the local API port and token.');
  const response = await fetch(`http://127.0.0.1:${port}/api/diagnostics`, { headers: { Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok && response.status !== 503) throw new Error('Authenticated monitoring request failed.');
  const result = await response.json();
  // A compact check suitable for a local health probe; never print individual traces.
  console.log(JSON.stringify({ ready: result.ready, alerts: result.alerts, window: result.telemetry.window, persistence: result.telemetry.persistence }, null, 2));
  if (!result.ready || result.alerts.length) process.exitCode = 1;
}
main().catch(() => { console.error('Local API monitoring unavailable. Check that the API is running and credentials match.'); process.exitCode = 2; });
