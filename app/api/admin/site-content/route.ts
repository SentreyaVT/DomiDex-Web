import { requireAdminToken } from '@/lib/server/firebase-token';
import { defaultSiteContent, type SiteContent } from '@/lib/domain';
import { boundedJson } from '@/lib/bounded-json';

// Existing 50 updates + 80 roadmap entries and all field maxima fit below
// 4 MiB even at six wire bytes per escaped UTF-16 code unit. No field is reduced.
const maximumBodyBytes = 4 * 1024 * 1024;

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
const documentUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/siteContent/public`;

export async function PUT(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    await requireAdminToken(authorization);
    const content = validateContent(await boundedJson(request, maximumBodyBytes));
    const response = await fetch(documentUrl, {
      method: 'PATCH',
      headers: { Authorization: authorization!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(content) }),
    });
    if (!response.ok) return Response.json({ error: 'Website-Inhalte konnten nicht gespeichert werden.' }, { status: response.status });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (message === 'AUTH_REQUIRED') return Response.json({ error: 'Anmeldung erforderlich.' }, { status: 401 });
    if (message === 'ADMIN_REQUIRED') return Response.json({ error: 'Administratorrechte erforderlich.' }, { status: 403 });
    if (message === 'REQUEST_TOO_LARGE' || message === 'INVALID_REQUEST') {
      return Response.json({ error: message === 'REQUEST_TOO_LARGE' ? 'Die Anfrage ist zu groß.' : 'Ungültige JSON-Anfrage.' }, {
        status: message === 'REQUEST_TOO_LARGE' ? 413 : 400, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return Response.json({ error: 'Ungültige Website-Daten.' }, { status: 400 });
  }
}

function validateContent(value: unknown): SiteContent {
  if (!value || typeof value !== 'object') throw new Error('INVALID');
  const input = value as Partial<SiteContent>;
  const text = (field: unknown, max: number) => typeof field === 'string' ? field.trim().slice(0, max) : '';
  const statuses = new Set(['Released', 'In Development', 'Planned', 'Experimental']);
  const updates = Array.isArray(input.updates) ? input.updates.slice(0, 50).map((update) => ({
    id: text(update?.id, 80) || crypto.randomUUID(), title: text(update?.title, 160), date: text(update?.date, 30),
    version: text(update?.version, 40), build: text(update?.build, 40), summary: text(update?.summary, 500),
    details: text(update?.details, 4_000), imageUrl: text(update?.imageUrl, 2_000), linkUrl: text(update?.linkUrl, 2_000),
    active: update?.active !== false,
  })).filter((update) => update.title) : [];
  const roadmap = Array.isArray(input.roadmap) ? input.roadmap.slice(0, 80).map((item, index) => ({
    id: text(item?.id, 80) || crypto.randomUUID(), title: text(item?.title, 160), description: text(item?.description, 1_000),
    status: statuses.has(String(item?.status)) ? item!.status : 'Planned', order: Number.isFinite(item?.order) ? Number(item!.order) : index,
  })).filter((item) => item.title) as SiteContent['roadmap'] : [];
  return {
    heroTitle: text(input.heroTitle, 240) || defaultSiteContent.heroTitle,
    heroSubtitle: text(input.heroSubtitle, 1_000) || defaultSiteContent.heroSubtitle,
    statusBanner: text(input.statusBanner, 400), currentVersion: text(input.currentVersion, 40),
    currentBuild: text(input.currentBuild, 40), releaseStatus: text(input.releaseStatus, 40),
    discordUrl: safeUrl(text(input.discordUrl, 2_000)), discordText: text(input.discordText, 1_000),
    kickstarterUrl: safeUrl(text(input.kickstarterUrl, 2_000)),
    kickstarterCta: text(input.kickstarterCta, 100), updates, roadmap,
  };
}

function safeUrl(value: string) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('INVALID_URL');
  return url.toString();
}

function toFirestoreFields(value: object) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)]));
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFirestoreFields(value) } };
  throw new Error('INVALID_VALUE');
}
