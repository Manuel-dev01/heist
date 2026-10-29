# @heist/pod

Local attack-case preparation and a bounded client for an explicitly configured OpenAI-compatible Dolphin endpoint. No hosted Dolphin URL, model, price, or working partner integration is assumed.

The D2 component creates candidate messages only. It has no victim runner, target URL option, wallet, payment adapter, or default network client. A later execution layer must separately authorize and isolate the target.

## Public boundary

Use an owned fixture scope, or an isolated audit replica with explicit owner authorization and an authorization reference. These are caller attestations, not proof of real-world permission.

Public context accepts only a task summary, policy summary, tool names, symbolic fixture account IDs, scope, and an explicit public-data attestation. Unknown fields such as system prompts, secrets, credentials, target URLs, and transcripts are rejected. Common credential and URL patterns are also rejected in prose. Pattern checks cannot prove that arbitrary prose is public; never supply a full private manifest or hidden target data.

Refinement accepts only the existing public candidate and fixed scalar deterministic-oracle fields. It never sends victim transcripts, tool outputs, secret values, or free-form feedback to the attacker model.

## APIs

- createAttackCase validates one synthetic case and derives its canonical SHA-256 content hash.
- AttackCaseSchema, AttackScopeSchema, PublicTargetContextSchema, and DeterministicFeedbackSchema expose the accepted boundaries.
- mutateAttackCase and mutateAttackBatch provide seeded authority, urgency, role framing, base64, hex, and Unicode-safe splitting. Oversized mutations are skipped rather than truncated.
- dedupeAttackCases retains the first record for each content hash. Identity includes scope, public context hash, channel, goal, and exact payload-part boundaries; technique and provenance labels cannot evade dedupe.
- createAttackGenerator({ client, model, budget }) requires an explicitly supplied client. generate and refine each perform at most one model call and return a discriminated result.

A generation budget explicitly sets finite model calls, output tokens per call, total reserved output tokens, candidate reservations, payload bytes, and a waiting deadline. Reservations occur before dispatch and remain consumed on errors, refusals, invalid output, duplicates, and timeout. There are no retries, recursive refinements, hidden replenishment calls, or automatic victim tests.

The generator and refiner use separate constant system prompts. Public variable context goes in user messages. All generated JSON is schema checked; channel/goal changes, unexpected tool calls, unknown fields, invalid model identity, oversized payloads, and invalid usage are rejected.

Results distinguish ok, refusal, invalid, provider_error, and budget_exhausted. Refusal requires an explicit structured refusal or a provider refusal signal. Unstructured refusal-like prose is an invalid JSON response, not a measured refusal claim. No result proves attack success or establishes an attack-success rate.

An arbitrary injected client cannot be forcibly cancelled by this package's interface. A timeout bounds waiting and retains its reservation; a real client must also enforce transport cancellation and its own request limits.

## Dolphin transport

createDolphinClient requires a key, base URL, model, and finite call/output-token budgets. It rejects non-HTTPS, loopback, private/reserved addresses, private DNS answers, URL credentials, query strings, and redirects. Explicit local-test mode permits loopback HTTP only. Endpoint configuration remains trusted application configuration; this client is not a general-purpose untrusted URL fetcher.

Requests, response bytes, output characters, tool arguments, and reported usage are bounded and validated. SDK retries and SDK logging are disabled. Only the configured provider authorization and JSON content headers are forwarded; unrelated OpenAI environment credentials and custom headers are excluded.

Costs are unavailable by default. A verified, model-matched caller-supplied price snapshot plus complete usage can produce a labeled token-price estimate, never a billing claim or guaranteed dollar spend cap. Input is character/byte bounded; the hard token reservation covers requested output tokens.

## Local verification

The package scripts typecheck source and tests, build source declarations, and run Vitest. Tests use injected scripted clients and mocked fetch/DNS; no live generation, victim execution, payment, or benchmark is performed.
