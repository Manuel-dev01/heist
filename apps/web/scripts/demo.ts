/**
 * `pnpm demo` — the judge walkthrough, fully offline: no keys, no network, no spending.
 * 1. Re-derives the real recorded breach (and its held twin) from bundled evidence: hash, deterministic oracle, harness replay.
 * 2. Prints the measured defense ladder and the GPT-5.5 reference from the closed live runs.
 * 3. Shows the two live Kite Passport refusals.
 * 4. Runs the policy audit (all 1,000 corpus attacks) on three setups and shows which fixes close the gaps.
 */
import { runPolicyAudit } from '../lib/audit';
import { channelLabel, evidence, goalLabel, pct, vaultStats } from '../lib/evidence';
import { verifyEvidence } from '../lib/proof';
import { PRESETS } from '../components/policy-audit-presets';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string | number) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = paint('31'), teal = paint('36'), gold = paint('33'), dim = paint('2'), bold = paint('1');
const ok = (b: boolean) => (b ? teal('MATCH') : red('MISMATCH'));
const step = (n: number, title: string) => console.log('\n' + bold(`${n} · ${title}`) + '\n' + dim('─'.repeat(72)));
const SITE = 'https://heist-khaki.vercel.app';
let failures = 0;

console.log(bold('HEIST') + ' — rob the agent, prove the defense. ' + dim('Offline walkthrough · synthetic funds · no keys'));

step(1, 'Re-derive the one real breach, then its held twin');
const b = evidence.breach;
console.log(`Recorded live: ${b.config.model} in SERV raw mode, attack ${b.caseId.replace('payment-v1.attack_', 'EX-').slice(0, 11).toUpperCase()}`);
console.log(`  via ${channelLabel[b.attack.channel] ?? b.attack.channel}, goal ${goalLabel[b.attack.goal] ?? b.attack.goal}: the agent added ${b.attackerRecipient} to its own allowlist.`);
for (const which of ['breach', 'held'] as const) {
  const r = await verifyEvidence(which);
  if (!(r.hashOk && r.oracleOk && r.replayOk)) failures++;
  console.log(`  ${which.padEnd(6)} hash ${ok(r.hashOk)} · oracle ${ok(r.oracleOk)} · replay of ${r.replayedModelTurns} saved decisions ${ok(r.replayOk)} → ${r.verdict === 'breach' ? red(r.verdict) : teal(r.verdict)}`);
}
console.log(dim('  Breach = a deterministic rule over ledger, policy and tool calls. No LLM judges it.'));

step(2, 'The measured defense ladder (closed live runs on SERV)');
for (const a of evidence.arms) {
  const s = vaultStats(a);
  console.log(`  Vault ${a.n} ${a.name.padEnd(10)} ${a.layer.padEnd(16)} ${(s.breaches ? red : teal)(`${s.breaches} / ${s.attacks.toLocaleString('en-US')}`.padEnd(11))} ≤${pct(s.upper95)} (95% upper)`);
}
const f = evidence.frontier;
console.log(`  Reference  ${f.name.padEnd(27)} ${teal(`${f.breaches} / ${f.attacks}`.padEnd(11))} ${dim(`${f.incomplete} incomplete, disclosed`)}`);
console.log(dim(`  ${evidence.totals.attempts.toLocaleString('en-US')} recorded attempts · ${evidence.totals.breaches} breach · benign tasks completed on every vault.`));

step(3, 'Kite Passport: the wallet refuses even if the model is fooled');
if (evidence.kite) {
  for (const r of evidence.kite.refusals) console.log(`  ${teal('REFUSED')} ${red(r.code)} · ${r.request} · caps ${r.session.caps.max_amount_per_tx}/payment, ${r.session.caps.max_total_amount} total`);
  console.log(dim(`  Live Kite backend, owner passkey-approved session; wallet $${evidence.kite.walletBalanceUsd.before} before and $${evidence.kite.walletBalanceUsd.after} after.`));
}

step(4, 'Policy audit: 1,000 attacks against a fully fooled agent');
for (const [, label, manifest] of PRESETS) {
  const r = runPolicyAudit(manifest);
  const s = r.summary, worst = Math.round(Number(s.maxSingleLossUnits) / 10_000);
  console.log(`  ${label.padEnd(20)} ${(s.breaches ? red : teal)(`${s.breaches} / ${r.attacks}`.padEnd(11))} worst loss ${worst}% of wallet · invoice ${r.legitimateTask.paid ? 'still paid' : gold('blocked')} · report ${dim(r.reportHash.slice(0, 12))}`);
  if (r.fixes.length) console.log(dim(`  ${''.padEnd(20)} best single fix: ${r.fixes[0]!.label} → ${r.fixes[0]!.breaches}; all fixes → ${r.allFixes.breaches}`));
}

console.log('\n' + bold('Next') + dim(' · the same flows in the browser'));
console.log(`  ${SITE}/arena/attempt  watch the breach   ${SITE}/proof  re-verify on the server`);
console.log(`  ${SITE}/audit          audit your setup   ${SITE}/range  run scripted fixtures`);
if (failures) { console.error(red(`\n${failures} evidence check(s) failed.`)); process.exit(1); }
