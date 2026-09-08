/** Minimal RFC 5545 event, built in the browser — no dependency, no server round trip. */
function stamp(instant: string): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(value: string): string {
  return value.replace(/([\;,])/g, '\\$1').replace(/\n/g, '\\n');
}

export function bookingIcs(input: {
  code: string;
  serviceName: string;
  businessName: string;
  address: string;
  startAt: string;
  endAt: string;
}): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FLEK//CS//',
    'BEGIN:VEVENT',
    `UID:${input.code}@flek`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(input.startAt)}`,
    `DTEND:${stamp(input.endAt)}`,
    `SUMMARY:${escapeText(`${input.serviceName} — ${input.businessName}`)}`,
    `LOCATION:${escapeText(input.address)}`,
    `DESCRIPTION:${escapeText(`Rezervační kód ${input.code}. Zaplaceno předem přes FLEK.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function icsHref(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
