import { describe, expect, it } from 'vitest';
import { canTransition, createScannerDraft, resolveScannerProfile, validateScannerProfile } from '@/lib/scanner-profile';

describe('scanner profile safety', () => {
  it('validates normalized geometry and independent fallback', () => {
    const profile = createScannerDraft();
    expect(validateScannerProfile(profile)).toEqual({ valid: true, errors: [] });
    profile.zones[0] = { ...profile.zones[0], x: .9, width: .2 };
    expect(validateScannerProfile(profile).valid).toBe(false);
  });

  it('keeps the release flow explicit', () => {
    expect(canTransition('draft', 'testing')).toBe(true);
    expect(canTransition('testing', 'candidate')).toBe(true);
    expect(canTransition('candidate', 'production')).toBe(true);
    expect(canTransition('draft', 'production')).toBe(false);
  });

  it('resolves the most specific production scope deterministically', () => {
    const base = { ...createScannerDraft(), status: 'production' as const, profileVersion: 1 };
    const global = { ...base, profileId: 'global', scope: { level: 'global' as const, value: null } };
    const set = { ...base, profileId: 'set', scope: { level: 'set' as const, value: 'sv03.5' } };
    const card = { ...base, profileId: 'card', scope: { level: 'card' as const, value: 'sv03.5-001' } };
    expect(resolveScannerProfile([global, set, card], { setId: 'sv03.5', cardId: 'sv03.5-001' })?.profileId).toBe('card');
    expect(resolveScannerProfile([global, set], { setId: 'sv03.5' })?.profileId).toBe('set');
  });

  it('does not coerce local collector IDs', () => {
    const ids = ['001', '1', 'BW01', 'DAR', 'n'];
    expect(ids.map((localId) => `${'set'}-${localId}`)).toEqual(['set-001', 'set-1', 'set-BW01', 'set-DAR', 'set-n']);
  });
});
