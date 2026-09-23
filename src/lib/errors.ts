const messages:Record<string,string>={
 OFFER_UNAVAILABLE:'Tento termín už bohužel není volný.',ALREADY_BOOKED:'Tuto nabídku už máš zarezervovanou.',
 PHONE_REQUIRED:'Pro rezervaci potřebujeme tvoje telefonní číslo.',TOO_MANY_ACTIVE:'Máš 3 aktivní rezervace. Dokonči nebo zruš některou z nich.',
 BLOCKED_NO_SHOW:'Rezervace je dočasně nedostupná, protože jsi opakovaně nedorazil/a.',
 CANCELLATION_CLOSED:'Rezervaci už nejde zrušit. Dej prosím podniku vědět telefonicky.',
 AUTH_REQUIRED:'Pro pokračování se přihlas.',FORBIDDEN:'K této akci nemáte oprávnění.',NOT_FOUND:'Tento záznam už není dostupný.',
 BOOKING_BLOCKED:'Rezervace je na tvém účtu dočasně pozastavená.',ALREADY_RESOLVED:'Tato rezervace už je vyřízená.',NOT_RATEABLE:'Hodnotit můžeš až termín, na který jsi dorazil/a.',
 PAYMENT_REQUIRED:'Platba zatím neproběhla. Zkus to prosím znovu.',PAYMENT_FAILED:'Platbu se nepodařilo dokončit. Zkus to prosím znovu.',
 PAYMENT_ALREADY_USED:'Tahle platba už je použitá u jiné rezervace.',PRICE_CHANGED:'Cena termínu se mezitím změnila. Načti nabídku znovu.',
 INVALID_CANCELLATION_WINDOW:'Lhůta pro bezplatné zrušení musí být 0 až 10 080 minut.',
 TOO_EARLY:'Docházku můžete potvrdit až po začátku termínu.',OFFER_STARTED:'Termín už začal. Nabídku nelze zrušit.',
 BUSINESS_NOT_APPROVED:'Nejdříve musíme schválit vaši provozovnu.',OVERLAP_CONFIRMATION_REQUIRED:'Ve stejnou dobu už máte jinou nabídku. Máte dostatečnou kapacitu?',
 OFFER_HAS_BOOKINGS:'Nabídka už má rezervace. Můžete pouze zvýšit kapacitu.',INVALID_CAPACITY:'Kapacitu nelze snížit pod již rezervovaná místa. Nejvýše lze nabídnout 50 míst.',
 INVALID_DISCOUNT:'Sleva musí být aspoň 10 %. Cena nesmí klesnout pod 15 % původní ceny.',INVALID_START:'Vyberte budoucí čas nejvýše 7 dní dopředu.',
 INVALID_CUTOFF:'Uzávěrka rezervací musí být alespoň za 5 minut a nejpozději při začátku termínu.',VALIDATION_ERROR:'Zkontrolujte prosím vyplněné údaje.',
 NO_CUSTOMER_SAVING:'Po připočtení servisního poplatku by zákazník zaplatil stejně nebo více než běžně. Snižte FLEK cenu.',
 SAVING_TOO_SMALL:'Zákazník musí ušetřit aspoň 10 %. Snižte částku, kterou chcete dostat.',PRICE_TOO_LOW:'Tahle částka je nezvykle nízká. Zkontrolujte ji prosím.',
 RESOLUTION_WINDOW_CLOSED:'„Nedorazil“ jde označit jen do 24 hodin po konci termínu. Rezervace se už počítá jako dokončená.',
 PAYMENTS_NOT_READY:'Tenhle podnik zatím nemá zapnuté platby kartou. Zkus to prosím později.',PAYMENTS_NOT_CONFIGURED:'Platby jsou teď dočasně nedostupné.',
 CHECKOUT_FAILED:'Platební stránku se nepodařilo otevřít. Zkus to prosím znovu.',PAYMENT_CLOSED:'Tahle platba už je uzavřená. Začni rezervaci znovu.',WRONG_PROVIDER:'Platbu se nepodařilo otevřít. Začni rezervaci znovu.',
 STRIPE_NOT_CONNECTED:'Nejdřív propojte výplaty přes Stripe v sekci Provozovna.',STRIPE_REQUEST_FAILED:'Stripe teď neodpovídá. Zkuste to prosím za chvíli.',NOT_CONNECTED:'Provozovna zatím nemá propojený Stripe účet.',
 FINANCIAL_SNAPSHOT_IMMUTABLE:'Cenu už uskutečněné rezervace nejde měnit.',CODE_GENERATION_FAILED:'Rezervaci se nepodařilo dokončit. Zkus to prosím znovu.',
 OFFER_HAS_PENDING_BOOKINGS:'Na tuto nabídku právě čeká zákazník. Upravit ji půjde, až žádost skončí, nejdéle za pár minut.',
 HOLD_RATE_LIMITED:'Za poslední hodinu sis termíny několikrát podržel/a bez zaplacení. Zkus to prosím znovu za chvíli.',
 PAYMENT_PENDING_CONFIRMATION:'Rezervace čeká na potvrzení podniku. Jak dopadla, uvidíš v Rezervacích.',
 INVALID_PHONE:'Zkontrolujte telefonní číslo. České číslo stačí napsat bez předvolby, zahraniční s + na začátku.',
 CONSENT_REQUIRED:'Pro zapnutí WhatsApp upozornění potřebujeme váš souhlas.',
 WHATSAPP_UNAVAILABLE:'WhatsApp upozornění zatím nejsou dostupná.',
 WHATSAPP_PAIRING_RATE_LIMITED:'Kód jste si nechali vygenerovat už několikrát. Zkuste to prosím za hodinu.',
 TERMS_OUTDATED:'Podmínky pro podniky se změnily. Přečtěte si novou verzi a potvrďte souhlas v Provozovně.',
 PROVIDER_DETAILS_REQUIRED:'Podnik nemá vyplněné IČO. Bez údajů o poskytovateli ho nejde schválit — doplní je v Provozovně ve fakturačních údajích.',
 REPORT_RATE_LIMITED:'Dnes jste poslali už hodně nahlášení. Další pošlete zítra, nebo nám napište e-mailem.',
 IMAGE_REUPLOAD_REQUIRED:'Fotku je potřeba nahrát znovu — po kontrole obsahu se ukládá jinak. Vyberte soubor ještě jednou.',
 CONTENT_PENDING:'Předchozí úprava se ještě kontroluje. Počkejte prosím, než projde.',
 MODERATION_UNAVAILABLE:'Kontrola obsahu teď neodpovídá. Fotka i text se zveřejní, jakmile projdou.',
 WHATSAPP_NOT_CONFIGURED:'WhatsApp zatím nemá v Supabase vyplněné klíče od Mety.',
 META_REQUEST_FAILED:'Meta požadavek odmítla. Zkuste to prosím znovu, nebo se podívejte do logu funkce.',
 META_UNREACHABLE:'Meta teď neodpovídá. Zkuste to prosím za chvíli.',
 INVALID_ICO:'IČO nesedí. Zkontrolujte, že má 8 číslic.',ARES_UNAVAILABLE:'Registr ARES teď neodpovídá. Údaje vyplňte ručně, nebo to zkuste za chvíli.',
 ACTIVE_BOOKINGS:'Účet teď smazat nejde, máte nadcházející rezervaci.',BUSINESS_MEMBER:'Účet patří k podniku. Jeho smazání vyřídíme e-mailem.',
 'Invalid login credentials':'E-mail nebo heslo nesouhlasí.','User already registered':'Tento e-mail už má účet. Přihlas se.',
 'Email not confirmed':'Nejdřív potvrď svůj e-mail.','Email rate limit exceeded':'Zkus to prosím znovu za chvíli.',
};
/** The same codes said to a customer, where the shared text above is written for a partner. */
const customerMessages:Record<string,string>={
 INVALID_PHONE:'Zkontroluj telefonní číslo. České číslo stačí napsat bez předvolby, zahraniční s + na začátku.',
 CONSENT_REQUIRED:'Pro zprávy na WhatsApp potřebujeme tvůj souhlas.',
 WHATSAPP_UNAVAILABLE:'Zprávy na WhatsApp zatím nejsou dostupné.',
 WHATSAPP_PAIRING_RATE_LIMITED:'Kód sis nechal/a vytvořit už několikrát. Zkus to prosím za hodinu.',
 TERMS_OUTDATED:'Obchodní podmínky se mezitím změnily. Přečti si novou verzi a zkus to znovu.',
 REPORT_RATE_LIMITED:'Dnes jsi poslal/a už hodně nahlášení. Další můžeš poslat zítra, nebo nám napiš e-mailem.',
 ACTIVE_BOOKINGS:'Účet teď smazat nejde, máš nadcházející rezervaci. Nejdřív ji zruš, nebo počkej, až proběhne.',
 BUSINESS_MEMBER:'Účet patří k podniku ve FLEK Partner. Jeho smazání vyřídíme e-mailem, napiš nám.',
};
/*
 * The customer app tyká and the merchant console vyká. Specific codes are already written for
 * their audience; the generic fallbacks were customer-only, so a partner was told
 * "Zkus to znovu" in the middle of a formal screen.
 */
