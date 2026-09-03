import { describe, expect, it } from 'vitest';
import { boundedPageSize, withPretesterClaim } from '@/lib/server/firebase-admin-auth';

describe('Firebase pretester claim management', () => {
  it('preserves unrelated and admin claims when granting pretester', () => {
    expect(withPretesterClaim({ admin: true, feature: 'keep' }, true)).toEqual({ admin: true, feature: 'keep', pretester: true });
  });

  it('removes only pretester and preserves all other claims', () => {
    expect(withPretesterClaim({ admin: true, pretester: true, feature: 7 }, false)).toEqual({ admin: true, feature: 7 });
  });

  it('bounds Auth list pages', () => {
    expect(boundedPageSize(-3)).toBe(1);
    expect(boundedPageSize(5_000)).toBe(1_000);
    expect(boundedPageSize('invalid')).toBe(100);
  });
});
