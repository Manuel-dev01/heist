import { z } from 'zod';
import {
  BASE_SYSTEM_PROMPT, MetricEntryMetadataSchema, SIMULATED_TOOLS, aggregateAttemptMetrics,
  canonicalJson, hashCanonical, parseAttemptRecord, type AttemptResult,
} from '@heist/harness';
import { createBenchmarkEntryMetadata, parseBenchmarkPlan, previewBenchmarkPlan } from './benchmark.js';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const decimal = z.string().max(40).regex(/^(0|[1-9][0-9]*)$/);
const EntrySchema = z.object({
  armId: identity, caseId: identity, trialId: identity,
  record: z.unknown(), metadata: MetricEntryMetadataSchema,
}).strict();
const StopReasonSchema = z.enum(['attempt_limit', 'model_call_limit', 'output_token_limit', 'request_byte_limit',
  'wall_deadline', 'aborted', 'evidence_limit', 'persistence_error', 'reported_output_limit', 'provider_unavailable']);
const ReportSchema = z.object({
  schemaVersion: z.literal(1), planId: identity, planHash: digest, corpusHash: digest,
  source: z.enum(['scripted_fixture', 'live_inference']), execution: z.literal('simulated'),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  status: z.enum(['completed', 'stopped']), stopReason: StopReasonSchema.nullable(),
  counts: z.object({ planned: count, started: count, completed: count, errors: count, skipped: count }).strict(),
  budget: z.object({ attemptsReserved: count, attemptsStarted: count, modelCallsReserved: count,
    modelCallsDispatched: count, outputTokensReserved: count, requestBytesReserved: count,
    evidenceBytesRetained: count, reportedOverCapResponses: count }).strict(),
  reportedUsage: z.object({ knownResponses: count, unknownResponses: count,
    inputTokensKnownSubtotal: decimal.nullable(), outputTokensKnownSubtotal: decimal.nullable(),
    unobservedSettlements: count.optional(), missingUsageInvocations: count.optional() }).strict(),
  elapsedMs: count,
  entryReferences: z.array(z.object({ armId: identity, caseId: identity, trialId: identity,
    attemptHash: digest, metadataHash: digest }).strict()).max(10000),
  metrics: z.unknown(), billingVerified: z.literal(false),
  limitations: z.array(z.string().min(1).max(2000)).min(1).max(32), reportHash: digest,
}).strict();
export interface BenchmarkVerification {
  valid: boolean;
  reason: string | null;
  checkedEntries: number;
}

/** Accept JSON data only; reject cycles, exotic objects and unbounded nesting before hashing. */
function boundedJson(value: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (depth > 40) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const valid = children.every(child => boundedJson(child, ancestors, depth + 1));
  ancestors.delete(value);
  return valid;
}
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

/**
 * Rechecks saved local content and deterministic plan/record/metric bindings. A valid
 * result proves neither provider provenance nor oracle truth or actual billing.
 * Rehashed fabricated executions can still be internally consistent.
 */
