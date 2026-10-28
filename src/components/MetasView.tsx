import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Bike,
  BriefcaseBusiness,
  CalendarClock,
  CircleCheck,
  CircleX,
  HandCoins,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  SlidersHorizontal,
  Target,
  Trash2,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { Escenario, Hallazgos, Meta, Resumen } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { planMeta, simularMeta, sumarDias, sumarMeses, type EstadoMeta, type PlanMeta } from '../../shared/plan';
import {
  paramsIniciales,
  simularEscenario,
  type Base,
  type ParamsEscenario,
  type ResultadoEscenario,
  type TipoEscenario,
  type Veredicto,
} from '../../shared/simulador';
import { api } from '../lib/api';
import { dayKey, formatMoneyInput, longDay, parseMoney, shortDay } from '../lib/labels';
import { IconTile } from '../lib/visuals';
import { ConfirmDialog, MoneyInput, Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Panel = 'metas' | 'decisiones';
type Tono = 'good' | 'warning' | 'critical';
type BaseMeta = Hallazgos['base'];

const ESTADOS: Record<EstadoMeta, { label: string; tono: Tono; Icon: LucideIcon }> = {
  lograda: { label: '¡Lograda!', tono: 'good', Icon: CircleCheck },
  'a-tiempo': { label: 'Vas a tiempo', tono: 'good', Icon: CircleCheck },
  ajustado: { label: 'Ajustado', tono: 'warning', Icon: TriangleAlert },
  dificil: { label: 'Difícil a tu ritmo', tono: 'critical', Icon: CircleX },
  vencida: { label: 'Se venció la fecha', tono: 'critical', Icon: CalendarClock },
  'sin-capacidad': { label: 'Hoy no te sobra plata', tono: 'critical', Icon: CircleX },
};

const VEREDICTOS: Record<Veredicto, { label: string; corto: string; tono: Tono; Icon: LucideIcon }> = {
  viable: { label: 'Se ve viable', corto: 'Viable', tono: 'good', Icon: CircleCheck },
  ajustado: { label: 'Se puede, pero ajustado', corto: 'Ajustado', tono: 'warning', Icon: TriangleAlert },
  riesgoso: { label: 'Riesgoso por ahora', corto: 'Riesgoso', tono: 'critical', Icon: CircleX },
};

const TIPOS: { id: TipoEscenario; label: string; corto: string; Icon: LucideIcon; color: string }[] = [
  { id: 'moto', label: 'Comprar moto', corto: 'Moto', Icon: Bike, color: '#e0662a' },
  { id: 'credito', label: 'Tomar crédito', corto: 'Crédito', Icon: HandCoins, color: '#2f5bea' },
  { id: 'mudanza', label: 'Mudarme', corto: 'Mudanza', Icon: Truck, color: '#0b8a67' },
  { id: 'empleo', label: 'Cambiar de empleo', corto: 'Empleo', Icon: BriefcaseBusiness, color: '#7b5cff' },
];

function plazo(dias: number): string {
  if (dias < 45) return dias === 1 ? '1 día' : `${dias} días`;
  const meses = Math.round(dias / 30.4375);
  return meses === 1 ? '1 mes' : `${meses} meses`;
}

function conSigno(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtCOP(Math.abs(n))}`;
}

/** Cifras cortas para tablas angostas: "$ 1,4 M", "$ 785 mil" */
function corto(n: number): string {
  const abs = Math.abs(n);
  const signo = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${signo}$ ${(abs / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: abs >= 10_000_000 ? 1 : 2 })} M`;
  if (abs >= 1_000) return `${signo}$ ${Math.round(abs / 1_000).toLocaleString('es-CO')} mil`;
  return `${signo}${fmtCOP(abs)}`;
}

function cortoConSigno(n: number): string {
  return n > 0 ? `+${corto(n)}` : corto(n);
}

/** La cifra que identifica un escenario: precio, monto, arriendo o salario. */
function cifraClave(e: ParamsEscenario): number {
  switch (e.tipo) {
    case 'moto':
      return e.params.precio;
    case 'credito':
      return e.params.monto;
    case 'mudanza':
      return e.params.arriendoNuevo;
    case 'empleo':
      return e.params.salarioNuevo;
  }
}

function explicacion(plan: PlanMeta, capacidad: number): string {
  switch (plan.estado) {
    case 'lograda':
      return 'Ya tienes toda la plata. ¡Bien hecho!';
    case 'vencida':
      return 'La fecha ya pasó. Ponle una nueva para recalcular el plan.';
    case 'sin-capacidad':
      return 'Últimamente gastas lo mismo o más de lo que te entra. Recorta algo o súmale ingresos para avanzar.';
    case 'a-tiempo':
      return `Normalmente te sobran ${fmtCOP(capacidad)} al mes, así que te alcanza.`;
    case 'ajustado':
      return `Necesitas casi todo lo que te sobra al mes (${fmtCOP(capacidad)}).`;
    case 'dificil':
      return `Normalmente te sobran ${fmtCOP(capacidad)} al mes; no te alcanza para esa fecha.`;
  }
}

