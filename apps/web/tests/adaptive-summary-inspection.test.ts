import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTIVE_SUMMARY_LABEL, MAX_ADAPTIVE_SUMMARY_BYTES, MAX_ADAPTIVE_SUMMARY_DEPTH, MAX_ADAPTIVE_SUMMARY_NODES,
  createLatestAdaptiveSummaryReader, inspectAdaptiveSummaryFile, inspectAdaptiveSummaryText, type AdaptiveSummary } from '../lib/adaptive-summary-inspection';

const hash = (number: number) => number.toString(16).padStart(64, '0');
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
function seal<T extends { summaryHash: string }>(value: T): T {
  const { summaryHash: _old, ...body } = value; void _old;
  value.summaryHash = createHash('sha256').update(canonical(body)).digest('hex'); return value;
}
function fixture(): AdaptiveSummary {
  return seal({ kind: 'adaptive_inspection_summary', schemaVersion: 1, valid: true, summaryHash: hash(0),
    verification: { scope: 'local_internal_consistency', entriesChecked: 1 }, planId: 'synthetic-summary', planHash: hash(1), resultHash: hash(2), seedCorpusHash: hash(3),
    source: 'scripted_fixture', sourceMetadata: 'caller_attestation', execution: 'simulated', models: { attacker: 'fixture-model', surrogate: 'fixture-model' },
    executionStatus: 'completed', stopReason: null, selectionStatus: 'frozen',
    counts: { screens: 1, completedScreens: 1, screenErrors: 0, refinements: 0, candidates: 1, eligibleCandidates: 1, selectedCandidates: 1, pendingBranches: 0 },
    budget: { callsReserved: 4, outputTokensReserved: 512, screensReserved: 1, refinementsReserved: 0, clientInvocations: 2,
      normalizedRequestBytes: 1024, evidenceBytes: 2000, requestedOutputTokensForInvocations: 256, maximumClientInvocations: 4, maximumRequestedOutputTokens: 512 },
    usage: { knownCalls: 2, unknownSettledCalls: 0, unobservedCalls: 0, inputTokensKnownSubtotal: '20', outputTokensKnownSubtotal: '10' },
    cost: { knownCalls: 1, unknownCalls: 1, knownSubtotalEstimateUsd: 0.00001, totalEstimateUsd: null, actualBilledUsd: null, billingVerified: false, guaranteedBillingCap: false },
    selection: { selectedCandidateHashes: [hash(4)], corpusHash: hash(5), untestedBenignTemplates: 2 },
    branches: [{ seedCaseId: 'payment-v1.synthetic', rootHash: hash(4), currentHash: hash(4), round: 0, state: 'goal_achieved' }],
    events: [{ kind: 'screen', slotId: 'root-01.round-0.screen', rootHash: hash(4), candidateHash: hash(4), round: 0, outcome: 'breach', errorCode: null,
      goalAchieved: true, utilitySuccess: false, valueLostUnits: '200000', callback: 'completed' }],
    limitations: ['Synthetic compact fixture. Original evidence is not present.'],
  });
}
const inspect = (summary: AdaptiveSummary) => inspectAdaptiveSummaryText(JSON.stringify(seal(summary)));
const file = (summary: AdaptiveSummary) => { const text = JSON.stringify(seal(summary)); return { size: new TextEncoder().encode(text).length, async text() { return text; } }; };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden.'); })); });
afterEach(() => vi.unstubAllGlobals());

