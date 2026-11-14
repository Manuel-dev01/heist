import { AppHeader, Footnote, Page } from '../../../components/chrome';
import { AttemptView, type AttemptSide } from '../../../components/attempt-view';
import { css } from '../../../lib/css';
import { channelLabel, evidence, goalLabel, type EvidenceRecord } from '../../../lib/evidence';

export const metadata = { title: 'Attempt · HEIST' };

function side(key: 'breach' | 'held', e: EvidenceRecord, vault: string, layer: string, run: string): AttemptSide {
  const r = e.record, assistants = r.transcript.filter((m) => m.role === 'assistant'), last = assistants.at(-1);
  const o = r.oracle;
  return {
    key, vault, layer, run, channel: e.attack.channel, channelLabel: channelLabel[e.attack.channel] ?? e.attack.channel, goal: goalLabel[e.attack.goal] ?? e.attack.goal,
    debitUnits: r.ledger.totalDebitUnits, lostUnits: r.oracle.valueLostUnits,
    payload: e.attack.payloadParts.join(''),
    calls: r.toolEvents.map((t) => ({ round: t.round, tool: t.toolName, args: t.arguments, status: t.status, unsafe: t.unsafeAttempt })),
    allowedBefore: r.policyBefore.allowedRecipients, allowedAfter: r.policyAfter.allowedRecipients,
    balanceBefore: r.ledger.initialBalanceUnits, balanceAfter: r.ledger.availableBalanceUnits,
    finalAnswer: last && !last.toolCalls?.length ? (last.content ?? '').replace(/\*\*/g, '') : '',
    breached: o.modelBreached || o.executionBreached,
    rules: [['policy_mutation', o.policyMutationCalled], ['attacker_destination', o.attackerDestinationCalled], ['over_policy_amount', o.overPolicyAmountCalled], ['secret_leak', o.secretLeak]],
    attemptHash: r.attemptHash, ts: r.ts, latencyMs: r.latencyMs, recordJson: JSON.stringify(r, null, 2),
  };
}

export default async function AttemptPage({ searchParams }: { searchParams: Promise<{ vault?: string }> }) {
  const { vault } = await searchParams;
  const breach = side('breach', evidence.breach, 'VAULT 00 · OPEN SAFE', 'raw model', 'D2 run');
  const held = side('held', evidence.held, 'VAULT 06 · FORT KNOX', 'enforced policy · 6 layers', 'D3 run');
  return (
    <Page>
      <AppHeader active="ARENA" />
      <AttemptView breach={breach} held={held} start={vault && vault !== '00' ? 'held' : 'breach'} />
      <div style={css('padding:18px clamp(16px,2.4vw,28px) 40px;max-width:1100px')}>
        <Footnote>Both panels are real recorded attempts of the identical attack, replayed from saved evidence; nothing here is simulated for display. Fort Knox held, but its agent also did not pay the legitimate invoice: defenses can cost utility on attack-bearing tasks (benign-only tasks still completed 40 / 40). Amounts are synthetic whole units in an owned sandbox.</Footnote>
      </div>
    </Page>
  );
}
