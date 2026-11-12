import { createHash } from 'node:crypto';
import { z } from 'zod';

export const REPPO_EVALUATIONS_URL = 'https://eval.reppo.xyz/api/v1/agents/evals';
export const REPPO_TEXT_CREDITS = 440;
const INPUT_BYTES = 50_000;
const BODY_BYTES = 64_000;
const RESPONSE_BYTES = 256_000;
const Task = z.enum(['claim', 'response', 'action']);
const Route = z.enum(['ship', 'review', 'block']);
const Score = z.number().finite().min(0).max(100);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Input = z.object({ taskType: Task, input: z.string().min(1).refine((value) => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= INPUT_BYTES) }).strict();
const Result = z.object({ score: Score, route: Route, decision: z.enum(['accept', 'reject']), confidence: z.enum(['low', 'medium', 'high']), reason: z.string(), rubric_scores: z.record(z.string(), Score), consensus: z.unknown(), gates: z.array(z.unknown()), explain: z.object({ confidence_checks: z.array(z.unknown()), route_reasons: z.array(z.string()) }) });
const Envelope = z.object({
  id: Id, taskType: Task, source: z.enum(['WEB', 'API', 'X402']), input: z.string().max(INPUT_BYTES).refine((value) => Buffer.byteLength(value) <= INPUT_BYTES),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']), score: Score.nullable(), route: Route.nullable(),
  creditsCharged: z.number().int().min(0).max(REPPO_TEXT_CREDITS),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime().nullable(),
  attachments: z.array(z.unknown()).length(0), result: Result.nullable(),
}).superRefine((value, context) => {
  const completed = value.status === 'COMPLETED';
  if (completed ? !value.result || value.score !== value.result.score || value.route !== value.result.route || value.creditsCharged !== REPPO_TEXT_CREDITS || value.completedAt === null : value.score !== null || value.route !== null || value.result !== null || value.creditsCharged !== 0) {
    context.addIssue({ code: 'custom', message: 'Inconsistent evaluation state.' });
  }
});
const Authorization = z.object({ maximumCredits: z.literal(REPPO_TEXT_CREDITS), maximumSubmissions: z.literal(1), approvalReference: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/) }).strict();
const Limits = z.object({ maxPolls: z.number().int().min(0).max(30).default(18), maxReads: z.number().int().min(1).max(30).default(30), pollIntervalMs: z.number().int().min(1_000).max(10_000).default(5_000), requestTimeoutMs: z.number().int().min(100).max(30_000).default(15_000), totalTimeoutMs: z.number().int().min(100).max(180_000).default(120_000) }).strict();
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export type ReppoInput = z.infer<typeof Input>;
export type ReppoAuthorization = z.infer<typeof Authorization>;
export type ReppoLimits = z.input<typeof Limits>;
export type ReppoEvidence = {
  kind: 'external_panel_judgment'; deterministicBreachOracle: false; providerAuthenticated: false;
  id: string; taskType: ReppoInput['taskType']; status: z.infer<typeof Envelope>['status'];
  score: number | null; route: z.infer<typeof Route> | null;
  decision: 'accept' | 'reject' | null; confidence: 'low' | 'medium' | 'high' | null;
  providerReportedCreditsCharged: number; verifiedBillingCredits: null;
  responseSha256: string;
};
export type ReppoOutcome = {
  status: 'completed' | 'failed' | 'poll_limit'; evaluation: ReppoEvidence;
  submissions: 1; polls: number; requestSha256: string;
  settlementMayContinue: boolean; automaticRetryAllowed: false;
};
export class ReppoClientError extends Error {
  constructor(readonly code: string, readonly status: number | null = null, readonly evaluationId: string | null = null, readonly submissionMayExist = false) {
    super('Reppo operation stopped. Inspect sanitized metadata; do not automatically resubmit.');
    this.name = 'ReppoClientError';
  }
}
function fail(code: string): never { throw new ReppoClientError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try {
    const result = schema.safeParse(value);
    if (!result.success) fail(code);
    return result.data;
  } catch { fail(code); }
}
/** Inspect data descriptors without evaluating caller accessors or coercing values.
 * Proxy traps can run during inspection; this is not a JavaScript sandbox. */
