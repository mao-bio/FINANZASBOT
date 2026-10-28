import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AnalisisImagen, Fuente, MensajeHistorial, RespuestaChat } from '../shared/types';
import type { Env } from './env';
import { ensureSchema } from './schema';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkCredentials,
  clearFailures,
  createSession,
  expectedUser,
  isLockedOut,
  recordFailure,
  verifySession,
} from './auth';
import {
  MAX_BATCH,
  UserError,
  applyActions,
  createAccount,
  deleteBudget,
  deleteTransaction,
  getSummary,
  listAccounts,
  listTransactions,
  previewActions,
  removeAccount,
  resetAll,
  setAccountBalance,
  setBudget,
  updateAccount,
} from './finance';
import {
  AiUnavailableError,
  analyzeImage,
  buildContext,
  coachReply,
  extractActions,
  fallbackReply,
  sanitizeActions,
  transcribe,
} from './ai';
import { inferKind, isKind } from './accounts';
import { getInsights } from './insights';
import { createGoal, deleteGoal, listGoals, updateGoal } from './goals';
import { deleteScenario, listScenarios, saveScenario } from './scenarios';
import { bogotaDay } from './dates';
import { fmtCOP } from '../shared/format';

type AppEnv = { Bindings: Env; Variables: { user: string } };

export const app = new Hono<AppEnv>();

const PUBLIC_PATHS = new Set(['/api/login', '/api/session', '/api/logout']);
const MAX_MEDIA_CHARS = 6 * 1024 * 1024;

app.onError((err, c) => {
  if (err instanceof UserError) return c.json({ error: err.message }, 400);
  if (err instanceof AiUnavailableError) {
    return c.json(
      { error: 'La IA de Cloudflare no respondió (puede que se haya acabado la cuota gratis de hoy). Intenta otra vez en un rato.' },
      503,
    );
  }
  console.error('Error no controlado:', err);
  return c.json({ error: 'Algo salió mal en el servidor. Intenta de nuevo.' }, 500);
});

app.use('/api/*', async (c, next) => {
  // Freno CSRF: las peticiones que cambian datos deben venir de esta misma app.
  if (c.req.method !== 'GET') {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      return c.json({ error: 'Origen no permitido.' }, 403);
    }
  }
  await ensureSchema(c.env.DB);
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const user = await verifySession(c.env, getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'Tu sesión expiró. Vuelve a entrar.' }, 401);
  c.set('user', user);
  return next();
});

// ─── Sesión ───────────────────────────────────────────────────────────────────

app.post('/api/login', async (c) => {
  if (!c.env.APP_PASSWORD) {
    return c.json({ error: 'Falta configurar APP_PASSWORD en Cloudflare (Settings → Variables and Secrets).' }, 500);
  }
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (await isLockedOut(c.env.DB, ip)) {
    return c.json({ error: 'Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.' }, 429);
  }
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}) as Record<string, never>);
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  if (!username || !password) return c.json({ error: 'Escribe tu usuario y tu contraseña.' }, 400);

  if (!(await checkCredentials(c.env, username, password))) {
    await recordFailure(c.env.DB, ip);
    return c.json({ error: 'Usuario o contraseña incorrectos. Intenta de nuevo, parce.' }, 401);
  }
  await clearFailures(c.env.DB, ip);
  const user = expectedUser(c.env);
  setCookie(c, SESSION_COOKIE, await createSession(c.env, user), {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return c.json({ user });
});

app.get('/api/session', async (c) => {
  const user = await verifySession(c.env, getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'Sin sesión' }, 401);
  return c.json({ user });
});

