'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { C, css, mono } from '../lib/css';

type Checks = { allowlist: boolean; invoiceMatch: boolean; perTransferCap: boolean; totalCap: boolean; lockPolicy: boolean };
type Tools = { updatePolicy: boolean; releaseFunds: boolean; transfer: boolean };
export interface Manifest { name: string; maxPerTransferUnits: string; maxTotalDebitUnits: string; kiteCapUnits: string | null; checks: Checks; tools: Tools }
interface Tally { attacks: number; breaches: number }
interface Report {
  manifest: Manifest; attacks: number; corpusHash: string; reportHash: string; assumption: string;
  summary: { breaches: number; held: number; disrupted: number; policyTakeovers: number; lostToAttackerUnits: string; overpaidUnits: string; maxSingleLossUnits: string };
  byGoal: Record<string, Tally>; byChannel: Record<string, Tally>; blockedBy: Record<string, number>;
  legitimateTask: { paid: boolean; blockedBy: string[] };
  topExploits: { id: string; goal: string; channel: string; snippet: string; lostToAttackerUnits: string; overpaidUnits: string; policyChanged: boolean }[];
  fixes: { id: string; label: string; breaches: number; legitimatePaid: boolean; manifest: Manifest }[];
  allFixes: { breaches: number; legitimatePaid: boolean; manifest: Manifest };
  modelLayer: { note: string; setups: { name: string; layer: string; attacks: number; breaches: number }[] };
}

const OFF: Checks = { allowlist: false, invoiceMatch: false, perTransferCap: false, totalCap: false, lockPolicy: false };
const ALL_TOOLS: Tools = { updatePolicy: true, releaseFunds: true, transfer: true };
export const PRESETS: [string, string, Manifest][] = [
  ['unguarded', 'Prompt-only agent', { name: 'prompt-only-agent', maxPerTransferUnits: '250000', maxTotalDebitUnits: '1000000', kiteCapUnits: null, checks: OFF, tools: ALL_TOOLS }],
  ['allowlist', 'Allowlist + caps', { name: 'allowlist-agent', maxPerTransferUnits: '250000', maxTotalDebitUnits: '1000000', kiteCapUnits: null, checks: { ...OFF, allowlist: true, perTransferCap: true, totalCap: true }, tools: ALL_TOOLS }],
  ['fortknox', 'Fort Knox executor', { name: 'fort-knox-executor', maxPerTransferUnits: '200000', maxTotalDebitUnits: '200000', kiteCapUnits: '200000', checks: { allowlist: true, invoiceMatch: true, perTransferCap: true, totalCap: true, lockPolicy: true }, tools: { updatePolicy: false, releaseFunds: false, transfer: true } }],
];
const CHECKS: [keyof Checks, string, string][] = [
  ['allowlist', 'Recipient allowlist', 'executor refuses payees not on the owner list'],
  ['invoiceMatch', 'Invoice matching', 'pay only the exact payee, amount and reference of a trusted invoice'],
  ['perTransferCap', 'Per-payment cap', 'refuse any single payment above the cap'],
  ['totalCap', 'Total spend cap', 'refuse once the session total would pass the cap'],
  ['lockPolicy', 'Policy writes locked', 'the agent cannot edit its own allowlist or caps'],
];
const TOOLS: [keyof Tools, string][] = [['updatePolicy', 'update_policy'], ['releaseFunds', 'release_funds'], ['transfer', 'transfer']];
const same = (a: Manifest, b: Manifest) => JSON.stringify(a) === JSON.stringify(b);
const n = (u: string) => Number(u).toLocaleString('en-US');
const pctOfWallet = (u: string) => Math.round(Number(u) / 10_000) + '%';
const box = `background:${C.panel};border:1px solid ${C.line};padding:12px`;
const label = `font-family:${mono};font-size:10px;letter-spacing:.14em;color:${C.mute}`;
const head = (color: string) => `font-family:${mono};font-size:11px;letter-spacing:.16em;color:${color}`;

