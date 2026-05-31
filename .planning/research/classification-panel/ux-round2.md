# UX & latency review: Round 2 — four-tier prove-down `holmes_classify`

## Verdict

The four-tier model is the right safety shape, but it changes the UX problem. Round 1 treated the classifier itself as cheap and the main cost as one visible tool-call boundary. With prove-down and Tier 4, the expensive surface is no longer `holmes_classify.execute`; it is the model work required to earn a lower tier or to complete repeated HOLMES passes before mutation.

Prove-down addresses the main safety gap: a task is no longer treated as easy just because no escalation keyword was detected. That is the correct default for Tom's requirement of no leaks. The UX cost is predictable: more tasks will begin at Tier 3/4 until the agent has gathered enough read-only evidence to prove bounded scope. If the product renders that as opaque delay or repetitive ritual, users will experience HOLMES as "everything is Tier 3." If it renders proof-down as a compact checkpoint with visible progress and concrete next actions, the friction is acceptable for high-reliability work.

The design needs three changes to support this cleanly:

1. Add Tier 4 as a first-class tier in schema, state, requirements, rendering, and gate logic.
2. Replace trigger-up classification with a proof-down ledger: why Tier 4 was ruled out, why Tier 3 was ruled out, why Tier 2 was ruled out, or exactly where proof failed.
3. Add UX policy for long Tier 4 runs: progress summaries, interrupt/narrow options, and non-interactive print-mode behavior.

Pure deterministic code can enforce conservative floors and validate obvious proof objects. Usable prove-down requires model intelligence to supply the positive proof and resolve semantic unknowns; deterministic code should verify scope, artifacts, and safety invariants, not pretend it can prove semantic completeness from strings alone.

---

## 1. Friction analysis per tier

### Tier 1 — zero ceremony, collapsed one-liner

Tier 1 should remain exactly what Round 1 required: visually near-invisible.

Expected cases:

- typo in prose;
- comment-only correction;
- whitespace/formatting-only edit;
- non-code metadata text where behavior cannot change;
- one exact mechanical mutation over one concrete path.

Default rendering should be one line:

```text
HOLMES Tier 1 · exact edit allowed: README.md
```

or, when path detail would be noise:

```text
HOLMES checked · Tier 1
```

Do not show the prove-down ladder by default for Tier 1. The point of Tier 1 is that the system has positive proof of non-semantic scope; showing every step used to reach that conclusion reintroduces the ceremony Tier 1 exists to avoid.

The important change from Round 1 is that Tier 1 now needs positive proof, not merely absence of risk. That proof can still be fast when the request itself is concrete: `fix typo in README.md` plus planned `edit` on `README.md` is enough. But `fix typo` with no path and no observed file context is not enough. In that case, the agent should use read-only discovery before classification rather than classify prematurely and get stuck at a higher tier.

UX requirement: the prompt should teach the model that read-only preflight is allowed and expected when it needs evidence to prove down. The bad flow is:

```text
User: fix typo
HOLMES Tier 3 · no concrete mutation scope
```

The good flow is:

```text
find/read relevant file → HOLMES Tier 1 · exact edit allowed → edit
```

No mutation happens before classification, but read-only evidence gathering prevents unnecessary escalation.

### Tier 2 — short TARGET/DELTA checkpoint

Tier 2 remains acceptable friction. It is the right tier for bounded, single-scope work where the task is not provably non-semantic but does not require a full HOLMES pass.

Expected cases:

- one function behavior change;
- one file or one tightly bounded module;
- small test update with explicit scope;
- narrow config or guard behavior change;
- mechanical code edit that can affect behavior but has no broad unknowns.

Default rendering should be compact but visible:

```text
HOLMES Tier 2 · bounded behavior change in src/guards.ts · TARGET/DELTA required
```

The visible model output should be a short block, not a full essay:

```text
TARGET: Change guard behavior for X within src/guards.ts.
DELTA: Replace current Y branch with Z while preserving A/B invariants.
```

