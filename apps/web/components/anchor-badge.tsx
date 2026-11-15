import { ANCHOR } from '../lib/anchor';
import { C, css, mono } from '../lib/css';

/** The on-chain commitment: one Kite testnet transaction whose data is the Merkle root over all 5,383 live records. */
export function AnchorBadge() {
  return (
    <a href={ANCHOR.explorer} target="_blank" rel="noopener noreferrer" style={css(`display:flex;flex-direction:column;gap:6px;align-self:stretch;border:1px solid #6b5a2e;background:#15110a;border-radius:14px;padding:12px 14px;font-family:${mono};font-size:11px;letter-spacing:.06em;color:${C.dim};line-height:1.6`)}>
      <span style={css(`color:${C.gold};letter-spacing:.14em`)}>⛓ ANCHORED ON KITE · {ANCHOR.network.toUpperCase()} · BLOCK {ANCHOR.blockNumber.toLocaleString('en-US')}</span>
      <span>Merkle root over all 5,383 live records: <span style={css(`color:${C.text}`)}>{ANCHOR.topRoot.slice(0, 20)}…</span></span>
      <span>tx {ANCHOR.txHash.slice(0, 18)}… ↗ · pnpm verify:runs recomputes this root and reads it back from the chain</span>
    </a>
  );
}
