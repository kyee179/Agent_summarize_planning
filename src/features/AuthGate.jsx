import { LanguageSwitch } from '../components/LanguageSwitch.jsx';
import { t, useLocale, messageText } from '../i18n/index.js';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronLeft, LockKeyhole, Mail } from 'lucide-react';
import { api, invalidateRequests } from '../api.js';
import App from '../App.jsx';
import { Onboarding } from './Onboarding.jsx';

export function AuthGate() {
  useLocale();
  const [status, setStatus] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('signin'), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [address, setAddress] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [name, setName] = useState('');
  const [code, setCode] = useState(''), [remember, setRemember] = useState(false), [composing, setComposing] = useState(false);
  const [projectUrl, setProjectUrl] = useState(''), [publishableKey, setPublishableKey] = useState(''), [revision, setRevision] = useState(0);
  function entered(next) { invalidateRequests(); setStatus(next); setPassword(''); setConfirmation(''); setCode(''); setError(''); setMessage(''); setRevision(value => value + 1); }
  const refresh = useCallback(async () => {
    try { const next = await api.authStatus(); setStatus(next); setError(''); }
    catch (failure) { if (failure.name !== 'AbortError') { setStatus(null); setError(failure.message); } }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => { invalidateRequests(); setStatus(current => current ? { ...current, session: null } : null); setPassword(''); setConfirmation(''); setMode('signin'); setError('Your session ended. Sign in or open a local workspace.'); };
    const changed = () => { invalidateRequests(); setStatus(current => current ? { ...current, session: null } : null); setLoading(true); setRevision(value => value + 1); refresh(); };
    window.addEventListener('calendar:session-expired', expired); window.addEventListener('calendar:auth-changed', changed);
    return () => { window.removeEventListener('calendar:session-expired', expired); window.removeEventListener('calendar:auth-changed', changed); };
  }, [refresh]);
  async function signOut() {
    invalidateRequests(); setStatus(current => current ? { ...current, session: null } : null); setMode('signin'); setBusy(true); setError('');
    try { await api.signOut(); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function local(profileId) {
    if (busy) return; setBusy(true); setError('');
    try { entered(await api.continueLocal({ profileId })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function switchMode(next) { setMode(next); setPassword(''); setConfirmation(''); setCode(''); setError(''); setMessage(''); }
  async function submit(event) {
    event.preventDefault(); if (busy || composing) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'configure') { const next = await api.configureAuth({ url: projectUrl.trim(), publishableKey: publishableKey.trim() }); setStatus(next); setPublishableKey(''); switchMode('signin'); setMessage('Account service connected. You can sign in or create an account.'); }
      else if (mode === 'reset') { const result = await api.requestPasswordReset({ email: address }); switchMode('recover'); setMessage(result.message); }
      else if (mode === 'confirm') { const result = await api.confirmEmail({ email: address, code }); switchMode('signin'); setMessage(result.message); }
      else if (mode === 'recover') { if (password !== confirmation) throw new Error('The passwords do not match.'); const result = await api.recoverPassword({ email: address, code, password }); switchMode('signin'); setMessage(result.message); }
      else if (mode === 'signup') {
        if (password !== confirmation) throw new Error('The passwords do not match.');
        const result = await api.signUp({ email: address, password, name, remember });
        if (result.confirmationRequired) { switchMode('confirm'); setMessage(result.message); } else entered(result);
      } else entered(await api.signIn({ email: address, password, remember }));
    } catch (failure) { setError(failure.message); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); }
  }
  if (loading) return <main className="auth-loading" role="status"><CalendarDays size={28} /><p>{t("Opening your workspace…")}</p></main>;
  if (status?.session && !status.session.onboardingComplete) return <Onboarding key={status.session.id + ':' + revision} account={status} onComplete={entered} onSignOut={signOut} />;
  if (status?.session) return <App key={status.session.id + ':' + revision} account={status} onSignOut={signOut} onAccountChanged={() => window.dispatchEvent(new Event('calendar:auth-changed'))} />;
  const titles = { signin: 'Welcome back', signup: 'Create your account', confirm: 'Confirm your email', reset: 'Reset your password', recover: 'Choose a new password', configure: 'Connect account sign-in' };
  const descriptions = { signin: 'Open your personal calendar and journal workspace.', signup: 'Keep your workspace separate on this computer.', confirm: 'Open the confirmation link and return to sign in, or enter the code from your email.', reset: 'We’ll ask the account service to send a recovery email.', recover: 'Enter the recovery code from your email and a new password.', configure: 'Enter the public configuration supplied by your app administrator.' };
  return <main className="auth-shell"><section className="auth-intro"><div className="auth-brand"><span className="brand-icon"><CalendarDays size={25} /></span><strong>{t("Calendar")}</strong></div><div><p className="subtle-label">{t("A little more intentional")}</p><h1>{t("Make space")}<br />{t("for your day.")}</h1><p>{t("Capture what matters. Turn your reflections into a plan you can review.")}</p></div><ul><li><Check size={17} />{t("Your journals stay on this device.")}</li><li><Check size={17} />{t("Each account has its own workspace.")}</li><li><Check size={17} />{t("You review every calendar change.")}</li></ul><p className="helper">{t("Sign-in does not sync your journals to the cloud. A local workspace is always available offline.")}</p></section>
    <div className="auth-language"><LanguageSwitch /></div><section className="auth-card" aria-labelledby="auth-title"><div className="auth-form-heading"><span className="auth-symbol">{['reset', 'recover', 'confirm'].includes(mode) ? <Mail size={23} /> : <LockKeyhole size={23} />}</span><h2 id="auth-title">{t(titles[mode])}</h2><p className="muted">{t(descriptions[mode])}</p></div>
      {error && <p className="auth-message error" role="alert">{messageText(error)}</p>}{!status && <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>{t("Try again")}</button>}{message && <p className="auth-message" role="status">{messageText(message)}</p>}
      {status && !status.provider.configured && mode !== 'configure' && <div className="inline-status warning"><span>{t("Email sign-in is not connected yet. You can start locally now.")}</span><button className="text-button" type="button" disabled={busy} onClick={() => switchMode('configure')}>{t("Set up account sign-in")}</button></div>}
      <form onSubmit={submit} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}>
        <fieldset className="editor-fields" disabled={busy || (mode !== 'configure' && !status?.provider.configured)}>
          {mode === 'configure' ? <><label>{t("Supabase project URL")}<input type="url" required autoComplete="url" placeholder={t("https://your-project.supabase.co")} value={projectUrl} onChange={e => setProjectUrl(e.target.value)} /></label><label>{t("Publishable app key")}<input required type="password" autoComplete="off" placeholder={t("sb_publishable_…")} value={publishableKey} onChange={e => setPublishableKey(e.target.value)} maxLength={540} /></label><p className="helper">{t("Use the publishable key. Secret and service-role keys are never accepted.")}</p></> : <>
            {mode === 'signup' && <label>{t("Your name")}<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={100} /></label>}
            <label>{t("Email")}<input required type="email" autoComplete="username" value={address} onChange={e => setAddress(e.target.value)} maxLength={254} /></label>
            {['confirm', 'recover'].includes(mode) && <label>{t("Email verification code")}<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={e => setCode(e.target.value)} /></label>}
            {['signin', 'signup', 'recover'].includes(mode) && <label>{mode === 'recover' ? t("New password") : t("Password")}<input required type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signin' ? 1 : 12} maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /></label>}
            {['signup', 'recover'].includes(mode) && <><label>{t("Confirm password")}<input required type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><p className="helper">{t("Use at least 12 characters.")}</p></>}
            {['signin', 'signup'].includes(mode) && <label className="check-row"><input type="checkbox" checked={remember} disabled={!status?.secureStorage} onChange={e => setRemember(e.target.checked)} />{t("Keep me signed in on this computer")}</label>}
            {['signin', 'signup'].includes(mode) && !status?.secureStorage && <p className="helper">{t("Remember-me is available in the desktop app when secure OS storage is ready.")}</p>}
          </>}
          <button className="primary-button auth-primary" type="submit" disabled={composing}>{busy ? t("Please wait…") : t({ signin: 'Sign in', signup: 'Create account', confirm: 'Confirm email', reset: 'Send recovery email', recover: 'Update password', configure: 'Connect account service' }[mode])}<ArrowRight size={16} /></button>
        </fieldset>
      </form>
      <div className="auth-links">{mode === 'signin' ? <><button type="button" className="text-button" disabled={busy} onClick={() => switchMode('signup')}>{t("Create account")}</button><button type="button" className="text-button" disabled={busy} onClick={() => switchMode('reset')}>{t("Forgot password?")}</button></> : <button type="button" className="text-button" disabled={busy} onClick={() => switchMode('signin')}><ChevronLeft size={14} />{t("Back to sign in")}</button>}
        {mode === 'confirm' && <button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { setMessage((await api.resendConfirmation({ email: address })).message); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>{t("Resend confirmation")}</button>}</div>
      <div className="auth-local"><span className="subtle-label">{t("Or stay on this device")}</span>{(status?.localProfiles || [{ id: 'local', name: 'Local workspace' }]).map(profile => <button type="button" className="secondary-button" key={profile.id} disabled={busy} onClick={() => local(profile.id)}>{profile.id === 'local' ? t("Continue offline") : profile.name}<ArrowRight size={15} /></button>)}<p className="helper">{t("Local profiles use your operating-system account for device access.")}</p></div>
    </section></main>;
}
