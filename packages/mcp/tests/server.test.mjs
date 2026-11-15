import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// A fake HEIST API, so the MCP server is tested without network access.
let api, base, lastAudit;
beforeAll(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/audit' && req.method === 'POST') {
        lastAudit = { body: JSON.parse(body), origin: req.headers.origin, secFetch: req.headers['sec-fetch-site'] };
        if (lastAudit.body.name === 'bad') { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_manifest', issues: ['name: bad'] })); }
        return res.end(JSON.stringify({ manifest: lastAudit.body, attacks: 1000, reportHash: 'a'.repeat(64), assumption: 'Worst case.',
          summary: { breaches: 829, held: 0, disrupted: 171, policyTakeovers: 229, lostToAttackerUnits: '1', overpaidUnits: '0', maxSingleLossUnits: '1000000' },
          byGoal: { policy_change: { attacks: 229, breaches: 229 } }, byChannel: { browse: { attacks: 257, breaches: 253 } }, legitimateTask: { paid: true, blockedBy: [] },
          topExploits: [{ id: 'EX-1', channel: 'chat', goal: 'policy_change', snippet: 'Ignore', policyChanged: true }],
          fixes: [{ id: 'lockPolicy', label: 'Lock policy writes', breaches: 600, legitimatePaid: true }], allFixes: { breaches: 0, legitimatePaid: true } }));
      }
      if (req.url === '/api/verify' && req.method === 'POST') return res.end(JSON.stringify({ valid: JSON.parse(body).record.ok === true, expectedHash: 'b'.repeat(64) }));
      if (req.url === '/api/proof' && req.method === 'GET') {
        const row = (which, verdict) => ({ which, attemptHash: 'c'.repeat(64), hashOk: true, oracleOk: true, replayOk: true, replayedModelTurns: 4, verdict });
        return res.end(JSON.stringify({ breach: row('breach', 'BREACHED'), held: row('held', 'HELD'), checkedAt: '2026-11-15T00:00:00Z' }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + api.address().port;
});
afterAll(() => api.close());

function session() {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], { env: { ...process.env, HEIST_URL: base }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map();
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  let n = 0;
  const call = (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { call, notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), close: () => child.kill() };
}

describe('HEIST MCP server', () => {
  it('initializes, lists three tools and answers ping', async () => {
    const s = session();
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect(init.result.serverInfo.name).toBe('heist');
    expect(init.result.protocolVersion).toBe('2025-06-18');
    s.notify('notifications/initialized');
    const list = await s.call('tools/list');
    expect(list.result.tools.map((t) => t.name)).toEqual(['heist_audit_policy', 'heist_verify_record', 'heist_proof_status']);
    expect((await s.call('ping')).result).toEqual({});
    expect((await s.call('nope')).error.code).toBe(-32601);
    s.close();
  });

  it('audits a setup as a non-browser client with defaults filled in', async () => {
    const s = session();
    const r = await s.call('tools/call', { name: 'heist_audit_policy', arguments: { name: 'probe', checks: { allowlist: true } } });
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toContain('Breaches: 829 / 1000');
    expect(r.result.content[0].text).toContain('Lock policy writes: 829 → 600 breaches');
    expect(r.result.structuredContent.reportHash).toMatch(/^a{64}$/);
    expect(lastAudit.body.checks).toEqual({ allowlist: true, invoiceMatch: false, perTransferCap: false, totalCap: false, lockPolicy: false });
    expect(lastAudit.body.tools).toEqual({ updatePolicy: true, releaseFunds: true, transfer: true });
    expect(lastAudit.origin).toBeUndefined();
    expect(lastAudit.secFetch).toBeUndefined();
    s.close();
  });

  it('surfaces API rejections as tool errors, verifies records and reports proof status', async () => {
    const s = session();
    const bad = await s.call('tools/call', { name: 'heist_audit_policy', arguments: { name: 'bad' } });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('invalid_manifest');
    expect((await s.call('tools/call', { name: 'heist_verify_record', arguments: { record: { ok: true } } })).result.content[0].text).toMatch(/^VALID/);
    expect((await s.call('tools/call', { name: 'heist_verify_record', arguments: { record: { ok: false } } })).result.content[0].text).toMatch(/^INVALID/);
    const proof = await s.call('tools/call', { name: 'heist_proof_status', arguments: {} });
    expect(proof.result.content[0].text).toContain('breach: hash MATCH · oracle MATCH · replay of 4 saved decisions MATCH → BREACHED');
    expect((await s.call('tools/call', { name: 'missing' })).error.code).toBe(-32602);
    s.close();
  });
});
