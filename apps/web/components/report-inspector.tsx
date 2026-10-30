'use client';

import { useEffect, useRef, useState } from 'react';
import { createLatestReportReader, type InspectedReport, type ReportInspection } from '../lib/report-inspection';

const percent = (value: number | null) => value === null ? 'Unavailable' : (value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
const number = (value: number) => value.toLocaleString('en-US');
const milliseconds = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' ms';
const money = (value: number | null) => value === null ? 'Unavailable' :
  'US$' + (value > 0 && value < 0.00000001 ? value.toExponential(3) : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 }));
const readable = (value: string) => value.replaceAll('_', ' ');
const messages: Record<Extract<ReportInspection, { valid: false }>['reason'], string> = {
  file_size: 'Choose a nonempty report JSON file no larger than 4 MiB.',
  file_read: 'This file could not be read. Choose the local report again.',
  invalid_json: 'The file is not valid JSON. No metrics are displayed.',
  bounded_json: 'The file exceeds the supported JSON structure limits. No metrics are displayed.',
  invalid_report: 'The report version, source, or projected counts and metrics are unsupported or inconsistent. No metrics are displayed.',
  hash_mismatch: 'Report hash mismatch. The original JSON does not match its reportHash. No metrics are displayed.',
  crypto_unavailable: 'Browser SHA-256 is unavailable. Open this local app on localhost or 127.0.0.1. No metrics are displayed.',
};

export function ReportInspector() {
  const reader = useRef<ReturnType<typeof createLatestReportReader> | null>(null);
  if (reader.current === null) reader.current = createLatestReportReader();
  const [inspection, setInspection] = useState<ReportInspection | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => reader.current?.cancel(), []);
  useEffect(() => { if (inspection) statusHeading.current?.focus({ preventScroll: true }); }, [inspection]);
  const report = inspection?.valid ? inspection.report : null;

  async function selectFile(file: File | undefined) {
    setInspection(null);
    setFileName(file?.name.slice(0, 200) ?? '');
    if (!file) { reader.current!.cancel(); setReading(false); return; }
    setReading(true);
    const result = await reader.current!.read(file);
    if (!result.current) return;
    setReading(false);
    setInspection(result.inspection);
  }
  function clear() {
    reader.current!.cancel();
    setReading(false); setInspection(null); setFileName('');
    if (fileInput.current) fileInput.current.value = '';
    fileInput.current?.focus();
  }

  return <div className="reports-page">
    <a className="skip-link" href="#report-inspector">Skip to report inspection</a>
    <header className="site-header">
      <a className="brand" href="/" aria-label="HEIST home"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>HEIST<span className="brand-dot" aria-hidden="true">_</span></a>
      <nav aria-label="Main navigation"><a href="/#arena">Arena</a><a href="/reports" aria-current="page">Reports</a><a href="/#methodology">Methodology</a></nav>
      <span className="local-badge"><span className="signal-dot" />LOCAL FILE INSPECTION</span>
    </header>
    <main className="page-width" id="report-inspector">
      <section className="reports-hero" aria-labelledby="reports-title">
        <div><p className="eyebrow">EVIDENCE / BRING YOUR OWN REPORT</p><h1 id="reports-title">READ THE<br /><span>EVIDENCE.</span><span className="reports-underscore">_</span></h1><p>A report is a claim with a record attached.<br />Start with coverage. Keep errors in view.</p></div>
        <div className="reports-boundary-note"><span className="reports-corner" aria-hidden="true">+</span><p className="micro-label">BROWSER BOUNDARY</p><strong>Your file stays here.</strong><p>Choose a saved benchmark report. This page reads and hashes it in this browser. It sends no file or metrics to a server.</p><span className="reports-local-line"><span className="signal-dot" />NO UPLOAD / NO INFERENCE</span></div>
      </section>
      <section className="report-file-panel panel" aria-labelledby="report-file-title">
        <div><p className="eyebrow">01 / SELECT LOCAL EVIDENCE</p><h2 id="report-file-title">Open a report.json</h2><p id="report-file-help">Benchmark schema version 1 · JSON · maximum 4 MiB. No report or performance data is loaded by default.</p></div>
        <div className="report-file-actions"><label htmlFor="report-file">Choose report JSON</label><input ref={fileInput} id="report-file" type="file" accept=".json,application/json" aria-describedby="report-file-help" onChange={event => { void selectFile(event.target.files?.[0]); }} /><button className="button button-quiet" type="button" onClick={clear} disabled={!fileName && !reading}>Clear report</button></div>
      </section>
      <div className="report-read-status" aria-live="polite" aria-atomic="true">
        {reading ? <p role="status">Reading and checking the selected file locally…</p> : inspection ? <h2 ref={statusHeading} tabIndex={-1} className={inspection.valid ? 'report-integrity-message' : 'report-error-message'}>{inspection.valid ? inspection.verificationLabel : messages[inspection.reason]}</h2> : <p role="status">No report selected. Choose a file to inspect its declared results.</p>}
      </div>
      {report ? <ReportReadout report={report} fileName={fileName} /> : <section className="report-empty" aria-label="No report metrics displayed"><span aria-hidden="true">[ — ]</span><h2>{inspection && !inspection.valid ? 'Metrics withheld.' : 'Evidence starts with a file.'}</h2><p>{inspection && !inspection.valid ? 'The previous report has been cleared. Choose a valid report to continue.' : 'No scores, defense curve, or benchmark numbers are inferred here.'}</p></section>}
      <aside className="report-method-note"><p className="eyebrow">WHAT THIS CHECK MEANS</p><p>The hash binds the selected JSON to its own reportHash. It does not authenticate the provider or recompute metrics from attempt entries. A report can be deliberately changed and rehashed. Use the full saved-run verifier with its original plan and entries for deeper local checks.</p></aside>
    </main>
    <footer className="site-footer page-width"><a className="footer-brand" href="/">HEIST<span>_</span></a><p>READ THE COVERAGE. KEEP THE ERRORS.</p><a href="/#arena" className="back-top">BACK TO ARENA ↗</a></footer>
  </div>;
}

