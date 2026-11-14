import data from '../data/evidence.json';
import type { AttemptRecord, HarnessConfig, Task } from '@heist/harness';

export interface ArmSummary {
  id: string; n: string; name: string; layer: string;
  attacks: number; breaches: number; upper95: number; benign: number; benignOk: number; incomplete: number; visibleCostPer1kUsd: number | null;
  combined?: { attacks: number; breaches: number; upper95: number; note: string };
  incompleteBreakdown?: Record<string, number>;
}
export interface EvidenceRecord {
  label: string; armId: string; caseId: string; cohortId: string; config: HarnessConfig; task: Task;
  attack: { channel: string; goal: string; techniques: string[]; payloadParts: string[] }; attackerRecipient: string; record: AttemptRecord;
}
export interface Exploit { id: string; caseId: string; channel: string; goal: string; techniques: string[]; snippet: string; d2Raw: boolean; vaultsBreached: number; frontier: boolean }
export interface Adaptive {
  status: 'not_started' | 'running' | 'complete'; outcome?: string;
  discovery?: { counts: Record<string, number>; executionStatus: string; stopReason: string | null } | null;
  confirm?: { counts: Record<string, number> } | null;
  arms?: { id: string; attacks: number; breaches: number; upper95: number }[];
  winners?: { id: string; hash: string; channel: string; goal: string; snippet: string; trials?: number; breaches?: number; vaultsBreached?: number }[];
  tree?: { root: string; goal?: string; channel?: string; nodes: { round: number; kind: 'screen' | 'refine'; status: string }[] }[];
  models?: { attacker: string; target: string };
  visibleCostUsd?: Record<string, number | boolean | null>;
}
export interface Evidence {
  generatedAt: string; disclaimer: string; sources: Record<string, string>;
  totals: { attempts: number; attackAttempts: number; breaches: number; corpusAttacks: number; corpusBenign: number };
  d2: Omit<ArmSummary, 'id' | 'n' | 'name' | 'layer'> & { model: string; mode: string };
  arms: ArmSummary[]; frontier: ArmSummary & { note: string };
  breach: EvidenceRecord; held: EvidenceRecord; exploits: Exploit[]; adaptive: Adaptive; kite: KiteEvidence | null;
}
export interface KiteRefusal { code: string; reason?: string; at: string; request: string; target?: string; message: string; session: { caps: { currency: string; max_amount_per_tx: string; max_total_amount: string }; status: string; spent: string; approvedBy: string; expiresAt: string } }
export interface KiteEvidence { mode: string; walletBalanceUsd: { before: number; after: number }; agentType: string; refusals: KiteRefusal[] }
export const evidence = data as unknown as Evidence;

export const pct = (x: number, digits = 2) => (x * 100).toFixed(digits) + '%';
export const units = (s: string | number) => Number(s).toLocaleString('en-US');
export const goalLabel: Record<string, string> = {
  unauthorized_payment: 'unauthorized payment', recipient_substitution: 'recipient swap', over_limit_payment: 'over-limit payment', policy_change: 'policy tampering', utility_disruption: 'task disruption', secret_exfiltration: 'secret leak',
};
export const channelLabel: Record<string, string> = { browse: 'web page', inbox: 'inbox', direct_chat: 'chat', tool_output: 'tool output' };
/** Vault 00 is shown with all raw attempts (D2 + D3 raw arm); other vaults use their D3 arm. */
export function vaultStats(a: ArmSummary) { return a.combined ? { attacks: a.combined.attacks, breaches: a.combined.breaches, upper95: a.combined.upper95 } : { attacks: a.attacks, breaches: a.breaches, upper95: a.upper95 }; }
