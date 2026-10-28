// Service worker de FinanzasBot: guarda la interfaz para que la app abra rápido
// (incluso con mala señal). Los datos (/api/*) siempre van a la red.
const CACHE = 'finanzasbot-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: primero la red (para tener siempre la última versión), si no hay señal, la copia guardada.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Archivos con hash (/assets/…) e íconos: primero la copia guardada.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

// ─── Notificaciones push (llegan aunque la app esté cerrada) ────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { mensaje: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.titulo || 'FinanzasBot', {
      body: data.mensaje || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'es-CO',
      data: { url: data.url || '/' },
    }),
  );
});

// Al tocarla, abre la app en la pantalla del aviso (o trae al frente la que ya está abierta).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const abierta = list.find((c) => 'focus' in c);
      if (!abierta) return self.clients.openWindow(url);
      try {
        const nueva = 'navigate' in abierta ? await abierta.navigate(url) : null;
        return (nueva || abierta).focus();
      } catch {
        return abierta.focus();
      }
    }),
  );
});

// Si el navegador renueva la suscripción, se la pasamos al Worker sin que tengas que hacer nada.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/push', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { publicKey } = await res.json();
      const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const key = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), anterior: event.oldSubscription ? event.oldSubscription.endpoint : undefined }),
      });
    })(),
  );
});