`TARGET/NOW/DELTA/NEXT` is better when factual grounding matters, but Tier 2 should not become hidden Tier 3. The UX budget for Tier 2 is a short reasoning checkpoint: enough for the maintainer to understand intent and scope, not a full HOLMES transcript.

Prove-down affects Tier 2 in two ways:

1. Tier 2 must be earned by proving the task does not need a full HOLMES pass.
2. Tier 2 must not be allowed to become a vague middle bucket for unknown work.

That means the classifier needs explicit positive proof conditions for "not Tier 3": concrete scope, single module/system, no unresolved blocking unknowns, no safety-critical surface, no need for research/delegation, and an inspectable mutation plan. If those are not present, Tier 3 is the right result.

### Tier 3 — single visible HOLMES pass

Tier 3 is new as a distinct UX tier. It is no longer the highest bucket; it is the bounded high-effort tier: one full HOLMES pass, then execute if the pass resolves the relevant unknowns.

Expected cases:

- multi-file but bounded refactor;
- unfamiliar code path requiring read/search before edit;
- moderate risk behavior change with clear scope;
- tasks with uncertainty that can plausibly be resolved in one structured pass;
- broad enough to need Hone/Observe/Ladder/Map/Establish/Synthesize, but not architectural or open-ended.

Default classification rendering:

```text
HOLMES Tier 3 · one full HOLMES pass required · scope: auth middleware + tests
```

The HOLMES pass should render as structured progress, not raw stream-of-consciousness. Recommended visible shape:

```text
HOLMES pass 1
Hone: bounded target and non-goals.
Observe: sourced facts from read/search/tool evidence.
Ladder: necessary conditions before mutation.
Map: blocking unknowns and how they were resolved.
Establish: evidence gathered; remaining unknowns non-blocking.
Synthesize: approved edit plan and verification criteria.
```

This will feel slower than Tier 2 because it includes both model output and often read-only investigation. That is acceptable if the user can see useful progress: which facts were observed, which unknowns were resolved, and what exact edit scope emerged. It is not acceptable if the user sees a large undifferentiated wall of HOLMES text before anything happens.

Rendering guidance:

- Collapse completed phases by default after the pass finishes.
- Keep the current phase expanded while work is ongoing.
- Show sourced facts and remaining blockers, not private chain-of-thought.
- End the pass with the exact planned mutation scope and verification plan.
- If the pass discovers broader scope, reclassify; do not silently continue under the old Tier 3 record.

Tier 3 should usually be one loop through HOLMES. If the pass ends with unresolved blocking unknowns, the task should escalate to Tier 4 or pause for narrowing; otherwise Tier 3 becomes a loophole for incomplete reasoning.

### Tier 4 — repeated HOLMES passes until synthesis is complete

Tier 4 is the largest UX change. It is the correct safety tier for multi-scope, architectural, safety-critical, or deeply uncertain work, but it can create a long pre-mutation interval.

Expected cases:

- auth/security/crypto/data migration/deployment/safety surfaces;
- architecture changes spanning subsystems;
- requests with unclear success criteria;
- work requiring delegation or research before the edit plan is knowable;
- repeated discovery where one HOLMES pass changes the target or reveals new blockers.

Default classification rendering:

```text
HOLMES Tier 4 · iterative HOLMES required · unresolved blockers: scope, safety impact, migration path
```

Tier 4 must not render as silence followed by a huge answer. The user needs a progress contract. Recommended pass-level output:

```text
HOLMES Tier 4 progress
Pass 1: mapped affected surfaces; found blocking unknowns A, B.
Pass 2: resolved A via read/search; B requires narrowing or further evidence.
Current state: no mutation yet; next action is read-only verification of B.
```

For Tier 4, the UX principle is: no artificial limit on reasoning, but no invisible looping. Each pass should reduce uncertainty or explicitly report that it did not. If a pass does not change the state, the model should not keep looping silently; it should narrow the target, gather different evidence, delegate, or ask for continuation/narrowing in interactive mode.

