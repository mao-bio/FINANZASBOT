import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Camera,
  ChartPie,
  CircleAlert,
  CircleCheck,
  Lightbulb,
  Mic,
  Send,
  Sparkles,
  Square,
  Target,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { MensajeHistorial, Movimiento, Resumen, RespuestaChat } from '../../shared/types';
import { fmtCOP } from '../../shared/format';
import { api, SessionExpiredError } from '../lib/api';
import { MAX_RECORDING_SECONDS, pickAudioMimeType, prepareReceiptPhoto, recordingToWav } from '../lib/media';
import { TxRow } from './TxRow';

type ChatMsg =
  | { id: string; kind: 'user'; text: string; thumb?: string }
  | { id: string; kind: 'bot'; text: string }
  | { id: string; kind: 'tx'; tx: Movimiento; undone?: boolean }
  | { id: string; kind: 'note'; text: string; tone: 'cuenta' | 'presupuesto' | 'error' };

const STORAGE_KEY = 'fb_chat_v3';
const SUGGESTIONS = ['¿Cuánto tengo?', '¿Cómo voy este mes?', '¿En qué gasto más?', 'Dame un consejo para ahorrar'];
const PROMPTS: { text: string; Icon: LucideIcon }[] = [
  { text: '¿Cuánto tengo?', Icon: Wallet },
  { text: '¿En qué gasto más este mes?', Icon: ChartPie },
  { text: '¿Cómo voy con mis presupuestos?', Icon: Target },
  { text: 'Dame un consejo para ahorrar', Icon: Lightbulb },
];
const NOTE_ICONS: Record<'cuenta' | 'presupuesto' | 'error', LucideIcon> = {
  cuenta: Wallet,
  presupuesto: Target,
  error: CircleAlert,
};

const newId = () => Math.random().toString(36).slice(2);

function loadMessages(): ChatMsg[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) return saved;
  } catch {
    /* sin almacenamiento disponible */
  }
  return [];
}

