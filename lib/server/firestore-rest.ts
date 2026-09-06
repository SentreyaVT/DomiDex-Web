const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
const documentRoot = `projects/${projectId}/databases/(default)/documents`;
const root = `https://firestore.googleapis.com/v1/${documentRoot}`;

export function encodeFirestore(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestore) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new Error('INVALID_FIRESTORE_VALUE');
}

export function encodeFields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeFirestore(item)]));
}

export function decodeFirestore(value: Record<string, unknown>): unknown {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (((value.arrayValue as { values?: Array<Record<string, unknown>> })?.values) ?? []).map(decodeFirestore);
  if ('mapValue' in value) return decodeFields(((value.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields) ?? {});
  return null;
}

export function decodeFields(fields: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestore(value)]));
}

export async function listDocuments(collection: string, authorization: string) {
  const documents: Array<{ documentId: string } & Record<string, unknown>> = [];
  let pageToken = '';
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ pageSize: '300' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch(`${root}/${collection}?${query}`, { headers: { Authorization: authorization } });
    if (response.status === 404) return documents;
    if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
    const body = await response.json() as { documents?: Array<{ name: string; fields?: Record<string, Record<string, unknown>> }>; nextPageToken?: string };
    documents.push(...(body.documents ?? []).map((document) => ({ documentId: document.name.split('/').pop()!, ...decodeFields(document.fields ?? {}) })));
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) return documents;
  }
  throw new Error('FIRESTORE_PAGINATION_LIMIT');
}

export async function listDocumentsPage(collection: string, authorization: string, options: { pageSize?: number; pageToken?: string; orderBy?: string } = {}) {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 48)));
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (options.pageToken) query.set('pageToken', options.pageToken);
  if (options.orderBy) query.set('orderBy', options.orderBy);
  const response = await fetch(`${root}/${collection}?${query}`, { headers: { Authorization: authorization } });
  if (response.status === 404) return { documents: [] as Array<{ documentId: string } & Record<string, unknown>>, nextPageToken: '' };
  if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
  const body = await response.json() as { documents?: Array<{ name: string; fields?: Record<string, Record<string, unknown>> }>; nextPageToken?: string };
  return {
    documents: (body.documents ?? []).map((document) => ({ documentId: document.name.split('/').pop()!, ...decodeFields(document.fields ?? {}) })),
    nextPageToken: body.nextPageToken ?? '',
  };
}

export async function countDocuments(collection: string, authorization: string) {
  const response = await fetch(`${root}:runAggregationQuery`, {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: collection }] }, aggregations: [{ alias: 'total', count: {} }] } }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
  const body = await response.json() as Array<{ result?: { aggregateFields?: { total?: { integerValue?: string } } } }>;
  const total = Number(body.find((item) => item.result?.aggregateFields?.total)?.result?.aggregateFields?.total?.integerValue);
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

export async function getDocument(path: string, authorization: string) {
  const response = await fetch(`${root}/${path}`, { headers: { Authorization: authorization } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
  const body = await response.json() as { name: string; fields?: Record<string, Record<string, unknown>> };
  return { documentId: body.name.split('/').pop()!, ...decodeFields(body.fields ?? {}) };
}

export async function commitDocuments(writes: Array<Record<string, unknown>>, authorization: string) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
  return response.json();
}

export function setWrite(collection: string, documentId: string, value: Record<string, unknown>, createOnly = false) {
  return {
    update: { name: `${documentRoot}/${collection}/${documentId}`, fields: encodeFields(value) },
    ...(createOnly ? { currentDocument: { exists: false } } : {}),
  };
}
