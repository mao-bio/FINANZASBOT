import type {
  AccionGuardar,
  AnalisisImagen,
  Escenario,
  Hallazgos,
  Meta,
  MensajeHistorial,
  Movimiento,
  ResultadoAcciones,
  Resumen,
  RespuestaChat,
} from '../../shared/types';

export class SessionExpiredError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new Error(navigator.onLine ? 'No se pudo conectar con el servidor.' : 'Estás sin internet. Revisa tu conexión.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') throw new SessionExpiredError(data.error ?? 'Sesión expirada');
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

type WithSummary = { summary: Resumen };

export const api = {
  session: () => request<{ user: string }>('/api/session'),
  login: (username: string, password: string) => request<{ user: string }>('/api/login', json('POST', { username, password })),
  logout: () => request<{ ok: true }>('/api/logout', json('POST')),
  summary: () => request<Resumen>('/api/summary'),
  transactions: () => request<Movimiento[]>('/api/transactions'),
  deleteTransaction: (id: number) => request<WithSummary>(`/api/transactions/${id}`, json('DELETE')),
  createAccount: (body: { nombre: string; tipo: string; saldo?: number }) => request<WithSummary>('/api/accounts', json('POST', body)),
  updateAccount: (id: number, body: { nombre?: string; tipo?: string; principal?: boolean; saldo?: number }) =>
    request<WithSummary>(`/api/accounts/${id}`, json('PATCH', body)),
  deleteAccount: (id: number) => request<WithSummary & { resultado: 'borrada' | 'archivada' }>(`/api/accounts/${id}`, json('DELETE')),
  setBudget: (categoria: string, monto: number) => request<WithSummary>('/api/budgets', json('PUT', { categoria, monto })),
  deleteBudget: (categoria: string) => request<WithSummary>(`/api/budgets/${encodeURIComponent(categoria)}`, json('DELETE')),
  reset: () => request<WithSummary>('/api/reset', json('POST')),
  chat: (body: { message?: string; audio?: string; history: MensajeHistorial[] }) =>
    request<RespuestaChat>('/api/chat', json('POST', body)),
  analyzeImage: (image: string, note: string) => request<AnalisisImagen>('/api/images/analyze', json('POST', { image, note })),
  applyMovements: (acciones: AccionGuardar[]) =>
    request<{ applied: ResultadoAcciones; summary: Resumen }>('/api/movements/apply', json('POST', { acciones })),
  insights: () => request<Hallazgos>('/api/insights'),
  goals: () => request<Meta[]>('/api/goals'),
  createGoal: (body: { nombre: string; monto: number; fecha: string; cuentaId: number | null; ahorrado?: number }) =>
    request<Meta[]>('/api/goals', json('POST', body)),
  updateGoal: (id: number, body: { nombre?: string; monto?: number; fecha?: string; cuentaId?: number | null; ahorrado?: number; abono?: number }) =>
    request<Meta[]>(`/api/goals/${id}`, json('PATCH', body)),
  deleteGoal: (id: number) => request<Meta[]>(`/api/goals/${id}`, json('DELETE')),
  scenarios: () => request<Escenario[]>('/api/scenarios'),
  saveScenario: (nombre: string, escenario: Escenario['escenario']) => request<Escenario[]>('/api/scenarios', json('POST', { nombre, escenario })),
  deleteScenario: (id: number) => request<Escenario[]>(`/api/scenarios/${id}`, json('DELETE')),
};
