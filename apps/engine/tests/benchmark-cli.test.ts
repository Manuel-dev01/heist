import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hashAttemptRecord, hashCanonical, parseAttemptRecord } from '@heist/harness';
import { createPaymentCorpus } from '../src/corpus.js';
import { parseBenchmarkPlan, type BenchmarkEntry } from '../src/benchmark.js';
import { createDemoCorpus } from '../src/benchmark-demo.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../src/benchmark-cli.ts', import.meta.url));
const TSX_IMPORT = import.meta.resolve('tsx');
const TEST_RUN_ROOT = join(REPO_ROOT, '.heist', 'test-runs');
const TIMEOUT_MS = 45000;
const NETWORK_MARKER = 'HEIST_CLI_NETWORK_CALLS=';
const guard = [
  "import { createRequire, syncBuiltinESMExports } from 'node:module';",
  'const require = createRequire(' + JSON.stringify(CLI_PATH) + ');',
  'let calls = 0;',
  "const deny = () => { calls += 1; throw new Error('Network is forbidden in offline CLI integration tests.'); };",
  'globalThis.fetch = deny;',
  "for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = deny; api.get = deny; }",
  "const net = require('node:net'); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;",
  "require('node:tls').connect = deny;",
  'syncBuiltinESMExports();',
  "process.on('exit', () => process.stderr.write(" + JSON.stringify(NETWORK_MARKER) + " + String(calls) + '\\n'));",
].join('\n');
const GUARD_IMPORT = 'data:text/javascript,' + encodeURIComponent(guard);

type CliReport = Awaited<ReturnType<typeof import('../src/benchmark.js').runBenchmark>>['report'];
interface CliOutput {
  source: string; status: string; stopReason: string | null;
  counts: { planned: number; started: number; completed: number; errors: number; skipped: number };
  outputDirectory: string; reportHash: string; note: string;
}
interface ChildResult { code: number; stdout: string; stderr: string }

function childEnvironment(): NodeJS.ProcessEnv {
  // The child receives platform runtime paths only, with no inherited API keys,
  // provider settings, NODE_OPTIONS, or any env.local loader.
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test', TSX_DISABLE_CACHE: '1', NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'COMSPEC'])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  return environment;
}
async function temporaryDirectory(label: string): Promise<string> {
  await mkdir(TEST_RUN_ROOT, { recursive: true });
  return mkdtemp(join(TEST_RUN_ROOT, label + '-'));
}
async function runCli(cwd: string, args: string[]): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, ['--import', TSX_IMPORT, '--import', GUARD_IMPORT, CLI_PATH, ...args], {
      cwd, shell: false, env: childEnvironment(), timeout: TIMEOUT_MS, killSignal: 'SIGTERM', maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const result = error as { code?: number | string; killed?: boolean; stdout?: string | Buffer; stderr?: string | Buffer };
    if (result.killed || result.code === 'ETIMEDOUT') throw new Error('Offline benchmark CLI exceeded its explicit subprocess timeout.');
    return { code: typeof result.code === 'number' ? result.code : -1, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  }
}
function expectNoNetwork(result: ChildResult) {
  expect(result.stderr).toContain(NETWORK_MARKER + '0');
  expect(result.stderr).not.toMatch(/HEIST_CLI_NETWORK_CALLS=[1-9]/);
}
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }

