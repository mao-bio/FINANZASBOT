import { useEffect, type ReactNode } from 'react';
import { CircleAlert, X, type LucideIcon } from 'lucide-react';
import { formatMoneyInput } from '../lib/labels';

export function ConfirmDialog(props: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  icon?: LucideIcon;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscape(props.onCancel);
  const Icon = props.icon ?? CircleAlert;
  return (
    <div className="overlay" onClick={props.onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className={`dialog-icon${props.danger ? ' danger' : ''}`} aria-hidden="true">
          <Icon size={26} />
        </div>
        <h2 id="dialog-title">{props.title}</h2>
        {props.message && <p>{props.message}</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={props.onCancel} disabled={props.busy}>
            Cancelar
          </button>
          <button className={`btn ${props.danger ? 'btn-danger solid' : 'btn-primary'}`} onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? <span className="spinner" aria-label="Un momento" /> : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hoja que sube desde abajo (en pantallas grandes, diálogo centrado). */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(props.onClose);
  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-header">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Cerrar">
            <X size={22} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function MoneyInput(props: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="money-input">
      <span aria-hidden="true">$</span>
      <input
        id={props.id}
        inputMode="numeric"
        autoComplete="off"
        value={props.value}
        placeholder="0"
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(formatMoneyInput(e.target.value))}
      />
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}
