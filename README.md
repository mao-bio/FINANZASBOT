# 💸 FINANZASBOT — AI-Driven Personal Finance Coach

[![GitHub License](https://img.shields.io/github/license/mao-bio/FINANZASBOT?style=flat-square&color=38bdf8)](https://github.com/mao-bio/FINANZASBOT/blob/main/LICENSE)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-10b981?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![Gemini AI](https://img.shields.io/badge/IA-Gemini%20Flash%202.5-818cf8?style=flat-square&logo=google-gemini)](https://deepmind.google/technologies/gemini/)

**FINANZASBOT** no es solo un rastreador de gastos; es un **Coach Financiero Personal** que vive en tu Telegram. Combinando el poder de **LLM (Gemini AI)**, una base de datos distribuida en **Supabase** y un dashboard visual de ultra-lujo, este proyecto resuelve el dolor de cabeza de registrar cada centavo manualmente.

---

## 🚀 Características Principales

### 🧠 Inteligencia Artificial Multipodal
- **Voz a Datos**: Graba un audio diciendo *"Compré una pizza por $15.000 y pagué la luz"* y la IA extraerá montos, categorías y descripciones automáticamente.
- **Visión de Facturas**: Envía una foto de tu ticket del súper y la IA leerá los ítems y los cargará por ti.
- **Coach Aura**: Una IA que analiza tus últimos 90 días, detecta tendencias de gasto y te advierte si tu proyección mensual supera tus ingresos.

### 📊 Dashboard Premium (Aurora Design)
- **Glassmorphism UI**: Interfaz moderna basada en transparencia y desenfoque (Vite + React).
- **Responsividad Total**: Optimizado para móviles con tablas interactivas y gráficos de Recharts.
- **Dark Mode Nativo**: Colores curados (`#0f172a`) diseñados para reducir la fatiga visual.

### 🛡️ Arquitectura Robusta
- **Backend**: FastAPI con SQL Alchemy (Async) diseñado para alta concurrencia.
- **Base de Datos**: PostgreSQL alojado en Supabase (Cloud).
- **Integración**: Bot de Telegram con polling asíncrono y threading dedicado.

---

## 🏗️ Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend** | React, Vite, TypeScript, Recharts, Vanilla CSS (Glassmorphism) |
| **Backend** | Python, FastAPI, SQLAlchemy (Async), Uvicorn |
| **IA** | Google Gemini 2.5 Flash API (Texto, Audio, Visión) |
| **Database** | PostgreSQL (Supabase Cloud), SQLite (Local Dev) |
| **Deploy** | Render (API/Bot), Vercel (Web), GitHub (VCS) |

---

## 🛠️ Instalación y Configuración

### Prerrequisitos
- Python 3.10+
- Node.js 18+
- Tokens de: [Telegram Bot](https://t.me/BotFather), [Gemini API](https://aistudio.google.com/), [Supabase](https://supabase.com/).

### Instalación Backend
```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # En Windows: .\venv\Scripts\activate
pip install -r requirements.txt
# Crea un archivo .env con tus tokens
python main.py
```

### Instalación Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 🛣️ Roadmap de Futuro
- [ ] Exportación de reportes mensuales en PDF/Excel.
- [ ] Implementación de "Retos de Ahorro" gamificados.
- [ ] Multi-usuario con sistema de autenticación seguro.

---

## 👨‍💻 Autor
**Mario (Mao-Bio)**  
*"Apasionado por crear soluciones donde la IA se encuentra con el mundo real."*

- **GitHub:** [Mao-Bio](https://github.com/mao-bio)
- **LinkedIn:** [Tu Nombre / LinkedIn]

---

> *Este proyecto fue construido usando metodologías de desarrollo ágil y diseño UI/UX centrado en el usuario.*
