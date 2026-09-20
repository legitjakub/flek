/**
 * Booking e-mails. A customer's e-mail about a booking is the confirmation of the contract (or the
 * news of what happened to it), so when the database sends the booking details it spells out the
 * service, the provider, the price, the code and the cancellation terms. Every e-mail ends with who
 * runs FLEK. Pure functions: the unit tests render the same text the worker sends.
 *
 * V hlavičce je skutečná značka FLEK jako PNG (`public/images/email-logo.png`, vykreslené ze
 * stejného tvaru, jaký kreslí `components/ui.tsx`). Dřív tu stálo „flek′“ — slovo s apostrofem,
 * které se značkou nemá nic společného. SVG do e-mailu nepatří, většina poštovních klientů ho
 * zahodí; když příjemce obrázky blokuje, zůstane alt „FLEK“.
 */

export type Operator = { name: string | null; ico: string | null; address: string | null; email: string | null };

export type Contract = {
  status: string;
  code: string | null;
  service: string;
  business: string;
  address: string;
  start_at: string;
  end_at: string;
  price_cents: number;
  service_fee_cents: number;
  free_cancellation_until: string;
  payment_status: string | null;
  refund_status: string | null;
  authorization_state: string | null;
  cancellation_reason: string | null;
  provider: { name: string; ico: string | null; address: string | null; demo: boolean } | null;
  terms_version: string | null;
};

export type EmailJob = { title: string; body: string; href: string; contract?: Contract | null };

const APP = 'https://www.app-flek.eu';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]!);
}

const dateTime = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });

function money(cents: number): string {
  return `${(cents / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč`;
}

export function operatorLine(operator: Operator | null): string | null {
  if (!operator?.name || !operator.ico || !operator.address || !operator.email) return null;
  return `FLEK provozuje ${operator.name}, IČO ${operator.ico}, ${operator.address}. Kontakt: ${operator.email}.`;
}

/** The rows and notes of a booking e-mail; an agreed booking carries its code and terms, anything else what happens to the money. */
export function contractDetails(contract: Contract): { rows: [string, string][]; notes: string[] } {
  const agreed = contract.status === 'confirmed' || contract.status === 'completed';
  const rows: [string, string][] = [
    ['Služba', contract.service],
    ['Termín', `${dateTime.format(new Date(contract.start_at))}–${timeOnly.format(new Date(contract.end_at))}`],
    ['Místo', `${contract.business}, ${contract.address}`],
  ];
  const provider = contract.provider;
  if (provider && !provider.demo) {
    rows.push(['Poskytovatel', [provider.name, provider.ico ? `IČO ${provider.ico}` : null, provider.address].filter(Boolean).join(', ')]);
  }
  rows.push(['Cena', `${money(contract.price_cents)} včetně servisního poplatku FLEK ${money(contract.service_fee_cents)}`]);
  const notes: string[] = [];

  if (agreed) {
    rows.push(['Platba', contract.payment_status === 'paid' ? 'Zaplaceno' : 'Zpracovává se']);
    if (contract.code) rows.push(['Rezervační kód', contract.code]);
    rows.push(['Zrušení zdarma', `do ${dateTime.format(new Date(contract.free_cancellation_until))} v sekci Rezervace`]);
    notes.push('Když na termín nepřijdeš, zaplacená částka se nevrací.');
    notes.push('Reklamaci služby vyřizuje poskytovatel, nejlépe hned na místě.');
    notes.push(`Rezervace se řídí obchodními podmínkami FLEK${contract.terms_version ? ` ve verzi ${contract.terms_version}` : ''}: ${APP}/podminky`);
  } else {
    if (contract.payment_status === 'refunded') rows.push(['Platba', 'Peníze jsme vrátili na tvou kartu.']);
    else if (contract.payment_status === 'paid') rows.push(['Platba', 'Vracíme celou částku na tvou kartu. Připsání závisí na bance.']);
    else if (contract.authorization_state === 'released' || contract.authorization_state === 'release_pending' || contract.payment_status === 'failed') {
      rows.push(['Platba', 'Nic neplatíš. Blokace na kartě se uvolní, jak rychle zmizí z výpisu, záleží na bance.']);
    }
    if (contract.cancellation_reason) rows.push(['Důvod', contract.cancellation_reason]);
  }
  notes.push('Spor můžeš řešit i mimosoudně u České obchodní inspekce: https://adr.coi.cz');
  return { rows, notes };
}

function buttonLabel(href: string): string {
  if (href === '/partner/provozovna') return 'Otevřít provozovnu';
  if (href === '/profil') return 'Otevřít profil';
  return 'Otevřít rezervace';
}

export function composeEmail(job: EmailJob, operator: Operator | null): { subject: string; text: string; html: string } {
  const details = job.contract ? contractDetails(job.contract) : null;
  const footer = operatorLine(operator);
  const link = `${APP}${job.href}`;

  const text = [
    job.title,
    '',
    job.body,
    ...(details ? ['', ...details.rows.map(([label, value]) => `${label}: ${value}`), '', ...details.notes] : []),
    '',
    `${buttonLabel(job.href)}: ${link}`,
    '',
    footer ?? 'FLEK',
  ].join('\n');

  const rowsHtml = details
    ? `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px;line-height:1.45">${details.rows
      .map(([label, value]) => `<tr><td style="padding:8px 12px 8px 0;border-top:1px solid #e1e4ee;color:#545970;vertical-align:top;width:38%">${escapeHtml(label)}</td><td style="padding:8px 0;border-top:1px solid #e1e4ee;font-weight:700;vertical-align:top">${escapeHtml(value)}</td></tr>`)
      .join('')}</table></td></tr><tr><td style="padding-top:12px;font-size:14px;line-height:1.5;color:#545970">${details.notes.map((note) => `<p style="margin:6px 0">${escapeHtml(note)}</p>`).join('')}</td></tr>`
    : '';
  const footerHtml = footer
    ? `<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.5;color:#545970;text-align:center">${escapeHtml(footer)}</td></tr>`
    : '';

  const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#f3f4f8;color:#10121f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:24px;padding:32px"><tr><td style="padding-bottom:4px"><img src="https://www.app-flek.eu/images/email-logo.png" alt="FLEK" width="135" height="54" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:135px;max-width:100%"></td></tr><tr><td style="padding-top:28px;font-size:24px;font-weight:800">${escapeHtml(job.title)}</td></tr><tr><td style="padding-top:12px;font-size:16px;line-height:1.55;color:#545970">${escapeHtml(job.body)}</td></tr>${rowsHtml}<tr><td style="padding-top:24px"><a href="${escapeHtml(link)}" style="display:block;border-radius:14px;background:#2c26d2;padding:15px 20px;color:#fff;text-align:center;font-size:16px;font-weight:700;text-decoration:none">${buttonLabel(job.href)}</a></td></tr></table></td></tr>${footerHtml}</table></body></html>`;

  return { subject: `${job.title} — FLEK`, text, html };
}
