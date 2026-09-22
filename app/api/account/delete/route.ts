import { privateOperations } from '@/lib/server/private-cloud-operations';
import { serverFailure } from '@/lib/server/server-failure';
import { boundedJson } from '@/lib/bounded-json';

export async function POST(request: Request) {
  try {
    // The public self-service route never accepts an arbitrary target UID.
    const body = await boundedJson(request, 2048);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const safe = new Request(request.url, {
      method: 'POST', headers,
      body: JSON.stringify({ confirm: body.confirm }),
    });
    return (await privateOperations()).deletionRequest(safe);
  } catch (error) {
    if (error instanceof Error && ['INVALID_REQUEST', 'REQUEST_TOO_LARGE'].includes(error.message)) {
      return Response.json({ error: error.message }, { status: error.message === 'REQUEST_TOO_LARGE' ? 413 : 400, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return serverFailure('self-account-deletion', error, 'Der Löschauftrag konnte nicht verarbeitet werden. Bitte erneut versuchen.');
  }
}
