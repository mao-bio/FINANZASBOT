// Simulador de decisiones: ¿qué pasa con mi plata si compro una moto, tomo un
// crédito, me mudo o cambio de empleo? Cálculos exactos, sin IA.

export type TipoEscenario = 'moto' | 'credito' | 'mudanza' | 'empleo';

/** Tu situación actual (promedios de los últimos meses). */
export interface Base {
  ingresoMensual: number;
  gastoMensual: number;
  /** Plata disponible hoy (sin contar tarjetas de crédito) */
  disponible: number;
  transporteMensual: number;
  arriendoMensual: number;
  salarioMensual: number;
}

export interface ParamsMoto {
  precio: number;
  cuotaInicial: number;
  financiada: boolean;
  tasaMensual: number;
  plazoMeses: number;
  /** Gasolina, mantenimiento, SOAT y seguro al mes */
  gastosMensuales: number;
  /** Lo que dejarías de gastar en buses, taxis o apps al mes */
  ahorroTransporte: number;
}

export interface ParamsCredito {
  monto: number;
  tasaMensual: number;
  plazoMeses: number;
}

export interface ParamsMudanza {
  arriendoNuevo: number;
  arriendoActual: number;
  /** Cambio en servicios, transporte, etc. al mes (+ sube, − baja) */
  otrosCambiosMensuales: number;
  costoMudanza: number;
  deposito: number;
}

export interface ParamsEmpleo {
  salarioNuevo: number;
  salarioActual: number;
  /** Cambio en transporte, comida, etc. al mes (+ sube, − baja) */
  otrosCambiosMensuales: number;
  mesesSinIngreso: number;
}

export type ParamsEscenario =
  | { tipo: 'moto'; params: ParamsMoto }
  | { tipo: 'credito'; params: ParamsCredito }
  | { tipo: 'mudanza'; params: ParamsMudanza }
  | { tipo: 'empleo'; params: ParamsEmpleo };

export type Veredicto = 'viable' | 'ajustado' | 'riesgoso';

export interface ResultadoEscenario {
  /** Lo que tienes que pagar de una (cuota inicial, mudanza, meses sin sueldo…) */
  pagoInicial: number;
  /** Cuánto cambia tu bolsillo cada mes (+ te queda más, − te queda menos) */
  cambioMensual: number;
  cuotaMensual: number;
  totalIntereses: number;
  ahorroMensualAntes: number;
  ahorroMensualDespues: number;
  /** Parte del ingreso que se va en cuotas de deudas, 0 a 1 */
  pesoDeudas: number;
  /** Meses que aguantarías con la plata que te queda si dejaras de recibir ingresos */
  mesesColchon: number;
  veredicto: Veredicto;
  razones: string[];
}

/** Cuota fija mensual de un crédito (sistema francés). */
export function cuotaCredito(monto: number, tasaMensualPct: number, meses: number): number {
  if (monto <= 0 || meses <= 0) return 0;
  const i = tasaMensualPct / 100;
  if (i <= 0) return Math.round(monto / meses);
  return Math.round((monto * i) / (1 - Math.pow(1 + i, -meses)));
}

/** Convierte una tasa efectiva anual (%) en tasa mensual (%). */
export function tasaMensualDesdeEA(eaPct: number): number {
  return (Math.pow(1 + eaPct / 100, 1 / 12) - 1) * 100;
}

function fmt(n: number): string {
  return `$ ${Math.round(n).toLocaleString('es-CO')}`;
}

