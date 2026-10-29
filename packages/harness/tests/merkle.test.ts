import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashAttemptRecord, runAttempt, type ModelClient } from '../src/index.js';
import { MAX_MERKLE_LEAVES, MERKLE_ALGORITHM, MerkleBatchSchema, MerkleProofSchema, buildMerkleBatch, createMerkleProof, verifyMerkleProof, type MerkleProof } from '../src/merkle.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const leaves = (count: number): string[] => Array.from({ length: count }, (_unused, index) => hash('fixture-attempt-' + index));
const expected = (proof: MerkleProof) => ({ rootHash: proof.rootHash, attemptHash: proof.attemptHash, leafIndex: proof.leafIndex, leafCount: proof.leafCount });

describe('ordered local Merkle commitments', () => {
  it('gives an empty batch no fake root or membership proof', () => {
    expect(buildMerkleBatch([])).toEqual({ schemaVersion: 1, algorithm: MERKLE_ALGORITHM, leafCount: 0, rootHash: null });
    expect(() => createMerkleProof([], 0)).toThrow();
    expect(MerkleBatchSchema.safeParse({ ...buildMerkleBatch([]), rootHash: '0'.repeat(64) }).success).toBe(false);
    expect(verifyMerkleProof({ leafCount: 0 }, { rootHash: null, leafCount: 0 })).toBe(false);
  });

  it.each([1, 2, 3, 5, 7, 8, 17, 33])('verifies every index in a %i-leaf batch including odd promotions', (count) => {
    const hashes = leaves(count);
    const batch = buildMerkleBatch(hashes);
    for (let index = 0; index < hashes.length; index += 1) {
      const proof = createMerkleProof(hashes, index);
      expect(proof.rootHash).toBe(batch.rootHash);
      expect(MerkleProofSchema.safeParse(proof).success).toBe(true);
      expect(verifyMerkleProof(proof, expected(proof))).toBe(true);
    }
    if (count === 3) expect(createMerkleProof(hashes, 2).steps[0]).toEqual({ kind: 'promote' });
  });

  it('matches the documented independent domain-separated byte preimages for one and two leaves', () => {
    const domain = Buffer.from('HEIST-MERKLE-V1\0', 'utf8');
    const u32 = (value: number): Buffer => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
    const sha = (...values: Buffer[]): Buffer => { const digest = createHash('sha256'); for (const value of values) digest.update(value); return digest.digest(); };
    const hashes = ['00'.repeat(32), '11'.repeat(32)];
    const first = sha(domain, Buffer.from([0]), u32(0), Buffer.from(hashes[0]!, 'hex'));
    const second = sha(domain, Buffer.from([0]), u32(1), Buffer.from(hashes[1]!, 'hex'));
    expect(buildMerkleBatch(hashes.slice(0, 1)).rootHash).toBe(sha(domain, Buffer.from([2]), u32(1), first).toString('hex'));
    expect(buildMerkleBatch(hashes).rootHash).toBe(sha(domain, Buffer.from([2]), u32(2), sha(domain, Buffer.from([1]), first, second)).toString('hex'));
  });

  it('preserves order and duplicate multiplicity instead of silently sorting or deduping', () => {
    const [a, b, c] = leaves(3);
    const original = [a!, b!, c!];
    expect(buildMerkleBatch(original)).toEqual(buildMerkleBatch([...original]));
    expect(buildMerkleBatch([b!, a!, c!]).rootHash).not.toBe(buildMerkleBatch(original).rootHash);
    expect(buildMerkleBatch([a!, a!]).rootHash).not.toBe(buildMerkleBatch([a!]).rootHash);
    const duplicateProof = createMerkleProof([a!, a!, b!], 1);
    expect(verifyMerkleProof(duplicateProof, expected(duplicateProof))).toBe(true);
    expect(verifyMerkleProof({ ...duplicateProof, leafIndex: 0 }, { ...expected(duplicateProof), leafIndex: 0 })).toBe(false);
  });

  it('binds odd-leaf count so an extra duplicate cannot masquerade as promotion', () => {
    const hashes = leaves(3);
    const three = buildMerkleBatch(hashes);
    const four = buildMerkleBatch([...hashes, hashes[2]!]);
    expect(three.rootHash).not.toBe(four.rootHash);
    const proof = createMerkleProof(hashes, 2);
    expect(verifyMerkleProof({ ...proof, leafCount: 4 }, { ...expected(proof), leafCount: 4 })).toBe(false);
  });

  it('rejects hash, root, index, count, direction and sibling tampering', () => {
    const proof = createMerkleProof(leaves(5), 1);
    const reference = expected(proof);
    expect(verifyMerkleProof({ ...proof, attemptHash: hash('other-record') }, reference)).toBe(false);
    expect(verifyMerkleProof({ ...proof, rootHash: hash('other-root') }, reference)).toBe(false);
    expect(verifyMerkleProof({ ...proof, leafIndex: 2 }, { ...reference, leafIndex: 2 })).toBe(false);
    expect(verifyMerkleProof({ ...proof, leafCount: 6 }, { ...reference, leafCount: 6 })).toBe(false);
    expect(verifyMerkleProof(proof, { ...reference, rootHash: hash('untrusted-root') })).toBe(false);
    expect(verifyMerkleProof(proof, { ...reference, attemptHash: hash('unexpected-record') })).toBe(false);
    const first = proof.steps[0]!;
    expect(first.kind).toBe('sibling');
    if (first.kind === 'sibling') {
      expect(verifyMerkleProof({ ...proof, steps: [{ ...first, side: 'right' }, ...proof.steps.slice(1)] }, reference)).toBe(false);
      expect(verifyMerkleProof({ ...proof, steps: [{ ...first, hash: hash('tampered-sibling') }, ...proof.steps.slice(1)] }, reference)).toBe(false);
    }
  });

  it('requires the exact structural path, including explicit promotions', () => {
    const proof = createMerkleProof(leaves(3), 2);
    const reference = expected(proof);
    expect(verifyMerkleProof({ ...proof, steps: proof.steps.slice(1) }, reference)).toBe(false);
    expect(verifyMerkleProof({ ...proof, steps: [...proof.steps, { kind: 'promote' }] }, reference)).toBe(false);
    expect(verifyMerkleProof({ ...proof, steps: [{ kind: 'sibling', side: 'right', hash: hash('invented') }, ...proof.steps.slice(1)] }, reference)).toBe(false);
  });

  it.each([null, {}, { schemaVersion: 2 }, { schemaVersion: 1, algorithm: 'other' }])('fails closed on malformed or unsupported proof input', (value) => {
    expect(verifyMerkleProof(value, {})).toBe(false);
  });

  it('fails closed even when a non-JSON caller object throws during inspection', () => {
    const hostile = { get steps(): never { throw new Error('do not propagate caller data'); } };
    expect(verifyMerkleProof(hostile, {})).toBe(false);
  });

  it('enforces bounded lowercase hashes, strict proof fields and batch limits', () => {
    for (const invalid of ['A'.repeat(64), '0'.repeat(63), 'g'.repeat(64), '0x' + '0'.repeat(64)]) expect(() => buildMerkleBatch([invalid])).toThrow();
    expect(() => buildMerkleBatch(Array.from({ length: MAX_MERKLE_LEAVES + 1 }, () => hash('same')))).toThrow();
    for (const index of [-1, 0.5, Infinity, 2]) expect(() => createMerkleProof(leaves(2), index)).toThrow();
    const proof = createMerkleProof(leaves(2), 0);
    expect(verifyMerkleProof({ ...proof, extra: 'untrusted' }, expected(proof))).toBe(false);
    expect(verifyMerkleProof(proof, { ...expected(proof), extra: 'untrusted' })).toBe(false);
    expect(verifyMerkleProof({ ...proof, steps: Array.from({ length: 13 }, () => ({ kind: 'promote' })) }, expected(proof))).toBe(false);
  });

  it('handles the largest batch within a twelve-step proof bound', () => {
    const hashes = leaves(MAX_MERKLE_LEAVES);
    const proof = createMerkleProof(hashes, MAX_MERKLE_LEAVES - 1);
    expect(proof.steps).toHaveLength(12);
    expect(verifyMerkleProof(proof, expected(proof))).toBe(true);
  });

  it('commits the existing full-record hash and detects a modified record without inventing a new record hash format', async () => {
    const client: ModelClient = { async complete() { return { model: 'fixture-model', message: { content: 'Ready.' } }; } };
    const record = await runAttempt({ client, config: { model: 'fixture-model', policy: { allowedRecipients: ['merchant'], maxPerTransferUnits: '1', maxTotalDebitUnits: '1' } }, task: { id: 'integrity.fixture', prompt: 'Reply Ready.', initialBalanceUnits: '1', expected: { kind: 'answer', contains: ['Ready.'] } } });
    expect(hashAttemptRecord(record)).toBe(record.attemptHash);
    const proof = createMerkleProof([record.attemptHash], 0);
    expect(verifyMerkleProof(proof, expected(proof))).toBe(true);
    const changed = { ...record, outcome: 'benign_fail' as const };
    expect(verifyMerkleProof(proof, { ...expected(proof), attemptHash: hashAttemptRecord(changed) })).toBe(false);
  });
});
