import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, ChartColumn, History, House, LogOut, RotateCcw, Sparkles, Target, type LucideIcon } from 'lucide-react';
import type { Cuenta, Hallazgos, Meta, Movimiento, ResultadoAcciones, Resumen } from '../shared/types';
import { api, SessionExpiredError } from './lib/api';
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported, notify } from './lib/notify';
import LoginPage from './components/LoginPage';
import InicioView from './components/InicioView';
import ChatView, { clearChatHistory } from './components/ChatView';
import CuentasView, { AccountSheet } from './components/CuentasView';
import HistorialView from './components/HistorialView';
import { TxSheet } from './components/TxRow';
import { ConfirmDialog, Sheet } from './components/Dialogs';

// Las gráficas (recharts) pesan: Análisis y Metas se cargan solo al abrirlas.
const AnalisisView = lazy(() => import('./components/AnalisisView'));
const MetasView = lazy(() => import('./components/MetasView'));

type Tab = 'inicio' | 'analisis' | 'aura' | 'metas' | 'historial' | 'cuentas';
type AnalisisPanel = 'resumen' | 'hallazgos' | 'comparar';

// Cuentas no va en la barra: se abre desde Inicio.
const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'inicio', label: 'Inicio', Icon: House },
  { id: 'analisis', label: 'Análisis', Icon: ChartColumn },
  { id: 'aura', label: 'Aura', Icon: Sparkles },
  { id: 'metas', label: 'Metas', Icon: Target },
  { id: 'historial', label: 'Movimientos', Icon: History },
];

const loadingScreen = (
  <div className="screen">
    <div className="skeleton" aria-label="Cargando…" />
  </div>
);

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
  const [analisisPanel, setAnalisisPanel] = useState<AnalisisPanel>('resumen');
  const [summary, setSummary] = useState<Resumen | null>(null);
  const [insights, setInsights] = useState<Hallazgos | null>(null);
  const [goals, setGoals] = useState<Meta[] | null>(null);
  const [notifOn, setNotifOn] = useState(notificationsEnabled);
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

  const loadInsights = useCallback(async () => {
    const h = await run(api.insights);
    if (h) setInsights(h);
  }, [run]);

  const loadGoals = useCallback(async () => {
    const g = await run(api.goals);
    if (g) setGoals(g);
  }, [run]);

  // Cada vez que entras a Análisis o Metas se recalculan los hallazgos (pudiste registrar gastos en el chat).
  useEffect(() => {
    if (tab === 'historial') void loadTransactions();
    if (tab === 'analisis' || tab === 'metas') void loadInsights();
    if (tab === 'metas') void loadGoals();
    window.scrollTo({ top: 0 });
  }, [tab, loadTransactions, loadInsights, loadGoals]);

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
    void notify(r.applied.alertas);
  }

  function go(to: Tab | 'hallazgos') {
    setAnalisisPanel(to === 'hallazgos' ? 'hallazgos' : 'resumen');
    setTab(to === 'hallazgos' ? 'analisis' : to);
  }

  async function toggleNotifications() {
    if (notifOn) {
      disableNotifications();
      setNotifOn(false);
      return;
    }
    const ok = await enableNotifications();
    setNotifOn(ok);
    if (!ok) setToast('El navegador no dio permiso. Puedes activarlo en los ajustes del sitio; las alertas igual salen dentro de la app.');
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
      setInsights(null);
      setGoals([]);
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
            onGo={go}
          />
        ) : tab === 'analisis' ? (
          <Suspense fallback={loadingScreen}>
            <AnalisisView
              summary={summary}
              insights={insights}
              onSummary={setSummary}
              onInsightsChanged={loadInsights}
              run={run}
              initialPanel={analisisPanel}
            />
          </Suspense>
        ) : tab === 'metas' ? (
          <Suspense fallback={loadingScreen}>
            <MetasView summary={summary} insights={insights} goals={goals} onGoals={setGoals} run={run} onAskAura={askAura} />
          </Suspense>
        ) : tab === 'cuentas' ? (
          <CuentasView summary={summary} onEdit={setEditingAccount} onBack={() => setTab('inicio')} />
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
            <button key={id} className="tab" onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined}>
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
            {notificationsSupported() && (
              <button className="menu-item" role="switch" aria-checked={notifOn} onClick={toggleNotifications}>
                {notifOn ? <Bell size={20} aria-hidden="true" /> : <BellOff size={20} aria-hidden="true" />}
                <span>
                  Avisos de presupuesto: {notifOn ? 'activos' : 'apagados'}
                  <small>
                    {notifOn
                      ? 'Te aviso en el celular cuando llegues al 80% de un presupuesto o te pases'
                      : 'Actívalos para recibir un aviso cuando te acerques a tus límites'}
                  </small>
                </span>
              </button>
            )}
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
                <small>Elimina movimientos, cuentas, presupuestos y metas</small>
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === 'logout' ? `¿Salir, ${user}?` : '¿Borrar todo?'}
          message={confirm === 'reset' ? 'Se borran todos tus movimientos, cuentas, presupuestos, metas y escenarios. Esto no se puede deshacer.' : undefined}
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
