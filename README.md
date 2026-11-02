# 💸 FinanzasBot — Tu asistente de finanzas personales en Cloudflare

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![Workers AI](https://img.shields.io/badge/IA-Workers%20AI-f38020?style=flat-square&logo=cloudflare)](https://ai.cloudflare.com/)
[![D1](https://img.shields.io/badge/DB-Cloudflare%20D1-f38020?style=flat-square&logo=cloudflare)](https://developers.cloudflare.com/d1/)
[![React](https://img.shields.io/badge/UI-React%20%2B%20Vite-61dafb?style=flat-square&logo=react)](https://vite.dev/)

**FinanzasBot** es una app para llevar tus cuentas personales hablando en lenguaje normal. Le cuentas a **Aura**
(*"gasté 20 mil en almuerzo con Nequi"*, *"me llegó la quincena"*, *"pasé 200 mil a ahorros"*) y ella registra,
clasifica y te dice cómo vas. Todo corre en **Cloudflare**: la app, la base de datos y la inteligencia artificial.
Se instala en el celular como una app más (sin tienda de apps).

---

## ✨ Qué hace

| | |
| :--- | :--- |
| 💬 **Chat con Aura** | Escribes como le hablarías a un amigo y la IA entiende montos ("50k", "2 palos", "1.5 millones"), fechas ("ayer"), categorías y cuentas. Un mensaje puede traer varios movimientos. |
| 🎤 **Notas de voz** | Grabas el gasto y Whisper (en Workers AI) lo transcribe. |
| 🖼️ **Analiza imágenes** | Tomas una foto o subes desde la galería (hasta 5 a la vez) facturas, recibos, comprobantes de Nequi/Bancolombia, pantallazos del banco o extractos. La IA reconoce qué es, lee comercio, fecha, total, productos y cada movimiento, y te los muestra para revisar, corregir y guardar. Avisa si alguno parece repetido. |
| 🏦 **Varias cuentas** | Efectivo, bancos, Nequi/Daviplata, tarjetas de crédito y ahorros, cada una con su saldo. Transferencias entre cuentas, pagos de tarjeta y ajustes de saldo. |
| 🎯 **Presupuestos y alertas** | Topes mensuales por categoría con avisos claros: *vas bien*, *ojo*, *te pasaste*. Cuando un gasto te lleva al 80% o te pasa del tope, sale una alerta en la app y una notificación en el celular. |
| 🔔 **Notificaciones push** | Llegan **aunque la app esté cerrada**: alertas de presupuesto apenas registras el gasto y, cada noche a las 7:30 p. m., avisos de presupuestos que van a ritmo de pasarse, suscripciones y cobros fijos de mañana, cuánto apartar para tus metas (los domingos), metas cumplidas y, si quieres, un recordatorio para registrar los gastos del día. Cada tipo se prende o se apaga en tu perfil. |
| 🏁 **Metas de ahorro** | Le pones nombre, valor y fecha (o se la cuentas a Aura) y te dice cuánto apartar **por día, por semana y por mes**, cuánto te falta y si llegas a tiempo con lo que normalmente te sobra. Si este mes vas gastando más de lo normal, te muestra cómo cambia el plan. Puedes vincularla a una cuenta de ahorros o ir abonando a mano. |
| 🧪 **Simular escenarios** | En cada meta: ¿y si mis gastos suben 20%?, ¿y si ahorro 100 mil extra?, ¿y si muevo la fecha 3 meses? Ves el plan de hoy contra el escenario lado a lado. |
| 🤔 **Simular decisiones** | Comprar una moto, tomar un crédito, mudarte o cambiar de empleo: cuota (sistema francés), intereses, cuánto pagas de una, cómo queda tu ahorro mensual, colchón y un veredicto (*viable*, *ajustado*, *riesgoso*) con sus razones y el efecto en tus metas. Guarda escenarios y compara hasta 3. |
| 🔎 **Hallazgos** | Gastos hormiga, suscripciones y cobros fijos que se repiten, categorías donde vas gastando más de lo habitual a esta altura del mes, gastos inusuales (mucho más grandes de lo normal) y límites de gasto sugeridos que activas con un toque. |
| 📊 **Análisis** | Resumen del mes, evolución de los últimos 6 meses y **comparación de dos meses** lado a lado por categoría. |
| ↩️ **Deshacer** | Cada movimiento que registra la IA trae un botón para deshacerlo si entendió mal. |
| 📱 **App instalable (PWA)** | Desde el navegador del celular: "Agregar a pantalla de inicio". Diseño fintech claro con modo oscuro automático. |
| 🔒 **Privada** | Solo tú entras (usuario + contraseña, sesión firmada, freno a intentos fallidos). |

### Así le puedes hablar a Aura

```
gasté 80 mil en mercado
almuerzo 25 mil y taxi 12 mil
ayer pagué 45 mil de gasolina con la tarjeta
me pagaron 1.8 millones a Bancolombia
pasé 200 mil de Bancolombia a Nequi
pagué 500 mil de la tarjeta desde Bancolombia
tengo 350 mil en efectivo            ← fija el saldo real de una cuenta
debo 1.2 millones en la Visa         ← crea/ajusta una tarjeta de crédito
ponme 600 mil de presupuesto para comida
quiero ahorrar 3 millones para un viaje en diciembre   ← crea una meta
¿cuánto tengo?  ·  ¿cómo voy este mes?  ·  ¿en qué gasto más?
```

Si mencionas una cuenta que no existe, Aura la crea sola. Si no dices con qué pagaste, usa tu **cuenta principal**
(la cambias en *Cuentas*: desde Inicio, toca *Ver todas*).

---

## 🏗️ Cómo está hecho

```
Celular (PWA React)  ──►  Cloudflare Worker (Hono)  ──►  D1 (SQLite): cuentas, movimientos, presupuestos, metas, escenarios
                               │
                               └──►  Workers AI
                                      • Llama 4 Scout: entiende mensajes, analiza imágenes y redacta las respuestas
                                      • Whisper large v3 turbo: transcribe notas de voz
```

- Un solo **Worker** sirve la app (archivos estáticos) y la API en `/api/*`.
- La IA **no hace cuentas**: extrae lo que dijiste en JSON, el Worker lo guarda en D1 y calcula los saldos, y Aura
  solo redacta la respuesta con cifras que ya vienen calculadas.
- Metas, simulaciones y hallazgos también son **cálculos exactos sin IA** (`shared/plan.ts`, `shared/simulador.ts`,
  `worker/insights.ts`). La app y Aura usan las mismas fórmulas, así que dicen las mismas cifras.
- El Worker crea sus propias tablas en D1 la primera vez que arranca (no hay que correr migraciones).

| Carpeta | Qué hay |
| :--- | :--- |
| `worker/` | API: sesión (`auth.ts`), finanzas, saldos y alertas (`finance.ts`), metas (`goals.ts`), escenarios (`scenarios.ts`), hallazgos (`insights.ts`), IA (`ai.ts`), tablas (`schema.ts`) |
| `src/` | App React: inicio, análisis, chat con Aura, metas y simulador, movimientos, cuentas |
| `shared/` | Tipos, formato de pesos, plan de metas (`plan.ts`) y simulador de decisiones (`simulador.ts`) |
| `public/` | Manifiesto de la app, service worker e íconos |
| `test/` | Pruebas del Worker (con una IA simulada) |

---

## 🚀 Publicarla en Cloudflare (desde el panel, sin terminal)

Necesitas tu cuenta de Cloudflare (el plan gratis alcanza) y este repo en GitHub.

### 1. Conectar el repo

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → pestaña
   **Workers** → **Import a repository**.
2. Conecta tu GitHub y elige **`mao-bio/finanzasbot`**.
3. Configura el proyecto:
   - **Project name:** `finanzasbot` (tiene que ser igual al `name` de `wrangler.jsonc`).
   - **Production branch:** `main`.
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - Root directory: déjalo vacío (`/`).
4. **Save and Deploy**. En el primer deploy, Wrangler crea sola la base de datos D1 `finanzasbot` y la conecta.

> Si el log del deploy muestra un error con la base de datos: ve a **Storage & Databases → D1 → Create**,
> créala con el nombre `finanzasbot`, copia su **Database ID** y agrégalo en `wrangler.jsonc` dentro de
> `d1_databases` como `"database_id": "…"`. Haz commit y se vuelve a publicar.

### 2. Poner tu contraseña (obligatorio)

En el Worker → **Settings** → **Variables and Secrets** → **Add**:

- **Type:** `Secret` · **Variable name:** `APP_PASSWORD` · **Value:** una clave larga que solo tú sepas.

Guarda (Cloudflare publica de nuevo con el secreto). El usuario para entrar es **`Mario`**; si quieres otro, cámbialo
en `APP_USERNAME` dentro de `wrangler.jsonc` (los cambios a `vars` se hacen en el archivo, no en el panel, porque
cada deploy los sobrescribe).

### 3. Abrirla e instalarla en el celular

1. Abre la URL que te da Cloudflare (algo como `https://finanzasbot.TU-SUBDOMINIO.workers.dev`).
2. Entra con tu usuario y contraseña.
3. Instálala:
   - **Android (Chrome):** menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.
   - **iPhone (Safari):** botón **Compartir** → **Agregar a inicio**.

Desde ahí, cada vez que se fusione un cambio en `main`, Cloudflare publica la nueva versión sola.

### 4. Activar las notificaciones

Abre la app, toca tu inicial (arriba a la derecha) → **Notificaciones** y prende el interruptor. El celular te pide
permiso una vez. Con **Enviarme una de prueba** confirmas que te llegan.

- **Android** (Chrome, Edge, Firefox, Samsung Internet): funcionan desde el navegador o con la app instalada.
- **iPhone**: solo con la app instalada en la pantalla de inicio (iOS 16.4 o más nuevo). Ábrela desde ese ícono y
  actívalas ahí.

No hay que configurar nada en Cloudflare: la revisión de cada noche es un *Cron Trigger* que ya viene en
`wrangler.jsonc` y se publica solo.

---

## 💰 ¿Cuánto cuesta?

Para uso personal, normalmente **$0**:

- **Workers** (plan gratis): 100.000 peticiones al día.
- **D1** (plan gratis): 5 GB de almacenamiento.
- **Cron Triggers y notificaciones push**: gratis (la revisión de la noche es una sola ejecución al día).
- **Workers AI**: trae una cuota gratis diaria (10.000 *neurons*). Cada mensaje usa dos llamadas al modelo (entender
  y responder), así que alcanza para el uso normal de una persona. Si se agota, Aura avisa que la IA no respondió y
  vuelve a funcionar al día siguiente; mientras tanto puedes ver y editar tus cuentas, presupuestos e historial.
  El consumo se ve en el panel en **AI → Workers AI**.

---

## ⚙️ Configuración

| Variable | Dónde | Para qué |
| :--- | :--- | :--- |
| `APP_PASSWORD` | Secreto en el panel | Tu contraseña. También firma la sesión: si la cambias, se cierran todas las sesiones abiertas. |
| `APP_USERNAME` | `wrangler.jsonc` → `vars` | Usuario para entrar (no distingue mayúsculas). |
| `AI_MODEL` | `wrangler.jsonc` → `vars` | Modelo de texto/visión de Workers AI. Por defecto `@cf/meta/llama-4-scout-17b-16e-instruct`. |

---

## 🛠️ Desarrollo en tu computador

```bash
npm install
cp .dev.vars.example .dev.vars    # pon una APP_PASSWORD de prueba
npx wrangler login                # la IA siempre corre en Cloudflare, incluso en local
npm run dev                       # http://localhost:5173
```

```bash
npm test          # pruebas del Worker (IA simulada, D1 local)
npm run build     # revisa tipos y compila
npm run deploy    # publicar desde la terminal (alternativa al panel)
```

---

## 🔒 Seguridad

- Toda la API (`/api/*`) exige sesión, salvo el login.
- Sesión en cookie `HttpOnly` + `Secure` + `SameSite=Strict`, firmada con HMAC-SHA256, válida 60 días.
- Las peticiones que cambian datos se rechazan si vienen de otro origen.
- 5 intentos fallidos de login desde la misma IP bloquean el acceso por 15 minutos.
- La contraseña vive como secreto de Cloudflare, nunca en el código.
- Las notificaciones push van cifradas de punta a punta (RFC 8291) y firmadas con llaves VAPID (RFC 8292) que el Worker
  crea solo la primera vez y guarda en D1. El Worker solo envía a los servicios push de los navegadores (Google,
  Mozilla, Apple y Microsoft).

---

## 👨‍💻 Autor

**Mario Hernández** — *"Apasionado por crear soluciones donde la IA se encuentra con el mundo real."*

- 💼 LinkedIn: [Mario Hernández](https://www.linkedin.com/in/mario-hernández-/)
- 🐙 GitHub: [@mao-bio](https://github.com/mao-bio)

---

<sub>Hecho con Cloudflare Workers, D1, Workers AI y React · Herramienta de organización personal, no es asesoría financiera.</sub>
