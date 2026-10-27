import type {
  Cuenta,
  Fuente,
  Movimiento,
  Presupuesto,
  ResultadoAcciones,
  Resumen,
  TipoCuenta,
  TipoMovimiento,
  TotalMes,
} from '../shared/types';
import { fmtCOP } from '../shared/format';
import {
  defaultAccount,
  displayName,
  findAccount,
  inferKind,
  isGenericName,
  isKind,
  kindFromWords,
} from './accounts';
import {
  ADJUST_CATEGORY,
  EXPENSE_GROUPS,
  TRANSFER_CATEGORY,
  groupOf,
  normalizeCategory,
  normalizeGroup,
} from './categories';
import { bogotaMonth, monthRange, resolveTxDate, shiftMonth } from './dates';
import { seedDefaults } from './schema';

/** Error con mensaje apto para mostrarle al usuario (HTTP 400). */
export class UserError extends Error {}

const MAX_AMOUNT = 100_000_000_000;

// ─── Cuentas ──────────────────────────────────────────────────────────────────

interface AccountRow {
  id: number;
  name: string;
  kind: TipoCuenta;
  is_default: number;
  balance: number;
}

const ACCOUNTS_WITH_BALANCE = `
  SELECT a.id, a.name, a.kind, a.is_default,
    COALESCE((SELECT SUM(CASE t.type WHEN 'ingreso' THEN t.amount WHEN 'ajuste' THEN t.amount ELSE -t.amount END)
              FROM transactions t WHERE t.account_id = a.id), 0)
    + COALESCE((SELECT SUM(t.amount) FROM transactions t
                WHERE t.type = 'transferencia' AND t.to_account_id = a.id), 0) AS balance
  FROM accounts a`;

function toCuenta(row: AccountRow): Cuenta {
  return {
    id: row.id,
    nombre: row.name,
    tipo: row.kind,
    principal: row.is_default === 1,
    saldo: Number(row.balance) || 0,
  };
}

export async function listAccounts(db: D1Database): Promise<Cuenta[]> {
  const { results } = await db
    .prepare(`${ACCOUNTS_WITH_BALANCE} WHERE a.archived = 0 ORDER BY a.is_default DESC, a.id`)
    .all<AccountRow>();
  return results.map(toCuenta);
}

async function getAccount(db: D1Database, id: number): Promise<Cuenta | null> {
  const row = await db.prepare(`${ACCOUNTS_WITH_BALANCE} WHERE a.id = ? AND a.archived = 0`).bind(id).first<AccountRow>();
  return row ? toCuenta(row) : null;
}

export async function createAccount(
  db: D1Database,
  nombre: string,
  tipo: TipoCuenta,
): Promise<{ cuenta: Cuenta; creada: boolean }> {
  const name = nombre.trim().slice(0, 40);
  if (!name) throw new UserError('Ponle un nombre a la cuenta.');
  const existing = await db
    .prepare(`SELECT id, archived FROM accounts WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<{ id: number; archived: number }>();
  if (existing) {
    if (existing.archived) {
      await db.prepare(`UPDATE accounts SET archived = 0, kind = ? WHERE id = ?`).bind(tipo, existing.id).run();
      return { cuenta: (await getAccount(db, existing.id))!, creada: true };
    }
    return { cuenta: (await getAccount(db, existing.id))!, creada: false };
  }
  const active = await db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE archived = 0`).first<{ n: number }>();
  const row = await db
    .prepare(`INSERT INTO accounts (name, kind, is_default) VALUES (?, ?, ?) RETURNING id`)
    .bind(name, tipo, active?.n ? 0 : 1)
    .first<{ id: number }>();
  return { cuenta: (await getAccount(db, row!.id))!, creada: true };
}

export async function updateAccount(
  db: D1Database,
  id: number,
  changes: { nombre?: string; tipo?: string; principal?: boolean },
): Promise<Cuenta> {
  const cuenta = await getAccount(db, id);
  if (!cuenta) throw new UserError('Esa cuenta no existe.');
  if (changes.nombre !== undefined) {
    const name = changes.nombre.trim().slice(0, 40);
    if (!name) throw new UserError('Ponle un nombre a la cuenta.');
    const clash = await db
      .prepare(`SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id <> ?`)
      .bind(name, id)
      .first();
    if (clash) throw new UserError('Ya tienes otra cuenta con ese nombre.');
    await db.prepare(`UPDATE accounts SET name = ? WHERE id = ?`).bind(name, id).run();
  }
  if (changes.tipo !== undefined) {
    if (!isKind(changes.tipo)) throw new UserError('Tipo de cuenta no válido.');
    await db.prepare(`UPDATE accounts SET kind = ? WHERE id = ?`).bind(changes.tipo, id).run();
  }
  if (changes.principal) {
    await db.batch([
      db.prepare(`UPDATE accounts SET is_default = 0`),
      db.prepare(`UPDATE accounts SET is_default = 1 WHERE id = ?`).bind(id),
    ]);
  }
  return (await getAccount(db, id))!;
}