function ReportReadout({ report, fileName }: { report: InspectedReport; fileName: string }) {
  const availability = report.counts.started ? report.counts.completed / report.counts.started : null;
  const summary = [
    ['Planned', number(report.counts.planned), 'Attempts in the declared cohort'],
    ['Started', number(report.counts.started), 'Retained attempt records'],
    ['Completed', number(report.counts.completed), 'Non-error attempts, including task failures'],
    ['Errors', number(report.counts.errors), 'Operational failures remain in denominators'],
    ['Skipped', number(report.counts.skipped), 'Planned attempts not started'],
    ['Availability', percent(availability), 'Completed / started; not task utility'],
  ];
  return <section className="report-readout" aria-labelledby="report-readout-title">
    <div className="report-readout-heading"><div><p className="eyebrow">02 / DECLARED RUN COVERAGE</p><h2 id="report-readout-title">{report.planId}</h2><p className="report-file-name">{fileName}</p></div><span className={'report-source-badge ' + (report.source === 'scripted_fixture' ? 'is-scripted' : 'is-attested')}>{report.source === 'scripted_fixture' ? 'SCRIPTED FIXTURE' : 'LIVE INFERENCE · CALLER ATTESTATION'}</span></div>
    <p className="report-integrity-limit">Local content integrity only. Attempt entries, metric calculations, provider provenance and billing have not been checked.</p>
    <dl className="report-counts">{summary.map(([title, value, detail]) => <div key={title} className={title === 'Errors' && report.counts.errors > 0 ? 'has-errors' : ''}><dt>{title}</dt><dd>{value}</dd><p>{detail}</p></div>)}</dl>
    <div className="report-run-state"><span>{report.status === 'completed' ? 'DECLARED RUN COMPLETE' : 'DECLARED RUN STOPPED'}</span><p>{report.stopReason ? 'Stop reason: ' + readable(report.stopReason) : 'No stop reason declared.'}</p><span>SYNTHETIC EXECUTION ONLY</span></div>
    {report.counts.errors > 0 && <p className="report-warning" role="note">Operational errors are present. A zero observed attack-success rate is not evidence of successful protection. Read availability and error coverage alongside every rate.</p>}
    <div className="report-groups-heading"><p className="eyebrow">03 / DESCRIPTIVE GROUPS</p><p>Separate unsafe model decisions from executed effects. These are supplied report summaries, not independently verified measurements.</p></div>
    {report.metrics.groups.length ? <div className="report-groups">{report.metrics.groups.map((group, index) => <GroupReadout key={group.groupId} group={group} index={index} />)}</div> : <p className="report-no-groups">No scored attempt groups are present. No rates or latency values are inferred.</p>}
    <details className="report-fingerprints"><summary>Report fingerprints</summary><dl><div><dt>Report hash</dt><dd><code>{report.reportHash}</code></dd></div><div><dt>Plan hash</dt><dd><code>{report.planHash}</code></dd></div><div><dt>Corpus hash</dt><dd><code>{report.corpusHash}</code></dd></div></dl></details>
  </section>;
}
function GroupReadout({ group, index }: { group: InspectedReport['metrics']['groups'][number]; index: number }) {
  const controls = group.metadata.controls;
  const features = [controls.raw ? 'raw' : 'SERV default', controls.guard ? 'guard' : null, controls.kronos ? 'Kronos' : null,
    controls.multipath ? 'Multipath' : null, controls.shadow !== false && controls.shadow !== 'absent' ? 'Shadow' : null].filter(Boolean);
  const metrics = [
    ['Model ASR', group.primary.modelAsr, 'Unsafe model decisions / attack attempts'],
    ['Execution ASR', group.primary.executionAsr, 'Executed breaches / attack attempts'],
    ['BU', group.primary.bu, 'Benign utility: task successes / benign attempts'],
    ['UA', group.primary.ua, 'Utility under attack: task successes / attack attempts'],
  ] as const;
  return <article className="report-group panel">
    <header className="report-group-title"><div><span className="micro-label">GROUP {String(index + 1).padStart(2, '0')} / DESCRIPTIVE ONLY</span><h3>{group.metadata.invariants.baseModelId ?? 'Model not declared'}</h3><p>Declared features: {features.join(' + ')} · executor {controls.enforcement}</p></div><span className="report-group-coverage">{number(group.counts.attempts)} attempts<br /><strong>{number(group.counts.errors)} errors</strong></span></header>
    <div className="report-rates">{metrics.map(([title, rate, detail]) => <div key={title}><h4>{title}</h4><strong>{percent(rate.rate)}</strong><span>{number(rate.successes)} / {number(rate.total)}</span><p>{detail}</p></div>)}</div>
    {group.primary.asr.rate === 0 && group.counts.errors > 0 && <p className="report-warning">Zero observed breaches with {number(group.counts.errors)} operational errors. This does not establish that the defense succeeded.</p>}
    <dl className="report-group-details"><div><dt>Availability</dt><dd>{percent(group.primary.availability.rate)}</dd><p>{number(group.counts.completed)} non-error / {number(group.counts.attempts)} attempts</p></div><div><dt>All-attempt latency</dt><dd><small>p50</small> {milliseconds(group.latencyMs.all.p50)}<br /><small>p95</small> {milliseconds(group.latencyMs.all.p95)}</dd><p>Harness wall time, including errors</p></div><div><dt>Known token-price subtotal</dt><dd>{money(group.cost.knownSubtotalUsd)}</dd><p>{number(group.cost.knownRecords)} known / {number(group.counts.attempts)} records. {group.cost.complete ? 'Complete token-estimate coverage.' : 'Partial estimate coverage.'} Not billed cost.</p></div><div><dt>Full-cohort token estimate</dt><dd>{money(group.cost.totalEstimateUsd)}</dd><p>Unavailable when cost coverage is incomplete. Actual billing is unverified.</p></div><div className="report-synthetic-loss"><dt>Synthetic loss</dt><dd><code>{group.effects.valueLostUnits}</code><small> whole units</small></dd><p>Simulated ledger effects. No real-money loss is claimed.</p></div></dl>
  </article>;
}
