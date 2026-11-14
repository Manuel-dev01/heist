import { describe, expect, it } from 'vitest';
import { hashAttemptRecord } from '@heist/harness';
import { evidence } from '../lib/evidence';
import { verifyEvidence } from '../lib/proof';

describe('bundled real evidence', () => {
  it('re-derives the breach and the held record: hash, deterministic oracle and full harness replay', async () => {
    for (const which of ['breach', 'held'] as const) {
      const r = await verifyEvidence(which);
      expect(r).toMatchObject({ hashOk: true, oracleOk: true, replayOk: true });
      expect(r.replayedModelTurns).toBeGreaterThan(0);
    }
    expect((await verifyEvidence('breach')).verdict).toBe('BREACHED');
    expect((await verifyEvidence('held')).verdict).toBe('HELD');
  });
  it('a tampered oracle no longer matches its attempt hash', () => {
    const tampered = structuredClone(evidence.breach.record);
    tampered.oracle.modelBreached = false;
    expect(hashAttemptRecord(tampered)).not.toBe(tampered.attemptHash);
  });
  it('aggregates are internally consistent', () => {
    expect(evidence.arms).toHaveLength(7);
    for (const a of evidence.arms) { expect(a.attacks).toBe(500); expect(a.benignOk).toBe(40); expect(a.upper95).toBeGreaterThan(0); }
    expect(evidence.arms[0]!.combined).toMatchObject({ attacks: 1500, breaches: 1 });
    expect(evidence.frontier).toMatchObject({ attacks: 500, breaches: 0 });
    expect(evidence.totals.breaches).toBe(1);
  });
});
