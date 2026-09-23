/**
 * Illustrations for services whose venue has not uploaded a photograph of its own; the
 * merchant's saved image always takes precedence.
 *
 * Both variants for all 37 activities were reviewed against their subject. Each actual
 * photograph has its source page, author and licence recorded in
 * `docs/assets/activity-photo-sources.json`. A neutral FLEK fallback is used where a
 * sufficiently specific photograph could not be verified. Merchant uploads always win.
 */
export const ACTIVITY_GALLERIES: Record<string, string[]> = {
  'vlasy-pansky-strih': ["https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1536520002442-39764a41e987?w=800&q=70&auto=format&fit=crop"],
  'vlasy-uprava-vousu': ["https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1596362601603-b74f6ef166e4?w=800&q=70&auto=format&fit=crop"],
  'vlasy-damsky-strih': ["https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1626379499242-52863d313084?w=800&q=70&auto=format&fit=crop"],
  'vlasy-barveni': ["https://images.unsplash.com/photo-1605980625982-b128a7e7fde2?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1785456411888-c2e842552820?w=800&q=70&auto=format&fit=crop"],
  'vlasy-myti-foukana': ["https://images.unsplash.com/photo-1637777269308-6a072f24e8a4?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1616105996583-f9e3c00bb31f?w=800&q=70&auto=format&fit=crop"],
  'vlasy-detsky-strih': ["https://images.unsplash.com/photo-1599387737838-660b75526801?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1584921425698-bc4b12745d60?w=800&q=70&auto=format&fit=crop"],
  'masaze-relaxacni': ["https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1630835474626-b4de96a25186?w=800&q=70&auto=format&fit=crop"],
  'masaze-thajska': ["https://images.unsplash.com/photo-1639162906614-0603b0ae95fd?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1611073615452-4889cb93422e?w=800&q=70&auto=format&fit=crop"],
  'masaze-zada-sije': ["https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1700142360825-d21edc53c8db?w=800&q=70&auto=format&fit=crop"],
  'masaze-sportovni': ["https://images.unsplash.com/photo-1741522509438-a120c0bb5e88?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1712638932314-e2b185ca0930?w=800&q=70&auto=format&fit=crop"],
  'masaze-chodidla': ["https://images.unsplash.com/photo-1728497872660-cc6b16238c3a?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1577117633143-a2437fb9bdda?w=800&q=70&auto=format&fit=crop"],
  'masaze-lavove-kameny': ["https://images.unsplash.com/photo-1696841212541-449ca29397cc?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1610402601271-5b4bd5b3eba4?w=800&q=70&auto=format&fit=crop"],
  'krasa-manikura': ["https://images.unsplash.com/photo-1660505102581-85cffa4e6550?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1779636198585-658170ee0283?w=800&q=70&auto=format&fit=crop"],
  'krasa-gel-lak': ["https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1636019411401-82485711b6ba?w=800&q=70&auto=format&fit=crop"],
  'krasa-pedikura': ["https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1596740926849-2d473dee8d60?w=800&q=70&auto=format&fit=crop"],
  'krasa-kosmeticke-osetreni': ["https://images.unsplash.com/photo-1595871151608-bc7abd1caca3?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop"],
  'krasa-oboci': ["https://images.unsplash.com/photo-1620531940052-d0d9aff03c32?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1636934432265-7b770c648a4e?w=800&q=70&auto=format&fit=crop"],
  'krasa-rasy': ["https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1735151225764-eac694642dbf?w=800&q=70&auto=format&fit=crop"],
  'sport-padel': ["https://images.unsplash.com/photo-1658491830143-72808ca237e3?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1709587823868-735f9375ae74?w=800&q=70&auto=format&fit=crop"],
  'sport-tenis': ["https://images.unsplash.com/photo-1620742820748-87c09249a72a?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1567220720374-a67f33b2a6b9?w=800&q=70&auto=format&fit=crop"],
  'sport-squash': ["https://images.unsplash.com/photo-1711294545092-303f7161017c?w=800&q=70&auto=format&fit=crop", "/images/flek-placeholder.svg"],
  'sport-badminton': ["https://images.unsplash.com/photo-1617696618050-b0fef0c666af?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1775993167393-f2add1f8eec2?w=800&q=70&auto=format&fit=crop"],
  'sport-osobni-trenink': ["https://images.unsplash.com/photo-1637430308606-86576d8fef3c?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1623874106686-5be2b325c8f1?w=800&q=70&auto=format&fit=crop"],
  'sport-skupinova-lekce': ["https://images.unsplash.com/photo-1786788191523-26efefeadc81?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1787647089626-e76f1d0275d1?w=800&q=70&auto=format&fit=crop"],
  'sport-pujceni-kola': ["https://images.unsplash.com/photo-1561840884-9dda41ed54e4?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1670528148728-7ac7f5dc1123?w=800&q=70&auto=format&fit=crop"],
  'joga-vinyasa': ["https://images.unsplash.com/photo-1761971975962-9cc397e2ba2a?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1734640817404-a0e4e0cc24c2?w=800&q=70&auto=format&fit=crop"],
  'joga-jemna': ["https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop"],
  'joga-power': ["https://images.unsplash.com/photo-1591291621164-2c6367723315?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop"],
  'joga-rani-protazeni': ["https://images.unsplash.com/photo-1637157216470-d92cd2edb2e8?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop"],
  'joga-zacatecnici': ["https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop"],
  'joga-meditace': ["https://images.unsplash.com/photo-1767605565789-5b18cdbbf6ae?w=800&q=70&auto=format&fit=crop", "/images/flek-placeholder.svg"],
  'wellness-privatni-sauna': ["https://images.unsplash.com/photo-1717356495389-6ab1e5ff9d84?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1712659604528-b179a3634560?w=800&q=70&auto=format&fit=crop"],
  'wellness-finska-sauna': ["https://images.unsplash.com/photo-1759300031446-88e81c8a26c9?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1757940556610-a114be4733bf?w=800&q=70&auto=format&fit=crop"],
  'wellness-solna-jeskyne': ["/images/flek-placeholder.svg", "/images/flek-placeholder.svg"],
  'wellness-virivka': ["https://images.unsplash.com/photo-1773423386572-4ad451dc6c26?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1781455495578-944c2dcbd2de?w=800&q=70&auto=format&fit=crop"],
  'wellness-parni-lazen': ["https://images.unsplash.com/photo-1761470575018-135c213340eb?w=800&q=70&auto=format&fit=crop", "/images/flek-placeholder.svg"],
  'wellness-odpocinek': ["https://images.unsplash.com/photo-1787496994928-b5b554eb0cd8?w=800&q=70&auto=format&fit=crop", "https://images.unsplash.com/photo-1693578538512-fc66f318c833?w=800&q=70&auto=format&fit=crop"],
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

/** CDN widths for real photos; the browser never downloads a 1200px image for a small card. */
export function activityPhotoSrcSet(url: string): string | undefined {
  if (!url.startsWith('https://images.unsplash.com/photo-')) return undefined;
  return [480, 800, 1200].map((width) => {
    const photo = new URL(url);
    photo.searchParams.set('w', String(width));
    return `${photo.toString()} ${width}w`;
  }).join(', ');
}
