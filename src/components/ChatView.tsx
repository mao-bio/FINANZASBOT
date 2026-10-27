import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Mic, Send, Square, Undo2, X } from 'lucide-react';
import type { MensajeHistorial, Movimiento, Resumen, RespuestaChat } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api, SessionExpiredError } from '../lib/api';
import { MAX_RECORDING_SECONDS, pickAudioMimeType, prepareReceiptPhoto, recordingToWav } from '../lib/media';
import { txSummary } from '../lib/labels';
import AnimatedCurrency from './AnimatedCurrency';

interface ChatMsg {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  thumb?: string;
  tx?: Movimiento;
  undone?: boolean;
  error?: boolean;
}

const STORAGE_KEY = 'fb_chat_v2';
const SUGGESTIONS = ['¿Cuánto tengo?', '¿Cómo voy este mes?', '¿En qué gasto más?', 'Dame un consejo para ahorrar'];

const newId = () => Math.random().toString(36).slice(2);

function welcome(user: string): ChatMsg {
  return {
    id: 'welcome',
    sender: 'bot',
    text:
      `¡Hola ${user}! Soy Aura 💸 Cuéntame tus movimientos como le hablarías a un amigo: ` +
      '"gasté 20 mil en almuerzo con Nequi", "me llegó la quincena", "pasé 100 mil a ahorros". ' +
      'También me puedes mandar una nota de voz 🎤 o la foto de un recibo 📷.',
  };
}

function loadMessages(user: string): ChatMsg[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    /* sin almacenamiento disponible */
  }
  return [welcome(user)];
}

function saveMessages(messages: ChatMsg[]) {
  try {
    // Sin miniaturas para no llenar el almacenamiento del celular
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60).map(({ thumb: _thumb, ...m }) => m)));
  } catch {
    /* sin almacenamiento disponible */
  }
}

export function clearChatHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sin almacenamiento disponible */
  }
}

function toHistory(messages: ChatMsg[]): MensajeHistorial[] {
  return messages
    .filter((m) => (m.sender === 'user' || m.sender === 'bot') && m.id !== 'welcome')
    .slice(-8)
    .map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }));
}

