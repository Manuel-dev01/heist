import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * HEIST vault payout over x402 (Kite sandbox). An agent asking the vault to pay out must pay this endpoint's quoted
 * price through its Kite Passport session, so Kite's session caps bound what a compromised agent can move.
 * Unpaid requests get HTTP 402 with payment requirements. Paid requests are verified and settled by the facilitator.
 * Test funds only: amounts are capped at 10 test USDC and the network/asset must be configured or explicitly supplied.
 */
const DECIMALS = 6, MAX_UNITS = 10_000_000n;
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

function requirements(url: URL) {
  const amount = url.searchParams.get('amount') ?? '0.05';
  if (!/^\d{1,2}(?:\.\d{1,6})?$/.test(amount)) return { error: 'invalid_amount' as const };
  const [whole, frac = ''] = amount.split('.');
  const units = BigInt(whole!) * 10n ** BigInt(DECIMALS) + BigInt((frac + '000000').slice(0, DECIMALS));
  if (units <= 0n || units > MAX_UNITS) return { error: 'amount_out_of_test_range' as const };
  // Pinned server-side (callers cannot choose them): Kite chain (eip155:2366, as in Kite's service catalog) and Kite mainnet USDC.e.
  const network = process.env.KITE_X402_NETWORK || 'eip155:2366';
  const asset = process.env.KITE_X402_ASSET || '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e';
  const payTo = process.env.KITE_X402_PAYTO ?? '';
  if (!/^[a-z0-9:-]{1,40}$/.test(network) || !/^0x[0-9a-fA-F]{40}$/.test(asset) || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) return { error: 'seller_not_configured' as const };
  const label = (url.searchParams.get('ref') ?? 'vault-payout').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'vault-payout';
  return { amount, units, network, accepts: [{
    scheme: 'gokite-aa', network, maxAmountRequired: units.toString(), resource: url.origin + url.pathname + '?amount=' + amount + '&ref=' + label,
    description: 'HEIST vault payout (' + label + ') · demo seller, not in the Kite service catalog', mimeType: 'application/json', payTo, maxTimeoutSeconds: 300, asset, extra: null, merchantName: 'HEIST',
  }] };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url), req = requirements(url);
  if ('error' in req) return json({ error: req.error }, 400);
  const payment = request.headers.get('x-payment') ?? request.headers.get('payment-signature');
  if (!payment) return json({ error: 'X-PAYMENT header is required', accepts: req.accepts, x402Version: 1 }, 402);
  if (payment.length > 16_000) return json({ error: 'payment_header_too_large' }, 400);
  let decoded: { authorization?: { to?: unknown; value?: unknown }; signature?: unknown };
  try { decoded = JSON.parse(Buffer.from(payment, 'base64').toString('utf8')) as typeof decoded; }
  catch { return json({ error: 'payment_header_not_base64_json', accepts: req.accepts, x402Version: 1 }, 402); }
  // Bind the payment to this quote locally before asking anyone to settle it: exact payTo, at least the quoted amount.
  const a = decoded.authorization, payTo = req.accepts[0]!.payTo;
  let bound = false;
  try { bound = !!a && typeof a.to === 'string' && a.to.toLowerCase() === payTo.toLowerCase() && BigInt(String(a.value)) >= req.units; } catch { bound = false; }
  if (!bound) return json({ error: 'payment_not_bound_to_requirements', accepts: req.accepts, x402Version: 1 }, 402);
  const facilitator = process.env.PIEVERSE_FACILITATOR_URL ?? 'https://facilitator.pieverse.io';
  const body = { x402Version: 1, paymentPayload: decoded, paymentRequirements: req.accepts[0], authorization: decoded.authorization, signature: decoded.signature, network: req.network };
  const call = async (path: string) => {
    try { const r = await fetch(facilitator + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const text = await r.text(); let parsed: unknown = null; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); } return { status: r.status, body: parsed }; }
    catch { return { status: 0, body: 'facilitator_unreachable' }; }
  };
  const verify = await call('/v2/verify');
  // Authorize only on explicit facilitator confirmation, never on an HTTP status alone.
  const ok2xx = (r: { status: number }) => r.status >= 200 && r.status < 300;
  const field = (r: { body: unknown }, k: string) => typeof r.body === 'object' && r.body !== null && (r.body as Record<string, unknown>)[k] === true;
  const settle = ok2xx(verify) && field(verify, 'isValid') ? await call('/v2/settle') : null;
  const settled = !!settle && ok2xx(settle) && field(settle, 'success');
  const receipt = { paid: settled, amount: req.amount, units: req.units.toString(), network: req.network, paymentSha256: createHash('sha256').update(payment).digest('hex'), verify, settle };
  return settled ? json({ ok: true, payout: 'authorized', receipt }, 200, { 'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: req.network })).toString('base64') })
    : json({ error: 'payment_not_settled', receipt, accepts: req.accepts, x402Version: 1 }, 402);
}
export const GET = handle;
export const POST = handle;
