export function formatKitchenOrderNumber(value: string | number | null | undefined): string {
  const full = String(value ?? '').trim();
  if (!full) return '—';

  const posMatch = /^POS-(\d{12})-([A-Za-z0-9]+)$/i.exec(full);
  if (posMatch) return `${posMatch[1].slice(-6)}-${posMatch[2]}`;

  if (/^[0-9]+$/.test(full)) return full;
  if (full.length > 12) return `${full.slice(0, 8)}…`;
  return full;
}
