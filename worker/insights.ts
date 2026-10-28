// Hallazgos sobre tus gastos: gastos hormiga, cobros recurrentes, categorías
// por encima de lo habitual, gastos inusuales y límites sugeridos.
// Todo se calcula con reglas claras sobre tus movimientos (sin IA).

import type { Hallazgos, Resumen } from '../shared/types';
import { capacidadAhorro } from '../shared/plan';
import { groupOf, norm } from './categories';
import { bogotaDay, bogotaMonth, monthRange, shiftMonth } from './dates';

export interface TxLite {
  type: 'ingreso' | 'gasto';
  amount: number;
  category: string;
  description: string;
  /** ISO UTC */
  date: string;
}

const DAY_MS = 86_400_000;
/** Un gasto hormiga es pequeño: hasta $ 25.000 */
const HORMIGA_MAX = 25_000;
/** Gastos necesarios que no cuentan como hormiga aunque sean pequeños y frecuentes */
const NO_HORMIGA = new Set(['Hogar', 'Salud', 'Educación', 'Deudas', 'Impuestos', 'Donaciones']);
const NO_HORMIGA_CATEGORIAS = new Set(['Transporte - Público']);
/** Compras variables: aunque se repitan, no son cobros fijos */
const NO_FIJOS = new Set(['Comida', 'Compras', 'Entretenimiento', 'Regalos']);

/** Cuánto se puede recortar cada grupo de forma realista (1 = no se sugiere límite). */
const RECORTE: Record<string, number> = {
  Hogar: 0.97,
  Comida: 0.9,
  Transporte: 0.9,
  Suscripciones: 0.85,
  Salud: 0.95,
  Compras: 0.8,
  'Cuidado personal': 0.85,
  Mascotas: 0.95,
  Entretenimiento: 0.8,
  Regalos: 0.85,
  'Otros gastos': 0.85,
};

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function dayOfMonth(iso: string): number {
  return Number(bogotaDay(new Date(iso)).slice(8, 10));
}

function monthOf(iso: string): string {
  return bogotaMonth(new Date(iso));
}

