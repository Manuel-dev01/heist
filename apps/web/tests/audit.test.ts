import { describe, expect, it } from 'vitest';
import { hashCanonical } from '@heist/harness';
import { ManifestSchema, runPolicyAudit } from '../lib/audit';

const OPEN = { name: 'unguarded', maxPerTransferUnits: '250000', maxTotalDebitUnits: '1000000', kiteCapUnits: null,
  checks: { allowlist: false, invoiceMatch: false, perTransferCap: false, totalCap: false, lockPolicy: false },
  tools: { updatePolicy: true, releaseFunds: true, transfer: true } };
const HARD = { ...OPEN, name: 'hardened', kiteCapUnits: '200000', maxTotalDebitUnits: '200000',
  checks: { allowlist: true, invoiceMatch: true, perTransferCap: true, totalCap: true, lockPolicy: true } };

describe('policy audit', () => {
  it('an unguarded executor loses on every money goal across all 1,000 attacks', () => {
    const r = runPolicyAudit(OPEN);
    expect(r.attacks).toBe(1000);
    expect(r.byGoal.utility_disruption!.breaches).toBe(0);
    const money = ['unauthorized_payment', 'recipient_substitution', 'over_limit_payment', 'policy_change'];
    for (const g of money) expect(r.byGoal[g]!.breaches).toBe(r.byGoal[g]!.attacks);
    expect(r.summary.breaches).toBe(1000 - r.byGoal.utility_disruption!.attacks);
    expect(r.summary.policyTakeovers).toBe(r.byGoal.policy_change!.attacks);
    expect(BigInt(r.summary.maxSingleLossUnits)).toBe(1_000_000n); // policy rewrite then full drain
    expect(r.legitimateTask.paid).toBe(true);
    expect(r.allFixes.breaches).toBe(0);
    expect(r.allFixes.legitimatePaid).toBe(true);
  });

  it('the hardened configuration holds every attack and still pays the real invoice', () => {
    const r = runPolicyAudit(HARD);
    expect(r.summary).toMatchObject({ breaches: 0, policyTakeovers: 0, lostToAttackerUnits: '0', overpaidUnits: '0' });
    expect(r.legitimateTask).toEqual({ paid: true, blockedBy: [] });
    expect(r.fixes).toEqual([]);
    expect(r.topExploits).toEqual([]);
  });

  it('each single fix is re-tested and isolates the goals it closes', () => {
    const r = runPolicyAudit(OPEN), by = Object.fromEntries(r.fixes.map((f) => [f.id, f]));
    expect(by.lockPolicy!.breaches).toBe(r.summary.breaches - r.byGoal.policy_change!.attacks);
    // A Kite cap at invoice size stops over-limit and full drains, but not an invoice-sized payment to the attacker.
    expect(by.kiteCap!.breaches).toBeGreaterThan(0);
    expect(by.kiteCap!.breaches).toBeLessThan(r.summary.breaches);
  });

  it('allowlist without policy lock still loses to a policy rewrite', () => {
    const r = runPolicyAudit({ ...OPEN, checks: { ...OPEN.checks, allowlist: true } });
    expect(r.byGoal.recipient_substitution!.breaches).toBe(0);
    expect(r.byGoal.unauthorized_payment!.breaches).toBe(0);
    expect(r.byGoal.policy_change!.breaches).toBe(r.byGoal.policy_change!.attacks);
  });

  it('flags a configuration that blocks the legitimate task', () => {
    const r = runPolicyAudit({ ...HARD, kiteCapUnits: '100000' });
    expect(r.legitimateTask.paid).toBe(false);
    expect(r.legitimateTask.blockedBy).toContain('Kite per-payment cap');
  });

  it('is deterministic and the report hash covers the body', () => {
    const a = runPolicyAudit(OPEN), b = runPolicyAudit(OPEN);
    expect(a.reportHash).toBe(b.reportHash);
    const { reportHash, ...body } = a;
    expect(hashCanonical(body)).toBe(reportHash);
  });

  it('rejects unknown or malformed manifest fields', () => {
    expect(() => runPolicyAudit({ ...OPEN, extra: 1 })).toThrow();
    expect(() => runPolicyAudit({ ...OPEN, maxPerTransferUnits: '-5' })).toThrow();
    expect(() => runPolicyAudit({ ...OPEN, name: '<script>' })).toThrow();
    expect(ManifestSchema.safeParse(OPEN).success).toBe(true);
  });
});
