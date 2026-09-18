import { describe, expect, it } from 'vitest';
import { composeEmail, contractDetails, operatorLine, type Contract } from '../supabase/functions/_shared/email';
import { parseAres, validIco } from '../supabase/functions/_shared/ares';

const operator = { name: 'Jan Novák', ico: '12345678', address: 'Ulice 1, 110 00 Praha', email: 'podpora@example.cz' };

const confirmed: Contract = {
  status: 'confirmed',
  code: 'FLEK-7K2QHM',
  service: 'Pánský střih',
  business: 'Studio Dobrá hodina',
  address: 'Korunní 42, Praha',
  start_at: '2026-09-16T15:00:00Z',
  end_at: '2026-09-16T15:45:00Z',
  price_cents: 78800,
  service_fee_cents: 3800,
  free_cancellation_until: '2026-09-16T14:00:00Z',
  payment_status: 'paid',
  refund_status: null,
  authorization_state: 'captured',
  cancellation_reason: null,
  provider: { name: 'Studio s.r.o.', ico: '87654321', address: 'Korunní 42, 12000 Praha', demo: false },
  terms_version: '1.0',
};

describe('booking e-mails', () => {
  it('confirms the contract with provider, price, code, cancellation and terms', () => {
    const { rows, notes } = contractDetails(confirmed);
    const byLabel = Object.fromEntries(rows);
    expect(byLabel['Poskytovatel']).toBe('Studio s.r.o., IČO 87654321, Korunní 42, 12000 Praha');
    expect(byLabel['Cena']).toBe('788 Kč včetně servisního poplatku FLEK 38 Kč');
    expect(byLabel['Rezervační kód']).toBe('FLEK-7K2QHM');
    expect(byLabel['Termín']).toContain('17:00');
    expect(byLabel['Zrušení zdarma']).toContain('16:00');
    expect(notes.join(' ')).toContain('obchodními podmínkami FLEK ve verzi 1.0: https://www.app-flek.eu/podminky');
  });

  it('never shows a code for a request the venue did not agree to, and says the hold is released', () => {
    const { rows } = contractDetails({ ...confirmed, status: 'rejected', code: null, payment_status: 'failed', authorization_state: 'released', cancellation_reason: 'Podnik rezervaci nepotvrdil.' });
    const byLabel = Object.fromEntries(rows);
    expect(byLabel['Rezervační kód']).toBeUndefined();
    expect(byLabel['Platba']).toContain('Nic neplatíš');
    expect(byLabel['Důvod']).toBe('Podnik rezervaci nepotvrdil.');
  });

  it('keeps the public demo from posing as a provider', () => {
    const { rows } = contractDetails({ ...confirmed, provider: { name: 'Studio Dobrá hodina', ico: null, address: null, demo: true } });
    expect(Object.fromEntries(rows)['Poskytovatel']).toBeUndefined();
  });

  it('ends every e-mail with the operator and escapes what it prints', () => {
    const email = composeEmail({ title: 'Tvůj FLEK je <potvrzený>', body: 'Pánský střih', href: '/rezervace', contract: confirmed }, operator);
    expect(email.subject).toBe('Tvůj FLEK je <potvrzený> — FLEK');
    expect(email.html).toContain('Tvůj FLEK je &lt;potvrzený&gt;');
    expect(email.html).not.toContain('<potvrzený>');
    expect(email.text).toContain('Rezervační kód: FLEK-7K2QHM');
    expect(email.text).toContain(operatorLine(operator)!);
    expect(email.html).toContain('FLEK provozuje Jan Novák, IČO 12345678');
  });

  it('leaves the footer out until the operator details are complete', () => {
    expect(operatorLine({ ...operator, ico: null })).toBeNull();
    const email = composeEmail({ title: 'Provozovna je schválená', body: 'Studio', href: '/partner/provozovna' }, null);
    expect(email.text.trim().endsWith('FLEK')).toBe(true);
    expect(email.html).toContain('Otevřít provozovnu');
  });
});

describe('ARES', () => {
  it('checks the IČO check digit', () => {
    expect(validIco('00006947')).toBe(true);
    expect(validIco('00006948')).toBe(false);
    expect(validIco('6947')).toBe(false);
  });

  it('reads the official name, seat and legal form', () => {
    const entity = parseAres({
      ico: '00006947',
      obchodniJmeno: 'Ministerstvo financí',
      pravniForma: '325',
      dic: 'CZ00006947',
      sidlo: { nazevObce: 'Praha', nazevUlice: 'Letenská', cisloDomovni: 525, cisloOrientacni: 15, psc: 11800, textovaAdresa: 'Letenská 525/15, Malá Strana, 11800 Praha 1' },
    });
    expect(entity).toMatchObject({
      name: 'Ministerstvo financí', line: 'Letenská 525/15', city: 'Praha', postal_code: '11800',
      address: 'Letenská 525/15, Malá Strana, 11800 Praha 1', seller_type: 'entity', dic: 'CZ00006947', ended: false,
    });
    expect(parseAres({ ico: '12345678', obchodniJmeno: 'Jan Novák', pravniForma: '101', sidlo: { nazevObce: 'Brno', psc: 60200 } }))
      .toMatchObject({ seller_type: 'individual', line: null, address: '60200 Brno' });
    expect(parseAres({ kod: 'NENALEZENO' })).toBeNull();
  });
});