export function computeInsights(
  txs: TxLite[],
  summary: Pick<Resumen, 'historico' | 'totales' | 'mes'>,
  now = new Date(),
): Hallazgos {
  const mesActual = bogotaMonth(now);
  const hoyDia = Number(bogotaDay(now).slice(8, 10));
  const gastos = txs.filter((t) => t.type === 'gasto');
  const mesesConDatos = new Set(txs.map((t) => monthOf(t.date)));
  const cerrados = [1, 2, 3].map((i) => shiftMonth(mesActual, -i)).filter((m) => mesesConDatos.has(m));

  // ─ Base para metas y simulaciones ─
  const { capacidad, gastoMensual, ingresoMensual } = capacidadAhorro(summary.historico, mesActual);
  const promedioCerrados = (filtro: (t: TxLite) => boolean) =>
    cerrados.length
      ? Math.round(txs.filter((t) => filtro(t) && cerrados.includes(monthOf(t.date))).reduce((s, t) => s + t.amount, 0) / cerrados.length)
      : 0;
  const base = {
    ingresoMensual,
    gastoMensual,
    capacidadMensual: capacidad,
    disponible: Math.max(0, summary.totales.tienes),
    transporteMensual: promedioCerrados((t) => t.type === 'gasto' && groupOf(t.category) === 'Transporte'),
    arriendoMensual: promedioCerrados((t) => t.type === 'gasto' && t.category === 'Hogar - Arriendo'),
    salarioMensual: promedioCerrados((t) => t.type === 'ingreso' && t.category === 'Salario'),
  };

  // ─ Gastos hormiga (últimos 30 días) ─
  const hace30 = now.getTime() - 30 * DAY_MS;
  const pequenos = gastos.filter(
    (t) =>
      Date.parse(t.date) >= hace30 &&
      t.amount <= HORMIGA_MAX &&
      !NO_HORMIGA.has(groupOf(t.category)) &&
      !NO_HORMIGA_CATEGORIAS.has(t.category),
  );
  const porCategoria = new Map<string, TxLite[]>();
  for (const t of pequenos) porCategoria.set(t.category, [...(porCategoria.get(t.category) ?? []), t]);
  const hormiga = [...porCategoria.entries()]
    .map(([categoria, items]) => {
      const total = items.reduce((s, t) => s + t.amount, 0);
      return {
        nombre: mostCommon(items.map((t) => t.description || categoria.split(' - ').pop()!)),
        categoria,
        veces: items.length,
        total,
        anual: Math.round((total / 30) * 365),
      };
    })
    .filter((h) => h.veces >= 4 || (h.veces >= 3 && h.total >= 30_000))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ─ Cobros recurrentes y suscripciones ─
  const porNombre = new Map<string, TxLite[]>();
  for (const t of gastos) {
    const key = norm(t.description) || norm(t.category);
    porNombre.set(key, [...(porNombre.get(key) ?? []), t]);
  }
  const recurrentes: Hallazgos['recurrentes'] = [];
  for (const items of porNombre.values()) {
    const ordenados = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const ultimo = ordenados[ordenados.length - 1];
    const monto = median(ordenados.map((t) => t.amount));
    const parecidos = ordenados.filter((t) => Math.abs(t.amount - monto) <= monto * 0.15);
    const meses = new Set(parecidos.map((t) => monthOf(t.date))).size;
    const suscripcion = groupOf(ultimo.category) === 'Suscripciones';
    if (!suscripcion && NO_FIJOS.has(groupOf(ultimo.category))) continue;
    // Mensual: un cobro por mes, separados entre 20 y 40 días en promedio
    const gaps = parecidos.slice(1).map((t, i) => (Date.parse(t.date) - Date.parse(parecidos[i].date)) / DAY_MS);
    const gapPromedio = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    const mensual = gapPromedio >= 20 && gapPromedio <= 40;
    // Sigue vigente si el último cobro parecido fue hace menos de 45 días
    if (!parecidos.length || now.getTime() - Date.parse(parecidos[parecidos.length - 1].date) > 45 * DAY_MS) continue;
    if ((suscripcion && meses >= 1) || (meses >= 2 && mensual && parecidos.length === meses)) {
      recurrentes.push({
        nombre: ultimo.description || ultimo.category.split(' - ').pop()!,
        categoria: ultimo.category,
        monto: Math.round(monto),
        meses,
        ultimo: bogotaDay(new Date(ultimo.date)),
        anual: Math.round(monto * 12),
        suscripcion,
      });
    }
  }
  recurrentes.sort((a, b) => Number(b.suscripcion) - Number(a.suscripcion) || b.monto - a.monto);

  // ─ Categorías por encima de lo habitual (a esta misma altura del mes) ─
  const hastaHoy = (mes: string) => {
    const porGrupo = new Map<string, number>();
    for (const t of gastos) {
      if (monthOf(t.date) === mes && dayOfMonth(t.date) <= hoyDia) {
        const g = groupOf(t.category);
        porGrupo.set(g, (porGrupo.get(g) ?? 0) + t.amount);
      }
    }
    return porGrupo;
  };
  const porEncima: Hallazgos['porEncima'] = [];
  if (cerrados.length) {
    const actual = hastaHoy(mesActual);
    const anteriores = cerrados.map(hastaHoy);
    const grupos = new Set([...actual.keys(), ...anteriores.flatMap((m) => [...m.keys()])]);
    for (const grupo of grupos) {
      const a = actual.get(grupo) ?? 0;
      const habitual = Math.round(anteriores.reduce((s, m) => s + (m.get(grupo) ?? 0), 0) / anteriores.length);
      const diferencia = a - habitual;
      if (diferencia >= 50_000 && (habitual === 0 || a > habitual * 1.25)) {
        porEncima.push({ grupo, actual: a, habitual, diferencia, pct: habitual ? Math.round((diferencia / habitual) * 100) : null });
      }
    }
    porEncima.sort((x, y) => y.diferencia - x.diferencia);
  }

  // ─ Gastos inusuales (últimos 30 días) ─
  const inusuales: Hallazgos['inusuales'] = [];
  for (const t of gastos) {
    if (Date.parse(t.date) < hace30 || t.amount < 100_000) continue;
    const otros = gastos.filter((o) => o !== t && o.category === t.category).map((o) => o.amount);
    if (otros.length < 3) continue;
    const normal = median(otros);
    if (normal > 0 && t.amount >= normal * 3) {
      inusuales.push({
        descripcion: t.description || t.category,
        categoria: t.category,
        monto: t.amount,
        fecha: bogotaDay(new Date(t.date)),
        normal: Math.round(normal),
        veces: Math.round((t.amount / normal) * 10) / 10,
      });
    }
  }
  inusuales.sort((a, b) => b.monto - a.monto);

  // ─ Meses para comparar ─
  const meses = summary.historico.map((h) => {
    const porGrupo: Record<string, number> = {};
    for (const t of gastos) {
      if (monthOf(t.date) === h.mes) {
        const g = groupOf(t.category);
        porGrupo[g] = (porGrupo[g] ?? 0) + t.amount;
      }
    }
    return { mes: h.mes, ingresos: h.ingresos, gastos: h.gastos, porGrupo };
  });

  // ─ Límites sugeridos (con base en los meses cerrados) ─
  const limites: Hallazgos['limites'] = [];
  if (cerrados.length) {
    const grupos = new Set(meses.filter((m) => cerrados.includes(m.mes)).flatMap((m) => Object.keys(m.porGrupo)));
    for (const grupo of grupos) {
      const factor = RECORTE[grupo];
      if (!factor) continue;
      const promedio = Math.round(meses.filter((m) => cerrados.includes(m.mes)).reduce((s, m) => s + (m.porGrupo[grupo] ?? 0), 0) / cerrados.length);
      if (promedio < 50_000) continue;
      const sugerido = Math.floor((promedio * factor) / 10_000) * 10_000;
      const actual = summary.mes.presupuestos.find((p) => p.categoria === grupo)?.monto ?? null;
      limites.push({ grupo, promedio, sugerido, actual });
    }
    limites.sort((a, b) => b.promedio - a.promedio);
  }

  return { base, hormiga, recurrentes, porEncima, inusuales: inusuales.slice(0, 5), limites, meses };
}

export async function getInsights(db: D1Database, summary: Resumen, now = new Date()): Promise<Hallazgos> {
  const desde = monthRange(shiftMonth(bogotaMonth(now), -5)).start;
  const { results } = await db
    .prepare(`SELECT type, amount, category, description, date FROM transactions
              WHERE type IN ('ingreso', 'gasto') AND date >= ? ORDER BY date`)
    .bind(desde)
    .all<TxLite>();
  return computeInsights(
    results.map((r) => ({ ...r, amount: Number(r.amount) })),
    summary,
    now,
  );
}
