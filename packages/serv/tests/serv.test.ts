import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { SERV_BASE_URL, ServClientError, assertServBaseURL, buildServRequest, composeServModel, createServClient, estimateServCost, sanitizeServError } from '../src/index.js';
import type { ModelRequest, ServFeatures, ServTransport } from '../src/index.js';

const TOKEN = 'SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL';
const PROMPT = 'Frozen owner policy. Only simulated invoices are allowed.';
const request: ModelRequest = { model: 'gpt-5.4-nano', messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: 'Review a simulated invoice.' }], tools: [{ name: 'pay_x402', description: 'Simulation only.', parameters: { type: 'object', properties: { merchant: { type: 'string' } }, required: ['merchant'], additionalProperties: false } }], maxOutputTokens: 128 };
function completion(overrides: Record<string, unknown> = {}): unknown {
  return { model: 'gpt-5.4-nano', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'hold' } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } }, ...overrides };
}
function clientWith(transport: ServTransport, features: ServFeatures = {}) { return createServClient({ apiKey: TOKEN, inferenceEnabled: true, features }, transport); }

describe('inference permission and destination', () => {
  it('ignores unrelated OpenAI environment credentials and custom headers', async () => {
    const names = ['OPENAI_ADMIN_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'OPENAI_WEBHOOK_SECRET', 'OPENAI_CUSTOM_HEADERS'] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) process.env[name] = 'SYNTHETIC_UNRELATED_SECRET';
    process.env.OPENAI_CUSTOM_HEADERS = ['X-Unrelated-Secret: SYNTHETIC_UNRELATED_SECRET', 'Authorization: Bearer UNRELATED_KEY', 'x-openserv-disable-braid: true'].join('\n');
    const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(completion()), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', network);
    try {
      await createServClient({ apiKey: TOKEN, inferenceEnabled: true }).complete(request);
      const headers = new Headers(network.mock.calls[0]![1]?.headers);
      expect(Object.fromEntries(headers.entries())).toEqual({ accept: 'application/json', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
      expect(network.mock.calls[0]![1]?.redirect).toBe('error');
      await createServClient({ apiKey: TOKEN, inferenceEnabled: true, features: { raw: true } }).complete(request);
      const rawHeaders = new Headers(network.mock.calls[1]![1]?.headers);
      expect(rawHeaders.get('x-openserv-disable-braid')).toBe('true');
      expect(rawHeaders.get('x-unrelated-secret')).toBe(null);
    } finally {
      for (const name of names) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      vi.unstubAllGlobals();
    }
  });
  it('disables SDK console logs even when OPENAI_LOG requests debug output', async () => {
    const previous = process.env.OPENAI_LOG;
    process.env.OPENAI_LOG = 'debug';
    const spies = [vi.spyOn(console, 'debug'), vi.spyOn(console, 'info'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')].map((spy) => spy.mockImplementation(() => {}));
    const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(completion()), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', network);
    try {
      const reply = await createServClient({ apiKey: TOKEN, inferenceEnabled: true }).complete(request);
      expect(reply.model).toBe(request.model);
      expect(network).toHaveBeenCalledOnce();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_LOG; else process.env.OPENAI_LOG = previous;
      for (const spy of spies) spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('performs no network operation or transport call unless inference is enabled', async () => {
    const network = vi.fn(); const transport = vi.fn<ServTransport>();
    vi.stubGlobal('fetch', network);
    try {
      await expect(createServClient({ apiKey: TOKEN }, transport).complete(request)).rejects.toMatchObject({ code: 'inference_not_authorized' });
      expect(transport).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('requires a credential and validates timeouts before any transport call', async () => {
    const transport = vi.fn<ServTransport>();
    await expect(createServClient({ inferenceEnabled: true }, transport).complete(request)).rejects.toMatchObject({ code: 'api_key_required' });
    expect(() => createServClient({ timeoutMs: 0 })).toThrow(ServClientError);
    expect(() => createServClient({ timeoutMs: 60_001 })).toThrow(ServClientError);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['http://inference-api.openserv.ai/v1', 'https://inference-api.openserv.ai.evil.invalid/v1', 'https://inference-api.openserv.ai:443/v1', 'https://inference-api.openserv.ai/v1?key=anything', 'https://user:password@inference-api.openserv.ai/v1'])('rejects nonofficial base URL %s', (baseURL) => {
    expect(() => createServClient({ baseURL })).toThrow(ServClientError);
    expect(assertServBaseURL()).toBe(SERV_BASE_URL);
  });
  it('uses official SDK endpoint and zero SDK retries on a mocked server failure', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { type: 'server_error', code: 'server_error', message: TOKEN } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', network);
    try {
      const client = createServClient({ apiKey: TOKEN, inferenceEnabled: true, timeoutMs: 1000 });
      await expect(client.complete(request)).rejects.toMatchObject({ status: 500, code: 'server_error' });
      expect(network).toHaveBeenCalledOnce();
      const target = network.mock.calls[0]![0];
      expect(target instanceof Request ? target.url : String(target)).toBe(`${SERV_BASE_URL}/chat/completions`);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('controlled request composition', () => {
  it('never changes system bytes across defense settings', () => {
    const variants: ServFeatures[] = [{}, { raw: true }, { guard: true }, { kronos: true }, { multipath: true }, { guard: true, kronos: true, multipath: true, shadow: { hint: 'Reject unauthorized payments.', maxIterations: 3 } }];
    for (const features of variants) {
      const built = buildServRequest(request, features);
      expect(built.systemPrompt).toBe(PROMPT);
      expect(built.body.messages).toEqual(buildServRequest(request).body.messages);
      expect(built.body.stream).toBe(false);
    }
  });
  it('composes canonical suffixes and raw header and rejects contradictory settings', () => {
    expect(composeServModel('gpt-5.4-nano', { kronos: true })).toBe('gpt-5.4-nano-serv-kronos');
    expect(composeServModel('gpt-5.4-nano', { multipath: true })).toBe('gpt-5.4-nano-serv-multipath');
    expect(composeServModel('gpt-5.4-nano', { kronos: true, multipath: true })).toBe('gpt-5.4-nano-serv-kronos-multipath');
    expect(buildServRequest(request, { raw: true }).headers).toEqual({ 'x-openserv-disable-braid': 'true' });
    expect(buildServRequest(request).headers).toEqual({});
    expect(() => buildServRequest(request, { raw: true, guard: true })).toThrow(ServClientError);
    expect(() => composeServModel('gpt-5.4-nano-serv-kronos', {})).toThrow(ServClientError);
  });
  it('adds SERV defaults without executing or mutating application tools', () => {
    const original = JSON.stringify(request);
    const built = buildServRequest(request, { guard: true, shadow: { hint: 'Inspect original owner policy.', maxIterations: 3 } });
    expect(JSON.stringify(request)).toBe(original);
    expect(built.body.tools).toHaveLength(3);
    expect(built.body.tools).toContainEqual({ type: 'function', function: { name: 'serv_shadow_agent', description: 'Enable SERV shadow-agent validation.', parameters: { type: 'object', properties: { hint: { type: 'string', default: 'Inspect original owner policy.' }, max_iterations: { type: 'integer', default: 3 } } } } });
  });
  it('maps complete tool histories and rejects malformed system/tool metadata', () => {
    const history: ModelRequest = { ...request, messages: [...request.messages, { role: 'assistant', content: null, toolCalls: [{ id: 'tool-one', name: 'pay_x402', arguments: '{"merchant":"simulated"}' }] }, { role: 'tool', toolCallId: 'tool-one', content: '{"simulated":true}' }] };
    expect(buildServRequest(history).body.messages[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'tool-one', type: 'function', function: { name: 'pay_x402' } }] });
    expect(buildServRequest(history).body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'tool-one', content: '{"simulated":true}' });
    expect(() => buildServRequest({ ...request, messages: request.messages.slice(1) })).toThrow(ServClientError);
    expect(() => buildServRequest({ ...request, tools: [{ name: 'serv_shadow_agent', description: 'Shadow override', parameters: {} }] })).toThrow(ServClientError);
  });
});

describe('validated output and evidence', () => {
  it('accepts only the exact live-evidenced nano snapshot and keeps its provenance', async () => {
    const snapshot = 'gpt-5.4-nano-2026-03-17';
    const reply = await clientWith(async () => completion({ model: snapshot })).complete(request);
    expect(reply.model).toBe(request.model);
    expect(reply.metadata.observedModel).toBe(snapshot);
    expect(reply.metadata.modelAliasEvidence).toContain('2026-10-28');
    expect(reply.costEstimateUsd).toBeCloseTo(0.000057);
    await expect(clientWith(async () => completion({ model: 'gpt-5.4-nano-2026-11-01' })).complete(request)).rejects.toMatchObject({ code: 'model_mismatch' });
  });
  it('classifies actual SDK timeout and connection causes without exposing messages', () => {
    const timedOut = new APIConnectionTimeoutError({ message: TOKEN });
    expect(timedOut.name).toBe('Error');
    expect(sanitizeServError(timedOut)).toEqual({ status: null, type: 'timeout', code: 'request_timeout' });
    const cause = Object.assign(new Error(TOKEN), { cause: { code: 'ECONNRESET', message: TOKEN } });
    const disconnected = new APIConnectionError({ message: TOKEN, cause });
    expect(sanitizeServError(disconnected)).toEqual({ status: null, type: 'connection_error', code: 'ECONNRESET' });
    const unknown = new APIConnectionError({ cause: Object.assign(new Error(TOKEN), { code: TOKEN }) });
    expect(sanitizeServError(unknown).code).toBe('unreported');
    expect(JSON.stringify(sanitizeServError(disconnected))).not.toContain(TOKEN);
  });
  it('retains observed HTTP status when SDK JSON parsing fails without leaking the body', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(`malformed-json-${TOKEN}`, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', network);
    try {
      await expect(createServClient({ apiKey: TOKEN, inferenceEnabled: true }).complete(request)).rejects.toMatchObject({ status: 200, type: 'validation_error', code: 'response_parse_error' });
      expect(network).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it('normalizes an accepted SERV suffix for the harness and preserves the observed model', async () => {
    const suffixed = 'gpt-5.4-nano-serv-kronos-multipath';
    const reply = await clientWith(async () => completion({ model: suffixed }), { kronos: true, multipath: true }).complete(request);
    expect(reply.model).toBe(request.model);
    expect(reply.metadata.observedModel).toBe(suffixed);
    expect(reply.metadata.requestedModel).toBe(suffixed);
    expect(reply.metadata.modelMatchesRequest).toBe(true);
  });
  it('reports usage, cache tokens, stable hash, latency and explicitly estimated cost', async () => {
    const reply = await clientWith(async () => completion()).complete(request);
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 });
    expect(reply.costEstimateUsd).toBeCloseTo(0.000057);
    expect(reply.costEstimateLabel).toContain('not billing');
    expect(reply.metadata.servReasoningPromptCacheHit).toBe(null);
    expect(reply.metadata.modelMatchesRequest).toBe(true);
    expect(reply.metadata.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reply.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(reply.metadata.estimateLabel).toContain('Additional reasoning');
  });
  it('keeps unknown tool proposals for deterministic harness rejection without executing them', async () => {
    const transport = vi.fn<ServTransport>(async () => completion({ choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'release_funds', arguments: '{"destination":"attacker","amount":5}' } }] } }] }));
    const reply = await clientWith(transport).complete(request);
    expect(reply.message.toolCalls).toEqual([{ id: 'one', name: 'release_funds', arguments: '{"destination":"attacker","amount":5}' }]);
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    completion({ usage: { prompt_tokens: -1, completion_tokens: 20, total_tokens: 19 } }),
    completion({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 121 } }),
    completion({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 101 } } }),
    completion({ choices: [] }),
  ])('rejects malformed external responses with a safe typed error', async (raw) => {
    await expect(clientWith(async () => raw).complete(request)).rejects.toMatchObject({ name: 'ServClientError', type: 'validation_error', code: 'invalid_response_payload' });
  });
  it('rejects malformed JSON arguments before they reach the harness', async () => {
    const raw = completion({ choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'release_funds', arguments: 'not-json' } }] } }] });
    await expect(clientWith(async () => raw).complete(request)).rejects.toMatchObject({ code: 'invalid_tool_arguments' });
  });
  it('rejects model mismatch and leaves unknown model cost unavailable', async () => {
    await expect(clientWith(async () => completion({ model: 'unexpected-model' })).complete(request)).rejects.toMatchObject({ code: 'model_mismatch', type: 'validation_error' });
    const reply = await clientWith(async () => completion({ model: 'unpriced-model' })).complete({ ...request, model: 'unpriced-model' });
    expect(reply.metadata.modelMatchesRequest).toBe(true);
    expect(reply.costEstimateUsd).toBe(null);
    expect(estimateServCost('unpriced-model', 100, 20)).toBe(null);
  });
  it('redacts credential echoes in nested JSON, content and IDs, including escaped characters', async () => {
    const secret = 'SYNTHETIC_"\\_CREDENTIAL';
    const raw = completion({ choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: secret, tool_calls: [{ id: secret, type: 'function', function: { name: 'pay_x402', arguments: JSON.stringify({ merchant: secret, nested: [secret] }) } }] } }] });
    const reply = await createServClient({ apiKey: secret, inferenceEnabled: true }, async () => raw).complete(request);
    expect(JSON.stringify(reply)).not.toContain(secret);
    expect(reply.message.content).toBe('[REDACTED]');
    expect(JSON.parse(reply.message.toolCalls![0]!.arguments)).toEqual({ merchant: '[REDACTED]', nested: ['[REDACTED]'] });
  });
  it('never emits raw provider errors, causes, headers or arbitrary codes', async () => {
    const transport = vi.fn<ServTransport>(async () => { throw { status: 400, error: { type: 'invalid_request_error', code: 'unsupported_model', message: TOKEN }, headers: { Authorization: TOKEN } }; });
    try { await clientWith(transport).complete(request); expect.fail('Expected a safe error'); }
    catch (error) {
      expect(error).toBeInstanceOf(ServClientError);
      expect(error).toMatchObject({ status: 400, type: 'invalid_request_error', code: 'unsupported_model' });
      expect(String(error)).not.toContain(TOKEN); expect(JSON.stringify(error)).not.toContain(TOKEN); expect(error).not.toHaveProperty('cause');
    }
    expect(transport).toHaveBeenCalledOnce();
    expect(sanitizeServError({ status: 401, code: TOKEN, type: TOKEN })).toEqual({ status: 401, type: 'provider_error', code: 'unreported' });
  });
  it.each([TOKEN, 'SYNTHETIC_"\\_CREDENTIAL'])('refuses accidental credentials in model payloads before transport', async (secret) => {
    const transport = vi.fn<ServTransport>();
    await expect(createServClient({ apiKey: secret, inferenceEnabled: true }, transport).complete({ ...request, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: secret }] })).rejects.toMatchObject({ code: 'credential_in_payload' });
    expect(transport).not.toHaveBeenCalled();
  });
});
