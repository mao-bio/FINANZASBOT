import { useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

export default function LoginPage({ onLoginSuccess }: { onLoginSuccess: (user: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = await api.login(username.trim(), password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login">
      <div className="login-brand">
        <span className="aura-orb xl" aria-hidden="true">
          <Sparkles size={40} />
        </span>
        <h1>FinanzasBot</h1>
        <p>Tu plata, clarita. Cuéntale a Aura tus gastos y ella lleva las cuentas.</p>
      </div>

      <form onSubmit={handleSubmit} className="card form" noValidate>
        <div className="field">
          <label htmlFor="username">Usuario</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Tu nombre"
            required
            autoComplete="username"
            autoCapitalize="none"
            disabled={loading}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <div className="password-wrap">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu clave"
              required
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="form-error login-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" /> {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <span className="spinner" aria-label="Entrando…" /> : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
