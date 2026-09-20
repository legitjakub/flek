import type { AdminBusiness } from '../../types/database';

/**
 * Co má admin u provozovny zkontrolovat, než ji pustí mezi zákazníky — a co z toho server
 * vyžaduje tak přísně, že by schválení odmítl.
 *
 * Bylo to opačně: administrace ukazovala jen název, kontakt a služby, takže se o chybějícím
 * IČO admin dozvěděl až tím, že „Schválit“ nic neudělalo (`PROVIDER_DETAILS_REQUIRED`).
 * Seznam je proto počítaný ze stejných údajů, na kterých to odmítne `admin_set_business_status`.
 */
export type CheckItem = {
  key: string;
  label: string;
  ok: boolean;
  /** Co je vyplněné, nebo co chybí a kdo to doplní. */
  detail: string;
  /** Bez tohohle schválení neprojde. */
  blocking: boolean;
};

const dateFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });

function day(iso: string | null | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : '';
}

function filled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

export function approvalChecklist(business: AdminBusiness): CheckItem[] {
  const billing = business.billing ?? null;
  const active = business.services.filter((service) => service.is_active).length;
  const ares = [billing?.ares_name, billing?.ares_checked_at ? `ověřeno v ARES ${day(billing.ares_checked_at)}` : null]
    .filter(Boolean).join(' · ');

  return [
    {
      key: 'ico',
      label: 'Kdo službu poskytuje',
      // Ukázkový podnik smí jít ven bez IČO, u skutečného to server odmítne.
      ok: business.is_demo || filled(billing?.ico),
      blocking: !business.is_demo,
      detail: filled(billing?.ico)
        ? [`IČO ${billing?.ico}`, billing?.dic ? `DIČ ${billing.dic}` : null,
           billing?.seller_type === 'entity' ? 'právnická osoba' : 'podnikající fyzická osoba',
           ares || null].filter(Boolean).join(' · ')
        : business.is_demo
          ? 'Ukázkový podnik — IČO se nevyžaduje.'
          : 'Chybí IČO. Podnik ho doplní v Provozovně → Fakturační údaje, ověří se v ARES.',
    },
    {
      key: 'terms',
      label: 'Souhlas s podmínkami',
      ok: filled(billing?.terms_accepted_at),
      blocking: false,
      detail: filled(billing?.terms_accepted_at)
        ? `Odsouhlaseno ${day(billing?.terms_accepted_at)}`
        : 'Podnik zatím nesouhlasil s podmínkami pro podniky.',
    },
    {
      key: 'contact',
      label: 'Kontakt',
      ok: filled(business.phone) && filled(business.public_email),
      blocking: false,
      detail: [business.phone, business.public_email,
               billing?.contact_person ? `kontakt ${billing.contact_person}` : null]
        .filter(Boolean).join(' · ') || 'Chybí telefon nebo veřejný e-mail.',
    },
    {
      key: 'address',
      label: 'Adresa',
      ok: filled(business.address_line) && filled(business.city) && filled(business.postal_code),
      blocking: false,
      detail: [business.address_line, [business.postal_code, business.city].filter(Boolean).join(' ')]
        .filter(Boolean).join(', ') || 'Chybí adresa provozovny.',
    },
    {
      key: 'services',
      label: 'Služby',
      ok: active > 0,
      blocking: false,
      detail: active > 0
        ? `${active} ${active < 5 ? 'aktivní' : 'aktivních'} · ${business.upcoming_offers} nadcházejících FLEKů`
        : 'Zatím žádná aktivní služba — nebude co zveřejnit.',
    },
    {
      key: 'stripe',
      label: 'Platby přes Stripe',
      ok: Boolean(business.stripe_account_id) && Boolean(business.stripe_charges_enabled),
      blocking: false,
      detail: business.stripe_account_id
        ? (business.stripe_charges_enabled ? 'Účet propojený, platby zapnuté.' : 'Účet propojený, ale platby zatím nejsou zapnuté.')
        : 'Nepropojený. Schválit jde i tak, ale FLEK podnik zveřejní až se Stripe.',
    },
  ];
}

/**
 * Krátká věta k tlačítku, proč „Schválit“ neprojde, nebo `null`, když projde. Podrobnost
 * (kdo a kde to doplní) nese řádek seznamu, aby to pod sebou nestálo dvakrát.
 */
export function approvalBlocker(business: AdminBusiness): string | null {
  const blocked = approvalChecklist(business).find((item) => item.blocking && !item.ok);
  if (!blocked) return null;
  return blocked.key === 'ico' ? 'chybí IČO' : `chybí ${blocked.label.toLocaleLowerCase('cs-CZ')}`;
}
