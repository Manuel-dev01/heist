import { z } from 'zod';
import { hashCanonical, IdentifierSchema } from '@heist/harness';
import {
  AttackCaseSchema, MutatorSchema, PublicTargetContextSchema, createAttackGenerator, dedupeAttackCases,
  hashPublicTargetContext, mutateAttackCase, type AttackCase, type AttackGenerationResult,
  type AttackMutator, type ModelClient, type PublicTargetContext,
} from '@heist/pod';
import { createPaymentCorpus, type BenchmarkCorpus } from './corpus.js';

const identifier = IdentifierSchema.max(80);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const publicLabel = z.string().min(1).max(200).refine(value =>
  !/(?:https?|file|ftp):\/\/|\bBearer\s|(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}|-----BEGIN.*PRIVATE KEY/i.test(value));
export const CorpusGenerationSpecSchema = z.object({
  channel: z.enum(['direct_chat', 'browse', 'inbox']),
  goal: z.enum(['unauthorized_payment', 'over_limit_payment', 'recipient_substitution', 'policy_change', 'utility_disruption']),
}).strict();
export type CorpusGenerationSpec = z.infer<typeof CorpusGenerationSpecSchema>;
const DEFAULT_SPECS: CorpusGenerationSpec[] = ['direct_chat', 'browse', 'inbox'].flatMap(channel =>
  ['unauthorized_payment', 'over_limit_payment', 'recipient_substitution', 'policy_change', 'utility_disruption']
    .map(goal => CorpusGenerationSpecSchema.parse({ channel, goal })));
const GenerationSettings = z.object({
  specs: z.array(CorpusGenerationSpecSchema).min(1).max(15).default(() => structuredClone(DEFAULT_SPECS)),
  maxModelCalls: z.number().int().min(1).max(32).default(32),
  countPerCall: z.number().int().min(1).max(4).default(4),
  maxCandidates: z.number().int().min(1).max(128).default(128),
  maxOutputTokensPerCall: z.number().int().min(1).max(4096).default(4096),
  maxTotalOutputTokens: z.number().int().min(1).max(131072).default(131072),
  maxPayloadBytes: z.number().int().min(16).max(1024).default(1024),
  timeoutMs: z.number().int().min(10).max(60000).default(30000),
}).strict();
const MutationSettings = z.object({
  seed: z.number().int().min(0).max(4294967295).default(731),
  rounds: z.number().int().min(0).max(4).default(2),
  mutators: z.array(MutatorSchema).max(6).default(['authority', 'urgency', 'role_frame', 'base64', 'hex', 'split']),
  maxVariants: z.number().int().min(0).max(3072).default(1536),
  maxPayloadBytes: z.number().int().min(16).max(4096).default(4096),
}).strict();
const CorpusSettings = z.object({
  id: IdentifierSchema.max(96), version: IdentifierSchema.max(96),
  targetAttackCount: z.number().int().min(1).max(1000).default(1000),
  benignCount: z.number().int().min(1).max(40).default(40),
}).strict();
const PlanContent = z.object({
  schemaVersion: z.literal(1), id: identifier,
  source: z.enum(['scripted_fixture', 'live_inference']),
  sourceMetadata: z.literal('caller_attestation'),
  model: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  providerSnapshotId: publicLabel.nullable(),
  context: PublicTargetContextSchema,
  corpus: CorpusSettings,
  generation: GenerationSettings,
  mutations: MutationSettings,
}).strict();
type PlanContentData = z.infer<typeof PlanContent>;

