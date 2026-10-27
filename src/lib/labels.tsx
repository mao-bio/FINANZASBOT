import { Banknote, CreditCard, Landmark, PiggyBank, Smartphone, type LucideIcon } from 'lucide-react';
import type { Cuenta, Movimiento, TipoCuenta } from '../../shared/types';
import { fmtCOP } from '../../shared/format';

export const KIND_LABELS: Record<TipoCuenta, string> = {
  efectivo: 'Efectivo',
  banco: 'Cuenta de banco',
  billetera: 'Billetera digital (Nequi, Daviplata…)',
  credito: 'Tarjeta de crédito',
  ahorro: 'Ahorros',
};

export const KIND_SHORT: Record<TipoCuenta, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  billetera: 'Billetera digital',
  credito: 'Tarjeta de crédito',
  ahorro: 'Ahorros',
};

export const KIND_ICONS: Record<TipoCuenta, LucideIcon> = {
  efectivo: Banknote,
  banco: Landmark,
  billetera: Smartphone,
  credito: CreditCard,
  ahorro: PiggyBank,
};

/** Saldo en palabras sencillas: en tarjetas de crédito se muestra la deuda. */
export function balanceText(c: Pick<Cuenta, 'tipo' | 'saldo'>): string {
  if (c.tipo === 'credito') return c.saldo < 0 ? `Debes ${fmtCOP(-c.saldo)}` : fmtCOP(c.saldo);
  return fmtCOP(c.saldo);
}

export function txSummary(m: Movimiento): string {
  switch (m.tipo) {
    case 'gasto':
      return `Gasto de ${fmtCOP(m.monto)} · ${m.categoria} · ${m.cuenta}`;
    case 'ingreso':
      return `Ingreso de ${fmtCOP(m.monto)} · ${m.categoria} · ${m.cuenta}`;
    case 'transferencia':
      return `Pasaste ${fmtCOP(m.monto)} de ${m.cuenta} a ${m.cuenta_destino}`;
    case 'ajuste':
      return `${m.cuenta}: ${m.descripcion.toLowerCase()}`;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Sin fecha';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

export function monthName(month: string, opts: { short?: boolean } = {}): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-CO', {
    month: opts.short ? 'short' : 'long',
    year: opts.short ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "1.250.000" o "1250000" → 1250000 */
export function parseMoney(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : NaN;
}

export function formatMoneyInput(text: string): string {
  const n = parseMoney(text);
  return Number.isFinite(n) ? n.toLocaleString('es-CO') : '';
}
