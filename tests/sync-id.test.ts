import { describe, expect, it } from 'vitest';
import { deterministicCardmarketSyncId, deterministicSourceSyncId } from '@/lib/sync-id';

describe('Android-compatible deterministic collection sync ids', () => {
  it('matches Android UUID.nameUUIDFromBytes for a source identity', () => {
    expect(deterministicSourceSyncId(
      'user',
      'sv08',
      'sv08-001',
      'Near Mint',
      'Normal',
      'Standard',
    )).toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
  });

  it('matches Android UUID.nameUUIDFromBytes for a Cardmarket identity', () => {
    expect(deterministicCardmarketSyncId(
      'user',
      794256,
      'Near Mint',
      'Normal',
      'Standard',
    )).toBe('a2aa1129-20f2-30d9-80a6-487fd4e2bcef');
  });

  it('normalizes whitespace and case but keeps condition in the identity', () => {
    expect(deterministicSourceSyncId(' USER ', 'SV08', 'SV08-001', ' NEAR MINT ', 'NORMAL', 'STANDARD'))
      .toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
    expect(deterministicSourceSyncId('user', 'sv08', 'sv08-001', 'Played', 'Normal', 'Standard'))
      .not.toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
  });
});