---

## 2. Over-escalation risk

### Will legitimate simple work get stuck at Tier 2/3?

Yes, if the implementation treats prove-down as a single deterministic string scan at the moment of first classification.

Examples:

- `fix typo` with no path: no concrete scope, so Tier 1 cannot be proven.
- `clean up this file` after a file was mentioned several turns ago: current request may not contain enough proof.
- `make the obvious rename` in unfamiliar code: absence of risk words does not prove non-semantic behavior.
- `update config` without knowing whether the config controls deployment/security/data handling: not provably safe.

This is not a flaw in prove-down. It is the intended safety behavior. The UX failure would be making the user pay Tier 3/4 ceremony when a small read-only observation could have proven a lower tier.

Required design change: add a prompt and classifier expectation that the model may perform minimal read-only preflight before `holmes_classify` when the request lacks enough evidence to prove down. Read-only tools are already allowed by the gate design. Use that path aggressively for UX.

Recommended prompt addition:

```text
If the request is plausibly simple but lacks concrete proof of scope or non-semantic impact, gather the minimal read-only evidence needed to prove down before calling holmes_classify. Do not mutate before classification.
```

### What happens when the classifier cannot prove down?

It must retain the higher tier and explain the missing proof, not just emit a generic escalation.

Bad rendering:

```text
HOLMES Tier 3.
```

Good rendering:

```text
HOLMES Tier 3 · could not prove Tier 2 because the affected files and behavior surface are not yet bounded. Read/search evidence required before mutation.
```

For Tier 4:

```text
HOLMES Tier 4 · could not prove single-pass scope: auth, session storage, and migration behavior may all be affected.
```

The key UX distinction is between risk and missing proof. Users will accept escalation more readily when the system says exactly what proof is absent and how the agent will obtain it.

### Will users experience "everything is Tier 3" frustration?

They will if either of these is true:

1. The classifier has only Tier 1 closed-set proof and otherwise defaults to Tier 3/4.
2. The model calls `holmes_classify` before using available read-only tools to establish scope.

Avoiding that requires positive proof paths for Tier 2 and Tier 3, not only positive proof for Tier 1.

The proof-down ladder should look like this:

- Prove not Tier 4: bounded scope, no architectural/safety-critical/multi-subsystem uncertainty, no unresolved blockers requiring iterative discovery.
- Prove not Tier 3: single scope, no research/delegation need, no broad unknowns, TARGET/DELTA is sufficient before mutation.
- Prove not Tier 2: provably non-semantic exact mutation.

If the implementation only detects Tier 4/Tier 3 risk keywords, it has recreated trigger-up classification under a different name. The burden must be positive evidence at every step.

### Expected tier distribution for typical coding work

No telemetry is present in the reviewed design or Round 1 review, so this is a product expectation, not an observed fact.

[INFERENCE] A healthy distribution for real coding work should likely look roughly like:

| Tier | Expected share | Notes |
| --- | ---: | --- |
| Tier 1 | Low-to-moderate overall; high for explicit typo/comment/doc requests | Only provably non-semantic work. If this is high across code edits, the classifier is probably too permissive. |
| Tier 2 | Large share of bounded maintenance | Single-file/single-module behavior changes should land here after read-only proof. |
| Tier 3 | Large share of unfamiliar or multi-file bounded work | The default for real uncertainty that can be resolved in one pass. |
| Tier 4 | Small but important share | Architecture, safety/security/data/deployment, deep uncertainty, or work that keeps expanding during observation. |

If production telemetry shows Tier 3/4 dominating simple explicit requests, the issue is probably missing proof-down evidence collection or overly weak Tier 2 proof rules. If telemetry shows Tier 1 dominating source-code changes, the issue is probably a safety leak.

---

## 3. Tier 4 UX

### Progress display

Tier 4 needs a first-class progress renderer. A normal tool card is not enough.

Recommended default display:

