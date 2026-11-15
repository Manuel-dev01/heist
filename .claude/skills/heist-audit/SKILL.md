---
name: heist-audit
description: Audit an AI agent's payment/wallet setup against HEIST's 1,000 prompt-injection attacks before raising its spending limit. Use when someone asks whether a payment agent, wallet agent or x402 agent is safe, what a fooled agent could move, or which spending controls (recipient allowlist, invoice matching, caps, policy lock, Kite caps) to add.
---

# HEIST policy audit

HEIST assumes the agent's model is fully fooled and asks what the wallet/executor layer lets through. It fires all 1,000 attacks from its frozen corpus through a real ledger and deterministic breach rules, then re-tests every fix. It is free and deterministic, and needs no keys.

## 1. Describe the setup

Work out from the user's code or description:

- **Checks enforced in code** (not just in the prompt): `allowlist` (only approved payees), `invoiceMatch` (pay only the exact payee, amount and reference of a trusted invoice), `perTransferCap`, `totalCap`, `lockPolicy` (the agent cannot edit its own allowlist or caps).
- **Tools the agent can call** besides `pay_x402`: `updatePolicy`, `releaseFunds`, `transfer`.
- **Caps in units** on a 1,000,000-unit wallet with one trusted 200,000-unit invoice: `maxPerTransferUnits`, `maxTotalDebitUnits`, and optional `kiteCapUnits`.

If a check is only an instruction in the system prompt, treat it as **off**. HEIST assumes the model can be talked out of it.

## 2. Run the audit

If the HEIST MCP server is installed, call the `heist_audit_policy` tool (see `packages/mcp/README.md`). Otherwise use the public API:

```sh
curl -s https://heist-khaki.vercel.app/api/audit -H 'content-type: application/json' -d '{
  "name": "my-agent", "maxPerTransferUnits": "250000", "maxTotalDebitUnits": "1000000", "kiteCapUnits": null,
  "checks": { "allowlist": true, "invoiceMatch": false, "perTransferCap": true, "totalCap": false, "lockPolicy": false },
  "tools": { "updatePolicy": true, "releaseFunds": false, "transfer": true }
}'
```

## 3. Report

Lead with:

- **Breaches out of 1,000** and the **worst single loss** (as a percentage of the wallet).
- **Policy takeovers.**
- **Whether the real invoice is still paid.** A setup that blocks the legitimate task is safe but useless.

Then give the cheapest fixes in order, using the report's `fixes` (each re-tested on all 1,000 attacks) and `allFixes`. Quote the `reportHash` so the result can be reproduced.

State the limit plainly: the audit scores the configuration described, not the running code. How often a real model is fooled was measured separately on the same corpus; see https://heist-khaki.vercel.app/defense-curve.
