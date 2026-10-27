import { useState } from 'react';
import { Camera, Mic, Trash2 } from 'lucide-react';
import type { Movimiento } from '../../shared/types';
import { amountText, formatDate, shortCategory, shortDate, timeLabel } from '../lib/labels';
import { IconTile, txVisual } from '../lib/visuals';
import { ConfirmDialog, Sheet } from './Dialogs';

function subtitle(m: Movimiento): string {
  if (m.tipo === 'transferencia') return `${m.cuenta} → ${m.cuenta_destino}`;
  if (m.tipo === 'ajuste') return m.cuenta;
  return `${shortCategory(m.categoria)} · ${m.cuenta}`;
}

function title(m: Movimiento): string {
  if (m.tipo === 'ajuste') return 'Ajuste de saldo';
  return m.descripcion || shortCategory(m.categoria);
}

/** Fila de un movimiento: ícono de categoría, descripción, cuenta y monto. */
export function TxRow({ m, when = 'none', onClick }: { m: Movimiento; when?: 'date' | 'time' | 'none'; onClick?: () => void }) {
  const extra = when === 'date' ? ` · ${shortDate(m.fecha)}` : when === 'time' ? ` · ${timeLabel(m.fecha)}` : '';
  const content = (
    <>
      <IconTile visual={txVisual(m)} />
      <span className="tx-main">
        <span className="tx-title">
          <span>{title(m)}</span>
          {m.fuente === 'voz' && <Mic size={13} aria-label="Registrado por nota de voz" />}
          {m.fuente === 'foto' && <Camera size={13} aria-label="Registrado con foto" />}
        </span>
        <span className="tx-sub">
          {subtitle(m)}
          {extra}
        </span>
      </span>
      <span className={`tx-amount amount ${m.tipo}`}>{amountText(m)}</span>
    </>
  );
  return onClick ? (
    <button className="tx-row" onClick={onClick} aria-label={`${title(m)}, ${amountText(m)}. Ver detalle`}>
      {content}
    </button>
  ) : (
    <div className="tx-row">{content}</div>
  );
}

const TYPE_NAMES: Record<Movimiento['tipo'], string> = {
  gasto: 'Gasto',
  ingreso: 'Ingreso',
  transferencia: 'Transferencia',
  ajuste: 'Ajuste de saldo',
};

const SOURCE_NAMES: Record<Movimiento['fuente'], string> = {
  chat: 'Chat con Aura',
  voz: 'Nota de voz',
  foto: 'Foto de recibo',
};

/** Detalle de un movimiento con opción de eliminarlo. */
export function TxSheet({ m, onClose, onDelete }: { m: Movimiento; onClose: () => void; onDelete: (id: number) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await onDelete(m.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Detalle del movimiento" onClose={onClose}>
      <div className="detail-hero">
        <IconTile visual={txVisual(m)} size="lg" />
        <strong>{title(m)}</strong>
        {m.tipo === 'ajuste' && <span className="muted">{m.descripcion}</span>}
        <span className={`amount tx-amount ${m.tipo}`}>{amountText(m)}</span>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Tipo</dt>
          <dd>{TYPE_NAMES[m.tipo]}</dd>
        </div>
        {(m.tipo === 'gasto' || m.tipo === 'ingreso') && (
          <div>
            <dt>Categoría</dt>
            <dd>{m.categoria}</dd>
          </div>
        )}
        <div>
          <dt>{m.tipo === 'transferencia' ? 'De → a' : 'Cuenta'}</dt>
          <dd>{m.cuenta_destino ? `${m.cuenta} → ${m.cuenta_destino}` : m.cuenta}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatDate(m.fecha)}</dd>
        </div>
        <div>
          <dt>Registrado por</dt>
          <dd>{SOURCE_NAMES[m.fuente]}</dd>
        </div>
      </dl>
      <button className="btn btn-danger btn-block" onClick={() => setConfirm(true)}>
        <Trash2 size={18} /> Eliminar movimiento
      </button>
      {confirm && (
        <ConfirmDialog
          title="¿Eliminar este movimiento?"
          message="Los saldos de tus cuentas se recalculan solos."
          confirmLabel="Eliminar"
          danger
          icon={Trash2}
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Sheet>
  );
}
