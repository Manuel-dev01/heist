import { z } from 'zod';

export const MAX_ADAPTIVE_SUMMARY_BYTES = 1024 * 1024;
export const MAX_ADAPTIVE_SUMMARY_DEPTH = 32;
export const MAX_ADAPTIVE_SUMMARY_NODES = 50000;
export const ADAPTIVE_SUMMARY_LABEL = 'Summary hash matches; original plan/result not checked here' as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().min(1).max(200);
const identifier = label.max(120);
const tokens = z.string().max(24).regex(/^(0|[1-9][0-9]*)$/).nullable();
const dollars = z.number().finite().nonnegative().max(1024000000).nullable();
const callback = z.enum(['not_requested', 'completed', 'failed', 'timeout', 'aborted']);
const stop = z.enum(['model_call_limit', 'output_token_limit', 'screen_limit', 'refinement_limit', 'request_byte_limit', 'wall_deadline', 'aborted',
  'record_byte_limit', 'evidence_limit', 'persistence_error', 'client_timeout', 'provider_unavailable', 'opaque_client_error', 'reported_output_limit', 'consecutive_error_limit', 'invalid_evidence']);
const commonEvent = { slotId: identifier, rootHash: digest, round: integer.max(3), callback };
const errorCode = z.enum(['invalid_config', 'invalid_task', 'invalid_run_options', 'model_error', 'model_timeout', 'invalid_model_response',
  'model_mismatch', 'invalid_tool_arguments', 'unknown_tool', 'duplicate_tool_call', 'tool_call_limit', 'max_rounds_exceeded', 'fixture_not_found', 'harness_error']);
const event = z.discriminatedUnion('kind', [
  z.object({ ...commonEvent, kind: z.literal('screen'), candidateHash: digest,
    outcome: z.enum(['benign_ok', 'benign_fail', 'breach', 'blocked', 'error']), errorCode: errorCode.nullable(), goalAchieved: z.boolean(), utilitySuccess: z.boolean(),
    valueLostUnits: z.string().max(80).regex(/^(0|[1-9][0-9]*)$/) }),
  z.object({ ...commonEvent, kind: z.literal('refinement'), parentHash: digest, childHash: digest.nullable(),
    status: z.enum(['refined', 'duplicate', 'refusal', 'invalid', 'provider_error', 'budget_exhausted']) }),
]);

