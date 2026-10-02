import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useContainer } from '../hooks/ContainerContext';
import { useSession } from '../hooks/useAppState';
import { toUserMessage } from '../utils/errors';

export function DeviceRegistrationPage() {
  const container = useContainer();
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('Front counter tablet');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await container.useCases.registerDevice.execute({ deviceName: name });
      await container.afterSignIn();
      void navigate('/register/open', { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void submit(e)} data-testid="device-form">
        <h1>Register this tablet</h1>
        <p className="muted">
          Signed in as {session.user?.name}. This tablet is not yet registered to {session.user?.store.name}. Registering it
          assigns a terminal code used on receipts.
        </p>
        <label className="field">
          <span>Device name</span>
          <input
            name="deviceName"
            value={name}
            maxLength={100}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--xl" disabled={busy}>
          {busy ? 'Registering…' : 'Register device'}
        </button>
      </form>
    </div>
  );
}
