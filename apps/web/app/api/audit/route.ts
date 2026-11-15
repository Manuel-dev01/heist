import { ManifestSchema, runPolicyAudit } from '../../../lib/audit';
import { assertLocalRequest, consumeLocalLimit, jsonResponse, readBoundedJson, safeErrorResponse } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deterministic policy audit: no inference, keys or funds. Bounded body, same-origin, per-instance rate limit. */
export async function POST(request: Request): Promise<Response> {
  try {
    // Agent-facing: also open to non-browser clients (e.g. the HEIST MCP server).
    assertLocalRequest(request, process.env, { allowNonBrowser: true });
    consumeLocalLimit('audit');
    const input = ManifestSchema.safeParse(await readBoundedJson(request, 4096, { allowNonBrowser: true }));
    if (!input.success) return jsonResponse({ error: 'invalid_manifest', issues: input.error.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message) }, 400);
    return jsonResponse(runPolicyAudit(input.data));
  } catch (error: unknown) { return safeErrorResponse(error); }
}