function Toggle({ on, onClick, title, note, id }: { on: boolean; onClick: () => void; title: string; note?: string; id: string }) {
  return (
    <button type="button" data-audit={id} aria-pressed={on} onClick={onClick} style={css(`text-align:left;display:grid;grid-template-columns:1fr 34px;gap:10px;align-items:center;background:${on ? '#0c1714' : C.panel};border:1px solid ${on ? '#2e5a4d' : C.line};padding:9px 12px;color:${C.text}`)}>
      <div><div style={css('font-weight:600;font-size:14px')}>{title}</div>{note && <div style={css(`font-family:${mono};font-size:10px;color:${C.mute};line-height:1.5`)}>{note}</div>}</div>
      <div aria-hidden style={css(`width:34px;height:18px;background:${on ? C.teal : '#2f343b'};position:relative`)}><div style={css(`position:absolute;top:2px;left:${on ? 16 : 2}px;width:14px;height:14px;background:${C.bg};transition:left .2s`)} /></div>
    </button>
  );
}

function Units({ id, title, value, onChange }: { id: string; title: string; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} style={css('display:flex;flex-direction:column;gap:4px;flex:1;min-width:130px')}>
      <span style={css(label)}>{title}</span>
      <input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 15))} style={css(`background:${C.bg};border:1px solid ${C.line};color:${C.text};padding:9px 10px;font-family:${mono};font-size:13px;width:100%`)} />
    </label>
  );
}

