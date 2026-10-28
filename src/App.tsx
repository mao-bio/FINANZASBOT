import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { ChartColumn, History, House, LogOut, RotateCcw, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import type { Cuenta, Movimiento, ResultadoAcciones, Resumen } from '../shared/types';
import { api, SessionExpiredError } from './lib/api';
import LoginPage from './components/LoginPage';
import InicioView from './components/InicioView';
import ChatView, { clearChatHistory } from './components/ChatView';
import CuentasView, { AccountSheet } from './components/CuentasView';
import HistorialView from './components/HistorialView';
import { TxSheet } from './components/TxRow';
import { ConfirmDialog, Sheet } from './components/Dialogs';

// Las gráficas (recharts) pesan: se cargan solo al abrir Resumen.
const ResumenView = lazy(() => import('./components/ResumenView'));

type Tab = 'inicio' | 'resumen' | 'aura' | 'cuentas' | 'historial';

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'inicio', label: 'Inicio', Icon: House },
  { id: 'resumen', label: 'Resumen', Icon: ChartColumn },
  { id: 'aura', label: 'Aura', Icon: Sparkles },
  { id: 'cuentas', label: 'Cuentas', Icon: Wallet },
  { id: 'historial', label: 'Movimientos', Icon: History },
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
      <div className="boot">
        <span className="spinner" aria-label="Cargando…" />
      </div>
    );
  }
  if (!user) return <LoginPage onLoginSuccess={setUser} />;
  return <Home user={user} onLoggedOut={() => setUser(null)} />;
}

const byDateDesc = (a: Movimiento, b: Movimiento) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id);

function Home({ user, onLoggedOut }: { user: string; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('inicio');
  const [summary, setSummary] = useState<Resumen | null>(null);
  const [transactions, setTransactions] = useState<Movimiento[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [auraPrompt, setAuraPrompt] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Cuenta | 'new' | null>(null);
  const [selectedTx, setSelectedTx] = useState<Movimiento | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirm, setConfirm] = useState<'logout' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);

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
    window.scrollTo({ top: 0 });
  }, [tab, loadTransactions]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  function handleChatResult(r: { applied: ResultadoAcciones; summary: Resumen }) {
    setSummary(r.summary);
    if (r.applied.movimientos.length) {
      setTransactions((prev) => [...r.applied.movimientos, ...prev].sort(byDateDesc));
    }
  }

  async function deleteTransaction(id: number): Promise<boolean> {
    const res = await run(() => api.deleteTransaction(id));
    if (!res) return false;
    setSummary(res.summary);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    return true;
  }

  function askAura(prompt?: string) {
    setAuraPrompt(prompt ?? null);
    setTab('aura');
  }

  async function confirmAction() {
    setBusy(true);
    if (confirm === 'logout') {
      await api.logout().catch(() => undefined);
      endSession();
      return;
    }
    const res = await run(api.reset);
    setBusy(false);
    setConfirm(null);
    setProfileOpen(false);
    if (res) {
      setSummary(res.summary);
      setTransactions([]);
      clearChatHistory();
      setTab('inicio');
    }
  }

  return (
    <div className="app">
      <main key={tab}>
        {tab === 'aura' ? (
          <ChatView
            user={user}
            summary={summary}
            initialPrompt={auraPrompt}
            onPromptUsed={() => setAuraPrompt(null)}
            onResult={handleChatResult}
            onUndo={deleteTransaction}
            onSessionExpired={endSession}
          />
        ) : !summary ? (
          <div className="screen">
            <div className="skeleton" aria-label="Cargando…" />
            <div className="skeleton" />
          </div>
        ) : tab === 'inicio' ? (
          <InicioView
            user={user}
            summary={summary}
            recent={transactions}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenAccount={setEditingAccount}
            onOpenTx={setSelectedTx}
            onAskAura={askAura}
            onGo={setTab}
          />
        ) : tab === 'resumen' ? (
          <Suspense
            fallback={
              <div className="screen">
                <div className="skeleton" aria-label="Cargando…" />
              </div>
            }
          >
            <ResumenView summary={summary} onSummary={setSummary} run={run} />
          </Suspense>
        ) : tab === 'cuentas' ? (
          <CuentasView summary={summary} onEdit={setEditingAccount} />
        ) : (
          <HistorialView transactions={transactions} onOpenTx={setSelectedTx} />
        )}
      </main>

      <nav className="tabbar" aria-label="Navegación principal">
        {TABS.map(({ id, label, Icon }) =>
          id === 'aura' ? (
            <button key={id} className="tab tab-fab" onClick={() => askAura()} aria-current={tab === id ? 'page' : undefined} aria-label="Hablar con Aura">
              <span className="fab">
                <Icon size={26} aria-hidden="true" />
              </span>
              {label}
            </button>
          ) : (
            <button key={id} className="tab" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <span className="tab-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              {label}
            </button>
          ),
        )}
      </nav>

      {editingAccount && (
        <AccountSheet
          cuenta={editingAccount === 'new' ? null : editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={(s) => {
            setSummary(s);
            setEditingAccount(null);
            void loadTransactions();
          }}
          run={run}
        />
      )}

      {selectedTx && <TxSheet m={selectedTx} onClose={() => setSelectedTx(null)} onDelete={async (id) => void (await deleteTransaction(id))} />}

      {profileOpen && (
        <Sheet title={user} onClose={() => setProfileOpen(false)}>
          <div className="menu-list">
            <button className="menu-item" onClick={() => setConfirm('logout')}>
              <LogOut size={20} aria-hidden="true" />
              <span>
                Cerrar sesión
                <small>Tus datos quedan guardados en Cloudflare</small>
              </span>
            </button>
            <button className="menu-item danger" onClick={() => setConfirm('reset')}>
              <RotateCcw size={20} aria-hidden="true" />
              <span>
                Borrar todo y empezar de cero
                <small>Elimina movimientos, cuentas y presupuestos</small>
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === 'logout' ? `¿Salir, ${user}?` : '¿Borrar todo?'}
          message={confirm === 'reset' ? 'Se borran todos tus movimientos, cuentas y presupuestos. Esto no se puede deshacer.' : undefined}
          confirmLabel={confirm === 'logout' ? 'Salir' : 'Borrar todo'}
          danger={confirm === 'reset'}
          icon={confirm === 'logout' ? LogOut : RotateCcw}
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
