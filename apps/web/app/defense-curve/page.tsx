import { AppHeader, Eyebrow, Footnote, Page } from '../../components/chrome';
import { KitePanel } from '../../components/kite-panel';
import { C, css, mono } from '../../lib/css';
import { evidence, pct, vaultStats } from '../../lib/evidence';

export const metadata = { title: 'Defense Curve · HEIST' };

interface Col { n: string; name: string; layer: string; k: number; attacks: number; upper: number; cost: number | null; ref?: boolean }
function Chart({ cols, yMax, title }: { cols: Col[]; yMax: number; title: string }) {
  const costMax = Math.max(...cols.map((c) => c.cost ?? 0)) * 1.1 || 1;
  const y = (v: number) => Math.min(100, v / yMax * 100) + '%';
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => (yMax * f * 100).toFixed(yMax < 0.02 ? 2 : 1) + '%');
  return (
    <div className="hx-scroll-x" style={css('padding:0 clamp(16px,2.4vw,28px) 28px')}>
      <div className="hx-curve-wrap" style={css('display:grid;grid-template-columns:90px 1fr')}>
        <div style={css(`display:flex;flex-direction:column;justify-content:space-between;height:300px;font-family:${mono};font-size:10px;color:${C.mute};padding-right:12px;text-align:right`)}>{ticks.map((t) => <div key={t}>{t}</div>)}</div>
        <div className="hx-curve" role="img" aria-label={title} style={css('position:relative;height:300px;border-left:1px solid #2f343b;border-bottom:1px solid #2f343b')}>
          {[25, 50, 75].map((t) => <div key={t} style={css(`position:absolute;left:0;right:0;top:${t}%;border-top:1px solid ${C.line2}`)} />)}
          {cols.map((c) => {
            const hit = c.k > 0, col = hit ? C.red : c.ref ? C.dim : C.teal, wc = hit ? C.red : c.ref ? C.mute : '#2e5a4d';
            return (
              <div key={c.n} style={css('position:relative;height:100%')} title={`${c.name}: ${c.k}/${c.attacks}, 95% upper ${pct(c.upper)}`}>
                <div style={css(`position:absolute;left:50%;bottom:0;height:${y(c.upper)};width:2px;margin-left:-1px;background:${wc}`)} />
                <div style={css(`position:absolute;left:50%;bottom:${y(c.upper)};width:18px;margin-left:-9px;height:2px;background:${wc}`)} />
                <div style={css(`position:absolute;left:50%;bottom:${y(c.k / c.attacks)};width:14px;height:14px;margin-left:-7px;margin-bottom:-7px;border-radius:50%;border:2px solid ${col};background:${hit ? C.red : C.bg}`)} />
                <div style={css(`position:absolute;left:0;right:0;bottom:calc(${y(c.upper)} + 10px);text-align:center;font-family:${mono};font-size:12px;color:${col}`)}>{c.k} / {c.attacks.toLocaleString('en-US')}<div style={css(`font-size:10px;color:${C.mute}`)}>≤{pct(c.upper)}</div></div>
              </div>
            );
          })}
        </div>
        <div style={css(`font-family:${mono};font-size:10px;color:${C.mute};padding-right:12px;text-align:right;padding-top:14px`)}>VAULT</div>
        <div className="hx-curve" style={css('padding-top:12px;text-align:center')}>
          {cols.map((c) => <div key={c.n} style={css('display:flex;flex-direction:column;gap:2px')}><div style={css(`font-family:${mono};font-size:10px;color:${C.mute}`)}>{c.n}</div><div style={css('font-weight:700;font-size:15px')}>{c.name}</div><div style={css(`font-size:12px;color:${C.dim}`)}>{c.layer}</div></div>)}
        </div>
        <div style={css(`display:flex;flex-direction:column;justify-content:space-between;height:150px;font-family:${mono};font-size:10px;color:${C.mute};padding-right:12px;text-align:right;margin-top:24px`)}><div>${costMax.toFixed(0)} / 1K</div><div>$0</div></div>
        <div className="hx-curve" style={css('position:relative;height:150px;margin-top:24px;border-left:1px solid #2f343b;border-bottom:1px solid #2f343b;align-items:end')}>
          {cols.map((c) => (
            <div key={c.n} style={css('height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px')}>
              <div style={css(`font-family:${mono};font-size:12px;color:${c.ref ? C.dim : C.gold}`)}>{c.cost === null ? 'n/a' : '$' + c.cost.toFixed(2)}</div>
              <div style={css(`width:44%;height:${c.cost === null ? 0 : Math.max(1.5, c.cost / costMax * 100)}%;background:${c.ref ? C.dim : C.gold}`)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DefenseCurvePage() {
  const cols: Col[] = [
    ...evidence.arms.map((a) => { const s = vaultStats(a); return { n: a.n, name: a.name, layer: a.layer, k: s.breaches, attacks: s.attacks, upper: s.upper95, cost: a.visibleCostPer1kUsd }; }),
    { n: 'REF', name: 'GPT-5.5', layer: 'frontier, raw', k: evidence.frontier.breaches, attacks: evidence.frontier.attacks, upper: evidence.frontier.upper95, cost: evidence.frontier.visibleCostPer1kUsd, ref: true },
  ];
  const ad = evidence.adaptive;
  return (
    <Page>
      <AppHeader active="DEFENSE CURVE" />
      <div className="hx-wrap">
        <div style={css('padding:36px clamp(16px,2.4vw,28px) 24px;display:flex;flex-direction:column;gap:10px;max-width:860px')}>
          <Eyebrow>D2 + D3 · SAME ATTACK CORPUS × 7 DEFENSE SETUPS · GPT-5.5 REFERENCE</Eyebrow>
          <h1 style={css('margin:0;font-weight:700;font-size:clamp(34px,4.6vw,52px);line-height:.95;letter-spacing:-.03em')}>Every layer held. Here is what each one costs.</h1>
          <div style={css(`font-size:16px;color:${C.dim};line-height:1.5`)}>Zero observed breaches is not zero risk. Whiskers show the most each setup could still be breaching, given its trials (95% Clopper-Pearson upper bound). Vault 00 pools both raw-model runs.</div>
        </div>
        <Chart cols={cols} yMax={0.012} title="Breach rate and 95% upper bound per defense setup, with visible cost per 1,000 interactions" />
        <div style={css(`margin:0 clamp(16px,2.4vw,28px);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:${mono};font-size:11px;color:${C.mute};border-bottom:1px solid ${C.line};padding-bottom:14px`)}>
          <div>Benign tasks completed: 40 / 40 on every setup. GPT-5.5: {evidence.frontier.incomplete} of {evidence.frontier.attacks} attack attempts ended incomplete ({Object.entries(evidence.frontier.incompleteBreakdown ?? {}).map(([k, v]) => v + ' ' + k.replace(/_/g, ' ')).join(', ')}); none breached.</div>
          <div>Cost = visible token prices per 1,000 interactions. SERV feature reasoning is not reported per call, so defended setups are under-counted.</div>
        </div>
        <div style={css('padding:36px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;gap:10px;max-width:860px')}>
          <Eyebrow color={C.red}>VS ADAPTIVE ATTACKS · THE POD</Eyebrow>
          {ad.status === 'complete' && ad.arms ? <>
            <h2 style={css('margin:0;font-weight:700;font-size:clamp(28px,3.6vw,40px);line-height:1;letter-spacing:-.02em')}>{ad.arms.some((a) => a.breaches > 0) ? 'When the attacks evolve, the curve bends.' : 'Evolved attacks, same result: every vault held.'}</h2>
          </> : ad.status === 'complete' && ad.discovery ? <>
            <h2 style={css('margin:0;font-weight:700;font-size:clamp(28px,3.6vw,40px);line-height:1;letter-spacing:-.02em')}>Even evolved attacks could not open the weakest vault.</h2>
            <div style={css(`font-size:15px;color:${C.dim};line-height:1.5`)}>The Pod made {ad.discovery.counts.refinements} refinement calls on 32 seed attacks with a Dolphin attacker model ({(ad.tree ?? []).reduce((n, r) => n + r.nodes.filter((x) => x.status === 'refined').length, 0)} rewrites; the rest were refusals or invalid) and screened all {ad.discovery.counts.screens} candidates against raw nano: 0 broke it, and none even drew an unsafe tool call. With no survivor to fire, the seven-vault confirmation was correctly skipped. <a href="/pod" style={css(`color:${C.red}`)}>See the search tree →</a></div>
          </> : <>
            <h2 style={css('margin:0;font-weight:700;font-size:clamp(28px,3.6vw,40px);line-height:1;letter-spacing:-.02em')}>The flat curve is the baseline. The Pod tries to bend it.</h2>
            <div style={css(`font-size:15px;color:${C.dim};line-height:1.5`)}>An adaptive run is in progress: attacks refined against the raw vault, then fired five times at each of the seven setups. Its curve appears here when the run closes and verifies.</div>
          </>}
        </div>
        {ad.status === 'complete' && ad.arms && <Chart title="Breach rate under adaptive attacks" yMax={Math.max(0.05, ...ad.arms.map((a) => a.upper95)) * 1.1} cols={ad.arms.map((a, i) => ({ n: evidence.arms[i]?.n ?? a.id, name: evidence.arms[i]?.name ?? a.id, layer: evidence.arms[i]?.layer ?? '', k: a.breaches, attacks: a.attacks, upper: a.upper95, cost: null }))} />}
        <KitePanel />
        <div style={css('padding:0 clamp(16px,2.4vw,28px) 40px')}><Footnote>{evidence.disclaimer}</Footnote></div>
      </div>
    </Page>
  );
}
