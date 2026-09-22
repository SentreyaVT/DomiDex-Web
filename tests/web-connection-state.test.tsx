// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebApp } from '@/components/web-app';

const state = vi.hoisted(() => ({ fail: false, waiting: false, user: { uid: 'local-qa', displayName: 'Prüfkonto' } }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, loading: false, isAdmin: false, hasAppAccess: true }) }));
vi.mock('@/components/use-collection-prices', () => ({ useCollectionPrices: () => ({ prices: {}, failed: new Set(), pending: 0, retry: vi.fn() }) }));
vi.mock('@/lib/collection', () => ({
  addExactCard: vi.fn(), changeQuantity: vi.fn(),
  subscribeCollection: (_user: unknown, next: (entries: never[]) => void, fail: (error: Error) => void) => {
    if (state.fail) fail(new Error('unavailable'));
    else if (!state.waiting) next([]);
    return () => undefined;
  },
}));
afterEach(() => { cleanup(); state.fail = false; state.waiting = false; });
describe('truthful Web collection connection status', () => {
  it('does not claim an Android roundtrip merely because a snapshot loaded', () => {
    render(<WebApp />);
    expect(screen.getByRole('status').textContent).toContain('Sammlung geladen');
    expect(screen.queryByText('Live mit Android synchronisiert')).toBeNull();
  });
  it('does not promise a persistent offline cache after a subscription error', () => {
    state.fail = true;
    render(<WebApp />);
    expect(screen.getByRole('status').textContent).toContain('Synchronisierung unterbrochen');
    expect(screen.queryByText(/Offline · lokaler Cache/)).toBeNull();
  });
  it('distinguishes the pending first snapshot from a loaded collection', () => {
    state.waiting = true;
    render(<WebApp />);
    expect(screen.getByRole('status').textContent).toContain('Sammlung wird geladen');
  });
});
