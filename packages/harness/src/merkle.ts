import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_MERKLE_LEAVES = 4096;
export const MERKLE_ALGORITHM = 'heist-sha256-ordered-v1' as const;
const MAX_PROOF_STEPS = 12;
const DOMAIN = Buffer.from('HEIST-MERKLE-V1\0', 'utf8');
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CountSchema = z.number().int().min(1).max(MAX_MERKLE_LEAVES);
const IndexSchema = z.number().int().min(0).max(MAX_MERKLE_LEAVES - 1);

export const MerkleBatchSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal(MERKLE_ALGORITHM),
  leafCount: z.number().int().min(0).max(MAX_MERKLE_LEAVES),
  rootHash: HashSchema.nullable(),
}).strict().superRefine((batch, context) => {
  if ((batch.leafCount === 0) !== (batch.rootHash === null)) context.addIssue({ code: 'custom', message: 'Only an empty batch has a null root.' });
});
export type MerkleBatch = z.infer<typeof MerkleBatchSchema>;

const ProofStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sibling'), side: z.enum(['left', 'right']), hash: HashSchema }).strict(),
  z.object({ kind: z.literal('promote') }).strict(),
]);
export const MerkleProofSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal(MERKLE_ALGORITHM),
  rootHash: HashSchema,
  attemptHash: HashSchema,
  leafIndex: IndexSchema,
  leafCount: CountSchema,
  steps: z.array(ProofStepSchema).max(MAX_PROOF_STEPS),
}).strict().superRefine((proof, context) => {
  if (proof.leafIndex >= proof.leafCount) context.addIssue({ code: 'custom', message: 'Leaf index is outside the batch.' });
});
export type MerkleProof = z.infer<typeof MerkleProofSchema>;
export const MerkleProofExpectedSchema = z.object({
  rootHash: HashSchema,
  attemptHash: HashSchema,
  leafIndex: IndexSchema,
  leafCount: CountSchema,
}).strict().superRefine((expected, context) => {
  if (expected.leafIndex >= expected.leafCount) context.addIssue({ code: 'custom', message: 'Expected index is outside the batch.' });
});
export type MerkleProofExpected = z.infer<typeof MerkleProofExpectedSchema>;

export class MerkleIntegrityError extends Error {
  readonly code: 'INVALID_BATCH' | 'INVALID_INDEX';
  constructor(code: MerkleIntegrityError['code']) {
    super('Merkle input failed its bounded local integrity contract.');
    this.name = 'MerkleIntegrityError'; this.code = code;
  }
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
function digest(tag: number, ...parts: Buffer[]): Buffer {
  const hash = createHash('sha256').update(DOMAIN).update(Buffer.from([tag]));
  for (const part of parts) hash.update(part);
  return hash.digest();
}
function leafHash(attemptHash: string, index: number): Buffer {
  return digest(0x00, uint32(index), Buffer.from(attemptHash, 'hex'));
}
function nodeHash(left: Buffer, right: Buffer): Buffer { return digest(0x01, left, right); }
function rootHash(treeTop: Buffer, count: number): string { return digest(0x02, uint32(count), treeTop).toString('hex'); }
function parseHashes(input: readonly string[]): string[] {
  // Check length before schema traversal, so an oversized array is rejected immediately.
  if (!Array.isArray(input) || input.length > MAX_MERKLE_LEAVES) throw new MerkleIntegrityError('INVALID_BATCH');
  const parsed = z.array(HashSchema).max(MAX_MERKLE_LEAVES).safeParse(input);
  if (!parsed.success) throw new MerkleIntegrityError('INVALID_BATCH');
  return parsed.data;
}
function levelsFor(hashes: readonly string[]): Buffer[][] {
  if (hashes.length === 0) return [];
  const levels: Buffer[][] = [hashes.map(leafHash)];
  while (levels[levels.length - 1]!.length > 1) {
    const current = levels[levels.length - 1]!;
    const next: Buffer[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index]!;
      const right = current[index + 1];
      // Odd nodes are promoted unchanged; never duplicate an odd node implicitly.
      next.push(right === undefined ? left : nodeHash(left, right));
    }
    levels.push(next);
  }
  return levels;
}