describe('offline benchmark CLI integration', () => {
  it('persists a complete 100-attempt scripted rehearsal and refuses an identical run ID without changing evidence', async () => {
    const cwd = await temporaryDirectory('default');
    const first = await runCli(cwd, ['--run-id', 'cli-default-rehearsal']);
    expect(first.code, first.stderr).toBe(0);
    expectNoNetwork(first);
    const output = JSON.parse(first.stdout) as CliOutput;
    expect(output.source).toBe('scripted_fixture');
    expect(output.status).toBe('completed');
    expect(output.stopReason).toBeNull();
    expect(output.counts).toEqual({ planned: 100, started: 100, completed: 100, errors: 0, skipped: 0 });
    expect(output.note).toContain('No provider request');
    const directory = resolve(output.outputDirectory);
    expect(directory.startsWith(resolve(cwd) + sep)).toBe(true);
    const names = await readdir(directory);
    expect(names.sort()).toEqual(['entries', 'journal.jsonl', 'plan.json', 'report.json', 'started.json']);
    const planText = await readFile(join(directory, 'plan.json'), 'utf8');
    const reportText = await readFile(join(directory, 'report.json'), 'utf8');
    const journalText = await readFile(join(directory, 'journal.jsonl'), 'utf8');
    const startedText = await readFile(join(directory, 'started.json'), 'utf8');
    const plan = parseBenchmarkPlan(JSON.parse(planText));
    const report = JSON.parse(reportText) as CliReport;
    const started = JSON.parse(startedText) as { planHash: string; source: string; plannedAttempts: number };
    expect(plan.source).toBe('scripted_fixture');
    expect(report.source).toBe('scripted_fixture');
    expect(report.execution).toBe('simulated');
    expect(report.billingVerified).toBe(false);
    expect(report.planHash).toBe(plan.planHash);
    expect(report.corpusHash).toBe(plan.corpus.corpusHash);
    expect(report.metrics.acceptedUniqueAttempts).toBe(100);
    expect(report.metrics.exclusions).toEqual([]);
    expect(started).toMatchObject({ planHash: plan.planHash, source: 'scripted_fixture', plannedAttempts: 100 });
    const { reportHash, ...body } = report;
    expect(reportHash).toBe(hashCanonical(body));
    expect(output.reportHash).toBe(reportHash);
    const journal = journalText.trim().split('\n').map((line) => JSON.parse(line) as { index: number; name: string; attemptHash: string });
    expect(journal).toHaveLength(100);
    expect(journal.map((row) => row.index)).toEqual(Array.from({ length: 100 }, (_unused, index) => index));
    expect(new Set(journal.map((row) => row.name)).size).toBe(100);
    const entryNames = await readdir(join(directory, 'entries'));
    expect(entryNames.sort()).toEqual(journal.map((row) => row.name).sort());
    const originals = new Map<string, string>();
    for (const row of journal) {
      expect(row.name).toMatch(/^\d{5}-[a-f0-9]{64}\.json$/);
      const text = await readFile(join(directory, 'entries', row.name), 'utf8');
      const entry = JSON.parse(text) as BenchmarkEntry;
      expect(parseAttemptRecord(entry.record).ok).toBe(true);
      expect(entry.record.attemptHash).toBe(hashAttemptRecord(entry.record));
      expect(entry.record.attemptHash).toBe(row.attemptHash);
      expect(entry.metadata.source).toBe('scripted_fixture');
      expect(entry.metadata.execution).toBe('simulated');
      expect(entry.metadata.independence).toBe('not_attested');
      expect(report.entryReferences[row.index]).toMatchObject({
        armId: entry.armId, caseId: entry.caseId, trialId: entry.trialId,
        attemptHash: entry.record.attemptHash, metadataHash: hashCanonical(entry.metadata),
      });
      originals.set(row.name, text);
    }

    const firstInfo = await stat(join(directory, 'report.json'));
    const second = await runCli(cwd, ['--run-id', 'cli-default-rehearsal']);
    expect(second.code).not.toBe(0);
    expect(second.stdout).toBe('');
    expect(second.stderr).toContain('Offline benchmark failed');
    expectNoNetwork(second);
    expect(await readdir(join(cwd, '.heist', 'benchmarks'))).toEqual(['cli-default-rehearsal']);
    expect(await readFile(join(directory, 'plan.json'), 'utf8')).toBe(planText);
    expect(await readFile(join(directory, 'report.json'), 'utf8')).toBe(reportText);
    expect(await readFile(join(directory, 'journal.jsonl'), 'utf8')).toBe(journalText);
    expect(await readFile(join(directory, 'started.json'), 'utf8')).toBe(startedText);
    expect((await stat(join(directory, 'report.json'))).mtimeMs).toBe(firstInfo.mtimeMs);
    expect((await readdir(join(directory, 'entries'))).sort()).toEqual(entryNames.sort());
    for (const [name, text] of originals) expect(await readFile(join(directory, 'entries', name), 'utf8')).toBe(text);
  }, 60000);

  it.each([
    ['live mode', ['--live']],
    ['credit authorization', ['--authorize-credit-use']],
    ['duplicate run ID flag', ['--run-id', 'first', '--run-id', 'second']],
    ['duplicate corpus flag', ['--corpus', 'one.json', '--corpus', 'two.json']],
    ['missing run ID value', ['--run-id']],
    ['missing corpus value', ['--corpus']],
    ['flag in place of a value', ['--run-id', '--live']],
  ] as const)('rejects %s before creating output directories', async (_label, args) => {
    const cwd = await temporaryDirectory('invalid-flags');
    const result = await runCli(cwd, [...args]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No live mode is available');
    expectNoNetwork(result);
    expect(await readdir(cwd)).toEqual([]);
  }, 60000);

  it('accepts a valid custom corpus file with spaces in its path and remains offline', async () => {
    const cwd = await temporaryDirectory('custom');
    const custom = createPaymentCorpus({ id: 'custom-benign', version: '1', context: createDemoCorpus().context, attacks: [], benignCount: 1 });
    const path = join(cwd, 'custom corpus (local).json');
    await writeFile(path, JSON.stringify(custom), { flag: 'wx' });
    const result = await runCli(cwd, ['--corpus', path, '--run-id', 'custom-local']);
    expect(result.code, result.stderr).toBe(0);
    expectNoNetwork(result);
    const output = JSON.parse(result.stdout) as CliOutput;
    expect(output.counts).toEqual({ planned: 2, started: 2, completed: 2, errors: 0, skipped: 0 });
    const saved = parseBenchmarkPlan(await readJson(join(output.outputDirectory, 'plan.json')));
    expect(saved.corpus.corpusHash).toBe(custom.corpusHash);
    expect(saved.corpus.cases).toHaveLength(1);
  }, 60000);

  it('rejects rehashed derived-task tampering in a custom corpus before writing output', async () => {
    const cwd = await temporaryDirectory('tampered');
    const custom = createPaymentCorpus({ id: 'tampered-input', version: '1', context: createDemoCorpus().context, attacks: [], benignCount: 1 });
    custom.cases[0]!.task.authorizedPayments[0]!.recipient = 'ATTACKER_FIXTURE';
    const { corpusHash: _old, ...body } = custom; void _old;
    custom.corpusHash = hashCanonical(body);
    const path = join(cwd, 'rehashed but invalid.json');
    await writeFile(path, JSON.stringify(custom), { flag: 'wx' });
    const result = await runCli(cwd, ['--corpus', path, '--run-id', 'must-not-run']);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expectNoNetwork(result);
    expect(await readdir(cwd)).toEqual(['rehashed but invalid.json']);
  }, 60000);

  it('rejects a corpus file larger than 4 MiB before producing evidence', async () => {
    const cwd = await temporaryDirectory('oversize');
    const path = join(cwd, 'oversize.json');
    await writeFile(path, JSON.stringify({ padding: 'x'.repeat(4194305) }), { flag: 'wx' });
    expect((await stat(path)).size).toBeGreaterThan(4194304);
    const result = await runCli(cwd, ['--corpus', path, '--run-id', 'must-not-run']);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expectNoNetwork(result);
    expect(await readdir(cwd)).toEqual(['oversize.json']);
  }, 60000);
});
