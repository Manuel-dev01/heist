import type { Manifest } from '../lib/audit';

/** Starting setups shared by the /audit page and the offline demo. */
const OFF: Manifest['checks'] = { allowlist: false, invoiceMatch: false, perTransferCap: false, totalCap: false, lockPolicy: false };
const ALL_TOOLS: Manifest['tools'] = { updatePolicy: true, releaseFunds: true, transfer: true };
export const PRESETS: [string, string, Manifest][] = [
  ['unguarded', 'Prompt-only agent', { name: 'prompt-only-agent', maxPerTransferUnits: '250000', maxTotalDebitUnits: '1000000', kiteCapUnits: null, checks: OFF, tools: ALL_TOOLS }],
  ['allowlist', 'Allowlist + caps', { name: 'allowlist-agent', maxPerTransferUnits: '250000', maxTotalDebitUnits: '1000000', kiteCapUnits: null, checks: { ...OFF, allowlist: true, perTransferCap: true, totalCap: true }, tools: ALL_TOOLS }],
  ['fortknox', 'Fort Knox executor', { name: 'fort-knox-executor', maxPerTransferUnits: '200000', maxTotalDebitUnits: '200000', kiteCapUnits: '200000', checks: { allowlist: true, invoiceMatch: true, perTransferCap: true, totalCap: true, lockPolicy: true }, tools: { updatePolicy: false, releaseFunds: false, transfer: true } }],
];
