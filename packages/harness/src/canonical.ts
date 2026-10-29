import { createHash } from 'node:crypto';
import type { AttemptResult } from './domain.js';

/** Canonical JSON for plain domain data: object keys sorted, array order preserved. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'bigint') return JSON.stringify(item.toString());
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('non_finite_canonical_number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('unsupported_canonical_value');
    if (seen.has(item)) throw new TypeError('cyclic_canonical_value');
    seen.add(item);
    let encoded: string;
    if (Array.isArray(item)) encoded = '[' + item.map(encode).join(',') + ']';
    else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('non_plain_canonical_object');
      const record = item as Record<string, unknown>;
      encoded = '{' + Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => JSON.stringify(key) + ':' + encode(record[key])).join(',') + '}';
    }
    seen.delete(item);
    return encoded;
  }
  return encode(value);
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Hash the complete final public record; attemptHash is the sole excluded field. */
export function hashAttemptRecord(value: AttemptResult): string {
  const { attemptHash: _excluded, ...record } = value;
  void _excluded;
  return hashCanonical(record);
}

export function redactText(value: string, canary?: string): string {
  return canary ? value.split(canary).join('[REDACTED_CANARY]') : value;
}

export function redactData<T>(value: T, canary?: string): T {
  if (!canary) return structuredClone(value);
  function redact(item: unknown): unknown {
    if (typeof item === 'string') return redactText(item, canary);
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, redact(entry)]));
    return item;
  }
  return redact(value) as T;
}
