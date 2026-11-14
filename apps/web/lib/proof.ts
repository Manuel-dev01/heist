import { canonicalJson, evaluateOutcome, hashAttemptRecord, runAttempt } from '@heist/harness';
import { evidence, type EvidenceRecord } from './evidence';

export interface ProofResult { which: 'breach' | 'held'; attemptHash: string; recomputedHash: string; hashOk: boolean; oracleOk: boolean; replayOk: boolean; replayedModelTurns: number; verdict: string }

/** Re-derives a bundled real record offline: hash, deterministic oracle, and a full harness replay of the saved decisions. */
export async function verifyEvidence(which: 'breach' | 'held'): Promise<ProofResult> {
  const e: EvidenceRecord = evidence[which], r = e.record;
  const recomputedHash = hashAttemptRecord(r);
  const assistants = r.transcript.filter((m) => m.role === 'assistant'), last = assistants.at(-1);
  const oracle = evaluateOutcome({
    task: e.task, attackerRecipient: e.attackerRecipient, ledger: r.ledger, policyBefore: r.policyBefore, policyAfter: r.policyAfter, toolEvents: r.toolEvents,
    finalAnswer: last?.toolCalls?.length ? '' : last?.content ?? '',
    visibleOutputs: assistants.flatMap((m) => [...(m.content ? [m.content] : []), ...(m.toolCalls ?? []).map((c) => c.arguments)]),
  });
  let cursor = 0, turns = 0, replayOk = false;
  try {
    const rebuilt = await runAttempt({
      config: e.config, task: e.task, attackerRecipient: e.attackerRecipient, identity: { id: r.id, ts: r.ts },
      client: { async complete(request) {
        const next = r.transcript.findIndex((m, i) => i >= cursor && m.role === 'assistant');
        if (next < 0 || canonicalJson(request.messages) !== canonicalJson(r.transcript.slice(0, next))) throw new Error('Saved decision prefix mismatch.');
        cursor = next + 1; turns++;
        const m = r.transcript[next]!;
        if (m.role !== 'assistant') throw new Error('Saved decision role mismatch.');
        return { model: e.config.model, message: { content: m.content, ...(m.toolCalls ? { toolCalls: structuredClone(m.toolCalls) } : {}) } };
      } },
    });
    const fields = ['oracle', 'ledger', 'policyBefore', 'policyAfter', 'toolEvents', 'transcript', 'outcome', 'rounds', 'taskHash', 'configHash', 'promptHash'] as const;
    replayOk = fields.every((f) => canonicalJson(rebuilt[f]) === canonicalJson(r[f]));
  } catch { replayOk = false; }
  return { which, attemptHash: r.attemptHash, recomputedHash, hashOk: recomputedHash === r.attemptHash, oracleOk: canonicalJson(oracle) === canonicalJson(r.oracle), replayOk, replayedModelTurns: turns,
    verdict: r.oracle.modelBreached || r.oracle.executionBreached ? 'BREACHED' : 'HELD' };
}
