'use client';

import React, { useState, useEffect, useRef } from 'react';
import LoginPage from './components/LoginPage';
import { 
  MessageSquare, 
  BarChart3, 
  History, 
  Mic, 
  MicOff, 
  Send, 
  Search, 
  LogOut, 
  User, 
  Trash2,
  X,
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  Wallet
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';

interface Transaction {
  id: string;
  tipo: string;
  monto: number;
  categoria: string;
  descripcion: string;
  created_at: string;
}

interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  audioUrl?: string; // Optional URL for locally recorded message preview
}

export default function Home() {
  const [username, setUsername] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard' | 'history'>('chat');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: '¡Hola parce! Soy Aura, tu coach financiero. 🤑 ¿En qué te puedo colaborar hoy? Puedes escribirme o enviarme notas de voz contándome tus movimientos. Por ejemplo: "gasté 80 mil en mercado" o "recibí 2 millones de salario". ¡Aquí estoy para ayudarte!',
    },
  ]);
  
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Audio Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // History Tab States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('todos');
  const [filterCategory, setFilterCategory] = useState('todas');

  useEffect(() => {
    setMounted(true);
    // Check local storage for authenticated user
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      setUsername(savedUser);
    }
  }, []);

  useEffect(() => {
    if (username) {
      fetchTransactions();
    }
  }, [username]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Audio Recording Timer
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      setRecordingTime(0);
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording]);

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/api/transactions');
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  };

  // Recording Handlers
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        alert('Tu navegador no soporta grabación de audio.');
        return;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
      });
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlob(audioBlob);
        setAudioUrl(url);
        // Stop all tracks on the stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(200); // chunk every 200ms
      setIsRecording(true);
      setAudioBlob(null);
      setAudioUrl(null);
    } catch (err) {
      console.error('Error starting audio recording:', err);
      alert('No se pudo acceder al micrófono. Por favor permite el acceso en tu navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // Temporarily overwrite onstop to clear chunks
      mediaRecorderRef.current.onstop = () => {
        audioChunksRef.current = [];
        setAudioBlob(null);
        setAudioUrl(null);
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      // Just clear preview if stopped
      setAudioBlob(null);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(null);
    }
  };

  const handleSendMessage = async (textToSend: string, blobToSend: Blob | null = null) => {
    if (!textToSend.trim() && !blobToSend) return;

    const userMessageId = Math.random().toString();
    const newUserMsg: Message = {
      id: userMessageId,
      sender: 'user',
      text: textToSend || (blobToSend ? '🎤 Nota de voz enviada' : ''),
      audioUrl: audioUrl || undefined
    };

    setMessages((prev) => [...prev, newUserMsg]);
    setInput('');
    // Clear recording states
    setAudioBlob(null);
    setAudioUrl(null);
    setIsTyping(true);

    try {
      let res;
      if (blobToSend) {
        const formData = new FormData();
        formData.append('audio', blobToSend, 'recording.webm');
        if (textToSend.trim()) {
          formData.append('message', textToSend);
        }

        res = await fetch('/api/chat', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: textToSend }),
        });
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fallo al procesar el chat');
      }

      const data = await res.json();

      const botMessage: Message = {
        id: Math.random().toString(),
        sender: 'bot',
        text: data.reply || 'No obtuve respuesta del coach.',
      };

      setMessages((prev) => [...prev, botMessage]);

      if (data.transaction) {
        // Append transaction and update local history
        setTransactions((prev) => [data.transaction, ...prev]);
        
        const systemMsg: Message = {
          id: Math.random().toString(),
          sender: 'system',
          text: `✅ Registrado: ${data.transaction.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} por ${formatCurrency(Number(data.transaction.monto))} en "${data.transaction.categoria}"`,
        };
        setMessages((prev) => [...prev, systemMsg]);
      }
    } catch (err: any) {
      let errorText = err.message || 'No se pudo conectar con el servidor.';
      // Extract readable message from JSON error strings
      try {
        const match = errorText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          errorText = parsed?.error?.message || parsed?.message || errorText;
        }
      } catch { /* keep original */ }
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'system',
          text: `❌ ${errorText}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(input, audioBlob);
  };

  const handleDeleteTransaction = async (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDeleteAction = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        setMessages((prev) => [
          ...prev,
          { id: Math.random().toString(), sender: 'system', text: '🗑️ Transacción eliminada correctamente.' },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: Math.random().toString(), sender: 'system', text: '❌ No se pudo eliminar la transacción.' },
        ]);
      }
    } catch {
      console.error('Error deleting transaction');
    }
  };

  const handleLoginSuccess = (user: string) => {
    setUsername(user);
    localStorage.setItem('user', user);
  };

  const handleLogout = () => {
    setConfirmLogout(true);
  };

  const confirmLogoutAction = () => {
    setUsername(null);
    setConfirmLogout(false);
    localStorage.removeItem('user');
    setMessages([
      {
        id: 'welcome',
        sender: 'bot',
        text: '¡Hola parce! Soy Aura, tu coach financiero. 🤑 ¿En qué te puedo colaborar hoy? Puedes escribirme o enviarme notas de voz contándome tus movimientos. Por ejemplo: "gasté 80 mil en mercado" o "recibí 2 millones de salario". ¡Aquí estoy para ayudarte!',
      },
    ]);
    setTransactions([]);
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/reset', { method: 'DELETE' });
      if (res.ok) {
        setTransactions([]);
        setConfirmReset(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            sender: 'system',
            text: '🔄 Historial reiniciado. Todos los gastos y balance han sido borrados. ¡Empezamos de cero, parce!',
          },
        ]);
      } else {
        const data = await res.json();
        alert('Error al reiniciar: ' + (data.error || 'Error desconocido'));
      }
    } catch (err: any) {
      alert('Error al conectar con el servidor.');
    } finally {
      setIsResetting(false);
    }
  };

  // Formatting utilities
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Sin fecha';
    try {
      const d = new Date(dateStr);
      // Guard against invalid dates (epoch 0 or NaN)
      if (isNaN(d.getTime()) || d.getFullYear() < 2000) return 'Sin fecha';
      return d.toLocaleDateString('es-CO', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Sin fecha';
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Math calculations
  const totalIncome = transactions
    .filter((t) => t.tipo === 'ingreso')
    .reduce((sum, t) => sum + Number(t.monto), 0);

  const totalExpenses = transactions
    .filter((t) => t.tipo === 'gasto' || t.tipo === 'egreso')
    .reduce((sum, t) => sum + Number(t.monto), 0);

  const currentBalance = totalIncome - totalExpenses;

  // Recharts flow data
  const flowData = [
    { name: 'Ingresos', monto: totalIncome },
    { name: 'Gastos', monto: totalExpenses }
  ];

  // Recharts pie data (expenses grouped by category)
  const categoryExpenses = transactions
    .filter((t) => t.tipo === 'gasto' || t.tipo === 'egreso')
    .reduce((acc: { [key: string]: number }, tx) => {
      const cat = tx.categoria || 'Otros';
      acc[cat] = (acc[cat] || 0) + Number(tx.monto);
      return acc;
    }, {});

  const pieData = Object.keys(categoryExpenses).map((cat) => ({
    name: cat,
    value: categoryExpenses[cat]
  }));

  // Pie chart colors
  const COLORS = ['#00e5a0', '#3b82f6', '#ff4a5a', '#a855f7', '#f97316', '#eab308', '#ec4899', '#14b8a6'];

  // History filtering
  const uniqueCategories = Array.from(new Set(transactions.map((t) => t.categoria || 'Otros')));

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = 
      (tx.descripcion || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (tx.categoria || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesType = 
      filterType === 'todos' 
        ? true 
        : filterType === 'ingreso' 
          ? tx.tipo === 'ingreso' 
          : (tx.tipo === 'gasto' || tx.tipo === 'egreso');

    const matchesCategory = 
      filterCategory === 'todas' 
        ? true 
        : (tx.categoria || 'Otros') === filterCategory;

    return matchesSearch && matchesType && matchesCategory;
  });

  // If not authenticated, render Login Page
  if (!username) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="main-app-container">
      {/* Reset Confirmation Modal */}
      {confirmReset && (
        <div className="logout-confirm-overlay">
          <div className="logout-confirm-dialog">
            <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>⚠️ ¿Reiniciar todo?</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Se borrarán <strong>todos</strong> los gastos, ingresos y ahorros registrados. Esta acción no se puede deshacer.
            </p>
            <div className="logout-confirm-actions">
              <button className="btn-cancel-logout" onClick={() => setConfirmReset(false)} disabled={isResetting}>Cancelar</button>
              <button
                className="btn-confirm-logout"
                style={{ background: 'var(--accent-red)' }}
                onClick={handleReset}
                disabled={isResetting}
              >
                {isResetting ? 'Borrando...' : '🗑️ Sí, reiniciar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Transaction Confirmation Modal */}
      {confirmDeleteId && (
        <div className="logout-confirm-overlay">
          <div className="logout-confirm-dialog">
            <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>🗑️ ¿Eliminar transacción?</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Esta acción no se puede deshacer.
            </p>
            <div className="logout-confirm-actions">
              <button className="btn-cancel-logout" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
              <button
                className="btn-confirm-logout"
                style={{ background: 'var(--accent-red)' }}
                onClick={confirmDeleteAction}
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {confirmLogout && (
        <div className="logout-confirm-overlay">
          <div className="logout-confirm-dialog">
            <p>¿Seguro que quieres salir, {username}?</p>
            <div className="logout-confirm-actions">
              <button className="btn-cancel-logout" onClick={() => setConfirmLogout(false)}>Cancelar</button>
              <button className="btn-confirm-logout" onClick={confirmLogoutAction}>Sí, salir</button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Glassmorphic Navbar */}
      <nav className="app-navbar">
        <div className="logo-section">
          <h1>FinanzasBot 💸</h1>
          <span>AURA COACH v2.0</span>
        </div>

        <div className="nav-tabs">
          <button 
            className={`nav-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={18} />
            <span>Aura Coach</span>
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <BarChart3 size={18} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={18} />
            <span>Historial</span>
          </button>
        </div>

        <div className="user-badge">
          <div className="user-info">
            <span className="user-name">{username}</span>
            <span className="user-role">Administrador</span>
          </div>
          <button className="logout-btn" id="logout-btn" onClick={handleLogout} title="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {/* Main Tab Contents */}
      <main className="tab-content">
        
        {/* ========================================================
            💬 TAB 1: CHAT CON AURA & VOZ
            ======================================================== */}
        {activeTab === 'chat' && (
          <div className="web-chat-layout">
            <div className="web-chat-main">
              <div className="web-chat-messages">
                {messages.map((msg) => (
                  <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
                    {msg.sender === 'bot' && (
                      <div className="bot-avatar" aria-hidden="true">A</div>
                    )}
                    <div className={`chat-bubble ${msg.sender}${msg.sender === 'system' ? (msg.text.startsWith('❌') ? ' error' : ' success') : ''}`}>
                      {msg.text}
                      {msg.audioUrl && (
                        <div style={{ marginTop: '8px' }}>
                          <audio src={msg.audioUrl} controls style={{ width: '100%', maxHeight: '36px' }} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {isTyping && (
                  <div className="chat-bubble bot">
                    <div className="typing-indicator">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat controller input bar */}
              <div className="web-chat-input-bar">
                
                {/* Voice button */}
                {!isRecording && !audioBlob && (
                  <button 
                    type="button" 
                    className="mic-btn" 
                    onClick={startRecording} 
                    title="Grabar nota de voz"
                    disabled={isTyping}
                  >
                    <Mic size={20} />
                  </button>
                )}

                {/* Recording indicator */}
                {isRecording && (
                  <div className="recording-status">
                    <span className="recording-dot-active"></span>
                    <span>Grabando audio: {formatTimer(recordingTime)}</span>
                    <button type="button" className="mic-btn recording" onClick={stopRecording} title="Detener grabación">
                      <Square size={18} />
                    </button>
                  </div>
                )}

                {/* Local audio preview before sending */}
                {audioBlob && !isRecording && (
                  <div className="voice-preview-wrapper">
                    <audio src={audioUrl || ''} controls />
                    <button type="button" className="cancel-record-btn" onClick={cancelRecording} title="Eliminar nota">
                      <X size={18} />
                    </button>
                  </div>
                )}

                {/* Text Form */}
                {!isRecording && (
                  <form onSubmit={handleSendText} className="chat-input-form" style={{ flex: 1 }}>
                    <input
                      type="text"
                      className="chat-input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={audioBlob ? "Agrega un mensaje de texto (opcional)..." : "Dile algo a Aura o dile tus gastos..."}
                      autoComplete="off"
                      disabled={isTyping}
                    />
                    <button
                      type="submit"
                      className="btn-send"
                      disabled={isTyping || (!input.trim() && !audioBlob)}
                      aria-label="Enviar mensaje"
                    >
                      <Send size={18} />
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Aside contextual information / suggestions */}
            <aside className="web-chat-aside">
              <div className="premium-panel" style={{ height: '100%' }}>
                <div className="aside-balance-chip">
                  <span className="aside-balance-label">Saldo actual</span>
                  <span className="aside-balance-value">{formatCurrency(currentBalance)}</span>
                </div>
                <div className="panel-header" style={{ marginBottom: '14px' }}>
                  <h2>Acciones Rápidas</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button 
                    className="quick-action-btn" 
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '12px' }}
                    onClick={() => handleSendMessage('¿Cuánto tengo?')}
                  >
                    💰 ¿Cuánto tengo?
                  </button>
                  <button 
                    className="quick-action-btn" 
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '12px' }}
                    onClick={() => handleSendMessage('¿En qué gasto más?')}
                  >
                    📊 ¿En qué gasto más?
                  </button>
                  <button 
                    className="quick-action-btn" 
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '12px' }}
                    onClick={() => handleSendMessage('Resumen de ingresos y gastos')}
                  >
                    📅 Resumen general
                  </button>
                  <button
                    className="quick-action-btn"
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '12px' }}
                    onClick={() => handleSendMessage('Consejo de ahorro para hoy')}
                  >
                    💡 Consejo de ahorro
                  </button>

                  <button
                    className="quick-action-btn"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      borderRadius: '12px',
                      marginTop: '8px',
                      borderColor: 'rgba(255,74,90,0.4)',
                      color: 'var(--accent-red)',
                    }}
                    onClick={() => setConfirmReset(true)}
                  >
                    🔄 Reiniciar gastos y balance
                  </button>
                </div>

                <div style={{ marginTop: '24px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <p style={{ fontWeight: '600', color: '#fff', marginBottom: '6px' }}>💡 Tips de notas de voz:</p>
                  <p>Presiona el micrófono, di por ejemplo: <i>"A Aura, metí cincuenta mil pesos por almuerzos"</i>, y presiona detener. Luego envíalo de una.</p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ========================================================
            📊 TAB 2: ANALYTICAL DASHBOARD
            ======================================================== */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Cards row */}
            <div className="dashboard-grid">
              <div className="summary-card balance">
                <div>
                  <div className="card-label">Saldo Disponible</div>
                  <div className="card-value">{formatCurrency(currentBalance)}</div>
                </div>
                <Wallet size={32} color="var(--accent-blue)" />
              </div>

              <div className="summary-card income">
                <div>
                  <div className="card-label">Total Ingresos</div>
                  <div className="card-value">{formatCurrency(totalIncome)}</div>
                </div>
                <TrendingUp size={32} color="var(--accent-green)" />
              </div>

              <div className="summary-card expense">
                <div>
                  <div className="card-label">Total Gastos</div>
                  <div className="card-value">{formatCurrency(totalExpenses)}</div>
                </div>
                <TrendingDown size={32} color="var(--accent-red)" />
              </div>
            </div>

            {/* Charts section */}
            <div className="charts-section-grid">
              {/* Cash Flow */}
              <div className="premium-panel">
                <div className="panel-header">
                  <h2>Flujo de Caja COP</h2>
                </div>
                <div className="chart-container">
                  {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={flowData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                        <XAxis dataKey="name" stroke="var(--text-secondary)" />
                        <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => `${v / 1000}k`} />
                        <Tooltip 
                          formatter={(value) => [formatCurrency(Number(value)), 'Monto']}
                          contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
                        />
                        <Bar dataKey="monto" radius={[8, 8, 0, 0]}>
                          <Cell fill="var(--accent-green)" />
                          <Cell fill="var(--accent-red)" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div>Cargando gráfico...</div>
                  )}
                </div>
              </div>

              {/* Expense Distribution */}
              <div className="premium-panel">
                <div className="panel-header">
                  <h2>Distribución de Gastos</h2>
                </div>
                <div className="chart-container">
                  {mounted ? (
                    pieData.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip 
                              formatter={(value) => [formatCurrency(Number(value)), 'Gastado']}
                              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
                            />
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={70}
                              outerRadius={95}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="chart-center-label">
                          <span className="chart-center-value">{formatCurrency(totalExpenses)}</span>
                          <span className="chart-center-text">En Gastos</span>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">No hay gastos para clasificar.</div>
                    )
                  ) : (
                    <div>Cargando gráfico...</div>
                  )}
                </div>
              </div>
            </div>

            {/* Category summary details */}
            {pieData.length > 0 && (
              <div className="premium-panel" style={{ marginBottom: '24px' }}>
                <div className="panel-header">
                  <h2>Resumen por Categorías</h2>
                </div>
                <table className="category-table">
                  <thead>
                    <tr>
                      <th>Categoría</th>
                      <th className="category-value-col">Monto Gastado</th>
                      <th className="category-value-col">Porcentaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieData.map((item, index) => (
                      <tr key={item.name}>
                        <td>
                          <span 
                            className="category-dot" 
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          {item.name}
                        </td>
                        <td className="category-value-col">{formatCurrency(item.value)}</td>
                        <td className="category-value-col">
                          {((item.value / totalExpenses) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            📋 TAB 3: TRANSACTION HISTORIAL
            ======================================================== */}
        {activeTab === 'history' && (
          <div className="history-panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Historial Completo de Transacciones</h2>
              <button
                className="quick-action-btn"
                style={{ borderColor: 'rgba(255,74,90,0.4)', color: 'var(--accent-red)', padding: '6px 14px', fontSize: '0.8rem' }}
                onClick={() => setConfirmReset(true)}
              >
                🔄 Reiniciar todo
              </button>
            </div>

            {/* Search and filtering toolbar */}
            <div className="history-toolbar">
              <div className="search-input-wrapper">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Buscar por descripción o categoría..."
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="filter-group">
                <select 
                  className="filter-select"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="todos">Todos los Tipos</option>
                  <option value="ingreso">Ingresos</option>
                  <option value="gasto">Gastos</option>
                </select>

                <select 
                  className="filter-select"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="todas">Todas las Categorías</option>
                  {uniqueCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Table layout of history */}
            <div className="transaction-list">
              {filteredTransactions.length === 0 ? (
                <div className="empty-state">No se encontraron transacciones con los filtros seleccionados.</div>
              ) : (
                filteredTransactions.map((tx) => (
                  <div key={tx.id} className="transaction-item">
                    <div className="tx-info">
                      <div className="tx-desc">{tx.descripcion || 'Transacción'}</div>
                      <div className="tx-meta">
                        <span className="tx-cat">{tx.categoria}</span>
                        <span>•</span>
                        <span>{formatDate(tx.created_at)}</span>
                      </div>
                    </div>
                    <div className="tx-amount-section">
                      <span className={`tx-amount ${tx.tipo === 'ingreso' ? 'ingreso' : 'gasto'}`}>
                        {tx.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(Number(tx.monto))}
                      </span>
                      <button
                        className="btn-delete"
                        onClick={() => handleDeleteTransaction(tx.id)}
                        title="Eliminar transacción"
                        aria-label="Eliminar transacción"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Tab Bar — mobile only (hidden on desktop via CSS) */}
      <nav className="bottom-tab-bar" aria-label="Navegación principal">
        <button
          className={`bottom-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
          aria-current={activeTab === 'chat' ? 'page' : undefined}
        >
          <MessageSquare size={22} />
          Aura
        </button>
        <button
          className={`bottom-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
          aria-current={activeTab === 'dashboard' ? 'page' : undefined}
        >
          <BarChart3 size={22} />
          Dashboard
        </button>
        <button
          className={`bottom-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
          aria-current={activeTab === 'history' ? 'page' : undefined}
        >
          <History size={22} />
          Historial
        </button>
      </nav>
    </div>
  );
}
