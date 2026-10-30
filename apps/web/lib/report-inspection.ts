import { z } from 'zod';

export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_REPORT_DEPTH = 32;
export const MAX_REPORT_NODES = 200000;
const count = z.number().int().nonnegative().max(10000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.enum(['scripted_fixture', 'live_inference']);
const amount = z.number().finite().nonnegative().max(1000000000000).nullable();
const label = z.string().min(1).max(200);
const close = (actual: number, expected: number) => Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected));

const RateSchema = z.object({ successes: count, total: count, rate: z.number().finite().min(0).max(1).nullable() })
  .superRefine((rate, context) => {
    if (rate.successes > rate.total || (rate.total === 0 ? rate.rate !== null || rate.successes !== 0 :
      rate.rate === null || !close(rate.rate, rate.successes / rate.total)))
      context.addIssue({ code: 'custom', message: 'Rate counts and value disagree.' });
  });
const LatencySchema = z.object({
  samples: count, p50: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  p95: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).superRefine((latency, context) => {
  if (latency.samples === 0 ? latency.p50 !== null || latency.p95 !== null :
    latency.p50 === null || latency.p95 === null || latency.p95 < latency.p50)
    context.addIssue({ code: 'custom', message: 'Latency sample summary is inconsistent.' });
});
const GroupSchema = z.object({
  groupId: digest, state: z.literal('descriptive_only'), metadataSource: z.literal('caller_attestation'),
  metadata: z.object({
    source, execution: z.literal('simulated'), cohortId: label,
    corpus: z.object({ id: label, version: label, hash: digest }),
    invariants: z.object({ baseModelId: label.nullable(), providerSnapshotId: label.nullable() }),
    controls: z.object({
      enforcement: z.enum(['observe', 'enforce']), raw: z.boolean(), guard: z.boolean(), kronos: z.boolean(), multipath: z.boolean(),
      shadow: z.union([z.boolean(), z.literal('absent'), digest]),
    }),
    independence: z.enum(['not_attested', 'independent_bernoulli']),
  }),
  counts: z.object({
    attempts: count.min(1), benign: count, attack: count, completed: count, errors: count,
    attackErrors: count, observedBreachesOnError: count, observedUtilityOnError: count,
  }),
  primary: z.object({
    asr: RateSchema, modelAsr: RateSchema, executionAsr: RateSchema, bu: RateSchema, ua: RateSchema, availability: RateSchema,
  }),
  latencyMs: z.object({ all: LatencySchema }),
  cost: z.object({
    knownRecords: count, completeRecords: count, unknownRecords: count, incompleteRecords: count,
    complete: z.boolean(), knownSubtotalUsd: amount, totalEstimateUsd: amount, estimatedCostPer1000AttemptsUsd: amount,
    billingVerified: z.literal(false),
  }),
  effects: z.object({
    valueLostUnits: z.string().max(80).regex(/^(0|[1-9][0-9]*)$/),
    unit: z.literal('simulated_whole_units'), realMoneyLossClaimed: z.literal(false),
  }),
}).superRefine((group, context) => {
  const c = group.counts, p = group.primary, cost = group.cost;
  const benignErrors = c.errors - c.attackErrors;
  // Error breaches include both suites. Only benign errors can absorb an error
  // breach outside primary ASR; every other one must remain an attack breach.
  const minimumAttackErrorBreaches = Math.max(0, c.observedBreachesOnError - benignErrors);
  const maximumAttackErrorBreaches = Math.min(c.attackErrors, c.observedBreachesOnError);
  if (c.benign + c.attack !== c.attempts || c.completed + c.errors !== c.attempts || c.attackErrors > Math.min(c.errors, c.attack) ||
      benignErrors > c.benign || c.observedBreachesOnError > c.errors || c.observedUtilityOnError > c.errors ||
      p.asr.total !== c.attack || p.modelAsr.total !== c.attack || p.executionAsr.total !== c.attack ||
      p.bu.total !== c.benign || p.ua.total !== c.attack || p.availability.total !== c.attempts ||
      p.availability.successes !== c.completed || p.bu.successes > c.benign - (c.errors - c.attackErrors) ||
      p.ua.successes > c.attack - c.attackErrors ||
      p.asr.successes < minimumAttackErrorBreaches ||
      p.asr.successes > c.attack - c.attackErrors + maximumAttackErrorBreaches ||
      p.asr.successes < Math.max(p.modelAsr.successes, p.executionAsr.successes) ||
      p.asr.successes > Math.min(c.attack, p.modelAsr.successes + p.executionAsr.successes) ||
      group.latencyMs.all.samples !== c.attempts)
    context.addIssue({ code: 'custom', message: 'Group counts and projected summaries disagree.' });
  const fullyKnown = cost.completeRecords === c.attempts;
  if (cost.knownRecords + cost.unknownRecords !== c.attempts || cost.completeRecords > cost.knownRecords ||
      cost.incompleteRecords !== c.attempts - cost.completeRecords || cost.complete !== fullyKnown ||
      (cost.knownRecords === 0 ? cost.knownSubtotalUsd !== null : cost.knownSubtotalUsd === null) ||
      (fullyKnown ? cost.totalEstimateUsd === null || cost.knownSubtotalUsd === null || !close(cost.totalEstimateUsd, cost.knownSubtotalUsd) ||
        cost.estimatedCostPer1000AttemptsUsd === null || !close(cost.estimatedCostPer1000AttemptsUsd, cost.totalEstimateUsd * 1000 / c.attempts) :
        cost.totalEstimateUsd !== null || cost.estimatedCostPer1000AttemptsUsd !== null))
    context.addIssue({ code: 'custom', message: 'Projected cost coverage is inconsistent.' });
});
const StopReasonSchema = z.enum([
  'attempt_limit', 'model_call_limit', 'output_token_limit', 'request_byte_limit', 'wall_deadline', 'aborted', 'evidence_limit',
  'persistence_error', 'reported_output_limit', 'provider_unavailable', 'consecutive_error_limit',
]);
export const ReportProjectionSchema = z.object({
  schemaVersion: z.literal(1), planId: label, planHash: digest, corpusHash: digest,
  source, execution: z.literal('simulated'), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  status: z.enum(['completed', 'stopped']), stopReason: StopReasonSchema.nullable(),
  counts: z.object({ planned: count.min(1), started: count, completed: count, errors: count, skipped: count }),
  metrics: z.object({
    schemaVersion: z.literal(1), inputEntries: count, acceptedUniqueAttempts: count, exclusions: z.array(z.unknown()).max(10000),
    groups: z.array(GroupSchema).max(100),
  }),
  billingVerified: z.literal(false), reportHash: digest,
}).superRefine((report, context) => {
  const c = report.counts, metrics = report.metrics;
  const sum = (key: 'attempts' | 'completed' | 'errors') => metrics.groups.reduce((total, group) => total + group.counts[key], 0);
  if (c.started > c.planned || c.completed + c.errors !== c.started || c.skipped !== c.planned - c.started ||
      (report.status === 'completed' ? report.stopReason !== null || c.skipped !== 0 : report.stopReason === null) ||
      metrics.inputEntries !== c.started || metrics.acceptedUniqueAttempts !== c.started || metrics.exclusions.length !== 0 ||
      sum('attempts') !== c.started || sum('completed') !== c.completed || sum('errors') !== c.errors ||
      new Set(metrics.groups.map(group => group.groupId)).size !== metrics.groups.length ||
      metrics.groups.some(group => group.metadata.source !== report.source || group.metadata.execution !== report.execution ||
        group.metadata.cohortId !== report.planId || group.metadata.corpus.hash !== report.corpusHash))
    context.addIssue({ code: 'custom', message: 'Report and projected group counts or source bindings disagree.' });
});
export type InspectedReport = z.infer<typeof ReportProjectionSchema>;
export type ReportInspection =
  | { valid: true; report: InspectedReport; verificationLabel: 'Report hash matches; entries not checked' }
  | { valid: false; reason: 'file_size' | 'file_read' | 'invalid_json' | 'bounded_json' | 'invalid_report' | 'hash_mismatch' | 'crypto_unavailable' };
const invalid = (reason: Extract<ReportInspection, { valid: false }>['reason']): ReportInspection => ({ valid: false, reason });

function boundedTree(value: unknown): boolean {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    nodes += 1;
    if (nodes > MAX_REPORT_NODES || depth > MAX_REPORT_DEPTH) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) return false;
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(item);
    const valid = (Array.isArray(item) ? item : Object.values(item)).every(child => visit(child, depth + 1));
    ancestors.delete(item);
    return valid;
  }
  return visit(value, 0);
}
/** Sort object keys, retain array order and omit only the root reportHash. Unknown fields stay in the hash. */
function originalCanonicalReport(value: unknown, root = true): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => originalCanonicalReport(item, false)).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).filter(key => !root || key !== 'reportHash').sort()
    .map(key => JSON.stringify(key) + ':' + originalCanonicalReport(record[key], false)).join(',') + '}';
}
/** Browser-only content check. No entries, provider, billing or metric provenance is authenticated. */
export async function inspectReportText(text: string): Promise<ReportInspection> {
  if (typeof text !== 'string' || text.length > MAX_REPORT_BYTES) return invalid('file_size');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_REPORT_BYTES) return invalid('file_size');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return invalid('invalid_json'); }
  if (!boundedTree(raw)) return invalid('bounded_json');
  const projected = ReportProjectionSchema.safeParse(raw);
  if (!projected.success) return invalid('invalid_report');
  let computed: string;
  try {
    if (!globalThis.crypto?.subtle) return invalid('crypto_unavailable');
    const canonical = new TextEncoder().encode(originalCanonicalReport(raw));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', canonical);
    computed = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return invalid('crypto_unavailable'); }
  if (computed !== projected.data.reportHash) return invalid('hash_mismatch');
  return { valid: true, report: projected.data, verificationLabel: 'Report hash matches; entries not checked' };
}
export interface LocalReportFile { size: number; text(): Promise<string> }
export async function inspectReportFile(file: LocalReportFile): Promise<ReportInspection> {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_REPORT_BYTES) return invalid('file_size');
  let text: string;
  try { text = await file.text(); } catch { return invalid('file_read'); }
  return inspectReportText(text);
}
/** A newer selection or explicit clear supersedes every earlier asynchronous read/hash result. */
export function createLatestReportReader() {
  let version = 0;
  return {
    cancel() { version += 1; },
    async read(file: LocalReportFile): Promise<{ current: false } | { current: true; inspection: ReportInspection }> {
      const selectedVersion = ++version;
      const inspection = await inspectReportFile(file);
      return selectedVersion === version ? { current: true, inspection } : { current: false };
    },
  };
}
