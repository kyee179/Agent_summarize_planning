import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronLeft } from 'lucide-react';
import { api } from '../api.js';
import { deviceTimezone } from '../lib/dates.js';

export function Onboarding({ account, onComplete, onSignOut }) {
  const preferences = account.preferences || {};
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [timezone, setTimezone] = useState(preferences.timezone || deviceTimezone);
  const [from, setFrom] = useState(preferences.defaultAvailability?.[0]?.startsAt || '09:00'), [to, setTo] = useState(preferences.defaultAvailability?.[0]?.endsAt || '17:00');
  const [lead, setLead] = useState(preferences.planningLeadMinutes || 5);
  const [provider, setProvider] = useState(account.existingServices?.effectiveAiProvider || preferences.aiProvider || 'local');
  const [key, setKey] = useState(''), [model, setModel] = useState('');
  const [copyLocal, setCopyLocal] = useState(false), [sourceId, setSourceId] = useState(account.localProfiles?.find(profile => profile.hasData)?.id || 'local'), [copied, setCopied] = useState(false);
  const configured = Boolean(account.setup?.configured?.[provider.toUpperCase() + '_API_KEY']);
  const canCopy = account.session.kind === 'account' && account.localProfiles?.some(profile => profile.hasData);
  async function submit(event) {
    event.preventDefault(); if (busy) return; setError('');
    if (step === 0) { try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { setError('Choose a valid timezone.'); return; } if (from >= to) { setError('Available until must be later than Available from.'); return; } }
    if (step === 1 && provider !== 'local' && !configured && !key.trim()) { setError('Add a service key or choose local rules.'); return; }
    if (step < 2) { setStep(value => value + 1); return; }
    setBusy(true);
    try {
      if (copyLocal && !copied) { await api.importLocal(sourceId); setCopied(true); }
      const input = { timezone, defaultAvailability: [{ label: 'Focus time', startsAt: from, endsAt: to }], planningLeadMinutes: Number(lead), aiProvider: provider };
      if (provider !== 'local' && key.trim()) input.services = { [provider.toUpperCase() + '_API_KEY']: key.trim(), ...(model.trim() ? { [provider.toUpperCase() + '_MODEL']: model.trim() } : {}) };
      onComplete(await api.finishOnboarding(input));
    } catch (failure) { setError(failure.message); }
    finally { setKey(''); setBusy(false); }
  }
  return <main className="onboarding-shell"><header className="onboarding-header"><div className="auth-brand"><span className="brand-icon"><CalendarDays size={24} /></span><strong>Calendar</strong></div><button type="button" className="text-button" disabled={busy} onClick={onSignOut}>{account.session.kind === 'account' ? 'Sign out' : 'Choose a different workspace'}</button></header>
    <section className="onboarding-card" aria-labelledby="onboarding-title"><ol className="onboarding-steps" aria-label="Setup progress">{['Your routine', 'Planning', 'Your workspace'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
      <div className="onboarding-heading"><p className="subtle-label">{account.session.kind === 'account' ? account.session.name : 'Your local workspace'}</p><h1 id="onboarding-title">{['Make room for your day', 'Choose how to prepare plans', 'A workspace that belongs to you'][step]}</h1><p className="muted">{['Set the timezone and hours your plans can use.', 'Start with local rules or connect your own AI service.', 'Your journals stay on this device. Optional sources start off.'][step]}</p></div>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <form onSubmit={submit}><fieldset className="editor-fields" disabled={busy}>
        {step === 0 && <><label>Timezone<input required list="onboarding-timezones" value={timezone} onChange={e => setTimezone(e.target.value)} /><datalist id="onboarding-timezones">{['UTC', ...Intl.supportedValuesOf('timeZone')].map(zone => <option key={zone} value={zone} />)}</datalist></label><div className="field-grid"><label>Available from<input required type="time" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Available until<input required value={to} pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="17:00 or 24:00" onChange={e => setTo(e.target.value)} /></label></div><label>Minutes to review before a plan starts<input required type="number" min={1} max={120} value={lead} onChange={e => setLead(e.target.value)} /></label><p className="helper">Existing commitments and buffers are reserved. You can change these hours later.</p></>}
        {step === 1 && <><label>Planning service<select value={provider} onChange={e => { setProvider(e.target.value); setKey(''); setModel(''); }}><option value="local">Local rules · no key needed</option>{['glm', 'openai', 'gemini', 'groq'].map(value => <option key={value} value={value}>{value.toUpperCase()} · your own key</option>)}</select></label>
          {provider === 'local' ? <div className="onboarding-choice"><Check size={20} /><div><strong>Ready without an account or API key</strong><p className="muted">Local rules provide basic task suggestions. You review estimates and dates before applying a plan.</p></div></div> : <><p className="helper">Journal excerpts and authorized planning context may be sent to this AI service. Your service may charge for requests.</p>{configured && <p className="helper">This service is already configured for this profile. Leave the key blank to keep it.</p>}<label>Service API key<input type="password" autoComplete="off" value={key} maxLength={4096} disabled={!account.setup?.secureStorage} placeholder={configured ? 'Already configured' : 'Enter your own key'} onChange={e => setKey(e.target.value)} /></label><label>Model, optional<input value={model} maxLength={200} onChange={e => setModel(e.target.value)} /></label>{!account.setup?.secureStorage && <p className="caution">Open the desktop app to save a new service key securely, or use local rules.</p>}</>}
          <p className="helper">Calendar access, memory search, web search and activity recording each need separate permission.</p></>}
        {step === 2 && <><div className="onboarding-summary"><div><span>Workspace</span><strong>{account.session.kind === 'account' ? account.session.email : 'Local · on this device'}</strong></div><div><span>Timezone</span><strong>{timezone}</strong></div><div><span>Planning hours</span><strong>{from}–{to}</strong></div><div><span>Planning service</span><strong>{provider === 'local' ? 'Local rules' : provider.toUpperCase()}</strong></div></div>
          {canCopy && <div className="onboarding-import"><label className="check-row"><input type="checkbox" checked={copyLocal} disabled={copied} onChange={e => setCopyLocal(e.target.checked)} />Copy my local workspace into this account</label>{copyLocal && <label>Local workspace<select value={sourceId} disabled={copied} onChange={e => setSourceId(e.target.value)}>{account.localProfiles.filter(profile => profile.hasData).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}<p className="helper">Copies journals, calendar events, tasks and notes into an empty workspace. The original remains. Connections, activity and old plans are excluded.</p>{copied && <p role="status">Your local data has been copied.</p>}</div>}
          <p className="helper">Signing in keeps accounts separate on this computer. Cloud data sync is not enabled. You can export your workspace from Account.</p></>}
      </fieldset><footer className="onboarding-actions">{step > 0 ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { setStep(value => value - 1); setError(''); }}><ChevronLeft size={15} />Back</button> : <span />}<button type="submit" className="primary-button" disabled={busy}>{busy ? 'Preparing your workspace…' : step < 2 ? 'Continue' : 'Open my workspace'}<ArrowRight size={16} /></button></footer></form>
    </section></main>;
}
