import { afterEach, describe, it, expect, vi } from 'vitest';
import { readBoundedJson, consumeLocalLimit, RequestInputError, JSON_BODY_DEADLINE_MS, MAX_IN_FLIGHT_JSON_READERS } from '../lib/http';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const req = (body: string, headers: Record<string,string> = {}, url = 'http://127.0.0.1:3000/api/practice') =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
describe('local preview HTTP boundary', () => {
  it('accepts bounded same-origin JSON', async () => {
    await expect(readBoundedJson(req('{"ok":true}', { origin: 'http://127.0.0.1:3000' }), 100)).resolves.toEqual({ ok: true });
  });
  it('rejects cross-origin requests and nonlocal hostnames', async () => {
    await expect(readBoundedJson(req('{}', { origin: 'https://example.com' }), 100)).rejects.toMatchObject({ status: 403 });
    await expect(readBoundedJson(req('{}', { 'sec-fetch-site': 'cross-site' }), 100)).rejects.toMatchObject({ status: 403 });
    await expect(readBoundedJson(req('{}', {}, 'https://example.com/api/practice'), 100)).rejects.toMatchObject({ status: 403 });
  });
  it('matches the real loopback Host when Next normalizes the internal URL', async () => {
    await expect(readBoundedJson(req('{}', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, 'http://localhost:3000/api/practice'), 100)).resolves.toEqual({});
    await expect(readBoundedJson(req('{}', { host: '127.0.0.1:3000', origin: 'http://localhost:3000' }, 'http://localhost:3000/api/practice'), 100)).rejects.toMatchObject({ status: 403 });
    await expect(readBoundedJson(req('{}', { host: 'example.com:3000' }), 100)).rejects.toMatchObject({ status: 403 });
    await expect(readBoundedJson(req('{}', { host: '127.0.0.1:4000' }), 100)).rejects.toMatchObject({ status: 403 });
    await expect(readBoundedJson(req('{}', { origin: 'https://example.com', 'x-forwarded-host': 'example.com' }), 100)).rejects.toMatchObject({ status: 403 });
  });
  it('bounds actual streamed body size even with no Content-Length', async () => {
    await expect(readBoundedJson(req('{"data":"' + 'x'.repeat(101) + '"}'), 100)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedJson(req('{}', { 'content-length': '1000' }), 100)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects invalid JSON and non-JSON content types', async () => {
    await expect(readBoundedJson(req('{'), 100)).rejects.toMatchObject({ status: 400 });
    await expect(readBoundedJson(req('{}', { 'content-type': 'text/plain' }), 100)).rejects.toMatchObject({ status: 415 });
  });
  it('bounds requests and resets after a window', () => {
    const now = 100000;
    for (let i=0;i<30;i++) consumeLocalLimit('practice', now);
    expect(() => consumeLocalLimit('practice', now)).toThrow();
    expect(() => consumeLocalLimit('practice', now+60000)).not.toThrow();
  });
});


function streamingRequest(signal?: AbortSignal, cancel: () => void | PromiseLike<void> = () => {}) {
  const body = new ReadableStream<Uint8Array>({ cancel });
  const request = new Request('http://127.0.0.1:3000/api/practice', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
    duplex: 'half', ...(signal ? { signal } : {}),
  } as RequestInit);
  return request;
}

describe('bounded JSON reader cancellation and capacity', () => {
  it('times out a never-ending stream, cancels it and clears its timer', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => Promise.resolve());
    const pending = readBoundedJson(streamingRequest(undefined, cancel), 100);
    const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'body_timeout' });
    await vi.advanceTimersByTimeAsync(JSON_BODY_DEADLINE_MS);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a pre-aborted request without allocating a reader deadline', async () => {
    vi.useFakeTimers();
    const abort = new AbortController(); abort.abort();
    const cancel = vi.fn(() => Promise.reject(new Error('Cancellation must not leak')));
    await expect(readBoundedJson(streamingRequest(abort.signal, cancel), 100)).rejects.toMatchObject({ status: 408, code: 'request_aborted' });
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors a mid-read abort and handles a rejecting cancellation callback', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new Error('Private cancellation detail')));
    const request = streamingRequest(abort.signal, cancel);
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    const pending = readBoundedJson(request, 100);
    const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'request_aborted' });
    abort.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait on an underlying stream cancellation promise that never resolves', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const pending = readBoundedJson(streamingRequest(undefined, cancel), 100);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'body_timeout' });
    await vi.advanceTimersByTimeAsync(JSON_BODY_DEADLINE_MS);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readBoundedJson(req('{}'), 100)).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps simultaneous readers and releases every slot after aborts', async () => {
    const aborts = Array.from({ length: MAX_IN_FLIGHT_JSON_READERS }, () => new AbortController());
    const pending = aborts.map((abort) => readBoundedJson(streamingRequest(abort.signal), 100).catch((error: unknown) => error));
    await expect(readBoundedJson(req('{}'), 100)).rejects.toMatchObject({ status: 429, code: 'local_reader_limit' });
    for (const abort of aborts) abort.abort();
    const results = await Promise.all(pending);
    expect(results.every((result) => result instanceof RequestInputError && result.code === 'request_aborted')).toBe(true);
    for (let index = 0; index < MAX_IN_FLIGHT_JSON_READERS + 2; index++)
      await expect(readBoundedJson(req('{}'), 100)).resolves.toEqual({});
  });

  it('releases timer, listener and capacity after normal or invalid JSON completion', async () => {
    vi.useFakeTimers();
    const request = req('{"ok":true}');
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    await expect(readBoundedJson(request, 100)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    await expect(readBoundedJson(req('{'), 100)).rejects.toMatchObject({ code: 'invalid_json' });
    for (let index = 0; index < MAX_IN_FLIGHT_JSON_READERS + 2; index++)
      await expect(readBoundedJson(req('{}'), 100)).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
});
