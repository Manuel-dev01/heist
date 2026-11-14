'use client';
import { useState } from 'react';
import { C, css, mono } from '../lib/css';
import type { ArmSummary } from '../lib/evidence';

interface Props { arms: ArmSummary[]; breachHash: string; exploit: { id: string; channel: string; goal: string } }
const pct = (x: number) => (x * 100).toFixed(2) + '%';

export function AuditPreview({ arms, breachHash, exploit }: Props) {
  // Each toggle combination maps to a measured setup; unmeasured combinations are labelled as such.
  const [on, setOn] = useState({ guard: false, kronos: false, enforced: false, kite: false });
  const key = (on.guard ? 'g' : '') + (on.kronos ? 'k' : '') + (on.enforced ? 'e' : '');
  const armFor: Record<string, string> = { '': 'raw', g: 'guard', gk: 'guard-kronos', gke: 'guard-kronos-multipath-shadow-enforced' };
  const arm = arms.find((a) => a.id === armFor[key]);
  const stats = arm ? (arm.combined ?? arm) : null;
  const fixes: [keyof typeof on, string, string][] = [['guard', 'Guard pre-screen', 'SERV Prompt Guard filters injected instructions'], ['kronos', 'Kronos reasoning check', 'second reasoning pass (requires Guard in measured setups)'], ['enforced', 'Enforced recipient allowlist', 'policy enforced in code; measured with Guard + Kronos + Multipath + Shadow'], ['kite', 'Kite spending cap', 'per-payment cap enforced by Kite Passport · measured live']];
  return (
    <div style={css('display:flex;flex-direction:column;gap:2px;background:#23272d')}>
      <div className="hx-cols-2" style={css(`background:${C.bg}`)}>
        <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:12px`)}>
          <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.dim}`)}>RAW GPT-5.4-NANO · NO DEFENSES (MEASURED)</div>
          <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
            {[['attempts', (arms[0]!.combined?.attacks ?? 0).toLocaleString('en-US')], ['breaches', String(arms[0]!.combined?.breaches ?? 0)], ['benign done', `${arms[0]!.benignOk}/${arms[0]!.benign}`], ['95% upper', '≤' + pct(arms[0]!.combined?.upper95 ?? 0)]].map(([k, v]) => (
              <div key={k} style={css(`background:${C.panel};border:1px solid ${C.line};padding:12px`)}><div style={css(`font-family:${mono};font-size:10px;letter-spacing:.14em;color:${C.mute}`)}>{String(k).toUpperCase()}</div><div style={css(`font-size:26px;font-weight:700;color:${k === 'breaches' ? C.red : C.text}`)}>{v}</div></div>
            ))}
          </div>
          <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.dim};margin-top:6px`)}>TOP EXPLOIT</div>
          <a href="/proof" style={css(`background:#140807;border:1px solid ${C.red};padding:12px;font-family:${mono};font-size:12px;line-height:1.6`)}>{exploit.id} · {exploit.channel} · {exploit.goal}<br /><span style={css(`color:${C.dim}`)}>attacker added to the allowlist · sha256 {breachHash.slice(0, 8)}… · open proof →</span></a>
        </div>
        <div style={css('padding:24px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;gap:10px;min-width:0')}>
          <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${C.dim}`)}>ADD A DEFENSE · SEE THE MEASURED RESULT</div>
          {fixes.map(([k, name, note]) => (
            <button key={k} type="button" aria-pressed={on[k]} onClick={() => setOn((s) => ({ ...s, [k]: !s[k] }))} style={css(`text-align:left;display:grid;grid-template-columns:1fr 34px;gap:10px;align-items:center;background:${on[k] ? '#0c1714' : C.panel};border:1px solid ${on[k] ? '#2e5a4d' : C.line};padding:10px 12px;color:${C.text}`)}>
              <div><div style={css('font-weight:600;font-size:14px')}>{name}</div><div style={css(`font-family:${mono};font-size:10px;color:${C.mute};line-height:1.5`)}>{note}</div></div>
              <div style={css(`width:34px;height:18px;background:${on[k] ? C.teal : '#2f343b'};position:relative`)}><div style={css(`position:absolute;top:2px;left:${on[k] ? 16 : 2}px;width:14px;height:14px;background:${C.bg};transition:left .2s`)} /></div>
            </button>
          ))}
          <div style={css(`margin-top:6px;background:${C.panel};border:1px solid ${C.line};padding:12px;font-family:${mono};font-size:12px;line-height:1.7`)}>
            {stats ? <>measured setup: <span style={css(`color:${C.text}`)}>{arm!.name} · {arm!.layer}</span><br />breaches <span style={css(`color:${stats.breaches ? C.red : C.teal}`)}>{stats.breaches} / {stats.attacks.toLocaleString('en-US')}</span> · ≤{pct(stats.upper95)} upper<br />visible cost ${arm!.visibleCostPer1kUsd?.toFixed(2)} / 1K</>
              : <span style={css(`color:${C.gold}`)}>this combination was not measured in D3 · re-test required</span>}
            {on.kite && <><br /><span style={css(`color:${C.teal}`)}>Kite cap: over-cap payment refused live (session_rule_exceeded) · {'$0'} moved</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}
