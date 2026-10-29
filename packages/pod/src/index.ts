import OpenAI from "openai";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

export interface ModelToolCall { id: string; name: string; arguments: string }
export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ModelToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };
export interface ModelToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelRequest { model: string; messages: ModelMessage[]; tools: ModelToolDefinition[]; maxOutputTokens: number }
export interface ModelResponse {
  model: string;
  message: { content: string | null; toolCalls?: ModelToolCall[] };
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  costEstimateUsd?: number | null;
  costEstimateLabel?: string;
  finishReason?: string;
}
export interface ModelClient { complete(request: ModelRequest): Promise<ModelResponse> }
export interface PriceSnapshot {
  model: string; asOf: string; source: string; status: "verified" | "unverified";
  inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion?: number;
}
export interface DolphinClientOptions {
  apiKey: string; baseUrl: string; model: string;
  limits: {
    maxOutputTokens: number; maxTotalOutputTokens: number; maxCalls: number;
    maxInputCharacters?: number; maxResponseCharacters?: number;
    maxRequestBytes?: number; maxResponseBytes?: number; timeoutMs?: number;
  };
  priceSnapshot?: PriceSnapshot;
  allowLocalTestEndpoint?: boolean;
  fetch?: typeof globalThis.fetch;
}
export type DolphinErrorCode = "INVALID_CONFIG" | "INVALID_REQUEST" | "ENDPOINT_REJECTED" | "BUDGET_EXCEEDED" |
  "RESPONSE_LIMIT" | "INVALID_RESPONSE" | "PROVIDER_ERROR" | "TIMEOUT" | "NETWORK_ERROR";
export class DolphinClientError extends Error {
  readonly code: DolphinErrorCode;
  readonly status: number | undefined;
  constructor(code: DolphinErrorCode, message: string, status?: number) {
    super(message); this.name = "DolphinClientError"; this.code = code; this.status = status;
  }
}

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const modelName = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const functionName = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const priceRate = z.number().finite().nonnegative().max(1_000_000);
const limitsSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(8192),
  maxTotalOutputTokens: z.number().int().min(1).max(1_000_000),
  maxCalls: z.number().int().min(1).max(10_000),
  maxInputCharacters: z.number().int().min(1).max(131_072).default(32_768),
  maxResponseCharacters: z.number().int().min(1).max(131_072).default(32_768),
  maxRequestBytes: z.number().int().min(256).max(1_048_576).default(131_072),
  maxResponseBytes: z.number().int().min(256).max(1_048_576).default(131_072),
  timeoutMs: z.number().int().min(1).max(120_000).default(30_000),
}).strict();
const priceSchema = z.object({
  model: modelName, asOf: z.iso.date(), source: z.string().url().max(2048),
  status: z.enum(["verified", "unverified"]),
  inputUsdPerMillion: priceRate, outputUsdPerMillion: priceRate,
  cachedInputUsdPerMillion: priceRate.optional(),
}).strict();
const optionsSchema = z.object({
  apiKey: z.string().min(1).max(4096).refine((value) => value.trim() === value && !/\s/.test(value)),
  baseUrl: z.string().min(1).max(2048), model: modelName, limits: limitsSchema,
  priceSnapshot: priceSchema.optional(), allowLocalTestEndpoint: z.boolean().default(false),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function").optional(),
}).strict();

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}
function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const bytes = address.split(".").map(Number);
    const a = bytes[0]!, b = bytes[1]!, c = bytes[2]!;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(":")[0] ?? "", 16);
    const second = Number.parseInt(address.split(":")[1] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8));
  }
  return false;
}
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
/** This validates a configured address; it does not verify a hosted Dolphin service. */
export function validateDolphinBaseUrl(value: string, localTest = false): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin base URL is invalid."); }
  const host = hostOf(url), local = localTest && isLoopback(host);
  if (url.username || url.password || url.search || url.hash || !host)
    throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin base URL must not contain credentials, query parameters, or a fragment.");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin requires HTTPS; explicit local-test mode permits loopback HTTP only.");
  if (!local && (/(^localhost$|\.localhost$|\.local$|\.internal$|\.home$|\.lan$|\.test$|\.invalid$)/.test(host) ||
      (isIP(host) !== 0 && !isPublicAddress(host))))
    throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin endpoint must use a public host.");
  if (/\/chat\/completions\/?$/.test(url.pathname) || /%2f|%5c/i.test(url.pathname))
    throw new DolphinClientError("ENDPOINT_REJECTED", "Configure an API base URL, not a completion endpoint or encoded path separator.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}
async function assertPublicResolution(url: URL, localTest: boolean): Promise<void> {
  const host = hostOf(url);
  if ((localTest && isLoopback(host)) || isIP(host) !== 0) return;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
      throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin hostname resolved to a non-public address.");
  } catch (error) {
    if (error instanceof DolphinClientError) throw error;
    throw new DolphinClientError("NETWORK_ERROR", "Dolphin hostname could not be resolved.");
  }
}
function isBoundedJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((entry) => isBoundedJson(entry, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length <= 256 && entries.every(([key, entry]) => key.length <= 256 && isBoundedJson(entry, depth + 1));
  }
  return false;
}
function parseArguments(value: string): void {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !isBoundedJson(parsed)) throw new Error();
  } catch { throw new DolphinClientError("INVALID_RESPONSE", "Dolphin returned malformed tool arguments."); }
}
function requestSchema(maxCharacters: number) {
  const content = z.string().max(maxCharacters);
  const toolCall = z.object({ id: z.string().min(1).max(128), name: functionName, arguments: z.string().max(maxCharacters) }).strict();
  return z.object({
    model: modelName,
    messages: z.array(z.discriminatedUnion("role", [
      z.object({ role: z.literal("system"), content }).strict(),
      z.object({ role: z.literal("user"), content }).strict(),
      z.object({ role: z.literal("assistant"), content: content.nullable(), toolCalls: z.array(toolCall).max(16).optional() }).strict(),
      z.object({ role: z.literal("tool"), content, toolCallId: z.string().min(1).max(128) }).strict(),
    ])).min(1).max(64),
    tools: z.array(z.object({
      name: functionName, description: z.string().max(4096),
      parameters: z.record(z.string(), z.unknown()).refine((value) => isBoundedJson(value)),
    }).strict()).max(16),
    maxOutputTokens: z.number().int().positive(),
  }).strict();
}
function responseSchema(maxCharacters: number) {
  return z.object({
    model: modelName,
    choices: z.array(z.object({
      message: z.object({
        role: z.literal("assistant"), content: z.string().max(maxCharacters).nullable(),
        tool_calls: z.array(z.object({
          id: z.string().min(1).max(128), type: z.literal("function"),
          function: z.object({ name: functionName, arguments: z.string().max(maxCharacters) }),
        })).max(16).optional(),
      }),
      finish_reason: z.string().min(1).max(64).nullable(),
    })).length(1),
    usage: z.object({
      prompt_tokens: tokenCount, completion_tokens: tokenCount, total_tokens: tokenCount.optional(),
      prompt_tokens_details: z.object({ cached_tokens: tokenCount.optional() }).nullable().optional(),
    }).optional(),
  });
}
async function boundedResponse(response: Response, maxBytes: number): Promise<Response> {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel();
    throw new DolphinClientError("RESPONSE_LIMIT", "Dolphin response exceeded the configured byte limit.");
  }
  if (!response.body) return response;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new DolphinClientError("RESPONSE_LIMIT", "Dolphin response exceeded the configured byte limit.");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const headers = new Headers(response.headers);
  headers.delete("content-length"); headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Bounded pure client for an explicitly configured OpenAI-compatible endpoint.
 * Reservations include failed attempts; they are not billing records.
 * Input is byte/character bounded. The output-token allowance is enforced before dispatch.
 */
