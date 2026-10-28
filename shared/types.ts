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
  /** Catálogo completo de categorías */
  categorias: { gasto: string[]; ingreso: string[] };
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

export type TipoDocumento = 'recibo' | 'factura' | 'comprobante' | 'extracto' | 'saldo' | 'otro';

/** Movimiento que la IA encontró en una imagen, listo para que el usuario lo revise. */
export interface Propuesta {
  accion: 'gasto' | 'ingreso' | 'transferencia' | 'saldo';
  monto: number;
  categoria: string;
  descripcion: string;
  cuenta: string;
  /** La cuenta no existe todavía: se crearía al guardar */
  cuentaNueva: boolean;
  cuentaDestino: string;
  cuentaDestinoNueva: boolean;
  tipoCuenta: TipoCuenta | '';
  /** 'YYYY-MM-DD' en hora de Colombia */
  fecha: string;
  /** Ya hay un movimiento igual (mismo tipo y monto, ±2 días) */
  posibleDuplicado: boolean;
}

export interface AnalisisImagen {
  tipoDocumento: TipoDocumento;
  resumen: string;
  comercio: string;
  fecha: string;
  total: number;
  items: { descripcion: string; monto: number }[];
  propuestas: Propuesta[];
}

/** Lo que el cliente manda para guardar (mismo formato que entiende el chat) */
export interface AccionGuardar {
  accion: Propuesta['accion'];
  monto: number;
  categoria: string;
  descripcion: string;
  cuenta: string;
  cuenta_destino: string;
  tipo_cuenta: string;
  fecha: string;
}
