import customerTerms from '../../content/pravni/podminky.md?raw';
import merchantTerms from '../../content/pravni/podminky-podniky.md?raw';
import privacy from '../../content/pravni/soukromi.md?raw';

export type LegalKind = 'customer_terms' | 'merchant_terms' | 'privacy';

export type LegalDocument = {
  kind: LegalKind;
  path: string;
  /** Short name for links and page titles. */
  label: string;
  /** The version of the text in this build. The database decides from when a version is in force. */
  version: string;
  source: string;
};

export const LEGAL_DOCUMENTS: Record<LegalKind, LegalDocument> = {
  customer_terms: { kind: 'customer_terms', path: '/podminky', label: 'Obchodní podmínky', version: '1.0', source: customerTerms },
  merchant_terms: { kind: 'merchant_terms', path: '/podminky-podniky', label: 'Podmínky pro podniky', version: '1.0', source: merchantTerms },
  privacy: { kind: 'privacy', path: '/soukromi', label: 'Ochrana osobních údajů', version: '1.1', source: privacy },
};

export const LEGAL_ORDER: LegalKind[] = ['customer_terms', 'privacy', 'merchant_terms'];
