import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Plus, TrendingDown, TrendingUp, Wallet, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Presupuesto, Resumen } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api } from '../lib/api';
import { formatMoneyInput, monthName, parseMoney } from '../lib/labels';
import AnimatedCurrency from './AnimatedCurrency';
import { ConfirmDialog, MoneyInput, Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

// Colores validados para daltonismo sobre la superficie oscura (dataviz).
const COLOR_INGRESOS = '#199e70';
const COLOR_GASTOS = '#d95926';
const COLOR_CATEGORIA = '#3987e5';

function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)} mil`;
  return String(v);
}

function budgetStatus(p: Presupuesto) {
  const pct = p.monto > 0 ? p.gastado / p.monto : 0;
  if (pct > 1) return { key: 'critical', label: `Te pasaste ${fmtCOP(p.gastado - p.monto)}`, Icon: XCircle, pct };
  if (pct >= 0.8) return { key: 'warning', label: `Ojo: te quedan ${fmtCOP(p.monto - p.gastado)}`, Icon: AlertTriangle, pct };
  return { key: 'good', label: `Vas bien: te quedan ${fmtCOP(p.monto - p.gastado)}`, Icon: CheckCircle2, pct };
}

export default function ResumenView(props: { summary: Resumen; onSummary: (s: Resumen) => void; run: Run }) {
  const { summary, onSummary, run } = props;
  const [editing, setEditing] = useState<Presupuesto | 'new' | null>(null);
  const [showTable, setShowTable] = useState(false);
  const { mes } = summary;
  const balance = mes.ingresos - mes.gastos;
  const maxCategoria = Math.max(1, ...mes.porCategoria.map((c) => c.monto));
  const historico = summary.historico.map((h) => ({ ...h, nombre: monthName(h.mes, { short: true }) }));
  const hayHistorico = historico.some((h) => h.ingresos || h.gastos);

  return (
    <div className="view-stack">
      <h2 className="view-title">{monthName(mes.mes)}</h2>

      <div className="dashboard-grid">
        <div className="summary-card income">
          <div>
            <div className="card-label">Te entró</div>
            <AnimatedCurrency value={mes.ingresos} className="card-value" />
          </div>
          <TrendingUp size={32} color="var(--accent-green)" aria-hidden="true" />
        </div>
        <div className="summary-card expense">
          <div>
            <div className="card-label">Gastaste</div>
            <AnimatedCurrency value={mes.gastos} className="card-value" />
          </div>
          <TrendingDown size={32} color="var(--accent-red)" aria-hidden="true" />
        </div>
        <div className="summary-card balance">
          <div>
            <div className="card-label">{balance >= 0 ? 'Te sobró' : 'Gastaste de más'}</div>
            <AnimatedCurrency value={Math.abs(balance)} className="card-value" />
            <div className="card-hint">Lo que entró menos lo que gastaste este mes</div>
          </div>
          <Wallet size={32} color="var(--accent-blue)" aria-hidden="true" />
        </div>
      </div>

      <div className="premium-panel">
        <div className="panel-header">
          <h2>Presupuestos del mes</h2>
          <button className="btn-primary small" onClick={() => setEditing('new')}>
            <Plus size={16} /> Agregar
          </button>
        </div>
        {mes.presupuestos.length === 0 ? (
          <p className="empty-state">
            Ponle un tope mensual a lo que más gastas. Toca <strong>Agregar</strong> o dile a Aura: "ponme 600 mil de presupuesto para comida".
          </p>
        ) : (
          <ul className="budget-list">
            {mes.presupuestos.map((p) => {
              const st = budgetStatus(p);
              return (
                <li key={p.categoria}>
                  <button className="budget-item" onClick={() => setEditing(p)}>
                    <div className="budget-top">
                      <span className="budget-name">{p.categoria}</span>
                      <span className="budget-amounts">
                        {fmtCOP(p.gastado)} <small>de {fmtCOP(p.monto)}</small>
                      </span>
                    </div>
                    <div
                      className="budget-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(st.pct * 100)}
                      aria-label={`${p.categoria}: ${Math.round(st.pct * 100)}% usado`}
                    >
                      <div className={`budget-fill status-${st.key}`} style={{ width: `${Math.min(100, st.pct * 100)}%` }} />
                    </div>
                    <span className={`budget-status status-${st.key}`}>
                      <st.Icon size={14} aria-hidden="true" /> {st.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="charts-section-grid">
        <div className="premium-panel">
          <div className="panel-header">
            <h2>¿En qué se va tu plata?</h2>
          </div>
          {mes.porCategoria.length === 0 ? (
            <p className="empty-state">Todavía no hay gastos este mes.</p>
          ) : (
            <ul className="category-bars">
              {mes.porCategoria.map((c) => (
                <li key={c.grupo} title={`${c.grupo}: ${fmtCOP(c.monto)}`}>
                  <div className="category-bar-label">
                    <span>{c.grupo}</span>
                    <span className="category-bar-value">
                      {fmtCOP(c.monto)} <small>{Math.round((c.monto / Math.max(1, mes.gastos)) * 100)}%</small>
                    </span>
                  </div>
                  <div className="category-bar-track">
                    <div className="category-bar-fill" style={{ width: `${(c.monto / maxCategoria) * 100}%`, background: COLOR_CATEGORIA }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="premium-panel">
          <div className="panel-header">
            <h2>Últimos 6 meses</h2>
            {hayHistorico && (
              <button className="btn-ghost small" onClick={() => setShowTable((v) => !v)}>
                {showTable ? 'Ver gráfica' : 'Ver tabla'}
              </button>
            )}
          </div>
          {!hayHistorico ? (
            <p className="empty-state">Aquí vas a ver cómo cambian tus ingresos y gastos mes a mes.</p>
          ) : showTable ? (
            <table className="category-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="category-value-col">Te entró</th>
                  <th className="category-value-col">Gastaste</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.mes}>
                    <td>{monthName(h.mes)}</td>
                    <td className="category-value-col">{fmtCOP(h.ingresos)}</td>
                    <td className="category-value-col">{fmtCOP(h.gastos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={historico} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="nombre" stroke="var(--text-secondary)" tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} fontSize={12} />
                  <YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={compact} width={52} fontSize={12} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(value, name) => [fmtCOP(Number(value)), name]}
                    labelFormatter={(_, payload) => (payload?.[0] ? monthName(payload[0].payload.mes) : '')}
                    contentStyle={{ background: '#0d1320', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: 'var(--text-secondary)' }}
                    iconType="circle"
                    iconSize={10}
                    itemSorter={(item) => (item.dataKey === 'ingresos' ? 0 : 1)}
                  />
                  <Bar dataKey="ingresos" name="Te entró" fill={COLOR_INGRESOS} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="gastos" name="Gastaste" fill={COLOR_GASTOS} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <BudgetSheet
          presupuesto={editing === 'new' ? null : editing}
          grupos={summary.grupos.filter((g) => editing !== 'new' || !mes.presupuestos.some((p) => p.categoria === g))}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            onSummary(s);
            setEditing(null);
          }}
          run={run}
        />
      )}
    </div>
  );
}

function BudgetSheet(props: {
  presupuesto: Presupuesto | null;
  grupos: string[];
  onClose: () => void;
  onSaved: (s: Resumen) => void;
  run: Run;
}) {
  const { presupuesto, grupos, onClose, onSaved, run } = props;
  const [categoria, setCategoria] = useState(presupuesto?.categoria ?? grupos[0] ?? '');
  const [monto, setMonto] = useState(presupuesto ? formatMoneyInput(String(presupuesto.monto)) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const value = parseMoney(monto);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await run(() => api.setBudget(categoria, value));
    setSaving(false);
    if (res) onSaved(res.summary);
  }

  async function remove() {
    if (!presupuesto) return;
    setSaving(true);
    const res = await run(() => api.deleteBudget(presupuesto.categoria));
    setSaving(false);
    if (res) onSaved(res.summary);
  }

  return (
    <Sheet title={presupuesto ? `Presupuesto de ${presupuesto.categoria}` : 'Nuevo presupuesto'} onClose={onClose}>
      <form className="sheet-form" onSubmit={save}>
        {!presupuesto && (
          <label className="form-field">
            <span>Categoría</span>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {grupos.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        )}
        <div className="form-field">
          <label htmlFor="monto-presupuesto">¿Cuánto quieres gastar como máximo al mes?</label>
          <MoneyInput id="monto-presupuesto" value={monto} onChange={setMonto} autoFocus />
        </div>
        <button type="submit" className="btn-primary" disabled={saving || !categoria || !(value > 0)}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {presupuesto && (
          <div className="sheet-secondary-actions">
            <button type="button" className="btn-ghost danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
              Quitar presupuesto
            </button>
          </div>
        )}
      </form>
      {confirmDelete && (
        <ConfirmDialog
          title="¿Quitar este presupuesto?"
          confirmLabel="Sí, quitar"
          danger
          busy={saving}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}
