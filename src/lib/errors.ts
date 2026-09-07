const messages:Record<string,string>={
 OFFER_UNAVAILABLE:'Tento termín už bohužel není volný.',ALREADY_BOOKED:'Tuto nabídku už máš zarezervovanou.',
 PHONE_REQUIRED:'Pro rezervaci potřebujeme tvoje telefonní číslo.',TOO_MANY_ACTIVE:'Máš 3 aktivní rezervace. Dokonči nebo zruš některou z nich.',
 BLOCKED_NO_SHOW:'Rezervace je dočasně nedostupná, protože jsi opakovaně nedorazil/a.',
 CANCELLATION_CLOSED:'Rezervaci už nejde zrušit. Dej prosím podniku vědět telefonicky.',
 AUTH_REQUIRED:'Pro pokračování se přihlas.',FORBIDDEN:'K této akci nemáte oprávnění.',NOT_FOUND:'Tento záznam už není dostupný.',
 BOOKING_BLOCKED:'Rezervace je na tvém účtu dočasně pozastavená.',ALREADY_RESOLVED:'Tato rezervace už je vyřízená.',
 TOO_EARLY:'Docházku můžete potvrdit až po začátku termínu.',OFFER_STARTED:'Termín už začal. Nabídku nelze zrušit.',
 BUSINESS_NOT_APPROVED:'Nejdříve musíme schválit vaši provozovnu.',OVERLAP_CONFIRMATION_REQUIRED:'Ve stejnou dobu už máte jinou nabídku. Máte fleku kapacitu?',
 OFFER_HAS_BOOKINGS:'Nabídka už má rezervace. Můžete pouze zvýšit kapacitu.',INVALID_CAPACITY:'Kapacitu nelze snížit pod již rezervovaná místa. Nejvýše lze nabídnout 50 míst.',
 INVALID_DISCOUNT:'Sleva musí být aspoň 10 %. Cena nesmí klesnout pod 15 % původní ceny.',INVALID_START:'Vyberte budoucí čas nejvýše 7 dní dopředu.',
 INVALID_CUTOFF:'Uzávěrka rezervací musí být alespoň za 5 minut a nejpozději při začátku termínu.',VALIDATION_ERROR:'Zkontrolujte prosím vyplněné údaje.',
 'Invalid login credentials':'E-mail nebo heslo nesouhlasí.','User already registered':'Tento e-mail už má účet. Přihlas se.',
 'Email not confirmed':'Nejdřív potvrď svůj e-mail.','Email rate limit exceeded':'Zkus to prosím znovu za chvíli.',
};
export function errorMessage(error:unknown){
 const message=error instanceof Error?error.message:typeof error==='object'&&error&&'message'in error?String(error.message):'';
 const mapped=Object.entries(messages).find(([code])=>message.includes(code));
 if(mapped)return mapped[1];
 if(message.includes('letní čas'))return message;
 if(/fetch|network|offline|timeout/i.test(message))return 'Spojení se nepodařilo. Zkontroluj internet a zkus to znovu.';
 if(/jwt|session|token.*expired/i.test(message))return 'Přihlášení vypršelo. Přihlas se znovu a pokračuj.';
 return 'Něco se nepodařilo. Zkus to prosím znovu.';
}
export async function result<T>(request:PromiseLike<{data:T|null;error:{message:string}|null}>):Promise<T>{const r=await request;if(r.error)throw new Error(r.error.message);return r.data as T;}
