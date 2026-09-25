import type { WhatsAppTemplateSetup } from '../../lib/api';

/**
 * What stops WhatsApp at Meta's end, in Czech and with where to fix it. Meta reports it as
 * `health_status` of the business, the WhatsApp account, the app and the number: an entity that
 * cannot send lists its errors. Calling over SIP is not something FLEK uses, so those are left out.
 */
export type MetaBlocker = { code: number | null; title: string; fix: string };

const IGNORED = new Set([138024, 138025]);

const KNOWN: Record<number, Omit<MetaBlocker, 'code'>> = {
  141006: {
    title: 'Chybí platební metoda u WhatsApp účtu',
    fix: 'Meta bez ní neposílá žádné zprávy, které začíná FLEK (šablony). Meta Business Suite → Nastavení → Platby → WhatsApp účet → Přidat platební metodu.',
  },
  131000: {
    title: 'Profil firmy u Mety není úplný',
    fix: 'Chybí právní název, země a web; dokud nejsou vyplněné, Meta neprovede kontroly a šablony čekají. Meta Business Suite → Nastavení → Informace o firmě.',
  },
  141010: {
    title: 'Firma u Mety není ověřená',
    fix: 'Meta Business Suite → Nastavení → Centrum zabezpečení → Ověření firmy → Zahájit; nahrát doklad o podnikání (živnostenský list nebo výpis z rejstříku s IČO).',
  },
};

type Entity = { can_send_message?: string; errors?: { error_code?: number; error_description?: string; possible_solution?: string }[] };
type Health = { can_send_message?: string; entities?: Entity[] };

function health(value: unknown): Health | null {
  return value && typeof value === 'object' && !('error' in value) ? (value as Health) : null;
}

/** Every distinct blocker Meta reports for the account and the number, most important first. */
export function metaBlockers(setup: Pick<WhatsAppTemplateSetup, 'account' | 'phone_health'>): MetaBlocker[] {
  const sources = [health(setup.account && 'health' in setup.account ? setup.account.health : null), health(setup.phone_health)];
  const seen = new Map<string, MetaBlocker>();
  for (const source of sources) {
    for (const entity of source?.entities ?? []) {
      if (entity.can_send_message !== 'BLOCKED' && entity.can_send_message !== 'LIMITED') continue;
      for (const error of entity.errors ?? []) {
        const code = typeof error.error_code === 'number' ? error.error_code : null;
        if (code !== null && IGNORED.has(code)) continue;
        const key = code === null ? error.error_description ?? '' : String(code);
        if (seen.has(key)) continue;
        const known = code !== null ? KNOWN[code] : undefined;
        seen.set(key, known
          ? { code, ...known }
          : { code, title: error.error_description ?? 'Meta hlásí problém', fix: error.possible_solution ?? '' });
      }
    }
  }
  const order = [131000, 141006, 141010];
  return [...seen.values()].sort((a, b) => rank(a.code) - rank(b.code));
  function rank(code: number | null) {
    const index = code === null ? -1 : order.indexOf(code);
    return index === -1 ? order.length : index;
  }
}

/** Whether Meta lets FLEK send at all: nothing blocked on the account and on the number. */
export function metaCanSend(setup: Pick<WhatsAppTemplateSetup, 'account' | 'phone_health'>): boolean {
  const account = health(setup.account && 'health' in setup.account ? setup.account.health : null);
  const phone = health(setup.phone_health);
  return account?.can_send_message === 'AVAILABLE' && (phone === null || phone.can_send_message === 'AVAILABLE');
}

/** Meta's own test number sends only to the few numbers added in API Setup, never to real venues. */
export function isMetaTestNumber(phone: { verified_name?: string | null; display_phone_number?: string | null } | null): boolean {
  if (!phone) return false;
  return phone.verified_name === 'Test Number' || /^\+?1[\s-]?555/.test(phone.display_phone_number ?? '');
}