/** Borra la cuenta si no tiene movimientos; si los tiene y está en cero, la archiva. */
export async function removeAccount(db: D1Database, id: number): Promise<'borrada' | 'archivada'> {
  const cuenta = await getAccount(db, id);
  if (!cuenta) throw new UserError('Esa cuenta no existe.');
  if (cuenta.principal) throw new UserError('Esa es tu cuenta principal. Marca otra como principal antes de quitarla.');
  const used = await db
    .prepare(`SELECT 1 FROM transactions WHERE account_id = ? OR to_account_id = ? LIMIT 1`)
    .bind(id, id)
    .first();
  if (!used) {
    await db.prepare(`DELETE FROM accounts WHERE id = ?`).bind(id).run();
    return 'borrada';
  }
  if (cuenta.saldo !== 0) {
    throw new UserError(
      `${cuenta.nombre} todavía tiene ${fmtCOP(cuenta.saldo)}. Pasa esa plata a otra cuenta o pon el saldo en cero antes de quitarla.`,
    );
  }
  await db.prepare(`UPDATE accounts SET archived = 1, is_default = 0 WHERE id = ?`).bind(id).run();
  return 'archivada';
}

// ─── Movimientos ──────────────────────────────────────────────────────────────

interface TxRow {
  id: number;
  type: TipoMovimiento;
  amount: number;
  category: string;
  description: string;
  date: string;
  source: Fuente;
  account_id: number;
  account_name: string;
  to_account_id: number | null;
  to_account_name: string | null;
}

const TX_SELECT = `
  SELECT t.id, t.type, t.amount, t.category, t.description, t.date, t.source,
         t.account_id, a.name AS account_name, t.to_account_id, b.name AS to_account_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts b ON b.id = t.to_account_id`;

function toMovimiento(row: TxRow): Movimiento {
  return {
    id: row.id,
    tipo: row.type,
    monto: Number(row.amount),
    categoria: row.category,
    descripcion: row.description,
    fecha: row.date,
    fuente: row.source,
    cuenta_id: row.account_id,
    cuenta: row.account_name,
    cuenta_destino_id: row.to_account_id,
    cuenta_destino: row.to_account_name,
  };
}

export async function listTransactions(db: D1Database, limit = 2000): Promise<Movimiento[]> {
  const { results } = await db
    .prepare(`${TX_SELECT} ORDER BY t.date DESC, t.id DESC LIMIT ?`)
    .bind(Math.min(Math.max(limit, 1), 5000))
    .all<TxRow>();
  return results.map(toMovimiento);
}

async function getTransaction(db: D1Database, id: number): Promise<Movimiento> {
  const row = await db.prepare(`${TX_SELECT} WHERE t.id = ?`).bind(id).first<TxRow>();
  return toMovimiento(row!);
}

