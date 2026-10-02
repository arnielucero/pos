import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Approval, Approver } from '../../domain/entities/Approval';
import type { Permission } from '../../domain/entities/Permission';
import { PermissionDeniedError } from '../../domain/errors/DomainError';
import { ApprovalContext, type ApprovalRunner } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { toUserMessage } from '../utils/errors';
import { Modal } from './Modal';
import { PinPad } from './PinPad';

interface Pending {
  readonly permission: Permission;
  readonly reason: string;
  readonly resolve: (a: Approval | null) => void;
}

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (permission: Permission, reason: string) =>
      new Promise<Approval | null>((resolve) => {
        setPending({ permission, reason, resolve });
      }),
    [],
  );

  const run: ApprovalRunner = useCallback(
    async (action, options) => {
      try {
        return await action(null);
      } catch (e) {
        if (!(e instanceof PermissionDeniedError)) throw e;
        const approval = await ask(e.permission as Permission, options.reason);
        if (!approval) return null;
        return action(approval);
      }
    },
    [ask],
  );

  return (
    <ApprovalContext.Provider value={run}>
      {children}
      {pending && (
        <ApprovalDialog
          permission={pending.permission}
          reason={pending.reason}
          onDone={(a) => {
            pending.resolve(a);
            setPending(null);
          }}
        />
      )}
    </ApprovalContext.Provider>
  );
}

function ApprovalDialog(props: { permission: Permission; reason: string; onDone: (a: Approval | null) => void }) {
  const { useCases } = useContainer();
  const [approvers, setApprovers] = useState<readonly Approver[] | null>(null);
  const [approverUuid, setApproverUuid] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState(props.reason);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    let alive = true;
    void useCases.requestApproval.listApprovers(props.permission).then((list) => {
      if (!alive) return;
      setApprovers(list);
      if (list[0]) setApproverUuid(list[0].userUuid);
    });
    return () => {
      alive = false;
    };
  }, [useCases, props.permission]);

  const submit = useCallback(async (enteredPin: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const approval = await useCases.requestApproval.execute({ permission: props.permission, approverUuid, pin: enteredPin, reason });
      props.onDone(approval);
    } catch (e) {
      setError(toUserMessage(e));
      setPin('');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [useCases, props, approverUuid, reason]);

  const onPinChange = (value: string): void => {
    setPin(value);
    if (value.length === 6 && approverUuid) void submit(value);
  };

  return (
    <Modal
      title="Manager approval"
      testId="approval-dialog"
      onClose={() => {
        props.onDone(null);
      }}
    >
      <p className="muted">
        This action needs <strong>{props.permission}</strong>. Ask a manager to enter their PIN.
      </p>
      {approvers?.length === 0 && (
        <p className="error-text">No manager on this device can approve this. Sync the catalog while online first.</p>
      )}
      <label className="field">
        <span>Manager</span>
        <select
          value={approverUuid}
          data-testid="approver-select"
          onChange={(e) => {
            setApproverUuid(e.target.value);
          }}
        >
          {(approvers ?? []).map((a) => (
            <option key={a.userUuid} value={a.userUuid}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input
          value={reason}
          maxLength={255}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </label>
      <PinPad value={pin} onChange={onPinChange} disabled={busy || !approverUuid} />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
