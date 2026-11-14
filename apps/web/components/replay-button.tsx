'use client';
import { useEffect, useRef, useState } from 'react';
import { C, css, mono } from '../lib/css';

interface Result { hashOk: boolean; oracleOk: boolean; replayOk: boolean; recomputedHash: string; replayedModelTurns: number; verdict: string }
/** Asks the server to re-derive the bundled record (hash, oracle, full replay). Shows only what the server returned. */
export function ReplayButton({ which, recorded }: { which: 'breach' | 'held'; recorded: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [res, setRes] = useState<Result | null>(null), [dots, setDots] = useState(0), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function run() {
    setState('running'); setRes(null); setError(''); setDots(0);
    const anim = setInterval(() => setDots((d) => (d + 1) % 4), 250);
    try {
      const r = await fetch('/api/proof', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error('server returned HTTP ' + r.status);
      const body = await r.json() as Record<string, Result | undefined>;
      const got = body[which];
      if (!got || typeof got.recomputedHash !== 'string') throw new Error('server returned no result for this record');
      if (alive.current) { setRes(got); setState('done'); }
    } catch (e) {
      if (alive.current) { setError(e instanceof Error && e.name === 'TimeoutError' ? 'replay timed out after 20 s' : e instanceof Error ? e.message : 'replay request failed'); setState('error'); }
    } finally { clearInterval(anim); }
  }
  const ok = !!res && res.hashOk && res.oracleOk && res.replayOk;
  const col = state === 'done' ? (ok ? C.teal : C.red) : state === 'running' ? C.gold : state === 'error' ? C.red : C.dim;
  const replayed = state === 'done' && res ? res.recomputedHash : state === 'running' ? 'recomputing' + '.'.repeat(dots) : '—';
  return (
    <div style={css('display:flex;flex-direction:column;gap:10px')}>
      <div style={css(`font-family:${mono};font-size:11px;line-height:1.8;background:${C.panel};border:1px solid ${C.line};padding:12px;color:${C.dim};overflow-wrap:anywhere`)}>
        recorded  {recorded}<br />replayed  <span style={css(`color:${col}`)}>{replayed}</span>
      </div>
      <div style={css(`height:4px;background:${C.line2}`)}><div style={css(`height:4px;width:${state === 'done' ? 100 : state === 'running' ? 35 + dots * 15 : 0}%;background:${col};transition:width .3s`)} /></div>
      <div style={css('display:flex;justify-content:space-between;align-items:center;gap:12px')}>
        <div role="status" aria-live="polite" style={css(`font-family:${mono};font-size:12px;color:${col}`)}>
          {state === 'idle' && 'idle · ready to replay'}{state === 'running' && 'replaying offline through the harness…'}{state === 'error' && '✗ replay failed: ' + error}
          {state === 'done' && res && (ok ? `✓ MATCH · hash, oracle and ${res.replayedModelTurns} saved decisions reproduce ${res.verdict}` : `✗ MISMATCH · hash ${res.hashOk ? 'ok' : 'differs'}, oracle ${res.oracleOk ? 'ok' : 'differs'}, replay ${res.replayOk ? 'ok' : 'differs'}`)}
        </div>
        <button type="button" onClick={run} disabled={state === 'running'} style={css(`border:1px solid ${C.text};background:transparent;padding:10px 14px;font-weight:600;font-size:14px;color:${C.text}`)}>Verify replay</button>
      </div>
    </div>
  );
}
