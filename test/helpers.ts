import { env } from 'cloudflare:workers';
import { app } from '../worker/index';
import type { Env } from '../worker/env';
import { ensureSchema } from '../worker/schema';
import { resetAll } from '../worker/finance';

type AiHandler = (model: string, inputs: Record<string, unknown>) => unknown;

/** Workers AI de mentira: cada prueba decide qué responde el "modelo". */
export function fakeAI(handler: AiHandler): Ai {
  return { run: async (model: string, inputs: Record<string, unknown>) => handler(model, inputs) } as unknown as Ai;
}

/** Simula el modelo: extracción → `acciones`, respuesta de Aura → `reply`. */
export function scriptedAI(opts: {
  acciones?: unknown[];
  reply?: string;
  transcript?: string;
  image?: Record<string, unknown>;
  calls?: { model: string; inputs: Record<string, unknown> }[];
}): Ai {
  return fakeAI((model, inputs) => {
    opts.calls?.push({ model, inputs });
    if (model.includes('whisper')) return { text: opts.transcript ?? '' };
    if (inputs.response_format) {
      const schema = JSON.stringify(inputs.response_format);
      if (schema.includes('tipo_documento')) {
        return { response: opts.image ?? { tipo_documento: 'otro', resumen: '', comercio: '', fecha: '', total: 0, items: [], movimientos: [] } };
      }
      return { response: { acciones: opts.acciones ?? [] } };
    }
    return { response: opts.reply ?? 'Listo parce.' };
  });
}

export const baseEnv = env as unknown as Env;

export async function resetDb(): Promise<void> {
  await ensureSchema(baseEnv.DB);
  await resetAll(baseEnv.DB);
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM login_attempts'),
    baseEnv.DB.prepare('DELETE FROM push_subscriptions'),
    baseEnv.DB.prepare(`DELETE FROM meta WHERE key IN ('push_prefs', 'push_subject')`),
  ]);
}

export async function login(): Promise<string> {
  const res = await app.request(
    'https://finanzas.test/api/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mario', password: 'clave-de-prueba' }) },
    baseEnv,
  );
  if (res.status !== 200) throw new Error(`login falló: ${res.status}`);
  const cookie = res.headers.get('Set-Cookie')!;
  return cookie.split(';')[0];
}

export async function api(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; ai?: Ai; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(
    `https://finanzas.test${path}`,
    { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined },
    { ...baseEnv, AI: init.ai ?? scriptedAI({}) },
  );
}

export function gasto(monto: number, extra: Record<string, unknown> = {}) {
  return {
    accion: 'gasto',
    monto,
    categoria: 'Comida - Mercado',
    descripcion: 'Mercado',
    cuenta: '',
    cuenta_destino: '',
    tipo_cuenta: '',
    fecha: '',
    ...extra,
  };
}
