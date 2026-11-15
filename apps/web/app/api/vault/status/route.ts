import { BUDGET_MICRO_USD, storeFromEnv } from '../../../../lib/live-vault';
import { jsonResponse } from '../../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public live-vault counters and recent verdicts (no visitor text is ever stored). */
export async function GET(): Promise<Response> {
  const store = storeFromEnv();
  if (!store || !process.env.SERV_API_KEY) return jsonResponse({ online: false, attempts: 0, robbed: 0, spentMicroUsd: 0, budgetMicroUsd: BUDGET_MICRO_USD, feed: [] });
  try { const s = await store.status(); return jsonResponse({ online: s.spentMicroUsd < BUDGET_MICRO_USD, budgetMicroUsd: BUDGET_MICRO_USD, ...s }); }
  catch { return jsonResponse({ online: false, attempts: 0, robbed: 0, spentMicroUsd: 0, budgetMicroUsd: BUDGET_MICRO_USD, feed: [] }); }
}