describe('compact adaptive summary integrity', () => {
  it('agrees with an independently Node-produced hash while making no provider or evidence-authentication claim', async () => {
    const result = await inspect(fixture()); expect(result.valid).toBe(true);
    if (!result.valid) throw Error('Expected supported summary');
    expect(result.verificationLabel).toBe(ADAPTIVE_SUMMARY_LABEL);
    expect(result.verificationLabel).toContain('original plan/result not checked here');
    expect(result.summary.cost.totalEstimateUsd).toBeNull(); expect(result.summary.cost.actualBilledUsd).toBeNull();
    expect(result.summary.sourceMetadata).toBe('caller_attestation'); expect(fetch).not.toHaveBeenCalled();
  });
  it('retains array order, accepts reordered object keys, and hashes unknown and nested hash fields', async () => {
    const summary = seal({ ...fixture(), future: { summaryHash: hash(8), values: [1, 2] } });
    expect((await inspectAdaptiveSummaryText(JSON.stringify(Object.fromEntries(Object.entries(summary).reverse())))).valid).toBe(true);
    summary.future.summaryHash = hash(9);
    expect(await inspectAdaptiveSummaryText(JSON.stringify(summary))).toEqual({ valid: false, reason: 'hash_mismatch' });
    seal(summary); summary.future.values.reverse();
    expect(await inspectAdaptiveSummaryText(JSON.stringify(summary))).toEqual({ valid: false, reason: 'hash_mismatch' });
  });
  it('rejects changed content and older/unversioned CLI output', async () => {
    const changed = fixture(); changed.models.attacker = 'another-fixture';
    expect(await inspectAdaptiveSummaryText(JSON.stringify(changed))).toEqual({ valid: false, reason: 'hash_mismatch' });
    const { kind: _kind, summaryHash: _hash, ...old } = fixture(); void _kind; void _hash;
    expect(await inspectAdaptiveSummaryText(JSON.stringify(old))).toEqual({ valid: false, reason: 'invalid_summary' });
  });
  it.each([
    ['screen counts', (s: AdaptiveSummary) => { s.counts.screens = 2; }],
    ['completed counts', (s: AdaptiveSummary) => { s.counts.completedScreens = 0; }],
    ['checked entries', (s: AdaptiveSummary) => { s.verification.entriesChecked = 2; }],
    ['wrong root', (s: AdaptiveSummary) => { s.events[0]!.rootHash = hash(9); }],
    ['unqualified selection', (s: AdaptiveSummary) => { s.selection.selectedCandidateHashes = [hash(9)]; }],
    ['duplicate selection', (s: AdaptiveSummary) => { s.selection.selectedCandidateHashes.push(hash(4)); s.counts.selectedCandidates = 2; }],
    ['candidate count', (s: AdaptiveSummary) => { s.counts.candidates = 0; }],
    ['pending count', (s: AdaptiveSummary) => { s.counts.pendingBranches = 1; }],
    ['call reservations', (s: AdaptiveSummary) => { s.budget.callsReserved = 1; }],
    ['output reservations', (s: AdaptiveSummary) => { s.budget.requestedOutputTokensForInvocations = 513; }],
    ['usage coverage', (s: AdaptiveSummary) => { s.usage.unknownSettledCalls = 1; }],
    ['token coverage', (s: AdaptiveSummary) => { s.usage.inputTokensKnownSubtotal = null; }],
    ['cost coverage', (s: AdaptiveSummary) => { s.cost.knownCalls = 2; }],
    ['unknown total cost', (s: AdaptiveSummary) => { s.cost.totalEstimateUsd = 0.00001; }],
    ['billing claim', (s: AdaptiveSummary) => { Object.assign(s.cost, { billingVerified: true }); }],
    ['stop state', (s: AdaptiveSummary) => { s.executionStatus = 'stopped'; }],
    ['complete with stop reason', (s: AdaptiveSummary) => { s.stopReason = 'client_timeout'; }],
    ['stopped corpus', (s: AdaptiveSummary) => { s.executionStatus = 'stopped'; s.stopReason = 'client_timeout'; }],
    ['frozen without corpus', (s: AdaptiveSummary) => { s.selection.corpusHash = null; s.selection.untestedBenignTemplates = 0; }],
    ['error selection', (s: AdaptiveSummary) => { const event = s.events[0]!; if (event.kind === 'screen') event.outcome = 'error'; s.counts.completedScreens = 0; s.counts.screenErrors = 1; }],
  ])('rejects rehashed inconsistent %s', async (_name, mutate) => {
    const summary = fixture(); mutate(summary); expect(await inspect(summary)).toEqual({ valid: false, reason: 'invalid_summary' });
  });
  it('accepts stopped error evidence with retained utility/loss and an unknown settlement/cost', async () => {
    const summary = fixture(); summary.executionStatus = 'stopped'; summary.stopReason = 'client_timeout'; summary.selectionStatus = 'insufficient_candidates';
    Object.assign(summary.counts, { completedScreens: 0, screenErrors: 1, eligibleCandidates: 0, selectedCandidates: 0 });
    summary.selection = { selectedCandidateHashes: [], corpusHash: null, untestedBenignTemplates: 0 }; summary.branches[0]!.state = 'screen_error';
    const event = summary.events[0]!; if (event.kind !== 'screen') throw Error();
    Object.assign(event, { outcome: 'error', errorCode: 'max_rounds_exceeded', goalAchieved: true, utilitySuccess: true, valueLostUnits: '9' });
    summary.budget.clientInvocations = 1; summary.budget.requestedOutputTokensForInvocations = 128;
    summary.usage = { knownCalls: 0, unknownSettledCalls: 0, unobservedCalls: 1, inputTokensKnownSubtotal: null, outputTokensKnownSubtotal: null };
    summary.cost = { ...summary.cost, knownCalls: 0, unknownCalls: 1, knownSubtotalEstimateUsd: null };
    const result = await inspect(summary); expect(result.valid).toBe(true);
    if (result.valid) { expect(result.summary.events[0]).toMatchObject({ outcome: 'error', goalAchieved: true, utilitySuccess: true, valueLostUnits: '9' }); expect(result.summary.cost.totalEstimateUsd).toBeNull(); }
  });
  it('accepts completed underfill and stopped selection without inventing a frozen corpus', async () => {
    const underfilled = fixture(); underfilled.selectionStatus = 'insufficient_candidates'; underfilled.selection = { selectedCandidateHashes: [], corpusHash: null, untestedBenignTemplates: 0 };
    underfilled.counts.eligibleCandidates = 0; underfilled.counts.selectedCandidates = 0; underfilled.branches[0]!.state = 'exhausted';
    const screen = underfilled.events[0]!; if (screen.kind === 'screen') Object.assign(screen, { outcome: 'benign_ok', goalAchieved: false, utilitySuccess: true, valueLostUnits: '0' });
    expect((await inspect(underfilled)).valid).toBe(true);
    const stopped = fixture(); stopped.executionStatus = 'stopped'; stopped.stopReason = 'persistence_error'; stopped.selectionStatus = 'selected';
    stopped.selection.corpusHash = null; stopped.selection.untestedBenignTemplates = 0; stopped.events[0]!.callback = 'failed';
    expect((await inspect(stopped)).valid).toBe(true);
  });
  it('allows independent usage/cost coverage and genuine zero known estimates', async () => {
    const summary = fixture(); summary.cost = { ...summary.cost, knownCalls: 2, unknownCalls: 0, knownSubtotalEstimateUsd: 0, totalEstimateUsd: 0 };
    expect((await inspect(summary)).valid).toBe(true);
    summary.usage = { knownCalls: 0, unknownSettledCalls: 2, unobservedCalls: 0, inputTokensKnownSubtotal: null, outputTokensKnownSubtotal: null };
    expect((await inspect(summary)).valid).toBe(true);
  });
  it('accepts a genuine zero-call preview without claiming a zero bill', async () => {
    const summary = fixture(); summary.executionStatus = 'preview'; summary.selectionStatus = 'not_run'; summary.verification.entriesChecked = 0; summary.events = [];
    summary.counts = { screens: 0, completedScreens: 0, screenErrors: 0, refinements: 0, candidates: 1, eligibleCandidates: 0, selectedCandidates: 0, pendingBranches: 1 };
    summary.selection = { selectedCandidateHashes: [], corpusHash: null, untestedBenignTemplates: 0 }; summary.branches[0]!.state = 'pending';
    Object.assign(summary.budget, { callsReserved: 0, outputTokensReserved: 0, screensReserved: 0, refinementsReserved: 0, clientInvocations: 0, normalizedRequestBytes: 0, requestedOutputTokensForInvocations: 0 });
    summary.usage = { knownCalls: 0, unknownSettledCalls: 0, unobservedCalls: 0, inputTokensKnownSubtotal: null, outputTokensKnownSubtotal: null };
    summary.cost = { ...summary.cost, knownCalls: 0, unknownCalls: 0, knownSubtotalEstimateUsd: null, totalEstimateUsd: null };
    expect((await inspect(summary)).valid).toBe(true);
  });
  it.each(['duplicate', 'refusal', 'invalid', 'provider_error', 'budget_exhausted'] as const)('accepts a compact %s refinement without counting it as a screen error', async status => {
    const summary = fixture(), first = summary.events[0]!; if (first.kind !== 'screen') throw Error();
    Object.assign(first, { outcome: 'benign_ok', goalAchieved: false, utilitySuccess: true, valueLostUnits: '0' });
    summary.selectionStatus = 'insufficient_candidates'; summary.selection = { selectedCandidateHashes: [], corpusHash: null, untestedBenignTemplates: 0 };
    Object.assign(summary.counts, { refinements: 1, eligibleCandidates: 0, selectedCandidates: 0 });
    summary.verification.entriesChecked = 2; summary.events.push({ kind: 'refinement', slotId: 'root-01.round-1.refine', rootHash: hash(4), round: 1, parentHash: hash(4), childHash: status === 'duplicate' ? hash(4) : null, status, callback: 'completed' });
    summary.branches[0]!.round = 0; summary.branches[0]!.state = status === 'duplicate' ? 'duplicate' : status === 'refusal' ? 'refusal' : 'invalid';
    Object.assign(summary.budget, { callsReserved: 9, outputTokensReserved: 1152, screensReserved: 2, refinementsReserved: 1, clientInvocations: 3, requestedOutputTokensForInvocations: 384, maximumClientInvocations: 9, maximumRequestedOutputTokens: 1152 });
    summary.usage = { ...summary.usage, knownCalls: 3 }; summary.cost = { ...summary.cost, knownCalls: 0, unknownCalls: 3, knownSubtotalEstimateUsd: null };
    expect((await inspect(summary)).valid).toBe(true);
  });
  it.each([
    ['unrelated current candidate', (s: AdaptiveSummary) => { s.branches[0]!.currentHash = hash(99); }],
    ['contradictory terminal state', (s: AdaptiveSummary) => { s.branches[0]!.state = 'refusal'; }],
    ['invented global candidates', (s: AdaptiveSummary) => { s.counts.candidates = 128; }],
    ['unrelated initial screen', (s: AdaptiveSummary) => {
      const screen = s.events[0]!; if (screen.kind !== 'screen') throw Error();
      screen.candidateHash = hash(99); s.branches[0]!.currentHash = hash(99); s.selection.selectedCandidateHashes = [hash(99)];
    }],
    ['wrong initial round', (s: AdaptiveSummary) => { s.events[0]!.round = 1; s.events[0]!.slotId = 'root-01.round-1.screen'; s.branches[0]!.round = 1; }],
  ])('rejects rehashed compact lineage contradiction: %s', async (_name, mutate) => {
    const summary = fixture(); mutate(summary);
    expect(await inspect(summary)).toEqual({ valid: false, reason: 'invalid_summary' });
  });
  it('counts a newly refined unscreened child while retaining the last screened branch hash and round', async () => {
    const summary = fixture(), first = summary.events[0]!; if (first.kind !== 'screen') throw Error();
    Object.assign(first, { outcome: 'benign_ok', goalAchieved: false, utilitySuccess: true, valueLostUnits: '0' });
    summary.executionStatus = 'stopped'; summary.stopReason = 'persistence_error'; summary.selectionStatus = 'insufficient_candidates';
    summary.selection = { selectedCandidateHashes: [], corpusHash: null, untestedBenignTemplates: 0 };
    Object.assign(summary.counts, { candidates: 2, refinements: 1, eligibleCandidates: 0, selectedCandidates: 0, pendingBranches: 1 });
    summary.verification.entriesChecked = 2; summary.events.push({ kind: 'refinement', slotId: 'root-01.round-1.refine', rootHash: hash(4), round: 1, parentHash: hash(4), childHash: hash(6), status: 'refined', callback: 'failed' });
    summary.branches[0]!.state = 'active';
    Object.assign(summary.budget, { callsReserved: 9, outputTokensReserved: 1152, screensReserved: 2, refinementsReserved: 1, clientInvocations: 3, requestedOutputTokensForInvocations: 384, maximumClientInvocations: 9, maximumRequestedOutputTokens: 1152 });
    summary.usage = { ...summary.usage, knownCalls: 3 }; summary.cost = { ...summary.cost, knownCalls: 0, unknownCalls: 3, knownSubtotalEstimateUsd: null };
    expect((await inspect(summary)).valid).toBe(true);
    const wrongCurrent = structuredClone(summary); wrongCurrent.branches[0]!.currentHash = hash(6);
    expect(await inspect(wrongCurrent)).toEqual({ valid: false, reason: 'invalid_summary' });
    const wrongParent = structuredClone(summary), last = wrongParent.events[1]!; if (last.kind !== 'refinement') throw Error(); last.parentHash = hash(6);
    expect(await inspect(wrongParent)).toEqual({ valid: false, reason: 'invalid_summary' });
    const inventedDuplicate = structuredClone(summary), duplicate = inventedDuplicate.events[1]!; if (duplicate.kind !== 'refinement') throw Error(); duplicate.status = 'duplicate';
    expect(await inspect(inventedDuplicate)).toEqual({ valid: false, reason: 'invalid_summary' });
  });
});

