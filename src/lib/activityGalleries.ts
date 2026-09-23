/**
 * Illustrations for services whose venue has not uploaded a photograph of its own; the
 * merchant's saved image always takes precedence.
 *
 * Eight of the ten busiest activities use real photographs from Unsplash (free licence,
 * no attribution required, host already allowed in the CSP and in `private.is_allowed_picture`);
 * their size is handled by the Unsplash CDN through `thumbnail()`. The rest still use the
 * generated local set in `/images/activities/`, which gets its sizes from the `-800`/`-176`
 * derivatives — replacing those is the second round. Beard trimming and back massage stayed
 * generated on purpose: every photograph the search offered for them was either a person or a
 * vague interior, and a wrong picture is worse than a drawn one. No photograph carries a
 * recognisable face:
 * Unsplash gives no model release, and a marketplace must not suggest a person endorses a venue.
 */
export const ACTIVITY_GALLERIES: Record<string, string[]> = {
  'vlasy-pansky-strih': ['https://images.unsplash.com/photo-1600948836101-f9ffda59d250?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1781455793310-8427c96454c7?w=800&q=70&auto=format&fit=crop'],
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
  'krasa-manikura': ['https://images.unsplash.com/photo-1599948128020-9a44505b0d1b?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=800&q=70&auto=format&fit=crop'],
  'krasa-gel-lak': ['/images/activities/krasa-gel-lak-1.jpg', '/images/activities/krasa-gel-lak-2.jpg'],
  'krasa-pedikura': ['/images/activities/krasa-pedikura-1.jpg', '/images/activities/krasa-pedikura-2.jpg'],
  'krasa-kosmeticke-osetreni': ['/images/activities/krasa-kosmeticke-osetreni-1.jpg', '/images/activities/krasa-kosmeticke-osetreni-2.jpg'],
  'krasa-oboci': ['/images/activities/krasa-oboci-1.jpg', '/images/activities/krasa-oboci-2.jpg'],
  'krasa-rasy': ['/images/activities/krasa-rasy-1.jpg', '/images/activities/krasa-rasy-2.jpg'],
  'sport-padel': ['https://images.unsplash.com/photo-1658723826297-fe4d1b1e6600?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1657704358775-ed705c7388d2?w=800&q=70&auto=format&fit=crop'],
  'sport-tenis': ['https://images.unsplash.com/photo-1685880423505-3a9a5515efd9?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1774532665451-eff4bcd879e0?w=800&q=70&auto=format&fit=crop'],
  'sport-squash': ['/images/activities/sport-squash-1.jpg', '/images/activities/sport-squash-2.jpg'],
  'sport-badminton': ['/images/activities/sport-badminton-1.jpg', '/images/activities/sport-badminton-2.jpg'],
  'sport-osobni-trenink': ['https://images.unsplash.com/photo-1712220403561-bcf3f59d5927?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1639906188555-935e08bbcdf0?w=800&q=70&auto=format&fit=crop'],
  'sport-skupinova-lekce': ['/images/activities/sport-skupinova-lekce-1.jpg', '/images/activities/sport-skupinova-lekce-2.jpg'],
  'sport-pujceni-kola': ['https://images.unsplash.com/photo-1745947454393-74bc35250ffa?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1682737789112-badb2cf078b5?w=800&q=70&auto=format&fit=crop'],
  'joga-vinyasa': ['/images/activities/joga-vinyasa-1.jpg', '/images/activities/joga-vinyasa-2.jpg'],
  'joga-jemna': ['/images/activities/joga-jemna-1.jpg', '/images/activities/joga-jemna-2.jpg'],
  'joga-power': ['/images/activities/joga-power-1.jpg', '/images/activities/joga-power-2.jpg'],
  'joga-rani-protazeni': ['https://images.unsplash.com/photo-1646239646963-b0b9be56d6b5?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1763004871583-4183d64096b1?w=800&q=70&auto=format&fit=crop'],
  'joga-zacatecnici': ['/images/activities/joga-zacatecnici-1.jpg', '/images/activities/joga-zacatecnici-2.jpg'],
  'joga-meditace': ['/images/activities/joga-meditace-1.jpg', '/images/activities/joga-meditace-2.jpg'],
  'wellness-privatni-sauna': ['/images/activities/wellness-privatni-sauna-1.jpg', '/images/activities/wellness-privatni-sauna-2.jpg'],
  'wellness-finska-sauna': ['/images/activities/wellness-finska-sauna-1.jpg', '/images/activities/wellness-finska-sauna-2.jpg'],
  'wellness-solna-jeskyne': ['/images/activities/wellness-solna-jeskyne-1.jpg', '/images/activities/wellness-solna-jeskyne-2.jpg'],
  'wellness-virivka': ['/images/activities/wellness-virivka-1.jpg', '/images/activities/wellness-virivka-2.jpg'],
  'wellness-parni-lazen': ['/images/activities/wellness-parni-lazen-1.jpg', '/images/activities/wellness-parni-lazen-2.jpg'],
  'wellness-odpocinek': ['https://images.unsplash.com/photo-1773924093206-9a433a14bb44?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1761470575018-135c213340eb?w=800&q=70&auto=format&fit=crop'],
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
