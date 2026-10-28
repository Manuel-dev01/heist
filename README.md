# HEIST

**Rob the agent. Prove the defense.**

HEIST is a project in preparation for SERV Hackathon 02: a proposed security-testing arena and automated red-team auditor for AI agents that hold money.

## Current status

This repository currently contains project information only. The application, contracts, audits, paid attempts, and Base integrations are not implemented or deployed. No defense-performance or revenue results are claimed.

## What we are building

- An arena where people and AI agents test HEIST-owned vault agents in a controlled environment.
- A Defense Curve comparing attack success, legitimate-task utility, cost, and latency across individual defense layers.
- An opt-in audit workflow that tests an isolated agent replica, proposes fixes, and measures the result of a re-test.
- A verifiable attempt ledger and a curated collection of reproducible, redacted exploit findings.

An attempted breach will be evaluated with deterministic rules: a tool call to an attacker-controlled destination, a policy-limit violation, a disclosed test secret, or a verified transfer. An LLM will not decide whether an attack succeeded.

## Planned integrations

| Partner | Intended role |
|---|---|
| OpenServ | SERV Reasoning for vault agents and controlled raw-versus-defended comparisons |
| Dolphin | Generation and refinement of security-testing cases |
| Kite | Testnet-first agent payments, constrained spending sessions, and attempt proofs |
| Reppo on Base | An exploit Datanet, evaluation of findings, and publication of verified data pods |

Additional planned Base work includes an auditor identity through OpenServ's ERC-8004 integration. These integrations remain subject to API validation, account access, and official event rules.

## Measurement and scope

The core comparison will hold the base model, prompt, tasks, and outcome rules fixed while adding one defense at a time. It will report benign utility and utility under attack alongside attack success; a model that refuses every task is not a useful defense.

Testing is restricted to HEIST's own fixtures and agents whose owners explicitly opt in. Initial execution will use simulated money and testnets. No third-party production agents are attack targets.

## Development

The intended stack is strict TypeScript on Node.js 22+, pnpm, Vitest, Next.js, and Foundry. Setup commands, test results, deployed addresses, and reproducible measurements will be added when implementation exists.
