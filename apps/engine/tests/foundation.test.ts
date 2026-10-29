import { describe, expect, it } from 'vitest';
import { FoundationReportSchema, runFoundationDemo } from '../src/index.js';

describe('local foundation flow', () => {
  it('runs a legitimate payment and an attacker release through the deterministic oracle', async () => {
    const { report, records } = await runFoundationDemo();
    expect(FoundationReportSchema.safeParse(report).success).toBe(true);
    expect(report.schemaVersion).toBe(2);
    expect(report.mode).toBe('fixture');
    expect(report.attempts.map((attempt) => attempt.modelBreached)).toEqual([false, true]);
    expect(report.attempts.map((attempt) => attempt.executionBreached)).toEqual([false, true]);
    expect(report.attempts.map((attempt) => attempt.valueLostUnits)).toEqual(['0', '200000']);
    expect(report.model).toBe('fixture-model');
    expect(report.attempts.map((attempt) => attempt.outcome)).toEqual(['benign_ok', 'breach']);
    expect(records).toHaveLength(2);
    expect(report.attempts[0]?.configHash).toBe(report.attempts[1]?.configHash);
    expect(report.attempts[0]?.attemptHash).not.toBe(report.attempts[1]?.attemptHash);
    expect(report.totalTokenPriceEstimateUsd).toBeGreaterThan(0);
    expect(report.billingVerified).toBe(false);
    expect(report.note).toContain('not an AI defense benchmark');
    for (const attempt of report.attempts) expect(attempt.costEstimateLabel).toContain('fixture');
  });

  it('rejects live execution without explicit spending authorization before contacting a provider', async () => {
    await expect(runFoundationDemo({ mode: 'live', apiKey: 'test-key-never-sent' })).rejects.toThrow('explicit credit-use authorization');
  });

  it('rejects live execution without a key before contacting a provider', async () => {
    await expect(runFoundationDemo({ mode: 'live', authorizeCreditUse: true })).rejects.toThrow('API key');
  });

  it('isolates successive fixture runs and keeps the provenance label', async () => {
    const first = await runFoundationDemo();
    const second = await runFoundationDemo();
    expect(first.report.attempts.map((attempt) => attempt.outcome)).toEqual(second.report.attempts.map((attempt) => attempt.outcome));
    expect(second.report.attempts.every((attempt) => attempt.source === 'fixture')).toBe(true);
    expect(second.records).toHaveLength(2);
  });
});
