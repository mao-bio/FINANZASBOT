import type { Cuenta, TipoCuenta } from '../shared/types';
import { norm } from './categories';

export const ACCOUNT_KINDS: TipoCuenta[] = ['efectivo', 'banco', 'billetera', 'credito', 'ahorro'];

export function isKind(value: unknown): value is TipoCuenta {
  return typeof value === 'string' && (ACCOUNT_KINDS as string[]).includes(value);
}

// Palabras que no identifican una cuenta concreta ("la tarjeta", "mi cuenta").
const GENERIC = new Set([
  'cuenta', 'la', 'el', 'los', 'las', 'de', 'del', 'mi', 'mis', 'en', 'con', 'por', 'a', 'al',
  'tarjeta', 'credito', 'debito', 'banco', 'billetera', 'plata', 'dinero', 'cuentas',
]);

function core(name: string): string {
  return norm(name)
    .split(' ')
    .filter((w) => w && !GENERIC.has(w))
    .join(' ');
}

const KIND_PATTERNS: [TipoCuenta, RegExp][] = [
  ['banco', /\bdebito\b/],
  ['credito', /\b(tarjeta|credito|visa|master|mastercard|amex|tc)\b/],
  ['ahorro', /\b(ahorro|ahorros|cdt|bolsillo|cajita|colchon|alcancia)\b/],
  ['billetera', /\b(nequi|daviplata|movii|billetera|dale|rappipay|paypal)\b/],
  ['efectivo', /\b(efectivo|cash|billetes?)\b/],
  ['banco', /\b(banco|bancolombia|davivienda|bbva|bogota|occidente|popular|villas|colpatria|scotiabank|itau|caja social|lulo|falabella|pichincha)\b/],
];

/** Tipo de cuenta según palabras clave del nombre, o null si no hay pistas */
export function kindFromWords(name: string): TipoCuenta | null {
  const n = norm(name);
  for (const [kind, re] of KIND_PATTERNS) if (re.test(n)) return kind;
  return null;
}

export function inferKind(name: string): TipoCuenta {
  return kindFromWords(name) ?? 'banco';
}

const DEFAULT_NAMES: Record<TipoCuenta, string> = {
  credito: 'Tarjeta de crédito',
  ahorro: 'Ahorros',
  billetera: 'Billetera',
  efectivo: 'Efectivo',
  banco: 'Banco',
};

/** Nombre bonito para una cuenta nueva: "la tarjeta visa" → "Tarjeta visa" */
export function displayName(wanted: string, kind: TipoCuenta): string {
  if (!core(wanted)) return DEFAULT_NAMES[kind];
  const cleaned = wanted
    .trim()
    .replace(/^((la|el|los|las|mi|mis|en|de|del|cuenta de|cuenta)\s+)+/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function defaultAccount(accounts: Cuenta[]): Cuenta | undefined {
  return accounts.find((a) => a.principal) ?? accounts[0];
}

/**
 * Busca la cuenta que el usuario mencionó. Devuelve null si no hay coincidencia
 * (el llamador decide si crearla).
 */
export function findAccount(accounts: Cuenta[], wanted: string, hint: TipoCuenta | null): Cuenta | null {
  const c = core(wanted);
  if (c) {
    const exact = accounts.find((a) => core(a.nombre) === c || norm(a.nombre) === norm(wanted));
    if (exact) return exact;
    if (c.length >= 3) {
      const partial = accounts.find((a) => {
        const ac = core(a.nombre);
        return ac.length >= 3 && (ac.includes(c) || c.includes(ac));
      });
      if (partial) return partial;
    }
    return null;
  }
  // Nombre genérico ("la tarjeta", "el banco"): se busca por tipo
  const kind = hint ?? kindFromWords(wanted);
  if (!kind) return null;
  const ofKind = accounts.filter((a) => a.tipo === kind);
  return ofKind.find((a) => a.principal) ?? ofKind[0] ?? null;
}

export function isGenericName(wanted: string): boolean {
  return !core(wanted);
}

export type AccountPlan =
  | { kind: 'existing'; cuenta: Cuenta }
  | { kind: 'principal' }
  | { kind: 'new'; nombre: string; tipo: TipoCuenta };

/**
 * Decide qué cuenta usar para lo que dijo el usuario, sin tocar la base:
 * una existente, la principal o una nueva por crear.
 */
export function planAccount(accounts: Cuenta[], wanted: string, hint: TipoCuenta | null): AccountPlan {
  const name = wanted.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name && !hint) return { kind: 'principal' };
  const found = findAccount(accounts, name, hint);
  if (found) return { kind: 'existing', cuenta: found };
  if (isGenericName(name) && !hint && !kindFromWords(name)) return { kind: 'principal' };
  const tipo = hint ?? inferKind(name);
  return { kind: 'new', nombre: displayName(name, tipo), tipo };
}
