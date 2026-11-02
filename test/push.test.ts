import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, sendToAll } from '../worker/push';
import { runDailyNotifications } from '../worker/avisos';
import { api, baseEnv, gasto, login, resetDb, scriptedAI } from './helpers';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

/** Un "celular" de mentira: sus llaves y cómo descifra lo que le llega (lo que hace el navegador). */
async function fakeDevice(endpoint = 'https://fcm.googleapis.com/fcm/send/prueba-1') {
  const keys = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    subscription: { endpoint, keys: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) } },
    async decrypt(body: Uint8Array): Promise<Record<string, string>> {
      const salt = body.slice(0, 16);
      const idlen = body[20];
      const asPublic = body.slice(21, 21 + idlen);
      const asKey = await crypto.subtle.importKey('raw', asPublic, ECDH, false, []);
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, keys.privateKey, 256),
      );
      const ikm = await hkdf(auth, shared, join(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
      let end = plain.length - 1;
      while (plain[end] === 0) end--;
      expect(plain[end]).toBe(2);
      return JSON.parse(dec.decode(plain.slice(0, end)));
    },
  };
}

type Sent = { url: string; headers: Headers; body: Uint8Array };

function mockPushService(status = 201): Sent[] {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status });
  });
  return sent;
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cifrado web push', () => {
  it('reproduce el ejemplo del RFC 8291', async () => {
    const asPublic = b64urlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(asPublic.slice(1, 33)),
      y: b64urlEncode(asPublic.slice(33, 65)),
      d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      ext: true,
    };
    const serverKeys = {
      privateKey: await crypto.subtle.importKey('jwk', jwk, ECDH, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', asPublic, ECDH, true, []),
    } as CryptoKeyPair;
    const body = await encryptPayload(
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      enc.encode('When I grow up, I want to be a watermelon'),
      { serverKeys, salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

describe('notificaciones push', () => {
  it('crea las llaves VAPID una sola vez y guarda la suscripción', async () => {
    const cookie = await login();
    const a = (await (await api('/api/push', { cookie })).json()) as { publicKey: string; preferencias: Record<string, boolean>; dispositivos: number };
    expect(b64urlDecode(a.publicKey)).toHaveLength(65);
    expect(a.preferencias).toEqual({ presupuesto: true, cobros: true, metas: true, diario: false });
    expect(a.dispositivos).toBe(0);
    const b = (await (await api('/api/push', { cookie })).json()) as { publicKey: string };
    expect(b.publicKey).toBe(a.publicKey);

    const device = await fakeDevice();
    const res = await api('/api/push/subscribe', {
      method: 'POST',
      cookie,
      body: { subscription: device.subscription },
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' },
    });
    expect(await res.json()).toEqual({ ok: true, dispositivos: 1 });
    const row = await baseEnv.DB.prepare('SELECT device FROM push_subscriptions').first<{ device: string }>();
    expect(row?.device).toBe('Chrome en Android');

    const off = await api('/api/push/unsubscribe', { method: 'POST', cookie, body: { endpoint: device.subscription.endpoint } });
    expect(await off.json()).toEqual({ ok: true, dispositivos: 0 });
  });

  it('solo acepta servicios push de los navegadores', async () => {
    const cookie = await login();
    const device = await fakeDevice('https://evil.example.com/robar');
    const res = await api('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: device.subscription } });
    expect(res.status).toBe(400);
    const sinLlaves = await api('/api/push/subscribe', {
      method: 'POST',
      cookie,
      body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'abc', auth: 'abc' } } },
    });
    expect(sinLlaves.status).toBe(400);
  });

  it('firma con VAPID y cifra el mensaje de prueba', async () => {
    const cookie = await login();
    const device = await fakeDevice();
    await api('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: device.subscription } });
    const sent = mockPushService();
    const res = await api('/api/push/test', { method: 'POST', cookie });
    expect(await res.json()).toEqual({ enviadas: 1, fallidas: 0, vencidas: 0 });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(device.subscription.endpoint);
    expect(sent[0].headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(sent[0].headers.get('TTL')).toBe('43200');
    const auth = sent[0].headers.get('Authorization')!;
    const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    const [h, p, sig] = jwt.split('.');
    const claims = JSON.parse(dec.decode(b64urlDecode(p)));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('https://finanzas.test');
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig), enc.encode(`${h}.${p}`))).toBe(true);

    expect(await device.decrypt(sent[0].body)).toMatchObject({ titulo: '¡Listo, parce! 🔔', tag: 'prueba', url: '/' });
  });

  it('borra las suscripciones que el navegador ya no usa', async () => {
    const cookie = await login();
    await api('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: (await fakeDevice()).subscription } });
    mockPushService(410);
    expect(await sendToAll(baseEnv.DB, { titulo: 'x', mensaje: 'y', tag: 'z' })).toEqual({ enviadas: 0, fallidas: 0, vencidas: 1 });
    const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('avisa una sola vez cuando un gasto te acerca o te pasa del presupuesto', async () => {
    const cookie = await login();
    const device = await fakeDevice();
    await api('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: device.subscription } });
    await api('/api/budgets', { method: 'PUT', cookie, body: { categoria: 'Comida', monto: 100_000 } });
    const sent = mockPushService();
    const chat = (acciones: unknown[]) =>
      api('/api/chat', { method: 'POST', cookie, body: { message: 'gasté', history: [] }, ai: scriptedAI({ acciones }) });

    await chat([gasto(85_000)]);
    expect(sent).toHaveLength(1);
    expect(await device.decrypt(sent[0].body)).toMatchObject({ titulo: 'Ya usaste el 85% de Comida', tag: 'presupuesto-Comida', url: '/?ir=hallazgos' });

    await chat([gasto(5_000)]);
    expect(sent).toHaveLength(1);

    await chat([gasto(20_000)]);
    expect(sent).toHaveLength(2);
    expect((await device.decrypt(sent[1].body)).titulo).toBe('Te pasaste del presupuesto de Comida');

    // Si apagas los avisos de presupuesto, no llega nada.
    await api('/api/push/preferences', { method: 'PUT', cookie, body: { presupuesto: false } });
    await api('/api/budgets', { method: 'PUT', cookie, body: { categoria: 'Transporte', monto: 10_000 } });
    await chat([gasto(9_000, { categoria: 'Transporte - Público', descripcion: 'Bus' })]);
    expect(sent).toHaveLength(2);
  });

  it('cada noche avisa de ritmo de gasto, cobros de mañana, metas y el recordatorio', async () => {
    const cookie = await login();
    const device = await fakeDevice();
    await api('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: device.subscription } });
    await api('/api/push/preferences', { method: 'PUT', cookie, body: { diario: true } });
    await api('/api/budgets', { method: 'PUT', cookie, body: { categoria: 'Comida', monto: 600_000 } });

    const db = baseEnv.DB;
    const cuenta = (await db.prepare('SELECT id FROM accounts LIMIT 1').first<{ id: number }>())!.id;
    const tx = (amount: number, category: string, description: string, date: string) =>
      db
        .prepare(`INSERT INTO transactions (type, amount, category, description, account_id, date) VALUES ('gasto', ?, ?, ?, ?, ?)`)
        .bind(amount, category, description, cuenta, `${date}T17:00:00.000Z`);
    await db.batch([
      tx(200_000, 'Comida - Mercado', 'Mercado', '2026-11-05'),
      tx(200_000, 'Comida - Mercado', 'Mercado', '2026-11-12'),
      tx(44_900, 'Suscripciones - Streaming', 'Netflix', '2026-09-16'),
      tx(44_900, 'Suscripciones - Streaming', 'Netflix', '2026-10-16'),
      db.prepare(`INSERT INTO goals (name, target, target_date, saved) VALUES ('Viaje', 1000000, '2027-03-01', 100000)`),
      db.prepare(`INSERT INTO goals (name, target, target_date, saved) VALUES ('Bici', 500000, '2027-01-01', 500000)`),
    ]);
    const bici = (await db.prepare(`SELECT id FROM goals WHERE name = 'Bici'`).first<{ id: number }>())!.id;

    // Domingo 15 de noviembre de 2026, 7:30 p. m. en Colombia
    const now = new Date('2026-11-16T00:30:00Z');
    const sent = mockPushService();
    const enviados = await runDailyNotifications(baseEnv, now);
    expect(enviados).toEqual(['ritmo:Comida:2026-11', 'cobros:2026-11-16', `meta-lograda:${bici}`, 'metas-semana:2026-11-15', 'diario:2026-11-15']);

    const mensajes = await Promise.all(sent.map((s) => device.decrypt(s.body)));
    expect(mensajes[0]).toMatchObject({
      titulo: 'A este ritmo te pasas en Comida',
      mensaje: expect.stringContaining('gasta máximo $ 13.300 al día'),
    });
    expect(mensajes[1]).toMatchObject({ titulo: 'Mañana te cobran Netflix', mensaje: 'Son $ 44.900. ¿Todavía la usas?' });
    expect(mensajes[2].titulo).toBe('¡Lo lograste! 🎉');
    expect(mensajes[3]).toMatchObject({ titulo: expect.stringMatching(/^Esta semana aparta \$/), url: '/?ir=metas' });
    expect(mensajes[4]).toMatchObject({ titulo: '¿Gastaste algo hoy?', url: '/?ir=aura' });

    // La misma noche otra vez: no repite nada.
    expect(await runDailyNotifications(baseEnv, now)).toEqual([]);
    expect(sent).toHaveLength(5);
  });

  it('sin dispositivos suscritos no hace nada', async () => {
    const sent = mockPushService();
    expect(await runDailyNotifications(baseEnv, new Date('2026-11-16T00:30:00Z'))).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
