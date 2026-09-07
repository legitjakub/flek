import { Temporal } from '@js-temporal/polyfill';
export const ZONE='Europe/Prague';
export function localToInstant(value:string):string {
 const plain=Temporal.PlainDateTime.from(value);
 const zoned=plain.toZonedDateTime(ZONE,{disambiguation:'compatible'});
 if(!zoned.toPlainDateTime().equals(plain)) throw new Error('Tento čas kvůli změně na letní čas neexistuje. Vyber jiný.');
 return zoned.toInstant().toString();
}
export function localInput(instant:string):string{return Temporal.Instant.from(instant).toZonedDateTimeISO(ZONE).toPlainDateTime().toString({smallestUnit:'minute'});}
export function dayKey(instant:string):string{return Temporal.Instant.from(instant).toZonedDateTimeISO(ZONE).toPlainDate().toString();}
export function dayBounds(serverNow:string,days=0){const d=Temporal.Instant.from(serverNow).toZonedDateTimeISO(ZONE).toPlainDate().add({days});return {from:d.toZonedDateTime(ZONE).toInstant().toString(),until:d.add({days:1}).toZonedDateTime(ZONE).toInstant().toString()};}
export function dayLabel(instant:string,serverNow:string){const d=dayKey(instant),today=dayKey(serverNow);if(d===today)return 'Dnes';if(d===Temporal.PlainDate.from(today).add({days:1}).toString())return 'Zítra';return new Intl.DateTimeFormat('cs-CZ',{timeZone:ZONE,day:'numeric',month:'numeric'}).format(new Date(instant));}
export function clockTime(instant:string){return new Intl.DateTimeFormat('cs-CZ',{timeZone:ZONE,hour:'2-digit',minute:'2-digit'}).format(new Date(instant));}
export function addMinutes(instant:string,minutes:number){return Temporal.Instant.from(instant).add({minutes}).toString();}
export function duration(start:string,end:string){return Math.round((Date.parse(end)-Date.parse(start))/60000);}
