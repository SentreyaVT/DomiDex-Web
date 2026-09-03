export function firebaseStorageBucket() {
  const value = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? '';
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : '';
}

export async function readFirebaseStorageObject(objectName: string, authorization: string) {
  const bucket = firebaseStorageBucket();
  const token = firebaseToken(authorization);
  if (!bucket || !token || !safeObjectName(objectName)) return null;
  try {
    return await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`, {
      headers: { Authorization: `Firebase ${token}` }, signal: AbortSignal.timeout(15_000),
    });
  } catch { return null; }
}

export async function uploadFirebaseStorageObject(
  objectName: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  metadata: Record<string, string>,
  authorization: string,
) {
  const bucket = firebaseStorageBucket();
  const token = firebaseToken(authorization);
  if (!bucket || !token || !safeObjectName(objectName)) throw new Error('STORAGE_NOT_CONFIGURED');
  const boundary = `domidex-${crypto.randomUUID()}`;
  const resource = JSON.stringify({ name: objectName, size: bytes.byteLength, contentType, metadata });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${resource}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(objectName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Firebase ${token}`,
      'X-Goog-Upload-Protocol': 'multipart',
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`STORAGE_${response.status}`);
  return response;
}

function firebaseToken(authorization: string) { return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function safeObjectName(value: string) { return value.length > 0 && value.length <= 1_024 && !value.startsWith('/') && !value.includes('..') && !/[\r\n\\]/.test(value); }
