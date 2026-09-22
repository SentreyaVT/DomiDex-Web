export function serverFailure(operation: string, error: unknown, message: string) {
  const errorId = crypto.randomUUID();
  const raw = error instanceof Error ? error.message : '';
  // Deliberately exclude messages, stack traces, tokens, paths and user payloads.
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(raw) ? raw : 'UNEXPECTED_FAILURE';
  console.error('DOMIDEX_SERVER_ERROR', { errorId, operation, code });
  return Response.json({ error: message, errorId }, {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': errorId },
  });
}
