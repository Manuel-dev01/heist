import { z } from 'zod';
import type { AttemptResult } from '@heist/harness';

const units = z.string().max(40).regex(/^(0|[1-9][0-9]*)$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(120);
const policy = z.object({ allowedRecipients: z.array(identifier).max(50), maxPerTransferUnits: units, maxTotalDebitUnits: units }).passthrough();
const payment = z.object({ reference: identifier, recipient: identifier, amountUnits: units }).passthrough();
const toolCall = z.object({ id: identifier, name: identifier, arguments: z.string().max(10000) }).passthrough();
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string().max(100000) }).passthrough(),
  z.object({ role: z.literal('user'), content: z.string().max(100000) }).passthrough(),
  z.object({ role: z.literal('assistant'), content: z.string().max(100000).nullable(), toolCalls: z.array(toolCall).max(8).optional() }).passthrough(),
  z.object({ role: z.literal('tool'), content: z.string().max(100000), toolCallId: identifier }).passthrough(),
]);
const violation = z.enum(['unauthorized_recipient', 'unauthorized_payment', 'transaction_limit', 'session_limit', 'insufficient_balance', 'policy_mutation', 'invalid_arguments']);

// Preserve all record fields: verifying or downloading a record must use the exact received content.
export const AttemptRecordSchema = z.object({
  schemaVersion: z.literal(1), oracleVersion: z.literal('decision-call-v1'),
  id: identifier, ts: z.string().max(100), taskId: identifier,
  outcome: z.enum(['benign_ok', 'benign_fail', 'breach', 'blocked', 'error']),
  oracle: z.object({
    modelBreached: z.boolean(), executionBreached: z.boolean(), attackerDestinationCalled: z.boolean(),
    overPolicyAmountCalled: z.boolean(), policyMutationCalled: z.boolean(), unauthorizedTransfer: z.boolean(),
    attackerDestinationPaid: z.boolean(), wrongRecipient: z.boolean(), overPolicyAmount: z.boolean(),
    secretLeak: z.boolean(), policyMutation: z.boolean(), breached: z.boolean(), utilitySuccess: z.boolean(),
    secureTaskSuccess: z.boolean(), utilityDrop: z.boolean().nullable(), attemptedUnsafeCalls: counter,
    rejectedUnsafeCalls: counter, valueLostUnits: units,
  }).passthrough(),
  ledger: z.object({ initialBalanceUnits: units, availableBalanceUnits: units, totalDebitUnits: units,
    entries: z.array(payment.extend({ sequence: counter, tool: z.enum(['pay_x402', 'transfer', 'release_funds']) })).max(160),
  }).passthrough(),
  policyBefore: policy, policyAfter: policy,
  transcript: z.array(message).max(250),
  toolEvents: z.array(z.object({
    round: counter, callId: identifier, toolName: identifier, arguments: z.string().max(10000),
    status: z.enum(['executed', 'rejected', 'read', 'error']), unsafeAttempt: z.boolean(),
    violations: z.array(violation).max(20), result: z.record(z.string(), z.json()),
  }).passthrough()).max(160),
  usage: z.object({ inputTokens: counter, outputTokens: counter, cachedInputTokens: counter, complete: z.boolean() }).passthrough().nullable(),
  costEstimateUsd: z.number().finite().nonnegative().nullable(), costEstimateComplete: z.boolean(),
  costEstimateLabel: z.string().max(2000), latencyMs: z.number().finite().nonnegative(), rounds: counter,
  configHash: z.string().max(200), taskHash: z.string().max(200), attemptHash: z.string().max(200), promptHash: z.string().max(200),
  error: z.object({ code: z.enum(['invalid_config', 'invalid_task', 'invalid_run_options', 'model_error', 'model_timeout', 'invalid_model_response', 'model_mismatch', 'invalid_tool_arguments', 'unknown_tool', 'duplicate_tool_call', 'tool_call_limit', 'max_rounds_exceeded', 'fixture_not_found', 'harness_error']) }).passthrough().nullable(),
}).passthrough();

export const PracticeResponseSchema = z.object({
  record: AttemptRecordSchema,
  report: z.object({ source: z.literal('fixture'), billingVerified: z.literal(false), proof: z.json().optional() }).passthrough(),
}).passthrough();
export const VerifyResponseSchema = z.object({ valid: z.boolean(), expectedHash: z.string().max(200).optional() }).passthrough();
export type PracticeReport = z.infer<typeof PracticeResponseSchema>['report'];
export type Scenario = 'benign' | 'attacker_release' | 'over_limit' | 'policy_mutation';
export type Enforcement = 'enforce' | 'observe';
export interface SessionRun { record: AttemptResult; report: PracticeReport; scenario: Scenario; enforcement: Enforcement }