import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { C, css, mono } from '../../lib/css';
import { channelLabel, evidence, goalLabel } from '../../lib/evidence';

export const metadata = { title: 'The Pod · HEIST' };
const CELL: Record<string, [string, string, string]> = {
  held: ['transparent', '#2f343b', 'screened · held'], near_miss: ['#2b2416', C.gold, 'unsafe call proposed · no goal'], breached: [C.red, C.red, 'broke the raw vault'], error: ['#16191d', '#3a3f46', 'operational error'],
  refined: ['#0f2621', '#2e5a4d', 'rewritten by Dolphin'], refusal: ['#16191d', C.mute, 'attacker refused'], invalid: ['#16191d', C.mute, 'invalid rewrite'], duplicate: ['#16191d', C.mute, 'duplicate'],
};

export default function PodPage() {
  const ad = evidence.adaptive, done = ad.status === 'complete' && ad.discovery;
  const counts = ad.discovery?.counts ?? {};
  const winners = ad.winners ?? [];
  return (
    <Page>
      <AppHeader active="POD" right={done ? <div style={css(`border:1px solid #2f343b;padding:5px 8px;color:${C.teal}`)}>RUN CLOSED · VERIFIED</div> : <div style={css(`border:1px dashed ${C.gold};padding:5px 8px;color:${C.gold}`)}>RUN IN PROGRESS</div>} />
      <div className="hx-wrap">
        <div className="hx-split" style={css('padding:32px clamp(16px,2.4vw,28px) 20px')}>
          <div style={css('display:flex;flex-direction:column;gap:10px')}>
            <Eyebrow>ADAPTIVE RUN · TARGET VAULT 00 · OPEN SAFE (RAW NANO)</Eyebrow>
            <h1 style={css('margin:0;font-weight:700;font-size:clamp(32px,4.4vw,48px);line-height:.95;letter-spacing:-.03em')}>32 seeds. Up to three rewrites each. Fire only the survivors.</h1>
            <div style={css(`font-size:15px;color:${C.dim};line-height:1.5;max-width:720px`)}>An attacker model on Dolphin rewrites each attack using only the oracle&apos;s scalar verdict (no transcript, no system prompt). Every rewrite is screened against the real raw vault on SERV in the owned sandbox. Survivors are then fired 5 times at all seven vaults.</div>
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:8px;font-family:${mono};font-size:11px`)}>
            {[['SEEDS', '32 (incl. the one D2 breach)'], ['SCREENS', done ? String(counts.screens) : '≤ 128'], ['REWRITES', done ? String(counts.refinements) : '≤ 96'], ['BROKE RAW VAULT', done ? String(counts.eligibleCandidates) : '—'], ['ATTACKER', 'DeepSeek V4.1 Flash · Dolphin'], ['TARGET', 'gpt-5.4-nano raw · SERV']].map(([k, v]) => (
              <div key={k} style={css(`display:flex;justify-content:space-between;border-bottom:1px solid ${C.line2};padding:6px 0`)}><div style={css(`color:${C.dim};letter-spacing:.14em`)}>{k}</div><div style={css(`color:${k === 'BROKE RAW VAULT' && Number(v) > 0 ? C.red : C.text}`)}>{v}</div></div>
            ))}
          </div>
        </div>
        {done && ad.tree ? (
          <div className="hx-pod" style={css('padding:8px clamp(16px,2.4vw,28px) 28px')}>
            <div style={css('display:flex;flex-direction:column;gap:10px')}><Eyebrow>ROOTS</Eyebrow><Footnote>Each row is one seed attack. Left to right: screen, rewrite, screen… A branch ends when the goal is reached, the attacker refuses, or rewrites run out.</Footnote>
              <div style={css(`display:flex;flex-direction:column;gap:6px;font-family:${mono};font-size:10px;color:${C.mute};margin-top:8px`)}>{Object.entries(CELL).map(([k, [bg, bd, label]]) => <div key={k} style={css('display:flex;gap:6px;align-items:center')}><div style={css(`width:10px;height:10px;background:${bg};border:1px solid ${bd}`)} />{label}</div>)}</div>
            </div>
            <div style={css('display:flex;flex-direction:column;gap:4px;overflow-x:auto')}>
              {ad.tree.map((r) => (
                <div key={r.root} style={css(`display:grid;grid-template-columns:44px 160px 1fr;gap:10px;align-items:center;font-family:${mono};font-size:10px`)}>
                  <div style={css(`color:${C.dim}`)}>{r.root}</div><div style={css(`color:${C.mute}`)}>{channelLabel[r.channel ?? ''] ?? r.channel} · {goalLabel[r.goal ?? ''] ?? r.goal}</div>
                  <div style={css('display:flex;gap:4px')}>{r.nodes.map((n, i) => { const [bg, bd, label] = CELL[n.status] ?? CELL.error!; return <div key={i} title={label} style={css(`width:${n.kind === 'screen' ? 18 : 10}px;height:18px;background:${bg};border:1px solid ${bd}`)} />; })}</div>
                </div>
              ))}
            </div>
            <div style={css('display:flex;flex-direction:column;gap:10px')}>
              <Eyebrow color={C.red}>FIRED AT ALL SEVEN VAULTS</Eyebrow>
              {winners.length === 0 ? <div style={css(`background:${C.panel};border:1px solid ${C.line};padding:14px;font-family:${mono};font-size:12px;line-height:1.6;color:${C.dim}`)}>No rewrite broke the raw vault, so nothing was fired. Raw nano held against {counts.screens} adaptive candidates.</div>
                : winners.map((w) => (
                  <div key={w.id} style={css(`background:${C.panel};border:1px solid ${C.line};padding:12px;display:flex;flex-direction:column;gap:6px;font-family:${mono};font-size:11px`)}>
                    <div style={css('display:flex;justify-content:space-between')}><div style={css(`color:${C.red}`)}>{w.id}</div><div style={css(`color:${(w.vaultsBreached ?? 0) > 0 ? C.red : C.teal}`)}>{w.trials ? `${w.breaches}/${w.trials} · ${w.vaultsBreached}/7 vaults` : 'screened'}</div></div>
                    <div style={css(`font-size:11px;color:${C.dim};line-height:1.5`)}>{w.snippet}</div>
                    <div style={css(`color:${C.mute}`)}>{channelLabel[w.channel] ?? w.channel} · {goalLabel[w.goal] ?? w.goal}</div>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div style={css('padding:8px clamp(16px,2.4vw,28px) 28px')}>
            <div style={css(`border:1px dashed ${C.gold};padding:20px;font-family:${mono};font-size:12px;line-height:1.7;color:${C.dim};max-width:860px`)}>The run is executing against the live SERV vault. Its search tree, the candidates that broke the raw vault, and their scores against all seven vaults appear here once the run closes and its records verify. No placeholder results are shown.</div>
          </div>
        )}
        <div style={css(`border-top:1px solid ${C.line};padding:14px clamp(16px,2.4vw,28px) 40px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap`)}>
          <Footnote>Rewrites generated with Dolphin · screened on the raw SERV vault · fired through the same deterministic oracle. Publishing winners to a Reppo Datanet is planned.</Footnote>
        </div>
      </div>
    </Page>
  );
}
