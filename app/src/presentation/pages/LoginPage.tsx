import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useContainer } from '../hooks/ContainerContext';
import { useNetworkState } from '../hooks/useAppState';
import { toUserMessage } from '../utils/errors';

export function LoginPage() {
  const container = useContainer();
  const network = useNetworkState();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const outcome = await container.useCases.signIn.execute({ email, password });
      setPassword('');
      if (outcome.kind === 'DEVICE_REGISTRATION_REQUIRED') {
        void navigate('/device', { replace: true });
        return;
      }
      await container.afterSignIn();
      void navigate('/pos', { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void submit(e)} data-testid="login-form">
        <h1>HMR POS</h1>
        <p className={`net net--${network.toLowerCase()}`} data-testid="login-network">
          {network === 'ONLINE' ? '🟢 Online' : network === 'UNSTABLE' ? '🟠 Server unreachable — offline sign-in' : '🔴 Offline — offline sign-in'}
        </p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="error-text" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--xl" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
