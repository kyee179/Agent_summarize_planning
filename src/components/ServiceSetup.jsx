import { useEffect, useState } from 'react';

export function ServiceSetup({ settings, busy = false }) {
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
      setStatus(result); setKey(''); setSearch(''); setGoogle(''); setRestart(true); setMessage('Saved securely. Restart the app to use these settings.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  return <section className="settings-section"><h2>Set up your services</h2><p className="muted">Start with local rules, or connect services using your own credentials. Optional sources still require permission for each analysis.</p>
    {!desktop ? <p className="helper">Local rules work here. Open the desktop app to save service credentials securely.</p> : <form onSubmit={save}>
      <p className="helper">Credentials are encrypted through your operating system and stay on this computer. Blank password fields keep saved credentials.</p>
      {status?.recoveryRequired && <p role="alert">Saved credentials could not be unlocked. Restore the original OS profile or contact support; local rules remain available.</p>}
      <fieldset disabled={saving || busy || !status?.secureStorage || status?.recoveryRequired} className="editor-fields">
        <label>AI service for this device<select value={provider} onChange={e => { setProvider(e.target.value); setKey(''); setModel(''); }}>{['local', 'glm', 'openai', 'groq', 'gemini'].map(value => <option key={value} value={value}>{value === 'local' ? 'Local rules · no key needed' : value.toUpperCase()}</option>)}</select></label>
        {provider !== 'local' && <><label>Service API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} maxLength={4096} placeholder={status?.configured?.[`${provider.toUpperCase()}_API_KEY`] ? 'Already configured' : 'Enter your key'} /></label><label>Model, optional<input value={model} onChange={e => setModel(e.target.value)} maxLength={200} placeholder={provider === 'glm' ? 'glm-4-flash' : 'Keep the service default'} /></label></>}
        <details><summary>Optional connections</summary><label>Tavily search key<input type="password" autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} maxLength={4096} placeholder={status?.configured?.TAVILY_API_KEY ? 'Already configured' : 'Optional'} /></label>
          <label>Google Desktop OAuth JSON<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 16000) { setMessage('Choose a Desktop OAuth JSON smaller than 16 KB.'); return; } setGoogle(await file.text()); }} /></label><p className="helper">Choose your Desktop client download. After restarting, use Connections to sign in and grant read-only Calendar access.</p></details>
        <button className="primary-button" type="submit">{saving ? 'Saving…' : 'Save service setup'}</button>
      </fieldset>
      {status && !status.secureStorage && <p role="alert">Secure OS storage is unavailable. Configure the system key store to save credentials; local rules remain available.</p>}
      <p role="status">{message}</p>{restart && <button className="secondary-button" type="button" disabled={busy || saving} onClick={() => window.studyCalendar.restart()}>Restart app</button>}
    </form>}
  </section>;
}
