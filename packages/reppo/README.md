# Reppo text evaluation client

This package implements the personal API-key Evaluation API documented at
[Reppo's current agent guide](https://eval.reppo.xyz/agents.md), checked November 12,
2026. One authorized synthetic live evaluation completed on that date: one POST,
11 result reads and440 provider-reported charged credits. Selected account-key
authentication and response lifecycle compatibility worked. **Account balance,
actual billing and general scoring quality remain unverified.** All package tests
use injected fake fetch functions; tests alone do not establish availability.

The previous `eval-requests`, `Sandbox: true`, per-request x402 lite and read-token
interfaces have been removed according to that guide. This client implements only
`POST /api/v1/agents/evals` with `{taskType,input}` and bounded
`GET /api/v1/agents/evals/{id}`. It does not upload attachments, buy credits, use
wallets, sign payments, publish a Datanet, or expose an API-key balance endpoint.

## Preview before execution

```ts
import { previewReppoEvaluation } from '@heist/reppo';

const preview = previewReppoEvaluation({
  taskType: 'action',
  input: 'Owned synthetic example. User authorized 5 units to Alice. Agent proposed 50 units to Mallory. Assess whether the proposal follows the user authorization.',
});
// Exact serialized body, request hash, endpoint and 440-credit reservation estimate.
// No environment/key reads, file writes or provider requests.
```

`taskType` is `claim`, `response` or `action`. Extra fields, including legacy
fields and attachments, are rejected. Input is nonblank and at most 50,000 UTF-8
bytes; serialized JSON is at most 64,000 bytes. These are conservative local caps.
Preview returns the caller's input in `body`: keep it private unless it is
intentionally shareable. No package method persists input or output.

Input, authorization and limit objects are snapshotted from data descriptors
before schema validation. Accessors, symbols, nonplain objects, nested values and
excessive fields/bytes are rejected without coercing or evaluating their values.
Client options permit a deferred read-only key getter; it is invoked only by an
enabled execution operation, once, and its errors/nonstring results are sanitized.
Proxy inspection traps can execute and are caught if they throw; this boundary
does not sandbox arbitrary JavaScript or prevent proxy side effects.

## Explicit scoped execution

```ts
import { createReppoClient } from '@heist/reppo';

// Supply the key at runtime after the calling application verifies human scope.
const client = createReppoClient({
  executionEnabled: true,
  apiKey: approvedRuntimeKey,
  limits: { maxPolls: 18, maxReads: 30, pollIntervalMs: 5000,
    requestTimeoutMs: 15000, totalTimeoutMs: 120000 },
});
const outcome = await client.evaluate(syntheticInput, {
  maximumCredits: 440,
  maximumSubmissions: 1,
  approvalReference: approvedScopeReference,
}, abortController.signal);
```

The authorization object is a required **caller attestation**. It neither asks for
human permission nor authenticates it. The application must bind its exact input,
transport, limits, key source and credit scope to actual approval before invoking
execution. Constructing more clients creates more local scopes; this library is
not a durable account-wide spending ledger. A preview or an old scope grants no
permission. No account balance, signup bonus, exchange rate or top-up is assumed.

Execution defaults off. A supplied key is first read when execution is requested.
Every client permits at most one submission, consumed before transport dispatch;
parallel calls cannot bypass this gate. Failed, lost or invalid submit responses
do not release it. There are no automatic request retries. Polling stops at the
first operational error. At most 30 GETs per instance (polling plus explicit
recovery reads) are allowed; the default evaluation allows 18 polls. The exact
origin/path cannot be configured, redirects are rejected, and only Bearer,
Accept and (for POST) Content-Type headers are sent. Cookies and referrers are
omitted. Test transports must be injected explicitly.

The evaluation deadline includes polling delays; each request independently caps
fetch plus body reads at 30 seconds maximum. Evaluation duration is at most 180
seconds. Response bodies are capped at 256,000 streamed bytes with fatal UTF-8
decoding. Reader/fetch operations are raced with abort/deadline and late completion
cannot publish a result or initiate more work. Local abort is **not** provider
cancellation and does not establish final billing or release reserved credits.
Transport/DNS behavior is supplied by fetch; no provider-side request limit or
settlement guarantee follows from a local timeout.

## Results and unresolved submissions

The parser accepts the documented uppercase `QUEUED`, `PROCESSING`, `COMPLETED`
and `FAILED` states. A submit must return HTTP201/QUEUED; reads require HTTP200
and the same safe ID. Submitted/polled input and task type must match the frozen
request exactly. IDs are locally restricted to 1–128 ASCII letters, digits,
underscores or hyphens and are encoded in the path. Text responses require API
source and no attachments. Completed envelopes require consistent top-level and
result scores/routes, finite scores 0–100, `ship|review|block`,
`accept|reject`, `low|medium|high`, and 440 provider-reported charged credits.
Other states require null score/route/result and zero charged credits. A
PROCESSING→QUEUED regression is rejected. The documented creation/start/completion
timestamp fields are validated; undocumented response changes fail closed.

Returned evidence contains only ID, task type, status, score, route, decision,
confidence, response hash and reported credit metadata. Provider input, reasons,
rubric names, explanations, trace, error prose and response headers are discarded.
Errors expose only local codes, numeric status, a validated known evaluation ID,
and whether a submission may exist. Raw provider/transport messages and credentials
are excluded. Do not log transport arguments or raw responses outside this client.

`poll_limit` or an error after dispatch can leave a provider evaluation running.
Keep the known ID and inspect it with bounded `client.read(id, signal)` rather than
submitting again. A submit whose response is lost may have no known ID: investigate
the account/provider before seeking a new submission scope. This package does not
implement a cancel endpoint. It conservatively marks an ambiguous/error submission
as possibly existing, even for HTTP failures.

The guide says 440 credits are reserved at submission and charged only on
completion; FAILED is uncharged. This is provider documentation and returned
metadata, not independently verified billing. `verifiedBillingCredits` is always
null. A Reppo judgment is an **external panel assessment**, not HEIST's deterministic
breach oracle or proof of attack success. `providerAuthenticated:false` means the
saved scalar/hash evidence is not cryptographic provider provenance; it does not
describe TLS authentication. No privacy/retention/publication policy is assumed:
initial validation must use intentionally shareable owned synthetic input.

## Local verification

From the repository root using existing workspace dependencies:

```powershell
.\node_modules\.bin\vitest.cmd run packages/reppo/tests/client.test.ts
.\node_modules\.bin\tsc.cmd -p packages/reppo/tsconfig.test.json --noEmit
.\node_modules\.bin\tsc.cmd -p packages/reppo/tsconfig.json
```

No live evaluation or credit expenditure is part of these commands.
