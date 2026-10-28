// Qué notificaciones push se envían y cuándo.
//  • Al registrar un gasto: si llegas al 80% de un presupuesto o te pasas.
//  • Cada noche (Cron Trigger, 7:30 p. m. en Colombia), aunque la app esté cerrada:
//    presupuestos que van a ritmo de pasarse, cobros fijos de mañana, cuánto
//    apartar para tus metas (los domingos), metas cumplidas y, si lo activas,
//    un recordatorio para registrar los gastos del día.
// Cada aviso tiene una llave única para no repetirlo.

import type { Alerta, Hallazgos, Meta, Resumen } from '../shared/types';
import { fmtCOP } from '../shared/format';
import { planMeta, sumarDias } from '../shared/plan';
import type { Env } from './env';
import { budgetAlert, getSummary } from './finance';
import { getInsights } from './insights';
import { listGoals } from './goals';
import { bogotaDay, bogotaWeekday, monthRange } from './dates';
import { ensureSchema } from './schema';
import { getPreferences, hasSubscribers, sendOnce, type PushPayload } from './push';

export interface Aviso {
  /** Llave para no repetir, p. ej. 'presupuesto:Comida:2026-10:warning' */
  key: string;
  payload: PushPayload;
}

function diasDelMes(mes: string): number {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lista(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function alertaAviso(a: Alerta, mes: string): Aviso {
  return {
    key: `presupuesto:${a.categoria}:${mes}:${a.nivel}`,
    payload: { titulo: a.titulo, mensaje: a.mensaje, tag: `presupuesto-${a.categoria}`, url: '/?ir=hallazgos' },
  };
}

/** Topes al 80% o pasados, y los que a este ritmo se van a pasar antes de fin de mes. */
export function avisosPresupuesto(mes: Resumen['mes'], hoy: string): Aviso[] {
  const avisos: Aviso[] = [];
  const dia = Number(hoy.slice(8, 10));
  const totalDias = diasDelMes(mes.mes);
  const quedanDias = totalDias - dia;
  for (const p of mes.presupuestos) {
    const alerta = budgetAlert(p.categoria, p.monto, p.gastado);
    if (alerta) {
      avisos.push(alertaAviso(alerta, mes.mes));
      continue;
    }
    const proyectado = (p.gastado / dia) * totalDias;
    if (dia >= 7 && quedanDias >= 3 && p.gastado >= p.monto * 0.5 && proyectado > p.monto * 1.05) {
      const porDia = Math.floor((p.monto - p.gastado) / quedanDias / 100) * 100;
      avisos.push({
        key: `ritmo:${p.categoria}:${mes.mes}`,
        payload: {
          titulo: `A este ritmo te pasas en ${p.categoria}`,
          mensaje: `Llevas ${fmtCOP(p.gastado)} de ${fmtCOP(p.monto)} y vamos en el día ${dia}. Para no pasarte, gasta máximo ${fmtCOP(porDia)} al día.`,
          tag: `presupuesto-${p.categoria}`,
          url: '/?ir=hallazgos',
        },
      });
    }
  }
  return avisos;
}

/** Suscripciones y cobros fijos que normalmente caen mañana y todavía no se han cobrado este mes. */
export function avisoCobros(recurrentes: Hallazgos['recurrentes'], hoy: string): Aviso | null {
  const manana = sumarDias(hoy, 1);
  const mesManana = manana.slice(0, 7);
  const diaManana = Number(manana.slice(8, 10));
  const ultimoDia = diasDelMes(mesManana);
  const proximos = recurrentes.filter((r) => Math.min(Number(r.ultimo.slice(8, 10)), ultimoDia) === diaManana && r.ultimo.slice(0, 7) < mesManana);
  if (!proximos.length) return null;
  const detalle = lista(proximos.map((r) => `${r.nombre} (${fmtCOP(r.monto)})`));
  const total = proximos.reduce((s, r) => s + r.monto, 0);
  const haySuscripciones = proximos.some((r) => r.suscripcion);
  return {
    key: `cobros:${manana}`,
    payload: {
      titulo: proximos.length === 1 ? `Mañana te cobran ${proximos[0].nombre}` : `Mañana te cobran ${fmtCOP(total)}`,
      mensaje:
        proximos.length === 1
          ? `Son ${fmtCOP(proximos[0].monto)}. ${haySuscripciones ? '¿Todavía la usas?' : 'Ten la plata lista en la cuenta.'}`
          : `${detalle}. ${haySuscripciones ? '¿Todavía usas todas las suscripciones?' : 'Ten la plata lista en la cuenta.'}`,
      tag: 'cobros',
      url: '/?ir=hallazgos',
    },
  };
}

/** Metas cumplidas (cualquier día) y, los domingos, cuánto apartar esa semana. */
export function avisosMetas(metas: Meta[], capacidadMensual: number, hoy: string, esDomingo: boolean): Aviso[] {
  const avisos: Aviso[] = [];
  const planes = metas.map((m) => ({ m, plan: planMeta({ meta: m.monto, ahorrado: m.ahorrado, fechaMeta: m.fecha, hoy, capacidadMensual }) }));
  for (const { m, plan } of planes) {
    if (plan.estado === 'lograda') {
      avisos.push({
        key: `meta-lograda:${m.id}`,
        payload: { titulo: `¡Lo lograste! 🎉`, mensaje: `Ya tienes los ${fmtCOP(m.monto)} de tu meta "${m.nombre}".`, tag: `meta-${m.id}`, url: '/?ir=metas' },
      });
    }
  }
  const activas = planes.filter(({ plan }) => plan.estado !== 'lograda' && plan.estado !== 'vencida');
  if (esDomingo && activas.length) {
    const total = activas.reduce((s, { plan }) => s + plan.porSemana, 0);
    const [primera] = activas;
    avisos.push({
      key: `metas-semana:${hoy}`,
      payload:
        activas.length === 1
          ? {
              titulo: `Esta semana aparta ${fmtCOP(primera.plan.porSemana)}`,
              mensaje: `Para "${primera.m.nombre}" te faltan ${fmtCOP(primera.plan.falta)}. Con eso vas al día.`,
              tag: 'metas-semana',
              url: '/?ir=metas',
            }
          : {
              titulo: `Esta semana aparta ${fmtCOP(total)} para tus metas`,
              mensaje: lista(activas.slice(0, 4).map(({ m, plan }) => `${m.nombre}: ${fmtCOP(plan.porSemana)}`)) + '.',
              tag: 'metas-semana',
              url: '/?ir=metas',
            },
    });
  }
  return avisos;
}

export function avisoDiario(movimientosHoy: number, hoy: string): Aviso | null {
  if (movimientosHoy > 0) return null;
  return {
    key: `diario:${hoy}`,
    payload: {
      titulo: '¿Gastaste algo hoy?',
      mensaje: 'Cuéntaselo a Aura en un mensaje o una nota de voz y yo lo anoto.',
      tag: 'diario',
      url: '/?ir=aura',
    },
  };
}

/** Al registrar gastos: avisa de una las alertas de presupuesto que se acaban de prender. */
export async function notifyBudgetAlerts(db: D1Database, alertas: Alerta[], now = new Date()): Promise<void> {
  if (!alertas.length || !(await hasSubscribers(db))) return;
  if (!(await getPreferences(db)).presupuesto) return;
  const mes = bogotaDay(now).slice(0, 7);
  for (const a of alertas) {
    const { key, payload } = alertaAviso(a, mes);
    await sendOnce(db, key, payload, now);
  }
}

/** La revisión de cada noche. Devuelve las llaves de los avisos que sí se enviaron. */
export async function runDailyNotifications(env: Env, now = new Date()): Promise<string[]> {
  const db = env.DB;
  await ensureSchema(db);
  if (!(await hasSubscribers(db))) return [];

  const prefs = await getPreferences(db);
  const hoy = bogotaDay(now);
  const summary = await getSummary(db, now);
  const avisos: Aviso[] = [];

  if (prefs.presupuesto) avisos.push(...avisosPresupuesto(summary.mes, hoy));
  if (prefs.cobros || prefs.metas) {
    const hallazgos = await getInsights(db, summary, now);
    if (prefs.cobros) {
      const cobros = avisoCobros(hallazgos.recurrentes, hoy);
      if (cobros) avisos.push(cobros);
    }
    if (prefs.metas) avisos.push(...avisosMetas(await listGoals(db), hallazgos.base.capacidadMensual, hoy, bogotaWeekday(now) === 'domingo'));
  }
  if (prefs.diario) {
    // Cuenta lo que registraste hoy (aunque sea un gasto de otro día).
    const inicio = new Date(Date.parse(monthRange(hoy.slice(0, 7)).start) + (Number(hoy.slice(8, 10)) - 1) * 86_400_000).toISOString();
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE created_at >= ?`).bind(inicio).first<{ n: number }>();
    const diario = avisoDiario(Number(row?.n ?? 0), hoy);
    if (diario) avisos.push(diario);
  }

  const enviados: string[] = [];
  for (const aviso of avisos) {
    if (await sendOnce(db, aviso.key, aviso.payload, now)) enviados.push(aviso.key);
  }
  // Limpieza: el registro de avisos enviados solo necesita unos meses (las metas cumplidas se recuerdan siempre).
  await db
    .prepare(`DELETE FROM push_log WHERE sent_at < ? AND key NOT LIKE 'meta-lograda:%'`)
    .bind(new Date(now.getTime() - 180 * 86_400_000).toISOString())
    .run();
  return enviados;
}