describe('bounded browser input and selection lifecycle', () => {
  it('rejects malformed/empty/oversize inputs, deep/numerous nodes, and nonfinite numeric parsing', async () => {
    expect(await inspectAdaptiveSummaryText('{')).toEqual({ valid: false, reason: 'invalid_json' });
    expect(await inspectAdaptiveSummaryText('')).toEqual({ valid: false, reason: 'file_size' });
    expect(await inspectAdaptiveSummaryText('é'.repeat(MAX_ADAPTIVE_SUMMARY_BYTES / 2 + 1))).toEqual({ valid: false, reason: 'file_size' });
    expect(await inspectAdaptiveSummaryText('['.repeat(MAX_ADAPTIVE_SUMMARY_DEPTH + 1) + '0' + ']'.repeat(MAX_ADAPTIVE_SUMMARY_DEPTH + 1))).toEqual({ valid: false, reason: 'bounded_json' });
    expect(await inspectAdaptiveSummaryText(JSON.stringify(Array(MAX_ADAPTIVE_SUMMARY_NODES).fill(0)))).toEqual({ valid: false, reason: 'bounded_json' });
    expect(await inspectAdaptiveSummaryText('{"number":1e999}')).toEqual({ valid: false, reason: 'bounded_json' });
  });
  it('admits file size before reading and handles file/crypto failure without exposing input text', async () => {
    const read = vi.fn(async () => 'PRIVATE_INPUT_SENTINEL');
    expect(await inspectAdaptiveSummaryFile({ size: MAX_ADAPTIVE_SUMMARY_BYTES + 1, text: read })).toEqual({ valid: false, reason: 'file_size' }); expect(read).not.toHaveBeenCalled();
    expect(await inspectAdaptiveSummaryFile({ size: 1, text: async () => { throw Error('PRIVATE_INPUT_SENTINEL'); } })).toEqual({ valid: false, reason: 'file_read' });
    vi.stubGlobal('crypto', undefined);
    expect(await inspect(fixture())).toEqual({ valid: false, reason: 'crypto_unavailable' });
  });
  it('ignores a previous slow read after a newer selection, clear, or unmount', async () => {
    const reader = createLatestAdaptiveSummaryReader(); let resolve!: (text: string) => void;
    const delayed = reader.read({ size: 100, text: () => new Promise<string>(done => { resolve = done; }) });
    expect((await reader.read(file(fixture()))).current).toBe(true); resolve(JSON.stringify(fixture())); expect(await delayed).toEqual({ current: false });
    const clearing = reader.read(file(fixture())); reader.cancel(); expect(await clearing).toEqual({ current: false });
  });
  it('ignores an old completed file hash after the selected version changes', async () => {
    const original = webcrypto.subtle.digest.bind(webcrypto.subtle); let release!: () => void;
    const paused = new Promise<void>(done => { release = done; });
    vi.stubGlobal('crypto', { subtle: { async digest(...args: Parameters<typeof original>) { await paused; return original(...args); } } });
    const reader = createLatestAdaptiveSummaryReader(), pending = reader.read(file(fixture())); await Promise.resolve(); reader.cancel(); release();
    expect(await pending).toEqual({ current: false }); expect(fetch).not.toHaveBeenCalled();
  });
});
