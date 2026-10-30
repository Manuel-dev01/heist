import { canonicalJson, IdentifierSchema, parseAttemptRecord, type AttemptRecord } from '@heist/harness';
import { z } from 'zod';

/** Inject an already configured pg-compatible driver. This adapter creates no connection. */
export interface AttemptStoreDriver {
  query(sql: string, parameters: unknown[]): Promise<{ rows: readonly unknown[] }>;
}
export const AttemptStoreMetadataSchema = z.object({
  executionEnvironment: z.enum(['local_simulation', 'isolated_audit_replica']),
  sourceKind: z.enum(['fixture', 'serv', 'dolphin']),
  cohortKind: z.enum(['readiness', 'funds', 'secret_extraction', 'benign_utility', 'utility_under_attack']),
  corpusId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
  replicateIndex: z.number().int().min(0).max(1_000_000),
}).strict();
export type AttemptStoreMetadata = z.infer<typeof AttemptStoreMetadataSchema>;
export interface StoredAttempt {
  record: AttemptRecord;
  metadata: AttemptStoreMetadata;
  /** Normalized driver timestamp; record.ts retains the exact original hashed text. */
  occurredAt: string;
  /** Existing database timestamp, including on replay; never a new client timestamp. */
  ingestedAt: string;
}
export type AttemptStoreErrorCode = 'INVALID_INPUT' | 'CONFLICT' | 'CORRUPT_ROW' | 'DRIVER_FAILURE';
const errorMessages: Record<AttemptStoreErrorCode, string> = {
  INVALID_INPUT: 'Attempt store input is invalid.',
  CONFLICT: 'Attempt store identity conflicts with immutable stored content.',
  CORRUPT_ROW: 'Attempt store returned invalid or inconsistent evidence.',
  DRIVER_FAILURE: 'Attempt store driver operation failed.',
};
/** Deliberately excludes driver messages, query parameters, payloads and causes. */
export class AttemptStoreError extends Error {
  readonly code: AttemptStoreErrorCode;
  constructor(code: AttemptStoreErrorCode) {
    super(errorMessages[code]);
    this.name = 'AttemptStoreError';
    this.code = code;
  }
}
const appendInput = z.object({ record: z.unknown(), metadata: AttemptStoreMetadataSchema }).strict();
const uuid = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.union([z.date(), z.iso.datetime()]);
const storedRow = z.object({
  record_json: z.unknown(), occurred_at: timestamp, ingested_at: timestamp,
  execution_environment: AttemptStoreMetadataSchema.shape.executionEnvironment,
  source_kind: AttemptStoreMetadataSchema.shape.sourceKind,
  cohort_kind: AttemptStoreMetadataSchema.shape.cohortKind,
  corpus_id: AttemptStoreMetadataSchema.shape.corpusId,
  replicate_index: AttemptStoreMetadataSchema.shape.replicateIndex,
}).strict();
const columns = 'record_json, occurred_at, ingested_at, execution_environment, source_kind, cohort_kind, corpus_id, replicate_index';
const insertSql = 'INSERT INTO heist.attempts (record_json, occurred_at, execution_environment, source_kind, cohort_kind, corpus_id, replicate_index) VALUES ($1::jsonb, $2::timestamptz, $3::text, $4::text, $5::text, $6::text, $7::integer) ON CONFLICT DO NOTHING RETURNING ' + columns;
const selectIdSql = 'SELECT ' + columns + ' FROM heist.attempts WHERE id = $1::uuid LIMIT 1';
const selectHashSql = 'SELECT ' + columns + ' FROM heist.attempts WHERE attempt_hash = $1::text LIMIT 1';
const selectConflictSql = 'SELECT ' + columns + ' FROM heist.attempts WHERE id = $1::uuid OR attempt_hash = $2::text ORDER BY id LIMIT 2';

