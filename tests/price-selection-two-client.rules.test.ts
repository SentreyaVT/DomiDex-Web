import { readFile } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, disableNetwork, doc, enableNetwork, getDocFromCache,
  getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp,
  setDoc, Timestamp, updateDoc, writeBatch, type DocumentData, type Firestore,
} from 'firebase/firestore';
import { decodeCollectionPriceSelection } from '@/lib/collection-price-selections';
import { collectionPriceMetrics, manualSelectionPrice } from '@/lib/price-alternatives';
import type { CollectionEntry } from '@/lib/domain';

// Real isolated JS SDK clients + current Rules, NOT Android Worker/Room/Web-UI E2E.
// Claims and all records are synthetic. No firebase-client or real Auth is initialized.
const projectId = 'demo-domidex-sync';
const owner = 'price-owner-a';
const otherOwner = 'price-owner-b';
const entryId = 'synthetic-entry';
const sourceAt = 1_788_220_700_000;
const selectedAt = sourceAt + 1_000;
const nullableFields = [
  'sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish', 'variant',
  'productId', 'metric', 'amountMinor', 'currency', 'sourceAt', 'selectedAt',
] as const;
let environment: RulesTestEnvironment;

// Rules-unit-testing returns a compat handle. Modular SDK entry points unwrap it;
// keep this documented type bridge at the fixture boundary, not in product code.
const sdk = (context: RulesTestContext) => context.firestore() as unknown as Firestore;

beforeAll(async () => {
  if (process.env.GCLOUD_PROJECT !== projectId
    || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    throw new Error('Requires the explicit demo-domidex-sync project and local Firestore emulator.');
  }
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
}, 30_000);
afterEach(async () => { if (environment) await environment.clearFirestore(); });
afterAll(async () => { if (environment) await environment.cleanup(); });

const metadata = (revision: number, mutation = `mutation-${revision}`) => ({
  revision, lastMutationId: mutation, updatedAt: serverTimestamp(), updatedAtClient: selectedAt + revision,
});
const entryPath = (uid = owner) => `users/${uid}/collectionEntries/${entryId}`;
const choicePath = (uid = owner) => `users/${uid}/collectionPriceSelections/${entryId}`;

function entry(uid = owner, overrides: DocumentData = {}) {
  return {
    ...metadata(1), ownerUid: uid, syncId: entryId, deleted: false, deletedAtClient: null,
    name: 'Synthetic card', setId: 'synthetic-set', setName: 'Synthetic set', collectorNumber: '001/100',
    language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'UNKNOWN', quantity: 1,
    condition: 'Nicht geprüft', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null,
    acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 733596,
    imageUrl: null, effectOverride: null, sourceSetId: 'synthetic-set', sourceCardId: 'synthetic-set-001',
    binderId: 'synthetic-binder', binderSetKey: 'synthetic', binderName: 'Synthetic set', binderHeroAsset: null,
    ...overrides,
  };
}

function choice(revision = 1, overrides: DocumentData = {}, uid = owner) {
  return {
    ...metadata(revision), schemaVersion: 1, ownerUid: uid, entrySyncId: entryId, cleared: false,
    sourceSetId: 'synthetic-set', sourceCardId: 'synthetic-set-001', collectorNumber: '001/100',
    language: 'GERMAN', finish: 'Normal', variant: 'Standard', productId: 733596,
    metric: 'normal_avg_sell', amountMinor: 532, currency: 'EUR', sourceAt, selectedAt,
    ...overrides,
  };
}

function clear(revision: number) {
  return choice(revision, { cleared: true, ...Object.fromEntries(nullableFields.map((field) => [field, null])) });
}

async function seed(withChoice = true) {
  const first = sdk(environment.authenticatedContext(owner, { appAccess: true }));
  const second = sdk(environment.authenticatedContext(owner, { appAccess: true }));
  expect(first).not.toBe(second);
  await setDoc(doc(first, entryPath()), entry());
  if (withChoice) await setDoc(doc(first, choicePath()), choice());
  return { first, second };
}

