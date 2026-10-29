# Local attempt integrity proofs, version 1

This is a local SHA-256 integrity commitment. It is not an on-chain anchor, timestamp authority, payment receipt, signature, or proof that an oracle verdict is correct. Verification is meaningful only against a root and record identity obtained from a trusted source.

Call `buildMerkleBatch(orderedAttemptHashes)`, `createMerkleProof(orderedAttemptHashes, leafIndex)`, and `verifyMerkleProof(proof, { rootHash, leafCount, attemptHash, leafIndex })`. Inputs allow 0–4096 lowercase 64-character SHA-256 hashes; membership requires 1–4096 leaves and an integer index in range. Proofs have `schemaVersion: 1`, algorithm `heist-sha256-ordered-v1`, and at most twelve steps. Unknown fields and unsupported versions fail validation.

Supply the existing full-record `attemptHash` values in the chosen batch order. Before trusting a record's supplied hash, recompute it with `hashAttemptRecord(record)` and compare it to `record.attemptHash`. No alternate record serialization or record-hash format is introduced here. The API accepts hashes only; it cannot establish that a caller computed those hashes from genuine records.

The implementation preserves order and duplicates. It never sorts or deduplicates. Equal hashes at different indices remain distinct position-bound leaves. Swapping different values changes the commitment; swapping equal values produces the same ordered sequence. Choose and persist a batch ordering before creating proofs.

Let `D` be the UTF-8 bytes of `HEIST-MERKLE-V1` followed by one NUL byte. Concatenation below is byte concatenation. `U32` is an unsigned four-byte big-endian integer. Hash strings are decoded to exactly 32 bytes before hashing.

- Leaf `i`: `SHA256(D || 0x00 || U32(i) || attemptHash[i])`.
- Parent: `SHA256(D || 0x01 || leftHash || rightHash)`.
- Root commitment: `SHA256(D || 0x02 || U32(leafCount) || treeTopHash)`.

At each level, pair adjacent nodes from the left. Promote an unpaired final node unchanged. The proof records an explicit `promote` step for that level; it never invents a duplicated sibling. Index parity and the current level's node count determine every allowed sibling side or promotion. Verification requires the exact path length and binds the final leaf count into the root.

An empty batch has `leafCount: 0` and `rootHash: null`. There is no empty membership proof and no fabricated zero hash. Reordered batches, changed duplicate counts, wrong indices/counts/hashes, missing or additional steps, invalid promotion, and tampered siblings fail against the original expected identity.
