import { AuditPreview } from '../../components/audit-preview';
import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { C, css, mono } from '../../lib/css';
import { channelLabel, evidence, goalLabel } from '../../lib/evidence';

export const metadata = { title: 'Audit · HEIST' };

export default function AuditPage() {
  const cfg = evidence.breach.config, fk = evidence.arms.find((a) => a.id === 'guard-kronos-multipath-shadow-enforced')!;
  const manifest = JSON.stringify({ name: 'heist-reference-vault', model: cfg.model, mode: 'SERV raw', tools: ['browse', 'read_inbox', 'pay_x402', 'transfer', 'release_funds', 'update_policy'],
    policy: evidence.breach.record.policyBefore, maxRounds: cfg.maxRounds, maxOutputTokens: cfg.maxOutputTokens }, null, 2);
  const ex = evidence.exploits[0]!;
  return (
    <Page>
      <AppHeader active="AUDIT" right={<div style={css(`border:1px dashed ${C.gold};padding:5px 8px;color:${C.gold}`)}>PREVIEW · HOSTED AUDITS PLANNED</div>} />
      <div className="hx-wrap">
        <div style={css('padding:32px clamp(16px,2.4vw,28px) 24px;display:flex;flex-direction:column;gap:10px;max-width:860px')}>
          <Eyebrow color={C.teal}>AUDIT · HARDEN · CERTIFY</Eyebrow>
          <h1 style={css('margin:0;font-weight:700;font-size:clamp(32px,4.4vw,48px);line-height:.95;letter-spacing:-.03em')}>Earn the badge before you raise the limit.</h1>
          <div style={css(`font-size:15px;color:${C.dim};line-height:1.5`)}>The audit runs the same corpus, oracle and replayable records against a replica of your agent. This preview shows the flow on HEIST&apos;s own reference vault, with its measured results.</div>
        </div>
        <AuditPreview arms={evidence.arms} breachHash={evidence.breach.record.attemptHash} manifest={manifest} exploit={{ id: ex.id, channel: channelLabel[ex.channel] ?? ex.channel, goal: goalLabel[ex.goal] ?? ex.goal }} />
        <div style={css('padding:32px clamp(16px,2.4vw,28px);display:flex;gap:32px;flex-wrap:wrap;align-items:center')}>
          <div style={css(`width:300px;border:1px solid ${C.teal};padding:22px;display:flex;flex-direction:column;gap:10px;font-family:${mono};background:#0c1714`)}>
            <div style={css(`font-size:11px;letter-spacing:.2em;color:${C.teal}`)}>HEIST · MEASURED</div>
            <div style={css("font-family:'Familjen Grotesk',sans-serif;font-weight:700;font-size:28px;line-height:1")}>Fort Knox</div>
            <div style={css(`font-size:12px;color:${C.dim};line-height:1.6`)}>{fk.layer} · gpt-5.4-nano<br />{fk.breaches} / {fk.attacks} breaches · benign {fk.benignOk}/{fk.benign}<br />report {evidence.sources.d3ReportHash?.slice(0, 12)}…</div>
            <div style={css(`font-size:10px;color:${C.mute}`)}>SAMPLE · reference vault, not a customer certificate</div>
          </div>
          <div style={css('max-width:520px')}><Footnote>Planned: paid audits over Kite x402, re-tests after hardening, and the report hash anchored on Kite with an embeddable badge. Nothing on this page is a customer result.</Footnote></div>
        </div>
      </div>
    </Page>
  );
}
