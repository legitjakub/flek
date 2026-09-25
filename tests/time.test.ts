import { describe,expect,it } from 'vitest';
import { calendarDay,dayBounds,dayLabel,localInput,localToInstant,untilLabel } from '../src/lib/time';
import { czkToCents,money } from '../src/lib/format';
describe('Prague time independent of device timezone',()=>{
 it('23:50 followed by 00:30 is tomorrow',()=>expect(dayLabel('2026-09-08T00:30:00+02:00','2026-09-07T23:50:00+02:00')).toBe('Zítra'));
 it('UTC previous day displays Prague today',()=>expect(dayLabel('2026-09-07T22:30:00Z','2026-09-08T08:00:00Z')).toBe('Dnes'));
 it('March DST nonexistent 02:30 is explicitly rejected',()=>expect(()=>localToInstant('2026-03-29T02:30')).toThrow('neexistuje'));
 it('October DST 02:30 chooses earlier occurrence and round trips',()=>{const v=localToInstant('2026-10-25T02:30');expect(v).toBe('2026-10-25T00:30:00Z');expect(localInput(v)).toBe('2026-10-25T02:30');});
 it('March day is 23 hours and October day is 25 hours',()=>{const a=dayBounds('2026-03-29T12:00:00Z'),b=dayBounds('2026-10-25T12:00:00Z');expect(Date.parse(a.until)-Date.parse(a.from)).toBe(23*3600000);expect(Date.parse(b.until)-Date.parse(b.from)).toBe(25*3600000);});
 it('money uses integer cents and nonbreaking space',()=>{expect(czkToCents('650')).toBe(65000);expect(money(39000)).toBe('390\u00a0Kč');expect(()=>czkToCents('3.9')).toThrow();});
});

describe('deadline with its day',()=>{
 const now='2026-09-25T16:16:00Z'; // 18:16 in Prague
 it('today says dnes',()=>expect(untilLabel('2026-09-25T17:30:00Z',now)).toBe('dnes do 19:30'));
 it('tomorrow is never a bare time',()=>expect(untilLabel('2026-09-26T15:30:00Z',now)).toBe('do zítřka 17:30'));
 it('later days carry the date',()=>expect(untilLabel('2026-09-28T07:00:00Z',now)).toBe('do 28. 9. 09:00'));
});

describe('calendar page',()=>{
 it('names the Prague day',()=>expect(calendarDay('2026-09-26T16:30:00Z')).toEqual({weekday:'so',day:'26',month:'zář',long:'sobota 26. 9.'}));
 it('half past midnight in Prague is already the next day',()=>expect(calendarDay('2026-09-26T22:30:00Z')).toMatchObject({weekday:'ne',day:'27'}));
});
