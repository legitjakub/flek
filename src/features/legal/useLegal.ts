import { useQuery } from '@tanstack/react-query';
import { legalInfo } from '../../lib/api';
import type { LegalInfo } from '../../types/database';
import { LEGAL_DOCUMENTS, type LegalKind } from './documents';

export function useLegalInfo() {
  return useQuery({ queryKey: ['legal-info'], queryFn: legalInfo, staleTime: 600_000 });
}

/**
 * The legal texts can be shown and linked once the operator's details are filled in and the
 * customer terms are in force. Until then nothing links to a page that could not say who runs FLEK.
 */
export function legalPublished(info: LegalInfo | null | undefined): info is LegalInfo {
  const operator = info?.operator;
  return Boolean(operator?.name && operator.ico && operator.address && operator.email && info?.documents.customer_terms?.version);
}

const dateFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });

export function legalDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Values for the `{{…}}` placeholders of one document. The version shown is the one of the text itself. */
export function documentValues(info: LegalInfo, kind: LegalKind): Record<string, string | null> {
  const state = info.documents[kind];
  return {
    provozovatel: info.operator.name,
    ico: info.operator.ico,
    sidlo: info.operator.address,
    email: info.operator.email,
    verze: LEGAL_DOCUMENTS[kind].version,
    ucinnost: state?.effective_at ? legalDate(state.effective_at) : null,
  };
}
