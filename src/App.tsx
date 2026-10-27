import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BarChart3, History, LogOut, MessageSquare, Wallet } from 'lucide-react';
import type { Movimiento, Resumen, RespuestaChat } from '../shared/types';
import { api, SessionExpiredError } from './lib/api';
import LoginPage from './components/LoginPage';
import ChatView, { clearChatHistory } from './components/ChatView';
import CuentasView from './components/CuentasView';
import HistorialView from './components/HistorialView';
import { ConfirmDialog } from './components/Dialogs';

// Las gráficas (recharts) pesan: se cargan solo al abrir Resumen.
const ResumenView = lazy(() => import('./components/ResumenView'));

type Tab = 'chat' | 'cuentas' | 'resumen' | 'historial';

const TABS: { id: Tab; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Aura', Icon: MessageSquare },
  { id: 'cuentas', label: 'Cuentas', Icon: Wallet },
  { id: 'resumen', label: 'Resumen', Icon: BarChart3 },
  { id: 'historial', label: 'Historial', Icon: History },
];

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .session()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="boot-screen">
        <span className="spinner" aria-label="Cargando…" />
      </div>
    );
  }
  if (!user) return <LoginPage onLoginSuccess={setUser} />;
  return <Home user={user} onLoggedOut={() => setUser(null)} />;
}

const byDateDesc = (a: Movimiento, b: Movimiento) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id);

function Home({ user, onLoggedOut }: { user: string; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [summary, setSummary] = useState<Resumen | null>(null);
  const [transactions, setTransactions] = useState<Movimiento[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const endSession = useCallback(() => {
    clearChatHistory();
    onLoggedOut();
  }, [onLoggedOut]);

  /** Ejecuta una llamada a la API mostrando el error en un aviso si falla. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof SessionExpiredError) endSession();
        else setToast(err instanceof Error ? err.message : 'Algo salió mal.');
        return undefined;
      }
    },
    [endSession],
  );

  const loadTransactions = useCallback(async () => {
    const list = await run(api.transactions);
    if (list) setTransactions(list);
  }, [run]);

  useEffect(() => {
    void run(api.summary).then((s) => s && setSummary(s));
    void loadTransactions();
  }, [run, loadTransactions]);

  useEffect(() => {
    if (tab === 'historial') void loadTransactions();
  }, [tab, loadTransactions]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleChatResult(r: RespuestaChat) {
    setSummary(r.summary);
    if (r.applied.movimientos.length) {
      setTransactions((prev) => [...r.applied.movimientos, ...prev].sort(byDateDesc));
    }
  }

  async function deleteTransaction(id: number) {
    const res = await api.deleteTransaction(id);
    setSummary(res.summary);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    endSession();
  }

  return (
    <div className="main-app-container">
      <nav className="app-navbar">
        <div className="logo-section">
          <h1>FinanzasBot 💸</h1>
          <span>AURA · CLOUDFLARE AI</span>
        </div>
        <div className="nav-tabs" role="tablist">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`nav-tab-btn ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="user-badge">
          <span className="user-name">{user}</span>
          <button className="logout-btn" onClick={() => setConfirmLogout(true)} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <main className="tab-content" key={tab}>
        {tab === 'chat' && (
          <ChatView
            user={user}
            summary={summary}
            onResult={handleChatResult}
            onUndo={deleteTransaction}
            onSessionExpired={endSession}
          />
        )}
        {tab !== 'chat' && !summary && <div className="chart-skeleton" aria-label="Cargando…" />}
        {tab === 'cuentas' && summary && <CuentasView summary={summary} onSummary={setSummary} run={run} />}
        {tab === 'resumen' && summary && (
          <Suspense fallback={<div className="chart-skeleton" aria-label="Cargando…" />}>
            <ResumenView summary={summary} onSummary={setSummary} run={run} />
          </Suspense>
        )}
        {tab === 'historial' && (
          <HistorialView
            transactions={transactions}
            onDelete={async (id) => {
              await run(() => deleteTransaction(id));
            }}
            onReset={async () => {
              const res = await run(api.reset);
              if (res) {
                setSummary(res.summary);
                setTransactions([]);
                clearChatHistory();
              }
            }}
          />
        )}
      </main>

      <nav className="bottom-tab-bar" aria-label="Navegación principal">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`bottom-tab-btn ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {confirmLogout && (
        <ConfirmDialog
          title={`¿Seguro que quieres salir, ${user}?`}
          confirmLabel="Sí, salir"
          onConfirm={logout}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
