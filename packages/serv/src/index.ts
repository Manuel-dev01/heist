import { createHash } from 'node:crypto';
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { z } from 'zod';

export const SERV_BASE_URL = 'https://inference-api.openserv.ai/v1';
// Exact provider snapshot observed in authorized raw inference on 2026-10-28; no prefix matching.
export const SERV_NANO_SNAPSHOT = 'gpt-5.4-nano-2026-03-17';
function acceptedModel(base: string, requested: string, observed: string): boolean {
  return observed === base || observed === requested || (base === 'gpt-5.4-nano' && observed === SERV_NANO_SNAPSHOT);
}
const JsonObject = z.record(z.string(), z.json());
const ToolCallSchema = z.object({ id: z.string().min(1).max(300), name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), arguments: z.string().max(100_000) }).strict();
const MessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string().min(1).max(100_000) }).strict(),
  z.object({ role: z.literal('user'), content: z.string().max(200_000) }).strict(),
  z.object({ role: z.literal('assistant'), content: z.string().max(200_000).nullable(), toolCalls: z.array(ToolCallSchema).max(20).optional() }).strict(),
  z.object({ role: z.literal('tool'), content: z.string().max(200_000), toolCallId: z.string().min(1).max(300) }).strict(),
]);
const ToolDefinitionSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), description: z.string().max(10_000), parameters: JsonObject }).strict();
const FeaturesSchema = z.object({
  raw: z.boolean().default(false),
  guard: z.boolean().default(false),
  kronos: z.boolean().default(false),
  multipath: z.boolean().default(false),
  shadow: z.object({ hint: z.string().min(1).max(4000), maxIterations: z.number().int().min(1).max(10).default(3) }).strict().optional(),
}).strict().refine((features) => !features.raw || !(features.guard || features.kronos || features.multipath || features.shadow), { message: 'Raw mode cannot combine SERV defenses.' });
const InputSchema = z.object({
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/).refine((model) => !model.includes('-serv-')),
  messages: z.array(MessageSchema).min(2).max(128),
  tools: z.array(ToolDefinitionSchema).max(32).default([]),
  maxOutputTokens: z.number().int().min(1).max(4096).default(256),
}).strict().superRefine((input, ctx) => {
  if (input.messages[0]?.role !== 'system' || input.messages.filter((message) => message.role === 'system').length !== 1) ctx.addIssue({ code: 'custom', message: 'Exactly one leading system message is required.' });
  const names = input.tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length || names.some((name) => name.startsWith('serv_'))) ctx.addIssue({ code: 'custom', message: 'Tool names must be unique; SERV names are reserved.' });
});
const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).nullable().optional(),
}).refine((usage) => usage.prompt_tokens + usage.completion_tokens === usage.total_tokens && (usage.prompt_tokens_details?.cached_tokens ?? 0) <= usage.prompt_tokens);
const CompletionSchema = z.object({
  model: z.string().min(1).max(200),
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']).nullable(),
    message: z.object({
      role: z.literal('assistant'),
      content: z.string().max(200_000).nullable().optional(),
      refusal: z.string().max(10_000).nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string().min(1).max(300), type: z.literal('function'), function: z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), arguments: z.string().max(100_000) }) })).max(20).optional(),
    }),
  })).length(1),
  usage: UsageSchema.optional(),
});
const ErrorShape = z.object({ status: z.number().int().min(100).max(599).optional(), name: z.string().optional(), code: z.unknown().optional(), type: z.unknown().optional(), error: z.unknown().optional() });
const NestedError = z.object({ code: z.unknown().optional(), type: z.unknown().optional() });
const SAFE_CODES = new Set(['unsupported_model', 'model_not_found', 'unsupported_parameter', 'invalid_request_error', 'insufficient_quota', 'insufficient_funds', 'rate_limit_exceeded', 'invalid_api_key', 'prompt_guard_blocked', 'content_filter', 'server_error']);
const SAFE_TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota', 'server_error', 'not_found_error']);