function saveMessages(messages: ChatMsg[]) {
  try {
    // Sin miniaturas para no llenar el almacenamiento del celular
    const slim = messages.slice(-60).map((m) => (m.kind === 'user' ? { ...m, thumb: undefined } : m));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
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
    .filter((m): m is Extract<ChatMsg, { kind: 'user' | 'bot' }> => m.kind === 'user' || m.kind === 'bot')
    .slice(-8)
    .map((m) => ({ role: m.kind === 'user' ? 'user' : 'assistant', content: m.text }));
}

export default function ChatView(props: {
  user: string;
  summary: Resumen | null;
  initialPrompt: string | null;
  onPromptUsed: () => void;
  onResult: (r: RespuestaChat) => void;
  onUndo: (id: number) => Promise<boolean>;
  onSessionExpired: () => void;
}) {
  const { user, summary, onResult, onUndo, onSessionExpired } = props;
  const [messages, setMessages] = useState<ChatMsg[]>(loadMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cancelledRef = useRef(false);
  const messagesRef = useRef(messages);
  const promptSentRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  // Pregunta que llega desde otra pantalla (ej. "Hablar con Aura" en Inicio)
  useEffect(() => {
    if (props.initialPrompt && !promptSentRef.current) {
      promptSentRef.current = true;
      sendText(props.initialPrompt);
      props.onPromptUsed();
    }
  }, [props.initialPrompt]);

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
  const pushError = (text: string) => push({ id: newId(), kind: 'note', tone: 'error', text });

  async function send(payload: { message?: string; audio?: string; image?: string }, userMsg: Extract<ChatMsg, { kind: 'user' }>) {
    const history = toHistory(messagesRef.current);
    push(userMsg);
    setBusy(true);
    try {
      const r = await api.chat({ ...payload, history });
      if (r.transcript) {
        setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, text: r.transcript! } : m)));
      }
      push(
        { id: newId(), kind: 'bot', text: r.reply },
        ...r.applied.movimientos.map((tx): ChatMsg => ({ id: newId(), kind: 'tx', tx })),
        ...r.applied.cuentasCreadas.map((nombre): ChatMsg => ({ id: newId(), kind: 'note', tone: 'cuenta', text: `Nueva cuenta: ${nombre}` })),
        ...r.applied.presupuestos.map(
          (p): ChatMsg => ({ id: newId(), kind: 'note', tone: 'presupuesto', text: `Presupuesto de ${p.categoria}: ${fmtCOP(p.monto)} al mes` }),
        ),
      );
      onResult(r);
    } catch (err) {
      if (err instanceof SessionExpiredError) return onSessionExpired();
      pushError(err instanceof Error ? err.message : 'No se pudo enviar.');
    } finally {
      setBusy(false);
    }
  }

  function sendText(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    void send({ message }, { id: newId(), kind: 'user', text: message });
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
      await send({ image, message: note }, { id: newId(), kind: 'user', text: note || 'Foto de un recibo', thumb });
    } catch {
      pushError('No pude abrir esa foto. Intenta con otra.');
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      pushError('Tu navegador no permite grabar audio. Escríbeme el movimiento.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      pushError('No tengo permiso para usar el micrófono. Actívalo en los ajustes del navegador.');
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
      try {
        const audio = await recordingToWav(new Blob(chunks, { type: recorder.mimeType }));
        await send({ audio }, { id: newId(), kind: 'user', text: 'Nota de voz…' });
      } catch {
        pushError('No pude procesar la nota de voz. Intenta otra vez.');
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

  async function undo(msg: Extract<ChatMsg, { kind: 'tx' }>) {
    if (await onUndo(msg.tx.id)) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...msg, undone: true } : m)));
    }
  }

  const hasConversation = messages.some((m) => m.kind === 'user');
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <span className="aura-orb" aria-hidden="true">
          <Sparkles size={20} />
        </span>
        <div>
          <h1>Aura</h1>
          <p>
            <span className="online-dot" aria-hidden="true" /> Tu asistente de plata
          </p>
        </div>
        {summary && (
          <div className="header-balance">
            Tienes
            <strong className="amount">{fmtCOP(summary.totales.tienes)}</strong>
          </div>
        )}
      </header>

      <div className="chat-scroll" aria-live="polite">
        {!hasConversation && (
          <div className="chat-empty">
            <span className="aura-orb xl" aria-hidden="true">
              <Sparkles size={40} />
            </span>
            <h2>Hola, {user}. ¿Qué anotamos hoy?</h2>
            <p>Escríbeme como le hablarías a un amigo, mándame una nota de voz o la foto de un recibo. Yo llevo las cuentas.</p>
            <div className="prompt-grid">
              {PROMPTS.map(({ text, Icon }) => (
                <button key={text} className="prompt-card" onClick={() => sendText(text)} disabled={busy}>
                  <Icon size={20} color="var(--primary)" aria-hidden="true" />
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.kind === 'user') {
            return (
              <div key={m.id} className="msg user">
                <div className="bubble">
                  {m.thumb && <img src={m.thumb} alt="Foto del recibo enviada" />}
                  {m.text}
                </div>
              </div>
            );
          }
          if (m.kind === 'bot') {
            return (
              <div key={m.id} className="msg bot">
                <span className="aura-orb sm" aria-hidden="true">
                  <Sparkles size={14} />
                </span>
                <div className="bubble">{m.text}</div>
              </div>
            );
          }
          if (m.kind === 'tx') {
            return (
              <div key={m.id} className="msg system">
                <div className={`ticket${m.undone ? ' undone' : ''}`}>
                  <div className="ticket-status">
                    {m.undone ? <Undo2 size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
                    {m.undone ? 'Deshecho' : 'Registrado'}
                  </div>
                  <TxRow m={m.tx} />
                  {!m.undone && (
                    <div className="ticket-actions">
                      <button className="btn btn-soft btn-sm" onClick={() => undo(m)}>
                        <Undo2 size={16} aria-hidden="true" /> Deshacer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          }
          const Icon = NOTE_ICONS[m.tone];
          return (
            <div key={m.id} className="msg system">
              <div className={`note${m.tone === 'error' ? ' error' : ''}`} role={m.tone === 'error' ? 'alert' : undefined}>
                <Icon size={16} aria-hidden="true" /> {m.text}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="msg bot">
            <span className="aura-orb sm" aria-hidden="true">
              <Sparkles size={14} />
            </span>
            <div className="bubble">
              <span className="typing" aria-label="Aura está pensando">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {hasConversation && (
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => sendText(s)} disabled={busy || recording}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="composer-bar">
          {recording ? (
            <div className="rec">
              <button type="button" className="icon-btn" onClick={cancelRecording} aria-label="Cancelar grabación">
                <X size={20} />
              </button>
              <span className="rec-dot" aria-hidden="true" />
              <span className="rec-time">
                {timer} <small>/ 1:00</small>
              </span>
              <button type="button" className="send-btn" onClick={stopRecording} aria-label="Detener y enviar nota de voz">
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Tomar foto de un recibo">
                <Camera size={22} />
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
              <form onSubmit={handleSubmit}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ej: gasté 20 mil en almuerzo"
                  aria-label="Mensaje para Aura"
                  autoComplete="off"
                  enterKeyHint="send"
                  maxLength={1000}
                  disabled={busy}
                />
                {input.trim() ? (
                  <button type="submit" className="send-btn" disabled={busy} aria-label="Enviar mensaje">
                    <Send size={18} />
                  </button>
                ) : (
                  <button type="button" className="send-btn" onClick={startRecording} disabled={busy} aria-label="Grabar nota de voz">
                    <Mic size={20} />
                  </button>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
