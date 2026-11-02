// Notificaciones push en este celular: pedir permiso, suscribirse al servicio
// push del navegador y avisarle al Worker. Llegan aunque la app esté cerrada.

import { api } from './api';

export type EstadoAvisos =
  /** El navegador no tiene notificaciones push */
  | 'no-soportado'
  /** iPhone/iPad: solo funcionan con la app instalada en la pantalla de inicio */
  | 'ios-instalar'
  /** El usuario bloqueó las notificaciones para este sitio */
  | 'bloqueado'
  | 'apagado'
  | 'activo';

/** Bandera de la versión anterior (avisos solo con la app abierta). */
const LEGACY_KEY = 'fb_notificaciones';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ¿La suscripción se hizo con otra llave? (Si el navegador no la informa, se asume que es la misma.) */
function otraLlave(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length !== b.length || x.some((v, i) => v !== b[i]);
}

/** El service worker se registra al cargar la app publicada; aquí se espera un rato a que esté listo. */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
  if (!reg) throw new Error('La app todavía se está preparando. Ciérrala, ábrela de nuevo e inténtalo otra vez.');
  return reg;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-instalar' : 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission !== 'granted') return 'apagado';
  return (await currentSubscription()) ? 'activo' : 'apagado';
}

/** Pide permiso, suscribe este celular y lo registra en el Worker. */
export async function activarAvisos(publicKey: string): Promise<EstadoAvisos> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'apagado';
  const reg = await registration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Si la suscripción se hizo con otra llave, hay que rehacerla.
  if (sub && otraLlave(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON());
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* sin almacenamiento disponible */
  }
  return 'activo';
}

export async function apagarAvisos(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/**
 * Al abrir la app: si este celular ya tenía permiso, se asegura de que el Worker
 * lo tenga registrado (por si cambió la llave o venía de la versión anterior).
 */
export async function sincronizarAvisos(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  let legacy = false;
  try {
    legacy = localStorage.getItem(LEGACY_KEY) === '1';
  } catch {
    /* sin almacenamiento disponible */
  }
  if (!sub && !legacy) return;
  const { publicKey } = await api.push();
  if (!sub || otraLlave(sub.options.applicationServerKey, keyBytes(publicKey))) {
    await activarAvisos(publicKey);
    return;
  }
  await api.pushSubscribe(sub.toJSON());
}
