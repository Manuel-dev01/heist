'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { css, mono, sans, C } from '../lib/css';

export function useTick(ms = 700) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick((t) => t + 1), ms); return () => clearInterval(iv); }, [ms]);
  return tick;
}
export function LiveClock({ size = 11 }: { size?: number }) {
  const tick = useTick(700);
  const [now, setNow] = useState<string>('--:--:-- UTC');
  useEffect(() => { setNow(new Date().toISOString().slice(11, 19) + ' UTC'); }, [tick]);
  return <div className="hx-clock" style={css(`display:flex;gap:6px;align-items:center;font-size:${size}px`)}><div style={css(`width:7px;height:7px;border-radius:50%;background:${C.red};opacity:${tick % 2 ? 1 : 0.15}`)} />{now}</div>;
}
const NAV: [string, string, string][] = [['ROB IT', '/rob', C.red], ['ARENA', '/arena', C.red], ['DEFENSE CURVE', '/defense-curve', C.teal], ['POD', '/pod', C.red], ['EXPLOITS', '/exploits', C.red], ['AUDIT', '/audit', C.teal], ['RANGE', '/range', C.gold]];
export function AppHeader({ active, right }: { active?: string; right?: ReactNode }) {
  return (
    <header className="hx-header" style={css(`display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px clamp(16px,2.4vw,28px);border-bottom:1px solid ${C.line};font-family:${mono};font-size:11px;letter-spacing:.12em`)}>
      <nav className="hx-nav" style={css('display:flex;gap:clamp(14px,2.2vw,28px);align-items:center;flex-wrap:wrap')}>
        <Link href="/" style={css(`font-family:${sans};font-weight:700;font-size:18px;letter-spacing:.2em;color:${C.text}`)}>HEIST</Link>
        {NAV.map(([label, href, col]) => (
          <Link key={href} href={href} style={css(active === label ? `color:${C.text};border-bottom:1px solid ${col};padding-bottom:3px` : `color:${C.mute}`)}>{label}</Link>
        ))}
      </nav>
      <div className="hx-header-right" style={css(`display:flex;gap:16px;align-items:center;color:${C.dim}`)}>
        {right ?? <><div style={css(`border:1px solid #2f343b;padding:5px 8px;color:${C.teal}`)}>DETERMINISTIC · NOT AI-JUDGED</div><LiveClock /></>}
      </div>
    </header>
  );
}
export function Page({ children }: { children: ReactNode }) {
  return <div className="hx-page" style={css(`min-height:100vh;background:${C.bg};color:${C.text};font-family:${sans}`)}>{children}</div>;
}
export function Eyebrow({ children, color = C.dim }: { children: ReactNode; color?: string }) {
  return <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:${color}`)}>{children}</div>;
}
export function Footnote({ children }: { children: ReactNode }) {
  return <div style={css(`font-family:${mono};font-size:11px;color:${C.mute};line-height:1.6`)}>{children}</div>;
}
