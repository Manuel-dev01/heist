# Partner readiness

Checked November 12, 2026. Documentation, offline tests and live runtime results are distinct evidence. This page does not authorize provider spending, account creation, signatures or transactions.

| Partner | Implemented or observed | Still required |
|---|---|---|
| SERV | Client, controlled feature planner and historical selected raw/default Nano and suffix requests | Complete V0 baseline, current seven-arm compatibility checks, measured same-model comparison and separately attributed frontier reference |
| Dolphin | Client, generation/refinement and selected hosted tool round trips | Representative discovery quality and transfer to SERV are not established |
| Reppo | Current text Evaluation API client and offline lifecycle tests | One authorized live evaluation; current key/account credits and billing remain unvalidated |
| Kite | Current CLI release and command help inspected separately from the product | Human sign-in/passkey, confirmed sandbox/network/token path, actual bounded test settlement and spending-cap validation |

## SERV

The [current model catalog](https://docs.openserv.ai/serv-reasoning/models.md) lists Nano at $0.25 input / $1.60 output per million tokens. The [billing guide](https://docs.openserv.ai/serv-reasoning/tutorials/usage-and-billing.md) describes upstream inference, reasoning generation, guard, audit/repair and Shadow components. Visible token estimates remain separate from actual billing.

The [Prompt Guard guide](https://docs.openserv.ai/serv-reasoning/tutorials/prompt-guard.md) documents that a guard-judge failure may continue without a verdict. HTTP200 and a correctly supplied marker therefore establish neither a guard verdict nor defense effectiveness. Kronos/Multipath/Shadow request compatibility likewise does not independently attest their internal execution. Keep feature metadata as requested configuration, and show operational failures and utility alongside attack outcomes.

The original raw-mode header has historical validation; its absence from the currently checked documentation leaves current provider-side bypass behavior unverified. Local request observation confirms which header was sent, not which transformations actually ran.

## Reppo migration

The [current official guide](https://eval.reppo.xyz/agents.md) replaces the old eval-requests, lite and `Sandbox: true` interfaces with:

- `POST /api/v1/agents/evals`: `{taskType,input}`.
- `GET /api/v1/agents/evals/{id}`: queued/processing through completed/failed.
- A documented 440-credit reservation for one text evaluation; completed responses report the charge.

The [package](packages/reppo/README.md) supports this account-key text flow only. It neither purchases credits nor uploads attachments, signs x402 payments or publishes a Datanet. One lost submit response must not trigger automatic resubmission. A local timeout does not establish provider cancellation or final billing. The external panel's score/route is advisory evidence, never the deterministic HEIST breach oracle.

## Kite compatibility gap

The [seller guide](https://docs.gokite.ai/passport/seller), current CLI help, [Passport skills](https://github.com/gokite-ai/passport-skills), and public [Pieverse metadata](https://facilitator.pieverse.io/v2/supported) do not yet establish one coherent end-to-end path for this project. Sources differ between legacy `gokite-aa`/v1 headers, exact-v2 support on Kite2368, sandbox descriptions, and Arc-only dev settlement in newer execution references. Advertised token/network support is not a settlement receipt.

CLI6.13.2 help confirms `session` commands, a separate passkey-approved session option, sandbox commands and project-local state. Normal session creation can draw from an account allowance, so a bounded test must explicitly request its reviewed separate scope. The installer and global skills are unnecessary for workspace-only CLI preparation. Actual sandbox selection is still gated by sign-in; command help alone does not validate the settlement network.

The original Kite testnet and cap requirements remain outstanding. Arc sandbox, a synthetic executor limit or a mainnet fallback must not be presented as the original Kite2368 integration. Resolve the path explicitly before submitting a payment or declaring V6 Kite-Locked complete.
