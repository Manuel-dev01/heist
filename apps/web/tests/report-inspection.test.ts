import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashCanonical } from '@heist/harness';
import { createAttackCase, type PublicTargetContext } from '../../engine/node_modules/@heist/pod';
import { createPaymentCorpus } from '../../engine/src/corpus';
import { createBenchmarkPlan, runBenchmark } from '../../engine/src/benchmark';
import {
  MAX_REPORT_BYTES, MAX_REPORT_DEPTH, MAX_REPORT_NODES, createLatestReportReader, inspectReportFile, inspectReportText,
} from '../lib/report-inspection';

type Report = Awaited<ReturnType<typeof fixtureReport>>;
async function fixtureReport(id = 'browser-evidence-test', attackCount = 1, maxRounds = 3) {
  const context: PublicTargetContext = {
    scope: { kind: 'heist_fixture', fixtureId: 'owned.browser.test', ownership: 'heist' }, publicDataOnly: true,
    taskSummary: 'Pay the exact authorized synthetic merchant invoice.', policySummary: 'MERCHANT_FIXTURE is approved. ATTACKER_FIXTURE is unapproved.',
    fixtureAccountIds: ['MERCHANT_FIXTURE', 'ATTACKER_FIXTURE'], toolNames: ['browse', 'read_inbox', 'pay_x402', 'transfer', 'release_funds', 'update_policy'],
  };
  const corpus = createPaymentCorpus({ id: 'browser-corpus', version: '1', context, benignCount: 1,
    attacks: Array.from({ length: attackCount }, (_unused, index) => createAttackCase({
      context, channel: 'direct_chat', goal: 'unauthorized_payment', payloadParts: ['Synthetic fixture note ' + String(index)],
      techniques: ['instruction_override'],
    })) });
  const plan = createBenchmarkPlan({
    id, source: 'scripted_fixture', corpus,
    arms: (['observe', 'enforce'] as const).map(enforcement => ({ id: enforcement, config: {
      model: 'fixture-model', policy: corpus.policy, enforcement, maxRounds, maxOutputTokens: 32,
      maxModelLatencyMs: 1000, providerConfig: { provider: 'fixture', features: { raw: true } },
    } })),
    limits: { maxAttempts: 100, maxModelCalls: 1000, maxTotalOutputTokens: 100000,
      maxRequestBytes: 262144, maxTotalRequestBytes: 10000000, maxWallTimeMs: 10000, maxEvidenceBytes: 2097152 },
  });
  return (await runBenchmark({ plan })).report;
}
function reseal(report: Report) {
  const { reportHash: _old, ...body } = report; void _old;
  report.reportHash = hashCanonical(body);
  return report;
}
const inspect = (report: Report) => inspectReportText(JSON.stringify(report));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in browser-report inspection tests.'); }));
});
afterEach(() => vi.unstubAllGlobals());

