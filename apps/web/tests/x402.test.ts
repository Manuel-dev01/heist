import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/x402/payout/route';

const ASSET = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const call = (q: string, headers: Record<string, string> = {}) => GET(new Request('https://heist-khaki.vercel.app/api/x402/payout' + q, { headers }));

describe('HEIST x402 vault payout (Kite sandbox)', () => {
  it('quotes gokite-aa requirements in 6-decimal units to the configured payTo', async () => {
    vi.stubEnv('KITE_X402_PAYTO', '0x000000000000000000000000000000000000dEaD');
    const r = await call('?amount=1.5&ref=over-cap&network=kite-testnet&asset=' + ASSET);
    expect(r.status).toBe(402);
    const b = await r.json();
    expect(b.x402Version).toBe(1);
    expect(b.accepts[0]).toMatchObject({ scheme: 'gokite-aa', network: 'kite-testnet', maxAmountRequired: '1500000', asset: ASSET, payTo: '0x000000000000000000000000000000000000dEaD', merchantName: 'HEIST' });
  });
  it('refuses amounts outside the test range and unconfigured or malformed sellers', async () => {
    vi.stubEnv('KITE_X402_PAYTO', '0x000000000000000000000000000000000000dEaD');
    expect((await call('?amount=11&network=kite-testnet&asset=' + ASSET)).status).toBe(400);
    expect((await call('?amount=0&network=kite-testnet&asset=' + ASSET)).status).toBe(400);
    expect((await call('?amount=abc&network=kite-testnet&asset=' + ASSET)).status).toBe(400);
    expect((await call('?amount=0.05&network=Bad Net&asset=' + ASSET)).status).toBe(400);
    vi.stubEnv('KITE_X402_PAYTO', '');
    expect(await (await call('?amount=0.05&network=kite-testnet&asset=' + ASSET)).json()).toEqual({ error: 'seller_not_configured' });
  });
  it('never authorizes a payout the facilitator did not settle', async () => {
    vi.stubEnv('KITE_X402_PAYTO', '0x000000000000000000000000000000000000dEaD');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ isValid: false }), { status: 400 })));
    const payment = Buffer.from(JSON.stringify({ authorization: { value: '50000' }, signature: '0xabc' })).toString('base64');
    const r = await POST(new Request('https://heist-khaki.vercel.app/api/x402/payout?amount=0.05&network=kite-testnet&asset=' + ASSET, { method: 'POST', headers: { 'x-payment': payment } }));
    expect(r.status).toBe(402);
    expect((await r.json()).receipt).toMatchObject({ paid: false, settle: null, verify: { status: 400 } });
    expect((await call('?amount=0.05&network=kite-testnet&asset=' + ASSET, { 'x-payment': '%%%notbase64' })).status).toBe(402);
  });
});
