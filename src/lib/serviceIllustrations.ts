const PREPARED_ILLUSTRATIONS: Array<[needle: string, imageUrl: string]> = [
  ['padel', '/images/services/padel-prague.jpg'],
  ['tenis', '/images/services/tennis-prague.jpg'],
  ['squash', '/images/services/squash-prague.jpg'],
  ['badminton', '/images/services/badminton-prague.jpg'],
  ['osobni trenink', '/images/services/personal-training-prague.jpg'],
  ['skupinova lekce', '/images/services/group-class-prague.jpg'],
];

function searchable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
}

/** Prepared activities always use their exact illustration, including older saved services. */
export function serviceIllustration(serviceName: string, savedImage?: string | null): string | null {
  const name = searchable(serviceName);
  return PREPARED_ILLUSTRATIONS.find(([needle]) => name.includes(needle))?.[1] ?? savedImage ?? null;
}
