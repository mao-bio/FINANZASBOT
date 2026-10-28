import { useState } from 'react';
import {
  ArrowLeftRight,
  CircleCheck,
  FileText,
  ImageIcon,
  ListOrdered,
  Pencil,
  Plus,
  Receipt,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AccionGuardar, AnalisisImagen, Cuenta, Propuesta, TipoDocumento } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { dayKey, dayLabel, formatMoneyInput, parseMoney, shortCategory } from '../lib/labels';
import { IconTile, txVisual } from '../lib/visuals';
import { MoneyInput } from './Dialogs';

export type EstadoAnalisis = 'pendiente' | 'guardado' | 'descartado';

const DOCS: Record<TipoDocumento, { label: string; Icon: LucideIcon }> = {
  recibo: { label: 'Recibo', Icon: Receipt },
  factura: { label: 'Factura', Icon: FileText },
  comprobante: { label: 'Comprobante de pago', Icon: ArrowLeftRight },
  extracto: { label: 'Extracto de movimientos', Icon: ListOrdered },
  saldo: { label: 'Saldo de cuenta', Icon: Wallet },
  otro: { label: 'Imagen', Icon: ImageIcon },
};

interface Row extends Propuesta {
  key: number;
  incluir: boolean;
  editando: boolean;
}

function rowTitle(r: Row): string {
  if (r.accion === 'saldo') return `Saldo de ${r.cuenta}`;
  if (r.accion === 'transferencia') return r.descripcion || 'Transferencia';
  return r.descripcion || shortCategory(r.categoria);
}

function rowSub(r: Row): string {
  const cuando = r.fecha ? ` · ${dayLabel(r.fecha)}` : '';
  if (r.accion === 'transferencia') return `${r.cuenta} → ${r.cuentaDestino}${cuando}`;
  if (r.accion === 'saldo') return 'Dejar el saldo en este valor';
  return `${shortCategory(r.categoria)} · ${r.cuenta}${cuando}`;
}

function rowAmount(r: Row): string {
  if (r.accion === 'gasto') return `-${fmtCOP(r.monto)}`;
  if (r.accion === 'ingreso') return `+${fmtCOP(r.monto)}`;
  return fmtCOP(r.monto);
}

