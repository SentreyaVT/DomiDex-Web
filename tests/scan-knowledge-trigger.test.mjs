import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import the actual exported handler; only Firebase SDK boundaries are mocked.
// Both real local helper modules (current evidence and aggregation) remain active.
const entry = new URL('../backend/scan-knowledge/index.js', import.meta.url);
const backendRequire = createRequire(entry);
const initializeApp = vi.fn();
const onDocumentWritten = vi.fn((_options, handler) => handler);
const timestamp = Symbol('server-timestamp');
let db;

function mockSdkExport(specifier, factory) {
  const resolved = backendRequire.resolve(specifier);
  let directory = path.dirname(resolved);
  const packageName = specifier.split('/')[0];
  let metadata;
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (metadata.name === packageName) break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`SDK package not found: ${packageName}`);
    directory = parent;
  }
  // Firebase SDK packages expose separate ESM/CJS entry points. Register both
  // without importing/initializing either SDK or assuming global CLI installs.
  vi.doMock(resolved, factory);
  const conditions = metadata.exports[`./${specifier.slice(packageName.length + 1)}`];
  if (conditions.import) vi.doMock(path.resolve(directory, conditions.import), factory);
}

mockSdkExport('firebase-admin/app', () => ({ initializeApp }));
mockSdkExport('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { serverTimestamp: () => timestamp },
}));
mockSdkExport('firebase-functions/v2/firestore', () => ({ onDocumentWritten }));
const { aggregateScanKnowledge } = await import('../backend/scan-knowledge/index.js');

const uid = 'synthetic-owner';
const fingerprint = 'a'.repeat(64);
const evidencePath = `users/${uid}/scanEvidence/${fingerprint}`;
const lockPath = `accountDeletionLocks/${uid}`;
const privatePath = `scanKnowledgePrivate/${fingerprint}`;
const contributorPath = `${privatePath}/contributors/${crypto.createHash('sha256').update(uid).digest('hex')}`;
const publicPath = `scanKnowledge/${fingerprint}`;
const ref = pathValue => ({ path: pathValue, collection: name => ({ doc: id => ref(`${pathValue}/${name}/${id}`) }) });
const version = value => ({ value, isEqual: other => other?.value === value });
const snapshot = (value, updateTime = version(1)) => ({ exists: value !== undefined, updateTime, data: () => value });
const evidence = {
  fingerprint, confirmedCardId: 'sv3-215', observedAtClient: 1234,
  corrected: true, sourceSetId: 'sv3', cardNumber: '215', setCode: 'OBF', knowledgeVersion: 1,
};
let state;
let transaction;
let event;

beforeEach(() => {
  state = new Map([
    [evidencePath, snapshot(evidence)], [lockPath, snapshot(undefined)],
    [privatePath, snapshot(undefined)], [contributorPath, snapshot(undefined)],
  ]);
  transaction = {
    get: vi.fn(async document => {
      if (!state.has(document.path)) throw new Error(`Unexpected synthetic read: ${document.path}`);
      return state.get(document.path);
    }),
    set: vi.fn(),
  };
  db = { doc: ref, runTransaction: vi.fn(async callback => callback(transaction)) };
  event = { params: { uid, fingerprint }, data: { after: {
    ref: ref(evidencePath), updateTime: version(1), data: () => evidence,
  } } };
});

