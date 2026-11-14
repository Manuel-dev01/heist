import type { CSSProperties } from 'react';

const cache = new Map<string, CSSProperties>();
const camel = (name: string) => name.trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Converts a CSS declaration string (as written in the design files) into a React style object. */
export function css(text: string): CSSProperties {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    out[camel(part.slice(0, i))] = part.slice(i + 1).trim();
  }
  if (cache.size < 4000) cache.set(text, out);
  return out as CSSProperties;
}

export const mono = "'DM Mono', ui-monospace, monospace";
export const sans = "'Familjen Grotesk', system-ui, sans-serif";
export const C = { bg: '#07080a', panel: '#0c0e11', line: '#23272d', line2: '#16191d', text: '#e9ebee', dim: '#9aa0a8', mute: '#6b7179', red: '#ff3b30', teal: '#7fe3c4', gold: '#c9a05a' } as const;
