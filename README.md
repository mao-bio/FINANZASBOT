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
| 📷 **Foto de recibos** | Le tomas foto a la factura y la IA lee el total y el comercio. |
| 🏦 **Varias cuentas** | Efectivo, bancos, Nequi/Daviplata, tarjetas de crédito y ahorros, cada una con su saldo. Transferencias entre cuentas, pagos de tarjeta y ajustes de saldo. |
| 🎯 **Presupuestos** | Topes mensuales por categoría con avisos claros: *vas bien*, *ojo*, *te pasaste*. |
| 📊 **Resumen** | Cuánto te entró, cuánto gastaste y en qué, más la evolución de los últimos 6 meses. |
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
¿cuánto tengo?  ·  ¿cómo voy este mes?  ·  ¿en qué gasto más?
```

Si mencionas una cuenta que no existe, Aura la crea sola. Si no dices con qué pagaste, usa tu **cuenta principal**
(la cambias en la pestaña *Cuentas*).

---

## 🏗️ Cómo está hecho

```
Celular (PWA React)  ──►  Cloudflare Worker (Hono)  ──►  D1 (SQLite): cuentas, movimientos, presupuestos
                               │
                               └──►  Workers AI
                                      • Llama 4 Scout: entiende mensajes, lee recibos y redacta las respuestas
                                      • Whisper large v3 turbo: transcribe notas de voz
```

- Un solo **Worker** sirve la app (archivos estáticos) y la API en `/api/*`.
- La IA **no hace cuentas**: extrae lo que dijiste en JSON, el Worker lo guarda en D1 y calcula los saldos, y Aura
  solo redacta la respuesta con cifras que ya vienen calculadas.
- El Worker crea sus propias tablas en D1 la primera vez que arranca (no hay que correr migraciones).

| Carpeta | Qué hay |
| :--- | :--- |
| `worker/` | API: sesión (`auth.ts`), finanzas y saldos (`finance.ts`), IA (`ai.ts`), tablas (`schema.ts`) |
| `src/` | App React: inicio, chat con Aura, cuentas, resumen, movimientos |
| `shared/` | Tipos y formato de pesos compartidos |
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

---

## 💰 ¿Cuánto cuesta?

Para uso personal, normalmente **$0**:

- **Workers** (plan gratis): 100.000 peticiones al día.
- **D1** (plan gratis): 5 GB de almacenamiento.
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

---

## 👨‍💻 Autor

**Mario Hernández** — *"Apasionado por crear soluciones donde la IA se encuentra con el mundo real."*

- 💼 LinkedIn: [Mario Hernández](https://www.linkedin.com/in/mario-hernández-/)
- 🐙 GitHub: [@mao-bio](https://github.com/mao-bio)

---

<sub>Hecho con Cloudflare Workers, D1, Workers AI y React · Herramienta de organización personal, no es asesoría financiera.</sub>
