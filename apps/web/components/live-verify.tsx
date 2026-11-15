import { C, css, mono } from '../lib/css';

interface CiRun { conclusion: string | null; updated_at: string; html_url: string; head_sha: string; run_number: number }

/**
 * Live signal: the latest completed CI run on main. Every run re-derives all 5,383 live records with
 * `pnpm verify:runs`, so a passing run means the published numbers were re-verified from scratch.
 * Public GitHub API, cached for five minutes; renders nothing if GitHub is unreachable.
 */
export async function LiveVerify() {
  let run: CiRun | undefined;
  try {
    const r = await fetch('https://api.github.com/repos/Manuel-dev01/heist/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'heist-site' }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000),
    });
    if (r.ok) run = ((await r.json()) as { workflow_runs?: CiRun[] }).workflow_runs?.[0];
  } catch { run = undefined; }
  if (!run || !/^[0-9a-f]{40}$/.test(run.head_sha) || !run.html_url.startsWith('https://github.com/Manuel-dev01/heist/')) return null;
  const ok = run.conclusion === 'success', col = ok ? C.teal : C.red;
  const when = new Date(run.updated_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return (
    <a href={run.html_url} target="_blank" rel="noopener noreferrer" style={css(`display:inline-flex;flex-wrap:wrap;align-items:center;gap:10px;align-self:flex-start;border:1px solid ${ok ? '#2e5a4d' : '#5a1d18'};background:${ok ? '#0c1714' : '#140807'};padding:9px 14px;font-family:${mono};font-size:11px;letter-spacing:.08em;color:${C.dim}`)}>
      <span style={css(`width:8px;height:8px;border-radius:50%;background:${col};box-shadow:0 0 10px ${col}`)} />
      <span style={css(`color:${col}`)}>{ok ? 'RE-VERIFIED LIVE' : 'LAST VERIFICATION FAILED'}</span>
      <span>CI #{run.run_number} · {ok ? 'all 5,383 records re-hashed, re-judged and replayed' : 'see the run for details'} · {when} · {run.head_sha.slice(0, 7)} ↗</span>
    </a>
  );
}
