/** Preserve Fetch input semantics instead of stringifying Request as an object. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** These route fixtures expect JSON serialized into a string request body. */
export function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('String request body expected.');
  return body;
}
