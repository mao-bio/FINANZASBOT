import { Banknote, CreditCard, Landmark, PiggyBank, Smartphone, type LucideIcon } from 'lucide-react';
import type { Movimiento, TipoCuenta } from '../../shared/types';
import { fmtCOP } from '../../shared/format';

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

export function amountText(m: Pick<Movimiento, 'tipo' | 'monto'>): string {
  if (m.tipo === 'ingreso') return `+${fmtCOP(m.monto)}`;
  if (m.tipo === 'gasto') return `-${fmtCOP(m.monto)}`;
  if (m.tipo === 'ajuste') return `${m.monto >= 0 ? '+' : '-'}${fmtCOP(Math.abs(m.monto))}`;
  return fmtCOP(m.monto);
}

/** "Comida - Mercado" → "Mercado" */
export function shortCategory(category: string): string {
  return category.split(' - ').pop() ?? category;
}

const BOGOTA = 'America/Bogota';

/** 'YYYY-MM-DD' del día en Colombia */
export function dayKey(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: BOGOTA });
}

export function dayLabel(key: string): string {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Hoy';
  if (key === yesterday) return 'Ayer';
  const label = new Date(`${key}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: BOGOTA,
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: BOGOTA });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: BOGOTA });
}

export function greeting(): string {
  const hour = Number(new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: BOGOTA }));
  if (hour >= 5 && hour < 12) return 'Buenos días,';
  if (hour >= 12 && hour < 19) return 'Buenas tardes,';
  return 'Buenas noches,';
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
