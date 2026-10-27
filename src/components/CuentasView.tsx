import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus, Star, TrendingDown, Wallet, Scale } from 'lucide-react';
import type { Cuenta, Resumen, TipoCuenta } from '../../shared/types';
import { api } from '../lib/api';
import { KIND_ICONS, KIND_LABELS, KIND_SHORT, balanceText, formatMoneyInput, parseMoney } from '../lib/labels';
import AnimatedCurrency from './AnimatedCurrency';
import { ConfirmDialog, MoneyInput, Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

export default function CuentasView(props: { summary: Resumen; onSummary: (s: Resumen) => void; run: Run }) {
  const { summary, onSummary, run } = props;
  const [editing, setEditing] = useState<Cuenta | 'new' | null>(null);

  return (
    <div className="view-stack">
      <div className="dashboard-grid">
        <div className="summary-card balance">
          <div>
            <div className="card-label">Tienes disponible</div>
            <AnimatedCurrency value={summary.totales.tienes} className="card-value" />
            <div className="card-hint">Efectivo, bancos, billeteras y ahorros</div>
          </div>
          <Wallet size={32} color="var(--accent-blue)" aria-hidden="true" />
        </div>
        <div className="summary-card expense">
          <div>
            <div className="card-label">Debes en tarjetas</div>
            <AnimatedCurrency value={summary.totales.debes} className="card-value" />
            <div className="card-hint">Lo que falta por pagar de tus tarjetas de crédito</div>
          </div>
          <TrendingDown size={32} color="var(--accent-red)" aria-hidden="true" />
        </div>
        <div className="summary-card income">
          <div>
            <div className="card-label">Tu plata real</div>
            <AnimatedCurrency value={summary.totales.neto} className="card-value" />
            <div className="card-hint">Lo que tienes menos lo que debes</div>
          </div>
          <Scale size={32} color="var(--accent-green)" aria-hidden="true" />
        </div>
      </div>

      <div className="premium-panel">
        <div className="panel-header">
          <h2>Mis cuentas</h2>
          <button className="btn-primary small" onClick={() => setEditing('new')}>
            <Plus size={16} /> Agregar
          </button>
        </div>
        <ul className="account-list">
          {summary.cuentas.map((c) => {
            const Icon = KIND_ICONS[c.tipo];
            return (
              <li key={c.id}>
                <button className="account-item" onClick={() => setEditing(c)}>
                  <span className={`account-icon kind-${c.tipo}`} aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className="account-info">
                    <span className="account-name">
                      <span className="account-name-text">{c.nombre}</span>
                      {c.principal && (
                        <span className="badge">
                          <Star size={11} /> Principal
                        </span>
                      )}
                    </span>
                    <span className="account-kind">{KIND_SHORT[c.tipo]}</span>
                  </span>
                  <span className={`account-balance${c.saldo < 0 ? ' negative' : ''}`}>{balanceText(c)}</span>
                  <ChevronRight size={18} className="account-chevron" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="panel-tip">
          💬 También puedes decirle a Aura: <em>"tengo 300 mil en Nequi"</em> o <em>"debo 1 millón en la Visa"</em>. La cuenta
          <strong> principal</strong> es la que uso cuando no me dices con qué pagaste.
        </p>
      </div>

      {editing && (
        <AccountSheet
          cuenta={editing === 'new' ? null : editing}
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

function AccountSheet(props: { cuenta: Cuenta | null; onClose: () => void; onSaved: (s: Resumen) => void; run: Run }) {
  const { cuenta, onClose, onSaved, run } = props;
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoCuenta>(cuenta?.tipo ?? 'banco');
  const initialSaldo = cuenta ? Math.abs(cuenta.saldo) : 0;
  const [saldo, setSaldo] = useState(cuenta ? formatMoneyInput(String(initialSaldo)) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const esCredito = tipo === 'credito';

  async function save(e: FormEvent) {
    e.preventDefault();
    const monto = saldo.trim() ? parseMoney(saldo) : 0;
    setSaving(true);
    const res = await run(() =>
      cuenta
        ? api.updateAccount(cuenta.id, {
            nombre: nombre !== cuenta.nombre ? nombre : undefined,
            tipo: tipo !== cuenta.tipo ? tipo : undefined,
            saldo: monto !== initialSaldo || tipo !== cuenta.tipo ? monto : undefined,
          })
        : api.createAccount({ nombre, tipo, saldo: monto }),
    );
    setSaving(false);
    if (res) onSaved(res.summary);
  }

  async function makePrincipal() {
    if (!cuenta) return;
    const res = await run(() => api.updateAccount(cuenta.id, { principal: true }));
    if (res) onSaved(res.summary);
  }

  async function remove() {
    if (!cuenta) return;
    setSaving(true);
    const res = await run(() => api.deleteAccount(cuenta.id));
    setSaving(false);
    setConfirmDelete(false);
    if (res) onSaved(res.summary);
  }

  return (
    <Sheet title={cuenta ? `Editar ${cuenta.nombre}` : 'Nueva cuenta'} onClose={onClose}>
      <form className="sheet-form" onSubmit={save}>
        <label className="form-field">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Bancolombia, Nequi, Visa" maxLength={40} required autoFocus={!cuenta} />
        </label>
        <label className="form-field">
          <span>¿Qué tipo de cuenta es?</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCuenta)}>
            {(Object.keys(KIND_LABELS) as TipoCuenta[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="form-field">
          <label htmlFor="saldo-cuenta">{esCredito ? '¿Cuánto debes hoy en esta tarjeta?' : '¿Cuánta plata tiene hoy?'}</label>
          <MoneyInput id="saldo-cuenta" value={saldo} onChange={setSaldo} />
          {cuenta && <small>Si cambias este valor, registro un ajuste para que el saldo quede igual al real.</small>}
        </div>
        <button type="submit" className="btn-primary" disabled={saving || !nombre.trim()}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {cuenta && !cuenta.principal && (
          <div className="sheet-secondary-actions">
            <button type="button" className="btn-ghost" onClick={makePrincipal} disabled={saving}>
              <Star size={16} /> Usar como principal
            </button>
            <button type="button" className="btn-ghost danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
              Quitar cuenta
            </button>
          </div>
        )}
      </form>
      {confirmDelete && cuenta && (
        <ConfirmDialog
          title={`¿Quitar ${cuenta.nombre}?`}
          message="Si ya tiene movimientos, la guardo en el historial pero deja de aparecer en tus cuentas. Debe estar en $0."
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
