import { PracticeInputSchema, runPractice } from '../../../lib/practice';
import { assertLocalRequest, consumeLocalLimit, jsonResponse, readBoundedJson, safeErrorResponse } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    consumeLocalLimit('practice');
    const input = PracticeInputSchema.safeParse(await readBoundedJson(request, 24000));
    if (!input.success) return jsonResponse({ error: 'invalid_practice_input' }, 400);
    return jsonResponse(await runPractice(input.data));
  } catch (error: unknown) { return safeErrorResponse(error); }
}
