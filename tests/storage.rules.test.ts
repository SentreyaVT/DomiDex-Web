import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

let environment: RulesTestEnvironment;
const projectId = 'cardvault-715ac-web-storage-test';

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearStorage();
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.storage().ref('scanner-reference/master-index.json').put(new TextEncoder().encode('{}'), { contentType: 'application/json' });
  });
});

afterAll(async () => environment.cleanup());

describe('DomiDex Storage rules', () => {
  it('allows only administrators to read scanner references', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true });
    const user = environment.authenticatedContext('user');
    const anonymous = environment.unauthenticatedContext();

    await assertSucceeds(admin.storage().ref('scanner-reference/master-index.json').getDownloadURL());
    await assertFails(user.storage().ref('scanner-reference/master-index.json').getDownloadURL());
    await assertFails(anonymous.storage().ref('scanner-reference/master-index.json').getDownloadURL());
  });

  it('denies scanner-reference uploads even to administrators', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true });
    await assertFails(Promise.resolve(admin.storage().ref('scanner-reference/other.json').put(new TextEncoder().encode('{}'), { contentType: 'application/json' })));
  });

  it('requires appAccess for private user images and keeps users isolated', async () => {
    const denied = environment.authenticatedContext('owner');
    const pretesterOnly = environment.authenticatedContext('tester', { pretester: true });
    const owner = environment.authenticatedContext('owner', { appAccess: true });
    const other = environment.authenticatedContext('other', { appAccess: true });
    const admin = environment.authenticatedContext('admin', { admin: true });
    const path = 'users/owner/cards/front.webp';
    const payload = new Uint8Array([1, 2, 3]);
    const metadata = { contentType: 'image/webp' };

    await assertFails(Promise.resolve(denied.storage().ref(path).put(payload, metadata)));
    await assertFails(Promise.resolve(pretesterOnly.storage().ref('users/tester/cards/front.webp').put(payload, metadata)));
    await assertSucceeds(Promise.resolve(owner.storage().ref(path).put(payload, metadata)));
    await assertSucceeds(owner.storage().ref(path).getDownloadURL());
    await assertFails(other.storage().ref(path).getDownloadURL());
    await assertFails(admin.storage().ref(path).getDownloadURL());
  });

  it('denies all direct report image access, including admin token creation', async () => {
    const tester = environment.authenticatedContext('tester', { pretester: true });
    const admin = environment.authenticatedContext('admin', { admin: true });
    const user = environment.authenticatedContext('user');
    const path = 'scanner-report-images/report-1/capture.webp';
    const metadata = { contentType: 'image/webp', customMetadata: { ownerUid: 'tester', reportId: 'report-1', captureType: 'MANUAL_CAPTURE', contentSha256: 'a'.repeat(64) } };
    await assertFails(Promise.resolve(tester.storage().ref(path).put(new Uint8Array([1, 2, 3]), metadata)));
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(path).put(new Uint8Array([1, 2, 3]), metadata);
    });
    await assertFails(tester.storage().ref(path).getDownloadURL());
    await assertFails(admin.storage().ref(path).getDownloadURL());
    await assertFails(user.storage().ref(path).getDownloadURL());
    await assertFails(environment.unauthenticatedContext().storage().ref(path).getDownloadURL());
    await assertFails(Promise.resolve(user.storage().ref('scanner-report-images/report-2/capture.webp').put(new Uint8Array([1]), { ...metadata, customMetadata: { ...metadata.customMetadata, ownerUid: 'user', reportId: 'report-2' } })));
    await assertFails(Promise.resolve(tester.storage().ref('scanner-report-images/report-3/capture.webp').put(new Uint8Array([1]), { ...metadata, customMetadata: { ...metadata.customMetadata, reportId: 'report-3', captureType: 'AUTO_CAPTURE' } })));
  });
});
