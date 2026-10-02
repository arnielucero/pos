/** `{deviceCode}-{YYYYMMDD}-{seq 5 digits}` (API.md CREATE_SALE example: POS-03-20261002-00042). */
export function formatReceiptNumber(deviceCode: string, day: string, seq: number): string {
  if (!/^\d{8}$/.test(day)) throw new Error('day must be YYYYMMDD');
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > 99999) throw new Error('receipt sequence out of range');
  return `${deviceCode}-${day}-${String(seq).padStart(5, '0')}`;
}

/** Local calendar day (device timezone) as YYYYMMDD. */
export function localDayKey(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