const fallbacks={
 customer:{network:'Spojení se nepodařilo. Zkontroluj internet a zkus to znovu.',session:'Přihlášení vypršelo. Přihlas se znovu a pokračuj.',other:'Něco se nepodařilo. Zkus to prosím znovu.'},
 merchant:{network:'Spojení se nepodařilo. Zkontrolujte internet a zkuste to znovu.',session:'Přihlášení vypršelo. Přihlaste se znovu a pokračujte.',other:'Něco se nepodařilo. Zkuste to prosím znovu.'},
};
export function errorMessage(error:unknown,audience:'customer'|'merchant'='customer'){
 const message=error instanceof Error?error.message:typeof error==='object'&&error&&'message'in error?String(error.message):'';
 const mapped=(audience==='customer'?Object.entries(customerMessages).find(([code])=>message.includes(code)):undefined)
  ??Object.entries(messages).find(([code])=>message.includes(code));
 if(mapped)return mapped[1];
 if(message.includes('letní čas'))return message;
 if(/fetch|network|offline|timeout/i.test(message))return fallbacks[audience].network;
 if(/jwt|session|token.*expired/i.test(message))return fallbacks[audience].session;
 return fallbacks[audience].other;
}
export async function result<T>(request:PromiseLike<{data:T|null;error:{message:string}|null}>):Promise<T>{const r=await request;if(r.error)throw new Error(r.error.message);return r.data as T;}
