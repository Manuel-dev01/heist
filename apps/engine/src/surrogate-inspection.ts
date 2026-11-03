import { hashCanonical } from '@heist/harness';
import { parseSurrogatePlan, verifySurrogateResult, type SurrogateResult } from './surrogate-search.js';

export const MAX_SURROGATE_PLAN_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_SURROGATE_RESULT_FILE_BYTES = 32 * 1024 * 1024;

/** JSON-only inspection: the verifier checks the full saved adaptive prefix, not a summary hash alone. */
export function inspectSurrogateText(planText: string, resultText: string) {
  if (typeof planText !== 'string' || typeof resultText !== 'string' ||
      Buffer.byteLength(planText, 'utf8') > MAX_SURROGATE_PLAN_FILE_BYTES ||
      Buffer.byteLength(resultText, 'utf8') > MAX_SURROGATE_RESULT_FILE_BYTES)
    return { valid: false, reason: 'file_size' } as const;
  let planInput: unknown, resultInput: unknown;
  try { planInput = JSON.parse(planText); resultInput = JSON.parse(resultText); }
  catch { return { valid: false, reason: 'invalid_json' } as const; }
  try {
    const plan = parseSurrogatePlan(planInput);
    const verified = verifySurrogateResult({ plan, result: resultInput });
    if (!verified.valid) return { valid: false, reason: 'invalid_evidence' } as const;
    // Both values originate in JSON.parse, and the existing verifier has checked
    // the complete result schema, hash, plan binding and deterministic evidence.
    const result = resultInput as SurrogateResult;
    const summary = {
      kind: 'adaptive_inspection_summary' as const,
      schemaVersion: 1 as const, valid: true as const,
      verification: { scope: 'local_internal_consistency' as const, entriesChecked: verified.entriesChecked },
      planId: plan.id, planHash: plan.planHash, resultHash: result.resultHash, seedCorpusHash: result.seedCorpusHash,
      source: result.source, sourceMetadata: result.sourceMetadata, execution: result.execution,
      models: { surrogate: plan.surrogateModel, attacker: plan.attackerModel },
      executionStatus: result.executionStatus, stopReason: result.stopReason, selectionStatus: result.selectionStatus,
      counts: { ...result.counts },
      budget: { ...result.budget, requestedOutputTokensForInvocations: result.events.reduce((sum, entry) =>
        sum + entry.observations.reduce((subtotal, observation) => subtotal + observation.outputAllowance, 0), 0),
        maximumClientInvocations: plan.limits.maxModelCalls,
        maximumRequestedOutputTokens: plan.limits.maxTotalOutputTokens },
      usage: { ...result.usage },
      cost: { ...result.cost, actualBilledUsd: null, guaranteedBillingCap: false },
      selection: { selectedCandidateHashes: [...result.selectedCandidateHashes], corpusHash: result.corpus?.corpusHash ?? null,
        untestedBenignTemplates: result.corpus?.cases.filter(entry => entry.suite === 'benign').length ?? 0 },
      branches: result.branches.map(branch => ({ seedCaseId: branch.seedCaseId, rootHash: branch.rootHash,
        currentHash: branch.currentHash, round: branch.round, state: branch.state })),
      events: result.events.map(entry => entry.kind === 'screen'
        ? { kind: entry.kind, slotId: entry.slotId, rootHash: entry.rootHash, candidateHash: entry.candidateHash,
          round: entry.round, outcome: entry.record.outcome, errorCode: entry.record.error?.code ?? null, goalAchieved: entry.feedback.goalAchieved,
          utilitySuccess: entry.record.oracle.utilitySuccess, valueLostUnits: entry.record.oracle.valueLostUnits, callback: entry.callback }
        : { kind: entry.kind, slotId: entry.slotId, rootHash: entry.rootHash, parentHash: entry.parentHash,
          round: entry.round, status: entry.status, childHash: entry.childHash, callback: entry.callback }),
      limitations: [
        'Local internal consistency only. Provider origin, physical request counts, ownership and spending authorization are not authenticated.',
        'Source and model metadata are caller attestations. Scripted results do not measure model behavior.',
        'Related adaptive candidates are a biased discovery set, not independent trials or a representative attack-success estimate.',
        'Benign cases added to a selected corpus are untested templates. Utility disruption has no matched causal baseline.',
        'Known token usage and token-price estimates may be partial; unknown and unobserved calls remain explicit. Actual billing is unverified.',
        'Only synthetic funds were executed. No SERV transfer, defense benefit or real-money effectiveness is established.',
      ],
    };
    return { valid: true, summary: { ...summary, summaryHash: hashCanonical(summary) } } as const;
  } catch { return { valid: false, reason: 'invalid_evidence' } as const; }
}
export type SurrogateInspection = ReturnType<typeof inspectSurrogateText>;
