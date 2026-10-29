# Attempt storage draft

`001_attempts.sql` is an original local PostgreSQL schema, validated on PostgreSQL 16.14 in a newly initialized disposable loopback instance. All 81 integration checks passed as a dedicated non-superuser role; the test transaction rolled back every inserted row and the owned server stopped. No existing PostgreSQL service or database was accessed, and application persistence is not wired yet. Do not apply it to an existing schema without reviewing the migration plan.

The table accepts version 1 redacted `AttemptResult` JSONB with oracle interpretation `decision-call-v1`. Application intake must validate the complete harness record and recompute `hashAttemptRecord(record)` before insertion, then compare it to the supplied `attemptHash`. JSONB stores parsed data; PostgreSQL's JSONB text output is not the JavaScript canonical hash preimage and must not replace `hashAttemptRecord`.

Insert `record_json`, `occurred_at` equal to the record's ISO `ts`, and explicit `execution_environment`, `source_kind`, `cohort_kind`, `corpus_id`, and `replicate_index`. Identity, hashes, outcome, oracle flags and money projections are generated from the record. Source describes fixture versus inference provider; even a live provider response still runs in an isolated simulated ledger. Cohort labels separate readiness, funds, extraction, benign utility and utility under attack. These ingestion labels and `ingested_at` are outside the harness record hash and are not authenticated by a Merkle proof over that hash.

Primary breach and model breach are distinct from executed breach and loss. A rejected attacker call can have `model_breached = true`, `execution_breached = false` and zero loss. Utility remains independent of breach. Operational errors retain `outcome = 'error'` and are not silently counted as successful protection. The schema checks current oracle relationships, record/column agreement, exact money conservation and outcome consistency; it cannot prove that an oracle was computed correctly from a real run.

All balances, debits and losses use canonical nonnegative decimal text of at most forty digits. Checks use exact PostgreSQL `numeric`; no floating-point financial balances are introduced. The original labeled cost estimate remains in the JSONB record and is never treated as settled money or billed cost. Records have a four-MiB logical JSONB-text limit; application intake must bound requests before sending them to PostgreSQL as well.

The migration creates a separate `heist` schema, grants no public access, and installs rejection triggers for updates, deletes and truncation. After disposable-database validation, an operator should grant only schema usage and table insert/select to the intended application role. Database owners and superusers can bypass or remove those protections; append-only privileges are not a blockchain anchor or protection against a privileged administrator. Preserve older development evidence with its original version rather than rewriting it into this schema's interpretation.


## Disposable integration validation

On Windows with PowerShell 7 and PostgreSQL binaries already installed, run from the product repository:

```powershell
pwsh -NoProfile -File ./apps/engine/sql/validate.ps1
```

Optional arguments are `-PgBin 'C:/Program Files/PostgreSQL/16/bin'` and `-Port 55400`. The runner briefly checks that its requested loopback endpoint can bind, creates a fresh unique data directory under ignored `.heist/sql-validation-*`, and pins both `host` and `hostaddr` to `127.0.0.1`, plus its own port, user and database, for every client invocation. Every native child receives a cloned environment with all `PG*` variables removed, preventing inherited destination, service-file or session defaults; inherited values are never inspected or logged. Its connection strings also select an owned empty password file. It never connects to a pre-existing cluster, installs a service, or changes OS networking. Port 55439 was reserved by Windows on the validation host; 55400 was free. Choose another free unreserved port if needed.

The disposable instance uses local trust authentication and listens only on `127.0.0.1`. An owner applies the schema; a separate unprivileged test role runs `validation.sql`. The runner deliberately gives that role UPDATE, DELETE and TRUNCATE privileges only inside this test database so the tests exercise rejection triggers rather than stopping at the permission check. It also verifies that the role cannot disable triggers or drop the table and that PUBLIC has no schema/table privileges. Real application roles should receive INSERT/SELECT only.

The suite covers ten accepted record variants; generated identity/oracle/money projections; exact forty-digit arithmetic; rejected missing/null nested entries; invalid versions, types, hashes, labels, timestamps and balances; duplicate identities/hashes; oracle/outcome contradictions; and append-only protections. A required nested field originally escaped the structural CHECK because a missing JSON path produced SQL NULL. The structural predicate now requires `IS TRUE`, and the missing-entries regression is rejected.

An automatic connection preflight injects synthetic `PGHOSTADDR` and `PGSERVICE` poison into a child environment clone before scrubbing, then verifies the actual server address, port, database, role and loopback-only listener. The full suite was also rerun from a PowerShell child launched with those synthetic poisoned defaults; all 81 checks still passed. This guards the independent `hostaddr` default described in [libpq environment variables](https://www.postgresql.org/docs/16/libpq-envars.html) and [connection parameters](https://www.postgresql.org/docs/16/libpq-connect.html).

Each run retains `summary.json`, schema hash, command logs and its stopped data directory under ignored `.heist/`. The summary records PostgreSQL version, check count, post-rollback row count and owned-server shutdown. The runner stops its own cluster in `finally`, including test failures. No provider credentials or inference calls are involved.

## Validation limits

Only PostgreSQL 16.14 on this Windows host has been exercised. This is not a production migration, backup/restore, concurrency, load or disaster-recovery test. SQL fixtures deliberately use synthetic well-formed hashes to test projections; the database does not recompute the harness canonical hash or validate every transcript, policy, ledger-entry or usage field. The application must still apply the stricter complete `AttemptRecordSchema`, its two-MiB byte limit, and canonical hash verification before insertion. SQL's four-MiB JSONB-text ceiling is a secondary storage guard. Schema ownership/superuser access can bypass these controls.