/**
 * Local integrity commitment only. Preserve input order and duplicates; do not sort or dedupe.
 * Leaves commit full-record attempt hashes, their positions, and the final root's leaf count.
 * The empty batch deliberately has no root and cannot produce a membership proof.
 */
export function buildMerkleBatch(orderedAttemptHashes: readonly string[]): MerkleBatch {
  const hashes = parseHashes(orderedAttemptHashes);
  const levels = levelsFor(hashes);
  return {
    schemaVersion: 1, algorithm: MERKLE_ALGORITHM, leafCount: hashes.length,
    rootHash: hashes.length === 0 ? null : rootHash(levels[levels.length - 1]![0]!, hashes.length),
  };
}

export function createMerkleProof(orderedAttemptHashes: readonly string[], leafIndex: number): MerkleProof {
  const hashes = parseHashes(orderedAttemptHashes);
  const parsedIndex = IndexSchema.safeParse(leafIndex);
  if (!parsedIndex.success || parsedIndex.data >= hashes.length) throw new MerkleIntegrityError('INVALID_INDEX');
  const levels = levelsFor(hashes);
  const steps: MerkleProof['steps'] = [];
  let index = parsedIndex.data;
  for (const level of levels.slice(0, -1)) {
    if (index % 2 === 1) steps.push({ kind: 'sibling', side: 'left', hash: level[index - 1]!.toString('hex') });
    else if (index + 1 < level.length) steps.push({ kind: 'sibling', side: 'right', hash: level[index + 1]!.toString('hex') });
    else steps.push({ kind: 'promote' });
    index = Math.floor(index / 2);
  }
  return {
    schemaVersion: 1, algorithm: MERKLE_ALGORITHM,
    rootHash: rootHash(levels[levels.length - 1]![0]!, hashes.length),
    attemptHash: hashes[parsedIndex.data]!, leafIndex: parsedIndex.data, leafCount: hashes.length, steps,
  };
}

/** Fail closed on malformed or tampered input. Expected identity must come from a trusted caller. */
export function verifyMerkleProof(input: unknown, expectedInput: unknown): boolean {
  try { return verifyChecked(input, expectedInput); }
  catch { return false; }
}

function verifyChecked(input: unknown, expectedInput: unknown): boolean {
  // A proof has at most twelve levels; avoid walking an oversized untrusted steps array.
  if (input !== null && typeof input === 'object' && 'steps' in input && Array.isArray(input.steps) && input.steps.length > MAX_PROOF_STEPS) return false;
  const proofResult = MerkleProofSchema.safeParse(input);
  const expectedResult = MerkleProofExpectedSchema.safeParse(expectedInput);
  if (!proofResult.success || !expectedResult.success) return false;
  const proof = proofResult.data;
  const expected = expectedResult.data;
  if (proof.rootHash !== expected.rootHash || proof.attemptHash !== expected.attemptHash || proof.leafIndex !== expected.leafIndex || proof.leafCount !== expected.leafCount) return false;
  let current = leafHash(proof.attemptHash, proof.leafIndex);
  let index = proof.leafIndex;
  let count = proof.leafCount;
  let stepIndex = 0;
  while (count > 1) {
    const step = proof.steps[stepIndex];
    if (step === undefined) return false;
    const promotes = index % 2 === 0 && index + 1 === count;
    if (promotes) {
      if (step.kind !== 'promote') return false;
    } else {
      if (step.kind !== 'sibling' || step.side !== (index % 2 === 1 ? 'left' : 'right')) return false;
      const sibling = Buffer.from(step.hash, 'hex');
      current = step.side === 'left' ? nodeHash(sibling, current) : nodeHash(current, sibling);
    }
    index = Math.floor(index / 2);
    count = Math.ceil(count / 2);
    stepIndex += 1;
  }
  return stepIndex === proof.steps.length && rootHash(current, proof.leafCount) === expected.rootHash;
}
