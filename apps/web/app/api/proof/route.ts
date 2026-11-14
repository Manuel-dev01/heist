import { verifyEvidence } from '../../../lib/proof';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Re-verifies only the bundled real evidence records; takes no user input. */
export async function GET(): Promise<Response> {
  try {
    const [breach, held] = await Promise.all([verifyEvidence('breach'), verifyEvidence('held')]);
    return Response.json({ breach, held, checkedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'proof_replay_failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
