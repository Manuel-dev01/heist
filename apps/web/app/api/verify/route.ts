import { AttemptRecordSchema, hashAttemptRecord } from '@heist/harness';
import { z } from 'zod';
import { assertLocalRequest, consumeLocalLimit, jsonResponse, readBoundedJson, safeErrorResponse } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const InputSchema = z.object({ record: z.unknown() }).strict();
export async function POST(request: Request): Promise<Response> {
  try {
    // Agent-facing: also open to non-browser clients (e.g. the HEIST MCP server).
    assertLocalRequest(request, process.env, { allowNonBrowser: true });
    consumeLocalLimit('verify');
    const input = InputSchema.safeParse(await readBoundedJson(request, 256000, { allowNonBrowser: true }));
    if (!input.success) return jsonResponse({ error: 'invalid_verification_input' }, 400);
    const record = AttemptRecordSchema.safeParse(input.data.record);
    if (!record.success) return jsonResponse({ valid: false });
    const expectedHash = hashAttemptRecord(record.data);
    return jsonResponse({ valid: expectedHash === record.data.attemptHash, expectedHash });
  } catch (error: unknown) { return safeErrorResponse(error); }
}