async function remote(db: Firestore, path = choicePath()) {
  const snapshot = await getDocFromServer(doc(db, path));
  expect(snapshot.exists()).toBe(true);
  expect(snapshot.metadata.fromCache).toBe(false);
  expect(snapshot.metadata.hasPendingWrites).toBe(false);
  return snapshot.data()!;
}

async function sameRemote(first: Firestore, second: Firestore, expected: DocumentData) {
  const [a, b] = await Promise.all([remote(first), remote(second)]);
  expect(a).toEqual(b);
  expect(a).toMatchObject(expected);
  expect(a.updatedAt).toBeInstanceOf(Timestamp);
  return a;
}

function decoded(data: DocumentData, uid = owner) {
  const parsed = decodeCollectionPriceSelection(data, entryId, uid);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function observed(write: Promise<void>) {
  // Attach immediately so deliberately rejected reconnect writes cannot go unhandled.
  return write.then(() => 'ok', (error: { code: string }) => error.code);
}

async function withOffline(db: Firestore, body: () => Promise<void>) {
  await disableNetwork(db);
  try { await body(); } finally { await enableNetwork(db); }
}

async function serverState(path: string) {
  let data!: DocumentData;
  await environment.withSecurityRulesDisabled(async (admin) => { data = await remote(sdk(admin), path); });
  return data;
}

async function localTransportProxy() {
  // A transport interruption, unlike SDK disableNetwork(): this fixture owns
  // only an OS-assigned loopback port and its own sockets; the emulator stays up.
  const target = /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST ?? '');
  if (!target || Number(target[2]) < 1 || Number(target[2]) > 65_535) {
    throw new Error('Transport proxy requires a valid local emulator endpoint.');
  }
  const host = target[1] === '[::1]' ? '::1' : target[1];
  const upstreamPort = Number(target[2]);
  const sockets = new Set<Socket>();
  let blocked = false;
  let blockedConnections = 0;
  const server = createServer((client) => {
    if (blocked) { blockedConnections++; client.destroy(); return; }
    sockets.add(client);
    const upstream = connect({ host, port: upstreamPort });
    sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing proxy address.');
  const interrupt = () => {
    blocked = true;
    for (const socket of sockets) socket.destroy();
  };
  return {
    port: address.port,
    interrupt,
    resume: () => { blocked = false; },
    rejectedConnections: () => blockedConnections,
    close: async () => {
      interrupt();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

describe('two real local SDK clients: additive price-selection sync contract', () => {
  it('round-trips every choice field and keeps the original source date', async () => {
    const { first, second } = await seed();
    const initial = await sameRemote(first, second, { ...choice(), updatedAt: expect.any(Timestamp) });
    expect(manualSelectionPrice(entry() as CollectionEntry, decoded(initial))).toBe(5.32);
    await setDoc(doc(second, choicePath()), choice(2, {
      metric: 'normal_low', amountMinor: 321, lastMutationId: 'second-client', selectedAt: selectedAt + 2_000,
    }));
    const latest = await sameRemote(first, second, {
      revision: 2, metric: 'normal_low', amountMinor: 321, sourceAt, selectedAt: selectedAt + 2_000,
      ownerUid: owner, entrySyncId: entryId, currency: 'EUR', lastMutationId: 'second-client',
    });
    expect(manualSelectionPrice(entry() as CollectionEntry, decoded(latest))).toBe(3.21);
  });

  it('transfers all seven metrics with their exact normal or reverse parent', async () => {
    const { first, second } = await seed(false);
    for (const [index, metric] of collectionPriceMetrics.entries()) {
      const finish = metric.startsWith('reverse_') ? 'Reverse Holo' : 'Normal';
      if (index > 0) await updateDoc(doc(first, entryPath()), { ...metadata(index + 1), finish });
      await setDoc(doc(first, choicePath()), choice(index + 1, { metric, finish, amountMinor: 100 + index }));
      expect(decoded(await sameRemote(first, second, { metric, finish, amountMinor: 100 + index })).metric).toBe(metric);
      const wrong = finish === 'Normal' ? 'reverse_holo_low' : 'normal_low';
      await expect(setDoc(doc(second, choicePath()), choice(index + 2, { metric: wrong, finish })))
        .rejects.toMatchObject({ code: 'permission-denied' });
      expect((await remote(first)).revision).toBe(index + 1);
    }
  });

  it('preserves the entire sidecar when a legacy collection-only client edits quantity and notes', async () => {
    const { first, second } = await seed();
    const before = await remote(second);
    await setDoc(doc(first, entryPath()), entry(owner, { ...metadata(2), quantity: 4, notes: 'Synthetic legacy edit' }));
    expect(await sameRemote(first, second, { revision: 1 })).toEqual(before);
    expect(await remote(second, entryPath())).toMatchObject({ quantity: 4, notes: 'Synthetic legacy edit', revision: 2 });
  });

  it('clears every nullable field and allows an explicit new revision while the parent lives', async () => {
    const { first, second } = await seed();
    await setDoc(doc(second, choicePath()), clear(2));
    const cleared = await sameRemote(first, second, { cleared: true, revision: 2 });
    for (const field of nullableFields) expect(cleared[field]).toBeNull();
    expect(manualSelectionPrice(entry() as CollectionEntry, decoded(cleared))).toBeNull();
    await setDoc(doc(first, choicePath()), choice(3, { amountMinor: 654 }));
    expect(decoded(await sameRemote(first, second, { cleared: false, revision: 3 })).amountMinor).toBe(654);
  });

  it('accepts exactly one simultaneous write based on the same revision', async () => {
    const { first, second } = await seed();
    const outcomes = await Promise.all([
      observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 111, lastMutationId: 'concurrent-a' }))),
      observed(setDoc(doc(second, choicePath()), choice(2, { amountMinor: 222, lastMutationId: 'concurrent-b' }))),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'permission-denied')).toHaveLength(1);
    const winner = outcomes[0] === 'ok' ? { amountMinor: 111, lastMutationId: 'concurrent-a' }
      : { amountMinor: 222, lastMutationId: 'concurrent-b' };
    await sameRemote(first, second, { ...winner, revision: 2 });
  });

  it('preserves confirmed state when transaction races need an explicit fresh retry instead of a guaranteed SDK retry', async () => {
    const { first, second } = await seed();
    let initialReads = 0;
    let release!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => { release = resolve; });
    const calls = [0, 0];
    const write = (db: Firestore, client: number) => runTransaction(db, async (transaction) => {
      calls[client]++;
      const ref = doc(db, choicePath());
      const snapshot = await transaction.get(ref);
      if (calls[client] === 1) {
        initialReads++;
        if (initialReads === 2) release();
        await bothInitialReads;
      }
      const data = snapshot.data()!;
      transaction.set(ref, choice(data.revision + 1, { amountMinor: data.amountMinor + 1, lastMutationId: `transaction-${client}` }));
    });
    const outcomes = await Promise.all([observed(write(first, 0)), observed(write(second, 1))]);
    const committed = outcomes.filter((outcome) => outcome === 'ok').length;
    expect(committed).toBeGreaterThanOrEqual(1);
    expect(outcomes.every((outcome) => outcome === 'ok' || outcome === 'permission-denied')).toBe(true);
    await sameRemote(first, second, { revision: 1 + committed, amountMinor: 532 + committed });
    // A rules rejection is permanent to the SDK, unlike aborted/precondition.
    // Never relax the rules or treat a rejected attempt as an acknowledged write.
    // A deliberate NEW transaction reads the confirmed state and can then apply.
    if (committed === 1) {
      const retryClient = outcomes[0] === 'permission-denied' ? first : second;
      await runTransaction(retryClient, async (transaction) => {
        const ref = doc(retryClient, choicePath());
        const data = (await transaction.get(ref)).data()!;
        expect(data.revision).toBe(2);
        transaction.set(ref, choice(data.revision + 1, { amountMinor: data.amountMinor + 1, lastMutationId: 'explicit-transaction-retry' }));
      });
    } else {
      expect(calls[0] + calls[1]).toBeGreaterThanOrEqual(3);
    }
    console.info('Transaction race outcomes (synthetic fixture):', outcomes.join(', '), 'initial callback counts:', calls.join(', '));
    await sameRemote(first, second, { revision: 3, amountMinor: 534, sourceAt });
  });

  it('reconnects an offline SDK write without duplicating the sidecar or ownership', async () => {
    const { first, second } = await seed();
    let outcome!: Promise<string>;
    await withOffline(first, async () => {
      outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 777 })));
      const local = await getDocFromCache(doc(first, choicePath()));
      expect(local.metadata.hasPendingWrites).toBe(true);
      expect(local.data()).toMatchObject({ revision: 2, amountMinor: 777 });
      expect(await remote(second)).toMatchObject({ revision: 1, amountMinor: 532 });
    });
    expect(await outcome).toBe('ok');
    await sameRemote(first, second, { revision: 2, amountMinor: 777 });
    expect((await getDocsFromServer(collection(second, `users/${owner}/collectionPriceSelections`))).size).toBe(1);
    expect((await getDocsFromServer(collection(second, `users/${owner}/collectionEntries`))).size).toBe(1);
    expect((await remote(second, entryPath())).quantity).toBe(1);
  });

  it('rejects an offline stale choice after the other client changes the same revision', async () => {
    const { first, second } = await seed();
    let outcome!: Promise<string>;
    await withOffline(first, async () => {
      outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 100 })));
      expect((await getDocFromCache(doc(first, choicePath()))).data()?.amountMinor).toBe(100);
      await setDoc(doc(second, choicePath()), choice(2, { amountMinor: 200 }));
    });
    expect(await outcome).toBe('permission-denied');
    await sameRemote(first, second, { revision: 2, amountMinor: 200 });
  });

  it('does not resurrect an old offline choice over a newer clear', async () => {
    const { first, second } = await seed();
    let outcome!: Promise<string>;
    await withOffline(first, async () => {
      outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 100 })));
      await getDocFromCache(doc(first, choicePath()));
      await setDoc(doc(second, choicePath()), clear(2));
    });
    expect(await outcome).toBe('permission-denied');
    const data = await sameRemote(first, second, { revision: 2, cleared: true });
    expect(decoded(data).amountMinor).toBeNull();
  });

  it('rejects offline active writes after parent-only legacy deletion without pretending the old sidecar was deleted', async () => {
    const { first, second } = await seed();
    const before = await remote(second);
    let outcome!: Promise<string>;
    await withOffline(first, async () => {
      outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 123 })));
      await getDocFromCache(doc(first, choicePath()));
      await updateDoc(doc(second, entryPath()), { ...metadata(2), deleted: true, deletedAtClient: selectedAt + 1 });
    });
    expect(await outcome).toBe('permission-denied');
    expect(await sameRemote(first, second, { revision: 1, cleared: false })).toEqual(before);
    const removedEntry = await remote(second, entryPath());
    expect(removedEntry.deleted).toBe(true);
    expect(manualSelectionPrice(removedEntry as CollectionEntry, decoded(before))).toBeNull();
  });

  it('accepts an atomic parent tombstone plus clear, but never a later active selection', async () => {
    const { first, second } = await seed();
    const batch = writeBatch(second);
    batch.update(doc(second, entryPath()), { ...metadata(2), deleted: true, deletedAtClient: selectedAt + 1 });
    batch.set(doc(second, choicePath()), clear(2));
    await batch.commit();
    await sameRemote(first, second, { revision: 2, cleared: true });
    expect((await remote(first, entryPath())).deleted).toBe(true);
    await expect(setDoc(doc(first, choicePath()), choice(3))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a queued old identity, then accepts an explicitly matching new identity', async () => {
    const { first, second } = await seed();
    let outcome!: Promise<string>;
    await withOffline(first, async () => {
      outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 123 })));
      await getDocFromCache(doc(first, choicePath()));
      await updateDoc(doc(second, entryPath()), { ...metadata(2), externalProductId: 733597, sourceCardId: 'synthetic-set-002', collectorNumber: '002/100' });
    });
    expect(await outcome).toBe('permission-denied');
    expect((await remote(second)).revision).toBe(1);
    await setDoc(doc(second, choicePath()), choice(2, { productId: 733597, sourceCardId: 'synthetic-set-002', collectorNumber: '002/100' }));
    const data = await sameRemote(first, second, { revision: 2, productId: 733597, sourceCardId: 'synthetic-set-002' });
    expect(manualSelectionPrice((await remote(first, entryPath())) as CollectionEntry, decoded(data))).toBe(5.32);
  });

  for (const restriction of ['appAccess', 'disabled', 'deletionLock'] as const) {
    it(`rejects queued writes after server-side ${restriction} without changing the stored choice`, async () => {
      const { first, second } = await seed();
      const before = await remote(second);
      let outcome!: Promise<string>;
      await withOffline(first, async () => {
        outcome = observed(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 999 })));
        await getDocFromCache(doc(first, choicePath()));
        await environment.withSecurityRulesDisabled(async (admin) => {
          const path = restriction === 'deletionLock' ? `accountDeletionLocks/${owner}` : `accountAccess/${owner}`;
          const value = restriction === 'deletionLock' ? { jobId: 'synthetic-job' }
            : restriction === 'disabled' ? { disabled: true } : { appAccess: false };
          await setDoc(doc(admin.firestore(), path), value);
        });
      });
      expect(await outcome).toBe('permission-denied');
      expect(await serverState(choicePath())).toEqual(before);
      await expect(getDocFromServer(doc(second, choicePath()))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(setDoc(doc(second, choicePath()), clear(2))).rejects.toMatchObject({ code: 'permission-denied' });
    });
  }

  it('requires a fresh explicit write after access is restored instead of replaying the rejected write', async () => {
    const { first, second } = await seed();
    await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `accountAccess/${owner}`), { appAccess: false }));
    await expect(setDoc(doc(first, choicePath()), choice(2, { amountMinor: 999 }))).rejects.toMatchObject({ code: 'permission-denied' });
    await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `accountAccess/${owner}`), { appAccess: true }));
    await sameRemote(first, second, { revision: 1, amountMinor: 532 });
    await setDoc(doc(first, choicePath()), choice(2, { amountMinor: 444, lastMutationId: 'explicit-retry' }));
    await sameRemote(first, second, { revision: 2, amountMinor: 444, lastMutationId: 'explicit-retry' });
  });

  it('isolates different owners while both can use their own sidecar', async () => {
    const { first, second } = await seed();
    const foreign = sdk(environment.authenticatedContext(otherOwner, { appAccess: true }));
    await expect(getDocFromServer(doc(foreign, choicePath()))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDocsFromServer(collection(foreign, `users/${owner}/collectionPriceSelections`))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(foreign, choicePath()), choice(2))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(foreign, choicePath()), clear(2))).rejects.toMatchObject({ code: 'permission-denied' });
    await setDoc(doc(foreign, entryPath(otherOwner)), entry(otherOwner));
    await setDoc(doc(foreign, choicePath(otherOwner)), choice(1, { amountMinor: 888 }, otherOwner));
    expect(decoded(await remote(foreign, choicePath(otherOwner)), otherOwner).amountMinor).toBe(888);
    await expect(getDocFromServer(doc(first, choicePath(otherOwner)))).rejects.toMatchObject({ code: 'permission-denied' });
    await sameRemote(first, second, { revision: 1, amountMinor: 532 });
  });

  it('rejects physical deletion and a foreign owner field without removing the valid choice', async () => {
    const { first, second } = await seed();
    const before = await remote(first);
    await expect(deleteDoc(doc(second, choicePath()))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(second, choicePath()), choice(2, { ownerUid: otherOwner }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await sameRemote(first, second, { revision: 1 })).toEqual(before);
  });

  it('delivers confirmed remote selection and clear snapshots to a second real SDK listener', async () => {
    const { first, second } = await seed();
    const seen: number[] = [];
    let receive!: (data: DocumentData) => void;
    let reject!: (error: Error) => void;
    let wanted = 1;
    const next = (revision: number) => {
      wanted = revision;
      return new Promise<DocumentData>((resolve, fail) => { receive = resolve; reject = fail; });
    };
    const initial = next(1);
    const unsubscribe = onSnapshot(doc(second, choicePath()), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites || !snapshot.exists()) return;
      const data = snapshot.data();
      seen.push(data.revision);
      if (data.revision === wanted) receive(data);
    }, (error) => reject(error));
    try {
      expect(decoded(await initial).amountMinor).toBe(532);
      const changed = next(2);
      await setDoc(doc(first, choicePath()), choice(2, { amountMinor: 640 }));
      expect(decoded(await changed).amountMinor).toBe(640);
      const cleared = next(3);
      await setDoc(doc(first, choicePath()), clear(3));
      expect(decoded(await cleared).cleared).toBe(true);
      expect(seen).toEqual(expect.arrayContaining([1, 2, 3]));
    } finally { unsubscribe(); }
  });

  it('documents that disableNetwork stops SDK streams but is not a transaction transport outage in this Node SDK', async () => {
    const { first, second } = await seed();
    await withOffline(first, async () => {
      await runTransaction(first, async (transaction) => {
        const ref = doc(first, choicePath());
        const snapshot = await transaction.get(ref);
        transaction.set(ref, choice(snapshot.data()!.revision + 1, { amountMinor: 999 }));
      });
      // Second client proves this was a real server commit while streams were disabled.
      expect(await remote(second)).toMatchObject({ revision: 2, amountMinor: 999 });
    });
    await sameRemote(first, second, { revision: 2, amountMinor: 999 });
  });

  it('rejects a transaction across an actual interrupted loopback transport and never replays it after reconnect', async () => {
    const { second } = await seed();
    const proxy = await localTransportProxy();
    let proxyEnvironment: RulesTestEnvironment | undefined;
    try {
      proxyEnvironment = await initializeTestEnvironment({
        projectId, firestore: { host: '127.0.0.1', port: proxy.port },
      });
      const interrupted = sdk(proxyEnvironment.authenticatedContext(owner, { appAccess: true }));
      expect(await remote(interrupted)).toMatchObject({ revision: 1, amountMinor: 532 });
      proxy.interrupt();
      const outcome = await observed(runTransaction(interrupted, async (transaction) => {
        const ref = doc(interrupted, choicePath());
        const snapshot = await transaction.get(ref);
        transaction.set(ref, choice(snapshot.data()!.revision + 1, { amountMinor: 999 }));
      }));
      // An interrupted established gRPC call reports cancelled; a failed new
      // connection can report unavailable. Neither permits a successful commit.
      expect(['cancelled', 'unavailable']).toContain(outcome);
      expect(proxy.rejectedConnections()).toBeGreaterThan(0);
      expect(await remote(second)).toMatchObject({ revision: 1, amountMinor: 532 });
      proxy.resume();
      await sameRemote(interrupted, second, { revision: 1, amountMinor: 532 });
      // Only this new explicit action creates a mutation, not reconnect itself.
      await runTransaction(interrupted, async (transaction) => {
        const ref = doc(interrupted, choicePath());
        const data = (await transaction.get(ref)).data()!;
        transaction.set(ref, choice(data.revision + 1, { amountMinor: 444, lastMutationId: 'after-transport-restored' }));
      });
      await sameRemote(interrupted, second, { revision: 2, amountMinor: 444, lastMutationId: 'after-transport-restored' });
    } finally {
      proxy.resume();
      try { await proxyEnvironment?.cleanup(); } finally { await proxy.close(); }
    }
  });
});
