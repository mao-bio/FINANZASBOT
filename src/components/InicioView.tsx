import { ArrowDownLeft, ArrowUpRight, Plus, Sparkles, Star } from 'lucide-react';
import type { Cuenta, Movimiento, Resumen } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { KIND_ICONS, KIND_SHORT, greeting, monthName } from '../lib/labels';
import { IconTile } from '../lib/visuals';
import AnimatedCurrency from './AnimatedCurrency';
import { TxRow } from './TxRow';

/** Una frase útil calculada en el celular (no gasta cuota de IA). */
function insight(s: Resumen): string {
  const budgets = s.mes.presupuestos
    .map((p) => ({ ...p, pct: p.monto > 0 ? p.gastado / p.monto : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const top = budgets[0];
  if (top && top.pct > 1) {
    return `Te pasaste ${fmtCOP(top.gastado - top.monto)} en ${top.categoria} este mes. ¿Miramos juntos cómo cuadrar el resto del mes?`;
  }
  if (top && top.pct >= 0.8) {
    return `Ya usaste el ${Math.round(top.pct * 100)}% de tu presupuesto de ${top.categoria}. Te quedan ${fmtCOP(top.monto - top.gastado)}.`;
  }
  if (s.mes.gastos > 0) {
    const mayor = s.mes.porCategoria[0];
    return `Este mes llevas ${fmtCOP(s.mes.gastos)} en gastos. Lo que más pesa es ${mayor.grupo}, con ${fmtCOP(mayor.monto)}.`;
  }
  if (s.cuentas.every((c) => c.saldo === 0)) {
    return 'Empecemos: cuéntame cuánta plata tienes en tus cuentas, por ejemplo "tengo 300 mil en Nequi".';
  }
  return 'Todavía no tienes gastos este mes. Cuando gastes algo, cuéntamelo y yo lo anoto.';
}

export function AccountCard({ c, onClick }: { c: Cuenta; onClick: () => void }) {
  const Icon = KIND_ICONS[c.tipo];
  const debe = c.tipo === 'credito' && c.saldo < 0;
  return (
    <button className={`acct-card kind-${c.tipo}`} onClick={onClick} aria-label={`${c.nombre}: ${debe ? 'debes' : 'saldo'} ${fmtCOP(Math.abs(c.saldo))}`}>
      <span className="acct-card-top">
        <span className="acct-card-name">{c.nombre}</span>
        <Icon size={22} aria-hidden="true" />
      </span>
      <span className="acct-card-label">{debe ? 'Debes' : 'Saldo'}</span>
      <span className="acct-card-amount amount">{fmtCOP(debe ? -c.saldo : c.saldo)}</span>
      <span className="acct-card-foot">
        {KIND_SHORT[c.tipo]}
        {c.principal && (
          <>
            · <Star size={11} fill="currentColor" aria-hidden="true" /> Principal
          </>
        )}
      </span>
    </button>
  );
}

export default function InicioView(props: {
  user: string;
  summary: Resumen;
  recent: Movimiento[];
  onOpenProfile: () => void;
  onOpenAccount: (c: Cuenta | 'new') => void;
  onOpenTx: (m: Movimiento) => void;
  onAskAura: (prompt?: string) => void;
  onGo: (tab: 'resumen' | 'historial') => void;
}) {
  const { user, summary, recent } = props;
  const { totales, mes } = summary;

  return (
    <div className="screen">
      <header className="home-header">
        <div>
          <p className="greeting">{greeting()}</p>
          <h1>{user}</h1>
        </div>
        <button className="avatar" onClick={props.onOpenProfile} aria-label="Tu perfil y opciones">
          {user.charAt(0).toUpperCase()}
        </button>
      </header>

      <section className="balance-hero" aria-label="Tu plata">
        <span className="label">Tienes disponible</span>
        <AnimatedCurrency value={totales.tienes} className="big amount" />
        <div className="sub">
          {totales.debes > 0 && (
            <span>
              Debes <strong className="debt amount">{fmtCOP(totales.debes)}</strong> en tarjetas
            </span>
          )}
          <span>
            Tu plata real <strong className="amount">{fmtCOP(totales.neto)}</strong>
          </span>
        </div>
      </section>

      <div className="card-carousel" role="list" aria-label="Tus cuentas">
        {summary.cuentas.map((c) => (
          <div role="listitem" key={c.id} style={{ display: 'contents' }}>
            <AccountCard c={c} onClick={() => props.onOpenAccount(c)} />
          </div>
        ))}
        <button className="acct-card add" onClick={() => props.onOpenAccount('new')}>
          <Plus size={22} aria-hidden="true" /> Agregar cuenta
        </button>
      </div>

      <section className="section" aria-label={`Resumen de ${monthName(mes.mes)}`}>
        <div className="section-head">
          <h2>{monthName(mes.mes).split(' de ')[0]}</h2>
          <button className="link-btn" onClick={() => props.onGo('resumen')}>
            Ver resumen
          </button>
        </div>
        <div className="month-tiles">
          <div className="stat-tile">
            <span className="stat-tile-head">
              <IconTile visual={{ Icon: ArrowUpRight, color: 'var(--expense)' }} size="sm" />
              <span className="stat-tile-label">Gastaste</span>
            </span>
            <span className="stat-tile-value amount">{fmtCOP(mes.gastos)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-head">
              <IconTile visual={{ Icon: ArrowDownLeft, color: 'var(--income)' }} size="sm" />
              <span className="stat-tile-label">Te entró</span>
            </span>
            <span className="stat-tile-value amount">{fmtCOP(mes.ingresos)}</span>
          </div>
        </div>
      </section>

      <section className="aura-insight" aria-label="Consejo de Aura">
        <div className="aura-insight-head">
          <span className="orb-mini" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          Aura dice
        </div>
        <p>{insight(summary)}</p>
        <button className="btn" onClick={() => props.onAskAura('¿Cómo voy este mes?')}>
          Hablar con Aura
        </button>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Movimientos recientes</h2>
          {recent.length > 0 && (
            <button className="link-btn" onClick={() => props.onGo('historial')}>
              Ver todo
            </button>
          )}
        </div>
        <div className="card flush">
          {recent.length === 0 ? (
            <p className="empty">Aún no hay movimientos. Toca el botón de Aura y cuéntale tu primer gasto.</p>
          ) : (
            <div className="tx-list">
              {recent.slice(0, 5).map((m) => (
                <TxRow key={m.id} m={m} when="date" onClick={() => props.onOpenTx(m)} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
