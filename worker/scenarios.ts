import type { Escenario } from '../shared/types';
import type { ParamsEscenario, TipoEscenario } from '../shared/simulador';
import { UserError } from './finance';

const CAMPOS: Record<TipoEscenario, string[]> = {
  moto: ['precio', 'cuotaInicial', 'financiada', 'tasaMensual', 'plazoMeses', 'gastosMensuales', 'ahorroTransporte'],
  credito: ['monto', 'tasaMensual', 'plazoMeses'],
  mudanza: ['arriendoNuevo', 'arriendoActual', 'otrosCambiosMensuales', 'costoMudanza', 'deposito'],
  empleo: ['salarioNuevo', 'salarioActual', 'otrosCambiosMensuales', 'mesesSinIngreso'],
};

/** Acepta solo los campos conocidos de cada tipo, con números razonables. */
export function sanitizeScenario(value: unknown): ParamsEscenario {
  const v = value as { tipo?: unknown; params?: Record<string, unknown> } | null;
  const tipo = v?.tipo as TipoEscenario;
  if (!v || !(tipo in CAMPOS) || typeof v.params !== 'object' || !v.params) throw new UserError('Escenario no válido.');
  const params: Record<string, number | boolean> = {};
  for (const campo of CAMPOS[tipo]) {
    const raw = v.params[campo];
    if (campo === 'financiada') {
      params[campo] = raw === true;
      continue;
    }
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || Math.abs(n) > 100_000_000_000) throw new UserError(`El campo ${campo} no es válido.`);
    params[campo] = campo === 'tasaMensual' ? Math.max(0, Math.min(n, 20)) : Math.round(n);
  }
  return { tipo, params } as unknown as ParamsEscenario;
}

interface ScenarioRow {
  id: number;
  name: string;
  kind: TipoEscenario;
  params: string;
  created_at: string;
}

export async function listScenarios(db: D1Database): Promise<Escenario[]> {
  const { results } = await db.prepare(`SELECT id, name, kind, params, created_at FROM scenarios ORDER BY id DESC`).all<ScenarioRow>();
  return results.map((r) => ({
    id: r.id,
    nombre: r.name,
    escenario: { tipo: r.kind, params: JSON.parse(r.params) } as ParamsEscenario,
    creado: r.created_at,
  }));
}

export async function saveScenario(db: D1Database, nombre: unknown, escenario: unknown): Promise<void> {
  const name = String(nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  if (!name) throw new UserError('Ponle un nombre al escenario.');
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM scenarios`).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) throw new UserError('Ya tienes 30 escenarios guardados. Borra alguno para guardar otro.');
  const limpio = sanitizeScenario(escenario);
  await db
    .prepare(`INSERT INTO scenarios (name, kind, params) VALUES (?, ?, ?)`)
    .bind(name, limpio.tipo, JSON.stringify(limpio.params))
    .run();
}

export async function deleteScenario(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id).run();
}
