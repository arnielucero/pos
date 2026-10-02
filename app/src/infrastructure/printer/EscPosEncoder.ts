/**
 * Pure ESC/POS command builder. Produces bytes only — no IO. Text is mapped to printable
 * 7-bit ASCII so it renders identically on any code page (₱ → "P", accents stripped,
 * smart quotes/dashes normalised, anything else → "?").
 */
export type Align = 'left' | 'center' | 'right';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const MAP: Readonly<Record<string, string>> = {
  '₱': 'P',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
  '×': 'x',
  ' ': ' ',
  ñ: 'n',
  Ñ: 'N',
};

export function toPrintableAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const mapped = MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    if (ch === '\n') {
      out += '\n';
      continue;
    }
    const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += stripped.length === 1 && stripped.charCodeAt(0) >= 0x20 && stripped.charCodeAt(0) <= 0x7e ? stripped : '?';
  }
  return out;
}

export class EscPosEncoder {
  private readonly bytes: number[] = [];

  /** ESC @ — reset printer. */
  init(): this {
    return this.raw([ESC, 0x40]);
  }

  /** ESC a n */
  align(a: Align): this {
    return this.raw([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]);
  }

  /** ESC E n */
  bold(on: boolean): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** GS ! n — double width + height. */
  doubleSize(on: boolean): this {
    return this.raw([GS, 0x21, on ? 0x11 : 0x00]);
  }

  text(s: string): this {
    for (const ch of toPrintableAscii(s)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  line(s = ''): this {
    return this.text(s).raw([LF]);
  }

  feed(lines = 1): this {
    return this.raw([ESC, 0x64, Math.max(0, Math.min(255, lines))]);
  }

  /** GS V 66 n — feed n and partial cut (widely supported). */
  cut(): this {
    return this.raw([GS, 0x56, 0x42, 0x03]);
  }

  /** ESC p m t1 t2 — kick cash drawer pin 2. */
  openCashDrawer(): this {
    return this.raw([ESC, 0x70, 0x00, 0x19, 0xfa]);
  }

  raw(data: readonly number[]): this {
    for (const b of data) this.bytes.push(b & 0xff);
    return this;
  }

  encode(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** DLE EOT 4 — real-time paper sensor status request. */
export const PAPER_STATUS_REQUEST = Uint8Array.from([0x10, 0x04, 0x04]);

/** Bits 5/6 (0x60) of the DLE EOT 4 reply mean "paper end detected". */
export function isPaperOut(statusByte: number): boolean {
  return (statusByte & 0x60) === 0x60;
}

export function columnsFor(paperWidthMm: 58 | 80): number {
  return paperWidthMm === 80 ? 48 : 32;
}

/** Left text + right text on one line, truncating the left side when needed. */
export function twoColumn(left: string, right: string, width: number): string {
  const l = toPrintableAscii(left);
  const r = toPrintableAscii(right);
  const space = width - r.length - 1;
  if (space < 1) return r.slice(0, width);
  const lt = l.length > space ? l.slice(0, space) : l;
  return lt + ' '.repeat(width - lt.length - r.length) + r;
}

/** Word-wraps text to `width` columns (hard-splits words longer than a line). */
export function wrap(text: string, width: number): string[] {
  const words = toPrintableAscii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
