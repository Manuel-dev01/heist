export class RequestInputError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export function assertLocalRequest(request: Request): void {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new RequestInputError(403, 'local_preview_only');
  // Next may normalize its internal URL to localhost. Bind Origin to the actual
  // loopback Host, never to forwarded headers or an arbitrary caller-supplied host.
  const authority = request.headers.get('host') ?? url.host;
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/i.test(authority))
    throw new RequestInputError(403, 'local_preview_only');
  let external: URL;
  try { external = new URL(url.protocol + '//' + authority); }
  catch { throw new RequestInputError(403, 'local_preview_only'); }
  if (external.port !== url.port) throw new RequestInputError(403, 'origin_rejected');
  const origin = request.headers.get('origin');
  if (origin && origin !== external.origin) throw new RequestInputError(403, 'origin_rejected');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestInputError(403, 'origin_rejected');
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestInputError(415, 'json_required');
}

export const JSON_BODY_DEADLINE_MS = 5_000;
export const MAX_IN_FLIGHT_JSON_READERS = 8;
let inFlightJsonReaders = 0;

function cancelBodySafely(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try { void body.cancel().catch(() => {}); } catch { /* Cancellation is best-effort. */ }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  assertLocalRequest(request);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_097_152)
    throw new RequestInputError(500, 'invalid_body_limit');
  if (request.signal.aborted) {
    cancelBodySafely(request.body);
    throw new RequestInputError(408, 'request_aborted');
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    cancelBodySafely(request.body);
    throw new RequestInputError(413, 'body_too_large');
  }
  if (!request.body) throw new RequestInputError(400, 'body_required');
  if (inFlightJsonReaders >= MAX_IN_FLIGHT_JSON_READERS) {
    cancelBodySafely(request.body);
    throw new RequestInputError(429, 'local_reader_limit');
  }
  const reader = request.body.getReader();
  inFlightJsonReaders++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped: RequestInputError | undefined;
  let rejectStopped: (error: RequestInputError) => void = () => {};
  let cancelRequested = false;
  const cancelReader = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    // Never await an untrusted stream's cancellation callback.
    try { void reader.cancel().catch(() => {}); } catch { /* Reader may already be closed. */ }
  };
  const interrupted = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  // A pre-loop abort may reject before Promise.race attaches; keep it handled.
  void interrupted.catch(() => {});
  const stop = (error: RequestInputError) => {
    if (stopped) return;
    stopped = error;
    rejectStopped(error);
    cancelReader();
  };
  const onAbort = () => stop(new RequestInputError(408, 'request_aborted'));
  request.signal.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => stop(new RequestInputError(408, 'body_timeout')), JSON_BODY_DEADLINE_MS);
  if (request.signal.aborted) onAbort();

  try {
    const reading = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        if (stopped) throw stopped;
        const next = await reader.read();
        if (stopped) throw stopped;
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) throw new RequestInputError(413, 'body_too_large');
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (stopped || request.signal.aborted) throw stopped ?? new RequestInputError(408, 'request_aborted');
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
      catch { throw new RequestInputError(400, 'invalid_json'); }
    })();
    return await Promise.race([reading, interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
    cancelReader();
    inFlightJsonReaders--;
    try { reader.releaseLock(); } catch { /* Pending cancelled reads are already handled by the raced promise. */ }
  }
}

const windows = new Map<string, { since: number; count: number }>();
export function consumeLocalLimit(key: 'practice' | 'verify', now = Date.now()): void {
  const max = key === 'practice' ? 30 : 60;
  let window = windows.get(key);
  if (!window || now - window.since >= 60000 || now < window.since) {
    window = { since: now, count: 0 }; windows.set(key, window);
  }
  if (window.count >= max) throw new RequestInputError(429, 'local_rate_limit');
  window.count++;
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function safeErrorResponse(error: unknown): Response {
  return error instanceof RequestInputError
    ? jsonResponse({ error: error.code }, error.status)
    : jsonResponse({ error: 'request_failed' }, 400);
}
