'use client';

import { useEffect, useRef, useState } from 'react';
import { createLatestAdaptiveSummaryReader, type AdaptiveSummary, type AdaptiveSummaryInspection } from '../lib/adaptive-summary-inspection';

const number = (value: number) => value.toLocaleString('en-US');
const words = (value: string) => value.replaceAll('_', ' ');
const tokenCount = (value: string | null) => value === null ? 'Unavailable' : BigInt(value).toLocaleString('en-US');
const money = (value: number | null) => value === null ? 'Unavailable' : 'US$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const messages: Record<Extract<AdaptiveSummaryInspection, { valid: false }>['reason'], string> = {
  file_size: 'Choose a nonempty adaptive summary JSON file no larger than 1 MiB.',
  file_read: 'This file could not be read. Choose the local summary again.',
  invalid_json: 'The file is not valid JSON. No summary is displayed.',
  bounded_json: 'The JSON structure exceeds supported limits. No summary is displayed.',
  invalid_summary: 'The version or compact summary fields are unsupported or inconsistent. Export a new summary with the offline inspector.',
  hash_mismatch: 'Summary hash mismatch. The original JSON does not match its summaryHash. No summary is displayed.',
  crypto_unavailable: 'Browser SHA-256 is unavailable. Open this local app on localhost or 127.0.0.1. No summary is displayed.',
};

export function AdaptiveSummaryInspector() {
  const reader = useRef<ReturnType<typeof createLatestAdaptiveSummaryReader> | null>(null);
  if (reader.current === null) reader.current = createLatestAdaptiveSummaryReader();
  const [inspection, setInspection] = useState<AdaptiveSummaryInspection | null>(null);
  const [reading, setReading] = useState(false), [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null), statusHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => reader.current?.cancel(), []);
  useEffect(() => { if (inspection) statusHeading.current?.focus({ preventScroll: true }); }, [inspection]);
  async function selectFile(file: File | undefined) {
    setInspection(null); setFileName(file?.name.slice(0, 200) ?? '');
    if (!file) { reader.current!.cancel(); setReading(false); return; }
    setReading(true); const result = await reader.current!.read(file);
    if (!result.current) return;
    setReading(false); setInspection(result.inspection);
  }
  function clear() {
    reader.current!.cancel(); setInspection(null); setReading(false); setFileName('');
    if (input.current) input.current.value = '';
    input.current?.focus();
  }
  return <div className="reports-page adaptive-page">
    <a className="skip-link" href="#adaptive-inspector">Skip to adaptive summary inspection</a>
    <header className="site-header">
      <a className="brand" href="/" aria-label="HEIST home"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>HEIST<span className="brand-dot" aria-hidden="true">_</span></a>
      <nav aria-label="Main navigation"><a href="/#arena">Arena</a><a href="/reports">Reports</a><a href="/reports/adaptive" aria-current="page">Adaptive</a></nav>
      <span className="local-badge"><span className="signal-dot" />LOCAL FILE INSPECTION</span>
    </header>
    <main className="page-width" id="adaptive-inspector">
      <section className="reports-hero" aria-labelledby="adaptive-title">
        <div><p className="eyebrow">EVIDENCE / ADAPTIVE DISCOVERY</p><h1 id="adaptive-title">FOLLOW THE<br /><span>SEARCH.</span><span className="reports-underscore">_</span></h1><p>Read the branches. Keep stops and unknowns in view.<br />A selected candidate is a discovery signal.</p></div>
        <div className="reports-boundary-note"><span className="reports-corner" aria-hidden="true">+</span><p className="micro-label">BROWSER BOUNDARY</p><strong>Your summary stays here.</strong><p>Choose the compact JSON exported by the offline inspector. This browser checks its hash and summary consistency. Original plan and result files are not checked here.</p><span className="reports-local-line"><span className="signal-dot" />NO UPLOAD / NO INFERENCE</span></div>
      </section>
      <section className="report-file-panel panel" aria-labelledby="adaptive-file-title">
        <div><p className="eyebrow">01 / SELECT LOCAL SUMMARY</p><h2 id="adaptive-file-title">Open adaptive-summary.json</h2><p id="adaptive-file-help" className="adaptive-file-help">Adaptive inspection summary version 1 · JSON · maximum 1 MiB. No search evidence is loaded by default.</p><p className="adaptive-file-help">Export with <code>pnpm --silent inspect:surrogate --plan PATH/plan.json --result PATH/result.json</code> and save its JSON output locally. <a href="/reports">Open a benchmark report instead ↗</a></p></div>
        <div className="report-file-actions"><label htmlFor="adaptive-file">Choose adaptive summary JSON</label><input id="adaptive-file" ref={input} type="file" accept=".json,application/json" aria-describedby="adaptive-file-help" onChange={event => { void selectFile(event.target.files?.[0]); }} /><button className="button button-quiet" type="button" onClick={clear} disabled={!fileName && !reading}>Clear summary</button></div>
      </section>
      <div className="report-read-status" aria-live="polite" aria-atomic="true">{reading ? <p role="status">Reading and checking the selected summary locally…</p> : inspection ? <h2 ref={statusHeading} tabIndex={-1} className={inspection.valid ? 'report-integrity-message' : 'report-error-message'}>{inspection.valid ? inspection.verificationLabel : messages[inspection.reason]}</h2> : <p role="status">No summary selected. Choose a file to inspect its declared search.</p>}</div>
      {inspection?.valid ? <AdaptiveReadout summary={inspection.summary} fileName={fileName} /> : <section className="report-empty" aria-label="No adaptive summary displayed"><span aria-hidden="true">[ — ]</span><h2>{inspection ? 'Summary withheld.' : 'Follow a recorded search.'}</h2><p>{inspection ? 'The previous summary has been cleared. Choose a supported summary to continue.' : 'No attack score, provider activity, or corpus quality is inferred here.'}</p></section>}
      <aside className="report-method-note"><p className="eyebrow">WHAT THIS CHECK MEANS</p><p>The summary hash binds this JSON to its own summaryHash. A summary can be deliberately changed and rehashed. The browser checks compact consistency only; it does not verify original records, oracle decisions, provider origin, authorization or billing. Run the full offline inspector with the original plan and result for deeper local checks.</p></aside>
    </main>
    <footer className="site-footer page-width"><a className="footer-brand" href="/">HEIST<span>_</span></a><p>READ THE BRANCHES. KEEP THE STOPS.</p><a href="/reports" className="back-top">BENCHMARK REPORTS ↗</a></footer>
  </div>;
}

