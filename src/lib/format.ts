export function money(cents:number){if(!Number.isSafeInteger(cents)||cents%100!==0)throw new Error('Neplatná částka.');return `${new Intl.NumberFormat('cs-CZ').format(cents/100)}\u00a0Kč`;}
export function czkToCents(value:string){if(!/^\d+$/.test(value))throw new Error('Zadej cenu v celých korunách.');const cents=Number(value)*100;if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Neplatná cena.');return cents;}
export function distance(m:number){return m<1000?`${Math.round(m/10)*10} m`:`${new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(m/1000)} km`;}