export function PolicyAudit({ goals, channels }: { goals: Record<string, string>; channels: Record<string, string> }) {
  const [m, setM] = useState<Manifest>(PRESETS[0]![2]);
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState('');
  const [json, setJson] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (manifest: Manifest) => {
    const id = ++seq.current;
    setState('running'); setError('');
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest), signal: AbortSignal.timeout(20_000) });
      const body = await r.json() as Report & { error?: string; issues?: string[] };
      if (id !== seq.current) return;
      if (!r.ok) { setState('error'); setError(body.error === 'invalid_manifest' ? 'Manifest rejected: ' + (body.issues ?? []).join('; ') : 'Audit failed (' + (body.error ?? r.status) + ')'); return; }
      setReport(body); setState('idle');
    } catch { if (id === seq.current) { setState('error'); setError('The audit did not respond. Try again.'); } }
  }, []);
  useEffect(() => { void run(PRESETS[0]![2]); }, [run]);

  const apply = (next: Manifest) => { setM(next); setJson(null); void run(next); };
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'heist-policy-audit-' + report.reportHash.slice(0, 12) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const applyJson = () => {
    try { apply(JSON.parse(json ?? '') as Manifest); } catch { setState('error'); setError('That is not valid JSON.'); }
  };
  const s = report?.summary, clean = !!report && s!.breaches === 0 && report.legitimateTask.paid;

  return (
    <div className="hx-cols-2" style={css(`background:${C.bg};border-top:1px solid ${C.line}`)}>
      <div style={css(`padding:24px clamp(16px,2.4vw,28px);border-right:1px solid ${C.line};display:flex;flex-direction:column;gap:12px;min-width:0`)}>
        <div style={css(head(C.teal))}>01 · YOUR AGENT&apos;S SPENDING SETUP</div>
        <div style={css('display:flex;gap:6px;flex-wrap:wrap')}>
          {PRESETS.map(([id, name, p]) => (
            <button key={id} type="button" data-audit={'preset-' + id} aria-pressed={same(m, p)} onClick={() => apply(p)} style={css(`border:1px solid ${same(m, p) ? C.teal : C.line};color:${same(m, p) ? C.teal : C.dim};background:transparent;padding:7px 10px;font-family:${mono};font-size:11px`)}>{name}</button>
          ))}
          <button type="button" data-audit="json" aria-pressed={json !== null} onClick={() => setJson(json === null ? JSON.stringify(m, null, 2) : null)} style={css(`border:1px dashed ${C.line};color:${C.dim};background:transparent;padding:7px 10px;font-family:${mono};font-size:11px;margin-left:auto`)}>{json === null ? 'Edit as JSON' : 'Close JSON'}</button>
        </div>
        {json !== null ? (
          <>
            <label htmlFor="audit-json" style={css(label)}>MANIFEST JSON</label>
            <textarea id="audit-json" value={json} onChange={(e) => setJson(e.target.value.slice(0, 4000))} rows={18} spellCheck={false} style={css(`background:${C.bg};border:1px solid ${C.line};color:#b9bec6;padding:12px;font-family:${mono};font-size:12px;line-height:1.6;width:100%;resize:vertical`)} />
            <button type="button" data-audit="apply-json" onClick={applyJson} style={css(`background:${C.teal};color:${C.bg};font-weight:700;padding:12px`)}>Run audit on this JSON</button>
          </>
        ) : (
          <>
            <label htmlFor="audit-name" style={css('display:flex;flex-direction:column;gap:4px')}>
              <span style={css(label)}>AGENT NAME</span>
              <input id="audit-name" value={m.name} maxLength={60} onChange={(e) => setM({ ...m, name: e.target.value.replace(/[^\w .:@/-]/g, '') })} style={css(`background:${C.bg};border:1px solid ${C.line};color:${C.text};padding:9px 10px;font-family:${mono};font-size:13px`)} />
            </label>
            <div style={css(label)}>CHECKS YOUR EXECUTOR ENFORCES IN CODE (NOT IN THE PROMPT)</div>
            {CHECKS.map(([k, t, note]) => <Toggle key={k} id={'check-' + k} on={m.checks[k]} title={t} note={note} onClick={() => setM({ ...m, checks: { ...m.checks, [k]: !m.checks[k] } })} />)}
            <div style={css('display:flex;gap:10px;flex-wrap:wrap')}>
              <Units id="audit-per" title="PER-PAYMENT CAP (UNITS)" value={m.maxPerTransferUnits} onChange={(v) => setM({ ...m, maxPerTransferUnits: v })} />
              <Units id="audit-total" title="TOTAL CAP (UNITS)" value={m.maxTotalDebitUnits} onChange={(v) => setM({ ...m, maxTotalDebitUnits: v })} />
            </div>
            <Toggle id="kite" on={m.kiteCapUnits !== null} title="Kite Passport per-payment cap" note="enforced outside the agent by Kite session rules (proven live: over-cap refused)" onClick={() => setM({ ...m, kiteCapUnits: m.kiteCapUnits === null ? '200000' : null })} />
            {m.kiteCapUnits !== null && <Units id="audit-kite" title="KITE CAP (UNITS)" value={m.kiteCapUnits} onChange={(v) => setM({ ...m, kiteCapUnits: v })} />}
            <div style={css(label)}>TOOLS THE AGENT CAN CALL</div>
            <div style={css('display:flex;gap:6px;flex-wrap:wrap')}>
              <span style={css(`border:1px solid ${C.line};color:${C.mute};padding:7px 10px;font-family:${mono};font-size:11px`)}>pay_x402 · always</span>
              {TOOLS.map(([k, t]) => (
                <button key={k} type="button" data-audit={'tool-' + k} aria-pressed={m.tools[k]} onClick={() => setM({ ...m, tools: { ...m.tools, [k]: !m.tools[k] } })} style={css(`border:1px solid ${m.tools[k] ? C.gold : C.line};color:${m.tools[k] ? C.gold : C.mute};background:transparent;padding:7px 10px;font-family:${mono};font-size:11px;text-decoration:${m.tools[k] ? 'none' : 'line-through'}`)}>{t}</button>
              ))}
            </div>
            <div style={css(`font-family:${mono};font-size:10px;color:${C.mute};line-height:1.6`)}>Scale: a 1,000,000-unit wallet with one trusted invoice of 200,000 units to the merchant.</div>
            <button type="button" data-audit="run" onClick={() => void run(m)} disabled={state === 'running'} style={css(`background:${C.teal};color:${C.bg};font-weight:700;padding:13px;opacity:${state === 'running' ? '.6' : '1'}`)}>{state === 'running' ? 'Running 1,000 attacks…' : 'Run audit · 1,000 attacks'}</button>
          </>
        )}
        {state === 'error' && <div role="alert" style={css(`border:1px solid ${C.red};color:${C.red};padding:10px;font-family:${mono};font-size:12px`)}>{error}</div>}
      </div>

      <div aria-live="polite" aria-busy={state === 'running'} style={css('padding:24px clamp(16px,2.4vw,28px);display:flex;flex-direction:column;gap:14px;min-width:0')}>
        <div style={css(head(C.dim))}>02 · REPORT{report ? ' · ' + (report.reportHash.slice(0, 12)) + '…' : ''}</div>
        {!report ? <div style={css(`${box};color:${C.dim};font-family:${mono};font-size:12px`)}>{state === 'error' ? 'No report yet.' : 'Running the corpus…'}</div> : <>
          <div style={css(`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;opacity:${state === 'running' ? '.5' : '1'}`)}>
            {[
              ['breaches', `${s!.breaches} / ${report.attacks.toLocaleString('en-US')}`, s!.breaches ? C.red : C.teal],
              ['worst single loss', s!.maxSingleLossUnits === '0' ? '0' : pctOfWallet(s!.maxSingleLossUnits) + ' of wallet', s!.maxSingleLossUnits === '0' ? C.teal : C.red],
              ['policy takeovers', String(s!.policyTakeovers), s!.policyTakeovers ? C.red : C.teal],
              ['real invoice', report.legitimateTask.paid ? 'still paid' : 'BLOCKED', report.legitimateTask.paid ? C.teal : C.gold],
            ].map(([k, v, color]) => (
              <div key={k} style={css(box)}><div style={css(label)}>{String(k).toUpperCase()}</div><div style={css(`font-size:24px;font-weight:700;color:${color}`)}>{v}</div></div>
            ))}
          </div>
          {!report.legitimateTask.paid && <div style={css(`border:1px solid ${C.gold};color:${C.gold};padding:10px;font-family:${mono};font-size:12px`)}>This setup also blocks the legitimate 200,000-unit invoice ({report.legitimateTask.blockedBy.join(', ')}). Safe, but not useful.</div>}
          <div style={css(`font-family:${mono};font-size:11px;color:${C.dim};line-height:1.6`)}>Sent to the attacker: {n(s!.lostToAttackerUnits)} units · overpaid to the merchant: {n(s!.overpaidUnits)} units · summed over 1,000 independent runs, each from a fresh wallet.</div>

          <div className="hx-cols-2" style={css('gap:14px')}>
            {([['BY ATTACK GOAL', report.byGoal, goals], ['BY CHANNEL', report.byChannel, channels]] as const).map(([t, rows, names]) => (
              <div key={t} style={css('display:flex;flex-direction:column;gap:6px;min-width:0')}>
                <div style={css(label)}>{t}</div>
                {Object.entries(rows).sort((a, b) => b[1].attacks - a[1].attacks).map(([k, v]) => (
                  <div key={k} style={css(`font-family:${mono};font-size:11px;display:flex;flex-direction:column;gap:3px`)}>
                    <div style={css('display:flex;justify-content:space-between;gap:8px')}><span style={css(`color:${C.dim}`)}>{names[k] ?? k}</span><span style={css(`color:${v.breaches ? C.red : C.teal}`)}>{v.breaches}/{v.attacks}</span></div>
                    <div style={css('height:4px;background:#1b1f24')}><div style={css(`height:4px;width:${(v.breaches / v.attacks) * 100}%;background:${C.red}`)} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {report.topExploits.length > 0 && <div style={css('display:flex;flex-direction:column;gap:6px')}>
            <div style={css(label)}>TOP EXPLOITS AGAINST THIS SETUP</div>
            {report.topExploits.slice(0, 3).map((x) => (
              <div key={x.id} style={css(`background:#140807;border:1px solid #4a1714;padding:10px 12px;font-family:${mono};font-size:11px;line-height:1.6;min-width:0`)}>
                <span style={css(`color:${C.red}`)}>{x.id}</span> · {channels[x.channel] ?? x.channel} · {goals[x.goal] ?? x.goal}{x.policyChanged ? ' · policy rewritten' : ''} · {pctOfWallet(String(BigInt(x.lostToAttackerUnits) + BigInt(x.overpaidUnits)))} of wallet
                <div style={css(`color:${C.dim};overflow-wrap:anywhere`)}>&ldquo;{x.snippet}…&rdquo;</div>
              </div>
            ))}
          </div>}

          <div style={css('display:flex;flex-direction:column;gap:6px')}>
            <div style={css(head(C.dim))}>03 · FIXES, RE-TESTED ON ALL 1,000</div>
            {report.fixes.length === 0 ? <div style={css(`${box};font-family:${mono};font-size:12px;color:${C.teal}`)}>Every lever HEIST tests is already on.</div> : <>
              {report.fixes.map((f) => (
                <div key={f.id} style={css(`${box};display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center`)}>
                  <div style={css('min-width:0')}><div style={css('font-size:14px;font-weight:600')}>{f.label}</div><div style={css(`font-family:${mono};font-size:11px;color:${C.dim}`)}>{s!.breaches} → <span style={css(`color:${f.breaches ? C.red : C.teal}`)}>{f.breaches}</span> breaches{f.legitimatePaid ? '' : ' · blocks the real invoice'}</div></div>
                  <button type="button" data-audit={'fix-' + f.id} onClick={() => apply(f.manifest)} style={css(`border:1px solid ${C.teal};color:${C.teal};background:transparent;padding:7px 10px;font-family:${mono};font-size:11px`)}>Apply</button>
                </div>
              ))}
              <button type="button" data-audit="fix-all" onClick={() => apply(report.allFixes.manifest)} style={css(`border:1px solid ${C.teal};background:#0c1714;color:${C.teal};padding:11px;font-family:${mono};font-size:12px`)}>Apply all · {s!.breaches} → {report.allFixes.breaches} breaches</button>
            </>}
          </div>

          {clean && <div style={css(`border:1px solid ${C.teal};padding:18px;display:flex;flex-direction:column;gap:6px;font-family:${mono};background:#0c1714`)}>
            <div style={css(`font-size:11px;letter-spacing:.2em;color:${C.teal}`)}>HEIST · EXECUTOR LAYER HELD</div>
            <div style={css("font-family:'Familjen Grotesk',sans-serif;font-weight:700;font-size:24px;line-height:1.1;overflow-wrap:anywhere")}>{report.manifest.name}</div>
            <div style={css(`font-size:12px;color:${C.dim};line-height:1.6`)}>0 / 1,000 attacks moved money, even with the model fully fooled · real invoice still paid<br />report {report.reportHash.slice(0, 16)}… · corpus {report.corpusHash.slice(0, 12)}…</div>
            <div style={css(`font-size:10px;color:${C.mute}`)}>Self-reported configuration. Proves the setup, not that your code implements it.</div>
          </div>}

          <button type="button" data-audit="download" onClick={download} style={css(`border:1px solid ${C.line};color:${C.text};background:transparent;padding:11px;font-family:${mono};font-size:12px`)}>Download hashed report (JSON)</button>
          <div style={css(`font-family:${mono};font-size:10px;color:${C.mute};line-height:1.6`)}>{report.assumption}</div>
        </>}
      </div>
    </div>
  );
}
