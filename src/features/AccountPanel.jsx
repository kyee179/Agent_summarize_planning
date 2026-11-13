import { t, useLocale, messageText } from '../i18n/index.js';
import { useEffect, useState } from 'react';
import { Download, LogOut, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { Dialog } from '../components/Dialog.jsx';

export function AccountPanel({ account, onClose, onSignOut, onRemoved }) {
  useLocale();
  const [status, setStatus] = useState(account), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [removing, setRemoving] = useState(false), [confirmation, setConfirmation] = useState('');
  useEffect(() => { let current = true; api.accountStatus().then(value => { if (current) setStatus(value); }).catch(failure => { if (current) setError(failure.message); }); return () => { current = false; }; }, []);
  const profile = status.session;
  async function exportData() {
    setBusy(true); setError('');
    try {
      const snapshot = await api.exportWorkspace();
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'calendar-workspace-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function removeData(event) {
    event.preventDefault(); if (busy || confirmation !== profile.name) return; setBusy(true); setError('');
    try { await api.removeLocalAccountData(confirmation); onRemoved(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Dialog title={t("Your account")} onClose={onClose} busy={busy} className="account-dialog"><div className="dialog-body">
    <div className="account-identity"><span className="auth-symbol"><UserRound size={24} /></span><div><h3>{profile.name}</h3><p className="muted">{profile.kind === 'account' ? profile.email : t("Local workspace · this device")}</p></div></div>
    <p className="helper">{t("Your journals and calendar are stored on this computer. Sign-in does not enable cloud data sync.")}</p>
    {status.usage && <div className="account-usage"><strong>{status.usage.used} / {status.usage.limit}{t(" AI requests today")}</strong><span className="helper">{t("Per workspace, resets at midnight UTC. Local rules do not use this allowance. Your AI service sets its own billing and limits.")}</span></div>}
    {error && <p className="auth-message error" role="alert">{messageText(error)}</p>}
    <div className="account-actions"><button type="button" className="secondary-button" disabled={busy} onClick={exportData}><Download size={16} />{t("Export workspace")}</button><button type="button" className="secondary-button" disabled={busy} onClick={onSignOut}><LogOut size={16} />{profile.kind === 'account' ? t("Sign out / switch account") : t("Switch workspace")}</button></div>
    <p className="helper">{t("The export includes journals, events, tasks, notes and planning preferences. Keep this personal file private. Connections and activity are excluded.")}</p>
    {profile.id !== 'local' && <div className="account-removal">{!removing ? <button type="button" className="text-button danger-text" disabled={busy} onClick={() => setRemoving(true)}>{t("Remove this workspace from this device…")}</button> : <form onSubmit={removeData}><h3>{t("Remove local workspace data")}</h3><p>{t("Export first if you need a copy. This removes this workspace’s data and credentials from this device. Your hosted sign-in account and the original local workspace remain.")}</p><label>{t("Type ")}{profile.name}{t(" to confirm")}<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label><div className="account-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setRemoving(false); setConfirmation(''); }}>{t("Cancel removal")}</button><button type="submit" className="danger-button" disabled={busy || confirmation !== profile.name}>{busy ? t("Removing…") : t("Remove from device")}</button></div></form>}</div>}
  </div></Dialog>;
}