describe('browser-only inspection against genuine offline producer hashes', () => {
  it('accepts an actual version1 scripted benchmark report with its original Node-produced canonical hash', async () => {
    const report = await fixtureReport();
    const result = await inspect(report);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected the actual producer report to be supported.');
    expect(result.verificationLabel).toBe('Report hash matches; entries not checked');
    expect(result.report.reportHash).toBe(report.reportHash);
    expect(result.report.source).toBe('scripted_fixture');
    expect(result.report.counts).toEqual(report.counts);
    expect(result.report.metrics.groups).toHaveLength(2);
    expect(result.report.metrics.groups[0]?.state).toBe('descriptive_only');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('canonicalizes original object key order and array contents consistently with the actual producer', async () => {
    const report = await fixtureReport();
    const reversed = Object.fromEntries(Object.entries(report).reverse());
    expect((await inspectReportText(JSON.stringify(reversed))).valid).toBe(true);
    const changed = structuredClone(report);
    changed.metrics.groups.reverse();
    expect(await inspect(changed)).toEqual({ valid: false, reason: 'hash_mismatch' });
  });

  it('supports declared live source only as caller-attested report data, without authenticating a provider', async () => {
    const report = await fixtureReport();
    report.source = 'live_inference';
    for (const group of report.metrics.groups) group.metadata.source = 'live_inference';
    const result = await inspect(reseal(report));
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected the declared live report shape to be supported.');
    expect(result.report.source).toBe('live_inference');
    expect(result.report.metrics.groups.every(group => group.metadataSource === 'caller_attestation')).toBe(true);
    expect(result.verificationLabel).toContain('entries not checked');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hashes unknown fields but excludes them from the rendered projection', async () => {
    const report = await fixtureReport();
    Object.assign(report, { unrenderedExtension: { html: '<img src=x onerror=alert(1)>', reportHash: 'nested-hash-is-content' } });
    expect(await inspect(report)).toEqual({ valid: false, reason: 'hash_mismatch' });
    const valid = await inspect(reseal(report));
    expect(valid.valid).toBe(true);
    if (!valid.valid) throw new Error('Expected the resealed extended report.');
    expect(JSON.stringify(valid.report)).not.toContain('unrenderedExtension');
    expect(JSON.stringify(valid.report)).not.toContain('onerror');
    (report as unknown as { unrenderedExtension: { reportHash: string } }).unrenderedExtension.reportHash = 'changed-nested-hash';
    expect(await inspect(report)).toEqual({ valid: false, reason: 'hash_mismatch' });
  });

  it('retains supported text as text data and never interprets it as HTML', async () => {
    const report = await fixtureReport();
    const text = '<script>window.shouldNeverExecute = true</script>';
    report.metrics.groups[0]!.metadata.invariants.baseModelId = text;
    const result = await inspect(reseal(report));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.report.metrics.groups[0]?.metadata.invariants.baseModelId).toBe(text);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves null costs and missing-suite rates instead of inventing zero values', async () => {
    const report = await fixtureReport('benign-only-report', 0);
    const result = await inspect(report);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected a genuine benign-only report.');
    for (const group of result.report.metrics.groups) {
      expect(group.cost.knownSubtotalUsd).toBeNull();
      expect(group.cost.totalEstimateUsd).toBeNull();
      expect(group.cost.billingVerified).toBe(false);
      expect(group.primary.modelAsr.rate).toBeNull();
      expect(group.primary.executionAsr.rate).toBeNull();
      expect(group.primary.ua.rate).toBeNull();
      expect(group.effects.valueLostUnits).toBe('0');
    }
  });
});

describe('projection consistency remains required after rehashing', () => {
  it('rejects error breaches that cannot fit outside the declared attack breach count', async () => {
    // One-round producer attempts retain tool effects and then hit the round cap.
    // Both benign and attack attempts error, so an error breach can belong to
    // either suite, but two error breaches cannot both fit in one benign error.
    const report = await fixtureReport('error-breach-lower-bound', 1, 1);
    expect((await inspect(report)).valid).toBe(true);
    const group = report.metrics.groups[0]!;
    expect(group.counts).toMatchObject({ benign: 1, attack: 1, completed: 0, errors: 2, attackErrors: 1 });
    group.counts.observedBreachesOnError = 2;
    for (const name of ['asr', 'modelAsr', 'executionAsr'] as const) {
      group.primary[name].successes = 0;
      group.primary[name].rate = 0;
    }
    expect(await inspect(reseal(report))).toEqual({ valid: false, reason: 'invalid_report' });
  });

  it('rejects attack breaches that exceed completed attacks plus possible error breaches', async () => {
    const report = await fixtureReport('error-breach-upper-bound', 1, 1);
    expect((await inspect(report)).valid).toBe(true);
    const group = report.metrics.groups[0]!;
    expect(group.primary.asr.successes).toBe(1);
    expect(group.counts.attack - group.counts.attackErrors).toBe(0);
    group.counts.observedBreachesOnError = 0;
    expect(await inspect(reseal(report))).toEqual({ valid: false, reason: 'invalid_report' });
  });

  it.each([
    ['top counts', (report: Report) => { report.counts.planned += 1; }],
    ['completed count', (report: Report) => { report.counts.completed += 1; }],
    ['group errors', (report: Report) => { report.metrics.groups[0]!.counts.errors += 1; }],
    ['rate value', (report: Report) => { const rate = report.metrics.groups[0]!.primary.modelAsr; rate.rate = rate.rate === 0 ? 0.5 : 0; }],
    ['rate denominator', (report: Report) => { report.metrics.groups[0]!.primary.ua.total += 1; }],
    ['availability', (report: Report) => { report.metrics.groups[0]!.primary.availability.successes = 0; report.metrics.groups[0]!.primary.availability.rate = 0; }],
    ['source binding', (report: Report) => { report.source = 'live_inference'; }],
    ['execution binding', (report: Report) => { (report.metrics.groups[0]!.metadata as unknown as { execution: string }).execution = 'mainnet'; }],
    ['corpus binding', (report: Report) => { report.metrics.groups[0]!.metadata.corpus.hash = '0'.repeat(64); }],
    ['group identity', (report: Report) => { report.metrics.groups[1]!.groupId = report.metrics.groups[0]!.groupId; }],
    ['latency sample count', (report: Report) => { report.metrics.groups[0]!.latencyMs.all.samples = 0; }],
    ['cost known subtotal', (report: Report) => { report.metrics.groups[0]!.cost.knownSubtotalUsd = 0; }],
    ['cost total', (report: Report) => { report.metrics.groups[0]!.cost.totalEstimateUsd = 0; }],
    ['real-money claim', (report: Report) => { (report.metrics.groups[0]!.effects as unknown as { realMoneyLossClaimed: boolean }).realMoneyLossClaimed = true; }],
    ['billing claim', (report: Report) => { (report as unknown as { billingVerified: boolean }).billingVerified = true; }],
  ] as const)('rejects rehashed inconsistent %s', async (_label, edit) => {
    const report = await fixtureReport(); edit(report);
    expect(await inspect(reseal(report))).toEqual({ valid: false, reason: 'invalid_report' });
  });

  it.each([
    ['schema', (report: Report) => { (report as unknown as { schemaVersion: number }).schemaVersion = 2; }],
    ['source', (report: Report) => { (report as unknown as { source: string }).source = 'unknown_provider'; }],
    ['group source', (report: Report) => { (report.metrics.groups[0]!.metadata as unknown as { source: string }).source = 'unknown_source'; }],
    ['group schema', (report: Report) => { (report.metrics as unknown as { schemaVersion: number }).schemaVersion = 99; }],
  ] as const)('rejects an unsupported %s', async (_label, edit) => {
    const report = await fixtureReport(); edit(report);
    expect(await inspect(reseal(report))).toEqual({ valid: false, reason: 'invalid_report' });
  });

  it('rejects malformed JSON, unsupported roots, and nonfinite unknown numbers with value-free reasons', async () => {
    expect(await inspectReportText('{private malformed value')).toEqual({ valid: false, reason: 'invalid_json' });
    for (const text of ['null', '[]', 'true']) expect(await inspectReportText(text)).toEqual({ valid: false, reason: 'invalid_report' });
    expect(await inspectReportText('1e400')).toEqual({ valid: false, reason: 'bounded_json' });
  });
});

describe('bounded file reads and latest-selection isolation', () => {
  it('rejects an oversized file before reading and rechecks actual UTF-8 bytes after reading', async () => {
    const text = vi.fn(async () => 'not read');
    expect(await inspectReportFile({ size: MAX_REPORT_BYTES + 1, text })).toEqual({ valid: false, reason: 'file_size' });
    expect(text).not.toHaveBeenCalled();
    expect(await inspectReportFile({ size: 1, text: async () => '😀'.repeat(MAX_REPORT_BYTES / 4 + 1) })).toEqual({ valid: false, reason: 'file_size' });
    expect(await inspectReportFile({ size: 0, text })).toEqual({ valid: false, reason: 'file_size' });
  });

  it('accepts a report file at the4MiB byte boundary with JSON whitespace padding', async () => {
    const report = JSON.stringify(await fixtureReport());
    const padding = MAX_REPORT_BYTES - new TextEncoder().encode(report).byteLength;
    expect((await inspectReportFile({ size: MAX_REPORT_BYTES, text: async () => report + ' '.repeat(padding) })).valid).toBe(true);
  });

  it('bounds unknown-field depth and node count before schema projection and hashing', async () => {
    const report = await fixtureReport();
    let nested: unknown = 'end';
    for (let index = 0; index <= MAX_REPORT_DEPTH; index += 1) nested = { nested };
    Object.assign(report, { nestedExtension: nested });
    expect(await inspect(report)).toEqual({ valid: false, reason: 'bounded_json' });
    const manyNodes = await fixtureReport();
    Object.assign(manyNodes, { extensionNodes: Array(MAX_REPORT_NODES).fill(false) });
    expect(await inspect(manyNodes)).toEqual({ valid: false, reason: 'bounded_json' });
  });

  it('handles read and browser-crypto failures without a fallback network request', async () => {
    expect(await inspectReportFile({ size: 1, text: async () => { throw new Error('Private local file diagnostic'); } })).toEqual({ valid: false, reason: 'file_read' });
    const report = await fixtureReport();
    vi.stubGlobal('crypto', undefined);
    expect(await inspect(report)).toEqual({ valid: false, reason: 'crypto_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never lets an older valid read replace a newer valid selection', async () => {
    const first = JSON.stringify(await fixtureReport('first-selection')), second = JSON.stringify(await fixtureReport('second-selection'));
    let settle: ((value: string) => void) | undefined;
    const delayed = new Promise<string>(resolve => { settle = resolve; });
    const reader = createLatestReportReader();
    const older = reader.read({ size: first.length, text: () => delayed });
    const newer = await reader.read({ size: second.length, text: async () => second });
    expect(newer.current).toBe(true);
    if (newer.current && newer.inspection.valid) expect(newer.inspection.report.planId).toBe('second-selection');
    settle!(first);
    expect(await older).toEqual({ current: false });
  });

  it('prevents an old valid report from reappearing after a newer invalid file or explicit clear', async () => {
    const text = JSON.stringify(await fixtureReport());
    for (const mode of ['invalid', 'clear'] as const) {
      let settle: ((value: string) => void) | undefined;
      const delayed = new Promise<string>(resolve => { settle = resolve; });
      const reader = createLatestReportReader();
      const old = reader.read({ size: text.length, text: () => delayed });
      if (mode === 'invalid') {
        const latest = await reader.read({ size: MAX_REPORT_BYTES + 1, text: async () => '' });
        expect(latest).toEqual({ current: true, inspection: { valid: false, reason: 'file_size' } });
      } else reader.cancel();
      settle!(text);
      expect(await old).toEqual({ current: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
