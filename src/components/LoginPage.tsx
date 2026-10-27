import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';

interface LoginPageProps {
  onLoginSuccess: (user: string) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
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
    <div className="login-wrapper">
      <div className="login-bg-glows">
        <div className="glow glow-1"></div>
        <div className="glow glow-2"></div>
      </div>

      <div className="login-card">
        <div className="login-header">
          <span className="login-logo" role="img" aria-label="FinanzasBot">💸</span>
          <h2>FinanzasBot</h2>
          <p>TU PLATA, CLARITA</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="form-group">
            <label htmlFor="username">Usuario</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ingresa tu nombre..."
              required
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <div className="password-field-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingresa tu clave..."
                required
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="login-error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? <span className="spinner" aria-label="Cargando..." /> : 'Ingresar al Centro Financiero'}
          </button>
        </form>

        <div className="login-footer">
          <p>Hecho con amor y IA para Mario 💙</p>
        </div>
      </div>
    </div>
  );
}