export async function deleteTransaction(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM transactions WHERE id = ?`).bind(id).run();
  return res.meta.changes > 0;
}

interface NewTx {
  type: TipoMovimiento;
  amount: number;
  category: string;
  description: string;
  accountId: number;
  toAccountId?: number | null;
  date: string;
  source: Fuente;
}

async function insertTransaction(db: D1Database, tx: NewTx): Promise<Movimiento> {
  const row = await db
    .prepare(
      `INSERT INTO transactions (type, amount, category, description, account_id, to_account_id, date, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(tx.type, tx.amount, tx.category, tx.description, tx.accountId, tx.toAccountId ?? null, tx.date, tx.source)
    .first<{ id: number }>();
  return getTransaction(db, row!.id);
}

/**
 * Deja el saldo de la cuenta en `monto` registrando un ajuste por la diferencia.
 * En tarjetas de crédito `monto` es lo que se debe. Devuelve null si ya estaba así.
 */
export async function setAccountBalance(
  db: D1Database,
  cuenta: Pick<Cuenta, 'id' | 'tipo'>,
  monto: number,
  fuente: Fuente,
  now = new Date(),
): Promise<Movimiento | null> {
  const objetivo = cuenta.tipo === 'credito' ? -Math.abs(monto) : monto;
  const actual = (await getAccount(db, cuenta.id))?.saldo ?? 0;
  const diferencia = objetivo - actual;
  if (diferencia === 0) return null;
  return insertTransaction(db, {
    type: 'ajuste',
    amount: diferencia,
    category: ADJUST_CATEGORY,
    description:
      cuenta.tipo === 'credito' ? `Deuda actualizada a ${fmtCOP(-objetivo)}` : `Saldo actualizado a ${fmtCOP(objetivo)}`,
    accountId: cuenta.id,
    date: now.toISOString(),
    source: fuente,
  });
}

// ─── Presupuestos ─────────────────────────────────────────────────────────────

export async function setBudget(db: D1Database, categoria: string, monto: number): Promise<{ categoria: string; monto: number }> {
  const grupo = normalizeGroup(categoria);
  if (!grupo) throw new UserError(`No reconozco la categoría "${categoria}".`);
  const amount = Math.round(Number(monto));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new UserError('El presupuesto debe ser mayor a cero.');
  await db
    .prepare(`INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount`)
    .bind(grupo, amount)
    .run();
  return { categoria: grupo, monto: amount };
}

export async function deleteBudget(db: D1Database, categoria: string): Promise<void> {
  await db.prepare(`DELETE FROM budgets WHERE category = ?`).bind(categoria).run();
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

/** Gastos del mes agrupados por grupo de categoría, de mayor a menor */
export async function spendByGroup(db: D1Database, month: string): Promise<{ grupo: string; monto: number }[]> {
  const { start, end } = monthRange(month);
  const { results } = await db
    .prepare(`SELECT category, SUM(amount) AS total FROM transactions
              WHERE type = 'gasto' AND date >= ? AND date < ? GROUP BY category`)
    .bind(start, end)
    .all<{ category: string; total: number }>();
  const byGroup = new Map<string, number>();
  for (const r of results) {
    const g = groupOf(r.category);
    byGroup.set(g, (byGroup.get(g) ?? 0) + Number(r.total));
  }
  return [...byGroup.entries()].map(([grupo, monto]) => ({ grupo, monto })).sort((a, b) => b.monto - a.monto);
}

export async function getSummary(db: D1Database, now = new Date()): Promise<Resumen> {
  const month = bogotaMonth(now);
  const firstMonth = shiftMonth(month, -5);
  const [cuentas, porCategoria, hist, budgets] = await Promise.all([
    listAccounts(db),
    spendByGroup(db, month),
    db
      .prepare(`SELECT strftime('%Y-%m', date, '-5 hours') AS mes, type, SUM(amount) AS total
                FROM transactions WHERE type IN ('ingreso', 'gasto') AND date >= ? AND date < ?
                GROUP BY mes, type`)
      .bind(monthRange(firstMonth).start, monthRange(month).end)
      .all<{ mes: string; type: 'ingreso' | 'gasto'; total: number }>(),
    db.prepare(`SELECT category, amount FROM budgets ORDER BY category`).all<{ category: string; amount: number }>(),
  ]);

  const historico: TotalMes[] = [];
  for (let i = 0; i < 6; i++) {
    const mes = shiftMonth(firstMonth, i);
    const rows = hist.results.filter((r) => r.mes === mes);
    historico.push({
      mes,
      ingresos: Number(rows.find((r) => r.type === 'ingreso')?.total ?? 0),
      gastos: Number(rows.find((r) => r.type === 'gasto')?.total ?? 0),
    });
  }
  const actual = historico[historico.length - 1];

  const presupuestos: Presupuesto[] = budgets.results.map((b) => ({
    categoria: b.category,
    monto: Number(b.amount),
    gastado: porCategoria.find((p) => p.grupo === b.category)?.monto ?? 0,
  }));

  const tienes = cuentas.filter((c) => c.tipo !== 'credito').reduce((s, c) => s + c.saldo, 0);
  const debes = cuentas.filter((c) => c.tipo === 'credito').reduce((s, c) => s + Math.max(0, -c.saldo), 0);
  const neto = cuentas.reduce((s, c) => s + c.saldo, 0);

  return {
    cuentas,
    totales: { tienes, debes, neto },
    mes: { ...actual, porCategoria, presupuestos },
    historico,
    grupos: EXPENSE_GROUPS,
  };
}

export async function resetAll(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM transactions`),
    db.prepare(`DELETE FROM budgets`),
    db.prepare(`DELETE FROM accounts`),
    db.prepare(`DELETE FROM meta WHERE key = 'seeded'`),
  ]);
  await seedDefaults(db);
}

// ─── Acciones que entiende la IA ──────────────────────────────────────────────

export interface Accion {
  accion: 'gasto' | 'ingreso' | 'transferencia' | 'saldo' | 'presupuesto';
  monto: number;
  categoria?: string;
  descripcion?: string;
  cuenta?: string;
  cuenta_destino?: string;
  tipo_cuenta?: string;
  fecha?: string;
}

function cleanText(s: string | undefined, max = 60): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

class AccountResolver {
  constructor(
    private db: D1Database,
    private accounts: Cuenta[],
    private result: ResultadoAcciones,
  ) {}

  /** Encuentra la cuenta mencionada; si no existe, la crea. Sin mención → cuenta principal. */
  async resolve(wanted: string | undefined, kindHint: string | undefined): Promise<Cuenta> {
    const name = cleanText(wanted, 40);
    const hint = isKind(kindHint) ? kindHint : null;
    if (!name && !hint) return this.principal();
    const found = findAccount(this.accounts, name, hint);
    if (found) return found;
    if (isGenericName(name) && !hint && !kindFromWords(name)) return this.principal();
    const kind = hint ?? inferKind(name);
    const { cuenta, creada } = await createAccount(this.db, displayName(name, kind), kind);
    if (!this.accounts.some((a) => a.id === cuenta.id)) this.accounts.push(cuenta);
    if (creada) this.result.cuentasCreadas.push(cuenta.nombre);
    return cuenta;
  }

  private async principal(): Promise<Cuenta> {
    const def = defaultAccount(this.accounts);
    if (def) return def;
    const { cuenta } = await createAccount(this.db, 'Efectivo', 'efectivo');
    this.accounts.push(cuenta);
    return cuenta;
  }
}

/** Ejecuta en la base de datos lo que la IA entendió del mensaje. */
export async function applyActions(
  db: D1Database,
  acciones: Accion[],
  fuente: Fuente,
  now = new Date(),
): Promise<ResultadoAcciones> {
  const result: ResultadoAcciones = { movimientos: [], cuentasCreadas: [], presupuestos: [], avisos: [] };
  const resolver = new AccountResolver(db, await listAccounts(db), result);

  for (const a of acciones.slice(0, 8)) {
    const monto = Math.round(Number(a.monto));
    const allowsZero = a.accion === 'saldo';
    if (!Number.isFinite(monto) || monto < 0 || (monto === 0 && !allowsZero) || monto > MAX_AMOUNT) {
      result.avisos.push('Hubo un monto que no entendí bien, así que no lo registré.');
      continue;
    }

    switch (a.accion) {
      case 'gasto':
      case 'ingreso': {
        const cuenta = await resolver.resolve(a.cuenta, a.tipo_cuenta);
        const categoria = normalizeCategory(a.categoria, a.accion);
        result.movimientos.push(
          await insertTransaction(db, {
            type: a.accion,
            amount: monto,
            category: categoria,
            description: cleanText(a.descripcion) || categoria.split(' - ').pop()!,
            accountId: cuenta.id,
            date: resolveTxDate(a.fecha, now),
            source: fuente,
          }),
        );
        break;
      }
      case 'transferencia': {
        if (!cleanText(a.cuenta_destino)) {
          result.avisos.push('No entendí a qué cuenta pasaste la plata.');
          break;
        }
        const origen = await resolver.resolve(a.cuenta, undefined);
        const destino = await resolver.resolve(a.cuenta_destino, a.tipo_cuenta);
        if (origen.id === destino.id) {
          result.avisos.push('La cuenta de origen y la de destino son la misma, así que no registré la transferencia.');
          break;
        }
        result.movimientos.push(
          await insertTransaction(db, {
            type: 'transferencia',
            amount: monto,
            category: TRANSFER_CATEGORY,
            description: cleanText(a.descripcion) || `${origen.nombre} → ${destino.nombre}`,
            accountId: origen.id,
            toAccountId: destino.id,
            date: resolveTxDate(a.fecha, now),
            source: fuente,
          }),
        );
        break;
      }
      case 'saldo': {
        const cuenta = await resolver.resolve(a.cuenta, a.tipo_cuenta);
        const ajuste = await setAccountBalance(db, cuenta, monto, fuente, now);
        if (ajuste) result.movimientos.push(ajuste);
        else result.avisos.push(`${cuenta.nombre} ya tenía ese saldo.`);
        break;
      }
      case 'presupuesto': {
        try {
          result.presupuestos.push(await setBudget(db, a.categoria ?? '', monto));
        } catch (err) {
          if (!(err instanceof UserError)) throw err;
          result.avisos.push(err.message);
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}
