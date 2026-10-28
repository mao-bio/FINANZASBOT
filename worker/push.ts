// Notificaciones push (Web Push): llegan al celular aunque la app esté cerrada.
// El Worker firma (VAPID, RFC 8292) y cifra (aes128gcm, RFC 8291) cada mensaje
// con WebCrypto. Las llaves se crean solas la primera vez y se guardan en D1:
// no hay que configurar nada en el panel.

import type { EstadoPush, PreferenciasAvisos, TipoAviso } from '../shared/types';
import { UserError } from './finance';

export interface PushPayload {
  titulo: string;
  mensaje: string;
  /** Avisos con el mismo tag se reemplazan en el celular en vez de acumularse */
  tag: string;
  /** Pantalla que abre al tocarla, p. ej. '/?ir=metas' */
  url?: string;
}

export interface Suscripcion {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ResultadoEnvio {
  enviadas: number;
  fallidas: number;
  /** Suscripciones que el navegador ya no usa (se borran) */
  vencidas: number;
}

export const PREFERENCIAS_INICIALES: PreferenciasAvisos = { presupuesto: true, cobros: true, metas: true, diario: false };
const TIPOS: TipoAviso[] = ['presupuesto', 'cobros', 'metas', 'diario'];

/** Solo se aceptan los servicios push de los navegadores (evita que el Worker llame a cualquier URL). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_DISPOSITIVOS = 10;
const MAX_MENSAJE = 300;

const enc = new TextEncoder();

// ─── base64url ────────────────────────────────────────────────────────────────

export function b64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ─── Llaves VAPID ─────────────────────────────────────────────────────────────

interface VapidKeys {
  /** Llave pública sin comprimir (65 bytes) en base64url */
  publicKey: string;
  privateJwk: JsonWebKey;
}