describe('canonical actual Functions export — SDK-isolated regression', () => {
  it('registers the existing regional trigger without changing its document path or codebase', () => {
    expect(initializeApp).toHaveBeenCalledExactlyOnceWith();
    expect(onDocumentWritten).toHaveBeenCalledExactlyOnceWith({
      document: 'users/{uid}/scanEvidence/{fingerprint}', region: 'europe-west1', maxInstances: 10,
    }, aggregateScanKnowledge);
    const root = fileURLToPath(new URL('../', import.meta.url));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    expect(config.functions).toEqual({ source: 'backend/scan-knowledge', codebase: 'default' });
    expect(fs.readFileSync(path.join(root, 'docs/WEBAPP_RELEASE_27_HANDOFF.md'), 'utf8'))
      .toContain('Canonical Functions source: `DomiDex-Web/backend/scan-knowledge`');
  });

  it('runs the real current-evidence guard before aggregating a current unlocked event', async () => {
    await aggregateScanKnowledge(event);
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.get.mock.calls.map(([document]) => document.path))
      .toEqual([evidencePath, lockPath, privatePath, contributorPath]);
    expect(transaction.set).toHaveBeenCalledTimes(3);
    const writes = transaction.set.mock.calls;
    expect(writes.map(([document]) => document.path)).toEqual([privatePath, contributorPath, publicPath]);
    expect(writes[0][1]).toEqual({
      votes: { 'sv3-215': 1 }, correctionVotes: { 'sv3-215': 1 },
      identities: { 'sv3-215': { sourceSetId: 'sv3', cardNumber: '215', setCode: 'OBF' } },
      total: 1, knowledgeVersion: 1, lastUpdatedAt: timestamp,
    });
    expect(writes[0][2]).toEqual({ merge: true });
    expect(writes[1][1]).toEqual({
      cardId: 'sv3-215', corrected: true, sourceSetId: 'sv3', cardNumber: '215',
      setCode: 'OBF', observedAtClient: 1234, updatedAt: timestamp,
    });
    expect(writes[2][1]).toEqual({
      fingerprint, cardId: 'sv3-215', sourceSetId: 'sv3', cardNumber: '215', setCode: 'OBF',
      status: 'CANDIDATE', confidence: 100, confirmations: 1, corrections: 0,
      manualCorrections: 1, knowledgeVersion: 1, lastUpdatedAt: timestamp,
    });
    expect(transaction.get.mock.invocationCallOrder.at(-1))
      .toBeLessThan(transaction.set.mock.invocationCallOrder[0]);
  });

  it.each(['replaced evidence', 'deleted evidence', 'active deletion lock'])(
    'rejects %s before reading aggregates or writing any public/private vote', async scenario => {
      if (scenario === 'replaced evidence') state.set(evidencePath, snapshot(evidence, version(2)));
      if (scenario === 'deleted evidence') state.set(evidencePath, snapshot(undefined));
      if (scenario === 'active deletion lock') state.set(lockPath, snapshot({ phase: 'inventory' }));
      await aggregateScanKnowledge(event);
      expect(transaction.get.mock.calls.map(([document]) => document.path)).toEqual([evidencePath, lockPath]);
      expect(transaction.set).not.toHaveBeenCalled();
    },
  );

  it('does not count an already processed current contribution again', async () => {
    state.set(contributorPath, snapshot({ cardId: 'sv3-215', observedAtClient: 1234 }));
    await aggregateScanKnowledge(event);
    expect(transaction.get.mock.calls.map(([document]) => document.path))
      .toEqual([evidencePath, lockPath, privatePath, contributorPath]);
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it('propagates guard read failure without writing fallback aggregates', async () => {
    transaction.get.mockImplementation(async document => {
      if (document.path === lockPath) throw new Error('synthetic-lock-read-failure');
      return state.get(document.path);
    });
    await expect(aggregateScanKnowledge(event)).rejects.toThrow('synthetic-lock-read-failure');
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it.each(['deleted event', 'missing event', 'mismatching fingerprint', 'malformed fingerprint'])(
    'ignores %s without starting a transaction', async scenario => {
      if (scenario === 'deleted event') event.data.after.data = () => undefined;
      if (scenario === 'missing event') event.data = undefined;
      if (scenario === 'mismatching fingerprint') event.params.fingerprint = 'b'.repeat(64);
      if (scenario === 'malformed fingerprint') {
        event.params.fingerprint = 'invalid';
        event.data.after.data = () => ({ ...evidence, fingerprint: 'invalid' });
      }
      await aggregateScanKnowledge(event);
      expect(db.runTransaction).not.toHaveBeenCalled();
      expect(transaction.set).not.toHaveBeenCalled();
    },
  );
});
