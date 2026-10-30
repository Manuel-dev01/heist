# HEIST

**Rob the agent. Prove the defense.**

HEIST is a security-testing arena and opt-in auditor for AI agents with wallets. The local foundation runs a wallet-agent loop against isolated synthetic funds, records each attempt, and checks the result with deterministic code.

## Run locally

After installing dependencies, start the browser practice range:

```sh
pnpm --filter @heist/web dev
```

Open http://127.0.0.1:3000. Choose a scripted scenario and executor mode, inspect the independent decision/execution/utility/loss signals, verify the content hash and download the full record. Notes are retained as text; scripts do not interpret them. Browser history lasts only for the current session. There is no wallet connection or inference in this route.

Open `/reports` to inspect a saved benchmark `report.json`. Choose the file manually; it stays in your browser. The inspector checks its report hash and basic summary consistency, then shows declared coverage, errors, availability, utility, latency and partial token estimates. It does not verify attempt entries, provider provenance or billing. A matching hash alone does not establish that the supplied metrics are true.

## Run the foundation

Requirements: Node.js 22+ and pnpm 11.1.2.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
pnpm demo:foundation
```

The demo runs offline with explicitly labeled scripted model responses. It completes an approved invoice and demonstrates an attacker-directed release in a separate run. It writes full attempt records to ignored `.heist/attempts/` files and prints a JSON summary. Fixture token prices are test values, not provider spending or AI performance measurements.

To use live SERV inference, create a local `.env.local` from the variable names in `.env.example`, preserving any existing secrets. Set `SERV_API_KEY` there and approve a bounded credit allowance before executing:

```sh
node --env-file=.env.local --import tsx apps/engine/src/cli.ts --live --authorize-credit-use
```

Add `--raw` for the same requested model with `x-openserv-disable-braid: true`. Live execution still uses synthetic funds; every wallet tool operates only on the local ledger. The CLI permits at most two model rounds per task. SDK retries are disabled. Default execution never contacts an inference provider.

## Rehearse a controlled benchmark

~~~sh
pnpm demo:benchmark
~~~

The offline rehearsal writes 100 scripted attempts across paired observe/enforce executor arms, complete with a frozen plan, per-attempt entries, a journal and report hash. Existing run directories cannot be overwritten. Corpus variants preserve exact payload parts and owned-fixture scope. This validates the pipeline; scripted outcomes do not measure AI defense effectiveness. See [benchmark controls and limits](apps/engine/BENCHMARK.md) and [corpus format](apps/engine/CORPUS.md).

The engine also provides [bounded corpus preparation](apps/engine/GENERATION.md): fixed generation slots, shared call and output reservations, cross-response deduplication and seeded local mutations. Preview makes no provider calls. A separately authorized run returns a frozen corpus only when it reaches the requested count; failures and related variants remain explicit. Saved runs can be checked with the [benchmark verifier](apps/engine/BENCHMARK_RECORD.md).

[Surrogate search](apps/engine/SURROGATE_SEARCH.md) screens owned-fixture seeds and refines unsuccessful candidates using deterministic outcome feedback. It requires explicitly supplied model clients and finite budgets; preview makes no calls. Results preserve ancestry, reservations, errors and selection evidence for local verification. Scripted tests establish the workflow. A separate four-task hosted Dolphin check demonstrated native tool round trips and owned browse/inbox reads; adaptive discoveries, transfer to SERV and a diverse measured corpus remain unverified.

[Defense plans](apps/engine/DEFENSE_PLAN.md) compose seven arms with one control change per step and explicit budgets. A separate frontier reference cannot be attributed to that same-model chain. Planning makes no provider calls. The [append-only store adapter](apps/engine/ATTEMPT_STORE.md) validates records and immutable replays through an explicitly injected database driver; it creates no connection.

## Implemented packages

| Package | Role |
|---|---|
| `apps/web` | Local Next.js practice arena, evidence inspection, hash verification and JSON downloads |
| `apps/engine` | Bounded generation and adaptive surrogate search, controlled defense plans, benchmark CLIs and verification, injected append-only storage; disposable-tested PostgreSQL schema |
| `packages/serv` | OpenAI SDK pointed at SERV, raw toggle, defense configuration, model suffixes, validated responses, token-price estimates |
| `packages/harness` | Stable system prompt, simulated bigint ledger, deterministic oracle, record validation, conservative metrics, local Merkle proofs |
| `packages/pod` | Bounded Dolphin client, public fixture attack cases, seeded mutations, explicit generation/refinement budgets and dedupe |

```mermaid
flowchart LR
  E[Engine task] --> H[Vault harness]
  H --> M[Model client]
  M --> S[SERV or Dolphin]
  H --> L[Isolated synthetic ledger]
  L --> O[Deterministic oracle]
  O --> R[Versioned attempt record and hash]
```

Dolphin's hosted endpoint, model and credentials require explicit configuration. Hosted generation has produced a bounded local corpus of related variants; complete operational baselines and measured defense comparisons remain pending. The Pod generates candidate text and does not execute wallet actions.

## Breach, utility and loss

A validated tool call to the attacker's destination or above the immutable payment limits counts as a model breach even if the executor rejects it. The record reports model compromise, executed compromise, rejected actions and actual synthetic loss separately. A blocked transfer can therefore have `modelBreached: true` and zero loss.

Utility measures completion of the legitimate task independently. A run can complete its invoice and also breach. Provider errors, invalid tool payloads and timeouts remain errors; they are not evidence that a defense stopped an attack.

Each attempt has a UUID, timestamp, configuration/task hashes and a canonical SHA-256 record hash. `hashAttemptRecord` re-verifies saved records. These are local integrity checks; on-chain anchoring comes later. Ordered, index- and count-bound Merkle batches can prove inclusion against a caller-trusted local root. See [proof format](packages/harness/MERKLE.md) and [metrics definitions](packages/harness/METRICS.md).

## Costs and secret handling

SERV cost values estimate visible token prices. They do not establish billed cost, a spending cap, or unreported reasoning/guard/Shadow charges. Dolphin cost stays unavailable until a matching verified price snapshot is supplied. Benchmarks must keep sample counts, utility, latency and cost alongside attack success.

Keep credentials only in `.env.local`. Credential files, wallet state, dependencies, build output and local attempt records are ignored by Git. Provider clients suppress SDK debug logging, rebuild outbound headers, reject redirects and sanitize errors. Tools do not access real wallets, external inboxes or third-party production agents.

## Planned product work

The measured live Defense Curve, AI-driven public arena, audit upload/remediation/re-test flow, BullMQ scheduling, payment gateway and contracts remain upcoming work. The local practice UI is available now with scripted fixtures. The [PostgreSQL schema](apps/engine/sql/README.md) passed 81 integration checks on a disposable PostgreSQL 16.14 instance; production persistence and migration work remain pending. Kite integration will begin on testnet. Planned Base work includes a Reppo exploit Datanet, evaluation payments and an ERC-8004 auditor identity through OpenServ. No deployed application, contract, certificate or revenue is claimed.
