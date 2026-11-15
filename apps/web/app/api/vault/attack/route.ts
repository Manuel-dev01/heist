import { createServClient } from '@heist/serv';
import { LiveInputSchema, LiveVaultError, runLiveAttempt, storeFromEnv } from '../../../../lib/live-vault';
import { assertLocalRequest, jsonResponse, readBoundedJson, safeErrorResponse } from '../../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** One public attack on the live Open Safe vault. Browser same-origin only; fails closed without key or store. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const store = storeFromEnv(), apiKey = process.env.SERV_API_KEY;
    if (!store || !apiKey) return jsonResponse({ error: 'live_vault_offline' }, 503);
    const input = LiveInputSchema.safeParse(await readBoundedJson(request, 4096));
    if (!input.success) return jsonResponse({ error: 'invalid_attack', issues: input.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message) }, 400);
    // Vercel sets x-vercel-forwarded-for at its edge; it is used only to key the per-visitor limit (hashed, never stored raw).
    const visitor = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const client = createServClient({ apiKey, inferenceEnabled: true, features: { raw: true }, timeoutMs: 60_000 });
    return jsonResponse(await runLiveAttempt(input.data, { store, client, visitor }));
  } catch (error: unknown) {
    if (error instanceof LiveVaultError) return jsonResponse({ error: error.code }, error.status);
    return safeErrorResponse(error);
  }
}
