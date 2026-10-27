import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatMoneyInput } from '../lib/labels';

export function ConfirmDialog(props: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscape(props.onCancel);
  return (
    <div className="logout-confirm-overlay" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="logout-confirm-dialog">
        <p className="dialog-title">{props.title}</p>
        {props.message && <div className="dialog-message">{props.message}</div>}
        <div className="logout-confirm-actions">
          <button className="btn-cancel-logout" onClick={props.onCancel} disabled={props.busy}>
            Cancelar
          </button>
          <button
            className={`btn-confirm-logout${props.danger ? '' : ' safe'}`}
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? 'Un momento…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hoja inferior (en el celular) o diálogo centrado (en pantallas grandes) con un formulario. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(props.onClose);
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={props.title} onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function MoneyInput(props: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="money-input">
      <span aria-hidden="true">$</span>
      <input
        id={props.id}
        inputMode="numeric"
        autoComplete="off"
        value={props.value}
        placeholder={props.placeholder ?? '0'}
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
