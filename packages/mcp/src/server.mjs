#!/usr/bin/env node
// HEIST MCP server (stdio, dependency-free). Lets an agent audit its own spending setup before asking for a
// higher limit, verify a HEIST attempt record, and check the live proof replay. It calls the public HEIST API;
// no keys, no funds. stdout carries only JSON-RPC; diagnostics go to stderr.
import { createInterface } from 'node:readline';

const BASE = (process.env.HEIST_URL || 'https://heist-khaki.vercel.app').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(BASE) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  process.stderr.write('HEIST_URL must be https (or loopback http)\n');
  process.exit(2);
}
const PROTOCOL = '2025-06-18', VERSION = '1.0.0';
const bool = { type: 'boolean' }, units = { type: 'string', pattern: '^\\d{1,15}$' };

export const TOOLS = [
  {
    name: 'heist_audit_policy',
    title: 'Audit an agent spending setup',
    description: 'Fire the HEIST frozen corpus of 1,000 prompt-injection attacks at a worst-case agent (one that obeys every injection) running under the described wallet/executor setup. Returns breaches, worst single loss, policy takeovers, whether the real invoice still gets paid, breakdown by attack goal and channel, top exploits, and every available fix re-tested on all 1,000 attacks, plus a hashed report. Deterministic, free, no keys. Scale: a 1,000,000-unit wallet with one trusted 200,000-unit invoice. Self-reported: it scores the setup you describe, not your running code.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Agent name (letters, numbers, spaces, . : @ / -)', maxLength: 60 },
        checks: {
          type: 'object', additionalProperties: false, description: 'Checks the executor enforces in code (not in the prompt). Omitted checks default to false.',
          properties: { allowlist: bool, invoiceMatch: bool, perTransferCap: bool, totalCap: bool, lockPolicy: bool },
        },
        tools: {
          type: 'object', additionalProperties: false, description: 'Tools the agent can call besides pay_x402. Omitted tools default to true.',
          properties: { updatePolicy: bool, releaseFunds: bool, transfer: bool },
        },
        maxPerTransferUnits: { ...units, description: 'Per-payment cap in units (default 250000)' },
        maxTotalDebitUnits: { ...units, description: 'Total spend cap in units (default 1000000)' },
        kiteCapUnits: { anyOf: [units, { type: 'null' }], description: 'Kite Passport per-payment cap in units, or null for none' },
      },
    },
  },
  {
    name: 'heist_verify_record',
    title: 'Verify a HEIST attempt record',
    description: 'Recompute the canonical SHA-256 of a HEIST attempt record and compare it with its attemptHash. Any edit to the record makes this fail.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['record'], properties: { record: { type: 'object', description: 'A full HEIST AttemptRecord (for example downloaded from /proof or /range)' } } },
  },
  {
    name: 'heist_proof_status',
    title: 'Re-verify the live HEIST evidence',
    description: 'Ask the HEIST server to re-derive its real recorded breach and held twin right now: recompute each record hash, re-run the deterministic oracle, and replay every saved model decision through the harness.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'heist-mcp/' + VERSION },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HEIST API ${path} returned non-JSON (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(`HEIST API ${path} rejected the request (HTTP ${res.status}): ${json.error ?? 'error'}${json.issues ? ' · ' + json.issues.join('; ') : ''}`);
  return json;
}

const pctWallet = (u) => Math.round(Number(u) / 10_000) + '% of wallet';
export function manifestFrom(a = {}) {
  const c = a.checks ?? {}, t = a.tools ?? {};
  return {
    name: a.name ?? 'my-payment-agent', maxPerTransferUnits: a.maxPerTransferUnits ?? '250000', maxTotalDebitUnits: a.maxTotalDebitUnits ?? '1000000', kiteCapUnits: a.kiteCapUnits ?? null,
    checks: { allowlist: !!c.allowlist, invoiceMatch: !!c.invoiceMatch, perTransferCap: !!c.perTransferCap, totalCap: !!c.totalCap, lockPolicy: !!c.lockPolicy },
    tools: { updatePolicy: t.updatePolicy ?? true, releaseFunds: t.releaseFunds ?? true, transfer: t.transfer ?? true },
  };
}