export function createDolphinClient(options: DolphinClientOptions): ModelClient & {
  getBudgetState(): { callsReserved: number; outputTokensReserved: number };
} {
  const result = optionsSchema.safeParse(options);
  if (!result.success) throw new DolphinClientError("INVALID_CONFIG", "Dolphin client configuration failed validation.");
  const config = result.data;
  if (config.priceSnapshot && config.priceSnapshot.model !== config.model)
    throw new DolphinClientError("INVALID_CONFIG", "Dolphin price snapshot must match the configured request model.");
  const endpoint = validateDolphinBaseUrl(config.baseUrl, config.allowLocalTestEndpoint);
  const expectedPath = endpoint.pathname.replace(/\/$/, "") + "/chat/completions";
  const transport = config.fetch ?? globalThis.fetch;
  let callsReserved = 0, outputTokensReserved = 0;
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== endpoint.origin || target.pathname !== expectedPath || target.search || target.hash)
      throw new DolphinClientError("ENDPOINT_REJECTED", "Dolphin request target differs from the configured completion endpoint.");
    // Check every dispatch and forbid redirects; application endpoint configuration remains trusted.
    await assertPublicResolution(endpoint, config.allowLocalTestEndpoint);
    const headers = new Headers({ Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", Accept: "application/json" });
    const response = await transport(input, { ...init, headers, redirect: "error" });
    return boundedResponse(response, config.limits.maxResponseBytes);
  };
  const sdk = new OpenAI({
    apiKey: config.apiKey, baseURL: endpoint.href.replace(/\/$/, ""),
    maxRetries: 0, timeout: config.limits.timeoutMs, fetch: guardedFetch, logLevel: "off",
    adminAPIKey: null, organization: null, project: null, webhookSecret: null,
  });
  return {
    getBudgetState: () => ({ callsReserved, outputTokensReserved }),
    async complete(input) {
      const parsed = requestSchema(config.limits.maxInputCharacters).safeParse(input);
      if (!parsed.success) throw new DolphinClientError("INVALID_REQUEST", "Dolphin request failed validation.");
      const request = parsed.data;
      if (request.model !== config.model || request.maxOutputTokens > config.limits.maxOutputTokens)
        throw new DolphinClientError("INVALID_REQUEST", "Dolphin request model or output-token limit differs from its configured allowance.");
      const names = new Set(request.tools.map((tool) => tool.name));
      if (names.size !== request.tools.length || !request.messages.some((message) => message.role === "system"))
        throw new DolphinClientError("INVALID_REQUEST", "Dolphin requires unique tool names and a system message.");
      const inputCharacters = request.messages.reduce((sum, message) => sum + (message.content?.length ?? 0) +
        (message.role === "assistant" ? (message.toolCalls ?? []).reduce((n, call) => n + call.arguments.length, 0) : 0), 0);
      if (inputCharacters > config.limits.maxInputCharacters)
        throw new DolphinClientError("INVALID_REQUEST", "Dolphin request exceeded the configured input-character limit.");
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = request.messages.map((message) => {
        if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
        if (message.role === "assistant") return {
          role: "assistant", content: message.content,
          ...(message.toolCalls ? { tool_calls: message.toolCalls.map((call) => ({
            id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments },
          })) } : {}),
        };
        return { role: message.role, content: message.content };
      });
      const body = {
        model: config.model, messages, max_completion_tokens: request.maxOutputTokens, stream: false as const,
        ...(request.tools.length ? { tools: request.tools.map((tool) => ({ type: "function" as const, function: tool })) } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > config.limits.maxRequestBytes)
        throw new DolphinClientError("INVALID_REQUEST", "Dolphin request exceeded the configured byte limit.");
      if (callsReserved >= config.limits.maxCalls || outputTokensReserved + request.maxOutputTokens > config.limits.maxTotalOutputTokens)
        throw new DolphinClientError("BUDGET_EXCEEDED", "Dolphin call or output-token reservation budget is exhausted.");
      callsReserved += 1; outputTokensReserved += request.maxOutputTokens;
      let raw: unknown;
      try { raw = await sdk.chat.completions.create(body); }
      catch (error) {
        if (error instanceof DolphinClientError) throw error;
        if (error instanceof Error && error.cause instanceof DolphinClientError) throw error.cause;
        if (error instanceof OpenAI.APIConnectionTimeoutError) throw new DolphinClientError("TIMEOUT", "Dolphin request timed out.");
        if (error instanceof OpenAI.APIError) throw new DolphinClientError("PROVIDER_ERROR", "Dolphin provider rejected the request.", error.status);
        throw new DolphinClientError("NETWORK_ERROR", "Dolphin request failed without a scored completion.");
      }
      const validated = responseSchema(config.limits.maxResponseCharacters).safeParse(raw);
      if (!validated.success) throw new DolphinClientError("INVALID_RESPONSE", "Dolphin completion failed response validation.");
      const completion = validated.data, choice = completion.choices[0]!, calls = choice.message.tool_calls ?? [];
      if (calls.some((call) => !names.has(call.function.name)) || new Set(calls.map((call) => call.id)).size !== calls.length)
        throw new DolphinClientError("INVALID_RESPONSE", "Dolphin completion referenced an unknown tool or repeated tool-call ID.");
      for (const call of calls) parseArguments(call.function.arguments);
      const outputCharacters = (choice.message.content?.length ?? 0) + calls.reduce((sum, call) => sum + call.function.arguments.length, 0);
      if (outputCharacters > config.limits.maxResponseCharacters || (!choice.message.content && !calls.length))
        throw new DolphinClientError("INVALID_RESPONSE", "Dolphin completion was empty or exceeded its aggregate output limit.");
      const usage = completion.usage, cached = usage?.prompt_tokens_details?.cached_tokens;
      if (usage && (usage.completion_tokens > request.maxOutputTokens || (cached !== undefined && cached > usage.prompt_tokens) ||
          (usage.total_tokens !== undefined && usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens)))
        throw new DolphinClientError("INVALID_RESPONSE", "Dolphin usage violated the configured output limit or token accounting.");
      const snapshot = config.priceSnapshot;
      let costEstimateUsd: number | null = null;
      let costEstimateLabel = "Unavailable: no verified price snapshot or complete token usage; not billed cost.";
      if (snapshot?.status === "verified" && usage) {
        const cachedTokens = cached ?? 0;
        costEstimateUsd = ((usage.prompt_tokens - cachedTokens) * snapshot.inputUsdPerMillion +
          cachedTokens * (snapshot.cachedInputUsdPerMillion ?? snapshot.inputUsdPerMillion) +
          usage.completion_tokens * snapshot.outputUsdPerMillion) / 1_000_000;
        costEstimateLabel = "Token-price estimate from supplied snapshot " + snapshot.asOf + "; not billed cost.";
      }
      return {
        model: completion.model,
        message: { content: choice.message.content, ...(calls.length ? { toolCalls: calls.map((call) => ({
          id: call.id, name: call.function.name, arguments: call.function.arguments,
        })) } : {}) },
        ...(usage ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
          ...(cached !== undefined ? { cachedInputTokens: cached } : {}) } } : {}),
        costEstimateUsd, costEstimateLabel, ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
      };
    },
  };
}

export * from "./attack-cases.js";
export * from "./generation.js";
