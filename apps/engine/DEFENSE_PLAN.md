# Controlled defense plan composition

`createDefensePlan(input)` is pure planning. It accepts a frozen owned payment corpus, explicit source/base model, every common harness limit, finite benchmark budgets, trials, schedule seed, snapshot metadata (explicit null is allowed), and one fixed public Shadow hint/iteration configuration. Unknown input fields are rejected. No client, key, environment, filesystem, execution or network capability is accepted.

The main comparison chain is:

1. Raw base model in observe mode.
2. SERV default.
3. Add Prompt Guard.
4. Add Kronos.
5. Add Multipath.
6. Add the fixed Shadow configuration.
7. Enforce the existing synthetic executor policy.

Adjacent steps change one existing metric control: raw, guard, Kronos, Multipath, the hash of the complete Shadow configuration, then enforcement. The base model, frozen corpus, trusted prompt, immutable payment policy, business tool schema and harness limits stay fixed. The last step adds no wallet/session cap or real-money mechanism.

Chain order describes adjacent comparisons. The existing benchmark plan still randomizes arm execution order within each case/trial block. Its declarations are not evidence that provider features worked or improved security. Fixture source is locked to `fixture-model`.

Budgets are required and never raised automatically. They must reserve at least one full seven-arm block. A capped pilot may cover fewer than all case/trial blocks. `previewDefensePlan(input)` accepts the same strict creation input, reconstructs the composition, and delegates to the existing bounded preview. It reports coverage from attempt/model-call/output reservations only. Request bytes, wall time and evidence admission can stop work sooner; completion and USD billing are not guaranteed.

An optional `frontierReference` requires live source, a different explicit base model, separate finite budgets and separate snapshot metadata. It produces its own raw-model plan, labelled `cross_model_reference_only`, with unverified availability and unmeasured effectiveness. It is excluded from the same-model comparison chain. Syntactic plan acceptance establishes no hosted-model availability.

The composition hash binds the plans, comparisons, invariant fingerprints and limitations. Preview never accepts a returned composition as trusted input; it reconstructs from the caller's original strict creation fields. Snapshot/source metadata remain caller attestations, and independence, causal effects and attack effectiveness remain unestablished.

The planner performs zero requests. Live execution still requires separate authorization at the existing benchmark boundary.

Caller-supplied IDs, model names, Shadow hints and snapshot labels share an accidental-secret guard for known sk/sk-proj credential shapes and0x-prefixed40-or64-hex address/private-key shapes. Ordinary unprefixed hashes remain valid. This pattern guard does not prove that arbitrary text is public; exact actual-value checks remain the execution boundary's responsibility.