function descriptors(value: unknown, code: string, maximumKeys: number): PropertyDescriptorMap {
  try {
    if (value === null || typeof value !== 'object') fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const properties = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(properties);
    if (keys.length > maximumKeys || keys.some((key) => typeof key !== 'string' || key.length > 128)) fail(code);
    return properties;
  } catch { fail(code); }
}
function flatSnapshot(value: unknown, code: string): Record<string, string | number | boolean | null> {
  const properties = descriptors(value, code, 16);
  const snapshot: Record<string, string | number | boolean | null> = Object.create(null);
  let bytes = 0;
  for (const [name, descriptor] of Object.entries(properties)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
    const item: unknown = descriptor.value;
    if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') fail(code);
    if (typeof item === 'number' && !Number.isFinite(item)) fail(code);
    if (typeof item === 'string') {
      if (item.length > INPUT_BYTES) fail(code);
      bytes += Buffer.byteLength(item);
    }
    bytes += Buffer.byteLength(name);
    if (bytes > BODY_BYTES) fail(code);
    snapshot[name] = item;
  }
  return snapshot;
}
export function previewReppoEvaluation(value: unknown): { mode: 'preview'; url: string; method: 'POST'; body: string; requestSha256: string; maximumReservedCredits: 440; credentialsRead: false; providerRequests: 0 } {
  const input = parse(Input, flatSnapshot(value, 'invalid_input'), 'invalid_input');
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > BODY_BYTES) fail('request_too_large');
  return { mode: 'preview', url: REPPO_EVALUATIONS_URL, method: 'POST', body, requestSha256: sha(body), maximumReservedCredits: 440, credentialsRead: false, providerRequests: 0 };
}

