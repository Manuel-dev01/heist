# Controlled local benchmarks

Run from the product repository with Node22+ and installed workspace dependencies:

~~~sh
pnpm demo:benchmark
pnpm demo:benchmark --run-id my-offline-rehearsal
pnpm demo:benchmark --corpus .heist/corpora/my-corpus.json --run-id my-corpus-rehearsal
~~~

This CLI is offline only. It does not load credentials and rejects live/credit-use flags. The original demo contains six synthetic seeds, six deterministic mutations per seed, and eight benign payment templates:50 cases and100 attempts across observe/enforce executor arms. It exercises the oracle and reporting pipeline; the scripted decisions never establish AI defense effectiveness or independent attack diversity.

Each run creates an exclusive ignored directory at .heist/benchmarks/RUN_ID. It saves a complete plan before execution, one full entry per attempt, a JSONL completion journal, and the final report. Reusing a run ID fails before execution and never overwrites evidence. A crash may leave an incomplete journal; automatic resume/replay is deliberately unavailable. Verify saved records before any later recovery tool admits new work.

## Corpus and plan integrity

createPaymentCorpus and parseBenchmarkCorpus enforce the owned payment-v1 fixture, supported direct-chat/browse/inbox carriers, canonical hashes, duplicate rejection, and deterministic task reconstruction. See CORPUS.md for exact limits and unsupported goals. Corpus defaults generate benign template variants only. Existing generated or mutated cases retain their scope and context hashes; changing public context requires a new generation scope.

createBenchmarkPlan normalizes a public plan and hashes its complete materialized content. parseBenchmarkPlan rejects edited or omitted defaults even if a downstream schema could fill them. Plans include exact corpus, arms, trials, schedule seed and finite limits. They contain public feature configuration only; keys are runtime-only. Unknown fields, invalid raw/defense combinations, policy changes, duplicate arms and cohorts larger than10000 planned attempts are rejected.

Scheduling deterministically shuffles paired case/trial blocks and the arm order inside each block. Corresponding arms retain the same case, task and trial identity. Before admitting a block, the runner reserves all its attempt slots, maximum model rounds and requested output allowances. Unused rounds and failures are not refunded. Partial coverage caused by time, byte, abort, persistence or evidence limits remains explicit; skipped attempts are never invented as blocked results.

## Limits and evidence

- maxAttempts, maxModelCalls and maxTotalOutputTokens bound conservative admissions/reservations. Requested output allowance is distinct from actual provider usage; an observed overshoot stops new work and retains the current bounded attempt evidence.
- maxRequestBytes and maxTotalRequestBytes count UTF-8 JSON body bytes. Live requests include the actual built SERV feature-tool body; fixture requests use the normalized harness envelope. Headers are excluded. Bytes do not establish token or dollar spending limits.
- maxWallTimeMs stops new admissions. The live SDK timeout fits its minimum1000ms contract and the remaining window. A timed-out upstream computation may continue at the provider; cancellation or a hard billing ceiling is not claimed.
- Late provider settlement cannot change closed attempts or finalized report counters/hashes. The final report snapshots its budget.
- maxEvidenceBytes stops new admissions after retaining a final record that crosses the soft threshold. This can exceed the threshold by one bounded record; no paid-attempt evidence is dropped to hide the overshoot.
- onEntry receives a clone. A failed persistence callback stops further admissions and retains the entry in the returned result.

The report exposes planned/started/completed/error/skipped counts, stop reason, conservative reservations, admitted model invocations, observed usage, per-attempt references, metadata hashes, grouped metrics and a whole-report hash. An admitted invocation can fail before an HTTP request or before usable usage exists; the count is not a provider invoice. reportedUsage.unknownResponses counts settled failures observed without usage. New reports also expose unobservedSettlements at finalization and total missingUsageInvocations, so closed timeout promises cannot look like accounted zero-cost calls. Historical reports remain readable without changing their hashes. Known authentication, empty-credit and rate-limit failures stop new admissions after retaining the current operational-error record. Errors remain in availability-aware metric denominators, with partial breach effects preserved. Counts and hashes cannot independently attest provider provenance or oracle truth.

Default sampling is unknown, provider snapshot is null unless explicitly supplied as caller metadata, and trial independence is not attested. All metric groups remain descriptive. Observe/enforce changes the executor; SERV feature experiments are separate. Shadow's complete hint/iteration configuration is one hashed control so it does not masquerade as several independent interventions.

## Live library boundary

runBenchmark supports source=live_inference only with runtime authorization.allowLive=true and an API key. It constructs the official SERV client for the exact declared arm features, disables SDK retries through that client, and uses synthetic ledger tools only. Keys matching any plan field are rejected, and exact key echoes in responses cannot enter records. Caller authorization is an assertion; operators and agents must still obtain the actual human-approved run budget before invoking live mode.

A key or unused account balance does not expand a completed smoke-test approval into permission for a large experiment. Preview the plan's attempt/round/output maxima and verify current provider prices, feature costs and console usage before approving a measured run. No live benchmark CLI or automatic Dolphin-generation loop is exposed here yet. A larger, reviewed attack corpus and separately budgeted live experiment remain necessary for a Defense Curve.

Saved runs can be checked with verifyBenchmarkResult({plan,report,entries}); it revalidates plan/record/metadata bindings and recomputes metrics. See [saved-run integrity limits](BENCHMARK_RECORD.md).
