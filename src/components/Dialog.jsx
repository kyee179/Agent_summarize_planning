import { t, useLocale, messageText } from '../i18n/index.js';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, className = '', busy = false }) {
  useLocale();
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement;
    const element = ref.current;
    if (element.showModal) element.showModal();
    else element.setAttribute('open', '');
    (element.querySelector('[autofocus]') || element.querySelector('input, textarea') || element.querySelector('button'))?.focus();
    return () => { if (element.open && element.close) element.close(); prior?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${className}`} aria-label={t(title)}
    onCancel={event => { event.preventDefault(); if (!busy) close.current(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) close.current(); }}>
    <header className="dialog-header"><div><p className="subtle-label">{t("Calendar")}</p><h2>{t(title)}</h2></div>
      <button type="button" className="icon-button" aria-label={t("Close {p0}", {p0: t(title)})} disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Discard changes', onConfirm, onClose, busy = false }) {
  useLocale();
  return <Dialog title={t(title)} onClose={onClose} busy={busy} className="confirmation-dialog">
    <div className="dialog-body"><p>{messageText(message)}</p></div><footer className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("Keep editing")}</button>
      <button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? t("Working…") : t(confirmLabel)}</button>
    </footer></Dialog>;
}
