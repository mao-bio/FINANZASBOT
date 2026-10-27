const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 1250000 → "$ 1.250.000" */
export function fmtCOP(value: number): string {
  return COP.format(Math.round(value));
}
