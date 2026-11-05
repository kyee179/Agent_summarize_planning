import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, className = '', busy = false }) {
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
  return <dialog ref={ref} className={`dialog ${className}`} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) close.current(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) close.current(); }}>
    <header className="dialog-header"><div><p className="subtle-label">Calendar</p><h2>{title}</h2></div>
      <button type="button" className="icon-button" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Discard changes', onConfirm, onClose, busy = false }) {
  return <Dialog title={title} onClose={onClose} busy={busy} className="confirmation-dialog">
    <div className="dialog-body"><p>{message}</p></div><footer className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Keep editing</button>
      <button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
    </footer></Dialog>;
}
