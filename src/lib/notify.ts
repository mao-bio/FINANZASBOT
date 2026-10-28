// Alertas en el celular: notificaciones del sistema cuando un gasto te acerca
// (80%) o te pasa del límite de un presupuesto. Son opcionales.

import type { Alerta } from '../../shared/types';

const KEY = 'fb_notificaciones';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  try {
    return notificationsSupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Pide permiso al navegador. Devuelve si quedaron activas. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  try {
    localStorage.setItem(KEY, permiso === 'granted' ? '1' : '0');
  } catch {
    /* sin almacenamiento disponible */
  }
  return permiso === 'granted';
}

export function disableNotifications() {
  try {
    localStorage.setItem(KEY, '0');
  } catch {
    /* sin almacenamiento disponible */
  }
}

export async function notify(alertas: Alerta[]): Promise<void> {
  if (!alertas.length || !notificationsEnabled()) return;
  for (const a of alertas) {
    const options: NotificationOptions = { body: a.mensaje, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `presupuesto-${a.categoria}` };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (reg) await reg.showNotification(a.titulo, options);
      else new Notification(a.titulo, options);
    } catch (err) {
      console.warn('No se pudo mostrar la notificación', err);
    }
  }
}
