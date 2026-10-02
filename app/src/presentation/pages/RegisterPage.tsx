import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { RegisterReport } from '../../domain/entities/Register';
import { MoneyInput } from '../components/MoneyInput';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { useSession } from '../hooks/useAppState';
import { toUserMessage } from '../utils/errors';
import { formatDateTime, peso } from '../utils/format';

function ReportView({ report }: { report: RegisterReport }) {
  return (
    <div className="card report" data-testid={`report-${report.kind.toLowerCase()}`}>
      <h2>{report.kind === 'X' ? 'X report (mid-shift)' : 'Z report (closing)'}</h2>
      <p className="muted">
        Opened {formatDateTime(report.openedAt)} · generated {formatDateTime(report.generatedAt)}
      </p>
      <table className="table">
        <tbody>
          <tr>
            <td>Opening cash</td>
            <td className="right">{peso(report.openingCash)}</td>
          </tr>
          <tr>
            <td>Cash sales</td>
            <td className="right">{peso(report.cashSales)}</td>
          </tr>
          <tr>
            <td>Cash refunds</td>
            <td className="right">-{peso(report.cashRefunds)}</td>
          </tr>
          <tr>
            <td>Cash adjustments</td>
            <td className="right">{peso(report.cashAdjustments)}</td>
          </tr>
          <tr className="strong">
            <td>Expected cash</td>
            <td className="right" data-testid="expected-cash">
              {peso(report.expectedCash)}
            </td>
          </tr>
          {report.actualCash !== null && (
            <>
              <tr>
                <td>Actual cash</td>
                <td className="right">{peso(report.actualCash)}</td>
              </tr>
              <tr className="strong">
                <td>Variance</td>
                <td className="right">{peso(report.variance ?? 0)}</td>
              </tr>
            </>
          )}
          <tr>
            <td>Sales / voids</td>
            <td className="right">
              {report.salesCount} / {report.voidCount}
            </td>
          </tr>
          <tr>
            <td>Net sales</td>
            <td className="right">{peso(report.netSales)}</td>
          </tr>
          {Object.entries(report.paymentsByMethod).map(([m, v]) => (
            <tr key={m} className="muted">
              <td>{m}</td>
              <td className="right">{peso(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegisterPage() {
  const { useCases } = useContainer();
  const session = useSession();
  const withApproval = useApproval();
  const navigate = useNavigate();
  const [report, setReport] = useState<RegisterReport | null>(null);
  const [raw, setRaw] = useState('');
  const [cash, setCash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const xReport = async (): Promise<void> => {
    setError(null);
    try {
      setReport(await useCases.closeRegister.xReport());
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  const close = async (): Promise<void> => {
    setError(null);
    if (cash === null) {
      setError('Count the drawer and enter the actual cash.');
      return;
    }
    try {
      const z = await withApproval((approval) => useCases.closeRegister.close({ actualCash: cash, approval }), {
        reason: 'Close register',
      });
      if (z) setReport(z);
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  const open = session.registerSession;
  return (
    <div className="split">
      <section className="split__main">
        {open ? (
          <div className="card">
            <h2>Register session</h2>
            <p className="muted">
              Opened {formatDateTime(open.openedAt)} with {peso(open.openingCash)}
            </p>
            <div className="actions">
              <button type="button" className="btn" data-testid="x-report" onClick={() => void xReport()}>
                X report
              </button>
            </div>
            <h3>Close register (Z report)</h3>
            <MoneyInput
              label="Actual cash counted (₱)"
              value={raw}
              testId="actual-cash"
              onChange={(r, c) => {
                setRaw(r);
                setCash(c);
              }}
            />
            <button type="button" className="btn btn--danger" data-testid="close-register" onClick={() => void close()}>
              Close register
            </button>
          </div>
        ) : (
          <div className="card">
            <h2>No open register</h2>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void navigate('/register/open');
              }}
            >
              Open register
            </button>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="split__side">{report ? <ReportView report={report} /> : <div className="empty">No report yet.</div>}</section>
    </div>
  );
}
