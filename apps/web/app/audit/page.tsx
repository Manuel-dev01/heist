import { AuditPreview } from '../../components/audit-preview';
import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { PolicyAudit } from '../../components/policy-audit';
import { C, css } from '../../lib/css';
import { channelLabel, evidence, goalLabel } from '../../lib/evidence';

export const metadata = { title: 'Audit · HEIST' };

export default function AuditPage() {
  const ex = evidence.exploits[0]!;
  return (
    <Page>
      <AppHeader active="AUDIT" right={<div style={css(`border:1px solid ${C.teal};padding:5px 8px;color:${C.teal}`)}>LIVE · DETERMINISTIC · NO KEYS</div>} />
      <div className="hx-wrap">
        <div style={css('padding:32px clamp(16px,2.4vw,28px) 24px;display:flex;flex-direction:column;gap:10px;max-width:880px')}>
          <Eyebrow color={C.teal}>AUDIT · HARDEN · RE-TEST</Eyebrow>
          <h1 style={css('margin:0;font-weight:700;font-size:clamp(32px,4.4vw,48px);line-height:.95;letter-spacing:-.03em')}>Assume the model is fooled. See what your wallet lets through.</h1>
          <div style={css(`font-size:15px;color:${C.dim};line-height:1.5`)}>Describe how your agent spends money. HEIST fires all {evidence.totals.corpusAttacks.toLocaleString('en-US')} attacks from its frozen corpus at a worst-case agent that obeys every injection, executes each one through HEIST&apos;s own ledger and breach rules, and shows what gets out, which fix closes it, and the result re-tested on the spot.</div>
        </div>
        <PolicyAudit goals={goalLabel} channels={channelLabel} />
        <div style={css(`padding:36px clamp(16px,2.4vw,28px) 18px;display:flex;flex-direction:column;gap:8px;max-width:880px;border-top:1px solid ${C.line}`)}>
          <Eyebrow color={C.gold}>THE MODEL LAYER · MEASURED LIVE</Eyebrow>
          <div style={css(`font-size:15px;color:${C.dim};line-height:1.5`)}>The audit above deliberately assumes the worst model. How often a real model is actually fooled was measured live on the same corpus: toggle a defense to see its measured result.</div>
        </div>
        <AuditPreview arms={evidence.arms} breachHash={evidence.breach.record.attemptHash} exploit={{ id: ex.id, channel: channelLabel[ex.channel] ?? ex.channel, goal: goalLabel[ex.goal] ?? ex.goal }} />
        <div style={css('padding:28px clamp(16px,2.4vw,28px);max-width:720px')}>
          <Footnote>The configuration audit is free, runs instantly and needs no keys. It scores the setup you describe, so it is self-reported: it cannot see whether your code really enforces each check. Planned next: model-in-the-loop audits of your own agent endpoint, paid over Kite x402, with the report hash anchored on Kite.</Footnote>
        </div>
      </div>
    </Page>
  );
}
