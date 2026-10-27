import { useState, type FormEvent } from 'react';
import { ChevronRight, MessageCircle, Plus, Star, Trash2 } from 'lucide-react';
import type { Cuenta, Resumen, TipoCuenta } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api } from '../lib/api';
import { KIND_ICONS, KIND_SHORT, formatMoneyInput, parseMoney } from '../lib/labels';
import { IconTile, KIND_COLORS } from '../lib/visuals';
import AnimatedCurrency from './AnimatedCurrency';
import { ConfirmDialog, MoneyInput, Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

export default function CuentasView(props: { summary: Resumen; onEdit: (c: Cuenta | 'new') => void }) {
  const { summary, onEdit } = props;
  const { totales } = summary;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Cuentas</h1>
        <button className="btn btn-primary btn-sm" onClick={() => onEdit('new')}>
          <Plus size={18} aria-hidden="true" /> Agregar
        </button>
      </header>

      <section className="networth-card" aria-label="Tu plata real">
        <span className="label">Tu plata real</span>
        <AnimatedCurrency value={totales.neto} className="big amount" />
        <span className="note-text">Lo que tienes menos lo que debes</span>
        <div className="networth-split">
          <div>
            <span>Tienes</span>
            <strong className="amount">{fmtCOP(totales.tienes)}</strong>
          </div>
          <div>
            <span>Debes en tarjetas</span>
            <strong className="amount">{fmtCOP(totales.debes)}</strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Mis cuentas</h2>
          <span className="muted">{summary.cuentas.length}</span>
        </div>
        <div className="card flush">
          {summary.cuentas.map((c) => (
            <button key={c.id} className="acct-row" onClick={() => onEdit(c)}>
              <IconTile visual={{ Icon: KIND_ICONS[c.tipo], color: KIND_COLORS[c.tipo] }} />
              <span className="tx-main">
                <span className="tx-title">
                  <span>{c.nombre}</span>
                  {c.principal && (
                    <span className="badge">
                      <Star size={10} fill="currentColor" aria-hidden="true" /> Principal
                    </span>
                  )}
                </span>
                <span className="tx-sub">{KIND_SHORT[c.tipo]}</span>
              </span>
              <span className={`acct-balance${c.saldo < 0 ? ' negative' : ''}`}>
                <span className="amount">{fmtCOP(Math.abs(c.saldo))}</span>
                {c.saldo < 0 && <small>{c.tipo === 'credito' ? 'Debes' : 'En rojo'}</small>}
              </span>
              <ChevronRight size={18} className="chev" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <p className="hint">
        <MessageCircle size={18} aria-hidden="true" />
        <span>
          También puedes decirle a Aura <em>"tengo 300 mil en Nequi"</em> o <em>"debo 1 millón en la Visa"</em>. Uso tu cuenta
          principal cuando no me dices con qué pagaste.
        </span>
      </p>
    </div>
  );
}

export function AccountSheet(props: { cuenta: Cuenta | null; onClose: () => void; onSaved: (s: Resumen) => void; run: Run }) {
  const { cuenta, onClose, onSaved, run } = props;
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoCuenta>(cuenta?.tipo ?? 'banco');
  const initialSaldo = cuenta ? Math.abs(cuenta.saldo) : 0;
  const [saldo, setSaldo] = useState(cuenta ? formatMoneyInput(String(initialSaldo)) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setSaving(true);
    const res = await run(() => api.updateAccount(cuenta.id, { principal: true }));
    setSaving(false);
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
    <Sheet title={cuenta ? cuenta.nombre : 'Nueva cuenta'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="field">
          <label htmlFor="nombre-cuenta">Nombre</label>
          <input
            id="nombre-cuenta"
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Bancolombia, Nequi, Visa"
            maxLength={40}
            required
            autoFocus={!cuenta}
          />
        </div>
        <div className="field" role="group" aria-labelledby="tipo-cuenta">
          <span id="tipo-cuenta">Tipo de cuenta</span>
          <div className="kind-grid">
            {(Object.keys(KIND_SHORT) as TipoCuenta[]).map((k) => {
              const Icon = KIND_ICONS[k];
              return (
                <button key={k} type="button" className="kind-option" aria-pressed={tipo === k} onClick={() => setTipo(k)}>
                  <Icon size={22} aria-hidden="true" />
                  {KIND_SHORT[k]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label htmlFor="saldo-cuenta">{tipo === 'credito' ? '¿Cuánto debes hoy en esta tarjeta?' : '¿Cuánta plata tiene hoy?'}</label>
          <MoneyInput id="saldo-cuenta" value={saldo} onChange={setSaldo} />
          {cuenta && <small>Si cambias este valor, registro un ajuste para que el saldo quede igual al real.</small>}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || !nombre.trim()}>
          {saving ? <span className="spinner" aria-label="Guardando" /> : 'Guardar'}
        </button>
        {cuenta && !cuenta.principal && (
          <div className="sheet-actions">
            <button type="button" className="btn btn-soft" onClick={makePrincipal} disabled={saving}>
              <Star size={18} aria-hidden="true" /> Principal
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <Trash2 size={18} aria-hidden="true" /> Quitar
            </button>
          </div>
        )}
      </form>
      {confirmDelete && cuenta && (
        <ConfirmDialog
          title={`¿Quitar ${cuenta.nombre}?`}
          message="Si ya tiene movimientos, la guardo en el historial pero deja de aparecer en tus cuentas. Debe estar en $0."
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
