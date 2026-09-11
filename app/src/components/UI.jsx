import React, { useEffect, useRef } from 'react';
import { X, CircleNotch } from '@phosphor-icons/react';

export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}><Icon size={21} weight="regular" /></button>;
}

export function Empty({ icon: Icon, title, children, action }) {
  return <div className="empty-state">{Icon && <Icon size={34} weight="light" />}<h3>{title}</h3><div className="empty-description" style={{ fontSize: 12, lineHeight: 1.7, maxWidth: 290 }}>{children}</div>{action}</div>;
}

export function Spinner({ children = 'Loading' }) {
  return <span className="loading"><CircleNotch size={18} className="spin" />{children}</span>;
}

export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef();
  const previousFocus = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = previousFocus.current;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const handler = e => {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
      if (dialogs.at(-1) !== ref.current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab') {
        const els = [...(ref.current?.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]') || [])].filter(el => !el.disabled && el.getClientRects().length && el.tabIndex >= 0);
        if (!els.length) { e.preventDefault(); ref.current?.focus(); return; }
        if (e.shiftKey && (document.activeElement === els[0] || !els.includes(document.activeElement))) { e.preventDefault(); els.at(-1).focus(); }
        else if (!e.shiftKey && (document.activeElement === els.at(-1) || !els.includes(document.activeElement))) { e.preventDefault(); els[0].focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header className="modal-header"><h2>{title}</h2><IconButton icon={X} label="Close dialog" onClick={onClose} /></header>{children}</section></div>;
}
