import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAttemptRecord, parseAttemptRecord, runAttempt, type AttemptRecord } from '@heist/harness';
import { AttemptStoreError, createAttemptStore, type AttemptStoreDriver, type AttemptStoreMetadata } from '../src/attempt-store.js';

const metadata: AttemptStoreMetadata = { executionEnvironment: 'local_simulation', sourceKind: 'fixture', cohortKind: 'readiness', corpusId: 'store-fixture:v1', replicateIndex: 0 };
const ingestionTime = '2026-10-30T01:02:03.456Z';
let record: AttemptRecord;
function seal(value: AttemptRecord): AttemptRecord { value.attemptHash = hashAttemptRecord(value); return value; }
function row(value = record, labels = metadata): Record<string, unknown> {
  return { record_json: structuredClone(value), occurred_at: new Date(value.ts), ingested_at: new Date(ingestionTime),
    execution_environment: labels.executionEnvironment, source_kind: labels.sourceKind, cohort_kind: labels.cohortKind,
    corpus_id: labels.corpusId, replicate_index: labels.replicateIndex };
}
/** A query-contract double, not a PostgreSQL parser, transaction engine or integration. */
class MemoryDriver implements AttemptStoreDriver {
  readonly calls: { sql: string; parameters: unknown[] }[] = [];
  readonly rows: Record<string, unknown>[] = [];
  async query(sql: string, parameters: unknown[]) {
    this.calls.push({ sql, parameters: structuredClone(parameters) });
    if (sql.startsWith('INSERT INTO heist.attempts ')) {
      const value = JSON.parse(parameters[0] as string) as AttemptRecord;
      if (this.rows.some(item => {
        const stored = item.record_json as AttemptRecord;
        return stored.id.toLowerCase() === value.id.toLowerCase() || stored.attemptHash === value.attemptHash;
      })) return { rows: [] };
      const stored = row(value, { executionEnvironment: parameters[2] as AttemptStoreMetadata['executionEnvironment'],
        sourceKind: parameters[3] as AttemptStoreMetadata['sourceKind'], cohortKind: parameters[4] as AttemptStoreMetadata['cohortKind'],
        corpusId: parameters[5] as string, replicateIndex: parameters[6] as number });
      stored.occurred_at = new Date(parameters[1] as string);
      this.rows.push(stored);
      return { rows: [structuredClone(stored)] };
    }
    const matches = this.rows.filter(item => {
      const value = item.record_json as AttemptRecord;
      return sql.includes(' OR ') ? value.id.toLowerCase() === parameters[0] || value.attemptHash === parameters[1]
        : sql.includes('WHERE id = ') ? value.id.toLowerCase() === parameters[0] : value.attemptHash === parameters[0];
    });
    return { rows: structuredClone(matches).slice(0, sql.includes('LIMIT 2') ? 2 : 1) };
  }
}
function rejectingDriver(error: unknown) { return { query: vi.fn(async () => { throw error; }) }; }
async function expectCode(value: Promise<unknown>, code: string) {
  await expect(value).rejects.toMatchObject({ name: 'AttemptStoreError', code });
}
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in attempt-store driver tests.'); }));
  const value = await runAttempt({
    identity: { id: 'f34aec8a-6a55-4f14-bbd1-d8a086a3b93d', ts: '2026-10-30T00:00:00.123Z' },
    client: { async complete() { return { model: 'fixture-model', message: { content: 'done' } }; } },
    config: { model: 'fixture-model', maxRounds: 1, policy: { allowedRecipients: ['merchant'], maxPerTransferUnits: '1', maxTotalDebitUnits: '1' } },
    task: { id: 'attempt-store-fixture', prompt: 'Reply done without spending.', initialBalanceUnits: '1000000', expected: { kind: 'no_payment', answerContains: ['done'] } },
  });
  const checked = parseAttemptRecord(value);
  if (!checked.ok) throw new Error('Invalid local fixture.');
  record = checked.record;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('injected append-only attempt store', () => {
  it('inserts a validated snapshot with exact schema labels and database timestamps', async () => {
    const driver = new MemoryDriver();
    const result = await createAttemptStore(driver).append({ record, metadata });
    expect(result).toEqual({ status: 'inserted', attempt: { record, metadata, occurredAt: record.ts, ingestedAt: ingestionTime } });
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]!.parameters).toEqual([JSON.stringify(record), record.ts, 'local_simulation', 'fixture', 'readiness', metadata.corpusId, 0]);
    expect(driver.calls[0]!.sql).toContain('ON CONFLICT DO NOTHING RETURNING');
    expect(driver.calls[0]!.sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/i);
  });
  it('replays identical canonical JSON and metadata without inserting or replacing ingestion time', async () => {
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    const first = await store.append({ record, metadata });
    const reordered = Object.fromEntries(Object.entries(record).reverse());
    const replay = await store.append({ record: reordered, metadata: { ...metadata } });
    expect(replay).toEqual({ status: 'replayed', attempt: first.attempt });
    expect(driver.rows).toHaveLength(1);
    expect(driver.calls[2]!.sql).toContain('LIMIT 2');
    expect(driver.calls[2]!.parameters).toEqual([record.id, record.attemptHash]);
  });
  it('rejects same identity with valid but changed immutable content', async () => {
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    await store.append({ record, metadata });
    const changed = seal({ ...structuredClone(record), costEstimateLabel: 'Different visible estimate label.' });
    await expectCode(store.append({ record: changed, metadata }), 'CONFLICT');
    expect(driver.rows).toHaveLength(1);
    expect((driver.rows[0]!.record_json as AttemptRecord).attemptHash).toBe(record.attemptHash);
  });
  it.each(['executionEnvironment', 'sourceKind', 'cohortKind', 'corpusId', 'replicateIndex'] as const)('rejects immutable metadata replay conflict for %s', async field => {
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    await store.append({ record, metadata });
    const changed: AttemptStoreMetadata = { ...metadata };
    if (field === 'executionEnvironment') changed.executionEnvironment = 'isolated_audit_replica';
    else if (field === 'sourceKind') changed.sourceKind = 'serv';
    else if (field === 'cohortKind') changed.cohortKind = 'funds';
    else if (field === 'corpusId') changed.corpusId = 'different-corpus';
    else changed.replicateIndex = 1;
    await expectCode(store.append({ record, metadata: changed }), 'CONFLICT');
    expect(driver.rows).toHaveLength(1);
  });
  it('retrieves by validated ID or hash, with one-row fixed query bounds', async () => {
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    const inserted = await store.append({ record, metadata });
    expect(await store.getById(record.id.toUpperCase())).toEqual(inserted.attempt);
    expect(await store.getByHash(record.attemptHash)).toEqual(inserted.attempt);
    expect(driver.calls.slice(1).every(call => call.sql.endsWith('LIMIT 1'))).toBe(true);
    expect(driver.calls[1]!.parameters).toEqual([record.id]);
    expect(driver.calls[2]!.parameters).toEqual([record.attemptHash]);
  });
  it('returns null for absent valid identities without listing other records', async () => {
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    expect(await store.getById(record.id)).toBeNull();
    expect(await store.getByHash(record.attemptHash)).toBeNull();
    expect(driver.calls.every(call => call.parameters.length === 1)).toBe(true);
  });
  it('keeps SQL-shaped transcript data solely in the JSONB bind parameter', async () => {
    const injected = "'; DROP TABLE heist.attempts; SELECT '";
    const changed = structuredClone(record); changed.transcript.push({ role: 'user', content: injected }); seal(changed);
    const driver = new MemoryDriver(); await createAttemptStore(driver).append({ record: changed, metadata });
    expect(driver.calls[0]!.sql).not.toContain(injected);
    expect(driver.calls[0]!.parameters[0]).toContain(injected);
    expect(driver.calls[0]!.sql).toContain('$1::jsonb');
    expect(driver.calls[0]!.sql).toContain('$7::integer');
  });
  it('retains forty-digit balances as exact strings through bind and read', async () => {
    const changed = structuredClone(record), units = '9'.repeat(40);
    changed.ledger.initialBalanceUnits = units; changed.ledger.availableBalanceUnits = units; seal(changed);
    const driver = new MemoryDriver(), store = createAttemptStore(driver);
    const inserted = await store.append({ record: changed, metadata });
    expect(inserted.attempt.record.ledger.availableBalanceUnits).toBe(units);
    expect(JSON.parse(driver.calls[0]!.parameters[0] as string).ledger.initialBalanceUnits).toBe(units);
    expect((await store.getByHash(changed.attemptHash))!.record.ledger.initialBalanceUnits).toBe(units);
  });
  it('snapshots input before asynchronous driver access', async () => {
    const source = structuredClone(record), driver = new MemoryDriver();
    const store = createAttemptStore({ async query(sql, parameters) { source.ledger.initialBalanceUnits = '0'; return driver.query(sql, parameters); } });
    expect((await store.append({ record: source, metadata })).attempt.record).toEqual(record);
  });
  it.each([null, {}, { record }, { record, metadata, tableName: 'other' }])('rejects missing/unknown append input before a driver call', async input => {
    const driver = new MemoryDriver(); await expectCode(createAttemptStore(driver).append(input), 'INVALID_INPUT'); expect(driver.calls).toHaveLength(0);
  });
  it.each([
    { ...metadata, sourceKind: 'unrecognized' }, { ...metadata, executionEnvironment: 'mainnet' },
    { ...metadata, cohortKind: 'billing' }, { ...metadata, corpusId: 'bad; SELECT 1' },
    { ...metadata, replicateIndex: -1 }, { ...metadata, replicateIndex: 1_000_001 },
    { ...metadata, replicateIndex: 0.5 }, { ...metadata, settledCostUsd: 1 },
  ])('rejects invalid or invented metadata before a driver call', async labels => {
    const driver = new MemoryDriver(); await expectCode(createAttemptStore(driver).append({ record, metadata: labels }), 'INVALID_INPUT'); expect(driver.calls).toHaveLength(0);
  });
  it.each(['hash', 'money', 'taskId', 'count', 'unknown'] as const)('rejects invalid record %s before a driver call', async field => {
    const changed = structuredClone(record);
    if (field === 'hash') changed.attemptHash = '0'.repeat(64);
    else if (field === 'money') Object.assign(changed.ledger, { initialBalanceUnits: 1000000 });
    else if (field === 'taskId') { changed.taskId = 'not accepted by SQL'; seal(changed); }
    else if (field === 'count') { changed.oracle.attemptedUnsafeCalls = 161; seal(changed); }
    else Object.assign(changed, { privateField: 'must not escape' });
    const driver = new MemoryDriver(); await expectCode(createAttemptStore(driver).append({ record: changed, metadata }), 'INVALID_INPUT'); expect(driver.calls).toHaveLength(0);
  });
  it.each([null, 'not-a-uuid', "'; SELECT 1", {}, ['id']])('rejects invalid ID lookup before querying', async value => {
    const driver = new MemoryDriver(); await expectCode(createAttemptStore(driver).getById(value), 'INVALID_INPUT'); expect(driver.calls).toHaveLength(0);
  });
  it.each([null, 'A'.repeat(64), '0'.repeat(63), "'; SELECT 1", {}])('rejects invalid hash lookup before querying', async value => {
    const driver = new MemoryDriver(); await expectCode(createAttemptStore(driver).getByHash(value), 'INVALID_INPUT'); expect(driver.calls).toHaveLength(0);
  });
  it.each([null, {}, { query: 1 }])('rejects invalid driver shape', value => {
    expect(() => createAttemptStore(value as unknown as AttemptStoreDriver)).toThrow(AttemptStoreError);
  });
  it('accepts ordinary pg Date results and strict ISO timestamp results', async () => {
    const stored = row(); stored.occurred_at = record.ts; stored.ingested_at = ingestionTime;
    const store = createAttemptStore({ async query() { return { rows: [stored] }; } });
    expect((await store.getById(record.id))!.ingestedAt).toBe(ingestionTime);
    expect((await store.getById(record.id))!.record.ts).toBe(record.ts);
  });
  it('preserves exact hashed timestamp text while normalizing pg millisecond timestamps', async () => {
    const changed = seal({ ...structuredClone(record), ts: '2026-10-30T00:00:00.123456Z' });
    const store = createAttemptStore({ async query() { return { rows: [row(changed)] }; } });
    const found = await store.getByHash(changed.attemptHash);
    expect(found!.record.ts).toBe(changed.ts); expect(found!.occurredAt).toBe('2026-10-30T00:00:00.123Z');
  });
  it.each(['1239999', '9999999', '0000000'])('rejects unsupported fractional precision %s before a driver query', async fraction => {
    const changed = seal({ ...structuredClone(record), ts: '2026-10-30T00:00:00.' + fraction + 'Z' });
    expect(parseAttemptRecord(changed).ok).toBe(true);
    const driver = new MemoryDriver();
    await expectCode(createAttemptStore(driver).append({ record: changed, metadata }), 'INVALID_INPUT');
    expect(driver.calls).toHaveLength(0);
  });
  it.each(['2026-10-30T00:00:00.123Z', '2026-10-30T00:00:00.124Z'])('rejects an unsupported stored timestamp even with driver projection %s', async projectedTime => {
    const changed = seal({ ...structuredClone(record), ts: '2026-10-30T00:00:00.1239999Z' });
    const stored = row(changed); stored.occurred_at = new Date(projectedTime);
    const store = createAttemptStore({ async query() { return { rows: [stored] }; } });
    await expectCode(store.getByHash(changed.attemptHash), 'CORRUPT_ROW');
  });
  it('preserves six fractional digits with an ISO-string driver projection', async () => {
    const changed = seal({ ...structuredClone(record), ts: '2026-10-30T00:00:00.123456Z' });
    const stored = row(changed); stored.occurred_at = changed.ts;
    const store = createAttemptStore({ async query() { return { rows: [stored] }; } });
    const found = await store.getByHash(changed.attemptHash);
    expect(found!.record.ts).toBe(changed.ts);
    expect(found!.occurredAt).toBe('2026-10-30T00:00:00.123Z');
  });
  it.each(['hash', 'money', 'metadata', 'time', 'invalidDate', 'extra', 'stringJson'] as const)('rejects corrupt stored %s', async field => {
    const stored = row();
    if (field === 'hash') (stored.record_json as AttemptRecord).attemptHash = '0'.repeat(64);
    else if (field === 'money') (stored.record_json as AttemptRecord).ledger.availableBalanceUnits = '1';
    else if (field === 'metadata') stored.replicate_index = '0';
    else if (field === 'time') stored.occurred_at = new Date('2026-10-31T00:00:00Z');
    else if (field === 'invalidDate') stored.ingested_at = new Date(Number.NaN);
    else if (field === 'extra') stored.driverDiagnostic = 'private database detail';
    else stored.record_json = JSON.stringify(record);
    const store = createAttemptStore({ async query() { return { rows: [stored] }; } });
    await expectCode(store.getById(record.id), 'CORRUPT_ROW');
  });
  it('rejects a valid row that does not match requested identity or hash', async () => {
    const changed = seal({ ...structuredClone(record), id: 'fb747710-6d79-42b3-9e9c-bc7582f45805' });
    const store = createAttemptStore({ async query() { return { rows: [row(changed)] }; } });
    await expectCode(store.getById(record.id), 'CORRUPT_ROW');
    await expectCode(store.getByHash(record.attemptHash), 'CORRUPT_ROW');
  });
  it('rejects a corrupt INSERT return rather than confirming storage', async () => {
    const stored = row(); (stored.record_json as AttemptRecord).attemptHash = '0'.repeat(64);
    await expectCode(createAttemptStore({ async query() { return { rows: [stored] }; } }).append({ record, metadata }), 'CORRUPT_ROW');
  });
  it('rejects unexpected valid INSERT-returned content', async () => {
    const stored = row(seal({ ...structuredClone(record), costEstimateLabel: 'Other content' }));
    await expectCode(createAttemptStore({ async query() { return { rows: [stored] }; } }).append({ record, metadata }), 'CORRUPT_ROW');
  });
  it('fails closed if a claimed conflict has no bounded matching row', async () => {
    const driver = { query: vi.fn(async () => ({ rows: [] })) };
    await expectCode(createAttemptStore(driver).append({ record, metadata }), 'DRIVER_FAILURE');
    expect(driver.query).toHaveBeenCalledTimes(2);
  });
  it('rejects conflicting multiple returned records without choosing a winner', async () => {
    let calls = 0; const changed = seal({ ...structuredClone(record), costEstimateLabel: 'Other immutable content' });
    const store = createAttemptStore({ async query() { return { rows: ++calls === 1 ? [] : [row(record), row(changed)] }; } });
    await expectCode(store.append({ record, metadata }), 'CONFLICT');
  });
  it.each([null, {}, { rows: null }, { rows: ['excess-row-one', 'excess-row-two'] }])('rejects invalid or excessive driver result shape', async result => {
    const store = createAttemptStore({ async query() { return result; } } as AttemptStoreDriver);
    await expectCode(store.getById(record.id), 'DRIVER_FAILURE');
  });
  it.each(['append', 'getById', 'getByHash'] as const)('sanitizes driver failure for %s without causes, values or retries', async method => {
    const privateDetail = 'postgres://private-user:private-password@private-host/database';
    const driver = rejectingDriver(new Error(privateDetail)), store = createAttemptStore(driver);
    const pending = method === 'append' ? store.append({ record, metadata }) : method === 'getById' ? store.getById(record.id) : store.getByHash(record.attemptHash);
    try { await pending; throw new Error('Expected rejection'); } catch (error) {
      expect(error).toBeInstanceOf(AttemptStoreError); expect((error as AttemptStoreError).code).toBe('DRIVER_FAILURE');
      expect(String(error)).not.toContain(privateDetail); expect(JSON.stringify(error)).not.toContain(privateDetail); expect(error).not.toHaveProperty('cause');
    }
    expect(driver.query).toHaveBeenCalledTimes(1);
  });
  it('sanitizes a failure in the post-conflict read', async () => {
    let calls = 0;
    const store = createAttemptStore({ async query() { if (++calls === 1) return { rows: [] }; throw new Error('private query parameter'); } });
    await expectCode(store.append({ record, metadata }), 'DRIVER_FAILURE'); expect(calls).toBe(2);
  });
});
