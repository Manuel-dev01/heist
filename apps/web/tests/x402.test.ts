import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/x402/payout/route';

const PAYTO = '0x000000000000000000000000000000000000dEaD', USDCE = '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const url = (q: string) => 'https://heist-khaki.vercel.app/api/x402/payout' + q;
const pay = (auth: unknown) => Buffer.from(JSON.stringify({ authorization: auth, signature: '0xabc' })).toString('base64');
const post = (q: string, payment: string) => POST(new Request(url(q), { method: 'POST', headers: { 'x-payment': payment } }));
const facilitator = (verify: unknown, settle: unknown, status = 200) => vi.fn(async (u: string) => new Response(JSON.stringify(String(u).endsWith('/v2/verify') ? verify : settle), { status }));

describe('HEIST x402 vault payout', () => {
  it('quotes pinned gokite-aa requirements by default; callers cannot choose network or asset', async () => {
    vi.stubEnv('KITE_X402_PAYTO', PAYTO);
    const r = await GET(new Request(url('?amount=1.5&ref=over-cap&network=evil&asset=0x0000000000000000000000000000000000000001')));
    expect(r.status).toBe(402);
    const b = await r.json();
    expect(b.accepts[0]).toMatchObject({ scheme: 'gokite-aa', network: 'eip155:2366', asset: USDCE, maxAmountRequired: '1500000', payTo: PAYTO });
    expect((await GET(new Request(url('')))).status).toBe(402);
  });
  it('refuses amounts outside the test range and an unconfigured payTo', async () => {
    vi.stubEnv('KITE_X402_PAYTO', PAYTO);
    for (const a of ['11', '0', 'abc']) expect((await GET(new Request(url('?amount=' + a)))).status).toBe(400);
    vi.stubEnv('KITE_X402_PAYTO', '');
    expect(await (await GET(new Request(url('?amount=0.05')))).json()).toEqual({ error: 'seller_not_configured' });
  });
  it('rejects payments not bound to the quote before calling the facilitator', async () => {
    vi.stubEnv('KITE_X402_PAYTO', PAYTO);
    const f = facilitator({ isValid: true }, { success: true }); vi.stubGlobal('fetch', f);
    for (const auth of [{ to: '0x0000000000000000000000000000000000000002', value: '50000' }, { to: PAYTO, value: '49999' }, { value: '50000' }, null]) {
      const r = await post('?amount=0.05', pay(auth));
      expect(r.status).toBe(402);
      expect((await r.json()).error).toBe('payment_not_bound_to_requirements');
    }
    expect(f).not.toHaveBeenCalled();
    expect((await post('?amount=0.05', '%%%notbase64')).status).toBe(402);
  });
  it('never authorizes on HTTP status alone', async () => {
    vi.stubEnv('KITE_X402_PAYTO', PAYTO);
    for (const [v, s] of [[{ isValid: false }, { success: true }], [{ isValid: true }, { success: false }], [{}, {}]]) {
      vi.stubGlobal('fetch', facilitator(v, s));
      const r = await post('?amount=0.05', pay({ to: PAYTO, value: '50000' }));
      expect(r.status).toBe(402);
      expect((await r.json()).receipt.paid).toBe(false);
    }
  });
  it('authorizes only when bound, verified and settled', async () => {
    vi.stubEnv('KITE_X402_PAYTO', PAYTO);
    const f = facilitator({ isValid: true }, { success: true }); vi.stubGlobal('fetch', f);
    const r = await post('?amount=0.05', pay({ to: PAYTO.toLowerCase(), value: '50000' }));
    expect(r.status).toBe(200);
    expect((await r.json()).receipt.paid).toBe(true);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.paymentRequirements).toMatchObject({ payTo: PAYTO, maxAmountRequired: '50000', network: 'eip155:2366' });
  });
});
