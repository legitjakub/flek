/** Original FLEK illustrations, composed for square/portrait cards and wide details.
 * The merchant's saved image always takes precedence. */
export const ACTIVITY_GALLERIES: Record<string, string[]> = {
  'vlasy-pansky-strih': ['/images/activities/vlasy-pansky-strih-1.jpg', '/images/activities/vlasy-pansky-strih-2.jpg'],
  'vlasy-uprava-vousu': ['/images/activities/vlasy-uprava-vousu-1.jpg', '/images/activities/vlasy-uprava-vousu-2.jpg'],
  'vlasy-damsky-strih': ['/images/activities/vlasy-damsky-strih-1.jpg', '/images/activities/vlasy-damsky-strih-2.jpg'],
  'vlasy-barveni': ['/images/activities/vlasy-barveni-1.jpg', '/images/activities/vlasy-barveni-2.jpg'],
  'vlasy-myti-foukana': ['/images/activities/vlasy-myti-foukana-1.jpg', '/images/activities/vlasy-myti-foukana-2.jpg'],
  'vlasy-detsky-strih': ['/images/activities/vlasy-detsky-strih-1.jpg', '/images/activities/vlasy-detsky-strih-2.jpg'],
  'masaze-relaxacni': ['/images/activities/masaze-relaxacni-1.jpg', '/images/activities/masaze-relaxacni-2.jpg'],
  'masaze-thajska': ['/images/activities/masaze-thajska-1.jpg', '/images/activities/masaze-thajska-2.jpg'],
  'masaze-zada-sije': ['/images/activities/masaze-zada-sije-1.jpg', '/images/activities/masaze-zada-sije-2.jpg'],
  'masaze-sportovni': ['/images/activities/masaze-sportovni-1.jpg', '/images/activities/masaze-sportovni-2.jpg'],
  'masaze-chodidla': ['/images/activities/masaze-chodidla-1.jpg', '/images/activities/masaze-chodidla-2.jpg'],
  'masaze-lavove-kameny': ['/images/activities/masaze-lavove-kameny-1.jpg', '/images/activities/masaze-lavove-kameny-2.jpg'],
  'krasa-manikura': ['/images/activities/krasa-manikura-1.jpg', '/images/activities/krasa-manikura-2.jpg'],
  'krasa-gel-lak': ['/images/activities/krasa-gel-lak-1.jpg', '/images/activities/krasa-gel-lak-2.jpg'],
  // Proven local activity photos remain available while the rest of the original set is made.
  // Never point the app at an asset that does not exist: a broken photo is worse than one
  // carefully chosen current illustration.
  'sport-padel': ['/images/services/padel-prague.jpg'],
  'sport-tenis': ['/images/services/tennis-prague.jpg'],
  'sport-squash': ['/images/services/squash-prague.jpg'],
  'sport-badminton': ['/images/services/badminton-prague.jpg'],
  'sport-osobni-trenink': ['/images/services/personal-training-prague.jpg'],
  'sport-skupinova-lekce': ['/images/services/group-class-prague.jpg'],
  'joga-vinyasa': ['/images/services/yoga-prague.jpg'],
  'joga-jemna': ['/images/services/yoga-prague.jpg'],
  'joga-power': ['/images/services/yoga-prague.jpg'],
  'joga-rani-protazeni': ['/images/services/yoga-prague.jpg'],
  'joga-zacatecnici': ['/images/services/yoga-prague.jpg'],
  'joga-meditace': ['/images/services/yoga-prague.jpg'],
  'wellness-privatni-sauna': ['/images/services/sauna-prague.jpg'],
  'wellness-finska-sauna': ['/images/services/sauna-prague.jpg'],
};

export const ACTIVITY_LABELS: Record<string, string> = {
  "vlasy-pansky-strih": "Pánský střih",
  "vlasy-uprava-vousu": "Úprava vousů",
  "vlasy-damsky-strih": "Dámský střih",
  "vlasy-barveni": "Barvení vlasů",
  "vlasy-myti-foukana": "Mytí a foukaná",
  "vlasy-detsky-strih": "Dětský střih",
  "masaze-relaxacni": "Relaxační masáž",
  "masaze-thajska": "Thajská masáž",
  "masaze-zada-sije": "Masáž zad a šíje",
  "masaze-sportovni": "Sportovní masáž",
  "masaze-chodidla": "Masáž chodidel",
  "masaze-lavove-kameny": "Lávové kameny",
  "krasa-manikura": "Manikúra",
  "krasa-gel-lak": "Gel lak",
  "krasa-pedikura": "Pedikúra",
  "krasa-kosmeticke-osetreni": "Kosmetické ošetření",
  "krasa-oboci": "Úprava obočí",
  "krasa-rasy": "Prodloužení řas",
  "sport-padel": "Padelový kurt",
  "sport-tenis": "Tenisový kurt",
  "sport-squash": "Squashový kurt",
  "sport-badminton": "Badminton",
  "sport-osobni-trenink": "Osobní trénink",
  "sport-skupinova-lekce": "Skupinová lekce",
  "joga-vinyasa": "Vinyasa jóga",
  "joga-jemna": "Jemná jóga",
  "joga-power": "Power jóga",
  "joga-rani-protazeni": "Ranní protažení",
  "joga-zacatecnici": "Jóga pro začátečníky",
  "joga-meditace": "Meditace",
  "wellness-privatni-sauna": "Privátní sauna",
  "wellness-finska-sauna": "Finská sauna",
  "wellness-solna-jeskyne": "Solná jeskyně",
  "wellness-virivka": "Vířivka",
  "wellness-parni-lazen": "Parní lázeň",
  "wellness-odpocinek": "Odpočinková procedura",
  "sport-pujceni-kola": "Půjčení kola"
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs-CZ');

/** Category guards prevent, for example, a massage for tennis elbow getting a court. */
export function activityForName(name: string, category?: string | null): string | undefined {
  const normalized = normalize(name);
  const aliases: Record<string, string[]> = {
    'sport-padel': ['padel'],
    'sport-squash': ['squash'],
    'sport-pujceni-kola': ['pujceni kola', 'pujcovna kol', 'pronajem kola'],
    'sport-tenis': ['tenis'],
    'krasa-manikura': ['pece o ruce', 'manikura'],
    'wellness-privatni-sauna': ['sauna a odpocinek'],
  };
  return Object.keys(ACTIVITY_LABELS)
    .filter((slug) => !category || slug.startsWith(`${category}-`))
    .sort((a, b) => ACTIVITY_LABELS[b].length - ACTIVITY_LABELS[a].length)
    .find((slug) => [ACTIVITY_LABELS[slug], ...(aliases[slug] ?? [])].some((label) => normalized.includes(normalize(label))));
}

/** Only our generated assets have guaranteed local responsive derivatives. */
export function activityPhotoSrcSet(url: string): string | undefined {
  return /^\/images\/activities\/[a-z0-9-]+-[12]\.jpg$/.test(url)
    ? `${url.replace(/\.jpg$/, '-800.jpg')} 800w, ${url} 1254w`
    : undefined;
}
