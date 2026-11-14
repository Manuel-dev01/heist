import Link from 'next/link';
import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { KitePanel } from '../../components/kite-panel';
import { C, css, mono } from '../../lib/css';
import { evidence, pct, vaultStats } from '../../lib/evidence';

export const metadata = { title: 'Arena · HEIST' };
const LAYERS = ['SERV', 'GUARD', 'KRONOS', 'MULTIPATH', 'SHADOW', 'POLICY'];

export default function ArenaPage() {
  const ex = evidence.exploits[0]!;
  // Data-bound: each row is that run's real recorded outcome for this exact attack case.
  const vaultOf = (id: string) => evidence.arms.find((a) => a.id === id);
  const verdict = (r: { breached: boolean; outcomes: string[] }) => r.breached ? ['BREACHED', C.red] as const : r.outcomes.includes('error') ? ['INCOMPLETE · NO BREACH', C.gold] as const : r.outcomes.includes('benign_ok') ? ['HELD · INVOICE PAID', C.teal] as const : ['HELD · TASK NOT DONE', C.teal] as const;
  const sameAttack = evidence.sameAttack.rows.map((r) => { const v = vaultOf(r.armId); return { run: r.run, vault: v ? 'Vault ' + v.n + ' · ' + v.name : 'GPT-5.5', layer: r.run === 'D2' ? 'raw nano, first run' : v ? v.layer : 'frontier reference', v: verdict(r) }; });
  return (
    <Page>
      <AppHeader active="ARENA" />
      <div className="hx-wrap">
        <div style={css('padding:40px clamp(16px,2.4vw,28px) 28px;display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap')}>
          <div style={css('display:flex;flex-direction:column;gap:10px')}>
            <Eyebrow>PRACTICE RANGE · WEAKEST → STRONGEST</Eyebrow>
            <h1 style={css('margin:0;font-weight:700;font-size:clamp(36px,5vw,56px);line-height:.95;letter-spacing:-.03em')}>Seven vaults. One has been robbed.</h1>
          </div>
          <div style={css(`display:flex;gap:28px;font-family:${mono}`)}>
            <div><div style={css('font-size:26px')}>{evidence.totals.attempts.toLocaleString('en-US')}</div><div style={css(`font-size:10px;letter-spacing:.14em;color:${C.mute}`)}>RECORDED ATTEMPTS</div></div>
            <div><div style={css(`font-size:26px;color:${C.red}`)}>{evidence.totals.breaches}</div><div style={css(`font-size:10px;letter-spacing:.14em;color:${C.mute}`)}>BREACH</div></div>
            <div><div style={css(`font-size:26px;color:${C.gold}`)}>40 / 40</div><div style={css(`font-size:10px;letter-spacing:.14em;color:${C.mute}`)}>BENIGN TASKS, EVERY VAULT</div></div>
          </div>
        </div>
        <div className="hx-vaults">
          {evidence.arms.map((a, i) => {
            const s = vaultStats(a), hit = s.breaches > 0, col = hit ? C.red : C.teal;
            return (
              <div key={a.id} className="hx-vault-card" style={css(`background:${hit ? '#140807' : C.panel};border:1px solid ${hit ? '#5a1d18' : C.line};border-radius:20px;padding:18px 16px;display:flex;flex-direction:column;gap:16px;min-height:400px`)}>
                <div style={css(`display:flex;justify-content:space-between;font-family:${mono};font-size:11px;color:${C.mute}`)}><div>VAULT {a.n}</div><div style={css(`color:${col}`)}>{hit ? 'ROBBED' : 'HELD'}</div></div>
                <div><div style={css('font-weight:700;font-size:24px;line-height:1')}>{a.name}</div><div style={css(`font-size:13px;color:${C.dim};margin-top:4px`)}>{a.layer}</div></div>
                <div className="hx-slots" style={css('display:flex;flex-direction:column-reverse;gap:3px')}>
                  {LAYERS.map((l, k) => { const on = k < i; return <div key={l} style={css(`height:18px;border-radius:6px;border:1px solid ${on ? '#2e5a4d' : '#1c1f24'};background:${on ? '#0f2621' : 'transparent'};font-family:${mono};font-size:9px;letter-spacing:.08em;color:${C.teal};display:flex;align-items:center;padding:0 6px`)}>{on ? l : ''}</div>; })}
                </div>
                <div style={css(`margin-top:auto;display:flex;flex-direction:column;gap:8px;font-family:${mono};font-size:11px`)}>
                  <div style={css('display:flex;justify-content:space-between')}><div style={css(`color:${C.mute}`)}>ATTACKS</div><div>{s.attacks.toLocaleString('en-US')}</div></div>
                  <div style={css('display:flex;justify-content:space-between')}><div style={css(`color:${C.mute}`)}>BREACHED</div><div style={css(`color:${col}`)}>{s.breaches} / {s.attacks.toLocaleString('en-US')}</div></div>
                  <div style={css('display:flex;justify-content:space-between')}><div style={css(`color:${C.mute}`)}>95% UPPER</div><div>≤{pct(s.upper95)}</div></div>
                  <div style={css('display:flex;justify-content:space-between')}><div style={css(`color:${C.mute}`)}>BENIGN OK</div><div>{a.benignOk} / {a.benign}</div></div>
                </div>
                <Link href={'/arena/attempt?vault=' + a.n} style={css(`background:${hit ? C.red : 'transparent'};color:${hit ? C.bg : C.text};border:1px solid ${col};text-align:center;padding:11px 6px;font-weight:700;font-size:13px;white-space:nowrap`)}>{hit ? 'Watch the breach' : a.id === 'guard-kronos-multipath-shadow-enforced' ? 'Watch it hold' : 'See Fort Knox hold'}</Link>
              </div>
            );
          })}
        </div>
        <KitePanel />
        <div style={css('padding:24px clamp(16px,2.4vw,28px) 40px;display:flex;flex-direction:column;gap:14px')}>
          <Eyebrow>THE SAME ATTACK, AGAINST EVERY VAULT · {ex.id} · {ex.channel === 'browse' ? 'web page' : ex.channel} · policy tampering</Eyebrow>
          <div style={css(`display:flex;flex-direction:column;font-family:${mono};font-size:12px`)}>
            {sameAttack.map(({ run, vault, layer, v }) => (
              <div key={run + vault} className="hx-same-row" style={css(`display:grid;grid-template-columns:60px 1fr 1fr 190px;gap:16px;padding:9px 0;border-bottom:1px solid ${C.line2}`)}>
                <div style={css(`color:${C.mute}`)}>{run}</div><div>{vault}</div><div style={css(`color:${C.dim}`)}>{layer}</div><div style={css(`text-align:right;color:${v[1]}`)}>{v[0]}</div>
              </div>
            ))}
          </div>
          <Footnote>Vault 00 combines both raw runs: D2 (all 1,000 attacks) and the D3 raw arm (the same 500-attack subset). The breach did not reproduce when the identical attack ran again on raw nano in D3. Live paid attempts over x402 are planned; this range replays recorded evidence. {evidence.disclaimer}</Footnote>
        </div>
      </div>
    </Page>
  );
}
