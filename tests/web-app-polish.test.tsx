// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebApp } from '@/components/web-app';
import type { CollectionEntry } from '@/lib/domain';

const state = vi.hoisted(() => ({
  user: { uid: 'visual-test', displayName: 'Testsammlung', email: 'test@example.invalid' } as object | null,
  access: true,
  admin: false,
  scannerLabAccess: false,
  entries: [] as CollectionEntry[],
  prices: {} as Record<string, number | null>,
  add: vi.fn(), mutate: vi.fn(), subscribe: vi.fn(), priceOwner: vi.fn(), retryPrices: vi.fn(), selectionSyncFailed: false,
}));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, loading: false, hasAppAccess: state.access, isAdmin: state.admin, hasScannerLabAccess: state.scannerLabAccess, logout: vi.fn(), signIn: vi.fn(), refreshClaims: vi.fn() }) }));
vi.mock('@/components/use-collection-prices', () => ({ useCollectionPrices: (_entries: CollectionEntry[], owner?: string) => { state.priceOwner(owner); return { prices: state.prices, priceSources: {}, selections: {}, selectionSyncFailed: state.selectionSyncFailed, failed: new Set(), pending: 0, retry: state.retryPrices }; } }));
vi.mock('@/components/use-collection-layouts', () => ({ useCollectionLayouts: () => ({ visibility: new Map(), failed: false }) }));
vi.mock('@/lib/collection', () => ({
  addExactCard: state.add, changeQuantity: state.mutate,
  collectionSyncIdForExactCard: () => 'fixture-sync-id',
  subscribeCollection: (user: unknown, next: (entries: CollectionEntry[]) => void) => { state.subscribe(user); next(state.entries); return () => undefined; },
}));

const entry = (syncId: string, fields: Partial<CollectionEntry> = {}) => ({
  syncId, ownerUid: 'visual-test', name: `Karte ${syncId}`, setName: 'Testset', setId: 'test',
  collectorNumber: '089', quantity: 1, finish: 'Holo', variant: 'Standard',
  binderId: 'binder-test', binderName: 'Testset', sourceSetId: 'test',
  imageUrl: '/domidex-logo.jpg', ...fields,
} as CollectionEntry);

afterEach(() => {
  cleanup(); state.entries = []; state.prices = {}; state.access = true; state.admin = false; state.scannerLabAccess = false;
  state.selectionSyncFailed = false;
  state.user = { uid: 'visual-test', displayName: 'Testsammlung', email: 'test@example.invalid' };
  vi.clearAllMocks();
});

