/**
 * `pnpm verify:runs [bundle.json.gz]` — re-derives every published number from the full live-run bundle.
 *
 * 1. Fetches the release asset (or uses a local copy) and checks its pinned SHA-256.
 * 2. Re-validates each frozen run plan, including its plan hash and corpus.
 * 3. For all 5,383 attempt records: recomputes the record hash, re-runs the deterministic oracle and
 *    replays the saved model decisions through the real harness (including runs that ended in an error).
 * 4. Recomputes each vault's breaches, benign completion and 95% upper bound, and compares them with
 *    what the site shows (apps/web/data/evidence.json).
 * Offline after the download. No keys. Exits non-zero on any mismatch.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildMerkleBatch, canonicalJson, evaluateOutcome, hashAttemptRecord, runAttempt, type AttemptRecord, type HarnessConfigInput, type TaskInput } from '@heist/harness';
import { parseBenchmarkPlan } from '../../engine/src/benchmark';
import { evidence } from '../lib/evidence';
import { ANCHOR } from '../lib/anchor';

const RELEASE_URL = 'https://github.com/Manuel-dev01/heist/releases/download/runs-v1/heist-runs-v1.json.gz';
const BUNDLE_SHA256 = 'fa5d38719cdb9f486b9027061ee90069e72fc884f2cf99c2e3bbd2d49c8b7cbb';
const DEFAULT_PATH = '.heist/release/heist-runs-v1.json.gz';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string | number) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = paint('31'), teal = paint('36'), dim = paint('2'), bold = paint('1');
const mark = (ok: boolean) => (ok ? teal('OK') : red('MISMATCH'));

interface Entry { armId: string; caseId: string; trialId: string; record: AttemptRecord; metadata: { suite: 'attack' | 'benign'; corpus: { hash: string } } }
interface Run { id: string; description: string; plan: unknown; entries: Entry[] }
interface Bundle { schemaVersion: 1; kind: 'heist_run_bundle'; counts: Record<string, number>; runs: Run[] }

async function loadBundle(): Promise<Buffer> {
  const path = process.argv[2] ?? DEFAULT_PATH;
  if (!existsSync(path)) {
    if (process.argv[2]) throw new Error('Bundle not found: ' + path);
    console.log(dim(`Downloading ${RELEASE_URL} (1.9 MB)`));
    const fallback = `Download it manually from ${RELEASE_URL} and run: pnpm verify:runs path/to/heist-runs-v1.json.gz`;
    let response: Response;
    try { response = await fetch(RELEASE_URL, { signal: AbortSignal.timeout(600_000) }); }
    catch { throw new Error('Download failed. ' + fallback); }
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}. ${fallback}`);
    const chunks: Uint8Array[] = [];
    let received = 0, shown = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk); received += chunk.byteLength;
        if (received - shown >= 262_144) { shown = received; process.stdout.write(dim(`  ${(received / 1_048_576).toFixed(1)} MB\r`)); }
      }
    } catch { throw new Error('Download interrupted. ' + fallback); }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat(chunks));
  }
  return readFileSync(path);
}

/** Exact two-sided 95% Clopper-Pearson upper bound (same method as the published evidence). */
function upper95(k: number, n: number): number {
  if (k >= n) return 1;
  const cdf = (p: number) => { let s = 0, term = Math.pow(1 - p, n); for (let i = 0; i <= k; i++) { s += term; term = term * (n - i) / (i + 1) * p / (1 - p); } return s; };
  let lo = 0, hi = 1;
  for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (cdf(mid) > 0.025) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

async function replay(record: AttemptRecord, config: HarnessConfigInput, task: TaskInput, attackerRecipient: string): Promise<boolean> {
  let cursor = 0;
  try {
    const rebuilt = await runAttempt({
      config, task, attackerRecipient, identity: { id: record.id, ts: record.ts },
      client: { async complete(request) {
        const next = record.transcript.findIndex((m, i) => i >= cursor && m.role === 'assistant');
        if (next < 0 || canonicalJson(request.messages) !== canonicalJson(record.transcript.slice(0, next))) throw new Error('Saved decision prefix mismatch.');
        cursor = next + 1;
        const m = record.transcript[next]!;
        if (m.role !== 'assistant') throw new Error('role');
        return { model: String(config.model), message: { content: m.content, ...(m.toolCalls ? { toolCalls: structuredClone(m.toolCalls) } : {}) } };
      } },
    });
    const fields = ['oracle', 'ledger', 'policyBefore', 'policyAfter', 'toolEvents', 'transcript', 'outcome', 'rounds', 'taskHash', 'configHash', 'promptHash'] as const;
    return fields.every((f) => canonicalJson(rebuilt[f]) === canonicalJson(record[f]));
  } catch { return false; }
}

const gz = await loadBundle();
const sha = createHash('sha256').update(gz).digest('hex');
console.log(bold('HEIST run bundle') + dim(` · sha256 ${sha}`));
let failures = 0;
const fail = (msg: string) => { failures++; if (failures <= 20) console.log('  ' + red('✗ ') + msg); };
if (sha !== BUNDLE_SHA256) fail(`bundle hash ${sha} does not match the pinned release hash ${BUNDLE_SHA256}`);
const bundle = JSON.parse(gunzipSync(gz).toString('utf8')) as Bundle;
if (bundle.kind !== 'heist_run_bundle' || bundle.schemaVersion !== 1) throw new Error('Not a HEIST run bundle.');

const breached = (r: AttemptRecord) => r.oracle.modelBreached || r.oracle.executionBreached;
const byRun: Record<string, Entry[]> = {};
console.log('\n' + bold('1 · Plans and records') + '\n' + dim('─'.repeat(72)));
for (const run of bundle.runs) {
  let plan;
  try { plan = parseBenchmarkPlan(run.plan); } catch { fail(`${run.id}: plan failed validation (plan hash or corpus)`); continue; }
  const arms = new Map(plan.arms.map((a) => [a.id, a.config])), cases = new Map(plan.corpus.cases.map((c) => [c.id, c.task]));
  let hashOk = 0, oracleOk = 0, replayOk = 0, errorRecords = 0;
  for (const e of run.entries) {
    const r = e.record, config = arms.get(e.armId), task = cases.get(e.caseId);
    if (!config || !task) { fail(`${run.id}: entry ${e.caseId}/${e.armId} is not in its plan`); continue; }
    if (e.metadata.corpus.hash !== plan.corpus.corpusHash) fail(`${run.id}: entry ${e.caseId} names a different corpus`);
    if (hashAttemptRecord(r) === r.attemptHash) hashOk++; else fail(`${run.id}: record hash mismatch ${r.id}`);
    const assistants = r.transcript.filter((m) => m.role === 'assistant'), last = assistants.at(-1);
    const oracle = evaluateOutcome({
      task, attackerRecipient: plan.corpus.attackerRecipient, ledger: r.ledger, policyBefore: r.policyBefore, policyAfter: r.policyAfter, toolEvents: r.toolEvents,
      finalAnswer: last?.toolCalls?.length ? '' : last?.content ?? '',
      visibleOutputs: assistants.flatMap((m) => [...(m.content ? [m.content] : []), ...(m.toolCalls ?? []).map((c) => c.arguments)]),
    });
    if (canonicalJson(oracle) === canonicalJson(r.oracle)) oracleOk++; else fail(`${run.id}: oracle mismatch ${r.id}`);
    if (r.outcome === 'error') errorRecords++;
    if (await replay(r, config, task, plan.corpus.attackerRecipient)) replayOk++; else fail(`${run.id}: replay mismatch ${r.id}`);
  }
  byRun[run.id] = run.entries;
  const n = run.entries.length;
  console.log(`  ${run.id.padEnd(7)} ${String(n).padStart(5)} records · plan ${mark(true)} · hash ${hashOk}/${n} · oracle ${oracleOk}/${n} · replay ${replayOk}/${n}${errorRecords ? dim(` (incl. ${errorRecords} that ended in an error)`) : ''}`);
}

console.log('\n' + bold('2 · Recompute what the site shows') + '\n' + dim('─'.repeat(72)));
const d2 = byRun.D2 ?? [], d3 = byRun.D3 ?? [], fr5 = byRun['REF-v5'] ?? [], fr6 = byRun['REF-v6'] ?? [];
const sum = (es: Entry[]) => {
  const atk = es.filter((e) => e.metadata.suite === 'attack'), ben = es.filter((e) => e.metadata.suite === 'benign'), k = atk.filter((e) => breached(e.record)).length;
  return { attacks: atk.length, breaches: k, upper95: upper95(k, atk.length), utilityUnderAttack: atk.filter((e) => e.record.oracle.utilitySuccess).length, benign: ben.length, benignOk: ben.filter((e) => e.record.oracle.utilitySuccess).length, incomplete: atk.filter((e) => e.record.outcome === 'error').length };
};
const compare = (label: string, got: ReturnType<typeof sum>, shown: { attacks: number; breaches: number; upper95: number; utilityUnderAttack: number; benign?: number; benignOk?: number; incomplete?: number }) => {
  const ok = got.attacks === shown.attacks && got.breaches === shown.breaches && Math.abs(got.upper95 - shown.upper95) < 1e-12 && got.utilityUnderAttack === shown.utilityUnderAttack
    && (shown.benign === undefined || (got.benign === shown.benign && got.benignOk === shown.benignOk)) && (shown.incomplete === undefined || got.incomplete === shown.incomplete);
  if (!ok) fail(`${label}: recomputed ${JSON.stringify(got)} differs from the site ${JSON.stringify(shown)}`);
  console.log(`  ${label.padEnd(28)} ${(got.breaches ? red : teal)(`${got.breaches} / ${got.attacks}`.padEnd(11))} ≤${(got.upper95 * 100).toFixed(2)}% · UA ${((got.utilityUnderAttack / got.attacks) * 100).toFixed(1)}%${got.benign ? ` · benign ${got.benignOk}/${got.benign}` : ''}${got.incomplete ? dim(` · ${got.incomplete} incomplete`) : ''} · ${mark(ok)}`);
};
for (const arm of evidence.arms) compare(`Vault ${arm.n} ${arm.name} (D3)`, sum(d3.filter((e) => e.armId === arm.id)), arm);
const rawAll = sum([...d2, ...d3.filter((e) => e.armId === 'raw')].filter((e) => e.metadata.suite === 'attack'));
compare('Vault 00 raw, D2 + D3', rawAll, evidence.arms[0]!.combined!);
compare('GPT-5.5 reference', sum([...fr5, ...fr6].filter((e) => e.metadata.suite === 'attack').concat(fr6.filter((e) => e.metadata.suite === 'benign'))), evidence.frontier);
const total = bundle.runs.reduce((s, r) => s + r.entries.length, 0), totalBreaches = bundle.runs.reduce((s, r) => s + r.entries.filter((e) => e.metadata.suite === 'attack' && breached(e.record)).length, 0);
const totalsOk = total === evidence.totals.attempts && totalBreaches === evidence.totals.breaches;
if (!totalsOk) fail(`totals: ${total} attempts / ${totalBreaches} breaches vs site ${evidence.totals.attempts} / ${evidence.totals.breaches}`);
console.log(`  ${'All runs'.padEnd(28)} ${total.toLocaleString('en-US')} attempts · ${totalBreaches} breach · ${mark(totalsOk)}`);
const breach = [...d2, ...d3].find((e) => e.metadata.suite === 'attack' && breached(e.record));
if (breach) console.log(dim(`  The one breach: ${breach.caseId} on ${breach.armId}, record ${breach.record.attemptHash.slice(0, 16)}… (same as /proof)`));

console.log('\n' + bold('3 · On-chain anchor (Kite testnet)') + '\n' + dim('─'.repeat(72)));
// Recompute every run root and the top root from the records, then read the anchoring transaction from Kite's chain.
const runRoots = bundle.runs.map((r) => ({ id: r.id, rootHash: buildMerkleBatch(r.entries.map((e) => e.record.attemptHash)).rootHash }));
const topRoot = buildMerkleBatch(runRoots.map((r) => r.rootHash!)).rootHash;
const rootsOk = runRoots.every((r, i) => r.id === ANCHOR.runs[i]?.id && r.rootHash === ANCHOR.runs[i]?.rootHash) && topRoot === ANCHOR.topRoot;
if (!rootsOk) fail(`Merkle roots recomputed from the records do not match the anchored roots`);
console.log(`  Merkle roots recomputed from 5,383 records: top ${String(topRoot).slice(0, 16)}… · ${mark(rootsOk)}`);
try {
  const r = await fetch(ANCHOR.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [ANCHOR.txHash] }), signal: AbortSignal.timeout(20_000) });
  const tx = ((await r.json()) as { result?: { input?: string; blockNumber?: string } }).result;
  const onChain = tx?.input ? Buffer.from(tx.input.slice(2), 'hex').toString('utf8') : '';
  const expected = `HEIST:runs-v1:${ANCHOR.algorithm}:${topRoot}`, chainOk = onChain === expected;
  if (!chainOk) fail(`Kite testnet transaction ${ANCHOR.txHash} does not carry the recomputed root`);
  console.log(`  ${ANCHOR.network} block ${tx?.blockNumber ? parseInt(tx.blockNumber, 16) : '?'} · tx ${ANCHOR.txHash.slice(0, 14)}… carries the same root · ${mark(chainOk)}`);
  console.log(dim(`  ${ANCHOR.explorer}`));
} catch {
  console.log(dim(`  Could not reach ${ANCHOR.rpc} to read the anchor; roots were still recomputed. See ${ANCHOR.explorer}`));
}

if (failures) { console.error('\n' + red(`${failures} check(s) failed.`)); process.exit(1); }
console.log('\n' + teal('All published numbers re-derived from the raw records, and their root matches the Kite anchor.'));
