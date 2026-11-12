import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReppoClient, previewReppoEvaluation, REPPO_EVALUATIONS_URL, ReppoClientError } from '../src/index.js';

const key = 'synthetic-test-key-ONLY';
const input = { taskType: 'action' as const, input: 'Owned synthetic fixture: user authorizes 5 units to Alice. Agent proposes 50 units to Mallory.' };
const authorization = { maximumCredits: 440 as const, maximumSubmissions: 1 as const, approvalReference: 'offline-fixture-not-human-approval' };
function envelope(status = 'QUEUED', overrides: Record<string, unknown> = {}) {
  return { id: 'eval_test-1', taskType: 'action', source: 'API', input: input.input, status, score: status === 'COMPLETED' ? 82 : null, route: status === 'COMPLETED' ? 'review' : null, creditsCharged: status === 'COMPLETED' ? 440 : 0, createdAt: '2026-11-12T00:00:00.000Z', startedAt: null, completedAt: status === 'COMPLETED' ? '2026-11-12T00:01:00.000Z' : null, attachments: [], result: status === 'COMPLETED' ? { score: 82, route: 'review', decision: 'accept', confidence: 'medium', reason: `private provider prose ${key}`, rubric_scores: { accuracy: 80 }, consensus: { secret: key }, gates: [], explain: { confidence_checks: [], route_reasons: [key] } } : null, trace: { secret: key }, error: null, ...overrides };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(steps: (() => Promise<Response> | Response)[]) {
  return vi.fn<typeof fetch>(async () => {
    const step = steps.shift();
    if (!step) throw new Error('Unexpected fake request');
    return step();
  });
}
function client(fetch: typeof globalThis.fetch, limits = {}) { return createReppoClient({ executionEnabled: true, apiKey: key, fetch, limits: { pollIntervalMs: 1_000, ...limits } }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('text evaluation preview and authorization', () => {
  it('rejects an input accessor without invoking it or exposing its private exception', () => {
    const getter = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); });
    let caught: unknown;
    try { previewReppoEvaluation({ taskType: 'action', get input(): string { return getter(); } }); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'invalid_input' }); expect(String(caught)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT'); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects an authorization accessor before credential read or dispatch', async () => {
    const getter = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); }); const fetch = mockFetch([]);
    const suppliedKey = vi.fn(() => key);
    const instance = createReppoClient({ executionEnabled: true, fetch, get apiKey(): string { return suppliedKey(); } });
    const outcome = await instance.evaluate(input, { maximumCredits: 440, maximumSubmissions: 1, get approvalReference(): string { return getter(); } }).catch((error: unknown) => error);
    expect(outcome).toMatchObject({ code: 'missing_authorization' }); expect(String(outcome)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT'); expect(getter).not.toHaveBeenCalled(); expect(suppliedKey).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['evaluate', 'read'] as const)('sanitizes a throwing runtime key getter for %s', async (method) => {
    const getter = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); }); const fetch = mockFetch([]);
    const instance = createReppoClient({ executionEnabled: true, fetch, get apiKey(): string { return getter(); } });
    instance.preview(input); expect(getter).not.toHaveBeenCalled();
    const outcome = await (method === 'evaluate' ? instance.evaluate(input, authorization) : instance.read('eval_test-1')).catch((error: unknown) => error);
    expect(outcome).toMatchObject({ code: 'invalid_api_key', submissionMayExist: false }); expect(outcome).toBeInstanceOf(ReppoClientError);
    expect(String(outcome)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT'); expect(JSON.stringify(outcome)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT'); expect(fetch).not.toHaveBeenCalled(); expect(getter).toHaveBeenCalledOnce();
    await expect(instance.read('eval_test-1')).rejects.toMatchObject({ code: 'invalid_api_key' }); expect(getter).toHaveBeenCalledOnce();
  });
  it('rejects nonprimitive credentials without invoking coercion', async () => {
    const coercion = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); }); const fetch = mockFetch([]);
    const instance = createReppoClient({ executionEnabled: true, fetch, apiKey: { toString: coercion } as unknown as string });
    await expect(instance.evaluate(input, authorization)).rejects.toMatchObject({ code: 'invalid_api_key' }); expect(coercion).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    new Date(), Object.assign(Object.create({ inherited: true }), input), { ...input, [Symbol('private')]: true },
    { ...input, extra: { get secret() { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); } } },
    Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`key${index}`, 'x'])),
  ])('rejects nonflat, nonplain, symbolic or excessive caller input %#', (value) => {
    expect(() => previewReppoEvaluation(value)).toThrow(ReppoClientError);
  });
  it('catches proxy inspection traps without claiming to prevent their execution', () => {
    const trap = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); });
    const value = new Proxy({}, { ownKeys: trap });
    let caught: unknown; try { previewReppoEvaluation(value); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'invalid_input' }); expect(String(caught)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT'); expect(trap).toHaveBeenCalledOnce();
  });
  it('rejects limits accessors without invocation and sanitizes option inspection traps', () => {
    const getter = vi.fn(() => { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); });
    expect(() => createReppoClient({ limits: { get maxPolls(): number { return getter(); } } })).toThrow(ReppoClientError);
    expect(getter).not.toHaveBeenCalled();
    expect(() => createReppoClient({ get limits(): never { return getter(); } })).toThrow(ReppoClientError);
    expect(getter).not.toHaveBeenCalled();
    let caught: unknown; try { createReppoClient(new Proxy({}, { getPrototypeOf() { throw new Error('DUMMY_PRIVATE_EXCEPTION_TEXT'); } })); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'invalid_options' }); expect(String(caught)).not.toContain('DUMMY_PRIVATE_EXCEPTION_TEXT');
  });
  it('previews exact current payload without key access or fetch', async () => {
    const fetch = mockFetch([]);
    const unusedKey = vi.fn(() => { throw new Error('No key read'); });
    const draft = createReppoClient({ fetch, get apiKey(): string { return unusedKey(); } });
    const preview = draft.preview(input);
    expect(preview).toMatchObject({ mode: 'preview', url: REPPO_EVALUATIONS_URL, providerRequests: 0, credentialsRead: false, maximumReservedCredits: 440 });
    expect(JSON.parse(preview.body)).toEqual(input);
    expect(preview.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetch).not.toHaveBeenCalled(); expect(unusedKey).not.toHaveBeenCalled();
    await expect(draft.evaluate(input, authorization)).rejects.toMatchObject({ code: 'execution_disabled' });
    expect(unusedKey).not.toHaveBeenCalled();
  });
  it.each([
    { taskType: 'old_type', input: 'x' }, { taskType: 'claim', input: '' }, { taskType: 'claim', input: ' ' },
    { ...input, attachments: [] }, { ...input, Sandbox: true }, { ...input, criteria: 'old API' },
    { ...input, input: 'é'.repeat(25_001) }, { ...input, input: '\u0000'.repeat(12_000) },
  ])('rejects invalid or unsupported input without dispatch %#', (value) => {
    expect(() => previewReppoEvaluation(value)).toThrow(ReppoClientError);
  });
  it('accepts exactly 50,000 UTF8 input bytes within body bound', () => {
    expect(previewReppoEvaluation({ ...input, input: 'é'.repeat(25_000) }).mode).toBe('preview');
  });
  it.each([undefined, {}, { ...authorization, maximumCredits: 439 }, { ...authorization, maximumSubmissions: 2 }, { ...authorization, approvalReference: '' }])('requires exact caller authorization %#', async (authority) => {
    const fetch = mockFetch([]);
    await expect(client(fetch).evaluate(input, authority as never)).rejects.toMatchObject({ code: 'missing_authorization' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['x', 'bad\nheader', 'bad key value'])('rejects malformed injected credential', async (apiKey) => {
    const fetch = mockFetch([]);
    await expect(createReppoClient({ apiKey, executionEnabled: true, fetch }).evaluate(input, authorization)).rejects.toMatchObject({ code: 'invalid_api_key' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enforces max configuration bounds', () => {
    expect(() => createReppoClient({ limits: { maxPolls: 31 } })).toThrow(ReppoClientError);
    expect(() => createReppoClient({ limits: { requestTimeoutMs: 30_001 } })).toThrow(ReppoClientError);
    expect(() => createReppoClient({ limits: { totalTimeoutMs: 180_001 } })).toThrow(ReppoClientError);
  });
  it('does not read injected credential even for an enabled client until execution', () => {
    const credentialGetter = vi.fn(() => key);
    const instance = createReppoClient({ executionEnabled: true, get apiKey(): string { return credentialGetter(); }, fetch: mockFetch([]) });
    instance.preview(input); expect(credentialGetter).not.toHaveBeenCalled();
  });
  it('refuses accidental credential inclusion in submitted content before dispatch', async () => {
    const fetch = mockFetch([]);
    await expect(client(fetch).evaluate({ ...input, input: key }, authorization)).rejects.toMatchObject({ code: 'credential_in_input' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('current API evaluation lifecycle with fake transport only', () => {
  it('submits once, polls queued/processing/completed and exposes only safe normalized metadata', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([() => response(envelope(), 201), () => response(envelope('PROCESSING')), () => response(envelope('COMPLETED'))]);
    const pending = client(fetch).evaluate(input, authorization);
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: 'completed', submissions: 1, polls: 2, settlementMayContinue: false, automaticRetryAllowed: false, evaluation: { kind: 'external_panel_judgment', deterministicBreachOracle: false, providerAuthenticated: false, score: 82, route: 'review', decision: 'accept', confidence: 'medium', providerReportedCreditsCharged: 440, verifiedBillingCredits: null } });
    expect(JSON.stringify(outcome)).not.toContain(key);
    expect(JSON.stringify(outcome)).not.toContain(input.input);
    expect(JSON.stringify(outcome)).not.toContain('reason');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe(REPPO_EVALUATIONS_URL);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(input), redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
    expect(Object.keys(fetch.mock.calls[0]?.[1]?.headers ?? {}).sort()).toEqual(['Accept', 'Authorization', 'Content-Type']);
    expect(fetch.mock.calls[1]?.[0]).toBe(`${REPPO_EVALUATIONS_URL}/eval_test-1`);
    expect(fetch.mock.calls[1]?.[1]).not.toHaveProperty('body');
  });
  it('reports FAILED uncharged according to provider, without auto-resubmit', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([() => response(envelope(), 201), () => response(envelope('FAILED', { error: key }))]);
    const instance = client(fetch);
    const pending = instance.evaluate(input, authorization); await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'failed', polls: 1, evaluation: { providerReportedCreditsCharged: 0, verifiedBillingCredits: null } });
    await expect(instance.evaluate(input, authorization)).rejects.toMatchObject({ code: 'submission_scope_consumed' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops at poll cap while settlement can continue', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([() => response(envelope(), 201), () => response(envelope('PROCESSING'))]);
    const pending = client(fetch, { maxPolls: 1 }).evaluate(input, authorization); await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'poll_limit', polls: 1, settlementMayContinue: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops on status regression without another poll', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([() => response(envelope(), 201), () => response(envelope('PROCESSING')), () => response(envelope())]);
    const pending = client(fetch).evaluate(input, authorization).catch((value: unknown) => value);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: 'invalid_state_transition', evaluationId: 'eval_test-1', submissionMayExist: true }); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([400, 401, 402, 404, 500, 502])('sanitizes HTTP %s and consumes submission scope', async (status) => {
    const fetch = mockFetch([() => response({ error: key }, status)]); const instance = client(fetch);
    const error = await instance.evaluate(input, authorization).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'http_error', status, submissionMayExist: true });
    expect(String(error)).not.toContain(key); expect(JSON.stringify(error)).not.toContain(key);
    await expect(instance.evaluate(input, authorization)).rejects.toMatchObject({ code: 'submission_scope_consumed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry or expose transport exception text', async () => {
    const fetch = mockFetch([() => { throw new Error(`provider echoed ${key}`); }]);
    const error = await client(fetch).evaluate(input, authorization).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'transport_error', evaluationId: null, submissionMayExist: true });
    expect(JSON.stringify(error)).not.toContain(key); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('consumes the submission scope atomically across parallel calls', async () => {
    const fetch = mockFetch([() => response(envelope(), 201)]); const instance = client(fetch, { maxPolls: 0 });
    const first = instance.evaluate(input, authorization);
    await expect(instance.evaluate(input, authorization)).rejects.toMatchObject({ code: 'submission_scope_consumed' });
    expect(await first).toMatchObject({ status: 'poll_limit' }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects a redirected response even when injected transport ignores redirect:error', async () => {
    const redirected = response(envelope(), 201);
    Object.defineProperty(redirected, 'redirected', { value: true });
    const fetch = mockFetch([() => redirected]);
    await expect(client(fetch).evaluate(input, authorization)).rejects.toMatchObject({ code: 'http_error' });
  });
  it('rejects response URL mismatch', async () => {
    const other = response(envelope(), 201); Object.defineProperty(other, 'url', { value: 'https://attacker.invalid' });
    await expect(client(mockFetch([() => other])).evaluate(input, authorization)).rejects.toMatchObject({ code: 'http_error' });
  });
  it('enforces per-instance GET cap including recovery reads', async () => {
    const fetch = mockFetch([() => response(envelope())]); const instance = client(fetch, { maxReads: 1 });
    await instance.read('eval_test-1');
    await expect(instance.read('eval_test-1')).rejects.toMatchObject({ code: 'read_scope_consumed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['../evil', 'a/b', 'a?x=1', '%2F', '\\server', key])('rejects unsafe ID before GET %s', async (id) => {
    const fetch = mockFetch([]); await expect(client(fetch).read(id)).rejects.toMatchObject({ code: 'invalid_id' }); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('response validation and bounds', () => {
  it.each([
    { id: '../a' }, { id: key }, { taskType: 'claim' }, { input: 'Unrelated fixture' }, { source: 'X402' }, { status: 'DONE' },
    { score: 90 }, { creditsCharged: 440 }, { attachments: [{}] }, { createdAt: 'bad date' },
  ])('rejects malformed/mismatched submit envelope %#', async (overrides) => {
    await expect(client(mockFetch([() => response(envelope('QUEUED', overrides), 201)]), { maxPolls: 0 }).evaluate(input, authorization)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each([
    { score: 101 }, { score: -1 }, { route: 'accept' }, { creditsCharged: 0 }, { completedAt: null },
    { result: { score: 82, route: 'review', decision: 'accept', confidence: 'medium', reason: 'x', rubric_scores: { score: 101 }, consensus: {}, gates: [], explain: { confidence_checks: [], route_reasons: [] } } },
  ])('rejects invalid completed envelope %#', async (overrides) => {
    await expect(client(mockFetch([() => response(envelope('COMPLETED', overrides))])).read('eval_test-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects mismatched read identity', async () => {
    await expect(client(mockFetch([() => response(envelope('QUEUED', { id: 'other' }))])).read('eval_test-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each([
    () => new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    () => new Response('{"unfinished"', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ])('rejects invalid response encoding/type %#', async (makeResponse) => {
    await expect(client(mockFetch([makeResponse])).read('eval_test-1')).rejects.toBeInstanceOf(ReppoClientError);
  });
  it('cancels oversized declared body before read', async () => {
    const cancel = vi.fn(); const body = new ReadableStream({ cancel });
    const fetch = mockFetch([() => new Response(body, { headers: { 'content-type': 'application/json', 'content-length': '256001' } })]);
    await expect(client(fetch).read('eval_test-1')).rejects.toMatchObject({ code: 'response_too_large' }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('caps streamed bytes even without content-length', async () => {
    const cancel = vi.fn(); const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256_001)); }, cancel });
    await expect(client(mockFetch([() => new Response(body, { headers: { 'content-type': 'application/json' } })])).read('eval_test-1')).rejects.toMatchObject({ code: 'response_too_large' }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('sanitizes body-reader exceptions for standalone read', async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error(key)); } });
    const error = await client(mockFetch([() => new Response(body, { headers: { 'content-type': 'application/json' } })])).read('eval_test-1').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'operation_error' }); expect(JSON.stringify(error)).not.toContain(key);
  });
});

describe('abort, deadlines and late completion', () => {
  it('does not dispatch after pre-abort', async () => {
    const abort = new AbortController(); abort.abort(); const fetch = mockFetch([]);
    await expect(client(fetch).evaluate(input, authorization, abort.signal)).rejects.toMatchObject({ code: 'aborted' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds a fetch that ignores abort and suppresses its late completion', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const fetch = mockFetch([() => new Promise<Response>((done) => { resolve = done; })]);
    const instance = client(fetch, { requestTimeoutMs: 100 });
    const pending = instance.evaluate(input, authorization).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ submissionMayExist: true, evaluationId: null });
    const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(1); expect(cancel).toHaveBeenCalledOnce();
    await expect(instance.evaluate(input, authorization)).rejects.toMatchObject({ code: 'submission_scope_consumed' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels stalled response body at request deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const fetch = mockFetch([() => new Response(new ReadableStream({ cancel }), { status: 201, headers: { 'content-type': 'application/json' } })]);
    const pending = client(fetch, { requestTimeoutMs: 100 }).evaluate(input, authorization).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(101); expect(await pending).toBeInstanceOf(ReppoClientError); expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('stops polling on caller abort and retains known evaluation id', async () => {
    vi.useFakeTimers(); const abort = new AbortController(); const fetch = mockFetch([() => response(envelope(), 201)]);
    const pending = client(fetch).evaluate(input, authorization, abort.signal).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(1); abort.abort(); await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ code: 'aborted', evaluationId: 'eval_test-1', submissionMayExist: true }); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('never publishes or continues polling after a late GET resolves beyond total deadline', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const fetch = mockFetch([() => response(envelope(), 201), () => new Promise<Response>((done) => { resolve = done; })]);
    const pending = client(fetch, { totalTimeoutMs: 1_100 }).evaluate(input, authorization).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(1_101);
    expect(await pending).toMatchObject({ code: 'deadline', evaluationId: 'eval_test-1', submissionMayExist: true });
    resolve(response(envelope('COMPLETED'))); await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds total stage including poll delays', async () => {
    vi.useFakeTimers(); const fetch = mockFetch([() => response(envelope(), 201)]);
    const pending = client(fetch, { totalTimeoutMs: 100 }).evaluate(input, authorization).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ code: 'deadline', evaluationId: 'eval_test-1', submissionMayExist: true }); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
