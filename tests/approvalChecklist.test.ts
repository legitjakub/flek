import { describe, expect, it } from 'vitest';
import { approvalBlocker, approvalChecklist } from '../src/features/admin/approvalChecklist';
import type { AdminBusiness } from '../src/types/database';

/**
 * Seznam počítá totéž, na čem schválení odmítne server (`PROVIDER_DETAILS_REQUIRED`):
 * skutečný podnik musí mít IČO, ukázkový ne. Ostatní řádky jsou informace, ne překážka.
 */
function business(overrides: Partial<AdminBusiness> = {}): AdminBusiness {
  return {
    id: 'b1', display_name: 'Studio Dobrá hodina', legal_name: null, slug: 'studio', description: '',
    category_slug: 'vlasy', phone: '+420777123456', public_email: 'studio@example.com', website: null,
    address_line: 'Sinkulova 25', city: 'Praha', district: 'Podolí', postal_code: '14000', country: 'CZ',
    logo_url: null, cover_url: null, google_place_id: null, status: 'pending', status_reason: null,
    commission_rate: 0, cancellation_window_minutes: 60, latitude: 50, longitude: 14,
    owner_email: 'majitel@example.com', upcoming_offers: 3, is_demo: false,
    stripe_account_id: 'acct_1', stripe_charges_enabled: true,
    services: [{ id: 's1', name: 'Střih', duration_minutes: 45, normal_price_cents: 60000, is_active: true }],
    billing: { ico: '12345678', dic: null, seller_type: 'individual', legal_name: null, contact_person: null,
      contact_phone: null, terms_accepted_at: '2026-09-20T10:00:00Z', ares_name: 'Jan Novák',
      ares_address: null, ares_checked_at: '2026-09-20T10:00:00Z', billing_address_line: null,
      billing_city: null, billing_postal_code: null },
    ...overrides,
  } as AdminBusiness;
}

describe('approvalChecklist', () => {
  it('u vyplněného podniku nic neblokuje', () => {
    expect(approvalBlocker(business())).toBeNull();
    expect(approvalChecklist(business()).every((item) => item.ok)).toBe(true);
  });

  it('bez IČO schválení blokuje a řekne, kdo ho doplní', () => {
    const missing = business({ billing: { ...business().billing!, ico: null } });
    expect(approvalBlocker(missing)).toBe('chybí IČO');
    const ico = approvalChecklist(missing).find((item) => item.key === 'ico');
    expect(ico?.ok).toBe(false);
    expect(ico?.blocking).toBe(true);
  });

  it('ukázkový podnik smí jít ven bez IČO, stejně jako to bere server', () => {
    const demo = business({ is_demo: true, billing: { ...business().billing!, ico: null } });
    expect(approvalBlocker(demo)).toBeNull();
    expect(approvalChecklist(demo).find((item) => item.key === 'ico')?.detail).toContain('Ukázkový');
  });

  it('chybějící Stripe, služby ani podmínky schválení neblokují', () => {
    const bare = business({
      stripe_account_id: null, stripe_charges_enabled: false, services: [],
      billing: { ...business().billing!, terms_accepted_at: null },
    });
    expect(approvalBlocker(bare)).toBeNull();
    const notOk = approvalChecklist(bare).filter((item) => !item.ok).map((item) => item.key);
    expect(notOk.sort()).toEqual(['services', 'stripe', 'terms']);
  });

  it('podnik úplně bez fakturačních údajů nespadne', () => {
    const empty = business({ billing: null });
    expect(approvalBlocker(empty)).toContain('IČO');
    expect(approvalChecklist(empty).find((item) => item.key === 'ico')?.detail).toContain('Fakturační údaje');
    expect(approvalChecklist(empty)).toHaveLength(6);
  });
});