export default function ChatView(props: {
  user: string;
  summary: Resumen | null;
  onResult: (r: RespuestaChat) => void;
  onUndo: (id: number) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const { user, summary, onResult, onUndo, onSessionExpired } = props;
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadMessages(user));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cancelledRef = useRef(false);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_RECORDING_SECONDS) stopRecording();
  }, [recording, seconds]);

  const push = (...msgs: ChatMsg[]) => setMessages((prev) => [...prev, ...msgs]);

  async function send(payload: { message?: string; audio?: string; image?: string }, userMsg: ChatMsg) {
    const history = toHistory(messagesRef.current);
    push(userMsg);
    setBusy(true);
    try {
      const r = await api.chat({ ...payload, history });
      if (r.transcript) {
        setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, text: `🎤 "${r.transcript}"` } : m)));
      }
      const extras: ChatMsg[] = [
        ...r.applied.movimientos.map((tx) => ({ id: newId(), sender: 'system' as const, text: txSummary(tx), tx })),
        ...r.applied.cuentasCreadas.map((nombre) => ({ id: newId(), sender: 'system' as const, text: `🆕 Nueva cuenta: ${nombre}` })),
        ...r.applied.presupuestos.map((p) => ({
          id: newId(),
          sender: 'system' as const,
          text: `🎯 Presupuesto de ${p.categoria}: ${fmtCOP(p.monto)} al mes`,
        })),
      ];
      push({ id: newId(), sender: 'bot', text: r.reply }, ...extras);
      onResult(r);
    } catch (err) {
      if (err instanceof SessionExpiredError) return onSessionExpired();
      push({ id: newId(), sender: 'system', error: true, text: `❌ ${err instanceof Error ? err.message : 'No se pudo enviar.'}` });
    } finally {
      setBusy(false);
    }
  }

  function sendText(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    void send({ message }, { id: newId(), sender: 'user', text: message });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendText(input);
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    const note = input.trim();
    setInput('');
    try {
      const { image, thumb } = await prepareReceiptPhoto(file);
      await send({ image, message: note }, { id: newId(), sender: 'user', text: note || '📷 Foto de recibo', thumb });
    } catch {
      push({ id: newId(), sender: 'system', error: true, text: '❌ No pude abrir esa foto. Intenta con otra.' });
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      push({ id: newId(), sender: 'system', error: true, text: '❌ Tu navegador no permite grabar audio. Escríbeme el movimiento.' });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      push({ id: newId(), sender: 'system', error: true, text: '❌ No tengo permiso para usar el micrófono. Actívalo en los ajustes del navegador.' });
      return;
    }
    const mimeType = pickAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    cancelledRef.current = false;
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelledRef.current || !chunks.length) return;
      const userMsg: ChatMsg = { id: newId(), sender: 'user', text: '🎤 Nota de voz…' };
      try {
        const audio = await recordingToWav(new Blob(chunks, { type: recorder.mimeType }));
        await send({ audio }, userMsg);
      } catch {
        push({ id: newId(), sender: 'system', error: true, text: '❌ No pude procesar la nota de voz. Intenta otra vez.' });
      }
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setRecording(true);
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  }

  function cancelRecording() {
    cancelledRef.current = true;
    stopRecording();
  }

  async function undo(msg: ChatMsg) {
    if (!msg.tx) return;
    try {
      await onUndo(msg.tx.id);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, undone: true } : m)));
    } catch (err) {
      if (err instanceof SessionExpiredError) return onSessionExpired();
      push({ id: newId(), sender: 'system', error: true, text: `❌ ${err instanceof Error ? err.message : 'No se pudo deshacer.'}` });
    }
  }

  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="web-chat-layout">
      <div className="web-chat-main">
        {summary && (
          <div className="chat-balance-strip" aria-label="Resumen de saldos">
            <span>
              Tienes <strong>{fmtCOP(summary.totales.tienes)}</strong>
            </span>
            {summary.totales.debes > 0 && (
              <span>
                Debes <strong className="debt">{fmtCOP(summary.totales.debes)}</strong>
              </span>
            )}
          </div>
        )}

        <div className="web-chat-messages" aria-live="polite">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
              {msg.sender === 'bot' && (
                <div className="bot-avatar" aria-hidden="true">
                  A
                </div>
              )}
              <div
                className={`chat-bubble ${msg.sender}${msg.sender === 'system' ? (msg.error ? ' error' : ' success') : ''}${msg.undone ? ' undone' : ''}`}
              >
                {msg.thumb && <img className="chat-thumb" src={msg.thumb} alt="Foto del recibo" />}
                <span>{msg.tx ? `${msg.undone ? '↩️ Deshecho: ' : '✅ '}${msg.text}` : msg.text}</span>
                {msg.tx && !msg.undone && (
                  <button className="undo-btn" onClick={() => undo(msg)} aria-label="Deshacer este movimiento">
                    <Undo2 size={14} /> Deshacer
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="chat-bubble-wrapper bot">
              <div className="bot-avatar" aria-hidden="true">
                A
              </div>
              <div className="chat-bubble bot">
                <div className="typing-indicator" aria-label="Aura está pensando">
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="suggestion-row" role="list">
          {SUGGESTIONS.map((s) => (
            <button key={s} role="listitem" className="suggestion-chip" onClick={() => sendText(s)} disabled={busy || recording}>
              {s}
            </button>
          ))}
        </div>

        <div className="web-chat-input-bar">
          {recording ? (
            <div className="recording-status">
              <button type="button" className="icon-btn" onClick={cancelRecording} aria-label="Cancelar grabación">
                <X size={20} />
              </button>
              <span className="recording-dot-active" aria-hidden="true"></span>
              <span className="recording-label">
                Grabando {timer} <small>/ 1:00</small>
              </span>
              <button type="button" className="mic-btn recording" onClick={stopRecording} aria-label="Detener y enviar">
                <Square size={18} />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="mic-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                aria-label="Tomar foto de un recibo"
                title="Foto de un recibo"
              >
                <Camera size={20} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  void handlePhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button type="button" className="mic-btn" onClick={startRecording} disabled={busy} aria-label="Grabar nota de voz" title="Nota de voz">
                <Mic size={20} />
              </button>
              <form onSubmit={handleSubmit} className="chat-input-form">
                <input
                  type="text"
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ej: gasté 20 mil en almuerzo"
                  aria-label="Mensaje para Aura"
                  autoComplete="off"
                  enterKeyHint="send"
                  maxLength={1000}
                  disabled={busy}
                />
                <button type="submit" className="btn-send" disabled={busy || !input.trim()} aria-label="Enviar mensaje">
                  <Send size={18} />
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <aside className="web-chat-aside">
        <div className="premium-panel aside-panel">
          {summary && (
            <>
              <div className="aside-balance-chip">
                <span className="aside-balance-label">Tienes disponible</span>
                <AnimatedCurrency value={summary.totales.tienes} className="aside-balance-value" />
              </div>
              {summary.totales.debes > 0 && (
                <div className="aside-balance-chip debt">
                  <span className="aside-balance-label">Debes en tarjetas</span>
                  <AnimatedCurrency value={summary.totales.debes} className="aside-balance-value" />
                </div>
              )}
            </>
          )}
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <h2>Pregúntale a Aura</h2>
          </div>
          <div className="aside-actions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="quick-action-btn" onClick={() => sendText(s)} disabled={busy || recording}>
                {s}
              </button>
            ))}
          </div>
          <div className="aside-tips">
            <p className="aside-tips-title">💡 Así le puedes hablar</p>
            <ul>
              <li>"Almuerzo 18 mil y bus 3 mil"</li>
              <li>"Ayer pagué 45 mil de gasolina con la tarjeta"</li>
              <li>"Tengo 350 mil en Nequi"</li>
              <li>"Pagué 500 mil de la tarjeta desde Bancolombia"</li>
              <li>"Ponme 600 mil de presupuesto para comida"</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