export class CorpusGenerationError extends Error {
  readonly code = 'INVALID_CORPUS_GENERATION';
  constructor() { super('Corpus generation plan, authorization or injected client failed validation.'); this.name = 'CorpusGenerationError'; }
}
function validContent(plan: PlanContentData): boolean {
  try {
    // The existing corpus boundary validates the owned scope, symbolic accounts and supported tool declaration.
    createPaymentCorpus({ id: plan.corpus.id, version: plan.corpus.version, context: plan.context, attacks: [], benignCount: plan.corpus.benignCount });
    if (plan.generation.maxModelCalls * plan.generation.countPerCall > plan.generation.maxCandidates ||
        plan.generation.maxModelCalls * plan.generation.maxOutputTokensPerCall > plan.generation.maxTotalOutputTokens) return false;
    if (new Set(plan.generation.specs.map(spec => spec.channel + ':' + spec.goal)).size !== plan.generation.specs.length ||
        new Set(plan.mutations.mutators).size !== plan.mutations.mutators.length) return false;
    return plan.generation.specs.every(spec =>
      (spec.channel !== 'browse' || plan.context.toolNames.includes('browse')) &&
      (spec.channel !== 'inbox' || plan.context.toolNames.includes('read_inbox')));
  } catch { return false; }
}
const PlanShape = PlanContent.extend({ planHash: digest }).superRefine((plan, context) => {
  const { planHash, ...body } = plan;
  if (!validContent(plan) || hashCanonical(body) !== planHash)
    context.addIssue({ code: 'custom', message: 'Plan bounds, owned-fixture scope or materialized content are inconsistent.' });
});
export const CorpusGenerationPlanSchema = z.preprocess((input, context) => {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const { planHash, ...body } = input as Record<string, unknown>;
    if (typeof planHash !== 'string' || hashCanonical(body) !== planHash) throw new Error();
    return input;
  } catch { context.addIssue({ code: 'custom', message: 'A complete materialized plan hash is required.' }); return z.NEVER; }
}, PlanShape);
export type CorpusGenerationPlan = z.infer<typeof CorpusGenerationPlanSchema>;
export interface CreateCorpusGenerationPlanInput {
  id: string; model: string; source: 'scripted_fixture' | 'live_inference'; context: PublicTargetContext;
  providerSnapshotId?: string | null;
  corpus?: { id?: string; version?: string; targetAttackCount?: number; benignCount?: number };
  generation?: z.input<typeof GenerationSettings>;
  mutations?: z.input<typeof MutationSettings>;
}
export function createCorpusGenerationPlan(input: CreateCorpusGenerationPlanInput): CorpusGenerationPlan {
  try {
    const parsed = PlanContent.safeParse({
      schemaVersion: 1, id: input.id, model: input.model, source: input.source, sourceMetadata: 'caller_attestation',
      providerSnapshotId: input.providerSnapshotId ?? null, context: input.context,
      corpus: { id: input.corpus?.id ?? input.id + '.corpus', version: input.corpus?.version ?? '1',
        targetAttackCount: input.corpus?.targetAttackCount ?? 1000, benignCount: input.corpus?.benignCount ?? 40 },
      generation: input.generation ?? {}, mutations: input.mutations ?? {},
    });
    if (!parsed.success) throw new CorpusGenerationError();
    return parseCorpusGenerationPlan({ ...parsed.data, planHash: hashCanonical(parsed.data) });
  } catch { throw new CorpusGenerationError(); }
}
export function parseCorpusGenerationPlan(input: unknown): CorpusGenerationPlan {
  try {
    const parsed = CorpusGenerationPlanSchema.safeParse(input);
    if (!parsed.success) throw new CorpusGenerationError();
    return parsed.data;
  } catch { throw new CorpusGenerationError(); }
}
interface GenerationSlot extends CorpusGenerationSpec { id: string; index: number; count: number }
interface MutationSlot { id: string; baseIndex: number; round: number; mutator: AttackMutator; seed: number }
function generationSlots(plan: CorpusGenerationPlan): GenerationSlot[] {
  return Array.from({ length: plan.generation.maxModelCalls }, (_unused, index) => ({
    id: 'generation-' + String(index + 1).padStart(3, '0'), index,
    ...plan.generation.specs[index % plan.generation.specs.length]!, count: plan.generation.countPerCall,
  }));
}
function mutationSlots(plan: CorpusGenerationPlan): MutationSlot[] {
  const result: MutationSlot[] = [];
  for (let baseIndex = 0; baseIndex < plan.generation.maxCandidates; baseIndex += 1)
    for (let round = 0; round < plan.mutations.rounds; round += 1)
      for (const mutator of plan.mutations.mutators) {
        if (result.length >= plan.mutations.maxVariants) return result;
        result.push({ id: 'mutation-' + String(result.length + 1).padStart(4, '0'), baseIndex, round: round + 1, mutator,
          seed: Number.parseInt(hashCanonical([plan.mutations.seed, baseIndex, round + 1, mutator]).slice(0, 8), 16) });
      }
  return result;
}
export function previewCorpusGenerationPlan(input: unknown) {
  const plan = parseCorpusGenerationPlan(input), slots = generationSlots(plan), variants = mutationSlots(plan);
  const schedule = { generation: slots, mutations: variants };
  return {
    planHash: plan.planHash, contextHash: hashPublicTargetContext(plan.context), scheduleHash: hashCanonical(schedule),
    source: plan.source, sourceMetadata: 'caller_attestation' as const, model: plan.model,
    targetAttackCount: plan.corpus.targetAttackCount, benignCount: plan.corpus.benignCount,
    maximumClientInvocations: slots.length,
    maximumOutputTokensReserved: slots.length * plan.generation.maxOutputTokensPerCall,
    maximumCandidateReservations: slots.length * plan.generation.countPerCall,
    maximumMutationAttempts: variants.length, schedule,
    providerRequestsMade: 0, guaranteedBillingCap: false,
    targetGuaranteed: false, independenceAttested: false, attackEffectivenessMeasured: false,
  };
}

