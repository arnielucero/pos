import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PrinterDevice, PrinterSettings } from '../../application/ports/ReceiptPrinter';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { toUserMessage } from '../utils/errors';

export function PrinterSettingsPage() {
  const container = useContainer();
  const stored = useQuery({ queryKey: ['printer-settings'], queryFn: () => container.useCases.printerSettings.get() });
  if (!stored.data) return <div className="empty">Loading…</div>;
  return <PrinterSettingsForm initial={stored.data} />;
}

function PrinterSettingsForm({ initial }: { initial: PrinterSettings }) {
  const container = useContainer();
  const withApproval = useApproval();
  const client = useQueryClient();
  const [form, setForm] = useState<PrinterSettings>(initial);
  const [devices, setDevices] = useState<readonly PrinterDevice[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const update = (patch: Partial<PrinterSettings>): void => {
    setForm({ ...form, ...patch });
  };

  const save = async (): Promise<boolean> => {
    setMessage(null);
    try {
      const res = await withApproval(
        async (approval) => {
          await container.useCases.printerSettings.save(form, approval);
          return true;
        },
        { reason: 'Change printer settings' },
      );
      if (res) {
        await client.invalidateQueries({ queryKey: ['printer-settings'] });
        setMessage('Saved.');
      }
      return res ?? false;
    } catch (e) {
      setMessage(toUserMessage(e));
      return false;
    }
  };

  const discover = async (): Promise<void> => {
    setMessage(null);
    try {
      const saved = await save();
      if (saved) setDevices(await container.useCases.printerSettings.discover(form));
    } catch (e) {
      setMessage(toUserMessage(e));
    }
  };

  const test = async (): Promise<void> => {
    setMessage(null);
    try {
      const st = await container.useCases.printerSettings.testPrint();
      setMessage(`Test page sent.${st.paperOut === true ? ' Printer reports paper out!' : ''}`);
    } catch (e) {
      setMessage(toUserMessage(e));
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Receipt printer</h2>
        <div className="segmented">
          {(['BLUETOOTH', 'WIFI', 'MOCK'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn ${form.type === t ? 'btn--selected' : ''}`}
              onClick={() => {
                update({ type: t });
              }}
            >
              {t === 'BLUETOOTH' ? 'Bluetooth' : t === 'WIFI' ? 'Wi-Fi / LAN' : 'Screen (no printer)'}
            </button>
          ))}
        </div>
        {container.platform !== 'android' && form.type !== 'MOCK' && (
          <p className="muted">Bluetooth / network printers only work in the Android app; the browser build prints to screen.</p>
        )}
        {form.type === 'BLUETOOTH' && (
          <>
            <button type="button" className="btn" onClick={() => void discover()}>
              Find paired printers
            </button>
            <ul className="device-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`btn ${form.address === d.id ? 'btn--selected' : ''}`}
                    onClick={() => {
                      update({ address: d.id, name: d.name });
                    }}
                  >
                    {d.name} <span className="mono muted">{d.id}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">Selected: {form.name || form.address || 'none'}</p>
          </>
        )}
        {form.type === 'WIFI' && (
          <div className="row">
            <label className="field">
              <span>Printer IP / host</span>
              <input
                value={form.address}
                onChange={(e) => {
                  update({ address: e.target.value.trim() });
                }}
              />
            </label>
            <label className="field">
              <span>Port</span>
              <input
                inputMode="numeric"
                value={String(form.port)}
                onChange={(e) => {
                  update({ port: Number.parseInt(e.target.value, 10) || 9100 });
                }}
              />
            </label>
          </div>
        )}
        <div className="segmented">
          {([58, 80] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={`btn ${form.paperWidth === w ? 'btn--selected' : ''}`}
              onClick={() => {
                update({ paperWidth: w });
              }}
            >
              {w}mm paper
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.openDrawer}
            onChange={(e) => {
              update({ openDrawer: e.target.checked });
            }}
          />
          Open cash drawer on cash sales
        </label>
        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void save().then((ok) => (ok ? test() : undefined));
            }}
          >
            Save & test print
          </button>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
