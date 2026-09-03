import { defaultSiteContent } from '@/lib/domain';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/siteContent/public`;

export async function GET() {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (response.status === 404) return Response.json(defaultSiteContent, { headers: cacheHeaders });
    if (!response.ok) throw new Error('FIRESTORE_UNAVAILABLE');
    const document = await response.json() as { fields?: Record<string, FirestoreValue> };
    const decoded = fromFields(document.fields ?? {}) as Partial<typeof defaultSiteContent>;
    const allowed = Object.fromEntries(Object.keys(defaultSiteContent).flatMap((key) => key in decoded ? [[key, decoded[key as keyof typeof decoded]]] : []));
    return Response.json({ ...defaultSiteContent, ...allowed }, { headers: cacheHeaders });
  } catch {
    return Response.json(defaultSiteContent, { headers: { 'Cache-Control': 'no-store' } });
  }
}

const cacheHeaders = { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' };
type FirestoreValue = { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number; nullValue?: null; arrayValue?: { values?: FirestoreValue[] }; mapValue?: { fields?: Record<string, FirestoreValue> } };
function fromFields(fields: Record<string, FirestoreValue>) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)])); }
function fromValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue?.fields ?? {});
  return null;
}
