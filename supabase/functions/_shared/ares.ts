/**
 * The Czech business register (ARES), read through its public REST API. Pure helpers, so the
 * checks run in unit tests as well as in the Edge Function.
 */

export type AresSubject = {
  ico: string;
  name: string;
  address: string;
  line: string | null;
  city: string | null;
  postal_code: string | null;
  seller_type: 'individual' | 'entity';
  dic: string | null;
  ended: boolean;
};

export function aresUrl(ico: string): string {
  return `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`;
}

/** Eight digits whose last one is the modulo-11 check digit of the first seven. */
export function validIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const sum = [...ico.slice(0, 7)].reduce((total, digit, index) => total + Number(digit) * (8 - index), 0);
  const remainder = sum % 11;
  const check = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
  return check === Number(ico[7]);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function parseAres(value: unknown): AresSubject | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const ico = text(record?.ico);
  const name = text(record?.obchodniJmeno);
  if (!record || !ico || !name) return null;
  const seat = record.sidlo && typeof record.sidlo === 'object' ? record.sidlo as Record<string, unknown> : {};
  const number = [seat.cisloDomovni, seat.cisloOrientacni].filter((part) => part !== null && part !== undefined && part !== '').join('/');
  const street = text(seat.nazevUlice) ?? text(seat.nazevCastiObce);
  const line = street ? `${street}${number ? ` ${number}` : ''}` : number ? `č. p. ${number}` : null;
  const postal = seat.psc !== null && seat.psc !== undefined && String(seat.psc).trim() ? String(seat.psc).padStart(5, '0') : null;
  const city = text(seat.nazevObce);
  // Legal forms 100–110 are natural persons in business; everything above is a legal entity.
  const form = Number(record.pravniForma);
  return {
    ico,
    name,
    address: text(seat.textovaAdresa) ?? [line, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    line,
    city,
    postal_code: postal,
    seller_type: form >= 100 && form <= 110 ? 'individual' : 'entity',
    dic: text(record.dic),
    ended: Boolean(text(record.datumZaniku)),
  };
}
