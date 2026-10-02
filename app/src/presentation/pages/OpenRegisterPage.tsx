import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MoneyInput } from '../components/MoneyInput';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { toUserMessage } from '../utils/errors';

export function OpenRegisterPage() {
  const container = useContainer();
  const withApproval = useApproval();
  const navigate = useNavigate();
  const [raw, setRaw] = useState('0.00');
  const [cash, setCash] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (cash === null) {
      setError('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await withApproval((approval) => container.useCases.openRegister.execute({ openingCash: cash, approval }), {
        reason: 'Open register',
      });
      if (res) void navigate('/pos', { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void submit(e)} data-testid="open-register-form">
        <h1>Open register</h1>
        <p className="muted">Count the cash in the drawer before the first sale.</p>
        <MoneyInput
          label="Opening cash (₱)"
          value={raw}
          testId="opening-cash"
          onChange={(r, c) => {
            setRaw(r);
            setCash(c);
          }}
        />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--xl" disabled={busy}>
          Open register
        </button>
      </form>
    </div>
  );
}
