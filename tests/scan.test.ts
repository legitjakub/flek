import { describe, expect, it } from 'vitest';
import { codeFromScan } from '../src/features/merchant/ScanVoucherSheet';

/**
 * The voucher encodes a URL so a customer's plain camera app can open it, but a merchant
 * scanning inside FLEK gets the same payload. Both shapes have to resolve to one code, and
 * anything else has to be rejected rather than sent to the server as a lookup.
 */
describe('codeFromScan', () => {
  it('reads the code out of the voucher URL', () => {
    expect(codeFromScan('https://flek-nine.vercel.app/partner/rezervace?kod=FLEK-7QK2ZP')).toBe('FLEK-7QK2ZP');
  });

  it('accepts a bare code, in any case', () => {
    expect(codeFromScan('flek-7qk2zp')).toBe('FLEK-7QK2ZP');
    expect(codeFromScan('  FLEK-7QK2ZP  ')).toBe('FLEK-7QK2ZP');
  });

  it('survives a URL that carries the code alongside other parameters', () => {
    expect(codeFromScan('https://x.test/partner/rezervace?utm=qr&kod=FLEK-ABC123&x=1')).toBe('FLEK-ABC123');
  });

  it('rejects a QR that is not ours rather than searching for nonsense', () => {
    expect(codeFromScan('https://example.com/')).toBeNull();
    expect(codeFromScan('WIFI:S:cafe;T:WPA;P:hunter2;;')).toBeNull();
    expect(codeFromScan('7QK2ZP')).toBeNull();
    expect(codeFromScan('')).toBeNull();
    expect(codeFromScan('   ')).toBeNull();
  });

  it('does not treat a lookalike code as valid', () => {
    expect(codeFromScan('FLEK-')).toBeNull();
    expect(codeFromScan('FLEK-TOO-MANY-PARTS')).toBeNull();
  });
});
