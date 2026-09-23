import { Link } from '../../app/router';
import { cx } from '../../components/ui';
import { LEGAL_DOCUMENTS, LEGAL_ORDER } from './documents';
import { operatorIdentification, privacyPublished, useLegalInfo } from './useLegal';

/**
 * Who runs FLEK and where its terms are: the identification a business owes on its website, in one
 * place at the end of the pages people look for it on. Written without tykání or vykání, because
 * customers and venues both read it.
 */
export function LegalFooter({ className }: { className?: string }) {
  const info = useLegalInfo();
  // Stačí zásady: identifikace provozovatele patří na web, jakmile je co ukázat. Odkazy pak
  // vedou jen na texty, které opravdu platí — obchodní podmínky čekají na IČO.
  if (!privacyPublished(info.data)) return null;
  const legal = info.data;
  const { operator } = legal;
  const inForce = LEGAL_ORDER.filter((kind) => legal.documents[kind]?.version);
  return (
    <footer aria-labelledby="o-fleku" className={cx('rounded-3xl bg-card p-5 text-sm text-muted shadow-card sm:p-6', className)}>
      {/*
        Four paragraphs each on their own line made a short footer read as a long one. Who runs
        FLEK is one block; the documents are a block of links that look like something to tap,
        not underlined words in a sentence. Two per row on a phone, because one full title per
        row was the sprawl — an odd last one takes the whole row rather than leaving a gap, and
        which one that is depends on how many documents are actually in force.
      */}
      <h2 id="o-fleku" className="text-base font-extrabold tracking-tight text-ink">O FLEKu</h2>
      <p className="mt-1.5 leading-relaxed">
        FLEK provozuje {operatorIdentification(legal)}
        {operator.ico ? ', podnikatel zapsaný v živnostenském rejstříku' : null}.
      </p>
      <p className="leading-relaxed">
        Podpora a kontaktní místo:{' '}
        <a href={`mailto:${operator.email}`} className="font-bold text-ink underline underline-offset-4">{operator.email}</a>
      </p>
      <nav aria-label="Právní texty" className="mt-4">
        <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {inForce.map((kind, index) => (
            <li key={kind} className={index === inForce.length - 1 && inForce.length % 2 === 1 ? 'col-span-2 sm:col-span-1' : ''}>
              <Link
                to={LEGAL_DOCUMENTS[kind].path}
                className="flex min-h-11 items-center justify-center rounded-2xl bg-accent-soft px-3 py-2 text-center text-xs font-bold text-accent transition-colors hover:bg-brand-soft sm:rounded-full sm:px-4"
              >
                {LEGAL_DOCUMENTS[kind].label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed">
        Mimosoudní řešení spotřebitelských sporů: Česká obchodní inspekce,{' '}
        <a href="https://adr.coi.cz" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">adr.coi.cz</a>
      </p>
    </footer>
  );
}
