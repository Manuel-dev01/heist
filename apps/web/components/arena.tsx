'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AttemptResult } from '@heist/harness';
import { PracticeResponseSchema, VerifyResponseSchema } from './contracts';
import type { Enforcement, Scenario, SessionRun } from './contracts';

type IconName = 'arrow' | 'target' | 'lock' | 'download' | 'check' | 'close' | 'chevron';
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg className={`icon ${className}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const scenarios: { id: Scenario; title: string; subtitle: string; code: string }[] = [
  { id: 'benign', title: 'Authorized payment', subtitle: 'A legitimate task within policy.', code: '01' },
  { id: 'attacker_release', title: 'Recipient swap', subtitle: 'A scripted call to an attacker destination.', code: '02' },
  { id: 'over_limit', title: 'Amount escalation', subtitle: 'A scripted call beyond the transfer limit.', code: '03' },
  { id: 'policy_mutation', title: 'Policy rewrite', subtitle: 'A scripted attempt to change owner policy.', code: '04' },
];
const scenarioName = (id: Scenario) => scenarios.find((scenario) => scenario.id === id)?.title ?? id;
const units = (value: string) => BigInt(value).toLocaleString('en-US');
const label = (value: string) => value.replaceAll('_', ' ');
const shortHash = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;

export function Arena() {
  const [scenario, setScenario] = useState<Scenario>('attacker_release');
  const [enforcement, setEnforcement] = useState<Enforcement>('enforce');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<SessionRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Ready. All actions stay inside the synthetic fixture.');
  const controllers = useRef(new Set<AbortController>());
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { for (const controller of controllers.current) controller.abort(); }, []);

  const active = history.find((entry) => entry.record.id === selectedId) ?? history[0];
  const record = active?.record;
  const totalUnsafe = history.reduce((sum, entry) => sum + entry.record.oracle.attemptedUnsafeCalls, 0);
  const totalLoss = history.reduce((sum, entry) => sum + BigInt(entry.record.oracle.valueLostUnits), 0n);

  async function postLocal(path: '/api/practice' | '/api/verify', body: unknown): Promise<unknown> {
    const controller = new AbortController();
    controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('local_request_failed');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('unexpected_response_size');
      return JSON.parse(text) as unknown;
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }

  async function runPractice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running || note.length > 4000) return;
    setRunning(true); setError(''); setStatus('Running the selected scripted fixture.');
    try {
      const payload = PracticeResponseSchema.parse(await postLocal('/api/practice', { scenario, enforcement, note }));
      const entry: SessionRun = { ...payload, scenario, enforcement };
      setHistory((previous) => [entry, ...previous]); setSelectedId(payload.record.id);
      setStatus(`Fixture complete. Outcome: ${label(payload.record.outcome)}. Inspect each oracle signal separately.`);
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: true }));
    } catch {
      setError('The local fixture could not return a valid record. Check that the local server is running, then try again.');
      setStatus('Fixture request failed. No result has been added to the session.');
    } finally { setRunning(false); }
  }

  async function verifyRecord() {
    if (!record || verifying) return;
    const current = record;
    setVerifying(true); setError(''); setStatus('Checking this record against its content hash.');
    try {
      const result = VerifyResponseSchema.parse(await postLocal('/api/verify', { record: current }));
      setVerification((previous) => ({ ...previous, [current.id]: result.valid }));
      setStatus(result.valid ? 'Record content hash verified. This confirms record integrity, not model provenance or defense efficacy.' : 'Record verification failed. The stored content does not match its hash.');
    } catch {
      setError('The local verifier did not return a valid response. The record is still available to download.');
      setStatus('Record verification could not be completed.');
    } finally { setVerifying(false); }
  }

  function downloadRecord() {
    if (!record) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `heist-attempt-${record.id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Attempt record downloaded as JSON.');
  }

  return (
    <>
      <a className="skip-link" href="#arena">Skip to the arena</a>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="HEIST home"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>HEIST<span className="brand-dot" aria-hidden="true">_</span></a>
        <nav aria-label="Main navigation"><a href="#arena">Arena</a><a href="#evidence">Evidence</a><a className="reports-nav-link" href="/reports">Reports</a><a href="#methodology">Methodology</a></nav>
        <span className="local-badge"><span className="signal-dot" />LOCAL TEST RANGE</span>
      </header>

      <main id="top">
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="tiny-cross">+</span> AGENT SECURITY / ISOLATED PRACTICE</p>
            <h1 id="hero-title">TRUST HAS<br />A <span>BOUNDARY.</span><span className="hero-period">_</span></h1>
            <p className="hero-description">Put an agent decision under pressure.<br />See what it attempts. See what actually happens.</p>
            <a className="text-link" href="#arena">Enter the test range <Icon name="arrow" /></a>
            <div className="hero-footnote"><Icon name="lock" /><span>Scripted fixtures. Synthetic units. No real funds.</span></div>
          </div>
          <div className="boundary-art" aria-hidden="true">
            <div className="art-grid" /><span className="art-coordinate coord-one">LOCAL / 00:01</span><span className="art-coordinate coord-two">ISOLATION BOUNDARY</span>
            <div className="boundary-ring ring-one" /><div className="boundary-ring ring-two" />
            <div className="art-cross cross-one">+</div><div className="art-cross cross-two">+</div><div className="art-cross cross-three">+</div>
            <div className="vault"><div className="vault-face"><span className="vault-id">H / 01</span><div className="vault-lock"><span /><span /></div><span className="vault-label">OWNER POLICY</span></div><div className="vault-side" /></div>
            <span className="art-path path-one" /><span className="art-path path-two" /><span className="art-node node-one" /><span className="art-node node-two" />
            <div className="art-tag tag-input"><span>UNTRUSTED INPUT</span><Icon name="arrow" /></div><div className="art-tag tag-output"><span className="signal-dot" />OBSERVABLE OUTCOME</div>
            <div className="art-bottom">DECISION ≠ EXECUTION<span>HEIST // FIXTURE</span></div>
          </div>
        </section>

        <div className="range-strip"><div className="page-width"><span><span className="signal-dot" />PRACTICE ENVIRONMENT</span><p>No wallet connection. No API keys. No provider inference.</p><span className="strip-end">EVERY ACTION IS SIMULATED <span aria-hidden="true">↗</span></span></div></div>

        <section className="arena-section page-width" id="arena" aria-labelledby="arena-title">
          <div className="section-heading"><div><p className="eyebrow">01 / THE ARENA</p><h2 id="arena-title">Run the scenario.<br /><span>Read the consequence.</span></h2></div><p className="section-intro">A free, isolated fixture lab. Choose a scripted behavior, then inspect how the synthetic executor handles it.</p></div>
          <div className="arena-grid">
            <form className="setup-panel panel" onSubmit={runPractice}>
              <div className="panel-topline"><span className="eyebrow">CONFIGURE RUN</span><span className="micro-label">FIXTURE ONLY</span></div>
              <fieldset className="scenario-fieldset"><legend><span className="step-number">01</span> Scripted agent behavior</legend><p className="field-help">The chosen script determines the response. No model interprets your input.</p>
                <div className="scenario-grid">{scenarios.map((item) => <label className={`scenario-option ${scenario === item.id ? 'is-selected' : ''}`} key={item.id}><input type="radio" name="scenario" value={item.id} checked={scenario === item.id} onChange={() => setScenario(item.id)} disabled={running} /><span className="scenario-code">{item.code}<span className="radio-indicator" /></span><strong>{item.title}</strong><span>{item.subtitle}</span></label>)}</div>
              </fieldset>
              <fieldset className="mode-fieldset" aria-describedby="mode-description"><legend><span className="step-number">02</span> Executor mode</legend><div className="mode-switch"><label className={enforcement === 'enforce' ? 'is-selected' : ''}><input type="radio" name="enforcement" value="enforce" checked={enforcement === 'enforce'} onChange={() => setEnforcement('enforce')} disabled={running} /><Icon name="lock" />Enforce policy</label><label className={enforcement === 'observe' ? 'is-selected' : ''}><input type="radio" name="enforcement" value="observe" checked={enforcement === 'observe'} onChange={() => setEnforcement('observe')} disabled={running} /><Icon name="target" />Observe effects</label></div><p className="field-help mode-help" id="mode-description">{enforcement === 'enforce' ? 'Unsafe calls are rejected by the synthetic executor. A bad decision can still be recorded.' : 'Unsafe calls may affect the isolated synthetic ledger. All units remain simulated.'}</p></fieldset>
              <div className="input-field"><label htmlFor="practice-note"><span className="step-number">03</span> Recorded test note <span className="optional">OPTIONAL</span></label><textarea id="practice-note" aria-describedby="note-help note-count" placeholder="Add a message, invoice instruction, or policy-override attempt…" maxLength={4000} value={note} onChange={(event) => setNote(event.target.value.slice(0, 4000))} disabled={running} rows={5} /><div className="input-meta"><p id="note-help">Recorded as untrusted context. The scripted scenario does not interpret this text.</p><span id="note-count">{note.length.toLocaleString('en-US')} / 4,000</span></div></div>
              <button className="button button-primary run-button" type="submit" disabled={running}>{running ? <><span className="loading-square" />Running fixture…</> : <>Run isolated fixture <Icon name="arrow" /></>}</button><p className="run-caption">LOCAL EXECUTION <span>·</span> ZERO PROVIDER CALLS <span>·</span> SYNTHETIC UNITS</p>
            </form>

            <section className={`result-panel panel ${record ? 'has-result' : ''}`} aria-labelledby="result-title">
              <div className="panel-topline"><span className="eyebrow">ORACLE READOUT</span><span className="micro-label">{record ? `RUN ${String(history.findIndex((entry) => entry.record.id === record.id) === -1 ? history.length : history.length - history.findIndex((entry) => entry.record.id === record.id)).padStart(2, '0')}` : 'AWAITING INPUT'}</span></div>
              <div className="result-heading"><h3 id="result-title" ref={resultHeading} tabIndex={-1}>{record ? 'The record is in.' : 'Every action leaves a trace.'}</h3>{record ? <span className={`outcome-badge outcome-${record.outcome}`}>{label(record.outcome)}</span> : <span className="empty-status">READY TO OBSERVE</span>}</div>
              <p className="result-subtitle">{active ? `${scenarioName(active.scenario)} · ${active.enforcement === 'enforce' ? 'Policy enforced' : 'Effects observed'} · Scripted response` : 'Run a fixture to separate an unsafe decision from its execution.'}</p>
              <div className="oracle-grid">
                <OracleCard number="01" name="Scripted agent decision" value={record ? (record.oracle.modelBreached ? 'Boundary crossed' : 'Within boundary') : '—'} detail="Did the scripted agent make a breaching decision?" tone={record ? (record.oracle.modelBreached ? 'danger' : 'good') : 'neutral'} />
                <OracleCard number="02" name="Execution effect" value={record ? (record.oracle.executionBreached ? 'Breach executed' : 'No execution breach') : '—'} detail="Did the simulated ledger or owner policy change unsafely?" tone={record ? (record.oracle.executionBreached ? 'danger' : 'good') : 'neutral'} />
                <OracleCard number="03" name="Task utility" value={record ? (record.oracle.utilitySuccess ? 'Task completed' : 'Task incomplete') : '—'} detail="Was the authorized task completed independently of security?" tone={record ? (record.oracle.utilitySuccess ? 'good' : 'neutral') : 'neutral'} />
                <OracleCard number="04" name="Synthetic value lost" value={record ? units(record.oracle.valueLostUnits) : '—'} suffix={record ? ' units' : undefined} detail="Settled loss in this isolated ledger. No real currency." tone={record && record.oracle.valueLostUnits !== '0' ? 'danger' : 'neutral'} />
              </div>
              {record ? <div className="result-summary"><div><span className="micro-label">UNSAFE CALLS</span><strong>{record.oracle.attemptedUnsafeCalls}<span> attempted / </span>{record.oracle.rejectedUnsafeCalls}<span> rejected</span></strong></div><div><span className="micro-label">FIXTURE ROUNDS</span><strong>{record.rounds}</strong></div><div><span className="micro-label">SECURE TASK SUCCESS</span><strong>{record.oracle.secureTaskSuccess ? 'Yes' : 'No'}</strong></div></div> : <div className="result-empty"><Icon name="target" /><p>A decision is one signal.<br />Its consequence is another.</p><span>FOUR INDEPENDENT READOUTS. ONE INSPECTABLE RECORD.</span></div>}
              <div className="result-bottom"><span className="signal-dot" /><p>Fixture results describe this script and executor only.<br />They do not measure model robustness or defense efficacy.</p></div>
            </section>
          </div>
          <div className="status-area"><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</p>{error && <p className="error-notice" role="alert"><Icon name="close" />{error}</p>}</div>
        </section>

        <section className="evidence-section page-width" id="evidence" aria-labelledby="evidence-title">
          <div className="section-heading compact"><div><p className="eyebrow">02 / THE EVIDENCE</p><h2 id="evidence-title">Inspect. Verify. Keep.</h2></div><span className="section-note">THIS BROWSER SESSION ONLY</span></div>
          <div className="session-metrics"><SessionMetric label="Fixture attempts" value={String(history.length).padStart(2, '0')} detail="Completed records in this session" /><SessionMetric label="Unsafe calls attempted" value={String(totalUnsafe).padStart(2, '0')} detail="From actual fixture oracle results" /><SessionMetric label="Synthetic units lost" value={totalLoss.toLocaleString('en-US')} detail="Sum of settled fixture losses" /><SessionMetric label="Provider calls" value="0" detail="Practice uses scripted responses" /></div>
          <div className="evidence-grid">
            <section className="record-panel panel" aria-labelledby="record-title"><div className="panel-topline"><h3 id="record-title">Attempt record</h3>{record && <span className={`integrity-badge ${verification[record.id] === true ? 'is-verified' : verification[record.id] === false ? 'is-invalid' : ''}`}>{verification[record.id] === true ? <><Icon name="check" />HASH VERIFIED</> : verification[record.id] === false ? <><Icon name="close" />HASH MISMATCH</> : 'NOT YET VERIFIED'}</span>}</div>
              {record ? <><div className="record-meta"><div><span className="micro-label">ATTEMPT ID</span><code>{record.id}</code></div><div><span className="micro-label">CONTENT HASH</span><code title={record.attemptHash}>{shortHash(record.attemptHash)}</code></div></div><div className="record-actions"><button className="button button-secondary" onClick={verifyRecord} disabled={verifying}><Icon name="check" />{verifying ? 'Verifying…' : 'Verify content hash'}</button><button className="button button-quiet" onClick={downloadRecord}><Icon name="download" />Download JSON</button></div><p className="verification-note">Verification checks record integrity. It does not attest to provider provenance or defense performance. Billing is unverified.</p><ToolLog record={record} /><Transcript record={record} /><details className="record-details"><summary>Full record <span>JSON</span><Icon name="chevron" /></summary><pre>{JSON.stringify(record, null, 2)}</pre></details></> : <div className="evidence-empty"><span className="empty-file" aria-hidden="true"><span /><span /><span /></span><h4>Nothing behind the numbers.</h4><p>Your first run creates a full attempt record with an oracle result, tool log, transcript, and content hash.</p><a className="text-link" href="#arena">Create a record <Icon name="arrow" /></a></div>}
            </section>
            <aside className="history-panel panel" aria-labelledby="history-title"><div className="panel-topline"><h3 id="history-title">Session history</h3><span className="micro-label">{history.length} RECORDS</span></div>{history.length ? <><ol className="history-list">{history.map((entry, index) => <li key={entry.record.id}><button className={record?.id === entry.record.id ? 'is-active' : ''} onClick={() => { setSelectedId(entry.record.id); setStatus(`Inspecting ${scenarioName(entry.scenario)} record.`); }} aria-pressed={record?.id === entry.record.id}><span className="history-index">{String(history.length - index).padStart(2, '0')}</span><span className="history-copy"><strong>{scenarioName(entry.scenario)}</strong><span>{entry.enforcement === 'enforce' ? 'Enforced' : 'Observed'} · {label(entry.record.outcome)}</span></span><Icon name="chevron" /></button></li>)}</ol>{history.length > 6 && <p className="history-footnote">All {history.length} session records are available above.</p>}</> : <div className="history-empty"><span aria-hidden="true">[ — ]</span><p>No fixture attempts yet.</p><small>Run records will appear here.</small></div>}<div className="session-warning"><span aria-hidden="true">↳</span><p>History lives in memory.<br />Download records to keep them after a refresh.</p></div></aside>
          </div>
        </section>

        <section className="curve-section page-width" aria-labelledby="curve-title"><div className="curve-copy"><p className="eyebrow">CONTROLLED EVALUATION</p><h2 id="curve-title">Defense curve</h2><p>A curve needs comparable evidence. Fixture practice is excluded from model and defense comparisons.</p><span className="curve-state"><span className="signal-dot" />AWAITING ELIGIBLE RUNS</span></div><div className="curve-empty"><span className="chart-axis axis-y" /><span className="chart-axis axis-x" /><Icon name="target" /><h3>No eligible controlled run yet</h3><p>No curve, success rate, or defense score is inferred from these fixtures.</p><span className="micro-label">NO LIVE EVALUATION DATA DISPLAYED</span></div></section>

        <section className="method-section page-width" id="methodology" aria-labelledby="method-title"><div className="section-heading compact"><div><p className="eyebrow">03 / THE METHOD</p><h2 id="method-title">Make the distinction.</h2></div><p className="section-intro">The point of a test range is knowing exactly what the evidence says.</p></div><div className="method-grid"><article><span className="method-index">01 /</span><h3>Practice is scripted.</h3><p>A selected fixture produces a predetermined agent response. Your note is recorded as untrusted context. This is an executor demonstration, with no model inference.</p></article><article><span className="method-index">02 /</span><h3>Decision ≠ execution.</h3><p>An agent can attempt an unsafe action that an executor rejects. We show that decision, its execution effect, task utility, and synthetic loss separately.</p></article><article><span className="method-index">03 /</span><h3>Claims need controls.</h3><p>Model and defense comparisons require eligible controlled runs. Content hashes help check record integrity; they do not establish efficacy, provenance, or verified billing.</p></article></div></section>
      </main>
      <footer className="site-footer page-width"><a className="footer-brand" href="#top">HEIST<span>_</span></a><p>TEST THE BOUNDARY. READ THE EVIDENCE.</p><span>LOCAL / SYNTHETIC / INSPECTABLE</span><a href="#top" className="back-top">BACK TO TOP ↗</a></footer>
    </>
  );
}