export type ModelToolCall = z.infer<typeof ToolCallSchema>;
export type ModelMessage = { role: 'system' | 'user'; content: string } | { role: 'assistant'; content: string | null; toolCalls?: ModelToolCall[] | undefined } | { role: 'tool'; content: string; toolCallId: string };
export type ModelToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type ServFeatures = z.input<typeof FeaturesSchema>;
export type ModelRequest = { model: string; messages: ModelMessage[]; tools?: ModelToolDefinition[]; maxOutputTokens?: number };
export type ServClientOptions = { apiKey?: string; baseURL?: string; timeoutMs?: number; inferenceEnabled?: boolean; features?: ServFeatures };
export type ServTransport = (body: OpenAI.ChatCompletionCreateParamsNonStreaming, options: { headers: Record<string, string> }) => Promise<unknown>;
export type ModelResponse = {
  model: string;
  message: { content: string | null; toolCalls?: ModelToolCall[] };
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  costEstimateUsd: number | null;
  costEstimateLabel: string;
  finishReason: string;
  metadata: { requestedModel: string; observedModel: string; modelAliasEvidence: string | null; promptSha256: string; latencyMs: number; modelMatchesRequest: boolean; providerCachedInputTokens: number | null; servReasoningPromptCacheHit: null; estimateLabel: string; pricingSource: string; pricingChecked: string };
};
export type ModelClient = { complete(request: ModelRequest): Promise<ModelResponse> };
export type SafeServError = { status: number | null; type: string; code: string };