async function readMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function getVapidKeys(db: D1Database): Promise<VapidKeys> {
  const saved = await readMeta(db, 'vapid');
  if (saved) return JSON.parse(saved) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const keys: VapidKeys = {
    publicKey: b64urlEncode((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
  // Si dos peticiones las crean a la vez, se queda la primera que se guardó.
  await db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('vapid', ?)`).bind(JSON.stringify(keys)).run();
  return JSON.parse((await readMeta(db, 'vapid'))!) as VapidKeys;
}

/** Encabezado Authorization con el JWT VAPID firmado (ES256). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = new Date()): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })),
  );
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

// ─── Cifrado del mensaje (RFC 8291, aes128gcm) ───────────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * Cifra el mensaje para una suscripción. `opciones` solo se usa en las pruebas
 * (para reproducir los vectores del RFC); en producción la llave y la sal son nuevas cada vez.
 */
export async function encryptPayload(
  sub: Pick<Suscripcion, 'p256dh' | 'auth'>,
  plaintext: Uint8Array,
  opciones: { serverKeys?: CryptoKeyPair; salt?: Uint8Array } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local =
    opciones.serverKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  // workerd espera la propiedad estándar `public` (sus tipos la llaman `$public`).
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opciones.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Un solo registro: el mensaje y el delimitador 0x02 de "último registro".
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ─── Suscripciones y preferencias ─────────────────────────────────────────────

function checkSubscription(raw: unknown): Suscripcion {
  const s = (raw ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = String(s.endpoint ?? '');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new UserError('La suscripción a notificaciones no es válida.');
  }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    throw new UserError('Ese servicio de notificaciones no es compatible.');
  }
  const p256dh = String(s.keys?.p256dh ?? '');
  const auth = String(s.keys?.auth ?? '');
  try {
    if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length !== 16) throw new Error('largo');
  } catch {
    throw new UserError('La suscripción a notificaciones no es válida.');
  }
  return { endpoint, p256dh, auth };
}

/** "Chrome en Android", "Safari en iPhone"… para saber qué dispositivos reciben avisos. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  const so = /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : '';
  const nav = /edg\//i.test(ua) ? 'Edge' : /samsungbrowser/i.test(ua) ? 'Samsung Internet' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Navegador';
  return so ? `${nav} en ${so}` : nav;
}

export async function saveSubscription(db: D1Database, raw: unknown, origin: string, userAgent: string, anterior?: unknown): Promise<number> {
  const sub = checkSubscription(raw);
  const stmts = [
    db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`,
      )
      .bind(sub.endpoint, sub.p256dh, sub.auth, deviceLabel(userAgent)),
    // El "sub" del JWT VAPID: la dirección de la app, para que el servicio push sepa quién envía.
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('push_subject', ?)`).bind(origin),
    // Máximo de dispositivos: si se pasa, se borran los más viejos.
    db.prepare(
      `DELETE FROM push_subscriptions WHERE endpoint NOT IN (SELECT endpoint FROM push_subscriptions ORDER BY created_at DESC LIMIT ${MAX_DISPOSITIVOS})`,
    ),
  ];
  if (typeof anterior === 'string' && anterior && anterior !== sub.endpoint) {
    stmts.push(db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(anterior));
  }
  await db.batch(stmts);
  return countDevices(db);
}

export async function removeSubscription(db: D1Database, endpoint: unknown): Promise<number> {
  await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(String(endpoint ?? '')).run();
  return countDevices(db);
}

async function countDevices(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function getPreferences(db: D1Database): Promise<PreferenciasAvisos> {
  const saved = await readMeta(db, 'push_prefs');
  const parsed = saved ? (JSON.parse(saved) as Partial<PreferenciasAvisos>) : {};
  return Object.fromEntries(TIPOS.map((t) => [t, typeof parsed[t] === 'boolean' ? parsed[t] : PREFERENCIAS_INICIALES[t]])) as PreferenciasAvisos;
}

export async function setPreferences(db: D1Database, cambios: unknown): Promise<PreferenciasAvisos> {
  const actuales = await getPreferences(db);
  const input = (cambios ?? {}) as Record<string, unknown>;
  for (const t of TIPOS) if (typeof input[t] === 'boolean') actuales[t] = input[t] as boolean;
  await db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('push_prefs', ?)`).bind(JSON.stringify(actuales)).run();
  return actuales;
}

export async function getPushState(db: D1Database): Promise<EstadoPush> {
  const [keys, preferencias, dispositivos] = await Promise.all([getVapidKeys(db), getPreferences(db), countDevices(db)]);
  return { publicKey: keys.publicKey, preferencias, dispositivos };
}

// ─── Envío ────────────────────────────────────────────────────────────────────

/** Envía un aviso a todos los dispositivos suscritos. Nunca lanza error: devuelve el conteo. */
export async function sendToAll(db: D1Database, payload: PushPayload, opciones: { ttl?: number; now?: Date } = {}): Promise<ResultadoEnvio> {
  const resultado: ResultadoEnvio = { enviadas: 0, fallidas: 0, vencidas: 0 };
  const { results } = await db.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions`).all<Suscripcion>();
  if (!results.length) return resultado;

  const [keys, subject] = await Promise.all([getVapidKeys(db), readMeta(db, 'push_subject')]);
  const body = enc.encode(
    JSON.stringify({ ...payload, titulo: payload.titulo.slice(0, 120), mensaje: payload.mensaje.slice(0, MAX_MENSAJE) }),
  );
  const now = opciones.now ?? new Date();

  await Promise.all(
    results.map(async (s) => {
      try {
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidAuthorization(s.endpoint, keys, subject ?? 'https://github.com/mao-bio/FINANZASBOT', now),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(opciones.ttl ?? 12 * 3600),
            Urgency: 'normal',
          },
          body: await encryptPayload(s, body),
        });
        await res.body?.cancel();
        if (res.status === 404 || res.status === 410) {
          resultado.vencidas++;
          await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(s.endpoint).run();
        } else if (res.ok) {
          resultado.enviadas++;
          await db.prepare(`UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?`).bind(now.toISOString(), s.endpoint).run();
        } else {
          resultado.fallidas++;
          console.warn(`El servicio push respondió ${res.status} para ${new URL(s.endpoint).host}`);
        }
      } catch (err) {
        resultado.fallidas++;
        console.warn('No se pudo enviar la notificación push', err);
      }
    }),
  );
  return resultado;
}

/**
 * Envía un aviso una sola vez: si `key` ya se envió, no repite.
 * Solo queda registrado si llegó al menos a un dispositivo.
 */
export async function sendOnce(db: D1Database, key: string, payload: PushPayload, now = new Date()): Promise<boolean> {
  const ya = await db.prepare(`SELECT 1 AS x FROM push_log WHERE key = ?`).bind(key).first();
  if (ya) return false;
  const res = await sendToAll(db, payload, { now });
  if (!res.enviadas) return false;
  await db.prepare(`INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?, ?)`).bind(key, now.toISOString()).run();
  return true;
}

export async function hasSubscribers(db: D1Database): Promise<boolean> {
  return (await countDevices(db)) > 0;
}