// The producer has already verified full evidence. This projection checks only
// what this compact summary itself can establish; imported valid:true is no proof.
export const AdaptiveSummaryProjectionSchema = z.object({
  kind: z.literal('adaptive_inspection_summary'), schemaVersion: z.literal(1), valid: z.literal(true), summaryHash: digest,
  verification: z.object({ scope: z.literal('local_internal_consistency'), entriesChecked: integer.max(224) }),
  planId: identifier, planHash: digest, resultHash: digest, seedCorpusHash: digest,
  source: z.enum(['scripted_fixture', 'live_inference']), sourceMetadata: z.literal('caller_attestation'), execution: z.literal('simulated'),
  models: z.object({ surrogate: label, attacker: label }),
  executionStatus: z.enum(['preview', 'completed', 'stopped']), stopReason: stop.nullable(),
  selectionStatus: z.enum(['not_run', 'insufficient_candidates', 'selected', 'frozen', 'corpus_rejected']),
  counts: z.object({ screens: integer.max(128), completedScreens: integer.max(128), screenErrors: integer.max(128), refinements: integer.max(96),
    candidates: integer.max(128), eligibleCandidates: integer.max(128), selectedCandidates: integer.max(32), pendingBranches: integer.max(32) }),
  budget: z.object({ callsReserved: integer.max(1024), outputTokensReserved: integer.max(2097152), screensReserved: integer.max(128), refinementsReserved: integer.max(96),
    clientInvocations: integer.max(1024), normalizedRequestBytes: integer.max(67108864), evidenceBytes: integer.max(18939904),
    requestedOutputTokensForInvocations: integer.max(2097152), maximumClientInvocations: integer.min(1).max(1024), maximumRequestedOutputTokens: integer.min(1).max(2097152) }),
  usage: z.object({ knownCalls: integer.max(1024), unknownSettledCalls: integer.max(1024), unobservedCalls: integer.max(1024),
    inputTokensKnownSubtotal: tokens, outputTokensKnownSubtotal: tokens }),
  cost: z.object({ knownCalls: integer.max(1024), unknownCalls: integer.max(1024), knownSubtotalEstimateUsd: dollars, totalEstimateUsd: dollars,
    billingVerified: z.literal(false), actualBilledUsd: z.null(), guaranteedBillingCap: z.literal(false) }),
  selection: z.object({ selectedCandidateHashes: z.array(digest).max(32), corpusHash: digest.nullable(), untestedBenignTemplates: integer.max(40) }),
  branches: z.array(z.object({ seedCaseId: identifier, rootHash: digest, currentHash: digest, round: integer.max(3),
    state: z.enum(['pending', 'active', 'goal_achieved', 'screen_error', 'refusal', 'invalid', 'duplicate', 'exhausted']) })).min(1).max(32),
  events: z.array(event).max(224), limitations: z.array(z.string().min(1).max(1000)).min(1).max(20),
}).superRefine((summary, context) => {
  const c = summary.counts, b = summary.budget, u = summary.usage, cost = summary.cost, s = summary.selection;
  const screens = summary.events.filter(entry => entry.kind === 'screen');
  const refinements = summary.events.filter(entry => entry.kind === 'refinement');
  const eligible = new Set(screens.filter(entry => entry.outcome !== 'error' && entry.goalAchieved).map(entry => entry.candidateHash));
  const roots = new Set(summary.branches.map(branch => branch.rootHash));
  const selected = new Set(s.selectedCandidateHashes);
  const fail = () => context.addIssue({ code: 'custom', message: 'Adaptive summary projections disagree.' });
  // Reconstruct only the lineage visible in compact events. Full task/oracle,
  // admission limits and provider provenance still require the original evidence.
  const compactLineageMatches = () => {
    type State = 'pending' | 'active' | 'goal_achieved' | 'screen_error' | 'refusal' | 'invalid' | 'duplicate';
    const branches = summary.branches.map(branch => ({ rootHash: branch.rootHash, currentHash: branch.rootHash, round: 0, state: 'pending' as State }));
    const catalog = new Set(branches.map(branch => branch.rootHash));
    let nextInitial = 0, latestRefinementRound = 0;
    let childScreen: { rootIndex: number; hash: string; round: number } | null = null;
    for (const entry of summary.events) {
      const rootIndex = branches.findIndex(branch => branch.rootHash === entry.rootHash), branch = branches[rootIndex];
      if (!branch || entry.slotId !== 'root-' + String(rootIndex + 1).padStart(2, '0') + '.round-' + entry.round + '.' + (entry.kind === 'screen' ? 'screen' : 'refine')) return false;
      if (childScreen && (entry.kind !== 'screen' || rootIndex !== childScreen.rootIndex || entry.candidateHash !== childScreen.hash || entry.round !== childScreen.round)) return false;
      if (entry.kind === 'screen') {
        if (branch.state === 'pending') {
          if (childScreen || rootIndex !== nextInitial || entry.round !== 0 || entry.candidateHash !== branch.rootHash) return false;
          nextInitial += 1;
        } else if (!childScreen || branch.state !== 'active') return false;
        branch.currentHash = entry.candidateHash; branch.round = entry.round;
        branch.state = entry.outcome === 'error' ? 'screen_error' : entry.goalAchieved ? 'goal_achieved' : 'active';
        childScreen = null;
      } else {
        if (nextInitial !== branches.length || branch.state !== 'active' || entry.parentHash !== branch.currentHash || entry.round !== branch.round + 1 || entry.round < latestRefinementRound) return false;
        // Breadth-first root order is observable without the original plan.
        if (branches.some((other, index) => other.state === 'active' && (other.round < entry.round - 1 || index < rootIndex && other.round === entry.round - 1))) return false;
        latestRefinementRound = entry.round;
        if (entry.status === 'refined') {
          if (entry.childHash === null || catalog.has(entry.childHash)) return false;
          catalog.add(entry.childHash);
          childScreen = { rootIndex, hash: entry.childHash, round: entry.round };
        } else if (entry.status === 'duplicate') {
          if (entry.childHash === null || !catalog.has(entry.childHash)) return false;
          branch.state = 'duplicate';
        } else {
          if (entry.childHash !== null) return false;
          branch.state = entry.status === 'refusal' ? 'refusal' : 'invalid';
        }
      }
    }
    if (catalog.size !== c.candidates) return false;
    // Only screens update currentHash/round. A newly refined child can remain
    // unscreened after callback failure, while still counting in the catalog.
    const canSeal = nextInitial === branches.length && childScreen === null && !branches.some(branch => branch.state === 'active' && branch.round < latestRefinementRound);
    const activeStates = new Set(branches.flatMap((branch, index) => branch.state === 'active' ? [summary.branches[index]!.state] : []));
    if (activeStates.size > 1 || summary.executionStatus === 'completed' && (!canSeal || activeStates.has('active'))) return false;
    return branches.every((branch, index) => {
      const supplied = summary.branches[index]!;
      return supplied.currentHash === branch.currentHash && supplied.round === branch.round &&
        (supplied.state === branch.state || branch.state === 'active' && supplied.state === 'exhausted' && canSeal);
    });
  };
  if (!compactLineageMatches()) fail();
  if (c.completedScreens + c.screenErrors !== c.screens || c.screens !== screens.length || c.refinements !== refinements.length ||
      c.screenErrors !== screens.filter(entry => entry.outcome === 'error').length || summary.verification.entriesChecked !== summary.events.length ||
      c.eligibleCandidates !== eligible.size || c.selectedCandidates !== s.selectedCandidateHashes.length || selected.size !== c.selectedCandidates ||
      [...selected].some(hash => !eligible.has(hash)) || c.selectedCandidates > c.eligibleCandidates || c.eligibleCandidates > c.candidates ||
      c.candidates < summary.branches.length || roots.size !== summary.branches.length || new Set(summary.branches.map(branch => branch.seedCaseId)).size !== summary.branches.length ||
      summary.events.some(entry => !roots.has(entry.rootHash)) || new Set(summary.events.map(entry => entry.slotId)).size !== summary.events.length ||
      c.pendingBranches !== summary.branches.filter(branch => branch.state === 'pending' || branch.state === 'active').length) fail();
  if (b.clientInvocations > b.callsReserved || b.callsReserved > b.maximumClientInvocations ||
      b.requestedOutputTokensForInvocations > b.outputTokensReserved || b.outputTokensReserved > b.maximumRequestedOutputTokens ||
      b.screensReserved < c.screens || b.refinementsReserved < c.refinements || b.callsReserved < b.screensReserved + b.refinementsReserved ||
      b.requestedOutputTokensForInvocations < b.clientInvocations || (b.clientInvocations === 0 && b.requestedOutputTokensForInvocations !== 0)) fail();
  if (u.knownCalls + u.unknownSettledCalls + u.unobservedCalls !== b.clientInvocations ||
      (u.knownCalls === 0 ? u.inputTokensKnownSubtotal !== null || u.outputTokensKnownSubtotal !== null : u.inputTokensKnownSubtotal === null || u.outputTokensKnownSubtotal === null) ||
      cost.knownCalls + cost.unknownCalls !== b.clientInvocations ||
      (cost.knownCalls === 0 ? cost.knownSubtotalEstimateUsd !== null : cost.knownSubtotalEstimateUsd === null) ||
      (cost.unknownCalls !== 0 || cost.knownCalls === 0 ? cost.totalEstimateUsd !== null : cost.totalEstimateUsd !== cost.knownSubtotalEstimateUsd)) fail();
  if ((summary.executionStatus === 'stopped') !== (summary.stopReason !== null) ||
      (summary.executionStatus !== 'completed' && (s.corpusHash !== null || s.untestedBenignTemplates !== 0)) ||
      (s.corpusHash === null && s.untestedBenignTemplates !== 0) ||
      (summary.selectionStatus === 'frozen') !== (s.corpusHash !== null) ||
      (s.corpusHash !== null && c.selectedCandidates === 0) ||
      (summary.executionStatus === 'preview' && (summary.events.length !== 0 || summary.selectionStatus !== 'not_run' || b.clientInvocations !== 0)) ||
      (summary.executionStatus !== 'preview' && summary.selectionStatus === 'not_run')) fail();
  for (const entry of screens) if ((entry.outcome === 'error') !== (entry.errorCode !== null)) fail();
  for (const entry of refinements) {
    if ((entry.status === 'refined' || entry.status === 'duplicate') !== (entry.childHash !== null)) fail();
  }
});

