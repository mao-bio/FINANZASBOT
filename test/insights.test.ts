import { describe, expect, it } from 'vitest';
import { computeInsights, type TxLite } from '../worker/insights';

// "Hoy" es 20 de octubre de 2026 a mediodía en Bogotá
const now = new Date('2026-10-20T17:00:00Z');
const at = (day: string, hour = 17) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const gasto = (date: string, amount: number, category: string, description: string): TxLite => ({ type: 'gasto', amount, category, description, date: at(date) });
const ingreso = (date: string, amount: number): TxLite => ({ type: 'ingreso', amount, category: 'Salario', description: 'Sueldo', date: at(date) });

function dataset(): TxLite[] {
  const txs: TxLite[] = [];
  for (const mes of ['07', '08', '09']) {
    txs.push(ingreso(`2026-${mes}-01`, 4_000_000));
    txs.push(gasto(`2026-${mes}-05`, 1_200_000, 'Hogar - Arriendo', 'Arriendo'));
    txs.push(gasto(`2026-${mes}-10`, 300_000, 'Comida - Mercado', 'Mercado'));
    txs.push(gasto(`2026-${mes}-12`, 150_000, 'Entretenimiento - Salidas', 'Cine'));
    txs.push(gasto(`2026-${mes}-15`, 120_000, 'Transporte - Apps de movilidad', 'Uber'));
    txs.push(gasto(`2026-${mes}-24`, 45_000, 'Suscripciones - Streaming', 'Netflix'));
  }
  txs.push(ingreso('2026-10-01', 4_000_000));
  txs.push(gasto('2026-10-05', 1_200_000, 'Hogar - Arriendo', 'Arriendo'));
  // Este mes la comida va mucho más alta que lo normal a esta altura
  txs.push(gasto('2026-10-08', 380_000, 'Comida - Mercado', 'Mercado'));
  txs.push(gasto('2026-10-12', 150_000, 'Comida - Domicilios', 'Rappi'));
  // Gasto inusual: un Uber de 500 mil (lo normal son 120 mil)
  txs.push(gasto('2026-10-14', 500_000, 'Transporte - Apps de movilidad', 'Uber aeropuerto'));
  // Gastos hormiga: cafecitos
  for (const d of ['2026-09-25', '2026-10-01', '2026-10-06', '2026-10-13', '2026-10-17']) {
    txs.push(gasto(d, 9_000, 'Comida - Café y snacks', 'Tinto y pan'));
  }
  // Buses: pequeños y frecuentes pero necesarios (no son hormiga)
  for (const d of ['2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07', '2026-10-08']) {
    txs.push(gasto(d, 3_000, 'Transporte - Público', 'Bus'));
  }
  // Gimnasio cobrado cada mes
  for (const d of ['2026-08-19', '2026-09-19', '2026-10-19']) txs.push(gasto(d, 89_000, 'Salud - Gimnasio', 'Smart Fit'));
  return txs.sort((a, b) => a.date.localeCompare(b.date));
}

const historico = [
  { mes: '2026-05', ingresos: 0, gastos: 0 },
  { mes: '2026-06', ingresos: 0, gastos: 0 },
  { mes: '2026-07', ingresos: 4_000_000, gastos: 1_815_000 },
  { mes: '2026-08', ingresos: 4_000_000, gastos: 1_904_000 },
  { mes: '2026-09', ingresos: 4_000_000, gastos: 1_913_000 },
  { mes: '2026-10', ingresos: 4_000_000, gastos: 2_400_000 },
];
const summary = {
  historico,
  totales: { tienes: 6_000_000, debes: 0, neto: 6_000_000 },
  mes: { mes: '2026-10', ingresos: 4_000_000, gastos: 2_400_000, porCategoria: [], presupuestos: [{ categoria: 'Comida', monto: 400_000, gastado: 0 }] },
};

describe('hallazgos', () => {
  const h = computeInsights(dataset(), summary, now);

  it('arma la base para metas y simulaciones', () => {
    expect(h.base).toMatchObject({
      ingresoMensual: 4_000_000,
      gastoMensual: 1_877_333,
      capacidadMensual: 2_122_667,
      disponible: 6_000_000,
      arriendoMensual: 1_200_000,
      salarioMensual: 4_000_000,
    });
    expect(h.base.transporteMensual).toBe(120_000);
  });

  it('encuentra gastos hormiga pero no los buses', () => {
    expect(h.hormiga).toEqual([
      { nombre: 'Tinto y pan', categoria: 'Comida - Café y snacks', veces: 5, total: 45_000, anual: 547_500 },
    ]);
  });

  it('detecta suscripciones y cobros mensuales', () => {
    const nombres = h.recurrentes.map((r) => [r.nombre, r.monto, r.suscripcion]);
    expect(nombres).toContainEqual(['Netflix', 45_000, true]);
    expect(nombres).toContainEqual(['Smart Fit', 89_000, false]);
    expect(nombres).toContainEqual(['Arriendo', 1_200_000, false]);
    expect(nombres.find((n) => n[0] === 'Mercado')).toBeUndefined();
  });

  it('compara con lo habitual a esta altura del mes', () => {
    // A 20 de octubre: Transporte 515 mil vs 120 mil y Comida 566 mil (con los cafés) vs 300 mil
    expect(h.porEncima[0]).toEqual({ grupo: 'Transporte', actual: 515_000, habitual: 120_000, diferencia: 395_000, pct: 329 });
    expect(h.porEncima[1]).toEqual({ grupo: 'Comida', actual: 566_000, habitual: 300_000, diferencia: 266_000, pct: 89 });
    expect(h.porEncima.find((p) => p.grupo === 'Hogar')).toBeUndefined();
  });

  it('marca gastos inusuales', () => {
    expect(h.inusuales).toEqual([
      { descripcion: 'Uber aeropuerto', categoria: 'Transporte - Apps de movilidad', monto: 500_000, fecha: '2026-10-14', normal: 120_000, veces: 4.2 },
    ]);
  });

  it('sugiere límites con base en los meses cerrados', () => {
    const comida = h.limites.find((l) => l.grupo === 'Comida');
    expect(comida).toEqual({ grupo: 'Comida', promedio: 303_000, sugerido: 270_000, actual: 400_000 });
    expect(h.limites.find((l) => l.grupo === 'Hogar')?.sugerido).toBe(1_160_000);
    expect(h.limites.find((l) => l.grupo === 'Deudas')).toBeUndefined();
  });

  it('agrupa los meses para comparar', () => {
    const sep = h.meses.find((m) => m.mes === '2026-09')!;
    expect(sep.porGrupo).toMatchObject({ Hogar: 1_200_000, Comida: 309_000, Entretenimiento: 150_000 });
  });

  it('no inventa nada sin datos', () => {
    const vacio = computeInsights([], { ...summary, historico: [] }, now);
    expect(vacio).toMatchObject({ hormiga: [], recurrentes: [], porEncima: [], inusuales: [], limites: [] });
    expect(vacio.base.capacidadMensual).toBe(0);
  });
});
