import { useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, CircleCheck, CircleX, PiggyBank, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Presupuesto, Resumen } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api } from '../lib/api';
import { formatMoneyInput, monthName, parseMoney } from '../lib/labels';
import { IconTile, groupVisual } from '../lib/visuals';
import { ConfirmDialog, MoneyInput, Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

function compact(v: number): string {
  if (Math.abs(v) >= 100_000) return `${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function budgetStatus(p: Presupuesto) {
  const pct = p.monto > 0 ? p.gastado / p.monto : 0;
  if (pct > 1) return { key: 'critical', label: `Te pasaste ${fmtCOP(p.gastado - p.monto)}`, Icon: CircleX, pct };
  if (pct >= 0.8) return { key: 'warning', label: `Ojo: te quedan ${fmtCOP(p.monto - p.gastado)}`, Icon: TriangleAlert, pct };
  return { key: 'good', label: `Vas bien: te quedan ${fmtCOP(p.monto - p.gastado)}`, Icon: CircleCheck, pct };
}

/** Anillo de un solo valor: qué parte de lo que entró ya se gastó. */
function Ring({ pct }: { pct: number | null }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const shown = pct === null ? 0 : Math.min(1, pct);
  const color = pct !== null && pct > 1 ? 'var(--status-critical)' : 'var(--chart-single)';
  return (
    <div className="ring" role="img" aria-label={pct === null ? 'Sin ingresos este mes' : `Gastaste el ${Math.round(pct * 100)}% de lo que te entró`}>
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="12" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${shown * c} ${c}`}
          style={{ transition: 'stroke-dasharray 700ms var(--ease-out)' }}
        />
      </svg>
      <div className="ring-center">
        <strong className="amount">{pct === null ? '—' : `${Math.round(pct * 100)}%`}</strong>
        <span>{pct === null ? 'sin ingresos este mes' : 'gastado de lo que entró'}</span>
      </div>
    </div>
  );
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
    <div className="screen">
      <header className="screen-header">
        <h1>Resumen</h1>
        <span className="pill">{monthName(mes.mes)}</span>
      </header>

      <section className="card month-card" aria-label="Este mes">
        <Ring pct={mes.ingresos > 0 ? mes.gastos / mes.ingresos : null} />
        <div className="stat-list">
          <div className="stat-line">
            <IconTile visual={{ Icon: ArrowDownLeft, color: 'var(--income)' }} size="sm" />
            <div>
              <span>Te entró</span>
              <strong className="amount">{fmtCOP(mes.ingresos)}</strong>
            </div>
          </div>
          <div className="stat-line">
            <IconTile visual={{ Icon: ArrowUpRight, color: 'var(--expense)' }} size="sm" />
            <div>
              <span>Gastaste</span>
              <strong className="amount">{fmtCOP(mes.gastos)}</strong>
            </div>
          </div>
          <div className="stat-line">
            <IconTile visual={{ Icon: PiggyBank, color: 'var(--primary)' }} size="sm" />
            <div>
              <span>{balance >= 0 ? 'Te sobró' : 'Gastaste de más'}</span>
              <strong className="amount">{fmtCOP(Math.abs(balance))}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Presupuestos</h2>
          <button className="btn btn-soft btn-sm" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nuevo
          </button>
        </div>
        <div className="card">
          {mes.presupuestos.length === 0 ? (
            <p className="empty">
              Ponle un tope mensual a lo que más gastas. Toca <strong>Nuevo</strong> o dile a Aura: "ponme 600 mil de presupuesto para comida".
            </p>
          ) : (
            mes.presupuestos.map((p) => {
              const st = budgetStatus(p);
              return (
                <button key={p.categoria} className={`budget-row status-${st.key}`} onClick={() => setEditing(p)}>
                  <IconTile visual={groupVisual(p.categoria)} />
                  <span className="budget-body">
                    <span className="budget-top">
                      <span>{p.categoria}</span>
                      <span className="amount">
                        {fmtCOP(p.gastado)} <small>/ {fmtCOP(p.monto)}</small>
                      </span>
                    </span>
                    <span
                      className="bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(st.pct * 100)}
                      aria-label={`${p.categoria}: ${Math.round(st.pct * 100)}% usado`}
                    >
                      <span className="bar-fill" style={{ display: 'block', width: `${Math.min(100, st.pct * 100)}%` }} />
                    </span>
                    <span className={`status-text status-${st.key}`}>
                      <st.Icon size={14} aria-hidden="true" /> {st.label}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>¿En qué se va tu plata?</h2>
        </div>
        <div className="card">
          {mes.porCategoria.length === 0 ? (
            <p className="empty">Todavía no hay gastos este mes.</p>
          ) : (
            mes.porCategoria.map((c) => (
              <div key={c.grupo} className="cat-row">
                <IconTile visual={groupVisual(c.grupo)} />
                <span className="budget-body">
                  <span className="budget-top">
                    <span>{c.grupo}</span>
                    <span className="amount">{fmtCOP(c.monto)}</span>
                  </span>
                  <span className="bar" aria-hidden="true">
                    <span className="bar-fill" style={{ display: 'block', width: `${(c.monto / maxCategoria) * 100}%` }} />
                  </span>
                  <span className="cat-pct">{Math.round((c.monto / Math.max(1, mes.gastos)) * 100)}% de tus gastos</span>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Últimos 6 meses</h2>
          {hayHistorico && (
            <button className="link-btn" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Ver gráfica' : 'Ver tabla'}
            </button>
          )}
        </div>
        <div className="card">
          {!hayHistorico ? (
            <p className="empty">Aquí vas a ver cómo cambian tus ingresos y gastos mes a mes.</p>
          ) : showTable ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Te entró</th>
                  <th>Gastaste</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.mes}>
                    <td>{monthName(h.mes)}</td>
                    <td className="amount">{fmtCOP(h.ingresos)}</td>
                    <td className="amount">{fmtCOP(h.gastos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={historico} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="nombre" tick={{ fill: 'var(--text-2)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                  <YAxis tick={{ fill: 'var(--text-2)', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }}
                    formatter={(value, name) => [fmtCOP(Number(value)), name]}
                    labelFormatter={(_, payload) => (payload?.[0] ? monthName(payload[0].payload.mes) : '')}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      boxShadow: 'var(--shadow-md)',
                      color: 'var(--text)',
                    }}
                    itemStyle={{ color: 'var(--text)' }}
                    labelStyle={{ color: 'var(--text-2)', fontWeight: 700 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: 'var(--text-2)' }}
                    iconType="circle"
                    iconSize={10}
                    itemSorter={(item) => (item.dataKey === 'ingresos' ? 0 : 1)}
                  />
                  <Bar dataKey="ingresos" name="Te entró" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!reducedMotion} />
                  <Bar dataKey="gastos" name="Gastaste" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!reducedMotion} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

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
      <form className="form" onSubmit={save}>
        {!presupuesto && (
          <div className="field">
            <label htmlFor="categoria-presupuesto">Categoría</label>
            <select id="categoria-presupuesto" className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {grupos.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="monto-presupuesto">¿Cuánto quieres gastar como máximo al mes?</label>
          <MoneyInput id="monto-presupuesto" value={monto} onChange={setMonto} autoFocus />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || !categoria || !(value > 0)}>
          {saving ? <span className="spinner" aria-label="Guardando" /> : 'Guardar'}
        </button>
        {presupuesto && (
          <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)} disabled={saving}>
            <Trash2 size={18} aria-hidden="true" /> Quitar presupuesto
          </button>
        )}
      </form>
      {confirmDelete && (
        <ConfirmDialog
          title="¿Quitar este presupuesto?"
          confirmLabel="Quitar"
          danger
          icon={Trash2}
          busy={saving}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}
