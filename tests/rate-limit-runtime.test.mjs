import { describe, expect, it, vi } from 'vitest';
import { uploadReport } from '../backend/security/images.mjs';
import { createBinderShare, revokeBinderShare } from '../backend/security/sharing.mjs';
import { changeRole } from '../backend/security/access.mjs';

function fixture() {
  const documents = new Map();
  const claims = new Map([['operator', { admin: true }]]);
  let time = 1_800_000_000_000;
  const read = path => ({ exists: documents.has(path), data: () => documents.get(path),
    get: key => documents.get(path)?.[key], readTime: { toMillis: () => time } });
  const ref = path => ({ path, get: async () => read(path),
    create: async value => { documents.set(path, value); } });
  const context = {
    sharingEnabled: true,
    rateLimitMode: 'enforce',
    auth: {
      verifyIdToken: vi.fn(async token => {
        if (token !== 'admin-session') throw new Error('PRIVATE_TOKEN_VALUE');
        return { uid: 'operator', admin: true };
      }),
      getUser: vi.fn(async uid => ({ disabled: false, customClaims: claims.get(uid) ?? {} })),
      setCustomUserClaims: vi.fn(async (uid, value) => { claims.set(uid, value); }), revokeRefreshTokens: vi.fn(async () => {}),
    },
    db: {
      doc: ref,
      collection: name => ({ doc: () => ref(`${name}/audit`) }),
      runTransaction: vi.fn(async work => work({ get: async reference => read(reference.path),
        set: (reference, value, options) => documents.set(reference.path, options?.merge ? { ...documents.get(reference.path), ...value } : value),
        update: (reference, value) => documents.set(reference.path, { ...documents.get(reference.path), ...value }),
        create: (reference, value) => documents.set(reference.path, value),
      })),
    },
    bucket: { file: vi.fn() },
  };
  documents.set('users/operator/privateBinders/binder', { ownerUid: 'operator', binderId: 'binder', deleted: false });
  return { context, documents, advance: amount => { time += amount; } };
}
const request = (body, token = 'admin-session') => new Request('https://example.invalid/write', {
  method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('rate limits at direct authenticated backend operation boundaries', () => {
  it('limits the sixth authenticated upload before binary parsing', async () => {
    const { context } = fixture();
    for (let index = 0; index < 5; index++) expect((await uploadReport(request({}), context)).status).toBe(400);
    const sixth = request({});
    const bodyReader = vi.spyOn(sixth.body, 'getReader');
    const response = await uploadReport(sixth, context);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('600');
    expect(await response.json()).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 600 });
    expect(bodyReader).not.toHaveBeenCalled();
    expect(context.bucket.file).not.toHaveBeenCalled();
  });

  it('limits share creation at twenty and keeps revocation available', async () => {
    const { context } = fixture();
    let shareId;
    for (let index = 0; index < 20; index++) {
      const response = await createBinderShare(request({ binderId: 'binder', confirm: true }), context);
      expect(response.status).toBe(201);
      shareId = (await response.json()).shareId;
    }
    expect((await createBinderShare(request({ binderId: 'binder', confirm: true }), context)).status).toBe(429);
    expect((await revokeBinderShare(request({ shareId, confirm: true }), context)).status).toBe(200);
  });

  it('does not trust a caller-supplied UID as admin authorization', async () => {
    const { context } = fixture();
    await expect(changeRole('target', 'pretester', true, 'operator', context)).rejects.toMatchObject({ status: 401 });
    expect(context.db.runTransaction).not.toHaveBeenCalled();
    expect(context.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('limits grants per current admin and never prevents rights revocation', async () => {
    const { context } = fixture();
    for (let index = 0; index < 30; index++) await changeRole('target', 'pretester', true, 'Bearer admin-session', context);
    await expect(changeRole('target', 'pretester', true, 'Bearer admin-session', context)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    await expect(changeRole('target', 'pretester', false, 'Bearer admin-session', context)).resolves.toBeUndefined();
    expect(context.auth.revokeRefreshTokens).toHaveBeenCalledWith('target');
    context.rateLimitMode = 'invalid';
    await expect(changeRole('target', 'pretester', false, 'Bearer admin-session', context)).resolves.toBeUndefined();
  });

  it('returns 503 for quota infrastructure failure without processing the upload', async () => {
    const { context } = fixture();
    context.db.runTransaction.mockRejectedValueOnce(new Error('SECRET_BACKEND_FAILURE'));
    const input = request({});
    const bodyReader = vi.spyOn(input.body, 'getReader');
    const response = await uploadReport(input, context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
    expect(bodyReader).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated calls before quota storage or body processing', async () => {
    const { context } = fixture();
    const unauthorized = request({}, null);
    const bodyReader = vi.spyOn(unauthorized.body, 'getReader');
    expect((await uploadReport(unauthorized, context)).status).toBe(401);
    expect(context.db.runTransaction).not.toHaveBeenCalled();
    expect(bodyReader).not.toHaveBeenCalled();
  });
});