/** No environment access, persistence, retries, purchases or attachment support. One submission per instance. */
export function createReppoClient(options: { apiKey?: string; executionEnabled?: boolean; fetch?: typeof fetch; limits?: ReppoLimits } = {}) {
  const optionDescriptors = descriptors(options, 'invalid_options', 4);
  for (const [name, descriptor] of Object.entries(optionDescriptors)) {
    if (!['apiKey', 'executionEnabled', 'fetch', 'limits'].includes(name) || descriptor.enumerable !== true || (name !== 'apiKey' && !Object.hasOwn(descriptor, 'value'))) fail('invalid_options');
    if (name === 'apiKey' && !Object.hasOwn(descriptor, 'value') && (typeof descriptor.get !== 'function' || descriptor.set !== undefined)) fail('invalid_options');
  }
  const limitsValue: unknown = optionDescriptors.limits?.value ?? {};
  const limits = parse(Limits, flatSnapshot(limitsValue, 'invalid_limits'), 'invalid_limits');
  const suppliedFetch: unknown = optionDescriptors.fetch?.value;
  if (suppliedFetch !== undefined && typeof suppliedFetch !== 'function') fail('invalid_options');
  const fetcher: typeof fetch = (suppliedFetch as typeof fetch | undefined) ?? globalThis.fetch;
  let credentialValue: string | undefined;
  let credentialLoaded = false;
  const enabledValue: unknown = optionDescriptors.executionEnabled?.value;
  if (enabledValue !== undefined && typeof enabledValue !== 'boolean') fail('invalid_options');
  const enabled = enabledValue === true;
  let used = false;
  let reads = 0;
  function key(): string {
    if (!enabled) fail('execution_disabled');
    if (!credentialLoaded) {
      credentialLoaded = true;
      try {
        const descriptor = optionDescriptors.apiKey;
        const supplied: unknown = descriptor?.get ? descriptor.get.call(options) : descriptor?.value;
        if (typeof supplied !== 'string') fail('invalid_api_key');
        credentialValue = supplied;
      } catch { fail('invalid_api_key'); }
    }
    if (typeof credentialValue !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(credentialValue)) fail('invalid_api_key');
    return credentialValue;
  }
  async function scope<T>(signal: AbortSignal | undefined, timeoutMs: number, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let closed = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) abort();
    let listener: (() => void) | undefined;
    try {
      if (controller.signal.aborted) fail('aborted');
      const stop = new Promise<never>((_, reject) => {
        listener = () => reject(new ReppoClientError(signal?.aborted ? 'aborted' : 'deadline'));
        controller.signal.addEventListener('abort', listener, { once: true });
      });
      const work = action(controller.signal).then((result) => { if (closed || controller.signal.aborted) fail('aborted'); return result; });
      return await Promise.race([work, stop]);
    } finally {
      closed = true; controller.abort(); clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (listener) controller.signal.removeEventListener('abort', listener);
    }
  }
  async function request(method: 'GET' | 'POST', id: string | null, body: string | undefined, signal: AbortSignal, expectedInput?: ReppoInput): Promise<ReppoEvidence> {
    const credential = key();
    if (method === 'GET') { if (reads >= limits.maxReads) fail('read_scope_consumed'); reads += 1; }
    return scope(signal, limits.requestTimeoutMs, async (requestSignal) => {
      if (requestSignal.aborted) fail('aborted');
      const url = id === null ? REPPO_EVALUATIONS_URL : `${REPPO_EVALUATIONS_URL}/${encodeURIComponent(id)}`;
      let response: Response;
      try {
        response = await fetcher(url, { method, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }), signal: requestSignal });
      } catch { throw new ReppoClientError(requestSignal.aborted ? 'aborted' : 'transport_error'); }
      if (requestSignal.aborted) { void response.body?.cancel().catch(() => {}); fail('aborted'); }
      if (response.status !== (method === 'POST' ? 201 : 200) || response.redirected || (response.url !== '' && response.url !== url)) {
        void response.body?.cancel().catch(() => {});
        throw new ReppoClientError('http_error', response.status);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { void response.body?.cancel().catch(() => {}); fail('invalid_content_type'); }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) { void response.body?.cancel().catch(() => {}); fail('response_too_large'); }
      if (!response.body) fail('invalid_response');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      requestSignal.addEventListener('abort', cancel, { once: true });
      const chunks: Uint8Array[] = [];
      let count = 0;
      try {
        while (true) {
          if (requestSignal.aborted) fail('aborted');
          const chunk = await reader.read();
          if (requestSignal.aborted) fail('aborted');
          if (chunk.done) break;
          count += chunk.value.byteLength;
          if (count > RESPONSE_BYTES) fail('response_too_large');
          chunks.push(chunk.value);
        }
      } finally { requestSignal.removeEventListener('abort', cancel); cancel(); }
      if (requestSignal.aborted) fail('aborted');
      const bytes = Buffer.concat(chunks);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_response'); }
      const result = parse(Envelope, value, 'invalid_response');
      if (result.id.includes(credential) || (id !== null && result.id !== id) || result.source !== 'API' || (method === 'POST' && result.status !== 'QUEUED')) fail('invalid_response');
      if (expectedInput && (result.input !== expectedInput.input || result.taskType !== expectedInput.taskType)) fail('invalid_response');
      // Provider prose, input, trace, errors, attachment data and headers never escape this boundary.
      return { kind: 'external_panel_judgment', deterministicBreachOracle: false, providerAuthenticated: false, id: result.id, taskType: result.taskType, status: result.status, score: result.score, route: result.route, decision: result.result?.decision ?? null, confidence: result.result?.confidence ?? null, providerReportedCreditsCharged: result.creditsCharged, verifiedBillingCredits: null, responseSha256: sha(bytes) };
    });
  }
  async function wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) fail('aborted');
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new ReppoClientError('aborted')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, limits.pollIntervalMs);
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
  return {
    preview: previewReppoEvaluation,
    async read(idValue: string, signal?: AbortSignal): Promise<ReppoEvidence> {
      const id = parse(Id, idValue, 'invalid_id'); key();
      if (id.includes(credentialValue!)) fail('invalid_id');
      try { return await request('GET', id, undefined, signal ?? new AbortController().signal); }
      catch (error) { if (error instanceof ReppoClientError) throw error; throw new ReppoClientError('operation_error', null, id); }
    },
    async evaluate(value: unknown, authorizationValue: ReppoAuthorization, signal?: AbortSignal): Promise<ReppoOutcome> {
      const preview = previewReppoEvaluation(value);
      const expectedInput = JSON.parse(preview.body) as ReppoInput;
      parse(Authorization, flatSnapshot(authorizationValue, 'missing_authorization'), 'missing_authorization');
      const credential = key();
      if (expectedInput.input.includes(credential)) fail('credential_in_input');
      if (used) fail('submission_scope_consumed');
      if (signal?.aborted) fail('aborted');
      used = true; // Consume before dispatch; even a lost submit response cannot cause an automatic retry.
      let id: string | null = null;
      try {
        return await scope(signal, limits.totalTimeoutMs, async (stageSignal) => {
          let evaluation = await request('POST', null, preview.body, stageSignal, expectedInput);
          id = evaluation.id;
          let polls = 0;
          while (evaluation.status === 'QUEUED' || evaluation.status === 'PROCESSING') {
            if (polls >= limits.maxPolls) return { status: 'poll_limit', evaluation, submissions: 1, polls, requestSha256: preview.requestSha256, settlementMayContinue: true, automaticRetryAllowed: false };
            await wait(stageSignal);
            polls += 1;
            const previousStatus = evaluation.status;
            evaluation = await request('GET', id, undefined, stageSignal, expectedInput);
            if (previousStatus === 'PROCESSING' && evaluation.status === 'QUEUED') fail('invalid_state_transition');
          }
          return { status: evaluation.status === 'COMPLETED' ? 'completed' : 'failed', evaluation, submissions: 1, polls, requestSha256: preview.requestSha256, settlementMayContinue: false, automaticRetryAllowed: false };
        });
      } catch (error) {
        if (error instanceof ReppoClientError) throw new ReppoClientError(error.code, error.status, id, true);
        throw new ReppoClientError('operation_error', null, id, true);
      }
    },
  };
}
