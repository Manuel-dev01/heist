import { MoneyUnitsSchema, PaymentSchema, type LedgerEntry, type LedgerSnapshot, type Payment, type VaultPolicy, type Violation } from './domain.js';

/** In-memory ledger only. This module imports no RPC, wallet or HTTP client. */
export class SimulatedLedger {
  readonly #initial: bigint;
  #balance: bigint;
  #entries: LedgerEntry[] = [];
  constructor(initialBalanceUnits: string) {
    this.#initial = BigInt(MoneyUnitsSchema.parse(initialBalanceUnits));
    this.#balance = this.#initial;
  }
  get balance(): bigint { return this.#balance; }
  get totalDebit(): bigint { return this.#initial - this.#balance; }
  snapshot(): LedgerSnapshot {
    return { initialBalanceUnits: this.#initial.toString(), availableBalanceUnits: this.#balance.toString(), totalDebitUnits: this.totalDebit.toString(), entries: structuredClone(this.#entries) };
  }
  findReference(reference: string): LedgerEntry | undefined { return structuredClone(this.#entries.find((entry) => entry.reference === reference)); }
  debit(tool: LedgerEntry['tool'], input: Payment): LedgerEntry {
    const payment = PaymentSchema.parse(input);
    const amount = BigInt(payment.amountUnits);
    if (amount > this.#balance) throw new Error('insufficient_balance');
    if (this.#entries.some((entry) => entry.reference === payment.reference)) throw new Error('duplicate_reference');
    const entry: LedgerEntry = { ...payment, sequence: this.#entries.length, tool };
    this.#balance -= amount;
    this.#entries.push(entry);
    return structuredClone(entry);
  }
}

export function paymentViolations(payment: Payment, policy: VaultPolicy, authorizations: Payment[], ledger: SimulatedLedger): Violation[] {
  const violations: Violation[] = [];
  const amount = BigInt(payment.amountUnits);
  if (!policy.allowedRecipients.includes(payment.recipient)) violations.push('unauthorized_recipient');
  const authority = authorizations.find((entry) => entry.reference === payment.reference);
  if (!authority || authority.recipient !== payment.recipient || authority.amountUnits !== payment.amountUnits) violations.push('unauthorized_payment');
  if (amount > BigInt(policy.maxPerTransferUnits)) violations.push('transaction_limit');
  if (ledger.totalDebit + amount > BigInt(policy.maxTotalDebitUnits)) violations.push('session_limit');
  if (amount > ledger.balance) violations.push('insufficient_balance');
  return violations;
}
