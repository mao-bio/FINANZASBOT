import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bug, CircleAlert, CircleCheck, Repeat, Target, TrendingUp, TriangleAlert, Zap } from 'lucide-react';
import type { Hallazgos, Resumen } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api } from '../lib/api';
import { dayLabel, monthName, shortCategory } from '../lib/labels';
import { IconTile, groupOf, groupVisual } from '../lib/visuals';
import ResumenView from './ResumenView';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Panel = 'resumen' | 'hallazgos' | 'comparar';

export default function AnalisisView(props: {
  summary: Resumen;
  insights: Hallazgos | null;
  onSummary: (s: Resumen) => void;
  onInsightsChanged: () => void;
  run: Run;
  initialPanel?: Panel;
}) {
  const { summary, insights } = props;
  const [panel, setPanel] = useState<Panel>(props.initialPanel ?? 'resumen');
  const avisos = summary.alertas.length + (insights ? insights.porEncima.length + insights.inusuales.length : 0);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Análisis</h1>
        <span className="pill">{monthName(summary.mes.mes)}</span>
      </header>

      <div className="seg seg-3" role="tablist" aria-label="Secciones de análisis">
        {(
          [
            ['resumen', 'Resumen'],
            ['hallazgos', 'Hallazgos'],
            ['comparar', 'Comparar'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={panel === id} aria-pressed={panel === id} onClick={() => setPanel(id)}>
            {label}
            {id === 'hallazgos' && avisos > 0 && <span className="count-dot">{avisos}</span>}
          </button>
        ))}
      </div>

      {panel === 'resumen' && <ResumenView summary={summary} onSummary={props.onSummary} run={props.run} />}
      {panel !== 'resumen' && !insights && <div className="skeleton" aria-label="Cargando…" />}
      {panel === 'hallazgos' && insights && (
        <HallazgosPanel
          summary={summary}
          insights={insights}
          onBudget={async (grupo, monto) => {
            const res = await props.run(() => api.setBudget(grupo, monto));
            if (res) {
              props.onSummary(res.summary);
              props.onInsightsChanged();
            }
          }}
        />
      )}
      {panel === 'comparar' && insights && <CompararPanel insights={insights} mesActual={summary.mes.mes} />}
    </div>
  );
}

// ─── Hallazgos ────────────────────────────────────────────────────────────────

function Section(props: { title: string; intro?: string; Icon: typeof Bug; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="with-icon">
          <props.Icon size={18} aria-hidden="true" /> {props.title}
        </h2>
      </div>
      {props.intro && <p className="section-intro">{props.intro}</p>}
      <div className="card flush">{props.children}</div>
    </section>
  );
}

function Row(props: { group: string; title: string; sub: string; right: ReactNode }) {
  return (
    <div className="tx-row">
      <IconTile visual={groupVisual(props.group)} />
      <span className="tx-main">
        <span className="tx-title">
          <span>{props.title}</span>
        </span>
        <span className="tx-sub wrap">{props.sub}</span>
      </span>
      <span className="row-right">{props.right}</span>
    </div>
  );
}

