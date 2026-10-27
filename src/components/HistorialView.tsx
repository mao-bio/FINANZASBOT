import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Movimiento, TipoMovimiento } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { dayKey, dayLabel } from '../lib/labels';
import { TxRow } from './TxRow';

const TYPE_FILTERS: { value: 'todos' | TipoMovimiento; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'gasto', label: 'Gastos' },
  { value: 'ingreso', label: 'Ingresos' },
  { value: 'transferencia', label: 'Transferencias' },
  { value: 'ajuste', label: 'Ajustes' },
];

export default function HistorialView(props: { transactions: Movimiento[]; onOpenTx: (m: Movimiento) => void }) {
  const { transactions, onOpenTx } = props;
  const [query, setQuery] = useState('');
  const [tipo, setTipo] = useState<'todos' | TipoMovimiento>('todos');
  const [cuenta, setCuenta] = useState('todas');
  const [categoria, setCategoria] = useState('todas');

  const cuentas = useMemo(
    () => Array.from(new Set(transactions.flatMap((t) => [t.cuenta, t.cuenta_destino ?? '']).filter(Boolean))).sort(),
    [transactions],
  );
  const categorias = useMemo(
    () =>
      Array.from(new Set(transactions.filter((t) => t.tipo === 'gasto' || t.tipo === 'ingreso').map((t) => t.categoria))).sort(),
    [transactions],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = transactions.filter(
      (t) =>
        (!q || [t.descripcion, t.categoria, t.cuenta, t.cuenta_destino ?? ''].some((s) => s.toLowerCase().includes(q))) &&
        (tipo === 'todos' || t.tipo === tipo) &&
        (cuenta === 'todas' || t.cuenta === cuenta || t.cuenta_destino === cuenta) &&
        (categoria === 'todas' || t.categoria === categoria),
    );
    const byDay = new Map<string, Movimiento[]>();
    for (const t of filtered) {
      const key = dayKey(t.fecha);
      byDay.set(key, [...(byDay.get(key) ?? []), t]);
    }
    return { count: filtered.length, days: [...byDay.entries()] };
  }, [transactions, query, tipo, cuenta, categoria]);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Movimientos</h1>
        <span className="pill">{groups.count}</span>
      </header>

      <div className="filters">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Buscar movimientos" aria-label="Buscar movimientos" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Tipo de movimiento">
          {TYPE_FILTERS.map((f) => (
            <button key={f.value} className="chip" aria-pressed={tipo === f.value} onClick={() => setTipo(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="select-row">
          <select className="select" value={cuenta} onChange={(e) => setCuenta(e.target.value)} aria-label="Filtrar por cuenta">
            <option value="todas">Todas las cuentas</option>
            {cuentas.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoría">
            <option value="todas">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {groups.count === 0 ? (
        <div className="card">
          <p className="empty">
            {transactions.length === 0 ? 'Aún no hay movimientos. Cuéntale a Aura tu primer gasto.' : 'No hay movimientos con esos filtros.'}
          </p>
        </div>
      ) : (
        groups.days.map(([key, items]) => {
          const gastado = items.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);
          return (
            <section key={key} className="day-group" aria-label={dayLabel(key)}>
              <h2 className="day-label">
                <span>{dayLabel(key)}</span>
                {gastado > 0 && <span className="amount">Gastaste {fmtCOP(gastado)}</span>}
              </h2>
              <div className="card flush tx-list">
                {items.map((t) => (
                  <TxRow key={t.id} m={t} when="time" onClick={() => onOpenTx(t)} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
