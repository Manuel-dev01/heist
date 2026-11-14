import { C, css, mono } from '../lib/css';
import { evidence } from '../lib/evidence';
import { Eyebrow, Footnote } from './chrome';

/** V6: the last line of defense. Real Kite Passport refusals recorded in live mode against a deliberately empty wallet. */
export function KitePanel() {
  const k = evidence.kite;
  if (!k) return null;
  return (
    <section style={css(`padding:32px clamp(16px,2.4vw,28px);border-top:1px solid ${C.line};display:flex;flex-direction:column;gap:16px`)}>
      <Eyebrow color={C.gold}>VAULT 07 · LAST LINE OF DEFENSE · KITE PASSPORT SPENDING CAPS · LIVE</Eyebrow>
      <h2 style={css('margin:0;font-weight:700;font-size:clamp(28px,3.6vw,40px);line-height:1;letter-spacing:-.02em;max-width:900px')}>Even a breached agent hits the wallet&apos;s wall.</h2>
      <div style={css(`font-size:15px;color:${C.dim};line-height:1.5;max-width:860px`)}>The vault agent pays through a Kite Passport session its owner approved by passkey, with hard caps. Kite, not the model, decides whether money moves. Both refusals below are Kite&apos;s own error codes from its live backend.</div>
      <div className="hx-cols-2" style={css('gap:2px;background:#23272d')}>
        {k.refusals.map((r) => (
          <div key={r.code} style={css(`background:${C.panel};padding:20px;display:flex;flex-direction:column;gap:12px`)}>
            <div style={css(`display:flex;justify-content:space-between;gap:12px;font-family:${mono};font-size:11px;letter-spacing:.12em;color:${C.mute}`)}><div>{r.at.replace('T', ' ').slice(0, 19)} UTC</div><div style={css(`color:${C.teal}`)}>$0 MOVED</div></div>
            <div style={css(`font-weight:700;font-size:clamp(34px,4vw,48px);line-height:.9;letter-spacing:-.03em;color:${C.teal}`)}>REFUSED</div>
            <div style={css(`font-family:${mono};font-size:13px;color:${C.red}`)}>{r.code}{r.reason ? ' · ' + r.reason : ''}</div>
            <div style={css('font-size:15px;line-height:1.45')}>{r.request}</div>
            <div style={css(`font-family:${mono};font-size:12px;line-height:1.7;color:${C.dim};background:${C.bg};border:1px solid ${C.line2};padding:10px`)}>
              session caps {r.session.caps.max_amount_per_tx} / payment · {r.session.caps.max_total_amount} total<br />approved by {r.session.approvedBy} · spent {r.session.spent}<br />kite: &quot;{r.message}&quot;
            </div>
          </div>
        ))}
      </div>
      <Footnote>Recorded in Kite&apos;s LIVE mode (its sandbox is not available for this account) with a Passport wallet holding $0 before and after, so nothing could move either way. Agent identity: {k.agentType}. The total-budget cap (session_total_exceeded) needs a funded wallet and has not been exercised yet.</Footnote>
    </section>
  );
}
