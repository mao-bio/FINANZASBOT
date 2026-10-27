// El Worker crea sus propias tablas la primera vez que arranca: no hay que
// correr migraciones a mano. Todas las sentencias son idempotentes.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'banco' CHECK (kind IN ('efectivo','banco','billetera','credito','ahorro')),
    is_default INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('ingreso','gasto','transferencia','ajuste')),
    amount INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat','voz','foto')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON transactions(to_account_id)`,
  `CREATE TABLE IF NOT EXISTS budgets (
    category TEXT PRIMARY KEY,
    amount INTEGER NOT NULL CHECK (amount > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= (async () => {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    await seedDefaults(db);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** Crea la cuenta "Efectivo" la primera vez (o después de reiniciar todo). */
export async function seedDefaults(db: D1Database): Promise<void> {
  const seeded = await db.prepare(`SELECT value FROM meta WHERE key = 'seeded'`).first<{ value: string }>();
  if (seeded) return;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO accounts (name, kind, is_default) VALUES ('Efectivo', 'efectivo', 1)`),
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', '1')`),
  ]);
}
