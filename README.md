# 💸 FinanzasBot — Coach Financiero con IA

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Gemini AI](https://img.shields.io/badge/IA-Gemini%202.5%20Flash-818cf8?style=flat-square&logo=google-gemini)](https://deepmind.google/technologies/gemini/)
[![Supabase](https://img.shields.io/badge/DB-Supabase-3ecf8e?style=flat-square&logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=flat-square&logo=vercel)](https://vercel.com/)

**FinanzasBot** es un **Coach Financiero Personal** que vive en la web y se usa desde cualquier lugar con el celular. Le cuentas tus movimientos en lenguaje natural (*"gasté 80 mil en mercado"* o *"tengo 3 millones"*) y la IA **Aura** los registra, categoriza y te da consejos sobre tu plata, en español colombiano informal.

App de uso personal: muestra balance, ingresos, gastos y un histórico, con un dashboard visual y diseño optimizado para móvil.

---

## 🚀 Características

- **Chat con Aura**: escribe tus gastos/ingresos en lenguaje colombiano informal y la IA los detecta y registra solo.
- **Dashboard visual**: saldo, ingresos, gastos, flujo de caja y distribución por categorías (Recharts).
- **Historial completo**: búsqueda y filtros por tipo y categoría.
- **Responsive / móvil**: barra de navegación inferior estilo app nativa, optimizado para iPhone/Android.
- **Login propio**: autenticación server-side con credenciales en variables de entorno.

---

## 🏗️ Stack

| Capa | Tecnología |
| :--- | :--- |
| **Framework** | Next.js 14 (App Router) + TypeScript |
| **IA** | Google Gemini 2.5 Flash (`@google/generative-ai`) |
| **Base de datos** | Supabase (PostgreSQL en la nube) |
| **UI** | CSS custom (Glassmorphism / Aurora Dark), Recharts, lucide-react |
| **Deploy** | Vercel |

---

## 🛠️ Correr en local

```bash
pnpm install
cp .env.local.example .env.local   # rellena tus claves
pnpm dev                            # http://localhost:3000
```

### Variables de entorno

```env
GEMINI_API_KEY=...              # aistudio.google.com/app/apikey (gratis)
APP_USERNAME=mario
APP_PASSWORD=...                # tu contraseña de login
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...        # solo lado servidor, nunca en el cliente
```

> En producción, estas variables se configuran en **Vercel → Settings → Environment Variables**.

---

## ☁️ Deploy a Vercel

```bash
vercel --prod
```

El proyecto está enlazado a Vercel (`finanzas`). Cada push a `main` también puede disparar deploy automático si está conectado el repo de GitHub.

---

## 👨‍💻 Autor

**Mario Hernández** — *"Apasionado por crear soluciones donde la IA se encuentra con el mundo real."*

- 💼 LinkedIn: [Mario Hernández](https://www.linkedin.com/in/mario-hernández-/)
- 🐙 GitHub: [@mao-bio](https://github.com/mao-bio)

---

<sub>Hecho con Next.js, Gemini y Supabase · Análisis de finanzas personales, no asesoría financiera.</sub>
