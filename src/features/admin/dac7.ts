import type { Dac7Row } from '../../types/database';

const QUARTERS = [1, 2, 3, 4] as const;

function crowns(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per venue with paid, unrefunded live bookings per quarter; semicolons and a BOM for Czech Excel. */
export function dac7Csv(rows: Dac7Row[]): string {
  const header = [
    'Provozovna', 'Podnikatel', 'Typ', 'IČO', 'DIČ', 'Datum narození', 'Stát', 'Adresa', 'Účet Stripe', 'Ověřeno v ARES', 'Demo',
    ...QUARTERS.flatMap((q) => [`Q${q} počet`, `Q${q} vyplaceno podniku (Kč)`, `Q${q} poplatky FLEK (Kč)`]),
  ];
  const lines = rows.map((row) => [
    row.display_name, row.legal_name, row.seller_type === 'individual' ? 'fyzická osoba' : row.seller_type === 'entity' ? 'právnická osoba' : '',
    row.ico, row.dic, row.birth_date, row.country, row.address, row.stripe_account_id, row.ares_checked_at ? 'ano' : 'ne', row.demo ? 'ano' : 'ne',
    ...QUARTERS.flatMap((q) => [row[`q${q}_count`], crowns(row[`q${q}_payout_cents`]), crowns(row[`q${q}_fee_cents`])]),
  ].map(csvCell).join(';'));
  return `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\n')}\n`;
}
