// Tipos compartidos entre el Worker (API) y la app React.

export type TipoCuenta = 'efectivo' | 'banco' | 'billetera' | 'credito' | 'ahorro';
export type TipoMovimiento = 'ingreso' | 'gasto' | 'transferencia' | 'ajuste';
export type Fuente = 'chat' | 'voz' | 'foto';

export interface Cuenta {
  id: number;
  nombre: string;
  tipo: TipoCuenta;
  principal: boolean;
  saldo: number;
}

export interface Movimiento {
  id: number;
  tipo: TipoMovimiento;
  /** Pesos. Siempre positivo, salvo en 'ajuste' (puede ser negativo). */
  monto: number;
  categoria: string;
  descripcion: string;
  fecha: string;
  fuente: Fuente;
  cuenta_id: number;
  cuenta: string;
  cuenta_destino_id: number | null;
  cuenta_destino: string | null;
}

export interface Presupuesto {
  categoria: string;
  monto: number;
  gastado: number;
}

export interface TotalMes {
  /** 'YYYY-MM' en hora de Colombia */
  mes: string;
  ingresos: number;
  gastos: number;
}

export interface Resumen {
  cuentas: Cuenta[];
  totales: { tienes: number; debes: number; neto: number };
  mes: TotalMes & {
    porCategoria: { grupo: string; monto: number }[];
    presupuestos: Presupuesto[];
  };
  historico: TotalMes[];
  /** Grupos de gasto disponibles para presupuestos */
  grupos: string[];
}

export interface ResultadoAcciones {
  movimientos: Movimiento[];
  cuentasCreadas: string[];
  presupuestos: { categoria: string; monto: number }[];
  avisos: string[];
}

export interface RespuestaChat {
  reply: string;
  transcript?: string;
  applied: ResultadoAcciones;
  summary: Resumen;
}

export interface MensajeHistorial {
  role: 'user' | 'assistant';
  content: string;
}
