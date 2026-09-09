import { describe, expect, it } from 'vitest';
import { distance } from '../src/lib/format';

describe('distance', () => {
  it('does not render a bare zero when you are standing at the venue', () => {
    // "0 m" reads as a failed calculation, not as "you are here".
    expect(distance(0)).toBe('do 50 m');
    expect(distance(12)).toBe('do 50 m');
  });

  it('rounds to tens of metres, because GPS is not more precise than that', () => {
    expect(distance(64)).toBe('60 m');
    expect(distance(355)).toBe('360 m');
  });

  it('switches to kilometres at a thousand metres', () => {
    expect(distance(999)).toBe('1000 m');
    expect(distance(1000)).toBe('1 km');
    expect(distance(2540)).toBe('2,5 km');
  });
});
