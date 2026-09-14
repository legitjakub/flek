import { describe, expect, it } from 'vitest';
import { capacityLabel } from '../src/components/CapacityLabel';
import { confirmationTimeLeft } from '../src/components/ConfirmationCountdown';

describe('manual confirmation presentation', () => {
  it('shows the deadline from server timestamps rather than a local timeout', () => {
    expect(confirmationTimeLeft('2026-09-14T17:05:00Z', '2026-09-14T17:00:42Z')).toBe('04:18');
    expect(confirmationTimeLeft('2026-09-14T17:00:41Z', '2026-09-14T17:00:42Z')).toBe('00:00');
  });

  it('uses actual remaining inventory for natural Czech capacity text', () => {
    expect(capacityLabel(3, 3)).toBe('3 volná místa');
    expect(capacityLabel(2, 3)).toBe('2 volná místa');
    expect(capacityLabel(1, 3)).toBe('Poslední místo');
    expect(capacityLabel(1, 1)).toBeNull();
  });
});
