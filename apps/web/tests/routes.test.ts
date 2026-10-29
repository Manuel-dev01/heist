import { describe, it, expect, vi } from 'vitest';
import { POST as practice } from '../app/api/practice/route';
import { POST as verify } from '../app/api/verify/route';
const request = (path: string, value: unknown) => new Request('http://127.0.0.1:3000/api/'+path, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
  body: JSON.stringify(value),
});
describe('actual local route handlers', () => {
  it('returns a synthetic record which verifies, then detects a tampered ledger', async () => {
    const response = await practice(request('practice', { scenario: 'attacker_release', enforcement: 'enforce', note: '<script>synthetic</script>' }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { record: { oracle: { modelBreached: boolean; executionBreached: boolean }; ledger: { availableBalanceUnits: string }; attemptHash: string }; report: { source: string } };
    expect(payload.report.source).toBe('fixture');
    expect(payload.record.oracle.modelBreached).toBe(true);
    expect(payload.record.oracle.executionBreached).toBe(false);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const verified = await verify(request('verify', { record: payload.record }));
    expect(await verified.json()).toMatchObject({ valid: true });
    payload.record.ledger.availableBalanceUnits='0';
    const tampered = await verify(request('verify', { record: payload.record }));
    expect(await tampered.json()).toMatchObject({ valid: false });
  });
  it('rejects live options and malformed records without echoing submitted secrets', async () => {
    const invalid = await practice(request('practice', { scenario: 'benign', enforcement: 'observe', apiKey: 'synthetic-value-not-a-key', live: true }));
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain('synthetic-value');
    const malformed = await verify(request('verify', { record: { apiKey: 'synthetic-value-not-a-key' } }));
    expect(await malformed.json()).toEqual({ valid: false });
  });
});


describe('route admission precedes body parsing', () => {
  it.each([
    { path: 'practice', route: practice, max: 30 },
    { path: 'verify', route: verify, max: 60 },
  ])('charges malformed local JSON and rejects an unread $path body at its limit', async ({ path, route, max }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    try {
      for (let index = 0; index < max; index++) {
        const invalidJson = new Request('http://127.0.0.1:3000/api/' + path, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' }, body: '{',
        });
        expect((await route(invalidJson)).status).toBe(400);
      }
      const blocked = new Request('http://127.0.0.1:3000/api/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
        body: new ReadableStream<Uint8Array>(), duplex: 'half',
      } as RequestInit);
      const response = await route(blocked);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: 'local_rate_limit' });
      expect(blocked.bodyUsed).toBe(false);
      await blocked.body?.cancel();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('rejects a hostile origin before charging the local quota', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2041-01-01T00:00:00.000Z'));
    try {
      for (let index = 0; index < 31; index++) {
        const rejected = new Request('http://127.0.0.1:3000/api/practice', {
          method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.invalid' }, body: '{}',
        });
        expect((await practice(rejected)).status).toBe(403);
      }
      expect((await practice(request('practice', { scenario: 'benign', enforcement: 'enforce' }))).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
});