function EstadoTexto({ tono, Icon, children }: { tono: Tono; Icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={`status-text status-${tono}`}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export default function MetasView(props: {
  summary: Resumen;
  insights: Hallazgos | null;
  goals: Meta[] | null;
  onGoals: (g: Meta[]) => void;
  run: Run;
  onAskAura: (prompt: string) => void;
}) {
  const { insights, goals } = props;
  const [panel, setPanel] = useState<Panel>('metas');
  const [editing, setEditing] = useState<Meta | 'new' | null>(null);
  const [abonando, setAbonando] = useState<Meta | null>(null);
  const hoy = dayKey(new Date());

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Metas</h1>
        {panel === 'metas' && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Plus size={18} aria-hidden="true" /> Nueva
          </button>
        )}
      </header>

      <div className="seg" role="tablist" aria-label="Metas o decisiones">
        <button role="tab" aria-selected={panel === 'metas'} aria-pressed={panel === 'metas'} onClick={() => setPanel('metas')}>
          Mis metas
        </button>
        <button role="tab" aria-selected={panel === 'decisiones'} aria-pressed={panel === 'decisiones'} onClick={() => setPanel('decisiones')}>
          Simular decisiones
        </button>
      </div>

      {!insights || (panel === 'metas' && !goals) ? (
        <div className="skeleton" aria-label="Cargando…" />
      ) : panel === 'metas' ? (
        <MetasPanel
          goals={goals!}
          base={insights.base}
          porEncima={insights.porEncima}
          hoy={hoy}
          onNew={() => setEditing('new')}
          onEdit={setEditing}
          onAbonar={setAbonando}
          onAskAura={props.onAskAura}
        />
      ) : (
        <DecisionesPanel base={insights.base} goals={goals ?? []} hoy={hoy} run={props.run} onAskAura={props.onAskAura} />
      )}

      {editing && (
        <GoalSheet
          meta={editing === 'new' ? null : editing}
          summary={props.summary}
          base={insights?.base ?? null}
          hoy={hoy}
          run={props.run}
          onClose={() => setEditing(null)}
          onSaved={(g) => {
            props.onGoals(g);
            setEditing(null);
          }}
        />
      )}
      {abonando && (
        <AbonoSheet
          meta={abonando}
          run={props.run}
          onClose={() => setAbonando(null)}
          onSaved={(g) => {
            props.onGoals(g);
            setAbonando(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Mis metas ────────────────────────────────────────────────────────────────

function MetasPanel(props: {
  goals: Meta[];
  base: BaseMeta;
  porEncima: Hallazgos['porEncima'];
  hoy: string;
  onNew: () => void;
  onEdit: (m: Meta) => void;
  onAbonar: (m: Meta) => void;
  onAskAura: (prompt: string) => void;
}) {
  const { goals, base, hoy } = props;
  const planes = goals.map((m) => planMeta({ meta: m.monto, ahorrado: m.ahorrado, fechaMeta: m.fecha, hoy, capacidadMensual: base.capacidadMensual }));
  const piden = planes.reduce((s, p) => s + (p.estado === 'lograda' || p.estado === 'vencida' ? 0 : p.porMes), 0);
  const gastoExtra = props.porEncima.reduce((s, p) => s + p.diferencia, 0);
  const aumentoPct = base.gastoMensual > 0 ? (gastoExtra / base.gastoMensual) * 100 : 0;
  const sinHistoria = base.ingresoMensual === 0 && base.gastoMensual === 0;

  return (
    <>
      <section className="card capacity-card" aria-label="Lo que te sobra al mes">
        <div className="capacity-top">
          <IconTile visual={{ Icon: Target, color: 'var(--primary)' }} />
          <div>
            <span className="capacity-label">Te sobran en promedio</span>
            <strong className={`amount capacity-value${base.capacidadMensual < 0 ? ' neg' : ''}`}>{fmtCOP(base.capacidadMensual)} al mes</strong>
          </div>
        </div>
        {sinHistoria ? (
          <p className="capacity-sub">Cuando registres tus ingresos y gastos de un mes completo, calculo cuánto te sobra para tus metas.</p>
        ) : (
          <p className="capacity-sub">
            Te entran {fmtCOP(base.ingresoMensual)} y gastas {fmtCOP(base.gastoMensual)} (promedio de tus últimos meses).
          </p>
        )}
        {piden > 0 && base.capacidadMensual > 0 && (
          <div className="capacity-use">
            <div className="budget-top">
              <span>Tus metas piden</span>
              <span className="amount">
                {fmtCOP(piden)} <small>de {fmtCOP(base.capacidadMensual)}</small>
              </span>
            </div>
            <div
              className={`bar ${piden > base.capacidadMensual ? 'status-critical' : piden > base.capacidadMensual * 0.8 ? 'status-warning' : 'status-good'}`}
              role="img"
              aria-label={`Tus metas usan el ${Math.round((piden / base.capacidadMensual) * 100)}% de lo que te sobra`}
            >
              <span className="bar-fill" style={{ display: 'block', width: `${Math.min(100, (piden / base.capacidadMensual) * 100)}%` }} />
            </div>
            {piden > base.capacidadMensual && (
              <EstadoTexto tono="critical" Icon={CircleX}>
                Juntas piden {fmtCOP(piden - base.capacidadMensual)} más de lo que te sobra. Mueve alguna fecha o prioriza.
              </EstadoTexto>
            )}
          </div>
        )}
        {gastoExtra > 0 && (
          <p className="hint">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              Este mes vas <em>{fmtCOP(gastoExtra)}</em> por encima de lo normal en {props.porEncima.map((p) => p.grupo).join(', ')}. En cada
              meta te muestro cómo cambia el plan si sigues así.
            </span>
          </p>
        )}
      </section>

      {goals.length === 0 ? (
        <div className="card goal-empty">
          <IconTile visual={{ Icon: Target, color: 'var(--primary)' }} size="lg" />
          <h2>¿Para qué estás ahorrando?</h2>
          <p className="muted">
            Ponle nombre, valor y fecha a una meta y te digo cuánto apartar por día, por semana y por mes. También se la puedes contar a Aura:
            "quiero ahorrar 3 millones para un viaje en diciembre".
          </p>
          <button className="btn btn-primary" onClick={props.onNew}>
            <Plus size={18} aria-hidden="true" /> Crear mi primera meta
          </button>
        </div>
      ) : (
        goals.map((m, i) => (
          <GoalCard
            key={m.id}
            meta={m}
            plan={planes[i]}
            base={base}
            hoy={hoy}
            aumentoPct={aumentoPct}
            onEdit={() => props.onEdit(m)}
            onAbonar={() => props.onAbonar(m)}
            onAskAura={props.onAskAura}
          />
        ))
      )}
    </>
  );
}

function GoalCard(props: {
  meta: Meta;
  plan: PlanMeta;
  base: BaseMeta;
  hoy: string;
  aumentoPct: number;
  onEdit: () => void;
  onAbonar: () => void;
  onAskAura: (prompt: string) => void;
}) {
  const { meta, plan, base, hoy } = props;
  const [simulando, setSimulando] = useState(false);
  const estado = ESTADOS[plan.estado];
  const pct = Math.round(plan.progreso * 100);
  const activa = plan.estado !== 'lograda' && plan.estado !== 'vencida';
  const entrada = { meta: meta.monto, ahorrado: meta.ahorrado, fechaMeta: meta.fecha, hoy, capacidadMensual: base.capacidadMensual, gastoMensual: base.gastoMensual };
  const ajustado =
    activa && props.aumentoPct > 0 ? simularMeta(entrada, { aumentoGastosPct: props.aumentoPct, ahorroExtraMensual: 0, mesesExtra: 0 }) : null;

  return (
    <article className="card goal-card" aria-label={`Meta ${meta.nombre}`}>
      <div className="goal-top">
        <IconTile visual={{ Icon: Target, color: plan.estado === 'lograda' ? 'var(--income)' : 'var(--primary)' }} />
        <div className="goal-name">
          <h2>{meta.nombre}</h2>
          <span>
            Para el {longDay(meta.fecha)}
            {meta.cuenta && ` · en ${meta.cuenta}`}
          </span>
        </div>
        <button className="icon-btn" onClick={props.onEdit} aria-label={`Editar ${meta.nombre}`}>
          <Pencil size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="goal-progress">
        <div className="goal-amounts">
          <strong className="amount">{fmtCOP(meta.ahorrado)}</strong>
          <span className="amount">de {fmtCOP(meta.monto)}</span>
          <span className="goal-pct">{pct}%</span>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Llevas el ${pct}%`}>
          <span className={`bar-fill goal-fill${plan.estado === 'lograda' ? ' done' : ''}`} style={{ display: 'block', width: `${pct}%` }} />
        </div>
      </div>

      {activa && (
        <>
          <p className="goal-falta">
            Te faltan <strong className="amount">{fmtCOP(plan.falta)}</strong> y quedan {plazo(plan.diasRestantes)}. Aparta:
          </p>
          <div className="goal-rates">
            <div>
              <span>Por día</span>
              <strong className="amount">{fmtCOP(plan.porDia)}</strong>
            </div>
            <div>
              <span>Por semana</span>
              <strong className="amount">{fmtCOP(plan.porSemana)}</strong>
            </div>
            <div>
              <span>Por mes</span>
              <strong className="amount">{fmtCOP(plan.porMes)}</strong>
            </div>
          </div>
        </>
      )}

      <EstadoTexto tono={estado.tono} Icon={estado.Icon}>
        <strong>{estado.label}.</strong> {explicacion(plan, base.capacidadMensual)}
        {activa && plan.estado !== 'a-tiempo' && plan.fechaProyectada && ` A tu ritmo llegarías el ${longDay(plan.fechaProyectada)}.`}
      </EstadoTexto>

      {ajustado && ajustado.estado !== plan.estado && (
        <p className="goal-adjust">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            Si sigues gastando como este mes, te sobrarían {fmtCOP(Math.max(0, ajustado.capacidadMensual))} al mes:{' '}
            <strong>{ESTADOS[ajustado.estado].label.toLowerCase()}</strong>
            {ajustado.fechaProyectada ? `, llegarías el ${longDay(ajustado.fechaProyectada)}` : ''}.
          </span>
        </p>
      )}

      <div className="goal-actions">
        {!meta.cuentaId && plan.estado !== 'lograda' && (
          <button className="btn btn-soft btn-sm" onClick={props.onAbonar}>
            <Plus size={16} aria-hidden="true" /> Abonar
          </button>
        )}
        {activa && (
          <button className="btn btn-ghost btn-sm" aria-expanded={simulando} onClick={() => setSimulando((v) => !v)}>
            <SlidersHorizontal size={16} aria-hidden="true" /> {simulando ? 'Cerrar' : 'Simular escenarios'}
          </button>
        )}
        {plan.estado === 'vencida' && (
          <button className="btn btn-soft btn-sm" onClick={props.onEdit}>
            <CalendarClock size={16} aria-hidden="true" /> Nueva fecha
          </button>
        )}
      </div>

      {simulando && activa && <GoalSimulator meta={meta} plan={plan} base={base} hoy={hoy} onAskAura={props.onAskAura} />}
    </article>
  );
}

const GASTO_OPCIONES: [number, string][] = [
  [-10, 'Bajan 10%'],
  [0, 'Igual'],
  [10, 'Suben 10%'],
  [20, 'Suben 20%'],
  [30, 'Suben 30%'],
];
const FECHA_OPCIONES: [number, string][] = [
  [-3, '3 meses antes'],
  [-1, '1 mes antes'],
  [0, 'Igual'],
  [1, '1 mes después'],
  [3, '3 meses después'],
  [6, '6 meses después'],
];

/** Simula la meta con otros gastos, ahorro extra u otra fecha, y lo compara con el plan de hoy. */
function GoalSimulator(props: { meta: Meta; plan: PlanMeta; base: BaseMeta; hoy: string; onAskAura: (prompt: string) => void }) {
  const { meta, plan, base, hoy } = props;
  const [gastoPct, setGastoPct] = useState(0);
  const [extra, setExtra] = useState('');
  const [meses, setMeses] = useState(0);
  const extraNum = parseMoney(extra) || 0;
  const sim = simularMeta(
    { meta: meta.monto, ahorrado: meta.ahorrado, fechaMeta: meta.fecha, hoy, capacidadMensual: base.capacidadMensual, gastoMensual: base.gastoMensual },
    { aumentoGastosPct: gastoPct, ahorroExtraMensual: extraNum, mesesExtra: meses },
  );
  const igual = gastoPct === 0 && extraNum === 0 && meses === 0;
  const id = `sim-${meta.id}`;
  const fila = (label: string, hoyVal: string, escVal: string) => (
    <tr>
      <th scope="row">{label}</th>
      <td className="amount">{hoyVal}</td>
      <td className={`amount${hoyVal !== escVal ? ' changed' : ''}`}>{escVal}</td>
    </tr>
  );
  const llegada = (p: PlanMeta) => (p.fechaProyectada ? shortDay(p.fechaProyectada) : 'No llegas');
  const estadoSim = ESTADOS[sim.estado];
  const estadoHoy = ESTADOS[plan.estado];

  return (
    <div className="goal-sim">
      <fieldset className="chip-field">
        <legend>Si tus gastos…</legend>
        <div className="chips wrap">
          {GASTO_OPCIONES.map(([v, label]) => (
            <button key={v} type="button" className="chip" aria-pressed={gastoPct === v} onClick={() => setGastoPct(v)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-extra`}>Ahorro extra al mes</label>
        <MoneyInput id={`${id}-extra`} value={extra} onChange={setExtra} />
      </div>
      <fieldset className="chip-field">
        <legend>Mover la fecha</legend>
        <div className="chips wrap">
          {FECHA_OPCIONES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={meses === v}
              disabled={v !== 0 && sumarMeses(meta.fecha, v) <= hoy}
              onClick={() => setMeses(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="table-scroll">
        <table className="data-table sim-table">
          <caption className="sr-only">Plan de hoy contra el escenario</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">Hoy</th>
              <th scope="col">Escenario</th>
            </tr>
          </thead>
          <tbody>
            {fila('Te sobra al mes', fmtCOP(base.capacidadMensual), fmtCOP(sim.capacidadMensual))}
            {fila('Fecha meta', shortDay(meta.fecha), shortDay(sim.fechaMeta))}
            {fila('Aparta por mes', fmtCOP(plan.porMes), fmtCOP(sim.porMes))}
            {fila('Por semana', fmtCOP(plan.porSemana), fmtCOP(sim.porSemana))}
            {fila('Por día', fmtCOP(plan.porDia), fmtCOP(sim.porDia))}
            {fila('A tu ritmo llegas', llegada(plan), llegada(sim))}
            <tr>
              <th scope="row">Cómo vas</th>
              <td>
                <EstadoTexto tono={estadoHoy.tono} Icon={estadoHoy.Icon}>
                  {estadoHoy.label}
                </EstadoTexto>
              </td>
              <td>
                <EstadoTexto tono={estadoSim.tono} Icon={estadoSim.Icon}>
                  {estadoSim.label}
                </EstadoTexto>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {!igual && (
        <button
          className="btn btn-ghost btn-sm sim-aura"
          onClick={() =>
            props.onAskAura(
              `Para mi meta "${meta.nombre}" simulé que ${gastoPct ? `mis gastos ${gastoPct > 0 ? 'suben' : 'bajan'} ${Math.abs(gastoPct)}%` : 'mis gastos siguen igual'}` +
                `${extraNum ? `, ahorro ${fmtCOP(extraNum)} extra al mes` : ''}${meses ? ` y muevo la fecha al ${longDay(sim.fechaMeta)}` : ''}. ` +
                `Así tendría que apartar ${fmtCOP(sim.porMes)} al mes. ¿Qué me recomiendas?`,
            )
          }
        >
          <Sparkles size={16} aria-hidden="true" /> Pedirle consejo a Aura
        </button>
      )}
    </div>
  );
}

// ─── Crear / editar meta ──────────────────────────────────────────────────────

function GoalSheet(props: {
  meta: Meta | null;
  summary: Resumen;
  base: BaseMeta | null;
  hoy: string;
  run: Run;
  onClose: () => void;
  onSaved: (g: Meta[]) => void;
}) {
  const { meta, hoy } = props;
  const [nombre, setNombre] = useState(meta?.nombre ?? '');
  const [monto, setMonto] = useState(meta ? formatMoneyInput(String(meta.monto)) : '');
  const [fecha, setFecha] = useState(meta?.fecha ?? sumarMeses(hoy, 6));
  const [cuentaId, setCuentaId] = useState<number | null>(meta?.cuentaId ?? null);
  const [ahorrado, setAhorrado] = useState(meta && !meta.cuentaId ? formatMoneyInput(String(meta.ahorrado)) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cuentas = props.summary.cuentas.filter((c) => c.tipo !== 'credito');
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  const montoNum = parseMoney(monto);
  const ahorradoNum = cuenta ? Math.max(0, cuenta.saldo) : parseMoney(ahorrado) || 0;
  const vista =
    montoNum > 0 && fecha > hoy
      ? planMeta({ meta: montoNum, ahorrado: ahorradoNum, fechaMeta: fecha, hoy, capacidadMensual: props.base?.capacidadMensual ?? 0 })
      : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError('Ponle un nombre a la meta.');
    if (!(montoNum > 0)) return setError('Escribe cuánta plata necesitas.');
    if (!fecha || (fecha <= hoy && fecha !== meta?.fecha)) return setError('La fecha tiene que ser en el futuro.');
    setError(null);
    setSaving(true);
    const body = {
      nombre: nombre.trim(),
      monto: montoNum,
      cuentaId,
      ...(fecha !== meta?.fecha ? { fecha } : {}),
      ...(cuentaId ? {} : { ahorrado: parseMoney(ahorrado) || 0 }),
    };
    const res = await props.run(() => (meta ? api.updateGoal(meta.id, body) : api.createGoal({ ...body, fecha })));
    setSaving(false);
    if (res) props.onSaved(res);
  }

  async function remove() {
    if (!meta) return;
    setSaving(true);
    const res = await props.run(() => api.deleteGoal(meta.id));
    setSaving(false);
    setConfirmDelete(false);
    if (res) props.onSaved(res);
  }

  return (
    <Sheet title={meta ? 'Editar meta' : 'Nueva meta'} onClose={props.onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="goal-name">¿Para qué ahorras?</label>
          <input
            id="goal-name"
            className="input"
            value={nombre}
            maxLength={60}
            placeholder="Viaje a Cartagena"
            autoFocus={!meta}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="goal-amount">¿Cuánta plata necesitas?</label>
          <MoneyInput id="goal-amount" value={monto} onChange={setMonto} />
        </div>
        <div className="field">
          <label htmlFor="goal-date">¿Para cuándo?</label>
          <input id="goal-date" className="input" type="date" min={sumarDias(hoy, 1)} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <div className="chips wrap" aria-label="Fechas rápidas">
            {[3, 6, 12].map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={fecha === sumarMeses(hoy, m)} onClick={() => setFecha(sumarMeses(hoy, m))}>
                {m === 12 ? 'En 1 año' : `En ${m} meses`}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="goal-account">¿Dónde la vas guardando?</label>
          <select
            id="goal-account"
            className="select"
            value={cuentaId ?? ''}
            onChange={(e) => setCuentaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Llevo la cuenta aquí (abonos)</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                En mi cuenta {c.nombre} ({fmtCOP(c.saldo)})
              </option>
            ))}
          </select>
          <small>{cuenta ? 'Lo ahorrado será el saldo de esa cuenta.' : 'Vas sumando abonos a mano cada vez que separes plata.'}</small>
        </div>
        {!cuenta && (
          <div className="field">
            <label htmlFor="goal-saved">{meta ? 'Llevas ahorrado' : '¿Ya tienes algo ahorrado?'}</label>
            <MoneyInput id="goal-saved" value={ahorrado} onChange={setAhorrado} />
          </div>
        )}

        {vista && vista.estado !== 'lograda' && (
          <p className="hint">
            <Target size={16} aria-hidden="true" />
            <span>
              Tendrías que apartar <em>{fmtCOP(vista.porMes)}</em> al mes ({fmtCOP(vista.porSemana)} por semana).{' '}
              {props.base && props.base.capacidadMensual > 0 && `Normalmente te sobran ${fmtCOP(props.base.capacidadMensual)}.`}
            </span>
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className={meta ? 'sheet-actions' : ''}>
          {meta && (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <Trash2 size={18} aria-hidden="true" /> Borrar
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
            {saving ? <span className="spinner" aria-label="Guardando" /> : meta ? 'Guardar' : 'Crear meta'}
          </button>
        </div>
      </form>
      {confirmDelete && meta && (
        <ConfirmDialog
          title={`¿Borrar "${meta.nombre}"?`}
          message="Se borra la meta y sus abonos. Tus cuentas y movimientos no cambian."
          confirmLabel="Borrar"
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

function AbonoSheet(props: { meta: Meta; run: Run; onClose: () => void; onSaved: (g: Meta[]) => void }) {
  const { meta } = props;
  const [modo, setModo] = useState<'abonar' | 'sacar'>('abonar');
  const [monto, setMonto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = parseMoney(monto);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(n > 0)) return setError('Escribe un valor.');
    if (modo === 'sacar' && n > meta.ahorrado) return setError(`Solo llevas ${fmtCOP(meta.ahorrado)} en esta meta.`);
    setSaving(true);
    const res = await props.run(() => api.updateGoal(meta.id, { abono: modo === 'abonar' ? n : -n }));
    setSaving(false);
    if (res) props.onSaved(res);
  }

  return (
    <Sheet title={meta.nombre} onClose={props.onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="seg" role="group" aria-label="Tipo de movimiento">
          <button type="button" aria-pressed={modo === 'abonar'} onClick={() => setModo('abonar')}>
            <Plus size={16} aria-hidden="true" /> Abonar
          </button>
          <button type="button" aria-pressed={modo === 'sacar'} onClick={() => setModo('sacar')} disabled={meta.ahorrado <= 0}>
            <Minus size={16} aria-hidden="true" /> Sacar
          </button>
        </div>
        <div className="field">
          <label htmlFor="abono">{modo === 'abonar' ? '¿Cuánto separaste?' : '¿Cuánto sacaste?'}</label>
          <MoneyInput id="abono" value={monto} onChange={setMonto} autoFocus />
          <small>
            Llevas {fmtCOP(meta.ahorrado)} de {fmtCOP(meta.monto)}. Esto solo mueve el contador de la meta; no crea un movimiento en tus cuentas.
          </small>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? <span className="spinner" aria-label="Guardando" /> : modo === 'abonar' ? 'Abonar' : 'Sacar'}
        </button>
      </form>
    </Sheet>
  );
}

// ─── Simular decisiones ───────────────────────────────────────────────────────

type Campo = { key: string; label: string; tipo: 'dinero' | 'tasa' | 'meses' | 'signo'; soloFinanciada?: boolean; ayuda?: string; max?: number };

const CAMPOS: Record<TipoEscenario, Campo[]> = {
  moto: [
    { key: 'precio', label: 'Precio de la moto', tipo: 'dinero' },
    { key: 'cuotaInicial', label: 'Cuota inicial', tipo: 'dinero', soloFinanciada: true },
    { key: 'tasaMensual', label: 'Interés mensual (%)', tipo: 'tasa', soloFinanciada: true },
    { key: 'plazoMeses', label: 'Plazo (meses)', tipo: 'meses', soloFinanciada: true, max: 120 },
    { key: 'gastosMensuales', label: 'Gasolina, mantenimiento, SOAT y seguro al mes', tipo: 'dinero' },
    { key: 'ahorroTransporte', label: 'Lo que dejarías de gastar en buses o apps al mes', tipo: 'dinero' },
  ],
  credito: [
    { key: 'monto', label: '¿Cuánto te prestan?', tipo: 'dinero' },
    { key: 'tasaMensual', label: 'Interés mensual (%)', tipo: 'tasa' },
    { key: 'plazoMeses', label: 'Plazo (meses)', tipo: 'meses', max: 120 },
  ],
  mudanza: [
    { key: 'arriendoActual', label: 'Arriendo actual', tipo: 'dinero' },
    { key: 'arriendoNuevo', label: 'Arriendo nuevo', tipo: 'dinero' },
    { key: 'otrosCambiosMensuales', label: 'Otros gastos del mes (servicios, transporte…)', tipo: 'signo' },
    { key: 'costoMudanza', label: 'Trasteo y arreglos', tipo: 'dinero' },
    { key: 'deposito', label: 'Depósito o pagos por adelantado', tipo: 'dinero' },
  ],
  empleo: [
    { key: 'salarioActual', label: 'Lo que ganas hoy al mes', tipo: 'dinero' },
    { key: 'salarioNuevo', label: 'Lo que ganarías al mes', tipo: 'dinero' },
    { key: 'otrosCambiosMensuales', label: 'Otros gastos del mes (transporte, almuerzos…)', tipo: 'signo' },
    { key: 'mesesSinIngreso', label: 'Meses sin sueldo mientras cambias', tipo: 'meses', max: 24 },
  ],
};

function describir(e: ParamsEscenario): string {
  switch (e.tipo) {
    case 'moto':
      return `comprar una moto de ${fmtCOP(e.params.precio)}${e.params.financiada ? ` a ${e.params.plazoMeses} meses` : ' de contado'}`;
    case 'credito':
      return `tomar un crédito de ${fmtCOP(e.params.monto)} a ${e.params.plazoMeses} meses`;
    case 'mudanza':
      return `mudarme a un arriendo de ${fmtCOP(e.params.arriendoNuevo)}`;
    case 'empleo':
      return `cambiar a un empleo de ${fmtCOP(e.params.salarioNuevo)} al mes`;
  }
}

function nombreSugerido(e: ParamsEscenario): string {
  const d = describir(e);
  return (d.charAt(0).toUpperCase() + d.slice(1)).slice(0, 60);
}

function DecisionesPanel(props: { base: BaseMeta; goals: Meta[]; hoy: string; run: Run; onAskAura: (prompt: string) => void }) {
  const { goals, hoy, run } = props;
  const sinHistoria = props.base.ingresoMensual === 0 && props.base.gastoMensual === 0;
  const [base, setBase] = useState<Base>(props.base);
  const [editBase, setEditBase] = useState(sinHistoria);
  const [tipo, setTipo] = useState<TipoEscenario>('moto');
  const [escenarios, setEscenarios] = useState(() => ({
    moto: paramsIniciales('moto', props.base),
    credito: paramsIniciales('credito', props.base),
    mudanza: paramsIniciales('mudanza', props.base),
    empleo: paramsIniciales('empleo', props.base),
  }));
  const actual = escenarios[tipo];
  const resultado = useMemo(() => simularEscenario(actual, base), [actual, base]);
  const [guardados, setGuardados] = useState<Escenario[] | null>(null);
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [comparar, setComparar] = useState<number[]>([]);
  // Al cargar un escenario guardado, los campos de texto se vuelven a montar con sus valores.
  const [cargas, setCargas] = useState(0);
  const visual = TIPOS.find((t) => t.id === tipo)!;

  useEffect(() => {
    void run(api.scenarios).then((l) => l && setGuardados(l));
  }, [run]);

  const params = actual.params as unknown as Record<string, number | boolean>;
  function setParam(key: string, value: number | boolean) {
    setEscenarios((prev) => ({ ...prev, [tipo]: { tipo, params: { ...prev[tipo].params, [key]: value } } as ParamsEscenario }));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await run(() => api.saveScenario(nombre.trim() || nombreSugerido(actual), actual));
    setGuardando(false);
    if (res) {
      setGuardados(res);
      setNombre('');
      const nuevo = res[0];
      if (nuevo) setComparar((c) => (c.length < 3 ? [...c, nuevo.id] : c));
    }
  }

  async function borrar(id: number) {
    const res = await run(() => api.deleteScenario(id));
    if (res) {
      setGuardados(res);
      setComparar((c) => c.filter((x) => x !== id));
    }
  }

  const campos = CAMPOS[tipo].filter((c) => !c.soloFinanciada || params.financiada);
  const enComparacion = (guardados ?? []).filter((g) => comparar.includes(g.id));

  return (
    <>
      <section className="card base-card" aria-label="Tu situación actual">
        <div className="section-head">
          <h2>Tu situación hoy</h2>
          <button className="link-btn" onClick={() => setEditBase((v) => !v)} aria-expanded={editBase}>
            {editBase ? 'Listo' : 'Cambiar'}
          </button>
        </div>
        {editBase ? (
          <div className="form">
            {sinHistoria && <p className="muted">Todavía no tengo tus promedios. Escríbelos para simular con tus números.</p>}
            {(
              [
                ['ingresoMensual', 'Te entra al mes'],
                ['gastoMensual', 'Gastas al mes'],
                ['disponible', 'Plata disponible hoy'],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <label htmlFor={`base-${key}`}>{label}</label>
                <MoneyInput
                  id={`base-${key}`}
                  value={base[key] ? formatMoneyInput(String(base[key])) : ''}
                  onChange={(v) => setBase((b) => ({ ...b, [key]: parseMoney(v) || 0 }))}
                />
              </div>
            ))}
          </div>
        ) : (
          <dl className="base-grid">
            <div>
              <dt>Te entra</dt>
              <dd className="amount">{fmtCOP(base.ingresoMensual)}</dd>
            </div>
            <div>
              <dt>Gastas</dt>
              <dd className="amount">{fmtCOP(base.gastoMensual)}</dd>
            </div>
            <div>
              <dt>Tienes hoy</dt>
              <dd className="amount">{fmtCOP(base.disponible)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="section" aria-label="¿Qué quieres simular?">
        <div className="section-head">
          <h2>¿Qué estás pensando hacer?</h2>
        </div>
        <div className="kind-grid cols-4" role="group" aria-label="Tipo de decisión">
          {TIPOS.map((t) => (
            <button key={t.id} type="button" className="kind-option" aria-pressed={tipo === t.id} onClick={() => setTipo(t.id)}>
              <t.Icon size={22} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card form sim-form" aria-label={`Datos: ${visual.label}`}>
        {tipo === 'moto' && (
          <div className="seg" role="group" aria-label="Forma de pago">
            <button type="button" aria-pressed={!params.financiada} onClick={() => setParam('financiada', false)}>
              De contado
            </button>
            <button type="button" aria-pressed={!!params.financiada} onClick={() => setParam('financiada', true)}>
              A crédito
            </button>
          </div>
        )}
        {campos.map((c) => (
          <CampoEscenario key={`${tipo}-${c.key}-${cargas}`} id={`esc-${tipo}-${c.key}`} campo={c} value={Number(params[c.key])} onChange={(v) => setParam(c.key, v)} />
        ))}
      </section>

      <ResultadoCard resultado={resultado} goals={goals} base={base} hoy={hoy} />

      <div className="sim-actions">
        <form className="save-row" onSubmit={guardar}>
          <label htmlFor="esc-nombre">Guárdalo para compararlo con otros</label>
          <input
            id="esc-nombre"
            className="input"
            maxLength={60}
            value={nombre}
            placeholder={nombreSugerido(actual)}
            onChange={(e) => setNombre(e.target.value)}
          />
          <button type="submit" className="btn btn-soft" disabled={guardando || (guardados?.length ?? 0) >= 30}>
            {guardando ? <span className="spinner" aria-label="Guardando" /> : 'Guardar'}
          </button>
        </form>
        <button
          className="btn btn-ghost btn-block"
          onClick={() =>
            props.onAskAura(
              `Estoy pensando en ${describir(actual)}. Según el simulador ${
                resultado.cuotaMensual ? `pagaría ${fmtCOP(resultado.cuotaMensual)} de cuota y ` : ''
              }me sobrarían ${fmtCOP(resultado.ahorroMensualDespues)} al mes (hoy me sobran ${fmtCOP(resultado.ahorroMensualAntes)}). ¿Qué me recomiendas?`,
            )
          }
        >
          <Sparkles size={18} aria-hidden="true" /> Pedirle consejo a Aura
        </button>
      </div>

      {guardados && guardados.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Escenarios guardados</h2>
          </div>
          <p className="section-intro">Márcalos (hasta 3) para verlos lado a lado.</p>
          <div className="card flush">
            {guardados.map((g) => {
              const r = simularEscenario(g.escenario, base);
              const v = VEREDICTOS[r.veredicto];
              const t = TIPOS.find((x) => x.id === g.escenario.tipo)!;
              const marcado = comparar.includes(g.id);
              return (
                <div className="scenario-row" key={g.id}>
                  <label className="sim-check">
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={!marcado && comparar.length >= 3}
                      onChange={() => setComparar((c) => (marcado ? c.filter((x) => x !== g.id) : [...c, g.id]))}
                    />
                    <span className="sr-only">Comparar {g.nombre}</span>
                  </label>
                  <button
                    className="scenario-main"
                    onClick={() => {
                      setTipo(g.escenario.tipo);
                      setEscenarios((prev) => ({ ...prev, [g.escenario.tipo]: g.escenario }));
                      setCargas((n) => n + 1);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={`Cargar ${g.nombre}`}
                  >
                    <IconTile visual={{ Icon: t.Icon, color: t.color }} size="sm" />
                    <span className="tx-main">
                      <span className="tx-title">
                        <span>{g.nombre}</span>
                      </span>
                      <span className="tx-sub">
                        {v.corto} · {conSigno(r.cambioMensual)} al mes
                      </span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => borrar(g.id)} aria-label={`Borrar ${g.nombre}`}>
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
          {enComparacion.length > 0 && <CompareTable base={base} escenarios={enComparacion} />}
        </section>
      )}
    </>
  );
}

function CampoEscenario(props: { id: string; campo: Campo; value: number; onChange: (v: number) => void }) {
  const { id, campo, value } = props;
  const [texto, setTexto] = useState(campo.tipo === 'tasa' || campo.tipo === 'meses' ? String(value).replace('.', ',') : '');

  if (campo.tipo === 'dinero') {
    return (
      <div className="field">
        <label htmlFor={id}>{campo.label}</label>
        <MoneyInput id={id} value={value ? formatMoneyInput(String(value)) : ''} onChange={(v) => props.onChange(parseMoney(v) || 0)} />
      </div>
    );
  }
  if (campo.tipo === 'signo') {
    const sube = value >= 0;
    return (
      <div className="field">
        <span id={`${id}-label`}>{campo.label}</span>
        <div className="signed-field">
          <div className="seg" role="group" aria-labelledby={`${id}-label`}>
            <button type="button" aria-pressed={sube} onClick={() => props.onChange(Math.abs(value))}>
              Suben
            </button>
            <button type="button" aria-pressed={!sube} onClick={() => props.onChange(-Math.abs(value))}>
              Bajan
            </button>
          </div>
          <MoneyInput
            id={id}
            value={value ? formatMoneyInput(String(Math.abs(value))) : ''}
            onChange={(v) => props.onChange((parseMoney(v) || 0) * (sube ? 1 : -1))}
          />
        </div>
      </div>
    );
  }
  const ea = campo.tipo === 'tasa' && value > 0 ? (Math.pow(1 + value / 100, 12) - 1) * 100 : null;
  return (
    <div className="field">
      <label htmlFor={id}>{campo.label}</label>
      <input
        id={id}
        className="input"
        inputMode={campo.tipo === 'tasa' ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={texto}
        onChange={(e) => {
          const limpio = e.target.value.replace(campo.tipo === 'tasa' ? /[^\d.,]/g : /\D/g, '');
          setTexto(limpio);
          const n = Number(limpio.replace(',', '.'));
          if (!Number.isFinite(n)) return;
          if (campo.tipo === 'tasa') props.onChange(Math.min(20, n));
          else props.onChange(Math.min(campo.max ?? 120, Math.round(n)));
        }}
      />
      {ea !== null && <small>Equivale a {ea.toLocaleString('es-CO', { maximumFractionDigits: 1 })}% efectivo anual</small>}
    </div>
  );
}

function ResultadoCard(props: { resultado: ResultadoEscenario; goals: Meta[]; base: Base; hoy: string }) {
  const { resultado: r, goals, hoy } = props;
  const v = VEREDICTOS[r.veredicto];
  const impactos = goals
    .map((m) => {
      const entrada = { meta: m.monto, ahorrado: m.ahorrado, fechaMeta: m.fecha, hoy };
      const antes = planMeta({ ...entrada, capacidadMensual: r.ahorroMensualAntes });
      const despues = planMeta({ ...entrada, capacidadMensual: r.ahorroMensualDespues });
      return { m, antes, despues };
    })
    .filter((x) => x.antes.estado !== 'lograda' && x.antes.estado !== 'vencida');

  return (
    <section className="card sim-result" aria-live="polite" aria-label="Resultado de la simulación">
      <div className={`sim-verdict status-${v.tono}`}>
        <v.Icon size={22} aria-hidden="true" />
        <strong>{v.label}</strong>
      </div>
      <dl className="sim-numbers">
        <div>
          <dt>{r.pagoInicial >= 0 ? 'Pagas de una' : 'Te entra de una'}</dt>
          <dd className="amount">{fmtCOP(Math.abs(r.pagoInicial))}</dd>
        </div>
        {r.cuotaMensual > 0 && (
          <div>
            <dt>Cuota mensual</dt>
            <dd className="amount">{fmtCOP(r.cuotaMensual)}</dd>
          </div>
        )}
        <div>
          <dt>Tu bolsillo cada mes</dt>
          <dd className={`amount ${r.cambioMensual > 0 ? 'pos' : r.cambioMensual < 0 ? 'neg' : ''}`}>{conSigno(r.cambioMensual)}</dd>
        </div>
        <div>
          <dt>Te sobraría al mes</dt>
          <dd className={`amount${r.ahorroMensualDespues < 0 ? ' neg' : ''}`}>{fmtCOP(r.ahorroMensualDespues)}</dd>
          <small className="amount">hoy {fmtCOP(r.ahorroMensualAntes)}</small>
        </div>
        <div>
          <dt>Colchón</dt>
          <dd>{r.mesesColchon.toLocaleString('es-CO', { maximumFractionDigits: 1 })} meses</dd>
          <small>de gastos cubiertos</small>
        </div>
        {r.totalIntereses > 0 && (
          <div>
            <dt>Intereses en total</dt>
            <dd className="amount">{fmtCOP(r.totalIntereses)}</dd>
          </div>
        )}
      </dl>
      {r.razones.length > 0 && (
        <ul className="sim-reasons">
          {r.razones.map((razon) => (
            <li key={razon}>{razon}</li>
          ))}
        </ul>
      )}
      {impactos.length > 0 && (
        <div className="sim-impact">
          <h3>Tus metas</h3>
          <ul>
            {impactos.map(({ m, antes, despues }) => (
              <li key={m.id}>
                <Target size={16} aria-hidden="true" />
                <span>
                  <strong>{m.nombre}:</strong>{' '}
                  {despues.fechaProyectada
                    ? `llegarías el ${shortDay(despues.fechaProyectada)}${
                        antes.fechaProyectada && antes.fechaProyectada !== despues.fechaProyectada ? ` (sin esto: ${shortDay(antes.fechaProyectada)})` : ''
                      }`
                    : 'a ese ritmo no te sobraría plata para avanzar'}
                  {despues.estado !== antes.estado && ` · ${ESTADOS[despues.estado].label.toLowerCase()}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CompareTable({ base, escenarios }: { base: Base; escenarios: Escenario[] }) {
  const colchonHoy = base.gastoMensual > 0 ? base.disponible / base.gastoMensual : 0;
  const cols = escenarios.map((e) => ({ e, r: simularEscenario(e.escenario, base) }));
  const meses = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
  return (
    <div className="card compare-card table-scroll">
      <table className="data-table compare-table">
        <caption className="sr-only">Comparación de escenarios</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">Hoy</th>
            {cols.map(({ e }) => {
              const t = TIPOS.find((x) => x.id === e.escenario.tipo)!;
              return (
                <th scope="col" key={e.id} title={e.nombre}>
                  <span className="sr-only">{e.nombre}</span>
                  <span aria-hidden="true">
                    {t.corto}
                    <small className="amount">{corto(cifraClave(e.escenario))}</small>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Pago de una</th>
            <td className="amount">—</td>
            {cols.map(({ e, r }) => (
              <td className="amount" key={e.id}>
                {r.pagoInicial < 0 ? `+${corto(-r.pagoInicial)}` : r.pagoInicial ? corto(r.pagoInicial) : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Cuota</th>
            <td className="amount">—</td>
            {cols.map(({ e, r }) => (
              <td className="amount" key={e.id}>
                {r.cuotaMensual ? corto(r.cuotaMensual) : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Cambio por mes</th>
            <td className="amount">—</td>
            {cols.map(({ e, r }) => (
              <td className={`amount ${r.cambioMensual > 0 ? 'pos' : r.cambioMensual < 0 ? 'neg' : ''}`} key={e.id}>
                {r.cambioMensual ? cortoConSigno(r.cambioMensual) : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Te sobra por mes</th>
            <td className="amount">{corto(base.ingresoMensual - base.gastoMensual)}</td>
            {cols.map(({ e, r }) => (
              <td className="amount" key={e.id}>
                {corto(r.ahorroMensualDespues)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Colchón (meses)</th>
            <td>{meses(colchonHoy)}</td>
            {cols.map(({ e, r }) => (
              <td key={e.id}>{meses(r.mesesColchon)}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Intereses</th>
            <td className="amount">—</td>
            {cols.map(({ e, r }) => (
              <td className="amount" key={e.id}>
                {r.totalIntereses ? corto(r.totalIntereses) : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Veredicto</th>
            <td>—</td>
            {cols.map(({ e, r }) => {
              const v = VEREDICTOS[r.veredicto];
              return (
                <td key={e.id}>
                  <EstadoTexto tono={v.tono} Icon={v.Icon}>
                    {v.corto}
                  </EstadoTexto>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
