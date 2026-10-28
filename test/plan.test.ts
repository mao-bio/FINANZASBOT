import { describe, expect, it } from 'vitest';
import { capacidadAhorro, diasEntre, planMeta, simularMeta, sumarMeses } from '../shared/plan';
import { cuotaCredito, simularEscenario, tasaMensualDesdeEA, type Base } from '../shared/simulador';

describe('metas de ahorro', () => {
  const hoy = '2026-10-28';

  it('calcula cuánto ahorrar por día, semana y mes', () => {
    // 100 días para juntar $ 3.000.000 de los $ 5.000.000
    const plan = planMeta({ meta: 5_000_000, ahorrado: 2_000_000, fechaMeta: '2027-02-05', hoy, capacidadMensual: 1_500_000 });
    expect(plan.diasRestantes).toBe(100);
    expect(plan.falta).toBe(3_000_000);
    expect(plan.progreso).toBeCloseTo(0.4);
    expect(plan.porDia).toBe(30_000);
    expect(plan.porSemana).toBe(210_000);
    expect(plan.porMes).toBe(913_200);
    expect(plan.estado).toBe('a-tiempo');
    // A $ 1.500.000 por mes: 2 meses = 61 días
    expect(plan.fechaProyectada).toBe('2026-12-28');
  });

  it('clasifica qué tan alcanzable es', () => {
    const base = { meta: 3_000_000, ahorrado: 0, fechaMeta: '2027-01-27', hoy };
    expect(planMeta({ ...base, capacidadMensual: 1_000_000 }).estado).toBe('dificil');
    // Hacen falta $ 1.003.500 al mes (91 días)
    expect(planMeta({ ...base, capacidadMensual: 1_100_000 }).estado).toBe('ajustado');
    expect(planMeta({ ...base, capacidadMensual: 1_600_000 }).estado).toBe('a-tiempo');
    expect(planMeta({ ...base, capacidadMensual: 0 }).estado).toBe('sin-capacidad');
    expect(planMeta({ ...base, capacidadMensual: 0 }).fechaProyectada).toBeNull();
    expect(planMeta({ ...base, ahorrado: 3_500_000, capacidadMensual: 0 }).estado).toBe('lograda');
    expect(planMeta({ ...base, fechaMeta: '2026-10-01', capacidadMensual: 9 }).estado).toBe('vencida');
  });

  it('no pide más de lo que falta en plazos cortos', () => {
    const plan = planMeta({ meta: 100_000, ahorrado: 40_000, fechaMeta: '2026-10-31', hoy, capacidadMensual: 500_000 });
    expect(plan.porSemana).toBe(60_000);
    expect(plan.porMes).toBe(60_000);
    expect(plan.porDia).toBe(20_000);
  });

  it('simula escenarios: gastos que suben, ahorro extra y más plazo', () => {
    // Hacen falta $ 1.003.500 al mes (182 días)
    const entrada = { meta: 6_000_000, ahorrado: 0, fechaMeta: '2027-04-28', hoy, capacidadMensual: 1_100_000, gastoMensual: 3_000_000 };
    const normal = simularMeta(entrada, { aumentoGastosPct: 0, ahorroExtraMensual: 0, mesesExtra: 0 });
    const gastosSuben = simularMeta(entrada, { aumentoGastosPct: 10, ahorroExtraMensual: 0, mesesExtra: 0 });
    const masPlazo = simularMeta(entrada, { aumentoGastosPct: 10, ahorroExtraMensual: 0, mesesExtra: 3 });
    expect(normal.estado).toBe('ajustado');
    expect(gastosSuben.capacidadMensual).toBe(800_000);
    expect(gastosSuben.estado).toBe('dificil');
    expect(masPlazo.fechaMeta).toBe('2027-07-28');
    expect(masPlazo.porMes).toBeLessThan(gastosSuben.porMes);
    expect(simularMeta(entrada, { aumentoGastosPct: 0, ahorroExtraMensual: 500_000, mesesExtra: 0 }).estado).toBe('a-tiempo');
  });

  it('calcula la capacidad de ahorro con los meses cerrados', () => {
    const historico = [
      { mes: '2026-07', ingresos: 3_000_000, gastos: 2_500_000 },
      { mes: '2026-08', ingresos: 0, gastos: 0 },
      { mes: '2026-09', ingresos: 3_200_000, gastos: 2_600_000 },
      { mes: '2026-10', ingresos: 9_000_000, gastos: 100_000 },
    ];
    expect(capacidadAhorro(historico, '2026-10')).toEqual({ capacidad: 550_000, gastoMensual: 2_550_000, ingresoMensual: 3_100_000 });
    expect(capacidadAhorro(historico.slice(3), '2026-10').capacidad).toBe(8_900_000);
    expect(capacidadAhorro([], '2026-10').capacidad).toBe(0);
  });

  it('maneja fechas de fin de mes', () => {
    expect(sumarMeses('2027-01-31', 1)).toBe('2027-02-28');
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('simulador de decisiones', () => {
  const base: Base = {
    ingresoMensual: 4_000_000,
    gastoMensual: 3_000_000,
    disponible: 8_000_000,
    transporteMensual: 300_000,
    arriendoMensual: 1_200_000,
    salarioMensual: 3_800_000,
  };

  it('calcula cuotas de crédito', () => {
    expect(cuotaCredito(10_000_000, 2, 24)).toBe(528_711);
    expect(cuotaCredito(1_200_000, 0, 12)).toBe(100_000);
    expect(tasaMensualDesdeEA(26.82)).toBeCloseTo(2, 1);
  });

  it('moto financiada: cuota, gastos y ahorro en transporte', () => {
    const r = simularEscenario(
      {
        tipo: 'moto',
        params: { precio: 9_000_000, cuotaInicial: 2_000_000, financiada: true, tasaMensual: 2, plazoMeses: 36, gastosMensuales: 250_000, ahorroTransporte: 200_000 },
      },
      base,
    );
    // 7 millones al 2% mensual a 36 meses
    expect(r.cuotaMensual).toBe(274_630);
    expect(r.pagoInicial).toBe(2_000_000);
    expect(r.cambioMensual).toBe(-324_630);
    expect(r.ahorroMensualDespues).toBe(675_370);
    expect(r.totalIntereses).toBe(2_886_680);
    // Con 6 millones después de la cuota inicial: colchón de 1,8 meses
    expect(r.veredicto).toBe('ajustado');
    expect(r.razones.join(' ')).toMatch(/colchón de 1\.8 meses/);

    const conMasAhorros = simularEscenario(
      {
        tipo: 'moto',
        params: { precio: 9_000_000, cuotaInicial: 2_000_000, financiada: true, tasaMensual: 2, plazoMeses: 36, gastosMensuales: 250_000, ahorroTransporte: 200_000 },
      },
      { ...base, disponible: 15_000_000 },
    );
    expect(conMasAhorros.veredicto).toBe('viable');
    expect(conMasAhorros.razones[0]).toMatch(/Te seguirían quedando/);
  });

  it('crédito muy pesado es riesgoso', () => {
    const r = simularEscenario({ tipo: 'credito', params: { monto: 40_000_000, tasaMensual: 1.8, plazoMeses: 24 } }, base);
    expect(r.pesoDeudas).toBeGreaterThan(0.4);
    expect(r.veredicto).toBe('riesgoso');
    expect(r.razones.join(' ')).toMatch(/30%/);
  });

  it('mudanza con arriendo más caro y sin plata para el depósito', () => {
    const r = simularEscenario(
      { tipo: 'mudanza', params: { arriendoNuevo: 1_900_000, arriendoActual: 1_200_000, otrosCambiosMensuales: 100_000, costoMudanza: 500_000, deposito: 9_000_000 } },
      base,
    );
    expect(r.cambioMensual).toBe(-800_000);
    expect(r.pagoInicial).toBe(9_500_000);
    expect(r.veredicto).toBe('riesgoso');
  });

  it('cambio de empleo con meses sin sueldo', () => {
    const r = simularEscenario(
      { tipo: 'empleo', params: { salarioNuevo: 4_800_000, salarioActual: 3_800_000, otrosCambiosMensuales: 200_000, mesesSinIngreso: 1 } },
      base,
    );
    expect(r.cambioMensual).toBe(800_000);
    expect(r.pagoInicial).toBe(3_000_000);
    expect(r.ahorroMensualDespues).toBe(1_800_000);
    expect(r.mesesColchon).toBeCloseTo(5_000_000 / 3_200_000);
    expect(r.veredicto).toBe('ajustado');
  });
});
