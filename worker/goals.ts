import type { Meta } from '../shared/types';
import { UserError, listAccounts } from './finance';
import { bogotaDay, isValidDay } from './dates';

const MAX_AMOUNT = 100_000_000_000;

interface GoalRow {
  id: number;
  name: string;
  target: number;
  target_date: string;
  account_id: number | null;
  saved: number;
  created_at: string;
}

/** Metas con lo ahorrado: el saldo de la cuenta vinculada o lo que el usuario fue abonando. */
export async function listGoals(db: D1Database): Promise<Meta[]> {
  const [{ results }, cuentas] = await Promise.all([
    db.prepare(`SELECT id, name, target, target_date, account_id, saved, created_at FROM goals ORDER BY target_date, id`).all<GoalRow>(),
    listAccounts(db),
  ]);
  return results.map((r) => {
    const cuenta = r.account_id ? cuentas.find((c) => c.id === r.account_id) : undefined;
    return {
      id: r.id,
      nombre: r.name,
      monto: Number(r.target),
      fecha: r.target_date,
      cuentaId: cuenta?.id ?? null,
      cuenta: cuenta?.nombre ?? null,
      ahorrado: cuenta ? Math.max(0, cuenta.saldo) : Number(r.saved),
      creada: r.created_at,
    };
  });
}

interface GoalInput {
  nombre?: unknown;
  monto?: unknown;
  fecha?: unknown;
  cuentaId?: unknown;
  ahorrado?: unknown;
  abono?: unknown;
}

function amount(value: unknown, field: string, allowZero = false): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > MAX_AMOUNT) throw new UserError(`${field} no es válido.`);
  return n;
}

async function checkAccount(db: D1Database, value: unknown): Promise<number | null> {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const row = await db.prepare(`SELECT id FROM accounts WHERE id = ? AND archived = 0`).bind(id).first();
  if (!row) throw new UserError('Esa cuenta no existe.');
  return id;
}

function checkName(value: unknown): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new UserError('Ponle un nombre a la meta.');
  return name;
}

function checkDate(value: unknown, now: Date): string {
  if (!isValidDay(value)) throw new UserError('Elige una fecha válida para la meta.');
  if (value <= bogotaDay(now)) throw new UserError('La fecha de la meta tiene que ser en el futuro.');
  return value;
}

export async function createGoal(db: D1Database, input: GoalInput, now = new Date()): Promise<void> {
  const nombre = checkName(input.nombre);
  const monto = amount(input.monto, 'El valor de la meta');
  const fecha = checkDate(input.fecha, now);
  const cuentaId = await checkAccount(db, input.cuentaId);
  const ahorrado = input.ahorrado === undefined ? 0 : amount(input.ahorrado, 'Lo ahorrado', true);
  await db
    .prepare(`INSERT INTO goals (name, target, target_date, account_id, saved) VALUES (?, ?, ?, ?, ?)`)
    .bind(nombre, monto, fecha, cuentaId, ahorrado)
    .run();
}

export async function updateGoal(db: D1Database, id: number, input: GoalInput, now = new Date()): Promise<void> {
  const row = await db.prepare(`SELECT id, saved FROM goals WHERE id = ?`).bind(id).first<{ id: number; saved: number }>();
  if (!row) throw new UserError('Esa meta no existe.');
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.nombre !== undefined) {
    sets.push('name = ?');
    values.push(checkName(input.nombre));
  }
  if (input.monto !== undefined) {
    sets.push('target = ?');
    values.push(amount(input.monto, 'El valor de la meta'));
  }
  if (input.fecha !== undefined) {
    sets.push('target_date = ?');
    values.push(checkDate(input.fecha, now));
  }
  if (input.cuentaId !== undefined) {
    sets.push('account_id = ?');
    values.push(await checkAccount(db, input.cuentaId));
  }
  if (input.ahorrado !== undefined) {
    sets.push('saved = ?');
    values.push(amount(input.ahorrado, 'Lo ahorrado', true));
  } else if (input.abono !== undefined) {
    sets.push('saved = MAX(0, saved + ?)');
    const abono = Math.round(Number(input.abono));
    if (!Number.isFinite(abono) || abono === 0 || Math.abs(abono) > MAX_AMOUNT) throw new UserError('El abono no es válido.');
    values.push(abono);
  }
  if (!sets.length) return;
  await db
    .prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

export async function deleteGoal(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM goals WHERE id = ?`).bind(id).run();
}
