import { useEffect, useState } from 'react';
import type { CompleteSaleResult } from '../../application/usecases/CompleteSaleUseCase';
import { useContainer } from '../hooks/ContainerContext';
import { toUserMessage } from '../utils/errors';
import { peso } from '../utils/format';
import { Modal } from './Modal';

export function SaleCompleteDialog(props: { result: CompleteSaleResult; onClose: () => void }) {
  const { useCases, receiptText } = useContainer();
  const { sale, print } = props.result;
  const change = sale.payments.reduce((s, p) => s + p.change, 0);
  const [preview, setPreview] = useState<string | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(print && !print.ok ? print.error.message : null);

  useEffect(() => {
    if (print?.receipt) void receiptText(print.receipt).then(setPreview);
  }, [print, receiptText]);

  const retryPrint = async (): Promise<void> => {
    try {
      const res = await useCases.printReceipt.execute(sale.uuid);
      setPrintMsg(res.ok ? 'Printed.' : res.error.message);
    } catch (e) {
      setPrintMsg(toUserMessage(e));
    }
  };

  return (
    <Modal
      title="Sale complete"
      testId="sale-complete"
      onClose={props.onClose}
      footer={
        <>
          {print && !print.ok && (
            <button type="button" className="btn" onClick={() => void retryPrint()}>
              Retry print
            </button>
          )}
          <button type="button" className="btn btn--primary btn--xl" data-testid="new-sale" onClick={props.onClose}>
            New sale
          </button>
        </>
      }
    >
      <div className="sale-complete">
        <div className="sale-complete__change">
          <span className="muted">Change due</span>
          <strong data-testid="change-due">{peso(change)}</strong>
        </div>
        <p>
          Receipt <strong data-testid="receipt-number">{sale.receiptNumber}</strong> · Total {peso(sale.total)}
        </p>
        <p className={print?.ok ? 'muted' : 'error-text'} data-testid="print-status">
          {print?.ok ? 'Receipt printed.' : `Receipt not printed: ${printMsg ?? 'printer unavailable'}`}
        </p>
        {props.result.stockWarnings.length > 0 && (
          <p className="error-text">Stock warning: {props.result.stockWarnings.map((w) => w.name).join(', ')}</p>
        )}
        {preview && (
          <pre className="receipt-preview" data-testid="receipt-preview">
            {preview}
          </pre>
        )}
      </div>
    </Modal>
  );
}
