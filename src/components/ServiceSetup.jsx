import { t, useLocale, messageText } from '../i18n/index.js';
import { useEffect, useState } from 'react';

export function ServiceSetup({ settings, busy = false }) {
  useLocale();
  const [status, setStatus] = useState(null), [message, setMessage] = useState(''), [saving, setSaving] = useState(false), [restart, setRestart] = useState(false);
  const [provider, setProvider] = useState(settings.effectiveAiProvider || settings.aiProvider || 'local');
  const [key, setKey] = useState(''), [model, setModel] = useState(''), [search, setSearch] = useState(''), [google, setGoogle] = useState('');
  const desktop = Boolean(window.studyCalendar?.saveSetup);
  useEffect(() => { if (desktop) window.studyCalendar.setupStatus().then(setStatus).catch(() => setMessage('Secure setup could not load. Local rules remain available.')); }, [desktop]);
  async function save(event) {
    event.preventDefault(); if (saving || busy) return;
    setSaving(true); setMessage('');
    try {
      const prefix = provider.toUpperCase();
      const input = { AI_PROVIDER: provider };
      if (provider !== 'local') { if (key) input[`${prefix}_API_KEY`] = key; if (model) input[`${prefix}_MODEL`] = model; }
      if (search) { input.TAVILY_API_KEY = search; input.WEB_SEARCH_PROVIDER = 'tavily'; }
      if (google) input.googleDesktopJson = google;
      const result = await window.studyCalendar.saveSetup(input);
      setStatus(result); setKey(''); setSearch(''); setGoogle(''); setRestart(result.restartRequired !== false); setMessage(result.sessionChanged ? 'Saved securely for this workspace.' : 'Saved securely. Restart the app to use these settings.');
      if (result.sessionChanged) window.dispatchEvent(new Event('calendar:auth-changed'));
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  return <section className="settings-section"><h2>{t("Set up your services")}</h2><p className="muted">{t("Start with local rules, or connect services using your own credentials. Optional sources still require permission for each analysis.")}</p>
    {!desktop ? <p className="helper">{t("Local rules work here. Open the desktop app to save service credentials securely.")}</p> : <form onSubmit={save}>
      <p className="helper">{t("Credentials are encrypted through your operating system and stay on this computer. Blank password fields keep saved credentials.")}</p>
      {status?.recoveryRequired && <p role="alert">{t("Saved credentials could not be unlocked. Restore the original OS profile or contact support; local rules remain available.")}</p>}
      <fieldset disabled={saving || busy || !status?.secureStorage || status?.recoveryRequired} className="editor-fields">
        <label>{t("AI service for this workspace")}<select value={provider} onChange={e => { setProvider(e.target.value); setKey(''); setModel(''); }}>{['local', 'glm', 'openai', 'groq', 'gemini'].map(value => <option key={value} value={value}>{value === 'local' ? t("Local rules · no key needed") : value.toUpperCase()}</option>)}</select></label>
        {provider !== 'local' && <><label>{t("Service API key")}<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} maxLength={4096} placeholder={status?.configured?.[`${provider.toUpperCase()}_API_KEY`] ? t("Already configured") : t("Enter your key")} /></label><label>{t("Model, optional")}<input value={model} onChange={e => setModel(e.target.value)} maxLength={200} placeholder={provider === 'glm' ? t("glm-4-flash") : t("Keep the service default")} /></label></>}
        <details><summary>{t("Optional connections")}</summary><label>{t("Tavily search key")}<input type="password" autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} maxLength={4096} placeholder={status?.configured?.TAVILY_API_KEY ? t("Already configured") : t("Optional")} /></label>
          <label>{t("Google Desktop OAuth JSON")}<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 16000) { setMessage('Choose a Desktop OAuth JSON smaller than 16 KB.'); return; } setGoogle(await file.text()); }} /></label><p className="helper">{t("Choose your Desktop client download. After saving, use Connections to sign in and grant read-only Calendar access.")}</p></details>
        <button className="primary-button" type="submit">{saving ? t("Saving…") : t("Save service setup")}</button>
      </fieldset>
      {status && !status.secureStorage && <p role="alert">{t("Secure OS storage is unavailable. Configure the system key store to save credentials; local rules remain available.")}</p>}
      <p role="status">{messageText(message)}</p>{restart && <button className="secondary-button" type="button" disabled={busy || saving} onClick={() => window.studyCalendar.restart()}>{t("Restart app")}</button>}
    </form>}
  </section>;
}
