// Catálogo de categorías (gastos con formato "Grupo - Detalle").

export const EXPENSE_CATEGORIES = [
  'Hogar - Arriendo', 'Hogar - Administración', 'Hogar - Servicios públicos', 'Hogar - Internet y TV',
  'Hogar - Celular', 'Hogar - Aseo', 'Hogar - Otros',
  'Comida - Mercado', 'Comida - Domicilios', 'Comida - Restaurantes', 'Comida - Café y snacks', 'Comida - Otros',
  'Transporte - Público', 'Transporte - Gasolina', 'Transporte - Apps de movilidad', 'Transporte - Parqueadero',
  'Transporte - Peajes', 'Transporte - Mantenimiento', 'Transporte - Otros',
  'Suscripciones - Streaming', 'Suscripciones - Música', 'Suscripciones - Otras',
  'Salud - EPS y médico', 'Salud - Medicamentos', 'Salud - Gimnasio', 'Salud - Otros',
  'Educación - Matrícula', 'Educación - Cursos', 'Educación - Libros y útiles', 'Educación - Otros',
  'Compras - Ropa', 'Compras - Tecnología', 'Compras - Hogar', 'Compras - Otros',
  'Cuidado personal - Peluquería', 'Cuidado personal - Otros',
  'Mascotas - Comida', 'Mascotas - Veterinario',
  'Entretenimiento - Salidas', 'Entretenimiento - Viajes', 'Entretenimiento - Eventos', 'Entretenimiento - Otros',
  'Deudas - Cuota de crédito', 'Deudas - Intereses y cuotas de manejo', 'Deudas - Otras',
  'Donaciones - Iglesia', 'Donaciones - Familia', 'Donaciones - Otras',
  'Regalos - Otros',
  'Impuestos - Otros',
  'Otros gastos',
] as const;

export const INCOME_CATEGORIES = [
  'Salario', 'Honorarios', 'Negocio', 'Arriendo recibido', 'Intereses', 'Regalos recibidos', 'Reembolso', 'Otros ingresos',
] as const;

export const TRANSFER_CATEGORY = 'Transferencia';
export const ADJUST_CATEGORY = 'Ajuste de saldo';

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function groupOf(category: string): string {
  return category.split(' - ')[0];
}

export const EXPENSE_GROUPS: string[] = Array.from(new Set(EXPENSE_CATEGORIES.map(groupOf)));

function findIn(list: readonly string[], raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  return list.find((c) => norm(c) === n) ?? null;
}

/** Garantiza que la categoría exista en el catálogo; si no, cae en el grupo o en "Otros". */
export function normalizeCategory(raw: string | null | undefined, tipo: 'ingreso' | 'gasto'): string {
  const list = tipo === 'ingreso' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const fallback = tipo === 'ingreso' ? 'Otros ingresos' : 'Otros gastos';
  if (!raw) return fallback;
  const exact = findIn(list, raw);
  if (exact) return exact;
  if (tipo === 'gasto') {
    const group = normalizeGroup(raw);
    if (group) {
      return (
        EXPENSE_CATEGORIES.find((c) => groupOf(c) === group && / - Otr[oa]s$/.test(c)) ??
        EXPENSE_CATEGORIES.find((c) => groupOf(c) === group) ??
        fallback
      );
    }
  }
  return fallback;
}

const GROUP_SYNONYMS: Record<string, string> = {
  mercado: 'Comida', alimentacion: 'Comida', almuerzo: 'Comida', almuerzos: 'Comida', restaurante: 'Comida',
  restaurantes: 'Comida', domicilio: 'Comida', domicilios: 'Comida',
  casa: 'Hogar', servicio: 'Hogar', servicios: 'Hogar', arriendo: 'Hogar',
  gasolina: 'Transporte', bus: 'Transporte', uber: 'Transporte', carro: 'Transporte', moto: 'Transporte',
  ropa: 'Compras', gimnasio: 'Salud', medico: 'Salud', estudio: 'Educación', universidad: 'Educación',
  salida: 'Entretenimiento', salidas: 'Entretenimiento', diversion: 'Entretenimiento', rumba: 'Entretenimiento',
  viaje: 'Entretenimiento', viajes: 'Entretenimiento',
  credito: 'Deudas', creditos: 'Deudas', netflix: 'Suscripciones', spotify: 'Suscripciones',
  mascota: 'Mascotas', mascotas: 'Mascotas', perro: 'Mascotas', gato: 'Mascotas',
  otros: 'Otros gastos',
};

/** Convierte "comida", "Comida - Mercado" o "mercado" en el grupo "Comida". */
export function normalizeGroup(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = norm(raw);
  if (!n) return null;
  const direct = EXPENSE_GROUPS.find((g) => norm(g) === n);
  if (direct) return direct;
  const fullCategory = findIn(EXPENSE_CATEGORIES, raw);
  if (fullCategory) return groupOf(fullCategory);
  const prefix = EXPENSE_GROUPS.find((g) => n.startsWith(norm(g)));
  if (prefix) return prefix;
  for (const word of n.split(' ')) {
    if (GROUP_SYNONYMS[word]) return GROUP_SYNONYMS[word];
  }
  return null;
}