function HallazgosPanel(props: { summary: Resumen; insights: Hallazgos; onBudget: (grupo: string, monto: number) => Promise<void> }) {
  const { summary, insights: h } = props;
  const [aplicando, setAplicando] = useState<string | null>(null);
  const suscripciones = h.recurrentes.filter((r) => r.suscripcion);
  const fijos = h.recurrentes.filter((r) => !r.suscripcion);
  const ahorroLimites = Math.round(h.limites.reduce((s, l) => s + Math.max(0, l.promedio - l.sugerido), 0) / 1000) * 1000;
  const nada =
    !summary.alertas.length && !h.porEncima.length && !h.inusuales.length && !h.hormiga.length && !h.recurrentes.length && !h.limites.length;

  if (nada) {
    return (
      <div className="card">
        <p className="empty">
          Todavía no hay suficientes movimientos para encontrar patrones. Cuando lleves unas semanas registrando tus gastos, aquí verás
          gastos hormiga, suscripciones, aumentos raros y límites sugeridos.
        </p>
      </div>
    );
  }

  return (
    <>
      {summary.alertas.length > 0 && (
        <div className="alert-list" role="list" aria-label="Alertas de presupuesto">
          {summary.alertas.map((a) => (
            <div key={a.categoria} role="listitem" className={`alert-card status-${a.nivel}`}>
              {a.nivel === 'critical' ? <CircleAlert size={20} aria-hidden="true" /> : <TriangleAlert size={20} aria-hidden="true" />}
              <div>
                <strong>{a.titulo}</strong>
                <span>{a.mensaje}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {h.porEncima.length > 0 && (
        <Section title="Más de lo habitual" Icon={TrendingUp} intro="Comparado con lo que llevabas a esta misma altura en los meses anteriores.">
          {h.porEncima.map((p) => (
            <Row
              key={p.grupo}
              group={p.grupo}
              title={p.grupo}
              sub={`Llevas ${fmtCOP(p.actual)}; lo normal a esta fecha es ${fmtCOP(p.habitual)}`}
              right={
                <span className="delta bad">
                  <ArrowUp size={14} aria-hidden="true" />
                  {p.pct === null ? 'Nuevo' : `${p.pct}%`}
                </span>
              }
            />
          ))}
        </Section>
      )}

      {h.inusuales.length > 0 && (
        <Section title="Gastos inusuales" Icon={Zap} intro="Gastos mucho más grandes de lo normal en su categoría.">
          {h.inusuales.map((i) => (
            <Row
              key={`${i.descripcion}-${i.fecha}`}
              group={groupOf(i.categoria)}
              title={i.descripcion}
              sub={`${dayLabel(i.fecha)} · ${i.veces.toLocaleString('es-CO')} veces lo normal (${fmtCOP(i.normal)})`}
              right={<strong className="amount">{fmtCOP(i.monto)}</strong>}
            />
          ))}
        </Section>
      )}

      {h.hormiga.length > 0 && (
        <Section title="Gastos hormiga" Icon={Bug} intro="Pequeños y frecuentes en los últimos 30 días. Sumados pesan más de lo que parece.">
          {h.hormiga.map((g) => (
            <Row
              key={g.categoria}
              group={groupOf(g.categoria)}
              title={g.nombre}
              sub={`${g.veces} veces · ${shortCategory(g.categoria)} · al año serían ${fmtCOP(g.anual)}`}
              right={<strong className="amount">{fmtCOP(g.total)}</strong>}
            />
          ))}
        </Section>
      )}

      {suscripciones.length > 0 && (
        <Section
          title="Suscripciones"
          Icon={Repeat}
          intro={`¿Todavía las usas todas? Al año suman ${fmtCOP(suscripciones.reduce((s, r) => s + r.anual, 0))}.`}
        >
          {suscripciones.map((r) => (
            <Row
              key={r.nombre}
              group={groupOf(r.categoria)}
              title={r.nombre}
              sub={`Último cobro ${dayLabel(r.ultimo)} · ${fmtCOP(r.anual)} al año`}
              right={<strong className="amount">{fmtCOP(r.monto)}/mes</strong>}
            />
          ))}
        </Section>
      )}

      {fijos.length > 0 && (
        <Section title="Cobros fijos" Icon={Repeat} intro="Pagos que se repiten cada mes por un valor parecido.">
          {fijos.map((r) => (
            <Row
              key={r.nombre}
              group={groupOf(r.categoria)}
              title={r.nombre}
              sub={`${r.meses} meses seguidos · último ${dayLabel(r.ultimo)}`}
              right={<strong className="amount">{fmtCOP(r.monto)}/mes</strong>}
            />
          ))}
        </Section>
      )}

      {h.limites.length > 0 && (
        <Section
          title="Límites sugeridos"
          Icon={Target}
          intro={`Con base en lo que gastas normalmente.${ahorroLimites > 0 ? ` Si los cumples, ahorrarías cerca de ${fmtCOP(ahorroLimites)} al mes.` : ''}`}
        >
          {h.limites.map((l) => {
            const aplicado = l.actual === l.sugerido;
            return (
              <Row
                key={l.grupo}
                group={l.grupo}
                title={l.grupo}
                sub={`Tope sugerido ${fmtCOP(l.sugerido)} · gastas ${fmtCOP(l.promedio)} al mes${l.actual !== null && !aplicado ? ` · hoy tienes ${fmtCOP(l.actual)}` : ''}`}
                right={
                  aplicado ? (
                    <span className="delta good">
                      <CircleCheck size={14} aria-hidden="true" /> Activo
                    </span>
                  ) : (
                    <button
                      className="btn btn-soft btn-sm"
                      disabled={aplicando !== null}
                      onClick={async () => {
                        setAplicando(l.grupo);
                        await props.onBudget(l.grupo, l.sugerido);
                        setAplicando(null);
                      }}
                    >
                      {aplicando === l.grupo ? <span className="spinner" aria-label="Guardando" /> : 'Usar'}
                    </button>
                  )
                }
              />
            );
          })}
        </Section>
      )}
    </>
  );
}

// ─── Comparar meses ───────────────────────────────────────────────────────────

/** '2026-09' → "Sept 2026" (cabe en el selector a lo ancho de medio celular) */
function mesCorto(mes: string): string {
  return `${monthName(mes, { short: true }).replace('.', '')} ${mes.slice(0, 4)}`;
}

function CompararPanel({ insights, mesActual }: { insights: Hallazgos; mesActual: string }) {
  const conDatos = insights.meses.filter((m) => m.gastos > 0 || m.ingresos > 0);
  const opciones = conDatos.length ? conDatos : insights.meses;
  const [mesA, setMesA] = useState(opciones[opciones.length - 1]?.mes ?? mesActual);
  const [mesB, setMesB] = useState(opciones[opciones.length - 2]?.mes ?? opciones[0]?.mes ?? mesActual);
  const a = insights.meses.find((m) => m.mes === mesA);
  const b = insights.meses.find((m) => m.mes === mesB);

  const filas = useMemo(() => {
    if (!a || !b) return [];
    const grupos = new Set([...Object.keys(a.porGrupo), ...Object.keys(b.porGrupo)]);
    return [...grupos]
      .map((g) => ({ grupo: g, a: a.porGrupo[g] ?? 0, b: b.porGrupo[g] ?? 0 }))
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  }, [a, b]);
  const max = Math.max(1, ...filas.flatMap((f) => [f.a, f.b]));

  if (opciones.length < 2) {
    return (
      <div className="card">
        <p className="empty">Cuando tengas movimientos en al menos dos meses, aquí los podrás comparar lado a lado.</p>
      </div>
    );
  }

  // En gastos subir es malo; en ingresos, bueno.
  const diff = (x: number, y: number, subirEsBueno = false) => {
    const d = x - y;
    if (d === 0) return <span className="delta">Igual</span>;
    return (
      <span className={`delta ${d > 0 === subirEsBueno ? 'good' : 'bad'}`}>
        {d > 0 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
        {fmtCOP(Math.abs(d))}
      </span>
    );
  };

  return (
    <>
      <div className="compare-pickers">
        <label className="field">
          <span>
            <i className="legend-dot a" aria-hidden="true" /> Mes
          </span>
          <select className="select" value={mesA} onChange={(e) => setMesA(e.target.value)}>
            {opciones.map((m) => (
              <option key={m.mes} value={m.mes}>
                {mesCorto(m.mes)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            <i className="legend-dot b" aria-hidden="true" /> Contra
          </span>
          <select className="select" value={mesB} onChange={(e) => setMesB(e.target.value)}>
            {opciones.map((m) => (
              <option key={m.mes} value={m.mes}>
                {mesCorto(m.mes)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(mesA === mesActual || mesB === mesActual) && <p className="section-intro">El mes actual va contado hasta hoy.</p>}

      {a && b && (
        <div className="compare-totals">
          <div className="stat-tile">
            <span className="stat-tile-label">Gastaste</span>
            <span className="stat-tile-value amount">{fmtCOP(a.gastos)}</span>
            <span className="compare-vs">
              vs {fmtCOP(b.gastos)} {diff(a.gastos, b.gastos)}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-label">Te entró</span>
            <span className="stat-tile-value amount">{fmtCOP(a.ingresos)}</span>
            <span className="compare-vs">
              vs {fmtCOP(b.ingresos)} {diff(a.ingresos, b.ingresos, true)}
            </span>
          </div>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Por categoría</h2>
        </div>
        <div className="card">
          {filas.length === 0 ? (
            <p className="empty">No hay gastos en esos meses.</p>
          ) : (
            <ul className="compare-list">
              {filas.map((f) => (
                <li key={f.grupo}>
                  <div className="compare-head">
                    <IconTile visual={groupVisual(f.grupo)} size="sm" />
                    <strong>{f.grupo}</strong>
                    {diff(f.a, f.b)}
                  </div>
                  <div className="compare-bars">
                    <div className="compare-bar">
                      <span className="bar">
                        <span className="bar-fill a" style={{ display: 'block', width: `${(f.a / max) * 100}%` }} />
                      </span>
                      <span className="amount">{fmtCOP(f.a)}</span>
                    </div>
                    <div className="compare-bar">
                      <span className="bar">
                        <span className="bar-fill b" style={{ display: 'block', width: `${(f.b / max) * 100}%` }} />
                      </span>
                      <span className="amount">{fmtCOP(f.b)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
