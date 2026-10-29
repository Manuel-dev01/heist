# Saved benchmark verification

verifyBenchmarkResult({ plan, report, entries }) is a pure offline verifier. It returns a boolean, a value-free reason code on failure, and the number of entries checked. It performs no file, provider, wallet or network operation.

The verifier revalidates the complete materialized plan and corpus, the report's canonical hash, strict current attempt records and metadata, and the exact observed prefix of the seeded paired schedule. Task, system-prompt and configuration hashes, policy, all plan-derived metadata, ordered references and metadata hashes must agree. It recomputes metrics from the records rather than trusting the saved summary and requires no aggregation exclusions.

Counts, whole-block reservations, dispatched-call bounds, request-byte allowances, reported-usage consistency and retained JSON entry byte sizes are checked against the plan. A stopped run may retain an unfinished paired block and one final record beyond the soft evidence threshold. Provider-reported over-cap response counts are observational declarations, not independently proven per-response usage.

A successful result establishes local content integrity and internal consistency only. It does not prove provider provenance, real execution, oracle truth, independent trials, defense efficacy, actual billing, payment settlement or a blockchain anchor. A fabricated result can be rehashed to remain internally consistent. Preserve the original local artifacts and their source labels.
