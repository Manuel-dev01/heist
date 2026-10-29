import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseBenchmarkCorpus } from './corpus.js';
import { createOfflineBenchmarkPlan } from './benchmark-demo.js';
import { previewBenchmarkPlan, runBenchmark } from './benchmark.js';

// This CLI exposes offline rehearsal only. Live inference has a separately authorized library boundary.
const flags = process.argv.slice(2);
let corpusPath: string | undefined, runId: string | undefined;
try {
  const seen = new Set<string>();
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i], value = flags[i + 1];
    if (!flag || !['--corpus', '--run-id'].includes(flag) || seen.has(flag) || !value || value.startsWith('--')) throw new Error();
    seen.add(flag); if (flag === '--corpus') corpusPath = value; else runId = value;
  }
  const id = runId ?? 'offline-' + new Date().toISOString().replace(/[^0-9TZ]/g, '') + '-' + randomUUID().slice(0, 8);
  let corpus;
  if (corpusPath) {
    const input = resolve(corpusPath), info = await stat(input);
    if (!info.isFile() || info.size > 4194304) throw new Error();
    corpus = parseBenchmarkCorpus(JSON.parse(await readFile(input, 'utf8')));
  }
  const plan = createOfflineBenchmarkPlan(id, corpus);
  const preview = previewBenchmarkPlan(plan);
  const root = resolve(process.cwd(), '.heist', 'benchmarks');
  await mkdir(root, { recursive: true });
  const directory = resolve(root, plan.id);
  if (!directory.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error();
  // Exclusive directory creation refuses accidental paid/offline slot replay and never overwrites prior evidence.
  await mkdir(directory, { recursive: false });
  await writeFile(resolve(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'started.json'), JSON.stringify({ startedAt: new Date().toISOString(), planHash: plan.planHash, source: plan.source, plannedAttempts: preview.plannedAttempts }) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'journal.jsonl'), '', { flag: 'wx' });
  await mkdir(resolve(directory, 'entries'));
  const result = await runBenchmark({ plan, onEntry: async (entry, index) => {
    if (!/^[a-f0-9]{64}$/.test(entry.record.attemptHash)) throw new Error();
    const name = String(index).padStart(5, '0') + '-' + entry.record.attemptHash + '.json';
    await writeFile(resolve(directory, 'entries', name), JSON.stringify(entry, null, 2) + '\n', { flag: 'wx' });
    await appendFile(resolve(directory, 'journal.jsonl'), JSON.stringify({ index, name, attemptHash: entry.record.attemptHash }) + '\n');
  } });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(result.report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ source: result.report.source, status: result.report.status, stopReason: result.report.stopReason,
    counts: result.report.counts, budget: result.report.budget, reportHash: result.report.reportHash,
    outputDirectory: directory, note: 'Scripted oracle/pipeline rehearsal. No provider request or AI defense-effectiveness result.' }, null, 2) + '\n');
  if (result.report.status !== 'completed' || result.report.counts.errors > 0) process.exitCode = 1;
} catch {
  process.stderr.write('Offline benchmark failed. Use only --corpus PATH and --run-id ID; check local integrity and exclusive output directory. No live mode is available in this CLI.\n');
  process.exitCode = 1;
}
