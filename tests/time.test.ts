import { describe,expect,it } from 'vitest';
import { dayBounds,dayLabel,localInput,localToInstant } from '../src/lib/time';
import { czkToCents,money } from '../src/lib/format';
describe('Prague time independent of device timezone',()=>{
 it('23:50 followed by 00:30 is tomorrow',()=>expect(dayLabel('2026-09-08T00:30:00+02:00','2026-09-07T23:50:00+02:00')).toBe('Zítra'));
 it('UTC previous day displays Prague today',()=>expect(dayLabel('2026-09-07T22:30:00Z','2026-09-08T08:00:00Z')).toBe('Dnes'));
 it('March DST nonexistent 02:30 is explicitly rejected',()=>expect(()=>localToInstant('2026-03-29T02:30')).toThrow('neexistuje'));
 it('October DST 02:30 chooses earlier occurrence and round trips',()=>{const v=localToInstant('2026-10-25T02:30');expect(v).toBe('2026-10-25T00:30:00Z');expect(localInput(v)).toBe('2026-10-25T02:30');});
 it('March day is 23 hours and October day is 25 hours',()=>{const a=dayBounds('2026-03-29T12:00:00Z'),b=dayBounds('2026-10-25T12:00:00Z');expect(Date.parse(a.until)-Date.parse(a.from)).toBe(23*3600000);expect(Date.parse(b.until)-Date.parse(b.from)).toBe(25*3600000);});
 it('money uses integer cents and nonbreaking space',()=>{expect(czkToCents('650')).toBe(65000);expect(money(39000)).toBe('390\u00a0Kč');expect(()=>czkToCents('3.9')).toThrow();});
});
