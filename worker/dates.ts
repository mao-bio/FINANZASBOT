// Colombia está en UTC-5 todo el año (sin horario de verano).
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha 'YYYY-MM-DD' en hora de Colombia */
export function bogotaDay(d = new Date()): string {
  return new Date(d.getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Mes 'YYYY-MM' en hora de Colombia */
export function bogotaMonth(d = new Date()): string {
  return bogotaDay(d).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Rango [start, end) en ISO UTC que cubre el mes completo en hora de Colombia */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  // 00:00 en Bogotá = 05:00 UTC
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 5)).toISOString(),
    end: new Date(Date.UTC(y, m, 1, 5)).toISOString(),
  };
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function bogotaWeekday(d = new Date()): string {
  return WEEKDAYS[new Date(d.getTime() + BOGOTA_OFFSET_MS).getUTCDay()];
}

/**
 * Convierte la fecha que entendió la IA ('YYYY-MM-DD' o vacío) en un ISO UTC.
 * Hoy o fechas inválidas/futuras/muy viejas → ahora mismo.
 * Otro día → mediodía de ese día en Colombia.
 */
export function resolveTxDate(fecha: string | null | undefined, now = new Date()): string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return now.toISOString();
  const [y, m, d] = fecha.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 17));
  if (isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== fecha) return now.toISOString();
  if (fecha >= bogotaDay(now)) return now.toISOString();
  if (now.getTime() - noon.getTime() > 400 * DAY_MS) return now.toISOString();
  return noon.toISOString();
}