describe('authenticated collector presentation', () => {
  it('gates the price selection owner by confirmed app access, including revoke and regrant', () => {
    state.access = false;
    const { rerender } = render(<WebApp />);
    expect(state.priceOwner).toHaveBeenLastCalledWith(undefined);
    state.access = true; rerender(<WebApp />);
    expect(state.priceOwner).toHaveBeenLastCalledWith('visual-test');
    state.access = false; rerender(<WebApp />);
    expect(state.priceOwner).toHaveBeenLastCalledWith(undefined);
    state.access = true; rerender(<WebApp />);
    expect(state.priceOwner).toHaveBeenLastCalledWith('visual-test');
    state.user = null; rerender(<WebApp />);
    expect(state.priceOwner).toHaveBeenLastCalledWith(undefined);
  });

  it('exposes a real selection-sync retry even when all card prices loaded successfully', () => {
    state.selectionSyncFailed = true;
    render(<WebApp />);
    expect(screen.getByText('Deine gespeicherte Preisauswahl konnte nicht synchronisiert werden.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Preisauswahl erneut synchronisieren' }));
    expect(state.retryPrices).toHaveBeenCalledOnce();
  });

  it('limits the new presentation to users with confirmed app access', () => {
    state.user = null;
    const { container, rerender } = render(<WebApp />);
    expect(container.querySelector('.collector-app')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mit Google anmelden' })).toBeDefined();
    state.user = { uid: 'visual-test' }; state.access = false;
    rerender(<WebApp />);
    expect(container.querySelector('.collector-app')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Deine Sammlung im Überblick' })).toBeNull();
  });

  it('retains honest partial valuation and the actual selected card identity', () => {
    state.entries = [entry('normal', { name: 'Normal-Karte', quantity: 2, finish: 'Normal', collectorNumber: '001' }), entry('secret', { name: 'Sonderkarte', collectorNumber: '137' }), entry('unknown')];
    state.prices = { normal: 2, secret: 25, unknown: null };
    render(<WebApp />);
    const hero = within(screen.getByRole('region', { name: 'Deine Sammlung im Überblick' }));
    expect(hero.getByText('Bewerteter Teilbestand')).toBeDefined();
    expect(hero.getByRole('heading', { level: 2 }).textContent).toMatch(/29,00/);
    expect(hero.getByText('3/4 Karten · Cardmarket-Preise')).toBeDefined();
    expect(hero.getByRole('img', { name: 'Sonderkarte' })).toBeDefined();
    expect(hero.getByText('Testset · #137')).toBeDefined();
    expect(state.add).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
  });

  it('never replaces unavailable prices with a made-up zero or example card', () => {
    state.entries = [entry('unknown', { imageUrl: null })];
    state.prices = { unknown: null };
    render(<WebApp />);
    const hero = within(screen.getByRole('region', { name: 'Deine Sammlung im Überblick' }));
    expect(hero.getByRole('heading', { level: 2 }).textContent).toBe('Noch nicht verfügbar');
    expect(hero.queryByRole('img')).toBeNull();
    expect(hero.getByText('0/1 Karten · Cardmarket-Preise')).toBeDefined();
  });

  it('keeps all six areas reachable and does not grant administrative access', () => {
    render(<WebApp />);
    const nav = within(screen.getByRole('navigation', { name: 'Web-App Navigation' }));
    expect(nav.getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Scanner Lab' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tester & Berechtigungen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Portfolio ansehen' }));
    expect(nav.getByRole('button', { name: 'Portfolio' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(nav.getByRole('button', { name: 'Einstellungen' }));
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeDefined();
    fireEvent.click(nav.getByRole('button', { name: 'Karte hinzufügen' }));
    expect(screen.getByRole('textbox', { name: 'Kartenname suchen' })).toBeDefined();
    expect(state.add).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
  });
});

describe('Scanner Lab entry points', () => {
  it('exposes a standalone Lab link in the shared sidebar navigation without general admin links', () => {
    state.scannerLabAccess = true;
    render(<WebApp />);
    const nav = screen.getByRole('navigation', { name: 'Web-App Navigation' });
    const link = within(nav).getByRole('link', { name: 'Scanner Lab' });
    expect(link.getAttribute('href')).toBe('/admin/scanner-lab');
    expect(link.closest('nav')).toBe(nav);
    expect(link.closest('.admin-navigation')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Scanner Lab' })).toHaveLength(1);
    expect(within(nav).getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tester & Berechtigungen' })).toBeNull();
  });

  it('offers the Lab link at the access gate without subscribing to a collection or granting app access', () => {
    state.access = false;
    state.scannerLabAccess = true;
    const { container } = render(<WebApp />);
    const link = screen.getByRole('link', { name: 'Scanner Lab' });
    expect(link.getAttribute('href')).toBe('/admin/scanner-lab');
    expect(link.closest('.access-actions')).not.toBeNull();
    expect(container.querySelector('.collector-app')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Deine Sammlung im Überblick' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tester & Berechtigungen' })).toBeNull();
    expect(state.subscribe).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('keeps one Scanner Lab link and both existing general admin links for administrators', () => {
    state.admin = true;
    state.scannerLabAccess = false;
    render(<WebApp />);
    const nav = within(screen.getByRole('navigation', { name: 'Web-App Navigation' }));
    expect(screen.getAllByRole('link', { name: 'Scanner Lab' })).toHaveLength(1);
    expect(nav.getByRole('link', { name: 'Scanner Lab' }).getAttribute('href')).toBe('/admin/scanner-lab');
    expect(nav.getByRole('link', { name: 'Admin Dashboard' }).getAttribute('href')).toBe('/admin');
    expect(nav.getByRole('link', { name: 'Tester & Berechtigungen' }).getAttribute('href')).toBe('/admin/testers');
    expect(nav.getAllByRole('button')).toHaveLength(6);
  });

  it.each([false, true])('never shows a Lab link to a guest even with an inconsistent Lab grant and admin=%s', (admin) => {
    state.user = null;
    state.admin = admin;
    state.scannerLabAccess = true;
    render(<WebApp />);
    expect(screen.queryByRole('link', { name: 'Scanner Lab' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tester & Berechtigungen' })).toBeNull();
    expect(state.subscribe).not.toHaveBeenCalled();
  });

  it.each([false, true])('removes the Lab link immediately on revocation with app access=%s', (access) => {
    state.access = access;
    state.scannerLabAccess = true;
    const { rerender } = render(<WebApp />);
    expect(screen.getByRole('link', { name: 'Scanner Lab' })).toBeTruthy();
    state.scannerLabAccess = false;
    rerender(<WebApp />);
    expect(screen.queryByRole('link', { name: 'Scanner Lab' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tester & Berechtigungen' })).toBeNull();
    if (!access) expect(state.subscribe).not.toHaveBeenCalled();
  });
});
