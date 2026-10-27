export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  /** Nombre con el que entras (no distingue mayúsculas). */
  APP_USERNAME?: string;
  /** Secreto: tu contraseña. También firma la cookie de sesión. */
  APP_PASSWORD?: string;
  /** Modelo de texto/visión de Workers AI (opcional). */
  AI_MODEL?: string;
}
