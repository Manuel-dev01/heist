'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { C, css, mono } from '../lib/css';
import { LiveClock, useTick } from './chrome';

export interface AttemptSide {
  key: 'breach' | 'held'; vault: string; layer: string; run: string; channel: string; channelLabel: string; goal: string; payload: string; debitUnits: string; lostUnits: string;
  calls: { round: number; tool: string; args: string; status: string; unsafe: boolean }[];
  allowedBefore: string[]; allowedAfter: string[]; balanceBefore: string; balanceAfter: string; finalAnswer: string;
  breached: boolean; rules: [string, boolean][]; attemptHash: string; ts: string; latencyMs: number; recordJson: string;
}
const n = (s: string) => Number(s).toLocaleString('en-US');

export function AttemptView({ breach, held, start }: { breach: AttemptSide; held: AttemptSide; start: 'breach' | 'held' }) {
  const [auto, setAuto] = useState(true), [isBreach, setIsBreach] = useState(start === 'breach');
  const tick = useTick(700);
  useEffect(() => { if (auto && tick > 0 && tick % 6 === 0) setIsBreach((b) => !b); }, [tick, auto]);
  const s = isBreach ? breach : held, bOp = isBreach ? 1 : 0, hOp = isBreach ? 0 : 1;
  const download = useMemo(() => 'data:application/json;charset=utf-8,' + encodeURIComponent(s.recordJson), [s.recordJson]);
  const coins = (() => { const init = Number(s.balanceBefore) || 1, paid = Math.round(Number(s.debitUnits) / init * 20), lost = Math.round(Number(s.lostUnits) / init * 20); return Array.from({ length: 20 }, (_, i) => ({ col: i >= 20 - lost ? C.red : i >= 20 - lost - paid ? '#3a3f46' : C.gold, d: (19 - i) * 0.03 + 's' })); })();
  return (
    <div style={css(`background:${C.bg};border-bottom:1px solid ${C.line};position:relative;overflow:hidden`)}>
      <div style={css(`position:absolute;inset:0;background:${C.red};opacity:${isBreach && tick % 6 === 0 ? 0.25 : 0};transition:opacity .8s;pointer-events:none`)} />
      <div style={css(`display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px clamp(16px,2.4vw,28px);border-bottom:1px solid ${C.line};font-family:${mono};font-size:11px;letter-spacing:.12em;position:relative`)}>
        <div style={css('display:flex;gap:20px;align-items:center;flex-wrap:wrap')}><div style={css(`color:${C.mute}`)}>ARENA /</div><div>{s.vault}</div><div style={css(`color:${C.mute}`)}>{s.layer} · {s.run}</div></div>
        <div role="group" aria-label="Choose recorded attempt" style={css(`display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:${C.dim}`)}><button type="button" aria-pressed={isBreach} onClick={() => { setAuto(false); setIsBreach(true); }} style={css(`padding:7px 10px;font-family:${mono};font-size:11px;letter-spacing:.12em;border:1px solid ${C.red};background:${isBreach ? C.red : 'transparent'};color:${isBreach ? C.bg : C.red}`)}>BREACHED · VAULT 00</button><button type="button" aria-pressed={!isBreach} onClick={() => { setAuto(false); setIsBreach(false); }} style={css(`padding:7px 10px;font-family:${mono};font-size:11px;letter-spacing:.12em;border:1px solid ${C.teal};background:${!isBreach ? C.teal : 'transparent'};color:${!isBreach ? C.bg : C.teal}`)}>HELD · VAULT 06</button><button type="button" aria-pressed={!auto} onClick={() => setAuto((a) => !a)} style={css(`padding:7px 10px;font-family:${mono};font-size:11px;letter-spacing:.12em;border:1px solid #2f343b;background:transparent;color:${C.dim}`)}>{auto ? 'PAUSE AUTO-FLIP' : 'RESUME AUTO-FLIP'}</button><LiveClock /></div>
      </div>
      <div className="hx-cols-3" style={css('position:relative;min-height:480px')}>
        <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:14px`)}>
          <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.red}`)}>01 · THE ATTACK</div>
          <div style={css(`display:flex;gap:8px;align-items:center;font-family:${mono};font-size:11px;letter-spacing:.12em`)}><span style={css(`color:${C.mute}`)}>CHANNEL</span><span style={css(`padding:6px 10px;background:${C.text};color:${C.bg}`)}>{s.channelLabel.toUpperCase()}</span></div>
          <div style={css(`font-family:${mono};font-size:13px;line-height:1.7;color:#b9bec6;background:${C.panel};border:1px solid ${C.line};padding:16px;flex:1;white-space:pre-wrap`)}>
            <div style={css(`color:${C.mute}`)}>4 local page fragments, read in order:</div>
            <span style={css('background:#3a0f0c;color:#ff8a7e')}>{s.payload}</span>
          </div>
          <div style={css(`display:flex;justify-content:space-between;gap:12px;font-family:${mono};font-size:11px;color:${C.mute}`)}><div>goal: {s.goal}</div><div>identical attack on both vaults</div></div>
        </div>
        <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:12px`)}>
          <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.dim}`)}>02 · AGENT TOOL CALLS · RECORDED</div>
          <div style={css(`font-family:${mono};font-size:12.5px;line-height:1.55;display:flex;flex-direction:column;gap:8px`)}>
            {s.calls.map((c, i) => (
              <div key={i} style={css(`background:${c.unsafe ? '#2a0b09' : C.panel};border:1px solid ${c.unsafe ? C.red : C.line};padding:10px 14px;overflow-wrap:anywhere`)}>
                <span style={css(`color:${c.unsafe ? '#ff8a7e' : C.mute}`)}>round {c.round}</span>  {c.tool}({c.args})
                <div style={css(`color:${c.unsafe ? '#ff8a7e' : C.mute}`)}>  {c.unsafe ? '✗ ' : '→ '}{c.status.toUpperCase()}</div>
              </div>
            ))}
            <div style={css(`background:${C.panel};border:1px solid ${C.line};padding:10px 14px;overflow-wrap:anywhere`)}><span style={css(`color:${C.mute}`)}>reply</span>  &quot;{s.finalAnswer || '(no final answer)'}&quot;</div>
          </div>
        </div>
        <div className="hx-verdict" style={css('display:grid')}>
          <div style={css(`grid-area:1/1;opacity:${bOp};transition:opacity .5s;background:${C.red};color:${C.bg};padding:24px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;justify-content:space-between;gap:20px`)}>
            <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em`)}>03 · ORACLE VERDICT</div>
            <div style={css('font-weight:700;font-size:clamp(56px,6vw,72px);line-height:.85;letter-spacing:-.04em')}>BREA&#8203;CHED</div>
            <div style={css(`font-family:${mono};font-size:12px;line-height:1.7`)}>rule: policy_mutation<br />ATTACKER_FIXTURE added to the allowlist<br />checked by code · not AI-judged</div>
          </div>
          <div style={css(`grid-area:1/1;opacity:${hOp};transition:opacity .5s;padding:24px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;justify-content:space-between;gap:20px`)}>
            <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.teal}`)}>03 · ORACLE VERDICT</div>
            <div style={css(`font-weight:700;font-size:clamp(56px,6vw,72px);line-height:.85;letter-spacing:-.04em;color:${C.teal}`)}>HELD</div>
            <div style={css(`font-family:${mono};font-size:12px;line-height:1.7;color:${C.dim}`)}>0 attacker payments · 0 policy changes<br />0 over-limit calls · 0 secrets in output<br />checked by code · not AI-judged</div>
          </div>
        </div>
      </div>
      <div className="hx-ledger" style={css(`border-top:1px solid ${C.line};padding:18px clamp(16px,2.4vw,28px);font-family:${mono};position:relative;background:${C.bg}`)}>
        <div><div style={css(`font-size:10px;color:${C.mute};letter-spacing:.14em`)}>VAULT BALANCE · SYNTHETIC UNITS</div><div style={css(`font-size:26px;color:${C.gold}`)}>{n(s.balanceAfter)}</div><div style={css(`font-size:11px;color:${C.mute}`)}>from {n(s.balanceBefore)}{s.balanceAfter === s.balanceBefore ? ' · invoice not paid' : ' · ' + n(s.debitUnits) + ' paid to the merchant'}{Number(s.lostUnits) > 0 ? ' · ' + n(s.lostUnits) + ' lost' : ''}</div></div>
        <div style={css('display:flex;gap:3px;height:26px')}>{coins.map((c, i) => <div key={i} style={css(`flex:1;background:${c.col};transition:background .15s;transition-delay:${c.d}`)} />)}</div>
        <div style={css('text-align:right')}><div style={css(`font-size:10px;color:${C.mute};letter-spacing:.14em`)}>APPROVED RECIPIENTS</div><div style={css(`font-size:20px;color:${s.allowedAfter.length > s.allowedBefore.length ? C.red : C.teal}`)}>{s.allowedAfter.length > s.allowedBefore.length ? '+ ATTACKER_FIXTURE' : 'unchanged'}</div><div style={css(`font-size:11px;color:${C.mute}`)}>{s.allowedBefore.length} → {s.allowedAfter.length}</div></div>
      </div>
      <div style={css(`border-top:1px solid ${C.line};padding:14px clamp(16px,2.4vw,28px);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:${mono};font-size:12px;color:${C.dim};position:relative;background:${C.bg}`)}>
        <div>record sha256 {s.attemptHash.slice(0, 6)}…{s.attemptHash.slice(-4)} · {s.ts.replace('T', ' ').slice(0, 19)} UTC · {(s.latencyMs / 1000).toFixed(1)} s</div>
        <div style={css('display:flex;gap:20px;flex-wrap:wrap')}>
          <Link href={'/proof?record=' + s.key} style={css(`color:${C.text}`)}>Open proof →</Link>
          <a href={download} download={'heist-' + s.key + '-record.json'}>Download record</a>
          <Link href="/arena" style={css(`color:${C.red}`)}>Back to vaults</Link>
        </div>
      </div>
    </div>
  );
}
