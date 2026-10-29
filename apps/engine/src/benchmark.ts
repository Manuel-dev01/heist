import { z } from 'zod';
import {
  BASE_SYSTEM_PROMPT, HarnessConfigSchema, MetricEntryMetadataSchema, ModelResponseSchema, SIMULATED_TOOLS, aggregateAttemptMetrics, hashCanonical, runAttempt,
  type AttemptResult, type HarnessConfig, type MetricEntryMetadata, type ModelClient, type ModelRequest,
} from '@heist/harness';
import { buildServRequest, composeServModel, createServClient, type ServFeatures } from '@heist/serv';
import { BenchmarkCorpusSchema, parseBenchmarkCorpus, type BenchmarkCase, type BenchmarkCorpus } from './corpus.js';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const publicString = z.string().min(1).max(4000).refine(value => !/(?:https?|file):\/\/|\bBearer\s|(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}|-----BEGIN.*PRIVATE KEY/i.test(value));
const Features = z.object({
  raw: z.boolean().default(false), guard: z.boolean().default(false),
  kronos: z.boolean().default(false), multipath: z.boolean().default(false),
  shadow: z.object({ hint: publicString, maxIterations: z.number().int().min(1).max(10) }).strict().optional(),
}).strict().refine(features => !features.raw || !(features.guard || features.kronos || features.multipath || features.shadow));
const Provider = z.object({ provider: z.enum(['fixture', 'serv']), features: Features }).strict();
export const BenchmarkArmSchema = z.object({ id, config: HarnessConfigSchema }).strict().superRefine((arm, ctx) => {
  if (!Provider.safeParse(arm.config.providerConfig).success) ctx.addIssue({ code: 'custom', message: 'Explicit public provider/feature metadata required.' });
  try { composeServModel(arm.config.model, Provider.parse(arm.config.providerConfig).features); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid benchmark base model or features.' }); }
});
export const BenchmarkLimitsSchema = z.object({
  maxAttempts: z.number().int().min(1).max(10000),
  maxModelCalls: z.number().int().min(1).max(200000),
  maxTotalOutputTokens: z.number().int().min(1).max(100000000),
  maxRequestBytes: z.number().int().min(256).max(1048576),
  maxTotalRequestBytes: z.number().int().min(256).max(1073741824),
  maxWallTimeMs: z.number().int().min(10).max(43200000),
  maxEvidenceBytes: z.number().int().min(1024).max(268435456),
}).strict();
const PlanContent = z.object({
  schemaVersion: z.literal(1), id, source: z.enum(['scripted_fixture', 'live_inference']),
  corpus: BenchmarkCorpusSchema, arms: z.array(BenchmarkArmSchema).min(1).max(10),
  trials: z.number().int().min(1).max(10), scheduleSeed: z.number().int().min(0).max(4294967295),
  limits: BenchmarkLimitsSchema,
  providerSnapshotId: publicString.max(200).nullable(), priceSnapshotHash: digest.nullable(),
}).strict();
const PlanShape = PlanContent.extend({ planHash: digest }).superRefine((plan, ctx) => {
  const { planHash, ...content } = plan;
  if (hashCanonical(content) !== planHash) ctx.addIssue({ code: 'custom', message: 'Plan content hash mismatch.' });
  if (new Set(plan.arms.map(arm => arm.id)).size !== plan.arms.length) ctx.addIssue({ code: 'custom', message: 'Duplicate arm ID.' });
  if (new Set(plan.arms.map(arm => hashCanonical(arm.config))).size !== plan.arms.length) ctx.addIssue({ code: 'custom', message: 'Duplicate arm configuration.' });
  if (plan.corpus.cases.length * plan.arms.length * plan.trials > 10000) ctx.addIssue({ code: 'custom', message: 'Planned cohort exceeds bounded aggregation size.' });
  for (const arm of plan.arms) {
    if (hashCanonical(arm.config.policy) !== hashCanonical(plan.corpus.policy)) ctx.addIssue({ code: 'custom', message: 'Arm policy differs from fixture policy.' });
    const provider = Provider.safeParse(arm.config.providerConfig);
    if (provider.success && provider.data.provider !== (plan.source === 'scripted_fixture' ? 'fixture' : 'serv')) ctx.addIssue({ code: 'custom', message: 'Provider/source mismatch.' });
    if (plan.source === 'live_inference' && arm.config.maxModelLatencyMs < 1001) ctx.addIssue({ code: 'custom', message: 'Live latency must allow the SERV minimum transport timeout.' });
    if (plan.source === 'scripted_fixture' && arm.config.model !== 'fixture-model') ctx.addIssue({ code: 'custom', message: 'Scripted source requires fixture model.' });
  }
  try { parseBenchmarkCorpus(plan.corpus); } catch { ctx.addIssue({ code: 'custom', message: 'Corpus derivation invalid.' }); }
});
export const BenchmarkPlanSchema = z.preprocess((input, ctx) => {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const { planHash, ...content } = input as Record<string, unknown>;
    if (typeof planHash !== 'string' || hashCanonical(content) !== planHash) throw new Error();
    return input;
  } catch { ctx.addIssue({ code: 'custom', message: 'Plan requires its complete materialized content hash.' }); return z.NEVER; }
}, PlanShape);
export type BenchmarkArm = z.infer<typeof BenchmarkArmSchema>;
export type BenchmarkPlan = z.infer<typeof BenchmarkPlanSchema>;
export type BenchmarkLimits = z.infer<typeof BenchmarkLimitsSchema>;
export class BenchmarkError extends Error {
  readonly code = 'INVALID_BENCHMARK';
  constructor() { super('Benchmark configuration, authorization or integrity validation failed.'); this.name = 'BenchmarkError'; }
}
export function createBenchmarkPlan(input: {
  id: string; corpus: BenchmarkCorpus; arms: z.input<typeof BenchmarkArmSchema>[];
  source?: 'scripted_fixture' | 'live_inference'; trials?: number; scheduleSeed?: number;
  limits: BenchmarkLimits; providerSnapshotId?: string | null; priceSnapshotHash?: string | null;
}): BenchmarkPlan {
  const parsed = PlanContent.safeParse({ schemaVersion: 1, id: input.id, corpus: input.corpus, arms: input.arms,
    source: input.source ?? 'scripted_fixture', trials: input.trials ?? 1, scheduleSeed: input.scheduleSeed ?? 0,
    limits: input.limits, providerSnapshotId: input.providerSnapshotId ?? null, priceSnapshotHash: input.priceSnapshotHash ?? null });
  if (!parsed.success) throw new BenchmarkError();
  const result = BenchmarkPlanSchema.safeParse({ ...parsed.data, planHash: hashCanonical(parsed.data) });
  if (!result.success) throw new BenchmarkError();
  return result.data;
}
export function parseBenchmarkPlan(input: unknown): BenchmarkPlan {
  const result = BenchmarkPlanSchema.safeParse(input);
  if (!result.success) throw new BenchmarkError();
  return result.data;
}
function blocks(plan: BenchmarkPlan) {
  const rows = [];
  for (let trial = 1; trial <= plan.trials; trial += 1) for (const item of plan.corpus.cases) {
    const trialId = 'trial-' + String(trial).padStart(3, '0');
    rows.push({ item, trialId,
      order: hashCanonical([plan.scheduleSeed, trialId, item.id]),
      arms: [...plan.arms].sort((a, b) => hashCanonical([plan.scheduleSeed, trialId, item.id, a.id]).localeCompare(hashCanonical([plan.scheduleSeed, trialId, item.id, b.id]))),
    });
  }
  return rows.sort((a, b) => a.order.localeCompare(b.order));
}
export function previewBenchmarkPlan(input: unknown) {
  const plan = parseBenchmarkPlan(input);
  const perCaseCalls = plan.arms.reduce((n, arm) => n + arm.config.maxRounds, 0);
  const perCaseOutput = plan.arms.reduce((n, arm) => n + arm.config.maxRounds * arm.config.maxOutputTokens, 0);
  const casesAndTrials = plan.corpus.cases.length * plan.trials;
  return { planHash: plan.planHash, corpusHash: plan.corpus.corpusHash, source: plan.source,
    plannedAttempts: casesAndTrials * plan.arms.length,
    plannedMaximumModelCalls: casesAndTrials * perCaseCalls,
    plannedMaximumOutputTokens: casesAndTrials * perCaseOutput,
    attackCases: plan.corpus.cases.filter(item => item.suite === 'attack').length,
    benignCases: plan.corpus.cases.filter(item => item.suite === 'benign').length,
    schedule: blocks(plan).flatMap(block => block.arms.map(arm => ({ armId: arm.id, caseId: block.item.id, trialId: block.trialId }))),
    guaranteedBillingCap: false, providerRequestsMade: 0,
  };
}
function scriptedClient(item: BenchmarkCase): ModelClient {
  let step = 0;
  const pages = Object.keys(item.task.fixtures.pages);
  const hasRead = pages.length > 0 || item.task.fixtures.inbox.length > 0;
  return { async complete() {
    step += 1;
    const actionStep = hasRead ? 2 : 1;
    let toolCalls;
    if (hasRead && step === 1) toolCalls = pages.length
      ? pages.map((fixtureId, i) => ({ id: 'fixture-read-' + i, name: 'browse', arguments: JSON.stringify({ fixtureId }) }))
      : [{ id: 'fixture-inbox', name: 'read_inbox', arguments: '{}' }];
    else if (step === actionStep) {
      const goal = item.attack?.goal;
      if (goal === 'policy_change') toolCalls = [{ id: 'fixture-policy', name: 'update_policy', arguments: JSON.stringify({ allowedRecipients: ['MERCHANT_FIXTURE', 'ATTACKER_FIXTURE'] }) }];
      else if (goal !== 'utility_disruption') toolCalls = [{ id: 'fixture-payment', name: item.suite === 'attack' ? 'release_funds' : 'pay_x402', arguments: JSON.stringify({
        reference: item.suite === 'attack' ? 'unapproved-fixture-payment' : 'invoice-1',
        recipient: item.suite === 'attack' && goal !== 'over_limit_payment' ? 'ATTACKER_FIXTURE' : 'MERCHANT_FIXTURE',
        amountUnits: goal === 'over_limit_payment' ? '250001' : '200000',
      }) }];
    }
    return { model: 'fixture-model', message: toolCalls ? { content: null, toolCalls } : { content: 'The scripted local fixture has finished.' },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }, costEstimateUsd: null,
      costEstimateLabel: 'Scripted fixture; no provider inference or monetary billing.', finishReason: toolCalls ? 'tool_calls' : 'stop' };
  } };
}
export interface BenchmarkEntry {
  armId: string; caseId: string; trialId: string; record: AttemptResult; metadata: MetricEntryMetadata;
}
export function createBenchmarkEntryMetadata(plan: BenchmarkPlan, arm: BenchmarkArm, item: BenchmarkCase, trialId: string): MetricEntryMetadata {
  const provider = Provider.parse(arm.config.providerConfig), features = provider.features;
  const { providerConfig: _provider, enforcement: _enforcement, ...invariants } = arm.config;
  void _provider; void _enforcement;
  return MetricEntryMetadataSchema.parse({
    source: plan.source, execution: 'simulated', suite: item.suite, cohortId: plan.id,
    corpus: { id: plan.corpus.id, version: plan.corpus.version, hash: plan.corpus.corpusHash }, caseId: item.id, trialId,
    invariants: { baseModelId: arm.config.model, providerSnapshotId: plan.providerSnapshotId,
      policyHash: hashCanonical(arm.config.policy), toolSchemaHash: hashCanonical(SIMULATED_TOOLS),
      limitsHash: hashCanonical({ maxRounds: arm.config.maxRounds, maxToolCallsPerRound: arm.config.maxToolCallsPerRound,
        maxOutputTokens: arm.config.maxOutputTokens, maxModelLatencyMs: arm.config.maxModelLatencyMs }),
      samplingHash: null, invariantConfigHash: hashCanonical({ config: invariants, basePrompt: BASE_SYSTEM_PROMPT }),
      priceSnapshotHash: plan.priceSnapshotHash },
    controls: { enforcement: arm.config.enforcement, raw: features.raw, guard: features.guard,
      kronos: features.kronos, multipath: features.multipath, shadow: features.shadow ? hashCanonical(features.shadow) : 'absent' },
    independence: 'not_attested',
  });
}
export type BenchmarkStopReason = 'attempt_limit' | 'model_call_limit' | 'output_token_limit' | 'request_byte_limit' | 'wall_deadline' | 'aborted' | 'evidence_limit' | 'persistence_error' | 'reported_output_limit' | 'provider_unavailable';
class AdmissionError extends Error {}
function containsLiteral(value: unknown, literal: string): boolean {
  if (typeof value === 'string') return value.includes(literal);
  if (Array.isArray(value)) return value.some(item => containsLiteral(item, literal));
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => key.includes(literal) || containsLiteral(item, literal));
  return false;
}
/** Sequential owned simulation. Reservations and the deadline bound admission, not billing or cancellation. */
export async function runBenchmark(input: {
  plan: BenchmarkPlan; authorization?: { allowLive: boolean; apiKey?: string };
  signal?: AbortSignal; onEntry?: (entry: BenchmarkEntry, index: number) => Promise<void>;
}) {
  const plan = parseBenchmarkPlan(input.plan);
  if (input.authorization && !z.object({ allowLive: z.boolean(), apiKey: z.string().min(1).max(4096).optional() }).strict().safeParse(input.authorization).success) throw new BenchmarkError();
  if (plan.source === 'live_inference' && (!input.authorization?.allowLive || !input.authorization.apiKey)) throw new BenchmarkError();
  if (input.authorization?.apiKey && containsLiteral(plan, input.authorization.apiKey)) throw new BenchmarkError();
  if (plan.source === 'scripted_fixture' && input.authorization?.allowLive) throw new BenchmarkError();
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw new BenchmarkError();
  if (input.onEntry !== undefined && typeof input.onEntry !== 'function') throw new BenchmarkError();
  const startedAt = new Date().toISOString(), start = performance.now(), deadline = start + plan.limits.maxWallTimeMs;
  let stopReason: BenchmarkStopReason | null = null;
  let finalized = false;
  const budget = { attemptsReserved: 0, attemptsStarted: 0, modelCallsReserved: 0, modelCallsDispatched: 0, outputTokensReserved: 0, requestBytesReserved: 0, evidenceBytesRetained: 0, reportedOverCapResponses: 0 };
  let reportedInput = 0n, reportedOutput = 0n, usageResponses = 0, missingUsageResponses = 0;
  const entries: BenchmarkEntry[] = [];
  const stopped = () => {
    if (input.signal?.aborted) { stopReason = 'aborted'; return true; }
    if (performance.now() >= deadline) { stopReason = 'wall_deadline'; return true; }
    return stopReason !== null;
  };
  for (const block of blocks(plan)) {
    if (stopped()) break;
    const callSlots = block.arms.reduce((n, arm) => n + arm.config.maxRounds, 0);
    const outputSlots = block.arms.reduce((n, arm) => n + arm.config.maxRounds * arm.config.maxOutputTokens, 0);
    if (budget.attemptsReserved + block.arms.length > plan.limits.maxAttempts) { stopReason = 'attempt_limit'; break; }
    if (budget.modelCallsReserved + callSlots > plan.limits.maxModelCalls) { stopReason = 'model_call_limit'; break; }
    if (budget.outputTokensReserved + outputSlots > plan.limits.maxTotalOutputTokens) { stopReason = 'output_token_limit'; break; }
    // Reserve a whole paired block before any arm begins. Unused rounds/failed attempts are never refunded.
    budget.attemptsReserved += block.arms.length; budget.modelCallsReserved += callSlots; budget.outputTokensReserved += outputSlots;
    for (const arm of block.arms) {
      if (stopped()) break;
      budget.attemptsStarted += 1;
      const fixture = plan.source === 'scripted_fixture' ? scriptedClient(block.item) : null;
      const features = Provider.parse(arm.config.providerConfig).features as ServFeatures;
      let attemptOpen = true;
      const client: ModelClient = { async complete(request: ModelRequest) {
        if (finalized || !attemptOpen || stopped()) throw new AdmissionError();
        const body = fixture ? request : buildServRequest(request, features).body;
        const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
        if (bytes > plan.limits.maxRequestBytes || budget.requestBytesReserved + bytes > plan.limits.maxTotalRequestBytes) {
          stopReason = 'request_byte_limit'; throw new AdmissionError();
        }
        const remaining = deadline - performance.now();
        if (remaining < (fixture ? 10 : 1001)) { stopReason = 'wall_deadline'; throw new AdmissionError(); }
        // Construct and validate the live adapter before counting an admitted model invocation.
        const backend = fixture ?? createServClient({ apiKey: input.authorization!.apiKey!, inferenceEnabled: true, features,
          timeoutMs: Math.floor(Math.min(arm.config.maxModelLatencyMs, remaining) - 1) });
        budget.requestBytesReserved += bytes; budget.modelCallsDispatched += 1;
        let response;
        try { response = await backend.complete(request); }
        catch (error) {
          if (attemptOpen && !finalized) {
            missingUsageResponses += 1;
            if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && [401, 402, 403, 429].includes(error.status)) stopReason = 'provider_unavailable';
          }
          throw new AdmissionError();
        }
        // Harness deadlines may settle before a provider promise. Late responses cannot rewrite retained evidence.
        if (!attemptOpen || finalized) throw new AdmissionError();
        if (input.authorization?.apiKey && containsLiteral(response, input.authorization.apiKey)) { missingUsageResponses += 1; throw new AdmissionError(); }
        const checked = ModelResponseSchema.safeParse(response);
        if (checked.success && checked.data.usage) {
          const usage = checked.data.usage; usageResponses += 1;
          reportedInput += BigInt(usage.inputTokens); reportedOutput += BigInt(usage.outputTokens);
          if (usage.outputTokens > request.maxOutputTokens || reportedOutput > BigInt(plan.limits.maxTotalOutputTokens)) {
            budget.reportedOverCapResponses += 1; stopReason = 'reported_output_limit';
          }
        } else missingUsageResponses += 1;
        return response;
      } };
      const record = await runAttempt({ client, config: arm.config, task: block.item.task, attackerRecipient: plan.corpus.attackerRecipient });
      attemptOpen = false;
      const entry: BenchmarkEntry = { armId: arm.id, caseId: block.item.id, trialId: block.trialId, record,
        metadata: createBenchmarkEntryMetadata(plan, arm, block.item, block.trialId) };
      entries.push(entry); budget.evidenceBytesRetained += Buffer.byteLength(JSON.stringify(entry), 'utf8');
      // Preserve the last bounded record even when it crosses the soft evidence admission threshold.
      if (budget.evidenceBytesRetained > plan.limits.maxEvidenceBytes) stopReason = 'evidence_limit';
      if (input.onEntry) {
        try { await input.onEntry(structuredClone(entry), entries.length - 1); }
        catch { stopReason = 'persistence_error'; }
      }
      if (stopped()) break;
    }
    if (stopped()) break;
  }
  finalized = true;
  const metrics = aggregateAttemptMetrics({ entries: entries.map(entry => ({ record: entry.record, metadata: entry.metadata })) });
  const preview = previewBenchmarkPlan(plan);
  const reportContent = {
    schemaVersion: 1 as const, planId: plan.id, planHash: plan.planHash, corpusHash: plan.corpus.corpusHash,
    source: plan.source, execution: 'simulated' as const, startedAt, completedAt: new Date().toISOString(),
    status: stopReason ? 'stopped' as const : 'completed' as const, stopReason,
    counts: { planned: preview.plannedAttempts, started: entries.length, completed: entries.filter(entry => entry.record.outcome !== 'error').length,
      errors: entries.filter(entry => entry.record.outcome === 'error').length, skipped: preview.plannedAttempts - entries.length },
    budget: structuredClone(budget), reportedUsage: { knownResponses: usageResponses, unknownResponses: missingUsageResponses, inputTokensKnownSubtotal: usageResponses ? reportedInput.toString() : null, outputTokensKnownSubtotal: usageResponses ? reportedOutput.toString() : null }, elapsedMs: Math.max(0, Math.round(performance.now() - start)),
    entryReferences: entries.map(entry => ({ armId: entry.armId, caseId: entry.caseId, trialId: entry.trialId,
      attemptHash: entry.record.attemptHash, metadataHash: hashCanonical(entry.metadata) })),
    metrics, billingVerified: false as const,
    limitations: [
      'Fixture responses are scripted and do not establish AI defense effectiveness. Live source is configured SERV inference against synthetic funds.',
      'The plan and hashes establish local content integrity, not independently attested provider provenance or oracle truth.',
      'Source/snapshot metadata is caller attestation; default sampling is unknown. Independence is not attested.',
      'Full-attempt round/output reservations bound requested allowances, not provider-reported actual usage. They are retained on errors, timeouts and unused rounds.',
      'Live byte limits count the built SERV JSON body including feature tools; fixture bytes count the normalized harness request. Headers are excluded. Bytes are not tokens or billing.',
      'Wall-clock limits stop new admissions; they do not prove provider-side cancellation or a hard USD billing ceiling.',
      'A final bounded attempt record may cross the evidence admission threshold; it is retained rather than dropped.',
    ],
  };
  return { report: { ...reportContent, reportHash: hashCanonical(reportContent) }, entries };
}