function OracleCard({ number, name, value, suffix, detail, tone }: { number: string; name: string; value: string; suffix?: string | undefined; detail: string; tone: 'neutral' | 'good' | 'danger' }) {
  return <div className={`oracle-card tone-${tone}`}><div className="oracle-label"><span>{number}</span><h4>{name}</h4></div><strong>{value}{suffix && <small>{suffix}</small>}</strong><p>{detail}</p></div>;
}
function SessionMetric({ label: name, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="session-metric"><span className="micro-label">{name}</span><strong>{value}</strong><p>{detail}</p></div>;
}
function ToolLog({ record }: { record: AttemptResult }) {
  return <details className="record-details" open><summary>Tool log <span>{record.toolEvents.length} EVENTS</span><Icon name="chevron" /></summary>{record.toolEvents.length ? <ol className="tool-log">{record.toolEvents.map((event, index) => <li key={`${event.callId}-${index}`}><div className="tool-event-top"><span className="event-round">R{event.round}</span><code>{event.toolName}</code><span className={`tool-status status-${event.status}`}>{event.status}</span></div><p className={event.unsafeAttempt ? 'violation-text' : 'event-note'}>{event.violations.length ? event.violations.map(label).join(' · ') : 'No policy violation recorded'}</p><details className="event-payload"><summary>Arguments & result</summary><pre>{JSON.stringify({ arguments: event.arguments, result: event.result }, null, 2)}</pre></details></li>)}</ol> : <p className="details-empty">This record contains no tool calls.</p>}</details>;
}
function Transcript({ record }: { record: AttemptResult }) {
  return <details className="record-details"><summary>Transcript <span>{record.transcript.length} MESSAGES</span><Icon name="chevron" /></summary><ol className="transcript-list">{record.transcript.map((message, index) => <li key={index}><div><span>{String(index + 1).padStart(2, '0')}</span><strong>{message.role}</strong></div><pre>{message.content ?? '(No text content)'}</pre>{message.role === 'assistant' && message.toolCalls?.length ? <pre className="transcript-tool-calls">{JSON.stringify(message.toolCalls, null, 2)}</pre> : null}</li>)}</ol></details>;
}