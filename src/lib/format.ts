export function money(cents:number){if(!Number.isSafeInteger(cents)||cents%100!==0)throw new Error('Neplatná částka.');return `${new Intl.NumberFormat('cs-CZ').format(cents/100)}\u00a0Kč`;}
export function czkToCents(value:string){if(!/^\d+$/.test(value))throw new Error('Zadej cenu v celých korunách.');const cents=Number(value)*100;if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Neplatná cena.');return cents;}
// Below 50 m the number stops meaning anything: GPS is not that precise, and standing in
// the venue rendered a flat "0 m", which reads as a broken app rather than as "you are here".
// Null when there is no distance to state. Some rows genuinely have none — the favourites
// feed comes from offer_details, which carries no distance at all — and formatting undefined
// produced a confident "NaN km" on screen.
export function distance(m:number|null|undefined){if(typeof m!=='number'||!Number.isFinite(m))return null;return m<50?'do 50 m':m<1000?`${Math.round(m/10)*10} m`:`${new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(m/1000)} km`;}
