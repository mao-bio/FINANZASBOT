// Matemática de metas de ahorro. Sin IA: cálculos exactos que comparten la
// app y el Worker (para que Aura hable con las mismas cifras).

import type { TotalMes } from './types';

const DAY_MS = 86_400_000;
const DIAS_MES = 30.4375;

/** Días enteros entre dos fechas 'YYYY-MM-DD' (negativo si `hasta` ya pasó). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DAY_MS);
}

export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DAY_MS).toISOString().slice(0, 10);
}

export function sumarMeses(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const objetivo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth() + 1, 0)).getUTCDate();
  objetivo.setUTCDate(Math.min(d, ultimoDia));
  return objetivo.toISOString().slice(0, 10);
}

/** Redondea hacia arriba a los 100 pesos más cercanos (cifras amables). */
function arriba100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

/**
 * Cuánto ahorras normalmente al mes: promedio de (ingresos − gastos) de los
 * últimos 3 meses cerrados con movimientos. Si no hay historia, usa el mes actual.
 */
export function capacidadAhorro(historico: TotalMes[], mesActual: string): { capacidad: number; gastoMensual: number; ingresoMensual: number } {
  const cerrados = historico.filter((h) => h.mes < mesActual && (h.ingresos > 0 || h.gastos > 0)).slice(-3);
  const base = cerrados.length ? cerrados : historico.filter((h) => h.mes === mesActual);
  if (!base.length) return { capacidad: 0, gastoMensual: 0, ingresoMensual: 0 };
  const ingresoMensual = base.reduce((s, h) => s + h.ingresos, 0) / base.length;
  const gastoMensual = base.reduce((s, h) => s + h.gastos, 0) / base.length;
  return { capacidad: Math.round(ingresoMensual - gastoMensual), gastoMensual: Math.round(gastoMensual), ingresoMensual: Math.round(ingresoMensual) };
}

export type EstadoMeta = 'lograda' | 'a-tiempo' | 'ajustado' | 'dificil' | 'vencida' | 'sin-capacidad';

export interface PlanMeta {
  falta: number;
  /** 0 a 1 */
  progreso: number;
  diasRestantes: number;
  porDia: number;
  porSemana: number;
  porMes: number;
  estado: EstadoMeta;
  /** Fecha en que llegarías ahorrando tu capacidad mensual, o null si no ahorras */
  fechaProyectada: string | null;
}

export interface EntradaMeta {
  meta: number;
  ahorrado: number;
  fechaMeta: string;
  hoy: string;
  capacidadMensual: number;
}

export function planMeta({ meta, ahorrado, fechaMeta, hoy, capacidadMensual }: EntradaMeta): PlanMeta {
  const falta = Math.max(0, Math.round(meta - ahorrado));
  const progreso = meta > 0 ? Math.min(1, Math.max(0, ahorrado / meta)) : 0;
  const diasRestantes = Math.max(0, diasEntre(hoy, fechaMeta));
  const fechaProyectada = falta === 0 ? hoy : capacidadMensual > 0 ? sumarDias(hoy, Math.ceil((falta / capacidadMensual) * DIAS_MES)) : null;

  if (falta === 0) {
    return { falta, progreso: 1, diasRestantes, porDia: 0, porSemana: 0, porMes: 0, estado: 'lograda', fechaProyectada };
  }
  if (diasRestantes === 0) {
    return { falta, progreso, diasRestantes, porDia: falta, porSemana: falta, porMes: falta, estado: 'vencida', fechaProyectada };
  }
  const porDia = arriba100(falta / diasRestantes);
  const porSemana = Math.min(falta, arriba100(falta / (diasRestantes / 7)));
  const porMes = Math.min(falta, arriba100(falta / (diasRestantes / DIAS_MES)));

  let estado: EstadoMeta;
  if (capacidadMensual <= 0) estado = 'sin-capacidad';
  else if (porMes <= capacidadMensual * 0.8) estado = 'a-tiempo';
  else if (porMes <= capacidadMensual) estado = 'ajustado';
  else estado = 'dificil';

  return { falta, progreso, diasRestantes, porDia, porSemana, porMes, estado, fechaProyectada };
}

export interface AjustesMeta {
  /** Cuánto suben tus gastos mensuales, en % (puede ser negativo si bajan) */
  aumentoGastosPct: number;
  /** Ahorro adicional que te comprometes a hacer cada mes */
  ahorroExtraMensual: number;
  /** Meses que mueves la fecha (positivo = más tarde) */
  mesesExtra: number;
}

/** Recalcula el plan con un escenario: gastos que suben, ahorro extra o fecha distinta. */
export function simularMeta(
  entrada: EntradaMeta & { gastoMensual: number },
  ajustes: AjustesMeta,
): PlanMeta & { capacidadMensual: number; fechaMeta: string } {
  const capacidadMensual = Math.round(
    entrada.capacidadMensual - (entrada.gastoMensual * ajustes.aumentoGastosPct) / 100 + ajustes.ahorroExtraMensual,
  );
  const fechaMeta = ajustes.mesesExtra ? sumarMeses(entrada.fechaMeta, ajustes.mesesExtra) : entrada.fechaMeta;
  return { ...planMeta({ ...entrada, capacidadMensual, fechaMeta }), capacidadMensual, fechaMeta };
}