function validatedRecord(input: unknown, code: 'INVALID_INPUT' | 'CORRUPT_ROW'): AttemptRecord {
  try {
    const result = parseAttemptRecord(input);
    if (!result.ok || !IdentifierSchema.safeParse(result.record.taskId).success || result.record.oracle.attemptedUnsafeCalls > 160) throw new Error();
    // PostgreSQL timestamps round beyond microseconds; a pg Date result could
    // then disagree with JavaScript's truncation. Preserve text and reject instead.
    if (/\.[0-9]{7,}Z$/.test(result.record.ts)) throw new Error();
    // Snapshot nested custom JSON results before handing anything to an async driver.
    const snapshot: unknown = JSON.parse(JSON.stringify(result.record));
    const checked = parseAttemptRecord(snapshot);
    if (!checked.ok) throw new Error();
    return checked.record;
  } catch { throw new AttemptStoreError(code); }
}
function readRow(input: unknown): StoredAttempt {
  try {
    const parsed = storedRow.safeParse(input);
    if (!parsed.success) throw new Error();
    const row = parsed.data;
    const record = validatedRecord(row.record_json, 'CORRUPT_ROW');
    const occurredAt = new Date(row.occurred_at).toISOString();
    const ingestedAt = new Date(row.ingested_at).toISOString();
    if (occurredAt !== new Date(record.ts).toISOString()) throw new Error();
    return {
      record, occurredAt, ingestedAt,
      metadata: {
        executionEnvironment: row.execution_environment, sourceKind: row.source_kind,
        cohortKind: row.cohort_kind, corpusId: row.corpus_id, replicateIndex: row.replicate_index,
      },
    };
  } catch { throw new AttemptStoreError('CORRUPT_ROW'); }
}
function identical(stored: StoredAttempt, record: AttemptRecord, metadata: AttemptStoreMetadata): boolean {
  return canonicalJson(stored.record) === canonicalJson(record) && canonicalJson(stored.metadata) === canonicalJson(metadata);
}

export function createAttemptStore(driver: AttemptStoreDriver) {
  try {
    if (!driver || typeof driver !== 'object' || typeof driver.query !== 'function') throw new Error();
  } catch { throw new AttemptStoreError('INVALID_INPUT'); }
  async function query(sql: string, parameters: unknown[], maximumRows: number): Promise<readonly unknown[]> {
    try {
      const result = await driver.query(sql, parameters);
      if (!result || !Array.isArray(result.rows) || result.rows.length > maximumRows) throw new Error();
      return result.rows;
    } catch { throw new AttemptStoreError('DRIVER_FAILURE'); }
  }
  return {
    async append(input: unknown): Promise<{ status: 'inserted' | 'replayed'; attempt: StoredAttempt }> {
      let record: AttemptRecord;
      let metadata: AttemptStoreMetadata;
      try {
        const parsed = appendInput.safeParse(input);
        if (!parsed.success) throw new Error();
        record = validatedRecord(parsed.data.record, 'INVALID_INPUT');
        metadata = parsed.data.metadata;
      } catch { throw new AttemptStoreError('INVALID_INPUT'); }
      const rows = await query(insertSql, [JSON.stringify(record), record.ts, metadata.executionEnvironment,
        metadata.sourceKind, metadata.cohortKind, metadata.corpusId, metadata.replicateIndex], 1);
      if (rows.length === 1) {
        const attempt = readRow(rows[0]);
        if (!identical(attempt, record, metadata)) throw new AttemptStoreError('CORRUPT_ROW');
        return { status: 'inserted', attempt };
      }
      // A separate bounded read works with READ COMMITTED after a competing
      // INSERT commits. Caller-owned stronger transaction snapshots may instead
      // produce DRIVER_FAILURE; this adapter neither retries nor owns transactions.
      const existingRows = await query(selectConflictSql, [record.id.toLowerCase(), record.attemptHash], 2);
      if (existingRows.length === 0) throw new AttemptStoreError('DRIVER_FAILURE');
      const existing = existingRows.map(readRow);
      if (existing.length !== 1 || !existing[0] || !identical(existing[0], record, metadata)) throw new AttemptStoreError('CONFLICT');
      return { status: 'replayed', attempt: existing[0] };
    },
    async getById(input: unknown): Promise<StoredAttempt | null> {
      const parsed = uuid.safeParse(input);
      if (!parsed.success) throw new AttemptStoreError('INVALID_INPUT');
      const id = parsed.data.toLowerCase();
      const rows = await query(selectIdSql, [id], 1);
      if (rows.length === 0) return null;
      const attempt = readRow(rows[0]);
      if (attempt.record.id.toLowerCase() !== id) throw new AttemptStoreError('CORRUPT_ROW');
      return attempt;
    },
    async getByHash(input: unknown): Promise<StoredAttempt | null> {
      const parsed = hash.safeParse(input);
      if (!parsed.success) throw new AttemptStoreError('INVALID_INPUT');
      const rows = await query(selectHashSql, [parsed.data], 1);
      if (rows.length === 0) return null;
      const attempt = readRow(rows[0]);
      if (attempt.record.attemptHash !== parsed.data) throw new AttemptStoreError('CORRUPT_ROW');
      return attempt;
    },
  };
}
