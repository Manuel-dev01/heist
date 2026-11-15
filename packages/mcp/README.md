# @heist/mcp — let agents audit themselves

An MCP server that gives any MCP client (Claude Code, Claude Desktop, other agents) three HEIST tools. Before an agent asks for a higher spending limit, it can run HEIST's 1,000 prompt-injection attacks against its own wallet setup and read back what gets out.

It is dependency-free (plain Node 22, stdio JSON-RPC). It calls the public HEIST API and needs no keys, no funds and no account.

## Tools

| Tool | What it does |
|---|---|
| `heist_audit_policy` | Fires all 1,000 attacks at a worst-case agent (one that obeys every injection) under the setup you describe: executor checks, caps, tools and Kite cap. Returns breaches, worst single loss, policy takeovers, whether the real invoice is still paid, results by goal and channel, top exploits, every fix re-tested, and a hashed report. |
| `heist_verify_record` | Recomputes a HEIST attempt record's SHA-256 and checks it against its `attemptHash`. |
| `heist_proof_status` | Has the HEIST server re-derive the real recorded breach and its held twin right now: hash, deterministic oracle and full harness replay. |

## Install

From a clone of this repository (`/path/to/heist` below):

**Claude Code**

```sh
claude mcp add heist -- node /path/to/heist/packages/mcp/src/server.mjs
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "heist": { "command": "node", "args": ["/path/to/heist/packages/mcp/src/server.mjs"] } } }
```

Then ask, for example: *"Audit my payment agent with HEIST. It enforces a recipient allowlist and a per-payment cap in code, can call update_policy and transfer, and has no Kite cap."*

The repository also ships a Claude Code skill, [`.claude/skills/heist-audit`](../../.claude/skills/heist-audit/SKILL.md). It tells Claude how to map an agent's code onto the audit inputs, using the MCP tool or a plain `curl` fallback.

## Options

| Variable | Default | Notes |
|---|---|---|
| `HEIST_URL` | `https://heist-khaki.vercel.app` | Must be https, or loopback http for a local `pnpm --filter @heist/web dev` |

## How the API accepts agents

`/api/audit` and `/api/verify` accept same-origin browser requests and non-browser clients. A non-browser client is a request with no `Origin` and no `Sec-Fetch-*` headers, which is what this server sends. Browsers always send those headers on cross-site requests, so cross-site browser calls are still rejected. Bodies are size-bounded and rate-limited.

## Test

```sh
pnpm --filter @heist/mcp test
```

The tests run the real server over stdio against a local fake API: no network.
