# Bounded corpus preparation

`corpus-generation.ts` composes the existing attacker generator, local mutators and deterministic payment corpus builder. It imports no provider constructor, environment loader, filesystem or wallet. It never runs a victim agent, refines against feedback, or infers attack effectiveness.

Create a plan with `createCorpusGenerationPlan({ id, model, source, context, ... })`. Source is either `scripted_fixture` or `live_inference`, always a caller attestation. The context must satisfy the owned payment-fixture boundary. `parseCorpusGenerationPlan` verifies the full materialized canonical hash and all bounds. `previewCorpusGenerationPlan` makes zero calls.

Default preparation is a maximum of 32 predefined generation slots, four requested candidates and 4096 requested output tokens per slot. The outer limits reserve at most128 base candidates and131072 output tokens. Each slot uses its own existing one-call generator with4096 maximum total output; the primitive's own65536 total cap is unchanged. A slot's requested allowances are reserved before invocation and retained on errors, refusals, invalid output, duplicates and short responses.

The default schedule cycles a fixed ordered set of15 specifications: direct chat, local browse and inbox, each with five payment/policy/utility goals. Canary disclosure and unsupported channels are rejected. Model input contains only the public owned-fixture context and slot specification; it contains no system prompt from the victim, secret, transcript or feedback.

Run with `runCorpusGeneration({ plan, client, allowInference: true })` only after separately authorizing the intended provider use. A client must already exist and be explicitly supplied. Without `allowInference: true`, the function returns a preview report with zero client invocations. There is no implicit SDK, API key, endpoint, fallback, replenishment or retry.

One fixed slot can yield an error, refusal, invalid response, duplicate candidates or valid new candidates. All are retained as slot results. Dedupe across slots uses the complete attack content hash. Relabeling origin or techniques cannot create a new content identity. Duplicate counts removed inside one response are recorded, although that primitive does not expose each removed duplicate's hash.

After generation, local variants follow a fixed seed-derived schedule. Defaults are two rounds of six methods for up to1536 mutation slots. Mutations operate on unique generated parents only. They preserve the existing mutator's parent hash and are recorded as related variants. Missing parents, duplicate variants, payload-limit skips and already-satisfied targets remain explicit results. Generated payloads are at most1024 UTF-8 bytes; variants are at most4096. Payloads are never truncated into compliance.

Selection takes the first distinct candidates in generation order, then mutation order, until the exact requested target. All predefined generation slots still execute unless aborted; extra distinct generated candidates remain explicit unselected provenance. Mutation computation stops selecting at the target and later slots are recorded as skipped. The default target is1000 attacks plus40 benign templates. Reaching1000 is not guaranteed and does not establish diversity, representativeness, independence, quality or success.

A corpus is returned only with status `frozen`. Underfill returns `insufficient_candidates` and no corpus. A full selected set that fails the final corpus boundary, including its4 MiB serialized limit, returns `corpus_rejected` and no corpus. An aborted run returns `aborted` and no corpus, even if a candidate target was reached. All statuses retain a hashed local report, candidate references and relation counts.

Usage and prices are partial values from validated successful generation responses. Failed, refused or invalid calls can still have provider charges that are not exposed. Reservations bound admission, not actual billing or provider-side cancellation. Actual billing is always unverified. Related variants and benign templates are not independent observations, and no attack or defense-effectiveness result is claimed.

The tests include a32-slot scripted1000-case rehearsal. Its generated text is synthetic test data; it is not a live Dolphin corpus or an evaluated attack benchmark.
