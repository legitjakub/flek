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
      <h2 id="o-fleku" className="text-base font-extrabold tracking-tight text-ink">O FLEKu</h2>
      <p className="mt-2 leading-relaxed">
        FLEK provozuje {operatorIdentification(legal)}
        {operator.ico ? ', podnikatel zapsaný v živnostenském rejstříku' : null}.
      </p>
      <p className="mt-1 leading-relaxed">
        Podpora a kontaktní místo:{' '}
        <a href={`mailto:${operator.email}`} className="font-bold text-ink underline underline-offset-4">{operator.email}</a>
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5">
        {inForce.map((kind) => (
          <li key={kind}>
            <Link to={LEGAL_DOCUMENTS[kind].path} className="inline-flex min-h-11 items-center font-bold text-ink underline underline-offset-4">
              {LEGAL_DOCUMENTS[kind].label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs leading-relaxed">
        Mimosoudní řešení spotřebitelských sporů: Česká obchodní inspekce,{' '}
        <a href="https://adr.coi.cz" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">adr.coi.cz</a>
      </p>
    </footer>
  );
}
