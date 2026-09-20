import { useEffect } from 'react';
import { LoadingList } from '../../components/ui';
import { LEGAL_DOCUMENTS, type LegalKind } from './documents';
import { LegalFooter } from './LegalFooter';
import { fillPlaceholders, LegalMarkdown } from './markdown';
import { documentValues, legalPublished, privacyPublished, useLegalInfo } from './useLegal';

export function LegalPage({ kind }: { kind: LegalKind }) {
  const info = useLegalInfo();
  const document = LEGAL_DOCUMENTS[kind];
  // Zásady se zveřejní i bez IČO (viz privacyPublished); obchodní podmínky předpokládají podnikatele.
  const gate = kind === 'privacy' ? privacyPublished : legalPublished;
  const published = gate(info.data) && Boolean(info.data.documents[kind]?.version);

  useEffect(() => {
    const previous = window.document.title;
    window.document.title = `${document.label} — FLEK`;
    return () => { window.document.title = previous; };
  }, [document.label]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-6 pb-10">
      {info.isPending ? (
        <LoadingList rows={4} />
      ) : published && info.data ? (
        <article>
          <LegalMarkdown source={fillPlaceholders(document.source, documentValues(info.data, kind))} />
        </article>
      ) : (
        <section>
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-ink">{document.label}</h1>
          <p className="mt-2 text-base text-muted">Tento dokument právě připravujeme.</p>
        </section>
      )}
      <LegalFooter />
    </main>
  );
}
