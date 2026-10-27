import {
  ArrowLeftRight,
  Briefcase,
  BriefcaseBusiness,
  Car,
  CircleEllipsis,
  Coins,
  FileText,
  Gift,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  KeyRound,
  Landmark,
  PawPrint,
  Percent,
  Receipt,
  RotateCcw,
  Scissors,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Ticket,
  Tv,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { Movimiento, TipoCuenta } from '../../shared/types';

export interface Visual {
  Icon: LucideIcon;
  /** Tono del ícono; el fondo de la pastilla es este mismo color muy suave. */
  color: string;
}

// Íconos y tonos por grupo de gasto. El tono es decorativo: la categoría
// siempre va escrita al lado, nunca se identifica solo por el color.
const GROUPS: Record<string, Visual> = {
  Hogar: { Icon: House, color: '#4f6bed' },
  Comida: { Icon: UtensilsCrossed, color: '#f08a24' },
  Transporte: { Icon: Car, color: '#0e9fb3' },
  Suscripciones: { Icon: Tv, color: '#8b5cf6' },
  Salud: { Icon: HeartPulse, color: '#e5484d' },
  Educación: { Icon: GraduationCap, color: '#3b82f6' },
  Compras: { Icon: ShoppingBag, color: '#e0458f' },
  'Cuidado personal': { Icon: Scissors, color: '#c026d3' },
  Mascotas: { Icon: PawPrint, color: '#b7791f' },
  Entretenimiento: { Icon: Ticket, color: '#e8a100' },
  Deudas: { Icon: Landmark, color: '#64748b' },
  Donaciones: { Icon: HandHeart, color: '#10b981' },
  Regalos: { Icon: Gift, color: '#e11d48' },
  Impuestos: { Icon: FileText, color: '#475569' },
  'Otros gastos': { Icon: CircleEllipsis, color: '#6b7280' },
};

const INCOME_ICONS: Record<string, LucideIcon> = {
  Salario: Briefcase,
  Honorarios: BriefcaseBusiness,
  Negocio: Store,
  'Arriendo recibido': KeyRound,
  Intereses: Percent,
  'Regalos recibidos': Gift,
  Reembolso: RotateCcw,
  'Otros ingresos': Coins,
};

const INCOME_COLOR = '#0f9f77';

export const KIND_COLORS: Record<TipoCuenta, string> = {
  efectivo: '#0f9f77',
  banco: '#2f5bea',
  billetera: '#6d4cff',
  credito: '#64748b',
  ahorro: '#0e9fb3',
};

export function groupOf(category: string): string {
  return category.split(' - ')[0];
}

export function groupVisual(group: string): Visual {
  return GROUPS[group] ?? { Icon: Receipt, color: '#6b7280' };
}

export function txVisual(m: Pick<Movimiento, 'tipo' | 'categoria'>): Visual {
  switch (m.tipo) {
    case 'ingreso':
      return { Icon: INCOME_ICONS[m.categoria] ?? Coins, color: INCOME_COLOR };
    case 'transferencia':
      return { Icon: ArrowLeftRight, color: '#3f63e6' };
    case 'ajuste':
      return { Icon: SlidersHorizontal, color: '#6b7280' };
    default:
      return groupVisual(groupOf(m.categoria));
  }
}

/** Pastilla redondeada con el ícono de la categoría. */
export function IconTile({ visual, size = 'md' }: { visual: Visual; size?: 'sm' | 'md' | 'lg' }) {
  const { Icon, color } = visual;
  const px = size === 'lg' ? 24 : size === 'sm' ? 16 : 20;
  return (
    <span className={`icon-tile icon-tile-${size}`} style={{ ['--tile' as string]: color }} aria-hidden="true">
      <Icon size={px} strokeWidth={2} />
    </span>
  );
}