```text
HOLMES Tier 4 · iterative reasoning before mutation
Current blocker: migration safety and affected auth/session boundaries are not proven.
Pass 1 running: observe current architecture and map affected surfaces.
```

After each pass:

```text
Pass 1 complete · 2 blockers resolved · 1 blocker remains
Resolved: affected files bounded to auth/session packages.
Remaining: migration behavior for existing tokens.
Next: read migration/tests before edit.
```

On completion:

```text
Tier 4 synthesis complete · mutation scope approved
Scope: src/auth/session.ts, src/auth/migrate.ts, tests/auth/session.test.ts
Verification: targeted auth migration tests
```

Do not expose raw hidden reasoning. The user needs operational state: what is blocked, what evidence was gathered, what changed after each pass, what mutation is now approved.

### Interrupt and override

The user should be able to interrupt Tier 4. Interrupt should mean one of:

- stop and report findings so far;
- narrow the request;
- split the task;
- provide missing facts;
- explicitly accept no mutation yet.

The user should not be able to simply override Tier 4 into Tier 1/2 for mutation. That would defeat the purpose of prove-down. If the user narrows the task, that is a new request and should reset classification. If the new narrower request can be proven down, it may receive a lower tier.

Recommended wording:

```text
You can interrupt to narrow scope or stop with findings. HOLMES cannot bypass Tier 4 for the current request without new proof or a narrower target.
```

### Soft continuation checkpoint

Yes, interactive Tier 4 should have a soft continuation checkpoint, but it should be based on lack of convergence, not merely elapsed time.

Trigger a continuation prompt when:

- a HOLMES pass finishes with blocking unknowns still present;
- two consecutive passes do not reduce the blocker list;
- the next step requires broad research/delegation outside the current concrete scope;
- the model cannot name the next evidence-gathering action precisely.

The prompt should offer concrete options:

```text
Tier 4 still has unresolved blockers: A, B.
Options: continue read-only investigation, narrow to X, split Y into a separate task, or stop with findings. No mutation has been made.
```

This is not a hard cap on HOLMES. It is a UX checkpoint to prevent invisible unbounded work and to give the user control when the task is not converging.

### Before-edit delay

A long delay before the first edit is acceptable only when the visible output proves that the delay is buying safety: bounding scope, resolving unknowns, or establishing verification. It is not acceptable if the output is repetitive process language.

Tier 4 should optimize for early read-only evidence, not early mutation. Users in high-reliability domains will tolerate delayed edits when they can see the model reducing real risk.

---

## 4. Print mode with four tiers

### `omp -p "fix typo"`

This must remain fast and quiet when the typo request is provably safe.

Expected output shape:

```text
HOLMES checked · Tier 1
<edit/read/verification output as normal>
```

If the path is not provided, the model should perform minimal read-only discovery first. If it still cannot prove exact non-semantic scope, failing into Tier 2/3 is correct, but the diagnostic must say what proof was missing.

### `omp -p "refactor the auth module"`

This is not a Tier 1/Tier 2 request by default. It likely involves multiple files, security-adjacent behavior, tests, and unknown impact. Tier 3 or Tier 4 is expected.

Minutes of output before an edit can be acceptable in print mode for a request this broad, but only if the output is structured and non-interactive:

```text
HOLMES Tier 4 · iterative reasoning before mutation
Pass 1: bounded auth surfaces; found migration/session unknowns.
Pass 2: resolved migration behavior from tests; synthesis complete.
Approved mutation scope: ...
```

Non-interactive mode cannot ask the user whether to continue unless there is a configured policy for that. Therefore print mode needs an explicit Tier 4 policy.

Recommended policy:

- Tier 1: proceed normally with collapsed output.
- Tier 2: emit short TARGET/DELTA and proceed.
- Tier 3: emit one HOLMES pass and proceed only if blockers are resolved.
- Tier 4: continue read-only/pass-based work while progress is being made; if convergence stalls or user input is required, fail closed with a concise diagnostic and no mutation.

The diagnostic should be actionable:

```text
Tier 4 stopped before mutation: remaining blocker requires user decision between session migration strategies. Re-run with a narrower target or provide the decision.
```

Do not loop indefinitely in print mode. Do not downgrade just because interaction is unavailable. Do not hide Tier 4 progress to keep logs short; instead make progress summaries compact.

### Is long pre-edit output acceptable non-interactively?

Yes for genuinely Tier 4 work, with two constraints:

1. The output must be progress summaries, not full reasoning dumps.
2. The system must fail closed if it reaches a decision point that needs the user or if repeated passes do not reduce uncertainty.

For simple work, long pre-edit output is not acceptable. If simple explicit requests regularly enter Tier 3/4, fix the proof-down/preflight path rather than weakening Tier 4.

---

## 5. Prove-down rendering

### Should users see every prove-down step?

Not by default.

Rendering this for every request would be too noisy:

```text
Checking Tier 4... ruled out.
Checking Tier 3... ruled out.
Checking Tier 2... ruled out.
Tier 1.
```

That is useful for audit/debug mode, not normal UX.

Default rendering should show:

- final tier;
- approved scope;
- next required action;
- if not Tier 1, the main reason the classifier could not prove down further.

Examples:

```text
HOLMES Tier 1 · exact edit allowed: README.md
```

```text
HOLMES Tier 2 · could not prove Tier 1: code behavior may change · TARGET/DELTA required
```

```text
HOLMES Tier 3 · could not prove Tier 2: affected behavior requires sourced NOW facts · one HOLMES pass required
```

```text
HOLMES Tier 4 · could not prove Tier 3: scope spans auth, persistence, and migration with unresolved safety blockers
```

### What belongs in expandable details?

The full proof-down ladder should be available in details for audit:

```ts
proofDown: {
  assumedTier: 4,
  steps: [
    {
      from: 4,
      to: 3,
      proven: true,
      evidence: ["explicit single subsystem", "no safety-critical/data/deployment surface", "blocking unknowns absent"],
    },
    {
      from: 3,
      to: 2,
      proven: false,
      missing: ["no observed facts for current behavior", "planned edit may affect two files"],
    },
  ],
  finalTier: 3,
}
```

The user-facing renderer should summarize this as one sentence. The model-facing result can include more detail because the model needs to know what requirement to satisfy next.

### Raised tiers

Raised tiers must be visible. If the model proposed Tier 1 and the tool returns Tier 3/4, hiding that would make the extra work look arbitrary.

Recommended phrasing:

```text
HOLMES raised to Tier 3 · proposed Tier 1 lacked proof of non-semantic impact; current behavior facts must be observed before mutation.
```

Avoid accusatory language. The classifier is not catching dishonesty; it is preserving the burden of proof.

---

## 6. Required design changes

### Schema and state

Update `HolmesTier` from `1 | 2 | 3` to `1 | 2 | 3 | 4` everywhere:

- TypeBox schema;
- `HolmesTier` type;
- `ClassificationRequirement`;
- `HolmesClassifyDetails`;
- `signals`;
- history/active state;
- stats/status output;
- renderers;
- prompt text;
- gate requirement checks.

Add Tier 4 requirements:

```ts
| "ITERATIVE_HOLMES_LOOP"
| "RESOLVE_BLOCKERS_TO_CONVERGENCE"
| "PROGRESS_UPDATES"
| "CONTINUATION_OR_FAIL_CLOSED_WHEN_STALLED"
```

Add proof-down details:

```ts
interface ProofDownStep {
  fromTier: HolmesTier;
  toTier: HolmesTier;
  proven: boolean;
  evidence: string[];
  missingProof: string[];
  rationale: string;
}

interface HolmesClassifyDetails {
  assumedTier: 4;
  proofDown: ProofDownStep[];
  retainedTierReason?: string;
}
```

### Algorithm

Replace trigger-up pseudocode with explicit proof-down logic:

```ts
let tier = 4;

if (proveNotTier4(snapshot, params)) tier = 3;
else return tier4("cannot prove bounded single-pass work", missingProof);

if (proveNotTier3(snapshot, params)) tier = 2;
else return tier3("cannot prove TARGET/DELTA is sufficient", missingProof);

if (proveNotTier2(snapshot, params)) tier = 1;
else return tier2("cannot prove non-semantic exact mutation", missingProof);

return tier1("provably non-semantic exact mutation", evidence);
```

The old signal arrays are still useful, but they should feed proof functions. Absence of Tier 4 signals is not enough to prove not Tier 4.

### Gate

Tier 3 gate must require exactly one complete HOLMES pass after classification and before mutation. If that pass surfaces unresolved blockers, the record should become Tier 4 or blocked until reclassification.

Tier 4 gate must require iterative HOLMES evidence until synthesis is complete:

- pass records exist after classification;
- each pass has a target, observed evidence, blocker list, and synthesis/next action;
- blocking unknowns are resolved before mutation;
- if scope expands, classification expires and must be rerun;
- if progress stalls in print mode, fail closed.

The gate does not need to understand all semantics. It needs to enforce that the model produced the required proof artifacts, that claims are tied to observed tools where possible, and that no blocking unknown remains visible.

### Rendering

Add custom renderers for all four tiers:

- Tier 1: collapsed one-liner.
- Tier 2: one-line result plus short TARGET/DELTA requirement.
- Tier 3: visible HOLMES pass with phase summaries.
- Tier 4: progress renderer with pass summaries, blockers, next action, and completion state.

The raw `details` object should remain expandable but never be the default surface.

### Prompt

Update prompt language from "call `holmes_classify` early after initial analysis" to a more nuanced rule:

```text
Before mutation, call holmes_classify. If you lack enough evidence to prove a lower tier and read-only tools can provide it, perform the minimal read-only observation first. Never mutate before classification.
```

This preserves safety while avoiding unnecessary Tier 3/4 classification caused by missing easy evidence.

---

## 7. Deterministic implementability

Prove-down is partially deterministic.

Deterministic code can safely do these things:

- default to Tier 4;
- reject Tier 1 unless exact non-semantic criteria are met;
- reject lower tiers on broad scope, multiple subsystems, opaque tools, missing paths, unresolved blocker flags, or safety/data/deployment/security surfaces;
- bind scope/tool/path/mutation budgets;
- require visible Tier 2/3/4 artifacts before mutation;
- enforce monotonic overlapping records;
- fail closed on malformed or missing proof.

Deterministic code cannot fully prove these semantic claims from bounded string scanning alone:

- that a refactor is behavior-preserving;
- that one HOLMES pass is sufficient;
- that all architectural consequences are known;
- that an unfamiliar config has no deployment/security/data impact;
- that a remaining unknown is truly non-blocking.

Therefore the implementable design is hybrid:

1. The model supplies proof-down evidence and HOLMES synthesis.
2. The tool deterministically checks that the proof has the required shape and observable support.
3. The gate enforces scope and blocks mutation when proof is absent or stale.
4. Conservative failure remains Tier 4 or blocked, never silent downgrade.

Trying to make prove-down purely deterministic would be safe but frustrating: too many real tasks would stick at Tier 4 because code cannot infer semantic boundedness from request text. Let the model reason, but make the burden explicit and make deterministic code own the enforcement boundary.

---

## Bottom line

Adopt the four-tier prove-down model, but treat it as a UX redesign, not a small enum change.

The safety improvement is real: absence of risk no longer authorizes low effort. The new UX risk is over-escalation and opaque long-running Tier 4 work. Solve that with minimal read-only preflight before classification, proof-down reasons in the render, pass-level Tier 4 progress, interrupt/narrow affordances, and fail-closed print-mode behavior when convergence stalls.

Tier 1 should stay almost invisible. Tier 2 should be a short checkpoint. Tier 3 should be one readable HOLMES pass. Tier 4 should be iterative but never silent.
