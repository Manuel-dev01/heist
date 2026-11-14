'use client';
import { useState } from 'react';
import { C, css, mono } from '../lib/css';

interface Result { hashOk: boolean; oracleOk: boolean; replayOk: boolean; recomputedHash: string; replayedModelTurns: number; verdict: string }
export function ReplayButton({ which, recorded }: { which: 'breach' | 'held'; recorded: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [res, setRes] = useState<Result | null>(null), [shown, setShown] = useState(0);
  async function run() {
    setState('running'); setRes(null); setShown(0);
    const anim = setInterval(() => setShown((s) => Math.min(recorded.length, s + 4)), 40);
    try {
      const r = await fetch('/api/proof', { cache: 'no-store' }); const body = await r.json() as Record<string, Result>;
      await new Promise((ok) => setTimeout(ok, 900)); setRes(body[which] ?? null); setState('done');
    } catch { setState('error'); } finally { clearInterval(anim); setShown(recorded.length); }
  }
  const ok = res && res.hashOk && res.oracleOk && res.replayOk, col = state === 'done' ? (ok ? C.teal : C.red) : state === 'running' ? C.gold : C.dim;
  return (
    <div style={css('display:flex;flex-direction:column;gap:10px')}>
      <div style={css(`font-family:${mono};font-size:11px;line-height:1.8;background:${C.panel};border:1px solid ${C.line};padding:12px;color:${C.dim};overflow-wrap:anywhere`)}>
        recorded  {recorded}<br />replayed  <span style={css(`color:${col}`)}>{state === 'idle' ? '—' : state === 'done' && res ? res.recomputedHash : recorded.slice(0, shown) + '▌'}</span>
      </div>
      <div style={css(`height:4px;background:${C.line2}`)}><div style={css(`height:4px;width:${state === 'idle' ? 0 : state === 'running' ? Math.round(shown / recorded.length * 90) : 100}%;background:${col};transition:width .3s`)} /></div>
      <div style={css('display:flex;justify-content:space-between;align-items:center;gap:12px')}>
        <div style={css(`font-family:${mono};font-size:12px;color:${col}`)}>
          {state === 'idle' && 'idle · ready to replay'}{state === 'running' && 'replaying offline through the harness…'}{state === 'error' && 'replay request failed'}
          {state === 'done' && res && (ok ? `✓ MATCH · hash, oracle and ${res.replayedModelTurns} saved decisions reproduce ${res.verdict}` : '✗ MISMATCH')}
        </div>
        <button type="button" onClick={run} disabled={state === 'running'} style={css(`border:1px solid ${C.text};background:transparent;padding:10px 14px;font-weight:600;font-size:14px;color:${C.text}`)}>Verify replay</button>
      </div>
    </div>
  );
}
