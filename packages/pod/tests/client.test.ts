import { describe, expect, it, vi, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";
import { createDolphinClient, DolphinClientError, validateDolphinBaseUrl, type DolphinClientOptions, type ModelRequest } from "../src/index.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const dns = vi.mocked(lookup);
const key = "test-only-key-never-log";
const request: ModelRequest = {
  model: "configured-dolphin-model",
  messages: [{ role: "system", content: "Complete only the fixture task." }, { role: "user", content: "Return a test result." }],
  tools: [],
  maxOutputTokens: 64,
};
function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: "fixture-completion", object: "chat.completion", created: 1,
    model: request.model,
    choices: [{ index: 0, message: { role: "assistant", content: "Fixture result" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24, prompt_tokens_details: { cached_tokens: 5 } },
    ...overrides,
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function setup(custom: Partial<DolphinClientOptions> = {}, fetchImplementation?: typeof fetch) {
  const transport = vi.fn(fetchImplementation ?? (async () => response(completion()))) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const client = createDolphinClient({
    apiKey: key, baseUrl: "https://api.dolphin.example/v1", model: request.model,
    limits: { maxOutputTokens: 128, maxTotalOutputTokens: 512, maxCalls: 4 },
    fetch: transport,
    ...custom,
  });
  return { client, transport };
}
beforeEach(() => {
  vi.resetAllMocks();
  dns.mockResolvedValue([{ address: "9.9.9.9", family: 4 }] as never);
});

describe("endpoint boundary", () => {
  it.each([
    "http://api.dolphin.example/v1", "https://localhost/v1", "https://127.1/v1",
    "https://10.0.0.8/v1", "https://192.168.1.1/v1", "https://169.254.169.254/v1",
    "https://100.64.0.1/v1", "https://[::1]/v1", "https://[::ffff:127.0.0.1]/v1",
    "https://[fc00::1]/v1", "https://[2001:db8::1]/v1",
    "https://internal.local/v1", "https://service.internal/v1",
    "https://name:password@api.dolphin.example/v1", "https://api.dolphin.example/v1?secret=value",
    "https://api.dolphin.example/v1#fragment", "https://api.dolphin.example/v1/chat/completions",
  ])("rejects unsafe or ambiguous URL %s", (url) => {
    expect(() => validateDolphinBaseUrl(url)).toThrow(DolphinClientError);
  });

  it("requires explicit local-test mode and limits HTTP exception to loopback", async () => {
    expect(validateDolphinBaseUrl("http://127.0.0.1:1234/v1", true).hostname).toBe("127.0.0.1");
    expect(() => validateDolphinBaseUrl("http://10.0.0.1/v1", true)).toThrow();
    const { client, transport } = setup({ baseUrl: "http://127.0.0.1:1234/v1", allowLocalTestEndpoint: true });
    await client.complete(request);
    expect(transport).toHaveBeenCalledOnce();
    expect(dns).not.toHaveBeenCalled();
  });

  it("rejects a public-looking hostname that resolves privately before sending credentials", async () => {
    dns.mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);
    const { client, transport } = setup();
    await expect(client.complete(request)).rejects.toMatchObject({ code: "ENDPOINT_REJECTED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects mixed public and private DNS answers", async () => {
    dns.mockResolvedValue([{ address: "9.9.9.9", family: 4 }, { address: "::1", family: 6 }] as never);
    const { client, transport } = setup();
    await expect(client.complete(request)).rejects.toMatchObject({ code: "ENDPOINT_REJECTED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("disables redirect following on every transport call", async () => {
    const { client, transport } = setup();
    await client.complete(request);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("accepts a root base URL without constructing a double-slash completion path", async () => {
    const { client, transport } = setup({ baseUrl: "https://api.dolphin.example" });
    await client.complete(request);
    expect(String(transport.mock.calls[0]?.[0])).toBe("https://api.dolphin.example/chat/completions");
  });
});

describe("request and budget boundary", () => {
  it("requires explicit endpoint, key, model and finite budgets", () => {
    expect(() => setup({ apiKey: "" })).toThrowError(/configuration failed/);
    expect(() => setup({ model: "" })).toThrowError(/configuration failed/);
    expect(() => setup({ limits: { maxOutputTokens: Infinity, maxTotalOutputTokens: 100, maxCalls: 1 } })).toThrow();
  });

  it("sends the configured model and output cap through the SDK, without streaming", async () => {
    const { client, transport } = setup();
    const result = await client.complete(request);
    const init = transport.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: request.model, max_completion_tokens: 64, stream: false });
    expect(result).toMatchObject({ model: request.model, message: { content: "Fixture result" }, usage: { inputTokens: 20, outputTokens: 4, cachedInputTokens: 5 }, costEstimateUsd: null });
    expect(result.costEstimateLabel).toMatch(/Unavailable/);
  });

  it.each([
    { ...request, model: "silent-fallback-model" },
    { ...request, maxOutputTokens: 129 },
    { ...request, messages: [{ role: "user", content: "missing system" }] },
    { ...request, tools: [{ name: "bad name", description: "bad", parameters: {} }] },
    { ...request, messages: [{ role: "system", content: 42 }] },
  ])("rejects malformed or unapproved request without transport", async (input) => {
    const { client, transport } = setup();
    await expect(client.complete(input as ModelRequest)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects duplicate tool names and excess aggregate input", async () => {
    const { client, transport } = setup({ limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 1, maxInputCharacters: 40 } });
    await expect(client.complete(request)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(transport).not.toHaveBeenCalled();
    const other = setup();
    const tool = { name: "inspect", description: "Inspect", parameters: { type: "object", properties: {} } };
    await expect(other.client.complete({ ...request, tools: [tool, tool] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(other.transport).not.toHaveBeenCalled();
  });

  it("reserves output tokens and prevents concurrent calls exceeding a finite budget", async () => {
    const { client, transport } = setup({ limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 2 } });
    const results = await Promise.allSettled([client.complete(request), client.complete(request)]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(transport).toHaveBeenCalledOnce();
    expect(client.getBudgetState()).toMatchObject({ outputTokensReserved: 64 });
  });

  it("does not retry a provider error and never exposes raw provider error content or the key", async () => {
    const { client, transport } = setup({}, async () => response({ error: { message: "echo " + key } }, 429));
    let caught: unknown;
    try { await client.complete(request); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "PROVIDER_ERROR", status: 429 });
    expect(String(caught)).not.toContain(key);
    expect(JSON.stringify(caught)).not.toContain(key);
    expect(transport).toHaveBeenCalledOnce();
    expect(client.getBudgetState()).toMatchObject({ outputTokensReserved: 64 });
  });

  it("bounds serialized schemas and request bytes before any transport call", async () => {
    const { client, transport } = setup({ limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 1, maxRequestBytes: 256 } });
    await expect(client.complete({ ...request, tools: [{ name: "inspect", description: "A".repeat(1000), parameters: {} }] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("external completion boundary", () => {
  it.each([
    { choices: [] },
    { choices: [{ message: { role: "assistant", content: 42 }, finish_reason: "stop" }] },
    { usage: { prompt_tokens: -1, completion_tokens: 4 } },
    { usage: { prompt_tokens: 20, completion_tokens: 65 } },
    { usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 25 } },
    { usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 21 } } },
    { choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }] },
  ])("rejects malformed completion or impossible usage", async (overrides) => {
    const { client } = setup({}, async () => response(completion(overrides)));
    await expect(client.complete(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("normalizes tool calls and validates their JSON arguments", async () => {
    const toolRequest = { ...request, tools: [{ name: "inspect", description: "Inspect a local fixture", parameters: { type: "object", properties: {} } }] };
    const { client } = setup({}, async () => response(completion({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: '{"fixture":"local"}' } }] }, finish_reason: "tool_calls" }],
    })));
    const result = await client.complete(toolRequest);
    expect(result.message).toEqual({ content: null, toolCalls: [{ id: "call-1", name: "inspect", arguments: '{"fixture":"local"}' }] });
  });

  it.each(["not-json", "[]", "null"])("rejects malformed tool arguments %s", async (argumentsValue) => {
    const { client } = setup({}, async () => response(completion({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: argumentsValue } }] }, finish_reason: "tool_calls" }],
    })));
    await expect(client.complete({ ...request, tools: [{ name: "inspect", description: "Inspect", parameters: {} }] })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects tool names that were not offered", async () => {
    const { client } = setup({}, async () => response(completion({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "transfer", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    })));
    await expect(client.complete(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("limits received bytes even if a provider ignores the token cap", async () => {
    const { client, transport } = setup({ limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 1, maxResponseBytes: 512 } }, async () => response(completion({ padding: "x".repeat(2000) })));
    await expect(client.complete(request)).rejects.toMatchObject({ code: "RESPONSE_LIMIT" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("limits output characters independently of usage declarations", async () => {
    const { client } = setup({ limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 1, maxResponseCharacters: 5 } });
    await expect(client.complete(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("estimates cost only from an explicitly verified model-matched snapshot", async () => {
    const snapshot = { model: request.model, asOf: "2026-10-28", source: "https://pricing.example/snapshot", status: "verified" as const, inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 2 };
    const { client } = setup({ priceSnapshot: snapshot });
    const result = await client.complete(request);
    expect(result.costEstimateUsd).toBeCloseTo((15 + 0.5 + 8) / 1_000_000);
    expect(result.costEstimateLabel).toContain("not billed cost");
    const unverified = setup({ priceSnapshot: { ...snapshot, status: "unverified" } });
    expect((await unverified.client.complete(request)).costEstimateUsd).toBeNull();
    expect(() => setup({ priceSnapshot: { ...snapshot, model: "another-model" } })).toThrow();
  });
});


describe("transport isolation", () => {
  it("does not inherit SDK debug logs or unrelated OpenAI credentials and custom headers", async () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    vi.stubEnv("OPENAI_ADMIN_KEY", "unrelated-admin-secret");
    vi.stubEnv("OPENAI_ORG_ID", "unrelated-org");
    vi.stubEnv("OPENAI_PROJECT_ID", "unrelated-project");
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", "X-Unrelated-Secret: never-forward-this\nAuthorization: Bearer wrong-provider");
    const spies = ["debug", "info", "log", "warn", "error"].map((name) =>
      vi.spyOn(console, name as "debug").mockImplementation(() => {}));
    try {
      const { client, transport } = setup();
      await client.complete(request);
      const init = transport.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer " + key);
      expect(headers.has("x-unrelated-secret")).toBe(false);
      expect(headers.has("openai-organization")).toBe(false);
      expect(headers.has("openai-project")).toBe(false);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("uses the SDK timeout and does not retry a stalled transport", async () => {
    const stalled: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const { client, transport } = setup({
      limits: { maxOutputTokens: 64, maxTotalOutputTokens: 64, maxCalls: 1, timeoutMs: 10 },
    }, stalled);
    await expect(client.complete(request)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(transport).toHaveBeenCalledOnce();
  });
});
