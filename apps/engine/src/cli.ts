import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runFoundationDemo } from './index.js';

const flags = process.argv.slice(2);
const allowed = new Set(['--live', '--authorize-credit-use', '--raw']);
if (flags.some((flag) => !allowed.has(flag)) || new Set(flags).size !== flags.length) {
  process.stderr.write('Use only --live, --authorize-credit-use, and --raw. Default execution is offline.\n');
  process.exitCode = 1;
} else {
  try {
    const mode = flags.includes('--live') ? 'live' : 'fixture';
    const result = await runFoundationDemo({
      mode, authorizeCreditUse: flags.includes('--authorize-credit-use'), raw: flags.includes('--raw'),
      ...(process.env.SERV_API_KEY ? { apiKey: process.env.SERV_API_KEY } : {}),
    });
    const outputDir = resolve(process.cwd(), '.heist', 'attempts');
    await mkdir(outputDir, { recursive: true });
    for (const record of result.records) {
      await writeFile(resolve(outputDir, `${record.attemptHash}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' }).catch((error: unknown) => {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST') throw error;
      });
    }
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    if (result.report.attempts.some((attempt) => attempt.outcome === 'error')) process.exitCode = 1;
  } catch {
    process.stderr.write('Foundation run failed. Check configuration and authorization; provider errors are not printed.\n');
    process.exitCode = 1;
  }
}
