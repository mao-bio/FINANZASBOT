import { useEffect, useState } from 'react';
import { Bell, BellOff, CalendarClock, Flag, MessageCircle, Send, Target, type LucideIcon } from 'lucide-react';
import type { EstadoPush, TipoAviso } from '../../shared/types';
import { api } from '../lib/api';
import { activarAvisos, apagarAvisos, estadoAvisos, type EstadoAvisos } from '../lib/notify';
import { IconTile } from '../lib/visuals';
import { Sheet } from './Dialogs';

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

const TIPOS: { id: TipoAviso; label: string; detalle: string; Icon: LucideIcon; color: string }[] = [
  {
    id: 'presupuesto',
    label: 'Presupuestos',
    detalle: 'Cuando llegues al 80% o te pases, y si vas a ritmo de pasarte antes de fin de mes.',
    Icon: Target,
    color: 'var(--status-critical)',
  },
  { id: 'cobros', label: 'Cobros que se vienen', detalle: 'Un día antes de tus suscripciones y cobros fijos.', Icon: CalendarClock, color: '#7b5cff' },
  { id: 'metas', label: 'Metas', detalle: 'Los domingos, cuánto apartar esa semana. Y cuando cumplas una.', Icon: Flag, color: 'var(--primary)' },
  { id: 'diario', label: 'Recordatorio diario', detalle: 'En la noche, si ese día no registraste nada.', Icon: MessageCircle, color: 'var(--income)' },
];

const ESTADO_TEXTO: Record<EstadoAvisos, string> = {
  activo: 'Activas: te llegan aunque la app esté cerrada',
  apagado: 'Apagadas en este celular',
  bloqueado: 'Bloqueadas en el navegador',
  'ios-instalar': 'Primero instala la app',
  'no-soportado': 'Este navegador no las permite',
};

function Switch(props: { checked: boolean; disabled?: boolean; labelledBy: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={props.checked}
      aria-labelledby={props.labelledBy}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  );
}

export default function AvisosSheet(props: { run: Run; onClose: () => void; onToast: (msg: string) => void }) {
  const { run, onToast } = props;
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [info, setInfo] = useState<EstadoPush | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void estadoAvisos().then(setEstado);
    void run(api.push).then((i) => i && setInfo(i));
  }, [run]);

  async function toggle() {
    if (!info || !estado) return;
    setBusy('switch');
    try {
      if (estado === 'activo') {
        await apagarAvisos();
        setEstado('apagado');
      } else {
        const nuevo = await activarAvisos(info.publicKey);
        setEstado(nuevo);
        if (nuevo === 'activo') onToast('¡Listo! Te van a llegar los avisos aunque tengas la app cerrada.');
      }
      const fresco = await run(api.push);
      if (fresco) setInfo(fresco);
    } catch (err) {
      console.warn('No se pudieron activar las notificaciones', err);
      onToast(
        err instanceof DOMException
          ? 'El navegador no pudo conectarse a su servicio de notificaciones. Inténtalo de nuevo en un rato.'
          : err instanceof Error
            ? err.message
            : 'No se pudieron activar las notificaciones.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function setPref(tipo: TipoAviso) {
    if (!info) return;
    setBusy(tipo);
    const prefs = await run(() => api.pushPreferences({ [tipo]: !info.preferencias[tipo] }));
    if (prefs) setInfo({ ...info, preferencias: prefs });
    setBusy(null);
  }

  async function probar() {
    setBusy('test');
    const res = await run(api.pushTest);
    setBusy(null);
    if (res) onToast('Te mandé una de prueba: debería llegarte en unos segundos.');
  }

  const activo = estado === 'activo';
  const puedeCambiar = estado === 'activo' || estado === 'apagado';

  return (
    <Sheet title="Notificaciones" onClose={props.onClose}>
      <div className="avisos">
        <div className="avisos-main">
          <IconTile visual={{ Icon: activo ? Bell : BellOff, color: activo ? 'var(--primary)' : 'var(--text-3)' }} />
          <div className="avisos-text">
            <strong id="avisos-main-label">Notificaciones push</strong>
            <small>{estado ? ESTADO_TEXTO[estado] : 'Revisando…'}</small>
          </div>
          {busy === 'switch' ? (
            <span className="spinner" aria-label="Un momento" />
          ) : (
            <Switch checked={activo} disabled={!info || !puedeCambiar} labelledBy="avisos-main-label" onChange={toggle} />
          )}
        </div>

        {estado === 'ios-instalar' && (
          <p className="avisos-help">
            En iPhone las notificaciones solo funcionan con la app instalada. En Safari toca <strong>Compartir</strong> →{' '}
            <strong>Agregar a pantalla de inicio</strong>, abre FinanzasBot desde ese ícono y vuelve aquí.
          </p>
        )}
        {estado === 'bloqueado' && (
          <p className="avisos-help">
            Las bloqueaste para esta app. Ve a los ajustes del navegador o del celular, busca este sitio → <strong>Notificaciones</strong> →{' '}
            <strong>Permitir</strong>, y vuelve aquí.
          </p>
        )}
        {estado === 'no-soportado' && (
          <p className="avisos-help">
            Este navegador no tiene notificaciones push. Usa Chrome, Edge, Firefox o Samsung Internet en Android, o Safari con la app instalada en
            iPhone.
          </p>
        )}

        <h3 className="avisos-sub">Qué te aviso</h3>
        <div className="avisos-list">
          {TIPOS.map((t) => (
            <div className="aviso-row" key={t.id}>
              <IconTile visual={{ Icon: t.Icon, color: t.color }} size="sm" />
              <div className="avisos-text">
                <strong id={`aviso-${t.id}`}>{t.label}</strong>
                <small>{t.detalle}</small>
              </div>
              {busy === t.id ? (
                <span className="spinner" aria-label="Guardando" />
              ) : (
                <Switch checked={info?.preferencias[t.id] ?? false} disabled={!info} labelledBy={`aviso-${t.id}`} onChange={() => setPref(t.id)} />
              )}
            </div>
          ))}
        </div>

        <p className="avisos-note">
          Las alertas de presupuesto llegan apenas registras el gasto. Lo demás lo reviso cada noche a las 7:30 p. m.
          {info && info.dispositivos > 1 && ` Hay ${info.dispositivos} celulares o navegadores recibiéndolas.`}
        </p>

        {activo && (
          <button className="btn btn-soft btn-block" onClick={probar} disabled={busy !== null}>
            {busy === 'test' ? (
              <span className="spinner" aria-label="Enviando" />
            ) : (
              <>
                <Send size={18} aria-hidden="true" /> Enviarme una de prueba
              </>
            )}
          </button>
        )}
      </div>
    </Sheet>
  );
}
