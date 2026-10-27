import { useMemo, useState } from 'react';
import { ArrowRightLeft, Camera, Mic, RotateCcw, Scale, Search, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import type { Movimiento, TipoMovimiento } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { formatDate } from '../lib/labels';
import { ConfirmDialog } from './Dialogs';

const TYPE_ICONS: Record<TipoMovimiento, typeof TrendingUp> = {
  ingreso: TrendingUp,
  gasto: TrendingDown,
  transferencia: ArrowRightLeft,
  ajuste: Scale,
};

function amountText(m: Movimiento): string {
  if (m.tipo === 'ingreso') return `+${fmtCOP(m.monto)}`;
  if (m.tipo === 'gasto') return `-${fmtCOP(m.monto)}`;
  if (m.tipo === 'ajuste') return `${m.monto >= 0 ? '+' : '-'}${fmtCOP(Math.abs(m.monto))}`;
  return fmtCOP(m.monto);
}

export default function HistorialView(props: {
  transactions: Movimiento[];
  onDelete: (id: number) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { transactions, onDelete, onReset } = props;
  const [query, setQuery] = useState('');
  const [tipo, setTipo] = useState<'todos' | TipoMovimiento>('todos');
  const [cuenta, setCuenta] = useState('todas');
  const [categoria, setCategoria] = useState('todas');
  const [toDelete, setToDelete] = useState<Movimiento | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const cuentas = useMemo(
    () => Array.from(new Set(transactions.flatMap((t) => [t.cuenta, t.cuenta_destino ?? '']).filter(Boolean))).sort(),
    [transactions],
  );
  const categorias = useMemo(() => Array.from(new Set(transactions.map((t) => t.categoria))).sort(), [transactions]);

  const filtered = transactions.filter((t) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [t.descripcion, t.categoria, t.cuenta, t.cuenta_destino ?? ''].some((s) => s.toLowerCase().includes(q));
    return (
      matchesQuery &&
      (tipo === 'todos' || t.tipo === tipo) &&
      (cuenta === 'todas' || t.cuenta === cuenta || t.cuenta_destino === cuenta) &&
      (categoria === 'todas' || t.categoria === categoria)
    );
  });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setToDelete(null);
      setConfirmReset(false);
    }
  }

  return (
    <div className="history-panel">
      <div className="panel-header">
        <h2>Historial</h2>
        <span className="panel-count">{filtered.length} movimientos</span>
      </div>

      <div className="history-toolbar">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar…"
            aria-label="Buscar movimientos"
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <select className="filter-select" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} aria-label="Tipo">
            <option value="todos">Todos</option>
            <option value="gasto">Gastos</option>
            <option value="ingreso">Ingresos</option>
            <option value="transferencia">Transferencias</option>
            <option value="ajuste">Ajustes de saldo</option>
          </select>
          <select className="filter-select" value={cuenta} onChange={(e) => setCuenta(e.target.value)} aria-label="Cuenta">
            <option value="todas">Todas las cuentas</option>
            {cuentas.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="filter-select" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
            <option value="todas">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="transaction-list">
        {filtered.length === 0 ? (
          <li className="empty-state">
            {transactions.length === 0 ? 'Aún no hay movimientos. Cuéntale a Aura tu primer gasto 😉' : 'No hay movimientos con esos filtros.'}
          </li>
        ) : (
          filtered.map((t) => {
            const Icon = TYPE_ICONS[t.tipo];
            return (
              <li key={t.id} className="transaction-item">
                <span className={`tx-icon tipo-${t.tipo}`} aria-hidden="true">
                  <Icon size={16} />
                </span>
                <div className="tx-info">
                  <div className="tx-desc">
                    {t.descripcion || t.categoria}
                    {t.fuente === 'voz' && <Mic size={12} className="tx-source" aria-label="Por nota de voz" />}
                    {t.fuente === 'foto' && <Camera size={12} className="tx-source" aria-label="Por foto" />}
                  </div>
                  <div className="tx-meta">
                    {t.tipo !== 'transferencia' && t.tipo !== 'ajuste' && <span className="tx-cat">{t.categoria}</span>}
                    <span>{t.cuenta_destino ? `${t.cuenta} → ${t.cuenta_destino}` : t.cuenta}</span>
                  </div>
                  <div className="tx-date">{formatDate(t.fecha)}</div>
                </div>
                <div className="tx-amount-section">
                  <span className={`tx-amount ${t.tipo}${t.tipo === 'ajuste' && t.monto < 0 ? ' negativo' : ''}`}>{amountText(t)}</span>
                  <button className="btn-delete" onClick={() => setToDelete(t)} aria-label={`Eliminar ${t.descripcion}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>

      <button className="btn-ghost danger reset-btn" onClick={() => setConfirmReset(true)}>
        <RotateCcw size={16} /> Borrar todo y empezar de cero
      </button>

      {toDelete && (
        <ConfirmDialog
          title="¿Eliminar este movimiento?"
          message={`${toDelete.descripcion} · ${amountText(toDelete)}. Los saldos se recalculan solos.`}
          confirmLabel="Sí, eliminar"
          danger
          busy={busy}
          onConfirm={() => run(() => onDelete(toDelete.id))}
          onCancel={() => setToDelete(null)}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="⚠️ ¿Borrar todo?"
          message="Se borran todos tus movimientos, cuentas y presupuestos. Esto no se puede deshacer."
          confirmLabel="Sí, borrar todo"
          danger
          busy={busy}
          onConfirm={() => run(onReset)}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