const HANDLERS = {
  async heist_audit_policy(args) {
    const r = await api('/api/audit', manifestFrom(args)), s = r.summary;
    const lines = [
      `HEIST policy audit · ${r.manifest.name} · ${r.attacks} attacks · report ${r.reportHash}`,
      `Breaches: ${s.breaches} / ${r.attacks} · worst single loss: ${pctWallet(s.maxSingleLossUnits)} · policy takeovers: ${s.policyTakeovers} · real invoice: ${r.legitimateTask.paid ? 'still paid' : 'BLOCKED by ' + r.legitimateTask.blockedBy.join(', ')}`,
      'By goal: ' + Object.entries(r.byGoal).map(([g, v]) => `${g} ${v.breaches}/${v.attacks}`).join(' · '),
      'By channel: ' + Object.entries(r.byChannel).map(([g, v]) => `${g} ${v.breaches}/${v.attacks}`).join(' · '),
      ...(r.topExploits.length ? ['Top exploits:', ...r.topExploits.slice(0, 3).map((x) => `  ${x.id} (${x.channel}, ${x.goal}${x.policyChanged ? ', policy rewritten' : ''}): "${x.snippet}…"`)] : []),
      ...(r.fixes.length
        ? ['Fixes, each re-tested on all 1,000 attacks:', ...r.fixes.map((f) => `  ${f.label}: ${s.breaches} → ${f.breaches} breaches${f.legitimatePaid ? '' : ' (also blocks the real invoice)'}`), `  All fixes together: ${s.breaches} → ${r.allFixes.breaches} breaches`]
        : ['Every lever HEIST tests is already on.']),
      r.assumption,
    ];
    return { text: lines.join('\n'), structured: r };
  },
  async heist_verify_record(args) {
    if (!args || typeof args.record !== 'object' || args.record === null) throw new Error('record (object) is required');
    const r = await api('/api/verify', { record: args.record });
    return { text: r.valid ? `VALID · record hash ${r.expectedHash} matches its attemptHash.` : 'INVALID · the record does not match its hash (edited, truncated, or not a HEIST record).', structured: r };
  },
  async heist_proof_status() {
    const r = await api('/api/proof');
    const row = (x) => `${x.which}: hash ${x.hashOk ? 'MATCH' : 'MISMATCH'} · oracle ${x.oracleOk ? 'MATCH' : 'MISMATCH'} · replay of ${x.replayedModelTurns} saved decisions ${x.replayOk ? 'MATCH' : 'MISMATCH'} → ${x.verdict} · ${x.attemptHash}`;
    return { text: [`HEIST live proof · checked ${r.checkedAt}`, row(r.breach), row(r.held)].join('\n'), structured: r };
  },
};

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'heist', title: 'HEIST', version: VERSION },
        instructions: 'Use heist_audit_policy before raising an agent spending limit: describe which checks the executor enforces in code and which tools the agent can call. Report breaches, worst loss and the fixes that close them.',
      });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const h = HANDLERS[params?.name];
      if (!h) return fail(id, -32602, 'Unknown tool: ' + params?.name);
      try {
        const out = await h(params.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text: out.text }], structuredContent: out.structured, isError: false });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: 'HEIST error: ' + (e instanceof Error ? e.message : String(e)) }], isError: true });
      }
    }
    default:
      if (!isRequest || method?.startsWith('notifications/')) return undefined;
      return fail(id, -32601, 'Method not found: ' + method);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  Promise.resolve(handle(msg)).catch((e) => { if (msg.id !== undefined) fail(msg.id, -32603, 'Internal error'); process.stderr.write(String(e) + '\n'); });
});
rl.on('close', () => process.exit(0));