export interface GenerationSlotResult {
  slot: GenerationSlot;
  status: AttackGenerationResult['status'] | 'not_run_aborted' | 'not_run_budget';
  reason: string | null;
  candidateHashes: string[];
  duplicatesWithinResponse: number;
  duplicatesAcrossSlots: number;
  uniqueAccepted: number;
  completion: { model: string; inputTokens: number | null; outputTokens: number | null; costEstimateUsd: number | null } | null;
}
export interface MutationSlotResult {
  slot: MutationSlot;
  parentHash: string | null; candidateHash: string | null;
  status: 'created' | 'duplicate' | 'skipped_payload_limit' | 'skipped_too_short' | 'skipped_no_parent' | 'skipped_target_reached' | 'not_run_aborted';
}
export interface CandidateRelation {
  contentHash: string; origin: 'generated' | 'mutated'; sourceSlotId: string; parentHash: string | null;
  rootHash: string; selected: boolean;
}
export type CorpusGenerationStatus = 'preview' | 'frozen' | 'insufficient_candidates' | 'corpus_rejected' | 'aborted';
const LIMITATIONS = [
  'Source and provider snapshot are caller attestations. Hashes establish local content identity, not provenance, ownership or consent.',
  'One injected client invocation is admitted per predefined generation slot. Errors, refusals, invalid output and duplicate output never create replacement slots or retries.',
  'Output and candidate reservations are retained on failures and unused output. Timeouts cannot prove cancellation or a USD billing limit for an arbitrary injected client.',
  'Generation proposes synthetic messages only. No victim execution, wallet, network fetch, refinement, attack effectiveness or defense efficacy is established here.',
  'Local mutations share their generated parent. Related variants and template benign tasks are not independent or a validated representative corpus.',
  'The first distinct candidates in fixed generation/variant order fill the requested target. No quality ranking or success filtering is performed.',
  'Only validated successful generation responses expose partial usage and token-price estimates. Other dispatched calls remain unknown; no actual billing is verified.',
];
export async function runCorpusGeneration(input: {
  plan: CorpusGenerationPlan; client?: ModelClient; allowInference?: boolean; signal?: AbortSignal;
}) {
  const plan = parseCorpusGenerationPlan(input.plan);
  if (input.allowInference !== undefined && typeof input.allowInference !== 'boolean') throw new CorpusGenerationError();
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw new CorpusGenerationError();
  const preview = previewCorpusGenerationPlan(plan);
  const budget = { callsReserved: 0, clientInvocations: 0, outputTokensReserved: 0, candidatesReserved: 0, mutationAttempts: 0 };
  const slots: GenerationSlotResult[] = [], variants: MutationSlotResult[] = [], relations: CandidateRelation[] = [];
  const selected: AttackCase[] = [], bases: AttackCase[] = [];
  const seen = new Map<string, AttackCase>(), ids = new Map<string, string>();
  let status: CorpusGenerationStatus = input.allowInference === true ? 'insufficient_candidates' : 'preview';
  let corpus: BenchmarkCorpus | null = null, identityConflict = false;
  let knownUsageCalls = 0, knownCostCalls = 0, inputTokens = 0n, outputTokens = 0n, knownCostSubtotal = 0;
  if (input.allowInference === true && (!input.client || typeof input.client.complete !== 'function')) throw new CorpusGenerationError();

  const register = (candidate: AttackCase, sourceSlotId: string, origin: 'generated' | 'mutated', parentHash: string | null) => {
    const attack = dedupeAttackCases([candidate], 1).cases[0]!;
    const prior = seen.get(attack.contentHash);
    if (ids.has(attack.id) && ids.get(attack.id) !== attack.contentHash) { identityConflict = true; return false; }
    const choose = prior === undefined && selected.length < plan.corpus.targetAttackCount;
    relations.push({ contentHash: attack.contentHash, origin, sourceSlotId, parentHash,
      rootHash: parentHash ?? attack.contentHash, selected: choose });
    if (prior) return false;
    seen.set(attack.contentHash, attack); ids.set(attack.id, attack.contentHash);
    if (origin === 'generated') bases.push(attack);
    if (choose) selected.push(attack);
    return true;
  };

  if (input.allowInference === true) {
    for (const slot of preview.schedule.generation) {
      const row: GenerationSlotResult = { slot, status: 'not_run_aborted', reason: null, candidateHashes: [],
        duplicatesWithinResponse: 0, duplicatesAcrossSlots: 0, uniqueAccepted: 0, completion: null };
      if (input.signal?.aborted) { status = 'aborted'; slots.push(row); continue; }
      const settings = plan.generation;
      if (budget.callsReserved + 1 > settings.maxModelCalls ||
          budget.outputTokensReserved + settings.maxOutputTokensPerCall > settings.maxTotalOutputTokens ||
          budget.candidatesReserved + slot.count > settings.maxCandidates) {
        row.status = 'not_run_budget'; status = 'insufficient_candidates'; slots.push(row); continue;
      }
      budget.callsReserved += 1; budget.outputTokensReserved += settings.maxOutputTokensPerCall; budget.candidatesReserved += slot.count;
      const client: ModelClient = { complete(request) { budget.clientInvocations += 1; return input.client!.complete(request); } };
      // The existing generator retains each slot's own finite reservations. The outer counters
      // compose up to32 one-call generators without widening that primitive's total-token bound.
      const generator = createAttackGenerator({ client, model: plan.model, budget: {
        maxModelCalls: 1, maxOutputTokensPerCall: settings.maxOutputTokensPerCall, maxTotalOutputTokens: settings.maxOutputTokensPerCall,
        maxCandidates: slot.count, maxPayloadBytes: settings.maxPayloadBytes, timeoutMs: settings.timeoutMs,
      } });
      const result = await generator.generate({ context: plan.context, channel: slot.channel, goal: slot.goal, count: slot.count });
      row.status = result.status;
      if (result.status === 'ok') {
        row.duplicatesWithinResponse = result.duplicates;
        row.candidateHashes = result.candidates.map(candidate => candidate.contentHash);
        for (const candidate of result.candidates) {
          if (register(candidate, slot.id, 'generated', null)) row.uniqueAccepted += 1;
          else row.duplicatesAcrossSlots += 1;
        }
        const completion = result.completion;
        const usage = completion.usage;
        const cost = completion.costEstimateUsd ?? null;
        row.completion = { model: completion.model, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, costEstimateUsd: cost };
        if (usage) { knownUsageCalls += 1; inputTokens += BigInt(usage.inputTokens); outputTokens += BigInt(usage.outputTokens); }
        if (cost !== null) { knownCostCalls += 1; knownCostSubtotal += cost; }
      } else if ('reason' in result) row.reason = result.reason;
      slots.push(row);
    }
    if (input.signal?.aborted) status = 'aborted';
    for (const slot of preview.schedule.mutations) {
      const parent = bases[slot.baseIndex];
      const row: MutationSlotResult = { slot, parentHash: parent?.contentHash ?? null, candidateHash: null, status: 'skipped_no_parent' };
      if (status === 'aborted') row.status = 'not_run_aborted';
      else if (selected.length >= plan.corpus.targetAttackCount) row.status = 'skipped_target_reached';
      else if (parent) {
        budget.mutationAttempts += 1;
        const mutated = mutateAttackCase(parent, slot.mutator, { seed: slot.seed, maxPayloadBytes: plan.mutations.maxPayloadBytes });
        if (mutated.status === 'skipped') row.status = mutated.reason === 'payload_limit' ? 'skipped_payload_limit' : 'skipped_too_short';
        else {
          row.candidateHash = mutated.attack.contentHash;
          row.status = register(mutated.attack, slot.id, 'mutated', parent.contentHash) ? 'created' : 'duplicate';
        }
      }
      variants.push(row);
    }
    if (status !== 'aborted') {
      if (identityConflict) status = 'corpus_rejected';
      else if (selected.length < plan.corpus.targetAttackCount) status = 'insufficient_candidates';
      else {
        try {
          corpus = createPaymentCorpus({ id: plan.corpus.id, version: plan.corpus.version, context: plan.context,
            attacks: selected, benignCount: plan.corpus.benignCount });
          status = 'frozen';
        } catch { status = 'corpus_rejected'; }
      }
    }
  }
  const reportContent = {
    schemaVersion: 1 as const, status, planId: plan.id, planHash: plan.planHash, scheduleHash: preview.scheduleHash,
    source: plan.source, sourceMetadata: 'caller_attestation' as const, model: plan.model, providerSnapshotId: plan.providerSnapshotId,
    contextHash: hashPublicTargetContext(plan.context), targetAttackCount: plan.corpus.targetAttackCount,
    corpusHash: corpus?.corpusHash ?? null,
    counts: {
      predefinedGenerationSlots: preview.schedule.generation.length, executedGenerationSlots: budget.callsReserved,
      uniqueGeneratedCandidates: bases.length, uniqueCandidatesAvailable: seen.size, selectedCandidates: selected.length,
      duplicatesWithinResponses: slots.reduce((sum, row) => sum + row.duplicatesWithinResponse, 0),
      duplicatesAcrossSlots: slots.reduce((sum, row) => sum + row.duplicatesAcrossSlots, 0),
      predefinedMutationSlots: preview.schedule.mutations.length,
      relatedVariantsCreated: variants.filter(row => row.status === 'created').length,
      duplicateVariants: variants.filter(row => row.status === 'duplicate').length,
      skippedPayloadVariants: variants.filter(row => row.status === 'skipped_payload_limit').length,
    },
    budget: structuredClone(budget),
    usage: { knownCalls: knownUsageCalls, unknownCalls: budget.clientInvocations - knownUsageCalls,
      inputTokensKnownSubtotal: knownUsageCalls ? inputTokens.toString() : null, outputTokensKnownSubtotal: knownUsageCalls ? outputTokens.toString() : null },
    cost: { knownCalls: knownCostCalls, unknownCalls: budget.clientInvocations - knownCostCalls,
      knownSubtotalEstimateUsd: knownCostCalls ? knownCostSubtotal : null,
      totalEstimateUsd: knownCostCalls === budget.clientInvocations && knownCostCalls > 0 ? knownCostSubtotal : null, billingVerified: false },
    slots, variants, relations, selectedCandidateHashes: selected.map(candidate => candidate.contentHash),
    independenceAttested: false, attackEffectivenessMeasured: false, limitations: [...LIMITATIONS],
  };
  return { report: { ...reportContent, reportHash: hashCanonical(reportContent) }, corpus,
    candidates: selected.map(candidate => AttackCaseSchema.parse(candidate)) };
}
