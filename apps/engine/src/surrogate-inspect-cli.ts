import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, parse, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { inspectSurrogateText, MAX_SURROGATE_PLAN_FILE_BYTES, MAX_SURROGATE_RESULT_FILE_BYTES } from './surrogate-inspection.js';

// Read-only local files. This command has no inference, credential, env-file,
// provider-client construction, directory scan, persistence or live-mode branch.
async function readPlainJson(input: string, maximumBytes: number) {
  if (/^(?:\\\\|\/\/)/.test(input) || (process.platform === 'win32' && /:(?![\\/])/.test(input)) ||
      /^(?:\.env)(?:\.|$)/i.test(basename(input)) || !/\.json$/i.test(input)) throw new Error();
  const absolute = resolve(input), { root } = parse(absolute);
  if (root.startsWith('\\\\')) throw new Error();
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) throw new Error();
  }
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) throw new Error();
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    const unchanged = (info: typeof opened) => info.isFile() && info.dev === before.dev && info.ino === before.ino &&
      info.size === before.size && info.mtimeMs === before.mtimeMs && info.ctimeMs === before.ctimeMs;
    if (!unchanged(opened)) throw new Error();
    // One byte beyond the initial size detects growth without an unbounded read.
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== before.size || !unchanged(await handle.stat())) throw new Error();
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)), dev: before.dev, ino: before.ino };
  } finally { await handle.close(); }
}

try {
  const args = process.argv.slice(2), options = new Map<string, string>();
  if (args.length !== 4) throw new Error();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!, value = args[index + 1]!;
    if (!['--plan', '--result'].includes(flag) || options.has(flag) || !value || value.startsWith('--')) throw new Error();
    options.set(flag, value);
  }
  const planPath = options.get('--plan'), resultPath = options.get('--result');
  if (!planPath || !resultPath || resolve(planPath) === resolve(resultPath)) throw new Error();
  const plan = await readPlainJson(planPath, MAX_SURROGATE_PLAN_FILE_BYTES);
  const result = await readPlainJson(resultPath, MAX_SURROGATE_RESULT_FILE_BYTES);
  if (plan.dev === result.dev && plan.ino === result.ino) throw new Error();
  const inspection = inspectSurrogateText(plan.text, result.text);
  if (!inspection.valid) throw new Error();
  process.stdout.write(JSON.stringify(inspection.summary, null, 2) + '\n');
} catch {
  process.stderr.write('Adaptive inspection failed. Use --plan PATH.json --result PATH.json with two distinct, unchanged, plain local files (plan <=8 MiB; result <=32 MiB). No symlinks, credential files or live mode. No input values are printed.\n');
  process.exitCode = 1;
}
