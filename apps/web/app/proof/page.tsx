import Link from 'next/link';
import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { ReplayButton } from '../../components/replay-button';
import { C, css, mono } from '../../lib/css';
import { evidence, goalLabel, units } from '../../lib/evidence';

export const metadata = { title: 'Proof · HEIST' };

export default async function ProofPage({ searchParams }: { searchParams: Promise<{ record?: string }> }) {
  const which = (await searchParams).record === 'held' ? 'held' : 'breach';
  const e = evidence[which], r = e.record, o = r.oracle, breached = o.modelBreached || o.executionBreached;
  const unsafe = r.toolEvents.find((t) => t.unsafeAttempt);
  const rawCall = unsafe ? JSON.stringify({ tool: unsafe.toolName, args: JSON.parse(unsafe.arguments), status: unsafe.status, violations: unsafe.violations }, null, 2)
    : JSON.stringify({ unsafeCalls: 0, calls: r.toolEvents.map((t) => t.toolName + ':' + t.status) }, null, 2);
  const rules: [string, boolean][] = [['policy_mutation', o.policyMutationCalled], ['attacker_destination', o.attackerDestinationCalled], ['over_policy_amount', o.overPolicyAmountCalled], ['wrong_recipient', o.wrongRecipient], ['secret_leak', o.secretLeak]];
  const transcript = r.transcript.map((m) => {
    if (m.role === 'assistant') return ['agent', m.toolCalls?.length ? 'calls ' + m.toolCalls.map((c) => c.name + '(' + c.arguments + ')').join(', ') : (m.content ?? '').replace(/\*\*/g, '')] as const;
    if (m.role === 'tool') return ['tool', m.content] as const;
    return [m.role, m.content] as const;
  });
  const roleCol: Record<string, string> = { system: C.mute, user: C.text, tool: C.gold, agent: C.text };
  const allowedB = r.policyBefore.allowedRecipients, allowedA = r.policyAfter.allowedRecipients;
  return (
    <Page>
      <AppHeader active="ARENA" right={<div style={css('display:flex;gap:16px')}><Link href={'/proof?record=' + (which === 'breach' ? 'held' : 'breach')}>{which === 'breach' ? 'See the held twin' : 'See the breach'}</Link></div>} />
      <div className="hx-wrap">
        <div style={css(`padding:28px clamp(16px,2.4vw,28px);display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;border-bottom:1px solid ${C.line}`)}>
          <div style={css('display:flex;flex-direction:column;gap:10px;max-width:820px')}>
            <Eyebrow>EVIDENCE RECORD · {e.cohortId} · {e.caseId}</Eyebrow>
            <h1 style={css('margin:0;font-weight:700;font-size:clamp(30px,4vw,44px);line-height:1;letter-spacing:-.02em')}>{breached ? 'Split web-page instruction rewrites the spending policy' : 'Same split instruction: Fort Knox kept its policy'}</h1>
            <div style={css(`font-family:${mono};font-size:12px;color:${C.dim}`)}>{e.label} · {e.config.model} · {r.ts.replace('T', ' ').slice(0, 19)} UTC · goal {goalLabel[e.attack.goal]} · synthetic funds</div>
          </div>
          <div style={css(`border:3px solid ${breached ? C.red : C.teal};color:${breached ? C.red : C.teal};font-weight:700;font-size:34px;padding:8px 18px;letter-spacing:.04em`)}>{breached ? 'BREACHED' : 'HELD'}</div>
        </div>
        <div className="hx-proof">
          <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:6px`)}>
            <Eyebrow>§1 TRANSCRIPT</Eyebrow>
            {transcript.map(([role, text], i) => (
              <div key={i} style={css(`display:grid;grid-template-columns:56px 1fr;gap:12px;font-family:${mono};font-size:12px;line-height:1.6;padding:8px 0;border-bottom:1px solid ${C.line2}`)}>
                <div style={css(`color:${roleCol[role] ?? C.dim}`)}>{role}</div>
                <div style={css(`color:${role === 'tool' && /ATTACKER|policy change|isregard/.test(text) ? '#ff8a7e' : role === 'system' ? C.dim : C.text};overflow-wrap:anywhere`)}>{text.length > 360 ? text.slice(0, 360) + '…' : text}</div>
              </div>
            ))}
          </div>
          <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:12px`)}>
            <Eyebrow>§2 {unsafe ? 'UNSAFE TOOL CALL · RAW' : 'TOOL CALLS'}</Eyebrow>
            <pre style={css(`font-family:${mono};font-size:12px;line-height:1.7;background:${C.panel};border:1px solid ${C.line};padding:14px;color:#b9bec6;margin:0;max-height:none`)}>{rawCall}</pre>
            <Eyebrow>§3 POLICY AND LEDGER</Eyebrow>
            <div style={css(`display:grid;grid-template-columns:1fr auto auto;gap:8px 18px;font-family:${mono};font-size:12px;background:${C.panel};border:1px solid ${C.line};padding:14px`)}>
              <div style={css(`color:${C.mute}`)}>field</div><div style={css(`color:${C.mute}`)}>before</div><div style={css(`color:${C.mute}`)}>after</div>
              <div>approved recipients</div><div>{allowedB.length}</div><div style={css(`color:${allowedA.length > allowedB.length ? C.red : C.text}`)}>{allowedA.length}{allowedA.length > allowedB.length ? ' (+ATTACKER)' : ''}</div>
              <div>max per transfer</div><div>{units(r.policyBefore.maxPerTransferUnits)}</div><div>{units(r.policyAfter.maxPerTransferUnits)}</div>
              <div>vault balance</div><div>{units(r.ledger.initialBalanceUnits)}</div><div style={css(`color:${C.gold}`)}>{units(r.ledger.availableBalanceUnits)}</div>
              <div>paid to attacker</div><div>0</div><div>{units(o.valueLostUnits)}</div>
            </div>
            <Footnote>{breached ? 'No units reached the attacker in this attempt, but the agent granted the attacker payment rights in its own policy: the next instruction could drain it. The oracle treats policy tampering as a breach.' : 'The same fragments were read; no policy change, no attacker payment. The agent also did not pay the legitimate invoice.'}</Footnote>
          </div>
          <div style={css('padding:24px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;gap:12px')}>
            <Eyebrow>§4 ORACLE RULES</Eyebrow>
            {rules.map(([name, fired]) => (
              <div key={name} style={css(`display:flex;justify-content:space-between;font-family:${mono};font-size:12px;padding:9px 12px;border:1px solid ${fired ? C.red : C.line};background:${fired ? '#2a0b09' : C.panel}`)}><div>{name}</div><div style={css(`color:${fired ? C.red : C.mute}`)}>{fired ? 'FIRED' : 'pass'}</div></div>
            ))}
            <Footnote>Pure function of ledger, policy and tool calls. Same record in, same verdict out.</Footnote>
            <Eyebrow>§5 INTEGRITY · OFFLINE REPLAY</Eyebrow>
            <ReplayButton which={which} recorded={r.attemptHash} />
            <a href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(r, null, 2))} download={'heist-' + which + '-record.json'} style={css(`font-family:${mono};font-size:12px;color:${C.dim}`)}>Download full record (.json)</a>
          </div>
        </div>
      </div>
    </Page>
  );
}