/** Tarjeta para revisar y corregir lo que la IA leyó en una imagen antes de guardarlo. */
export default function AnalysisCard(props: {
  data: AnalisisImagen;
  estado: EstadoAnalisis;
  cuentas: Cuenta[];
  categorias: { gasto: string[]; ingreso: string[] };
  onSave: (acciones: AccionGuardar[]) => Promise<boolean>;
  onDiscard: () => void;
}) {
  const { data, estado, cuentas, categorias } = props;
  const [rows, setRows] = useState<Row[]>(() =>
    data.propuestas.map((p, i) => ({ ...p, key: i, incluir: !p.posibleDuplicado, editando: false })),
  );
  const [saving, setSaving] = useState(false);
  const doc = DOCS[data.tipoDocumento];
  const pendiente = estado === 'pendiente';
  const seleccionadas = rows.filter((r) => r.incluir && (r.monto > 0 || r.accion === 'saldo'));

  const existentes = cuentas.map((c) => c.nombre);
  const nuevas = Array.from(
    new Set(data.propuestas.flatMap((p) => [p.cuentaNueva ? p.cuenta : '', p.cuentaDestinoNueva ? p.cuentaDestino : ''])),
  ).filter((n) => n && !existentes.includes(n));

  const update = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    const ok = await props.onSave(
      seleccionadas.map((r) => ({
        accion: r.accion,
        monto: r.monto,
        categoria: r.categoria,
        descripcion: r.descripcion,
        cuenta: r.cuenta,
        cuenta_destino: r.cuentaDestino,
        tipo_cuenta: r.cuentaNueva || r.cuentaDestinoNueva ? r.tipoCuenta : '',
        fecha: r.fecha,
      })),
    );
    if (!ok) setSaving(false);
  }

  const accountSelect = (value: string, onChange: (nombre: string, nueva: boolean) => void, id: string) => (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value, nuevas.includes(e.target.value))}>
      {existentes.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      {nuevas.map((n) => (
        <option key={n} value={n}>
          Nueva cuenta: {n}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`analysis${pendiente ? '' : ' done'}`}>
      <div className="analysis-head">
        <IconTile visual={{ Icon: doc.Icon, color: 'var(--primary)' }} />
        <div className="analysis-title">
          <span className="analysis-kicker">{doc.label}</span>
          <strong>{data.comercio || doc.label}</strong>
        </div>
        {data.total > 0 && <span className="amount analysis-total">{fmtCOP(data.total)}</span>}
      </div>

      {data.resumen && <p className="analysis-summary">{data.resumen}</p>}

      {(data.fecha || data.items.length > 0) && (
        <div className="analysis-meta">
          {data.fecha && <span>Fecha: {dayLabel(data.fecha)}</span>}
          {data.items.length > 0 && (
            <details>
              <summary>
                Ver {data.items.length} {data.items.length === 1 ? 'producto' : 'productos'}
              </summary>
              <ul className="analysis-items">
                {data.items.map((it, i) => (
                  <li key={i}>
                    <span>{it.descripcion}</span>
                    <span className="amount">{fmtCOP(it.monto)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="analysis-empty">No encontré movimientos de plata para registrar en esta imagen.</p>
      ) : (
        <>
          <p className="analysis-label">{pendiente ? 'Revisa antes de guardar' : 'Movimientos'}</p>
          <ul className="prop-list">
            {rows.map((r) => {
              const tipo = r.accion === 'saldo' ? 'ajuste' : r.accion;
              const id = `prop-${r.key}`;
              return (
                <li key={r.key} className={`prop${r.incluir ? '' : ' off'}`}>
                  <div className="prop-line">
                    <input
                      type="checkbox"
                      className="prop-check"
                      checked={r.incluir}
                      disabled={!pendiente}
                      onChange={(e) => update(r.key, { incluir: e.target.checked })}
                      aria-label={`Guardar ${rowTitle(r)}`}
                    />
                    <IconTile visual={txVisual({ tipo, categoria: r.categoria })} size="sm" />
                    <span className="tx-main">
                      <span className="tx-title">
                        <span>{rowTitle(r)}</span>
                      </span>
                      <span className="tx-sub">{rowSub(r)}</span>
                    </span>
                    <span className={`tx-amount amount ${tipo}`}>{rowAmount(r)}</span>
                    {pendiente && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => update(r.key, { editando: !r.editando })}
                        aria-label={`Editar ${rowTitle(r)}`}
                        aria-expanded={r.editando}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                  {r.posibleDuplicado && (
                    <p className="prop-flag warn">
                      <TriangleAlert size={14} aria-hidden="true" /> Parece que ya lo tienes registrado, por eso lo dejé sin marcar.
                    </p>
                  )}
                  {(r.cuentaNueva || r.cuentaDestinoNueva) && (
                    <p className="prop-flag">
                      <Plus size={14} aria-hidden="true" /> Se creará la cuenta {r.cuentaNueva ? r.cuenta : r.cuentaDestino}
                    </p>
                  )}

                  {pendiente && r.editando && (
                    <div className="prop-edit">
                      {(r.accion === 'gasto' || r.accion === 'ingreso') && (
                        <div className="field span-2">
                          <span>Tipo</span>
                          <div className="seg">
                            {(['gasto', 'ingreso'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                aria-pressed={r.accion === t}
                                onClick={() =>
                                  r.accion !== t &&
                                  update(r.key, { accion: t, categoria: t === 'ingreso' ? 'Otros ingresos' : 'Otros gastos' })
                                }
                              >
                                {t === 'gasto' ? 'Gasto' : 'Ingreso'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.accion !== 'saldo' && (
                        <div className="field span-2">
                          <label htmlFor={`${id}-desc`}>Descripción</label>
                          <input
                            id={`${id}-desc`}
                            className="input"
                            value={r.descripcion}
                            maxLength={60}
                            onChange={(e) => update(r.key, { descripcion: e.target.value })}
                          />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor={`${id}-monto`}>{r.accion === 'saldo' ? 'Saldo' : 'Monto'}</label>
                        <MoneyInput
                          id={`${id}-monto`}
                          value={formatMoneyInput(String(r.monto))}
                          onChange={(v) => update(r.key, { monto: Number.isFinite(parseMoney(v)) ? parseMoney(v) : 0 })}
                        />
                      </div>
                      {r.accion !== 'saldo' && (
                        <div className="field">
                          <label htmlFor={`${id}-fecha`}>Fecha</label>
                          <input
                            id={`${id}-fecha`}
                            className="input"
                            type="date"
                            value={r.fecha}
                            max={dayKey(new Date())}
                            onChange={(e) => update(r.key, { fecha: e.target.value })}
                          />
                        </div>
                      )}
                      {(r.accion === 'gasto' || r.accion === 'ingreso') && (
                        <div className="field span-2">
                          <label htmlFor={`${id}-cat`}>Categoría</label>
                          <select
                            id={`${id}-cat`}
                            className="input"
                            value={r.categoria}
                            onChange={(e) => update(r.key, { categoria: e.target.value })}
                          >
                            {categorias[r.accion].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className={`field${r.accion === 'transferencia' ? '' : ' span-2'}`}>
                        <label htmlFor={`${id}-cuenta`}>{r.accion === 'transferencia' ? 'Sale de' : 'Cuenta'}</label>
                        {accountSelect(r.cuenta, (nombre, nueva) => update(r.key, { cuenta: nombre, cuentaNueva: nueva }), `${id}-cuenta`)}
                      </div>
                      {r.accion === 'transferencia' && (
                        <div className="field">
                          <label htmlFor={`${id}-destino`}>Llega a</label>
                          {accountSelect(
                            r.cuentaDestino,
                            (nombre, nueva) => update(r.key, { cuentaDestino: nombre, cuentaDestinoNueva: nueva }),
                            `${id}-destino`,
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pendiente ? (
        <div className="analysis-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onDiscard} disabled={saving}>
            Descartar
          </button>
          {rows.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || seleccionadas.length === 0}>
              {saving ? (
                <span className="spinner" aria-label="Guardando" />
              ) : (
                `Guardar ${seleccionadas.length > 1 ? seleccionadas.length : ''}`.trim()
              )}
            </button>
          )}
        </div>
      ) : (
        <p className={`analysis-status${estado === 'guardado' ? ' ok' : ''}`}>
          {estado === 'guardado' ? (
            <>
              <CircleCheck size={16} aria-hidden="true" /> Guardado
            </>
          ) : (
            'Descartado'
          )}
        </p>
      )}
    </div>
  );
}