app.post('/api/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ─── Datos ────────────────────────────────────────────────────────────────────

app.get('/api/summary', async (c) => c.json(await getSummary(c.env.DB)));

app.get('/api/transactions', async (c) => {
  const limit = Number(c.req.query('limit') ?? 2000);
  return c.json(await listTransactions(c.env.DB, Number.isFinite(limit) ? limit : 2000));
});

app.delete('/api/transactions/:id', async (c) => {
  const deleted = await deleteTransaction(c.env.DB, Number(c.req.param('id')));
  if (!deleted) return c.json({ error: 'Ese movimiento ya no existe.' }, 404);
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

app.post('/api/accounts', async (c) => {
  const body = await c.req.json<{ nombre?: string; tipo?: string; saldo?: number }>();
  const nombre = String(body.nombre ?? '');
  const tipo = isKind(body.tipo) ? body.tipo : inferKind(nombre);
  const { cuenta, creada } = await createAccount(c.env.DB, nombre, tipo);
  if (!creada) throw new UserError(`Ya tienes una cuenta llamada ${cuenta.nombre}.`);
  const saldo = Math.round(Math.abs(Number(body.saldo ?? 0)));
  if (Number.isFinite(saldo) && saldo > 0) await setAccountBalance(c.env.DB, cuenta, saldo, 'chat');
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

app.patch('/api/accounts/:id', async (c) => {
  const body = await c.req.json<{ nombre?: string; tipo?: string; principal?: boolean; saldo?: number }>();
  const cuenta = await updateAccount(c.env.DB, Number(c.req.param('id')), body);
  if (body.saldo !== undefined) {
    const saldo = Math.round(Math.abs(Number(body.saldo)));
    if (!Number.isFinite(saldo)) throw new UserError('El saldo no es válido.');
    await setAccountBalance(c.env.DB, cuenta, saldo, 'chat');
  }
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

app.delete('/api/accounts/:id', async (c) => {
  const resultado = await removeAccount(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true, resultado, summary: await getSummary(c.env.DB) });
});

app.put('/api/budgets', async (c) => {
  const body = await c.req.json<{ categoria?: string; monto?: number }>();
  await setBudget(c.env.DB, String(body.categoria ?? ''), Number(body.monto));
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

app.delete('/api/budgets/:categoria', async (c) => {
  await deleteBudget(c.env.DB, c.req.param('categoria'));
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

app.post('/api/reset', async (c) => {
  await resetAll(c.env.DB);
  return c.json({ ok: true, summary: await getSummary(c.env.DB) });
});

// ─── Chat con Aura (texto o voz) ───────────────────────────────────────────────

function stripDataUrl(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma > 0 ? value.slice(comma + 1) : value;
}

app.post('/api/chat', bodyLimit({ maxSize: 14 * 1024 * 1024 }), async (c) => {
  const body = await c.req.json<{ message?: string; audio?: string; history?: MensajeHistorial[] }>();
  const db = c.env.DB;
  let message = String(body.message ?? '').trim().slice(0, 1000);
  const history = Array.isArray(body.history) ? body.history : [];
  const cuentas = await listAccounts(db);

  let fuente: Fuente = 'chat';
  let transcript: string | undefined;

  if (typeof body.audio === 'string' && body.audio) {
    if (body.audio.length > MAX_MEDIA_CHARS) throw new UserError('La nota de voz es muy larga. Intenta con menos de un minuto.');
    transcript = await transcribe(c.env, stripDataUrl(body.audio));
    if (!transcript) throw new UserError('No alcancé a escuchar nada en la nota de voz. ¿Me la repites?');
    message = transcript;
    fuente = 'voz';
  }
  if (!message) throw new UserError('Escríbeme algo o mándame una nota de voz.');

  const acciones = await extractActions(c.env, message, cuentas);
  const applied = await applyActions(db, acciones, fuente);
  const summary = await getSummary(db);
  const recent = (await listTransactions(db, 30)).map((m) => ({
    fecha: bogotaDay(new Date(m.fecha)),
    tipo: m.tipo,
    monto: fmtCOP(m.monto),
    categoria: m.categoria,
    descripcion: m.descripcion,
    cuenta: m.cuenta_destino ? `${m.cuenta} → ${m.cuenta_destino}` : m.cuenta,
  }));
  const [metas, hallazgos] = await Promise.all([listGoals(db), getInsights(db, summary)]);
  const context = await buildContext(db, summary, applied, recent, { metas, hallazgos });

  let reply = '';
  try {
    reply = await coachReply(c.env, { user: c.get('user'), message, history, context });
  } catch (err) {
    console.error('No se pudo redactar la respuesta:', err);
  }
  if (!reply) reply = fallbackReply(applied);

  return c.json<RespuestaChat>({ reply, transcript, applied, summary });
});

// ─── Imágenes: analizar y luego guardar lo que el usuario confirme ──────────

app.post('/api/images/analyze', bodyLimit({ maxSize: 10 * 1024 * 1024 }), async (c) => {
  const body = await c.req.json<{ image?: string; note?: string }>();
  const image = String(body.image ?? '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new UserError('Esa imagen no es válida. Usa una foto JPG o PNG.');
  if (image.length > MAX_MEDIA_CHARS) throw new UserError('La imagen es muy pesada. Intenta con otra.');
  const note = String(body.note ?? '').trim().slice(0, 300);
  const db = c.env.DB;
  const analysis = await analyzeImage(c.env, image, note, await listAccounts(db));
  const { acciones, ...datos } = analysis;
  return c.json<AnalisisImagen>({ ...datos, propuestas: await previewActions(db, acciones) });
});

app.post('/api/movements/apply', async (c) => {
  const body = await c.req.json<{ acciones?: unknown }>();
  if (!Array.isArray(body.acciones) || body.acciones.length === 0) throw new UserError('No hay movimientos para guardar.');
  if (body.acciones.length > MAX_BATCH) throw new UserError(`Son demasiados movimientos de una vez (máximo ${MAX_BATCH}).`);
  const acciones = sanitizeActions({ acciones: body.acciones }).filter((a) => a.accion !== 'presupuesto' && a.accion !== 'meta');
  const applied = await applyActions(c.env.DB, acciones, 'foto', new Date(), MAX_BATCH);
  return c.json({ applied, summary: await getSummary(c.env.DB) });
});

// ─── Análisis, metas y simulador ──────────────────────────────────────────────

app.get('/api/insights', async (c) => c.json(await getInsights(c.env.DB, await getSummary(c.env.DB))));

app.get('/api/goals', async (c) => c.json(await listGoals(c.env.DB)));

app.post('/api/goals', async (c) => {
  await createGoal(c.env.DB, await c.req.json());
  return c.json(await listGoals(c.env.DB));
});

app.patch('/api/goals/:id', async (c) => {
  await updateGoal(c.env.DB, Number(c.req.param('id')), await c.req.json());
  return c.json(await listGoals(c.env.DB));
});

app.delete('/api/goals/:id', async (c) => {
  await deleteGoal(c.env.DB, Number(c.req.param('id')));
  return c.json(await listGoals(c.env.DB));
});

app.get('/api/scenarios', async (c) => c.json(await listScenarios(c.env.DB)));

app.post('/api/scenarios', async (c) => {
  const body = await c.req.json<{ nombre?: unknown; escenario?: unknown }>();
  await saveScenario(c.env.DB, body.nombre, body.escenario);
  return c.json(await listScenarios(c.env.DB));
});

app.delete('/api/scenarios/:id', async (c) => {
  await deleteScenario(c.env.DB, Number(c.req.param('id')));
  return c.json(await listScenarios(c.env.DB));
});

app.all('/api/*', (c) => c.json({ error: 'Ruta no encontrada' }, 404));

export default app;
