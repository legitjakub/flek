import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fillPlaceholders, parseLegal, slug } from '../src/features/legal/markdown';
import { LEGAL_DOCUMENTS, LEGAL_ORDER } from '../src/features/legal/documents';
import { documentValues, legalPublished } from '../src/features/legal/useLegal';
import { dac7Csv } from '../src/features/admin/dac7';
import type { Dac7Row, LegalInfo } from '../src/types/database';

const APP_ROUTES = ['/', '/mapa', '/rezervace', '/profil', '/partner', ...Object.values(LEGAL_DOCUMENTS).map((doc) => doc.path)];

const info: LegalInfo = {
  operator: { name: 'Jan Novák', ico: '12345678', address: 'Ulice 1, 110 00 Praha', email: 'podpora@example.cz' },
  documents: {
    customer_terms: { version: '1.0', effective_at: '2026-09-16T08:00:00Z', upcoming_version: null, upcoming_effective_at: null },
    merchant_terms: { version: '1.0', effective_at: '2026-09-16T08:00:00Z', upcoming_version: null, upcoming_effective_at: null },
    privacy: { version: '1.0', effective_at: '2026-09-16T08:00:00Z', upcoming_version: null, upcoming_effective_at: null },
  },
  server_now: '2026-09-16T09:00:00Z',
};

describe('legal markdown', () => {
  it('parses headings, paragraphs, both kinds of lists and tables', () => {
    const blocks = parseLegal([
      '# Nadpis',
      '',
      'První řádek',
      'pokračuje.',
      '',
      '- jedna',
      '- dvě',
      '1. první',
      '2. druhý',
      '',
      '| A | B |',
      '| --- | --- |',
      '| a1 | b1 |',
      '| a2 | b2 |',
      'Konec',
    ].join('\n'));
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Nadpis' },
      { kind: 'paragraph', text: 'První řádek pokračuje.' },
      { kind: 'list', ordered: false, items: ['jedna', 'dvě'] },
      { kind: 'list', ordered: true, items: ['první', 'druhý'] },
      { kind: 'table', header: ['A', 'B'], rows: [['a1', 'b1'], ['a2', 'b2']] },
      { kind: 'paragraph', text: 'Konec' },
    ]);
  });

  it('fills placeholders and never leaves braces behind', () => {
    expect(fillPlaceholders('{{provozovatel}}, IČO {{ico}}, {{neznamy}}', { provozovatel: 'Jan Novák', ico: '12345678' }))
      .toBe('Jan Novák, IČO 12345678, —');
  });

  it('makes heading anchors without diacritics or numbering', () => {
    expect(slug('7. Odstoupení od smlouvy')).toBe('odstoupeni-od-smlouvy');
  });
});

describe('legal documents', () => {
  const migrations = readdirSync('supabase/migrations').map((file) => readFileSync(join('supabase/migrations', file), 'utf8')).join('\n');

  for (const kind of LEGAL_ORDER) {
    const document = LEGAL_DOCUMENTS[kind];

    it(`${kind}: states its version and effective date and carries no markup`, () => {
      expect(document.source).toContain('{{verze}}');
      expect(document.source).toContain('{{ucinnost}}');
      expect(document.source).not.toMatch(/<\/?[a-z][^>]*>/i);
      const filled = fillPlaceholders(document.source, documentValues(info, kind));
      expect(filled).not.toContain('{{');
      expect(filled).toContain('Jan Novák');
      expect(parseLegal(filled)[0]).toMatchObject({ kind: 'heading', level: 1 });
    });

    it(`${kind}: links only to pages that exist`, () => {
      const links = [...document.source.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
      for (const link of links) {
        if (link.startsWith('/')) expect(APP_ROUTES).toContain(link);
        else expect(link).toMatch(/^https:\/\//);
      }
    });

    it(`${kind}: the version of the text exists in the database migrations`, () => {
      expect(migrations).toContain(`('${kind}', '${document.version}')`);
    });
  }

  it('publishes the texts only with complete operator details and terms in force', () => {
    expect(legalPublished(info)).toBe(true);
    expect(legalPublished({ ...info, operator: { ...info.operator, ico: null } })).toBe(false);
    expect(legalPublished({ ...info, documents: { ...info.documents, customer_terms: { ...info.documents.customer_terms!, version: null } } })).toBe(false);
    expect(legalPublished(undefined)).toBe(false);
  });

  it('shows the version of the text itself and the effective date in Prague', () => {
    expect(documentValues(info, 'privacy')).toMatchObject({ verze: '1.0', ucinnost: '16. 9. 2026', email: 'podpora@example.cz' });
  });
});

describe('DAC7 export', () => {
  it('writes one semicolon row per venue with crowns and a BOM', () => {
    const row = {
      business_id: 'b', display_name: 'Studio; Praha', legal_name: 'Jan "Honza" Novák', seller_type: 'individual', ico: '12345678',
      dic: null, birth_date: '1990-01-31', country: 'CZ', address: 'Ulice 1, 11000 Praha', stripe_account_id: 'acct_1',
      ares_checked_at: '2026-09-16T08:00:00Z', demo: false,
      q1_count: 2, q1_payout_cents: 150000, q1_fee_cents: 7500, q2_count: 0, q2_payout_cents: 0, q2_fee_cents: 0,
      q3_count: 1, q3_payout_cents: 75050, q3_fee_cents: 3800, q4_count: 0, q4_payout_cents: 0, q4_fee_cents: 0,
    } as Dac7Row;
    const [header, line] = dac7Csv([row]).replace(/^\uFEFF/, '').trim().split('\n');
    expect(dac7Csv([row]).startsWith('\uFEFF')).toBe(true);
    expect(header.split(';')).toHaveLength(23);
    expect(line).toBe('"Studio; Praha";"Jan ""Honza"" Novák";fyzická osoba;12345678;;1990-01-31;CZ;Ulice 1, 11000 Praha;acct_1;ano;ne;2;1500,00;75,00;0;0,00;0,00;1;750,50;38,00;0;0,00;0,00');
  });
});