function AdaptiveReadout({ summary: s, fileName }: { summary: AdaptiveSummary; fileName: string }) {
  const counts = [
    ['Screens', s.counts.screens, 'Recorded screen attempts'], ['Completed', s.counts.completedScreens, 'Non-error screens, including task failures'],
    ['Screen errors', s.counts.screenErrors, 'Operational failures, not protection'], ['Refinements', s.counts.refinements, 'Refined, refused, invalid or duplicate responses'],
    ['Eligible', s.counts.eligibleCandidates, 'Unique non-error goal signals'], ['Selected', s.counts.selectedCandidates, 'Selected hashes; a corpus is separate'],
  ] as const;
  return <section className="report-readout" aria-labelledby="adaptive-readout-title">
    <div className="report-readout-heading"><div><p className="eyebrow">02 / DECLARED SEARCH COVERAGE</p><h2 id="adaptive-readout-title">{s.planId}</h2><p className="report-file-name">{fileName}</p></div><span className={'report-source-badge ' + (s.source === 'scripted_fixture' ? 'is-scripted' : 'is-attested')}>{s.source === 'scripted_fixture' ? 'SCRIPTED FIXTURE' : 'INFERENCE · CALLER ATTESTATION'}</span></div>
    <p className="report-integrity-limit">Original plan/result, full records and oracle calculations have not been checked in this browser. Source and model labels are caller-attested. All ledger effects use synthetic funds.</p>
    <dl className="report-counts">{counts.map(([title, value, detail]) => <div key={title} className={title === 'Screen errors' && value > 0 ? 'has-errors' : ''}><dt>{title}</dt><dd>{number(value)}</dd><p>{detail}</p></div>)}</dl>
    <div className="report-run-state"><span>DECLARED {s.executionStatus.toUpperCase()}</span><p>{s.stopReason ? 'Stop reason: ' + words(s.stopReason) : 'No stop reason declared.'}</p><span>SYNTHETIC EXECUTION ONLY</span></div>
    {s.executionStatus === 'stopped' && <p className="report-warning">The search stopped. Earlier goal signals, utility and synthetic loss may remain in its records. A stopped search has no frozen corpus, even when selected hashes remain.</p>}
    <div className="adaptive-card-grid">
      <article className="report-group panel"><p className="eyebrow">SELECTION / {words(s.selectionStatus).toUpperCase()}</p><h3>{s.selection.corpusHash ? 'Frozen corpus declared' : 'No frozen corpus'}</h3><p className="adaptive-note">{number(s.counts.selectedCandidates)} selected hashes · {number(s.selection.untestedBenignTemplates)} untested benign templates. Selection on a surrogate does not establish transfer to SERV or representative attack success.</p><dl className="adaptive-definitions"><div><dt>Surrogate model</dt><dd>{s.models.surrogate}</dd></div><div><dt>Refiner model</dt><dd>{s.models.attacker}</dd></div></dl></article>
      <article className="report-group panel"><p className="eyebrow">ADMISSION / REQUESTED ALLOWANCES</p><h3>{number(s.budget.clientInvocations)} client invocations</h3><dl className="adaptive-definitions"><div><dt>Calls reserved / maximum</dt><dd>{number(s.budget.callsReserved)} / {number(s.budget.maximumClientInvocations)}</dd></div><div><dt>Output reserved / maximum</dt><dd>{number(s.budget.outputTokensReserved)} / {number(s.budget.maximumRequestedOutputTokens)}</dd></div><div><dt>Output requested for invoked calls</dt><dd>{number(s.budget.requestedOutputTokensForInvocations)} tokens</dd></div></dl><p className="adaptive-note">Reservations and requests are allowances. They are not consumed tokens or a dollar spending cap.</p></article>
      <article className="report-group panel"><p className="eyebrow">RESPONSE TOKEN COVERAGE</p><h3>{number(s.usage.knownCalls)} calls with known usage</h3><dl className="adaptive-definitions"><div><dt>Settled with unknown usage</dt><dd>{number(s.usage.unknownSettledCalls)}</dd></div><div><dt>Unobserved settlements</dt><dd>{number(s.usage.unobservedCalls)}</dd></div><div><dt>Known input / output tokens</dt><dd>{tokenCount(s.usage.inputTokensKnownSubtotal)} / {tokenCount(s.usage.outputTokensKnownSubtotal)}</dd></div></dl><p className="adaptive-note">Unknown and late settlements remain explicit. Usage coverage and cost coverage are independent.</p></article>
      <article className="report-group panel"><p className="eyebrow">TOKEN ESTIMATES / BILLING UNVERIFIED</p><h3>{money(s.cost.knownSubtotalEstimateUsd)} known subtotal</h3><dl className="adaptive-definitions"><div><dt>Known / unknown call estimates</dt><dd>{number(s.cost.knownCalls)} / {number(s.cost.unknownCalls)}</dd></div><div><dt>Full estimate</dt><dd>{money(s.cost.totalEstimateUsd)}</dd></div><div><dt>Actual billed amount</dt><dd>Unknown</dd></div></dl><p className="adaptive-note">Missing charges are not zero. Token-price estimates do not establish actual billing or a guaranteed financial cap.</p></article>
    </div>
    <div className="report-groups-heading"><div><p className="eyebrow">03 / ROOT BRANCHES</p><h3>{number(s.branches.length)} roots · {number(s.counts.pendingBranches)} pending or active</h3></div><p>Root count differs from candidate count because refinement can create children. Related candidates are a biased discovery set, not independent trials.</p></div>
    <ul className="adaptive-branches">{s.branches.map((branch, index) => <li className="panel" key={branch.rootHash}><p className="micro-label">ROOT {String(index + 1).padStart(2, '0')} / ROUND {branch.round}</p><h4>{words(branch.state)}</h4><p className="adaptive-case-id">{branch.seedCaseId}</p><dl className="adaptive-definitions"><div><dt>Root hash</dt><dd><code>{branch.rootHash}</code></dd></div><div><dt>Current candidate</dt><dd><code>{branch.currentHash}</code></dd></div></dl></li>)}</ul>
    <details className="adaptive-timeline"><summary>Compact event timeline · {number(s.events.length)} entries</summary><p className="adaptive-note">Goal attainment differs from breach and legitimate-task utility. Operational error records can retain earlier effects. Refusal, invalid output and duplicate refinements are not screen errors.</p><ol>{s.events.map(event => <li className="panel" key={event.slotId}><div><span className="micro-label">{event.kind.toUpperCase()} / ROUND {event.round}</span><h4>{event.kind === 'screen' ? words(event.outcome) : words(event.status)}</h4><p className="adaptive-case-id">{event.slotId}</p>{event.kind === 'screen' && event.errorCode && <p className="adaptive-note">Error: {words(event.errorCode)}</p>}</div>{event.kind === 'screen' ? <dl className="adaptive-definitions"><div><dt>Goal signal</dt><dd>{event.goalAchieved ? 'Observed' : 'Not observed'}{event.outcome === 'error' ? ' · not eligible on error' : ''}</dd></div><div><dt>Legitimate-task utility</dt><dd>{event.utilitySuccess ? 'Retained success' : 'Not completed'}</dd></div><div><dt>Synthetic loss</dt><dd>{event.valueLostUnits} whole units</dd></div></dl> : <p className="adaptive-note">{event.childHash ? 'Child hash retained: ' + event.childHash : 'No child hash retained.'}</p>}<p className="adaptive-note">Callback: {words(event.callback)}</p></li>)}</ol></details>
    <details className="report-fingerprints"><summary>Summary fingerprints and declared limits</summary><dl>{[['Summary hash', s.summaryHash], ['Original plan hash', s.planHash], ['Original result hash', s.resultHash], ['Seed corpus hash', s.seedCorpusHash], ['Selected corpus hash', s.selection.corpusHash ?? 'None']].map(([title, value]) => <div key={title}><dt>{title}</dt><dd><code>{value}</code></dd></div>)}</dl><ul className="adaptive-limitations">{s.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>
  </section>;
}