export class ServClientError extends Error {
  readonly status: number | null;
  readonly type: string;
  readonly code: string;
  constructor(error: SafeServError) {
    super('SERV request could not complete. Inspect the sanitized status, type, and code.');
    this.name = 'ServClientError'; this.status = error.status; this.type = error.type; this.code = error.code;
  }
}
function failure(code: string, type = 'configuration_error', status: number | null = null): ServClientError { return new ServClientError({ status, type, code }); }
export function assertServBaseURL(value = SERV_BASE_URL): string {
  if (value !== SERV_BASE_URL) throw failure('invalid_base_url');
  return value;
}
const SAFE_CONNECTION_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ABORT_ERR', 'ERR_NETWORK', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
function connectionCauseCode(raw: unknown): string {
  const shape = z.object({ code: z.unknown().optional(), cause: z.unknown().optional() });
  let current = raw;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current !== undefined && !seen.has(current); depth += 1) {
    seen.add(current);
    const parsed = shape.safeParse(current);
    if (!parsed.success) break;
    if (typeof parsed.data.code === 'string' && SAFE_CONNECTION_CODES.has(parsed.data.code)) return parsed.data.code;
    current = parsed.data.cause;
  }
  return 'unreported';
}
export function sanitizeServError(raw: unknown): SafeServError {
  // SDK subclasses inherit Error.name === 'Error'; identify the real classes rather than their message.
  if (raw instanceof APIConnectionTimeoutError) return { status: null, type: 'timeout', code: 'request_timeout' };
  if (raw instanceof APIUserAbortError) return { status: null, type: 'connection_error', code: 'request_aborted' };
  if (raw instanceof APIConnectionError) return { status: null, type: 'connection_error', code: connectionCauseCode(raw) };
  if (raw instanceof SyntaxError) return { status: null, type: 'validation_error', code: 'response_parse_error' };
  const error = ErrorShape.safeParse(raw);
  if (!error.success) return { status: null, type: 'provider_error', code: 'unreported' };
  const inner = NestedError.safeParse(error.data.error);
  const type = error.data.type ?? (inner.success ? inner.data.type : undefined);
  const code = error.data.code ?? (inner.success ? inner.data.code : undefined);
  return {
    status: error.data.status ?? null,
    type: typeof type === 'string' && SAFE_TYPES.has(type) ? type : error.data.name === 'APIConnectionTimeoutError' ? 'timeout' : error.data.name === 'APIConnectionError' ? 'connection_error' : 'provider_error',
    code: typeof code === 'string' && SAFE_CODES.has(code) ? code : 'unreported',
  };
}export function composeServModel(baseModel: string, features: ServFeatures = {}): string {
  const model = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/).safeParse(baseModel);
  const parsed = FeaturesSchema.safeParse(features);
  if (!model.success || model.data.includes('-serv-') || !parsed.success) throw failure('invalid_model_or_features');
  return baseModel + (parsed.data.kronos || parsed.data.multipath ? `-serv${parsed.data.kronos ? '-kronos' : ''}${parsed.data.multipath ? '-multipath' : ''}` : '');
}
export function buildServRequest(request: ModelRequest, features: ServFeatures = {}): { body: OpenAI.ChatCompletionCreateParamsNonStreaming; headers: Record<string, string>; systemPrompt: string; baseModel: string } {
  const input = InputSchema.safeParse(request);
  const parsedFeatures = FeaturesSchema.safeParse(features);
  if (!input.success || !parsedFeatures.success) throw failure('invalid_request');
  const settings = parsedFeatures.data;
  const messages: OpenAI.ChatCompletionMessageParam[] = input.data.messages.map((message) => {
    if (message.role === 'assistant') return { role: 'assistant', content: message.content, ...(message.toolCalls ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments } })) } : {}) };
    if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
    return { role: message.role, content: message.content };
  });
  const tools: OpenAI.ChatCompletionTool[] = input.data.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  if (settings.guard) tools.push({ type: 'function', function: { name: 'serv_prompt_guard', parameters: { type: 'object', properties: {} } } });
  if (settings.shadow) tools.push({ type: 'function', function: {
    name: 'serv_shadow_agent', description: 'Enable SERV shadow-agent validation.',
    parameters: { type: 'object', properties: { hint: { type: 'string', default: settings.shadow.hint }, max_iterations: { type: 'integer', default: settings.shadow.maxIterations } } },
  } });
  const systemPrompt = input.data.messages[0]!.content!;
  return {
    body: { model: composeServModel(input.data.model, settings), messages, max_completion_tokens: input.data.maxOutputTokens, stream: false, ...(tools.length ? { tools } : {}) },
    headers: settings.raw ? { 'x-openserv-disable-braid': 'true' } : {},
    systemPrompt,
    baseModel: input.data.model,
  };
}
const TOKEN_PRICES: Readonly<Record<string, readonly [number, number]>> = { 'gpt-5.4-nano': [0.25, 1.60], 'gpt-5.4-mini': [1, 6], 'gpt-5.5': [6.5, 39] };
export function estimateServCost(model: string, inputTokens: number, outputTokens: number): number | null {
  if (!z.number().int().nonnegative().safeParse(inputTokens).success || !z.number().int().nonnegative().safeParse(outputTokens).success) throw failure('invalid_usage', 'validation_error');
  const prices = TOKEN_PRICES[model.replace(/-serv(?:-kronos)?(?:-multipath)?$/, '')];
  return prices ? (inputTokens * prices[0] + outputTokens * prices[1]) / 1_000_000 : null;
}
function redact(value: string, secret: string): string { return secret ? value.split(secret).join('[REDACTED]') : value; }
function redactJson(value: z.infer<typeof JsonObject>, secret: string): z.infer<typeof JsonObject> {
  function visit(item: z.infer<ReturnType<typeof z.json>>): z.infer<ReturnType<typeof z.json>> {
    if (typeof item === 'string') return redact(item, secret);
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [redact(key, secret), visit(child)]));
    return item;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, secret), visit(item)]));
}
function containsCredential(value: unknown, secret: string): boolean {
  if (typeof value === 'string') return value.includes(secret);
  if (Array.isArray(value)) return value.some((item) => containsCredential(item, secret));
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) => key.includes(secret) || containsCredential(item, secret));
  return false;
}
function guardedServFetch(apiKey: string, raw: boolean, onStatus: (status: number) => void): typeof fetch {
  return async (input, init) => {
    const destination = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (destination !== `${SERV_BASE_URL}/chat/completions` || method !== 'POST') throw failure('invalid_destination');
    // Ignore SDK/environment-provided headers. Only this provider's credential and explicit configuration may leave.
    const headers = new Headers({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' });
    if (raw) headers.set('x-openserv-disable-braid', 'true');
    const response = await globalThis.fetch(input, { ...init, headers, redirect: 'error' });
    onStatus(response.status);
    return response;
  };
}
export function createServClient(options: ServClientOptions = {}, injectedTransport?: ServTransport): ModelClient {
  const baseURL = assertServBaseURL(options.baseURL);
  const timeout = z.number().int().min(1000).max(60_000).safeParse(options.timeoutMs ?? 30_000);
  const features = FeaturesSchema.safeParse(options.features ?? {});
  if (!timeout.success || !features.success) throw failure('invalid_configuration');
  const inferenceEnabled = options.inferenceEnabled === true;
  const apiKey = options.apiKey;
  return {
    async complete(request) {
      if (!inferenceEnabled) throw failure('inference_not_authorized');
      const credential = z.string().min(1).max(10_000).safeParse(apiKey);
      if (!credential.success || !credential.data.trim()) throw failure('api_key_required');
      const built = buildServRequest(request, features.data);
      if (containsCredential(built.body, credential.data)) throw failure('credential_in_payload');
      const start = performance.now();
      let raw: unknown;
      let httpStatus: number | null = null;
      try {
        if (injectedTransport) raw = await injectedTransport(built.body, { headers: built.headers });
        else {
          const sdk = new OpenAI({ apiKey: credential.data, adminAPIKey: null, organization: null, project: null, webhookSecret: null, baseURL, timeout: timeout.data, maxRetries: 0, logLevel: 'off', fetch: guardedServFetch(credential.data, features.data.raw, (status) => { httpStatus = status; }) });
          raw = await sdk.chat.completions.create(built.body, { headers: built.headers });
        }
      } catch (error: unknown) { const safe = sanitizeServError(error); throw new ServClientError({ ...safe, status: safe.status ?? httpStatus }); }
      const parsed = CompletionSchema.safeParse(raw);
      if (!parsed.success) throw failure('invalid_response_payload', 'validation_error', httpStatus);
      const response = parsed.data;
      if (!acceptedModel(built.baseModel, built.body.model, response.model)) throw failure('model_mismatch', 'validation_error', httpStatus);
      const choice = response.choices[0]!;
      const calls: ModelToolCall[] = [];
      for (const call of choice.message.tool_calls ?? []) {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { throw failure('invalid_tool_arguments', 'validation_error', httpStatus); }
        const validated = JsonObject.safeParse(args);
        if (!validated.success) throw failure('invalid_tool_arguments', 'validation_error', httpStatus);
        // Tool names are intentionally preserved, including unknown names: the harness owns dispatch and argument policy.
        calls.push({ id: redact(call.id, credential.data), name: redact(call.function.name, credential.data), arguments: JSON.stringify(redactJson(validated.data, credential.data)) });
      }
      const content = choice.message.content ?? choice.message.refusal ?? null;
      if (content === null && calls.length === 0 && choice.finish_reason !== 'content_filter') throw failure('empty_response', 'validation_error', httpStatus);
      const usage = response.usage;
      const baseModel = built.baseModel;
      const observedModel = redact(response.model, credential.data);
      return {
        model: baseModel,
        message: { content: content === null ? null : redact(content, credential.data), ...(calls.length ? { toolCalls: calls } : {}) },
        ...(usage ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, ...(usage.prompt_tokens_details?.cached_tokens !== undefined ? { cachedInputTokens: usage.prompt_tokens_details.cached_tokens } : {}) } } : {}),
        costEstimateUsd: usage ? estimateServCost(baseModel, usage.prompt_tokens, usage.completion_tokens) : null,
        costEstimateLabel: 'Visible token-price estimate only; not billing. Additional SERV reasoning and feature charges unknown; no cache discount assumed.',
        finishReason: choice.finish_reason ?? 'unknown',
        metadata: {
          requestedModel: built.body.model,
          observedModel,
          modelAliasEvidence: observedModel === SERV_NANO_SNAPSHOT ? 'Exact snapshot observed by authorized raw SERV validation on 2026-10-28; other snapshots unverified.' : null,
          promptSha256: createHash('sha256').update(built.systemPrompt).digest('hex'),
          latencyMs: Math.round(performance.now() - start),
          modelMatchesRequest: acceptedModel(baseModel, built.body.model, response.model),
          providerCachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
          servReasoningPromptCacheHit: null,
          estimateLabel: 'Estimate of visible input/output token prices only; not billing or a spending cap. Additional reasoning, guard, audit/repair and Shadow charges are unknown. No cache discount assumed. Reconcile with console billing.',
          pricingSource: 'https://docs.openserv.ai/serv-reasoning/models',
          pricingChecked: '2026-10-28',
        },
      };
    },
  };
}
