import type { Cuenta, MensajeHistorial, ResultadoAcciones, Resumen, TipoDocumento } from '../shared/types';
import { fmtCOP } from '../shared/format';
import type { Accion } from './finance';
import { spendByGroup } from './finance';
import { EXPENSE_CATEGORIES, EXPENSE_GROUPS, INCOME_CATEGORIES } from './categories';
import { ACCOUNT_KINDS } from './accounts';
import { bogotaDay, bogotaMonth, bogotaWeekday, shiftMonth } from './dates';
import type { Env } from './env';

export const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** La IA de Cloudflare falló (cuota agotada, modelo caído…) */
export class AiUnavailableError extends Error {}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }[];
};

type TextModel = typeof DEFAULT_MODEL;

function model(env: Env): TextModel {
  return (env.AI_MODEL?.trim() || DEFAULT_MODEL) as TextModel;
}

/** Saca el texto de la salida del modelo (formato Workers AI clásico u OpenAI). */
function outputOf(out: unknown): unknown {
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  if (o && o.response !== undefined) return o.response;
  if (o?.choices?.[0]?.message?.content !== undefined) return o.choices[0].message.content;
  return out;
}

export function parseJsonOutput(out: unknown): Record<string, unknown> | null {
  const r = outputOf(out);
  if (r && typeof r === 'object') return r as Record<string, unknown>;
  if (typeof r !== 'string') return null;
  const text = r.replace(/```(json)?/gi, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function runJson(
  env: Env,
  messages: ChatMessage[],
  schema: object,
  maxTokens = 700,
): Promise<Record<string, unknown> | null> {
  const base = { messages, max_tokens: maxTokens, temperature: 0 };
  let out: unknown;
  try {
    out = await env.AI.run(model(env), { ...base, response_format: { type: 'json_schema', json_schema: schema } } as never);
  } catch (err) {
    // Algunos modelos no soportan JSON mode: se reintenta en modo texto.
    console.warn('JSON mode falló, reintentando en texto:', err);
    try {
      out = await env.AI.run(model(env), base as never);
    } catch (err2) {
      console.error('Workers AI no respondió:', err2);
      throw new AiUnavailableError(String(err2));
    }
  }
  return parseJsonOutput(out);
}

// ─── 1. Entender el mensaje ───────────────────────────────────────────────────

const STRING = { type: 'string' };

const ACTION_ITEM = {
  type: 'object',
  properties: {
    accion: { type: 'string', enum: ['gasto', 'ingreso', 'transferencia', 'saldo', 'presupuesto'] },
    monto: { type: 'number' },
    categoria: STRING,
    descripcion: STRING,
    cuenta: STRING,
    cuenta_destino: STRING,
    tipo_cuenta: { type: 'string', enum: ['', ...ACCOUNT_KINDS] },
    fecha: STRING,
  },
  required: ['accion', 'monto', 'categoria', 'descripcion', 'cuenta', 'cuenta_destino', 'tipo_cuenta', 'fecha'],
};

const ACTIONS_SCHEMA = {
  type: 'object',
  properties: { acciones: { type: 'array', items: ACTION_ITEM } },
  required: ['acciones'],
};

const AMOUNT_RULES = `MONTOS: siempre en pesos colombianos como número entero.
"80 mil" = 80000 · "50k" = 50000 · "2 millones" = 2000000 · "1.5 millones" o "1,5 millones" = 1500000 · "un palo" = 1000000 · "2 palos" = 2000000 · "500 lucas" = 500000 · "una luca" = 1000 · "$25.900" = 25900 (en Colombia el punto separa miles).`;

function accountsList(cuentas: Cuenta[]): string {
  if (!cuentas.length) return '(ninguna)';
  return cuentas.map((c) => `- ${c.nombre} (${c.tipo}${c.principal ? ', principal' : ''})`).join('\n');
}

export function extractionPrompt(cuentas: Cuenta[], now = new Date()): string {
  const hoy = bogotaDay(now);
  const ayer = bogotaDay(new Date(now.getTime() - 86_400_000));
  return `Eres el motor contable de una app de finanzas personales en Colombia. Lees UN mensaje del usuario y devuelves en JSON las acciones de dinero que reporta. No conversas.

Hoy es ${bogotaWeekday(now)} ${hoy}. Ayer fue ${ayer}.

CUENTAS DEL USUARIO:
${accountsList(cuentas)}

ACCIONES POSIBLES:
- "gasto": pagó o compró algo.
- "ingreso": le entró plata (salario, quincena, pago de un cliente, le devolvieron plata, le regalaron).
- "transferencia": movió plata entre SUS cuentas (de Bancolombia a Nequi, retiró del cajero = de banco a efectivo, pagó la tarjeta de crédito desde el banco, ahorró = pasó plata a una cuenta de ahorros).
- "saldo": dice cuánto TIENE ahora en una cuenta ("tengo 300 mil en efectivo", "en Nequi me quedan 50 mil") o cuánto DEBE en una tarjeta de crédito ("debo 1.2 millones en la Visa"). El monto es el saldo actual, no un gasto.
- "presupuesto": quiere ponerse un tope mensual para una categoría ("ponme 600 mil de presupuesto para comida"). En "categoria" va el grupo.

CAMPOS:
- monto: número entero en pesos. ${AMOUNT_RULES}
- categoria: para gasto, EXACTAMENTE una de: ${EXPENSE_CATEGORIES.join(', ')}.
  Para ingreso, una de: ${INCOME_CATEGORIES.join(', ')}.
  Para presupuesto, uno de estos grupos: ${EXPENSE_GROUPS.join(', ')}.
  Para transferencia o saldo: "".
- descripcion: 1 a 4 palabras con el detalle ("Almuerzo", "Uber al trabajo", "Quincena"). "" si no hay.
- cuenta: nombre de la cuenta o medio de pago que mencionó ("Nequi", "la tarjeta", "efectivo", "Bancolombia"). En transferencias es la cuenta de ORIGEN. "" si no menciona ninguna.
- cuenta_destino: solo en transferencias, la cuenta que recibe la plata. "" en los demás casos.
- tipo_cuenta: tipo de la cuenta mencionada (en transferencias, el de la cuenta destino): efectivo, banco, billetera (Nequi, Daviplata), credito (tarjeta de crédito) o ahorro. "" si no mencionó cuenta.
- fecha: "YYYY-MM-DD" solo si dice un día distinto a hoy ("ayer", "el sábado", "el 15"). "" si es de hoy o no lo dice.

REGLAS:
- Si el mensaje es una pregunta, un saludo, una queja o charla ("¿cuánto tengo?", "¿en qué gasto más?", "hola", "gracias"), devuelve {"acciones": []}.
- Un mensaje puede traer varias acciones ("almuerzo 25 mil y taxi 12 mil" son dos gastos).
- No inventes montos. Si no hay un monto claro, no crees la acción.
- "Ahorré 100 mil" o "guardé 100 mil" = transferencia con cuenta "" y cuenta_destino "Ahorros", tipo_cuenta "ahorro".
- "Pagué la tarjeta" = transferencia hacia la tarjeta de crédito (tipo_cuenta "credito"), no es un gasto.

EJEMPLOS:
"gasté 80 mil en mercado" → {"acciones":[{"accion":"gasto","monto":80000,"categoria":"Comida - Mercado","descripcion":"Mercado","cuenta":"","cuenta_destino":"","tipo_cuenta":"","fecha":""}]}
"me llegó la quincena, 1.8 millones a Bancolombia" → {"acciones":[{"accion":"ingreso","monto":1800000,"categoria":"Salario","descripcion":"Quincena","cuenta":"Bancolombia","cuenta_destino":"","tipo_cuenta":"banco","fecha":""}]}
"ayer pagué 45 mil de gasolina con la tarjeta" → {"acciones":[{"accion":"gasto","monto":45000,"categoria":"Transporte - Gasolina","descripcion":"Gasolina","cuenta":"la tarjeta","cuenta_destino":"","tipo_cuenta":"credito","fecha":"${ayer}"}]}
"pasé 200 mil de Bancolombia a Nequi" → {"acciones":[{"accion":"transferencia","monto":200000,"categoria":"","descripcion":"","cuenta":"Bancolombia","cuenta_destino":"Nequi","tipo_cuenta":"billetera","fecha":""}]}
"tengo 350 mil en efectivo" → {"acciones":[{"accion":"saldo","monto":350000,"categoria":"","descripcion":"","cuenta":"Efectivo","cuenta_destino":"","tipo_cuenta":"efectivo","fecha":""}]}
"debo 1.2 millones en la Visa" → {"acciones":[{"accion":"saldo","monto":1200000,"categoria":"","descripcion":"","cuenta":"Visa","cuenta_destino":"","tipo_cuenta":"credito","fecha":""}]}
"ponle 600 mil de presupuesto a la comida" → {"acciones":[{"accion":"presupuesto","monto":600000,"categoria":"Comida","descripcion":"","cuenta":"","cuenta_destino":"","tipo_cuenta":"","fecha":""}]}
"¿cuánto llevo gastado este mes?" → {"acciones":[]}

Responde SOLO con el JSON.`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const VALID_ACTIONS = new Set(['gasto', 'ingreso', 'transferencia', 'saldo', 'presupuesto']);

export function sanitizeActions(parsed: Record<string, unknown> | null): Accion[] {
  const list = Array.isArray(parsed?.acciones) ? (parsed!.acciones as Record<string, unknown>[]) : [];
  return list
    .filter((a) => a && VALID_ACTIONS.has(str(a.accion)))
    .map((a) => ({
      accion: str(a.accion) as Accion['accion'],
      monto: Number(a.monto),
      categoria: str(a.categoria),
      descripcion: str(a.descripcion),
      cuenta: str(a.cuenta),
      cuenta_destino: str(a.cuenta_destino),
      tipo_cuenta: str(a.tipo_cuenta),
      fecha: str(a.fecha),
    }));
}

export async function extractActions(env: Env, message: string, cuentas: Cuenta[], now = new Date()): Promise<Accion[]> {
  const parsed = await runJson(
    env,
    [
      { role: 'system', content: extractionPrompt(cuentas, now) },
      { role: 'user', content: message },
    ],
    ACTIONS_SCHEMA,
  );
  return sanitizeActions(parsed);
}

// ─── 2. Analizar imágenes (recibos, facturas, comprobantes, extractos) ────────

const DOC_TYPES: TipoDocumento[] = ['recibo', 'factura', 'comprobante', 'extracto', 'saldo', 'otro'];

const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    tipo_documento: { type: 'string', enum: DOC_TYPES },
    resumen: STRING,
    comercio: STRING,
    fecha: STRING,
    total: { type: 'number' },
    items: {
      type: 'array',
      items: { type: 'object', properties: { descripcion: STRING, monto: { type: 'number' } }, required: ['descripcion', 'monto'] },
    },
    movimientos: { type: 'array', items: ACTION_ITEM },
  },
  required: ['tipo_documento', 'resumen', 'comercio', 'fecha', 'total', 'items', 'movimientos'],
};

export interface ImageAnalysis {
  tipoDocumento: TipoDocumento;
  resumen: string;
  comercio: string;
  fecha: string;
  total: number;
  items: { descripcion: string; monto: number }[];
  acciones: Accion[];
}

export function imagePrompt(cuentas: Cuenta[], note: string, now = new Date()): string {
  return `Analiza esta imagen de un documento de plata en Colombia y extrae los datos en JSON. Hoy es ${bogotaWeekday(now)} ${bogotaDay(now)}.

CUENTAS DEL USUARIO:
${accountsList(cuentas)}

NOTA DEL USUARIO: ${note ? `"${note}"` : '(sin nota)'} — puede decir con qué pagó o qué es la imagen.

tipo_documento:
- "recibo": tiquete de caja, cuenta de restaurante, recibo de servicio público o de un pago en un negocio.
- "factura": factura electrónica o de venta.
- "comprobante": comprobante o pantallazo de una transferencia o pago (Nequi, Daviplata, Bancolombia, PSE, Bre-B, consignación).
- "extracto": lista de varios movimientos (extracto bancario, historial de la app del banco, estado de cuenta de la tarjeta).
- "saldo": pantallazo donde se ve el saldo disponible de una cuenta o lo que se debe en una tarjeta.
- "otro": cualquier otra imagen sin movimientos de plata.

CAMPOS:
- resumen: una frase corta y sencilla de lo que ves ("Factura del Éxito por $ 45.900 del 26 de octubre").
- comercio: negocio, banco o persona principal del documento. "" si no hay.
- fecha: "YYYY-MM-DD" del documento si aparece, si no "".
- total: total pagado en pesos. 0 si no aplica.
- items: hasta 15 productos o líneas con su valor, solo si se leen bien. [] si no.
- movimientos: lo que hay que registrar, con el mismo formato del chat:
  · recibo o factura: UN solo "gasto" por el total, descripcion = comercio, con la categoría que mejor aplique.
  · comprobante: si el usuario envió o pagó plata → "gasto" (descripcion "Pago a ..." o "Envío a ..."); si recibió plata → "ingreso". Solo si es entre dos cuentas suyas → "transferencia". cuenta = la app o el banco del comprobante.
  · extracto: un movimiento por cada fila, máximo 30. Compras, cargos, débitos y retiros = "gasto"; abonos, créditos y pagos recibidos = "ingreso"; pagos a la tarjeta de crédito = "transferencia" hacia la tarjeta. cuenta = el banco o la tarjeta del extracto. Usa la fecha de cada fila. Ignora saldos y totales.
  · saldo: un movimiento "saldo" con el valor que se ve y la cuenta (en tarjetas, lo que se debe).
  · otro: [].
  monto: ${AMOUNT_RULES}
  categoria: para gasto EXACTAMENTE una de: ${EXPENSE_CATEGORIES.join(', ')}. Para ingreso una de: ${INCOME_CATEGORIES.join(', ')}. "" en transferencia o saldo.
  tipo_cuenta: efectivo, banco, billetera (Nequi, Daviplata), credito o ahorro según la cuenta; "" si no se sabe.
  fecha: "YYYY-MM-DD" del movimiento si se ve, si no "".

No inventes datos: si algo no se lee bien, déjalo en "" o 0 y no crees ese movimiento.
Responde SOLO con el JSON.`;
}

export function sanitizeImageAnalysis(parsed: Record<string, unknown> | null): ImageAnalysis {
  const tipo = str(parsed?.tipo_documento) as TipoDocumento;
  const total = Math.round(Number(parsed?.total));
  const items = (Array.isArray(parsed?.items) ? (parsed!.items as Record<string, unknown>[]) : [])
    .filter((i) => i && str(i.descripcion) && Number.isFinite(Number(i.monto)))
    .slice(0, 15)
    .map((i) => ({ descripcion: str(i.descripcion).slice(0, 80), monto: Math.round(Number(i.monto)) }));
  return {
    tipoDocumento: DOC_TYPES.includes(tipo) ? tipo : 'otro',
    resumen: str(parsed?.resumen).slice(0, 240),
    comercio: str(parsed?.comercio).slice(0, 80),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(str(parsed?.fecha)) ? str(parsed?.fecha) : '',
    total: Number.isFinite(total) && total > 0 ? total : 0,
    items,
    acciones: sanitizeActions({ acciones: parsed?.movimientos }).filter((a) => a.accion !== 'presupuesto'),
  };
}

export async function analyzeImage(
  env: Env,
  imageDataUrl: string,
  note: string,
  cuentas: Cuenta[],
  now = new Date(),
): Promise<ImageAnalysis> {
  const parsed = await runJson(
    env,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: imagePrompt(cuentas, note, now) },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    IMAGE_SCHEMA,
    3000,
  );
  return sanitizeImageAnalysis(parsed);
}

// ─── 3. Notas de voz ──────────────────────────────────────────────────────────

export async function transcribe(env: Env, audioBase64: string): Promise<string> {
  try {
    const out = await env.AI.run(WHISPER_MODEL, {
      audio: audioBase64,
      language: 'es',
      vad_filter: true,
      initial_prompt: 'Gastos e ingresos en pesos colombianos: mil, millones, lucas, Nequi, Daviplata, Bancolombia, tarjeta.',
    });
    return (out.text ?? '').trim();
  } catch (err) {
    console.error('Whisper falló:', err);
    throw new AiUnavailableError(String(err));
  }
}

// ─── 4. Respuesta de Aura ─────────────────────────────────────────────────────

/** Todo lo que Aura necesita saber, con montos ya formateados para que no haga cuentas. */
export async function buildContext(db: D1Database, summary: Resumen, applied: ResultadoAcciones, recent: unknown[], now = new Date()) {
  const prevMonth = shiftMonth(bogotaMonth(now), -1);
  const prev = summary.historico.find((h) => h.mes === prevMonth);
  const prevByGroup = await spendByGroup(db, prevMonth);
  const byGroup = (list: { grupo: string; monto: number }[]) => Object.fromEntries(list.map((g) => [g.grupo, fmtCOP(g.monto)]));

  return {
    hoy: `${bogotaWeekday(now)} ${bogotaDay(now)}`,
    cuentas: summary.cuentas.map((c) => ({
      nombre: c.nombre,
      tipo: c.tipo,
      saldo: c.tipo === 'credito' && c.saldo < 0 ? `debe ${fmtCOP(-c.saldo)}` : fmtCOP(c.saldo),
      ...(c.principal ? { principal: true } : {}),
    })),
    totales: {
      plata_disponible: fmtCOP(summary.totales.tienes),
      deuda_tarjetas: fmtCOP(summary.totales.debes),
      patrimonio_neto: fmtCOP(summary.totales.neto),
    },
    este_mes: {
      ingresos: fmtCOP(summary.mes.ingresos),
      gastos: fmtCOP(summary.mes.gastos),
      balance_del_mes: fmtCOP(summary.mes.ingresos - summary.mes.gastos),
      gastos_por_categoria: byGroup(summary.mes.porCategoria),
    },
    mes_pasado: {
      ingresos: fmtCOP(prev?.ingresos ?? 0),
      gastos: fmtCOP(prev?.gastos ?? 0),
      gastos_por_categoria: byGroup(prevByGroup),
    },
    presupuestos: summary.mes.presupuestos.map((p) => ({
      categoria: p.categoria,
      tope_mensual: fmtCOP(p.monto),
      gastado: fmtCOP(p.gastado),
      le_queda: fmtCOP(p.monto - p.gastado),
      porcentaje_usado: `${Math.round((p.gastado / p.monto) * 100)}%`,
    })),
    ultimos_movimientos: recent,
    lo_que_se_acaba_de_hacer: {
      movimientos_registrados: applied.movimientos.map(describeTx),
      cuentas_creadas: applied.cuentasCreadas,
      presupuestos_definidos: applied.presupuestos.map((p) => `${p.categoria}: ${fmtCOP(p.monto)} al mes`),
      avisos: applied.avisos,
    },
  };
}

export function describeTx(m: ResultadoAcciones['movimientos'][number]): string {
  switch (m.tipo) {
    case 'gasto':
      return `Gasto de ${fmtCOP(m.monto)} en ${m.categoria} (${m.descripcion}) desde ${m.cuenta}`;
    case 'ingreso':
      return `Ingreso de ${fmtCOP(m.monto)} (${m.categoria}) a ${m.cuenta}`;
    case 'transferencia':
      return `Transferencia de ${fmtCOP(m.monto)} de ${m.cuenta} a ${m.cuenta_destino}`;
    case 'ajuste':
      return `${m.descripcion} en ${m.cuenta}`;
  }
}

function coachSystemPrompt(user: string, context: object): string {
  return `Eres Aura, la asistente de finanzas personales de ${user}. Le hablas como una amiga colombiana que sabe de plata: cercana, con expresiones como "parce", "plata", "lucas", "de una", pero SIEMPRE en lenguaje sencillo y claro.

CÓMO RESPONDER:
- Máximo 4 frases cortas. Nada de tecnicismos; si usas uno, explícalo en palabras simples.
- Emojis con moderación (uno o dos).
- Usa SOLO las cifras del CONTEXTO, copiadas tal cual (formato $ 1.250.000). No hagas sumas ni restas propias; si te preguntan algo que no está en el contexto, dilo con honestidad y sugiere cómo verlo en la app (pestañas Cuentas, Resumen o Historial).
- Si en "lo_que_se_acaba_de_hacer" hay movimientos, confírmalos en una frase. Si está vacío, NO digas que registraste o guardaste algo.
- Si hay "avisos", explícalos con tacto.
- Si se registró un gasto en una categoría con presupuesto, dile cuánto le queda. Si ya pasó del 80%, avísale con cariño.
- Puedes dar consejos prácticos de ahorro y orden, pero no recomiendes inversiones ni productos financieros específicos.
- No digas que eres una IA ni menciones el "contexto" o el JSON.

CONTEXTO:
${JSON.stringify(context)}`;
}

export async function coachReply(
  env: Env,
  args: { user: string; message: string; history: MensajeHistorial[]; context: object },
): Promise<string> {
  const history = args.history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  const out = await env.AI.run(model(env), {
    messages: [
      { role: 'system', content: coachSystemPrompt(args.user, args.context) },
      ...history,
      { role: 'user', content: args.message },
    ],
    max_tokens: 400,
    temperature: 0.5,
  } as never);
  const text = outputOf(out);
  return typeof text === 'string' ? text.trim() : '';
}

/** Respuesta sin IA, por si Workers AI falla al redactar. */
export function fallbackReply(applied: ResultadoAcciones): string {
  const parts: string[] = [];
  if (applied.movimientos.length) {
    parts.push(`Listo parce, anoté: ${applied.movimientos.map(describeTx).join('; ')}. ✅`);
  }
  if (applied.cuentasCreadas.length) parts.push(`Creé la cuenta ${applied.cuentasCreadas.join(', ')}.`);
  if (applied.presupuestos.length) {
    parts.push(`Presupuesto listo: ${applied.presupuestos.map((p) => `${p.categoria} ${fmtCOP(p.monto)} al mes`).join(', ')}.`);
  }
  parts.push(...applied.avisos);
  return parts.join(' ') || 'Uy parce, no te entendí bien. ¿Me lo repites con el monto? Por ejemplo: "gasté 20 mil en almuerzo". 😅';
}
