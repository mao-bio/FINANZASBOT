import type { Env } from './env';

export const SESSION_COOKIE = 'fb_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 60; // 60 días

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

// La llave de la sesión se deriva de la contraseña: si la cambias, todas las
// sesiones abiertas se cierran solas.
async function sessionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    await sha256(`finanzasbot-session:${env.APP_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function expectedUser(env: Env): string {
  return env.APP_USERNAME?.trim() || 'Mario';
}

export async function checkCredentials(env: Env, username: string, password: string): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  const [a, b] = await Promise.all([sha256(password), sha256(env.APP_PASSWORD)]);
  const passOk = crypto.subtle.timingSafeEqual(a, b);
  const userOk = username.trim().toLowerCase() === expectedUser(env).toLowerCase();
  return passOk && userOk;
}

export async function createSession(env: Env, user: string, now = Date.now()): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ u: user, exp: now + SESSION_MAX_AGE * 1000 })));
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(env: Env, token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token || !env.APP_PASSWORD) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(env), fromB64url(sig), encoder.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u?: string; exp?: number };
    if (!data.u || !data.exp || data.exp < now) return null;
    return data.u;
  } catch {
    return null;
  }
}

// ─── Freno a intentos de login por IP ─────────────────────────────────────────

export async function isLockedOut(db: D1Database, ip: string, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(`SELECT failures, window_start FROM login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<{ failures: number; window_start: number }>();
  return !!row && row.failures >= MAX_FAILURES && now - row.window_start < FAILURE_WINDOW_MS;
}

export async function recordFailure(db: D1Database, ip: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, failures, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(ip, now, FAILURE_WINDOW_MS)
    .run();
}

export async function clearFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}
