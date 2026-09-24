import { describe, expect, it } from 'vitest';
import { isMuted, isRinging, muteRequests, stopRinging } from '../src/features/merchant/ringer';

describe('ringer', () => {
  it('silences only the requests it was given, so a new one rings again', () => {
    muteRequests(['req-a', 'req-b']);
    expect(isMuted('req-a')).toBe(true);
    expect(isMuted('req-b')).toBe(true);
    expect(isMuted('req-c')).toBe(false);
  });

  it('stays quiet without a browser that has allowed sound', () => {
    stopRinging();
    expect(isRinging()).toBe(false);
  });
});