export function verifyBenchmarkResult(input: { plan: unknown; report: unknown; entries: unknown }): BenchmarkVerification {
  let checkedEntries = 0;
  let stage = 'invalid_input';
  const fail = (reason: string): BenchmarkVerification => ({ valid: false, reason, checkedEntries });
  try {
    if (!input || typeof input !== 'object' || !boundedJson(input)) return fail(stage);
    stage = 'invalid_plan';
    const plan = parseBenchmarkPlan(input.plan);
    stage = 'invalid_report';
    if (Buffer.byteLength(JSON.stringify(input.report), 'utf8') > 16 * 1024 * 1024) return fail(stage);
    const parsedReport = ReportSchema.safeParse(input.report);
    if (!parsedReport.success) return fail(stage);
    const report = parsedReport.data;
    const { reportHash, ...reportBody } = report;
    if (reportHash !== hashCanonical(reportBody)) return fail('report_hash_mismatch');
    if (report.planId !== plan.id || report.planHash !== plan.planHash || report.corpusHash !== plan.corpus.corpusHash || report.source !== plan.source) return fail('report_plan_mismatch');
    if ((report.status === 'completed') !== (report.stopReason === null)) return fail('report_status_mismatch');
    stage = 'invalid_entries';
    if (!Array.isArray(input.entries) || input.entries.length > 10000) return fail(stage);
    const preview = previewBenchmarkPlan(plan);
    if (input.entries.length > preview.schedule.length || report.entryReferences.length !== input.entries.length) return fail('entry_schedule_mismatch');
    const arms = new Map(plan.arms.map(arm => [arm.id, arm]));
    const cases = new Map(plan.corpus.cases.map(item => [item.id, item]));
    const promptHash = hashCanonical(BASE_SYSTEM_PROMPT);
    const records: AttemptResult[] = [];
    const metricInputs: { record: unknown; metadata: unknown }[] = [];
    let evidenceBytes = 0, previousEvidenceBytes = 0;
    let minimumCalls = 0, maximumCalls = 0;
    for (const [index, rawEntry] of input.entries.entries()) {
      const parsed = EntrySchema.safeParse(rawEntry);
      if (!parsed.success) return fail('invalid_entry');
      const entry = parsed.data;
      const scheduled = preview.schedule[index]!;
      if (entry.armId !== scheduled.armId || entry.caseId !== scheduled.caseId || entry.trialId !== scheduled.trialId) return fail('entry_schedule_mismatch');
      const recordResult = parseAttemptRecord(entry.record);
      if (!recordResult.ok) return fail('invalid_attempt_record');
      const record = recordResult.record;
      const arm = arms.get(entry.armId)!;
      const item = cases.get(entry.caseId)!;
      const expectedConfigHash = hashCanonical({ config: arm.config, systemPromptHash: promptHash, tools: SIMULATED_TOOLS, secretCohort: false });
      if (record.taskId !== item.task.id || record.taskHash !== hashCanonical(item.task) || record.promptHash !== promptHash || record.configHash !== expectedConfigHash ||
        !same(record.policyBefore, arm.config.policy) || record.rounds < 1 || record.rounds > arm.config.maxRounds) return fail('entry_plan_mismatch');
      const expectedMetadata = createBenchmarkEntryMetadata(plan, arm, item, entry.trialId);
      if (!same(entry.metadata, expectedMetadata)) return fail('entry_metadata_mismatch');
      const reference = report.entryReferences[index]!;
      if (!same(reference, { armId: entry.armId, caseId: entry.caseId, trialId: entry.trialId,
        attemptHash: record.attemptHash, metadataHash: hashCanonical(entry.metadata) })) return fail('entry_reference_mismatch');
      previousEvidenceBytes = evidenceBytes;
      evidenceBytes += Buffer.byteLength(JSON.stringify(rawEntry), 'utf8');
      if (!Number.isSafeInteger(evidenceBytes)) return fail('evidence_budget_mismatch');
      maximumCalls += record.rounds;
      minimumCalls += record.rounds - (record.error?.code === 'model_error' ? 1 : 0);
      records.push(record);
      metricInputs.push({ record, metadata: entry.metadata });
      checkedEntries += 1;
    }
    stage = 'metrics_mismatch';
    const metrics = aggregateAttemptMetrics({ entries: metricInputs });
    if (metrics.acceptedUniqueAttempts !== records.length || metrics.exclusions.length > 0 || !same(report.metrics, metrics)) return fail(stage);
    const completed = records.filter(record => record.outcome !== 'error').length;
    const expectedCounts = { planned: preview.plannedAttempts, started: records.length, completed,
      errors: records.length - completed, skipped: preview.plannedAttempts - records.length };
    if (!same(report.counts, expectedCounts) || (report.status === 'completed' && records.length !== preview.plannedAttempts)) return fail('count_mismatch');
    stage = 'budget_mismatch';
    const budget = report.budget;
    const armCount = plan.arms.length;
    const reservedBlocks = budget.attemptsReserved / armCount;
    const callsPerBlock = plan.arms.reduce((sum, arm) => sum + arm.config.maxRounds, 0);
    const outputPerBlock = plan.arms.reduce((sum, arm) => sum + arm.config.maxRounds * arm.config.maxOutputTokens, 0);
    if (!Number.isInteger(reservedBlocks) || budget.attemptsStarted !== records.length || budget.attemptsReserved < records.length ||
      budget.attemptsReserved - records.length > armCount || budget.attemptsReserved > preview.plannedAttempts || budget.attemptsReserved > plan.limits.maxAttempts ||
      budget.modelCallsReserved !== reservedBlocks * callsPerBlock || budget.modelCallsReserved > plan.limits.maxModelCalls ||
      budget.outputTokensReserved !== reservedBlocks * outputPerBlock || budget.outputTokensReserved > plan.limits.maxTotalOutputTokens ||
      budget.modelCallsDispatched > budget.modelCallsReserved || budget.modelCallsDispatched < minimumCalls || budget.modelCallsDispatched > maximumCalls ||
      budget.requestBytesReserved > plan.limits.maxTotalRequestBytes ||
      ((budget.modelCallsDispatched === 0) !== (budget.requestBytesReserved === 0)) ||
      budget.requestBytesReserved > budget.modelCallsDispatched * plan.limits.maxRequestBytes ||
      budget.evidenceBytesRetained !== evidenceBytes || previousEvidenceBytes > plan.limits.maxEvidenceBytes ||
      (evidenceBytes > plan.limits.maxEvidenceBytes && report.status !== 'stopped')) return fail(stage);
    const usage = report.reportedUsage;
    if ((usage.unobservedSettlements !== undefined && usage.unobservedSettlements !== budget.modelCallsDispatched - usage.knownResponses - usage.unknownResponses) ||
      (usage.missingUsageInvocations !== undefined && usage.missingUsageInvocations !== budget.modelCallsDispatched - usage.knownResponses) ||
      usage.knownResponses + usage.unknownResponses > budget.modelCallsDispatched ||
      budget.reportedOverCapResponses > usage.knownResponses ||
      (report.stopReason === 'reported_output_limit' && budget.reportedOverCapResponses === 0) ||
      ((usage.knownResponses === 0) !== (usage.inputTokensKnownSubtotal === null)) ||
      ((usage.knownResponses === 0) !== (usage.outputTokensKnownSubtotal === null))) return fail('reported_usage_mismatch');
    if (usage.knownResponses > 0) {
      const recordInput = records.reduce((sum, record) => sum + BigInt(record.usage?.inputTokens ?? 0), 0n);
      const recordOutput = records.reduce((sum, record) => sum + BigInt(record.usage?.outputTokens ?? 0), 0n);
      if (BigInt(usage.inputTokensKnownSubtotal!) < recordInput || BigInt(usage.outputTokensKnownSubtotal!) < recordOutput) return fail('reported_usage_mismatch');
    } else if (records.some(record => record.usage !== null)) return fail('reported_usage_mismatch');
    return { valid: true, reason: null, checkedEntries };
  } catch { return fail(stage); }
}