export type AdaptiveSummary = z.infer<typeof AdaptiveSummaryProjectionSchema>;
export type AdaptiveSummaryInspection = { valid: true; summary: AdaptiveSummary; verificationLabel: typeof ADAPTIVE_SUMMARY_LABEL } |
  { valid: false; reason: 'file_size' | 'file_read' | 'invalid_json' | 'bounded_json' | 'invalid_summary' | 'hash_mismatch' | 'crypto_unavailable' };
const invalid = (reason: Extract<AdaptiveSummaryInspection, { valid: false }>['reason']): AdaptiveSummaryInspection => ({ valid: false, reason });

function boundedJson(value: unknown) {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > MAX_ADAPTIVE_SUMMARY_NODES || depth > MAX_ADAPTIVE_SUMMARY_DEPTH) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object') return false;
    return (Array.isArray(item) ? item : Object.values(item)).every(child => visit(child, depth + 1));
  };
  return visit(value, 0);
}
/** Original object canonicalization: omit only root summaryHash, never unknown/nested fields. */
function canonicalSummary(value: unknown, root = true): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(child => canonicalSummary(child, false)).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).filter(key => !root || key !== 'summaryHash').sort().map(key => JSON.stringify(key) + ':' + canonicalSummary(record[key], false)).join(',') + '}';
}
export async function inspectAdaptiveSummaryText(text: string): Promise<AdaptiveSummaryInspection> {
  if (typeof text !== 'string' || text.length < 1 || text.length > MAX_ADAPTIVE_SUMMARY_BYTES || new TextEncoder().encode(text).byteLength > MAX_ADAPTIVE_SUMMARY_BYTES) return invalid('file_size');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return invalid('invalid_json'); }
  if (!boundedJson(raw)) return invalid('bounded_json');
  const checked = AdaptiveSummaryProjectionSchema.safeParse(raw);
  if (!checked.success) return invalid('invalid_summary');
  let hash: string;
  try {
    if (!globalThis.crypto?.subtle) return invalid('crypto_unavailable');
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSummary(raw)));
    hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return invalid('crypto_unavailable'); }
  return hash === checked.data.summaryHash ? { valid: true, summary: checked.data, verificationLabel: ADAPTIVE_SUMMARY_LABEL } : invalid('hash_mismatch');
}
export interface LocalAdaptiveSummaryFile { size: number; text(): Promise<string> }
export async function inspectAdaptiveSummaryFile(file: LocalAdaptiveSummaryFile): Promise<AdaptiveSummaryInspection> {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ADAPTIVE_SUMMARY_BYTES) return invalid('file_size');
  try { return inspectAdaptiveSummaryText(await file.text()); } catch { return invalid('file_read'); }
}
export function createLatestAdaptiveSummaryReader() {
  let version = 0;
  return { cancel() { version += 1; }, async read(file: LocalAdaptiveSummaryFile): Promise<{ current: false } | { current: true; inspection: AdaptiveSummaryInspection }> {
    const selected = ++version, inspection = await inspectAdaptiveSummaryFile(file);
    return selected === version ? { current: true, inspection } : { current: false };
  } };
}