export function simularEscenario(escenario: ParamsEscenario, base: Base): ResultadoEscenario {
  let pagoInicial = 0;
  let cambioMensual = 0;
  let cuotaMensual = 0;
  let totalIntereses = 0;
  let ingresoDespues = base.ingresoMensual;
  const razones: string[] = [];

  switch (escenario.tipo) {
    case 'moto': {
      const p = escenario.params;
      if (p.financiada) {
        const financiado = Math.max(0, p.precio - p.cuotaInicial);
        cuotaMensual = cuotaCredito(financiado, p.tasaMensual, p.plazoMeses);
        totalIntereses = Math.max(0, cuotaMensual * p.plazoMeses - financiado);
        pagoInicial = Math.min(p.cuotaInicial, p.precio);
      } else {
        pagoInicial = p.precio;
      }
      cambioMensual = -cuotaMensual - p.gastosMensuales + p.ahorroTransporte;
      break;
    }
    case 'credito': {
      const p = escenario.params;
      cuotaMensual = cuotaCredito(p.monto, p.tasaMensual, p.plazoMeses);
      totalIntereses = Math.max(0, cuotaMensual * p.plazoMeses - p.monto);
      cambioMensual = -cuotaMensual;
      // La plata del crédito entra hoy: suma a lo disponible (pago inicial negativo).
      pagoInicial = -p.monto;
      break;
    }
    case 'mudanza': {
      const p = escenario.params;
      cambioMensual = -(p.arriendoNuevo - p.arriendoActual) - p.otrosCambiosMensuales;
      pagoInicial = p.costoMudanza + p.deposito;
      break;
    }
    case 'empleo': {
      const p = escenario.params;
      const cambioSalario = p.salarioNuevo - p.salarioActual;
      ingresoDespues = base.ingresoMensual + cambioSalario;
      cambioMensual = cambioSalario - p.otrosCambiosMensuales;
      // Los meses sin sueldo se pagan con lo que tienes ahorrado.
      pagoInicial = Math.round(p.mesesSinIngreso * base.gastoMensual);
      break;
    }
  }

  const ahorroMensualAntes = Math.round(base.ingresoMensual - base.gastoMensual);
  const ahorroMensualDespues = Math.round(ahorroMensualAntes + cambioMensual);
  const gastoDespues = Math.max(1, ingresoDespues - ahorroMensualDespues);
  const pesoDeudas = ingresoDespues > 0 ? cuotaMensual / ingresoDespues : cuotaMensual > 0 ? 1 : 0;
  const quedaDisponible = base.disponible - pagoInicial;
  const mesesColchon = Math.max(0, quedaDisponible / gastoDespues);

  let veredicto: Veredicto = 'viable';
  const subir = (v: Veredicto) => {
    if (v === 'riesgoso' || (v === 'ajustado' && veredicto === 'viable')) veredicto = v;
  };

  if (pagoInicial > base.disponible) {
    subir('riesgoso');
    razones.push(`Necesitas ${fmt(pagoInicial)} de una y hoy tienes ${fmt(base.disponible)}.`);
  }
  if (ahorroMensualDespues < 0) {
    subir('riesgoso');
    razones.push(`Gastarías ${fmt(-ahorroMensualDespues)} más de lo que te entra cada mes.`);
  } else if (ahorroMensualDespues < ingresoDespues * 0.1) {
    subir('ajustado');
    razones.push(`Te quedarían solo ${fmt(ahorroMensualDespues)} al mes para ahorrar (menos del 10% de tu ingreso).`);
  }
  if (pesoDeudas > 0.4) {
    subir('riesgoso');
    razones.push(`La cuota se llevaría el ${Math.round(pesoDeudas * 100)}% de tu ingreso (lo sano es menos del 30%).`);
  } else if (pesoDeudas > 0.3) {
    subir('ajustado');
    razones.push(`La cuota se llevaría el ${Math.round(pesoDeudas * 100)}% de tu ingreso (lo sano es menos del 30%).`);
  }
  if (pagoInicial <= base.disponible && mesesColchon < 3) {
    subir('ajustado');
    razones.push(`Te quedaría un colchón de ${mesesColchon.toFixed(1)} meses; lo ideal es tener al menos 3.`);
  }
  if (totalIntereses > 0) {
    razones.push(`En intereses pagarías ${fmt(totalIntereses)} en total.`);
  }
  if (veredicto === 'viable') {
    razones.unshift(
      cambioMensual >= 0
        ? `Tu bolsillo mejora ${fmt(cambioMensual)} al mes.`
        : `Te seguirían quedando ${fmt(ahorroMensualDespues)} al mes para ahorrar.`,
    );
  }

  return {
    pagoInicial,
    cambioMensual: Math.round(cambioMensual),
    cuotaMensual,
    totalIntereses,
    ahorroMensualAntes,
    ahorroMensualDespues,
    pesoDeudas,
    mesesColchon,
    veredicto,
    razones,
  };
}

/** Valores iniciales sensatos para cada tipo, a partir de tu situación actual. */
export function paramsIniciales(tipo: TipoEscenario, base: Base): ParamsEscenario {
  switch (tipo) {
    case 'moto':
      return {
        tipo,
        params: {
          precio: 9_000_000,
          cuotaInicial: 2_000_000,
          financiada: true,
          tasaMensual: 2,
          plazoMeses: 36,
          gastosMensuales: 250_000,
          ahorroTransporte: Math.round(base.transporteMensual * 0.7),
        },
      };
    case 'credito':
      return { tipo, params: { monto: 5_000_000, tasaMensual: 1.9, plazoMeses: 24 } };
    case 'mudanza':
      return {
        tipo,
        params: {
          arriendoNuevo: Math.round(base.arriendoMensual * 1.15) || 1_200_000,
          arriendoActual: base.arriendoMensual,
          otrosCambiosMensuales: 0,
          costoMudanza: 400_000,
          deposito: 0,
        },
      };
    case 'empleo':
      return {
        tipo,
        params: {
          salarioNuevo: Math.round(base.salarioMensual * 1.15) || 2_000_000,
          salarioActual: base.salarioMensual,
          otrosCambiosMensuales: 0,
          mesesSinIngreso: 0,
        },
      };
  }
}
