import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../src/application/dto/Receipt';
import { formatReceiptNumber, localDayKey } from '../../src/domain/services/ReceiptNumber';
import { EscPosEncoder, isPaperOut, toPrintableAscii, twoColumn, wrap } from '../../src/infrastructure/printer/EscPosEncoder';
import { ReceiptFormatter } from '../../src/infrastructure/printer/ReceiptFormatter';

describe('EscPosEncoder', () => {
  it('emits exact command bytes', () => {
    const bytes = new EscPosEncoder().init().align('center').bold(true).doubleSize(true).text('Hi').cut().openCashDrawer().encode();
    expect(Array.from(bytes)).toEqual([
      0x1b, 0x40, // ESC @
      0x1b, 0x61, 1, // ESC a 1
      0x1b, 0x45, 1, // ESC E 1
      0x1d, 0x21, 0x11, // GS ! 0x11
      0x48, 0x69, // "Hi"
      0x1d, 0x56, 0x42, 0x03, // GS V B 3
      0x1b, 0x70, 0x00, 0x19, 0xfa, // ESC p
    ]);
  });

  it('line() appends LF and align/bold off work', () => {
    expect(Array.from(new EscPosEncoder().align('right').bold(false).line('A').encode())).toEqual([0x1b, 0x61, 2, 0x1b, 0x45, 0, 0x41, 0x0a]);
  });

  it('maps text to code-page safe ASCII (₱ → P)', () => {
    expect(toPrintableAscii('₱120.00 – Café “Niño”…')).toBe('P120.00 - Cafe "Nino"...');
    expect(toPrintableAscii('日本')).toBe('??');
    const bytes = new EscPosEncoder().text('₱5').encode();
    expect(Array.from(bytes)).toEqual([0x50, 0x35]);
    expect(Array.from(bytes).every((b) => b >= 0x20 && b <= 0x7e)).toBe(true);
  });

  it('detects paper-out from DLE EOT 4 status', () => {
    expect(isPaperOut(0x12)).toBe(false);
    expect(isPaperOut(0x72)).toBe(true);
  });

  it('formats two columns and wraps to width', () => {
    expect(twoColumn('Total', 'P1.00', 20)).toBe('Total          P1.00');
    expect(twoColumn('A very long product name indeed', 'P99.00', 20)).toHaveLength(20);
    expect(wrap('Chicken Rice with extra egg and sauce', 10).every((l) => l.length <= 10)).toBe(true);
    expect(wrap('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic']);
  });
});

const receipt: Receipt = {
  headerLines: ['HMR POS', 'STORE-001 Main Branch, Very Long Address Street, Quezon City'],
  receiptNumber: 'POS-01-20261002-00042',
  createdAt: '2026-10-02T01:42:00Z',
  cashierName: 'Carla Cashier',
  deviceCode: 'POS-01',
  lines: [
    { name: 'Chicken Rice Special With An Extremely Long Name That Wraps', sku: 'CR-001', quantity: 2, unitPrice: 12000, lineGross: 24000, lineDiscount: 2400, lineTotal: 21600 },
    { name: 'Coffee', sku: 'CF-001', quantity: 1, unitPrice: 9000, lineGross: 9000, lineDiscount: 0, lineTotal: 9000 },
  ],
  subtotal: 33000,
  discountTotal: 3400,
  total: 29600,
  taxTotal: 3171,
  taxRateBp: 1200,
  payments: [{ label: 'Cash', amount: 29600, tendered: 100000, change: 70400, reference: null }],
  change: 70400,
  footerLines: ['Thank you!'],
  isReprint: true,
  isVoided: false,
  openDrawer: true,
};

describe('ReceiptFormatter', () => {
  it.each([
    [58, 32],
    [80, 48],
  ] as const)('never exceeds %imm width (%i columns)', (paper, cols) => {
    const f = new ReceiptFormatter(paper);
    expect(f.columns).toBe(cols);
    const text = f.toText(receipt);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(cols);
    expect(text).toContain('POS-01-20261002-00042');
    expect(text).toContain('*** REPRINT ***');
    expect(text).toContain('P704.00'); // change, peso sign mapped to P
    expect(text).not.toContain('₱');
  });

  it('produces ESC/POS bytes with cut and drawer kick', () => {
    const bytes = Array.from(new ReceiptFormatter(58).toEscPos(receipt));
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes.slice(-9)).toEqual([0x1d, 0x56, 0x42, 0x03, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});

describe('Receipt numbers', () => {
  it('formats {deviceCode}-{YYYYMMDD}-{seq5}', () => {
    expect(formatReceiptNumber('POS-03', '20261002', 42)).toBe('POS-03-20261002-00042');
    expect(localDayKey(new Date(2026, 9, 2, 23, 59))).toBe('20261002');
    expect(() => formatReceiptNumber('POS-03', '20261002', 100000)).toThrow();
  });
});
