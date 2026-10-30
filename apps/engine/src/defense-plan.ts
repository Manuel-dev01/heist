import { z } from 'zod';
import { BASE_SYSTEM_PROMPT, HarnessConfigSchema, SIMULATED_TOOLS, hashCanonical, type HarnessConfig } from '@heist/harness';
import { BenchmarkLimitsSchema, createBenchmarkPlan, previewBenchmarkPlan, type BenchmarkPlan } from './benchmark.js';
import { BenchmarkCorpusSchema } from './corpus.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Shared accidental-secret/target guard for every caller-supplied public label.
// Ordinary unprefixed hashes remain valid; arbitrary prose still relies on caller attestation.
function containsSensitiveShape(value: string): boolean {
  return /(?:https?|ftp|file|data):\/\/|\bBearer\s|(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}|-----BEGIN.*PRIVATE KEY|\b0x[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?\b/i.test(value);
}
const publicText = z.string().min(1).refine(value => value.trim().length > 0 && !containsSensitiveShape(value));
const model = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/)
  .refine(value => !value.includes('-serv-') && !containsSensitiveShape(value));
const CommonLimitsSchema = z.object({
  maxRounds: HarnessConfigSchema.shape.maxRounds.unwrap(),
  maxToolCallsPerRound: HarnessConfigSchema.shape.maxToolCallsPerRound.unwrap(),
  maxOutputTokens: HarnessConfigSchema.shape.maxOutputTokens.unwrap(),
  maxModelLatencyMs: HarnessConfigSchema.shape.maxModelLatencyMs.unwrap(),
}).strict();
const ShadowSchema = z.object({
  hint: publicText.max(4000),
  maxIterations: z.number().int().min(1).max(10),
}).strict();
const FrontierSchema = z.object({
  model, limits: BenchmarkLimitsSchema,
  providerSnapshotId: publicText.max(200).nullable(),
  priceSnapshotHash: digest.nullable(),
}).strict();
export const DefensePlanInputSchema = z.object({
  // Leave room for the stable .frontier suffix within BenchmarkPlan's80-character ID.
  id: z.string().min(1).max(70).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).refine(value => !containsSensitiveShape(value)),
  source: z.enum(['scripted_fixture', 'live_inference']),
  model,
  corpus: BenchmarkCorpusSchema,
  common: CommonLimitsSchema,
  limits: BenchmarkLimitsSchema,
  trials: z.number().int().min(1).max(10),
  scheduleSeed: z.number().int().min(0).max(4294967295),
  providerSnapshotId: publicText.max(200).nullable(),
  priceSnapshotHash: digest.nullable(),
  shadow: ShadowSchema,
  frontierReference: FrontierSchema.optional(),
}).strict().superRefine((input, context) => {
  if (input.source === 'scripted_fixture' && (input.model !== 'fixture-model' || input.frontierReference !== undefined))
    context.addIssue({ code: 'custom', message: 'Scripted plans require the fixture model and have no frontier reference.' });
  if (input.frontierReference?.model === input.model)
    context.addIssue({ code: 'custom', message: 'A frontier reference must declare a separate base model.' });
});
export type CreateDefensePlanInput = z.input<typeof DefensePlanInputSchema>;
export class DefensePlanError extends Error {
  readonly code = 'INVALID_DEFENSE_PLAN';
  constructor() { super('Defense plan input, controlled cohort or explicit budgets failed validation.'); this.name = 'DefensePlanError'; }
}
type ControlValue = boolean | string;
type DefenseControl = 'raw' | 'guard' | 'kronos' | 'multipath' | 'shadow' | 'enforcement';
type DefenseFeatures = {
  raw: boolean; guard: boolean; kronos: boolean; multipath: boolean; shadow?: { hint: string; maxIterations: number };
};
interface Stage {
  id: string; features: DefenseFeatures; enforcement: HarnessConfig['enforcement'];
}
function stages(shadow: z.infer<typeof ShadowSchema>): Stage[] {
  const none = { raw: false, guard: false, kronos: false, multipath: false };
  return [
    { id: 'raw', features: { ...none, raw: true }, enforcement: 'observe' },
    { id: 'serv-default', features: { ...none }, enforcement: 'observe' },
    { id: 'guard', features: { ...none, guard: true }, enforcement: 'observe' },
    { id: 'guard-kronos', features: { ...none, guard: true, kronos: true }, enforcement: 'observe' },
    { id: 'guard-kronos-multipath', features: { ...none, guard: true, kronos: true, multipath: true }, enforcement: 'observe' },
    { id: 'guard-kronos-multipath-shadow', features: { ...none, guard: true, kronos: true, multipath: true, shadow: structuredClone(shadow) }, enforcement: 'observe' },
    { id: 'guard-kronos-multipath-shadow-enforced', features: { ...none, guard: true, kronos: true, multipath: true, shadow: structuredClone(shadow) }, enforcement: 'enforce' },
  ];
}
function controls(stage: Stage): Record<DefenseControl, ControlValue> {
  return {
    enforcement: stage.enforcement, raw: stage.features.raw ?? false, guard: stage.features.guard ?? false,
    kronos: stage.features.kronos ?? false, multipath: stage.features.multipath ?? false,
    shadow: stage.features.shadow ? hashCanonical(stage.features.shadow) : 'absent',
  };
}
function reservationCoverage(plan: BenchmarkPlan) {
  const attemptsPerBlock = plan.arms.length;
  const modelCallsPerBlock = plan.arms.reduce((sum, arm) => sum + arm.config.maxRounds, 0);
  const outputTokensPerBlock = plan.arms.reduce((sum, arm) => sum + arm.config.maxRounds * arm.config.maxOutputTokens, 0);
  const plannedCaseTrialBlocks = plan.corpus.cases.length * plan.trials;
  const maxCompleteBlocksByReservations = Math.min(plannedCaseTrialBlocks,
    Math.floor(plan.limits.maxAttempts / attemptsPerBlock),
    Math.floor(plan.limits.maxModelCalls / modelCallsPerBlock),
    Math.floor(plan.limits.maxTotalOutputTokens / outputTokensPerBlock));
  return {
    attemptsPerBlock, modelCallsPerBlock, outputTokensPerBlock, plannedCaseTrialBlocks, maxCompleteBlocksByReservations,
    fullCohortAdmissibleByReservations: maxCompleteBlocksByReservations === plannedCaseTrialBlocks,
    includesRequestBytesWallTimeOrEvidence: false as const,
    actualCompletionGuaranteed: false as const,
  };
}
function requireOneBlock(plan: BenchmarkPlan): void {
  if (reservationCoverage(plan).maxCompleteBlocksByReservations < 1) throw new DefensePlanError();
}
const LIMITATIONS = [
  'This is a planning composition. It performs no provider calls, victim execution, wallet actions or capability checks.',
  'The chain order defines adjacent comparisons. The existing benchmark runner randomizes arm order within each scheduled case/trial block.',
  'All seven main arms share the same base model, corpus, trusted prompt, policy, tool schema and harness limits. Only one declared metadata control changes per adjacent step.',
  'The executor step enforces the same existing immutable synthetic payment policy. It introduces no wallet/session cap, real transfer or new authorization policy.',
  'Feature declarations, source and provider snapshots remain caller attestations; no feature availability, reliability, effectiveness, independent sampling or causal improvement is established.',
  'Reservation coverage includes attempts, model-call slots and requested output only. Byte, wall-clock and evidence admission can stop a run earlier; no USD billing guarantee is made.',
  'A frontier reference is a separate raw-model plan with separate budgets and unverified availability. A different model prevents attribution to the controlled defense chain.',
];
/** Pure planning only. All budgets and the fixed public Shadow configuration are supplied by the caller. */
export function createDefensePlan(input: CreateDefensePlanInput) {
  try {
    const parsed = DefensePlanInputSchema.safeParse(input);
    if (!parsed.success) throw new DefensePlanError();
    const settings = parsed.data, chain = stages(settings.shadow);
    const provider = settings.source === 'scripted_fixture' ? 'fixture' : 'serv';
    const plan = createBenchmarkPlan({
      id: settings.id, source: settings.source, corpus: settings.corpus,
      arms: chain.map(stage => ({ id: stage.id, config: {
        model: settings.model, policy: settings.corpus.policy, ...settings.common, enforcement: stage.enforcement,
        providerConfig: { provider, features: stage.features },
      } })),
      limits: settings.limits, trials: settings.trials, scheduleSeed: settings.scheduleSeed,
      providerSnapshotId: settings.providerSnapshotId, priceSnapshotHash: settings.priceSnapshotHash,
    });
    requireOneBlock(plan);
    const comparisons = chain.slice(1).map((stage, index) => {
      const before = controls(chain[index]!), after = controls(stage);
      const changes = (Object.keys(before) as DefenseControl[]).filter(key => before[key] !== after[key]);
      if (changes.length !== 1) throw new DefensePlanError();
      const changedControl = changes[0]!;
      return { fromArmId: chain[index]!.id, toArmId: stage.id, changedControl,
        before: before[changedControl], after: after[changedControl],
        attribution: 'same_base_model_supplied_invariants' as const };
    });
    const invariantConfig = { model: settings.model, policy: settings.corpus.policy, ...settings.common };
    const invariants = {
      model: settings.model, corpusHash: plan.corpus.corpusHash, policyHash: hashCanonical(plan.corpus.policy),
      promptHash: hashCanonical(BASE_SYSTEM_PROMPT), toolSchemaHash: hashCanonical(SIMULATED_TOOLS),
      harnessLimitsHash: hashCanonical(settings.common),
      invariantConfigHash: hashCanonical({ config: invariantConfig, basePrompt: BASE_SYSTEM_PROMPT }),
    };
    let frontierReference: {
      plan: BenchmarkPlan; availability: 'unverified'; attribution: 'cross_model_reference_only';
      sourceMetadata: 'caller_attestation'; effectiveness: 'unmeasured';
    } | null = null;
    if (settings.frontierReference) {
      const reference = settings.frontierReference;
      const frontierPlan = createBenchmarkPlan({
        id: settings.id + '.frontier', source: settings.source, corpus: settings.corpus,
        arms: [{ id: 'raw-frontier-reference', config: {
          model: reference.model, policy: settings.corpus.policy, ...settings.common, enforcement: 'observe',
          providerConfig: { provider, features: { raw: true, guard: false, kronos: false, multipath: false } },
        } }],
        limits: reference.limits, trials: settings.trials, scheduleSeed: settings.scheduleSeed,
        providerSnapshotId: reference.providerSnapshotId, priceSnapshotHash: reference.priceSnapshotHash,
      });
      requireOneBlock(frontierPlan);
      frontierReference = { plan: frontierPlan, availability: 'unverified', attribution: 'cross_model_reference_only',
        sourceMetadata: 'caller_attestation', effectiveness: 'unmeasured' };
    }
    const composition = {
      schemaVersion: 1 as const, plan, comparisons, invariants, frontierReference,
      sourceMetadata: 'caller_attestation' as const, independenceAttested: false as const,
      attackEffectivenessMeasured: false as const, limitations: [...LIMITATIONS],
    };
    return { ...composition, compositionHash: hashCanonical(composition) };
  } catch { throw new DefensePlanError(); }
}
export type DefensePlanComposition = ReturnType<typeof createDefensePlan>;

/** Accept the same strict creation input and reconstruct every descriptor instead of trusting a returned composition. */
export function previewDefensePlan(input: CreateDefensePlanInput) {
  const composition = createDefensePlan(input);
  return {
    compositionHash: composition.compositionHash,
    plan: previewBenchmarkPlan(composition.plan),
    reservationCoverage: reservationCoverage(composition.plan),
    comparisons: structuredClone(composition.comparisons),
    invariants: structuredClone(composition.invariants),
    frontierReference: composition.frontierReference ? {
      availability: composition.frontierReference.availability,
      attribution: composition.frontierReference.attribution,
      sourceMetadata: composition.frontierReference.sourceMetadata,
      effectiveness: composition.frontierReference.effectiveness,
      plan: previewBenchmarkPlan(composition.frontierReference.plan),
      reservationCoverage: reservationCoverage(composition.frontierReference.plan),
    } : null,
    providerRequestsMade: 0, guaranteedBillingCap: false as const, actualCompletionGuaranteed: false as const,
  };
}
