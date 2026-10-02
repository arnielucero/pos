import type { Receipt } from '../../application/dto/Receipt';
import { formatCentavos } from '../../domain/valueObjects/Money';
import { columnsFor, EscPosEncoder, toPrintableAscii, twoColumn, wrap } from './EscPosEncoder';

export type FormattedLine =
  | { readonly kind: 'text'; readonly text: string; readonly align: 'left' | 'center'; readonly bold?: boolean; readonly large?: boolean }
  | { readonly kind: 'rule' };

const money = (c: number): string => formatCentavos(c, 'P');

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Receipt → printer-independent lines that never exceed the paper's column count. */
export class ReceiptFormatter {
  constructor(private readonly paperWidth: 58 | 80) {}

  get columns(): number {
    return columnsFor(this.paperWidth);
  }

  format(r: Receipt): FormattedLine[] {
    const w = this.columns;
    const out: FormattedLine[] = [];
    const center = (t: string, extra: { bold?: boolean; large?: boolean } = {}): void => {
      for (const l of wrap(t, extra.large ? Math.floor(w / 2) : w)) out.push({ kind: 'text', text: l, align: 'center', ...extra });
    };
    const left = (t: string, bold = false): void => {
      out.push({ kind: 'text', text: t.slice(0, w), align: 'left', bold });
    };
    const rule = (): void => {
      out.push({ kind: 'rule' });
    };

    r.headerLines.forEach((h, i) => {
      center(h, i === 0 ? { bold: true, large: true } : {});
    });
    if (r.isReprint) center('*** REPRINT ***', { bold: true });
    if (r.isVoided) center('*** VOIDED ***', { bold: true });
    rule();
    left(twoColumn('Receipt', r.receiptNumber, w));
    left(twoColumn('Date', formatDate(r.createdAt), w));
    left(twoColumn('Cashier', r.cashierName, w));
    if (r.deviceCode) left(twoColumn('Terminal', r.deviceCode, w));
    rule();
    for (const line of r.lines) {
      for (const nameLine of wrap(line.name, w)) left(nameLine);
      left(twoColumn(`  ${String(line.quantity)} x ${money(line.unitPrice)}`, money(line.lineGross), w));
      if (line.lineDiscount > 0) left(twoColumn('  Discount', `-${money(line.lineDiscount)}`, w));
    }
    rule();
    left(twoColumn('Subtotal', money(r.subtotal), w));
    if (r.discountTotal > 0) left(twoColumn('Discounts', `-${money(r.discountTotal)}`, w));
    out.push({ kind: 'text', text: twoColumn('TOTAL', money(r.total), w), align: 'left', bold: true });
    left(twoColumn(`VAT ${String(r.taxRateBp / 100)}% (incl.)`, money(r.taxTotal), w));
    rule();
    for (const p of r.payments) {
      left(twoColumn(p.label, money(p.tendered), w));
      if (p.reference) left(twoColumn('  Ref', p.reference, w));
    }
    if (r.change > 0) left(twoColumn('Change', money(r.change), w), true);
    rule();
    for (const f of r.footerLines) center(f);
    return out;
  }

  /** Plain-text rendering (used by MockPrinter and the on-screen receipt preview). */
  toText(r: Receipt): string {
    const w = this.columns;
    return this.format(r)
      .map((l) => {
        if (l.kind === 'rule') return '-'.repeat(w);
        const t = toPrintableAscii(l.text);
        if (l.align === 'center') {
          const pad = Math.max(0, Math.floor((w - t.length) / 2));
          return ' '.repeat(pad) + t;
        }
        return t;
      })
      .join('\n');
  }

  toEscPos(r: Receipt): Uint8Array {
    const e = new EscPosEncoder().init();
    for (const l of this.format(r)) {
      if (l.kind === 'rule') {
        e.align('left').line('-'.repeat(this.columns));
        continue;
      }
      e.align(l.align).bold(l.bold ?? false).doubleSize(l.large ?? false).line(l.text);
      if (l.large) e.doubleSize(false);
      if (l.bold) e.bold(false);
    }
    e.feed(3).cut();
    if (r.openDrawer) e.openCashDrawer();
    return e.encode();
  }
}
