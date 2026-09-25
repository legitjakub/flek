import { describe, expect, it } from 'vitest';
import { alertSetupState } from '../src/features/merchant/ringSetup';

const device = {
  enabled: true,
  deviceOn: false as boolean | null,
  permission: 'default' as NotificationPermission | 'unknown',
  pushSupported: true,
  ios: false,
  standalone: false,
};

describe('ring setup card', () => {
  it('asks once, on a device that can have notifications and has not got them', () => {
    expect(alertSetupState(device)).toBe('ask');
  });

  it('stays away while checking, once done, and in a build without notifications', () => {
    expect(alertSetupState({ ...device, deviceOn: null })).toBe('hidden');
    expect(alertSetupState({ ...device, deviceOn: true })).toBe('hidden');
    expect(alertSetupState({ ...device, enabled: false })).toBe('hidden');
  });

  it('explains a refusal instead of asking again', () => {
    expect(alertSetupState({ ...device, permission: 'denied' })).toBe('denied');
  });

  it('sends an iPhone in Safari to the home screen, and says so elsewhere', () => {
    expect(alertSetupState({ ...device, pushSupported: false, ios: true })).toBe('install');
    expect(alertSetupState({ ...device, pushSupported: false, ios: true, standalone: true })).toBe('unsupported');
    expect(alertSetupState({ ...device, pushSupported: false })).toBe('unsupported');
  });
});
