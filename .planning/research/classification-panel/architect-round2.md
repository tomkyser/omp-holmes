# Systems Architect Review — Round 2: four-tier prove-down `holmes_classify`

## Verdict

The two changes are the right direction. The four-tier model fixes the overloaded old Tier 3 by separating “one complete HOLMES pass” from “keep looping until the work is actually understood.” The prove-down rule fixes the most important classifier flaw from Round 1: absence of escalation signals can no longer be treated as evidence of safety.

The design is implementable, but only if the authority path remains deterministic and proof-producing:

1. Start every classification at Tier 4.
2. Create an explicit positive-proof record for each attempted step-down.
3. Stop at the first missing proof.
4. Treat the model’s proposed tier and prose as untrusted evidence that can raise the tier, never lower it.
5. Keep process tier floors separate from concrete mutation leases.

The biggest architecture change is this: **Tier is a process floor; a mutation lease is a narrow permission to run one or more concrete tool calls.** Tier 4 must not become a broad “allowed to touch everything” lease. It is a high process requirement under which every mutation still needs exact path/tool/effect coverage.

---

## 1. Prove-down algorithm design

### Core rule

The classifier should return the lowest tier that has been positively proven, not the lowest tier that lacks warning signs.

```ts
function assessTier(snapshot, params, cumulative): ClassificationDecision {
  let tier: HolmesTier = 4;
  const proofs: StepDownProof[] = [];

  const to3 = proveCanStepDownFrom4To3(snapshot, params, cumulative);
  if (!to3.ok) return tier4Decision(to3.blockers);
  tier = 3;
  proofs.push(to3.proof);

  const to2 = proveCanStepDownFrom3To2(snapshot, params, cumulative);
  if (!to2.ok) return tier3Decision(proofs, to2.blockers);
  tier = 2;
  proofs.push(to2.proof);

  const to1 = proveCanStepDownFrom2To1(snapshot, params, cumulative);
  if (!to1.ok) return tier2Decision(proofs, to1.blockers);
  tier = 1;
  proofs.push(to1.proof);

  return applyProposedTierAndRiskFloor(tier, params.proposedTier, cumulative, proofs);
}
```

`StepDownProof` should be structured data, not just a rationale string:

```ts
interface StepDownProof {
  from: HolmesTier;
  to: HolmesTier;
  evidence: string[];
  checkedInputs: string[];
  excludedRisks: string[];
  limitations: string[];
}
```

If a proof has material limitations, the step-down should usually fail. Limitations are useful for diagnostics, not for authorizing a lower tier.

### Tier 4 → Tier 3 proof

This step proves that unlimited HOLMES looping is not required. The classifier must prove all three points Tom named: bounded scope, finite unknowns, and no architectural/safety risk.

Positive proof should require:

| Required proof | Concrete deterministic evidence |
| --- | --- |
| Scope is bounded | Explicit finite path set or a single known module/surface; finite planned action count; no broad glob/directory mutation; no “fix all,” “refactor everything,” “make it work,” “review and improve,” or similar open-ended request shape; cumulative ledger does not show growing file/module scope. |
| Unknowns are finite | Unknowns, if present, are enumerated and have bounded resolution routes; there are no open-ended research/dependency/design questions; the model has not stated “unclear,” “depends,” “need to investigate,” or equivalent unresolved blockers; prior tool results do not reveal expanding unknowns. |
| No architectural risk | The target is not architecture, public API, cross-module behavior, data model, migration, deployment, security, auth, crypto, payments, healthcare/safety/finance/defense-sensitive logic, concurrency, persistence, prompts/rules/hooks, or other process-critical behavior. For code changes, this must come from closed low-risk surfaces and concrete effect shape, not merely from missing keywords. |
| Tooling is bounded | No opaque mutation tool without exact input binding; no unconstrained `task`, `bash`, `eval`, `browser`, `debug`, `github`, `resolve`, broad `ast_edit`, or unknown custom tool. |
| Cumulative history remains bounded | Prior classifications, reads, blocked mutations, and allowed mutations in the same user request do not collectively make the work multi-scope or architectural. |

This can be deterministic only when the work falls inside a closed, low-risk domain. For open-ended source-code behavior changes, “no architectural/safety risk” is not mechanically knowable from request text alone. The safe deterministic result is Tier 4.

Model judgment may help identify risks or enumerate unknowns, but it must not be authority for this step-down.

### Tier 3 → Tier 2 proof

This step proves that a single TARGET/DELTA checkpoint is sufficient and a full HOLMES pass is not required.

Positive proof should require:

| Required proof | Concrete deterministic evidence |
| --- | --- |
| Single scope | Exactly one file or one tightly bounded module/surface; no cross-system paths; no cumulative multi-file/multi-module drift in the same user request. |
| No research needed | The request supplies the necessary facts, or the necessary facts have already been observed through read/search/find/ast_grep/tool evidence; no `web_search`, exploratory `task`, dependency investigation, or unknown external behavior is required before mutation. |
| No unresolved unknowns | Params and observed text contain no assumptions/unknowns that affect mutation; no “maybe,” “unclear,” “assume,” “not sure,” “depends,” or equivalent unresolved language. |
| No multi-system impact | The effect does not change public API contracts, schemas, migrations, build/deploy behavior, auth/security/data flows, concurrency, persistence, prompts/rules/hooks, or multiple callers/subsystems. |
| Inspectable mutation surface | Planned tools are structured and scope-bound (`edit`, narrow `write`, narrow `ast_edit`) or exact-hash opaque actions with at least Tier 2 requirements; no broad opaque command is accepted as low ceremony. |

Tier 2 is appropriate for bounded behavioral or structural work in one scope where all facts are known but the change is still semantic enough to require TARGET/DELTA before mutation.

This proof can be deterministic, again conservatively. If the helper cannot prove single-scope/no-research/no-unknowns/no-multi-system impact, it must remain Tier 3 or Tier 4.

### Tier 2 → Tier 1 proof

This step must be the strictest. Tier 1 means provably non-semantic, not “small.”

Positive proof should require:

| Required proof | Concrete deterministic evidence |
| --- | --- |
| Non-semantic effect | Concrete mutation payload or planned effect fingerprint proves comment-only, whitespace-only, formatting-only with semantic equivalence, documentation typo, or typo in non-code/non-config text. For source files, AST/token semantic equality or an equivalent safe-operator proof is required. |
| Mechanical transform | The change is produced by a closed allowlist of operators: exact text replacement in non-code, comment typo, whitespace formatting, import sorting only when language semantics are unchanged, or another explicitly enumerated safe transform. |
| No behavior change | No source-code token change that can alter runtime behavior; no test expectation change that can mask behavior; no config, lockfile, dependency, migration, CI, deploy, prompt, rule, hook, or permission change unless separately proven non-semantic by a parser/schema-specific rule. |
| No risk surface | Path and effect are outside security/auth/crypto/data/deploy/safety/public-API/process-control surfaces. Absence of risk words is not proof. |
| Exact lease | One concrete path, one concrete tool/effect fingerprint, finite tiny mutation count, no opaque tool, no broad glob, no whole-file source rewrite. |

Opaque tools should never be Tier 1. Exact hashes for `bash`, `eval`, `task`, `browser`, `debug`, `github`, `resolve`, broad `ast_edit`, and unknown tools bind the call, but they do not prove non-semantic behavior.

Tier 1 can be fully deterministic if it is limited to concrete effect proofs. If the tool is called before the actual mutation payload exists, Tier 1 requires an exact normalized planned effect in `plannedActions`; otherwise the classifier cannot prove Tier 1 and should stop at Tier 2 or higher.

### Deterministic code vs model judgment

The authority path should be deterministic. Prove-down does not require model intelligence if the design accepts conservative over-classification.

Model intelligence is useful for:

- proposing a tier;
- naming unknowns;
- explaining target/delta/HOLMES reasoning;
- identifying research routes;
- synthesizing a plan.

Model intelligence should not be used to prove a downgrade. If a deterministic helper cannot prove a step-down, the correct result is the current higher tier.

A model oracle could be added later as advisory evidence, but it must not replace scope/tool/hash checks or closed Tier 1 proof. Tom’s “no leaks or gaps” requirement argues strongly against model-authoritative downgrades.

---

## 2. State machine changes

### Separate process floor from mutation lease

Round 1 already flagged that `active?: ClassificationRecord` is too weak. With four tiers it becomes untenable. The state needs at least two concepts:

```ts
interface ProcessRecord {
  processId: string;
  userRequestDigest: string;
  tierFloor: HolmesTier;        // max required process tier for this request/scope
  status: ProcessStatus;
  proofs: StepDownProof[];
  blockers: ClassificationBlocker[];
  cumulativeScope: CumulativeScopeLedger;
  holmesPasses: HolmesPassRecord[];
  openUnknowns: UnknownRecord[];
  createdAtSequence: number;
  ruleVersion: string;
  valid: boolean;
}

interface MutationLease {
  leaseId: string;
  processId: string;
  userRequestDigest: string;
  leaseTier: HolmesTier;        // tier proven for this concrete effect shape
  effectiveTier: HolmesTier;    // max(process floor, lease tier, overlap floor)
  paths: string[];
  tools: string[];
  operationKinds: string[];
  leaseKind: "exact" | "scope" | "blocked";
  exactFingerprints: Record<string, string[]>;
  maxMutations: number;
  consumedMutations: number;
  expiresOn: ExpirationReason[];
  valid: boolean;
}
```

The gate should select from valid records in history, not from a single active pointer:

1. Find valid process records for the current user request and overlapping scope.
2. Compute `processFloor = max(tierFloor)` across overlaps.
3. Find a valid mutation lease covering the pending effect.
4. Compute `effectiveTier = max(processFloor, lease.leaseTier, overlappingRiskFloor)`.
5. Require compliance for `effectiveTier` and exact lease coverage before allowing mutation.

This prevents classifier shopping and prevents a narrow later lease from downgrading a broad Tier 4 process.

### How Tier 4 unlimited looping works mechanically

Tier 4 should be represented as an open process state, not as a large mutation budget.

Suggested states:

```ts
type ProcessStatus =
  | "classified"
  | "awaiting_tier2_checkpoint"
  | "awaiting_single_holmes_pass"
  | "tier4_looping"
  | "tier4_mutation_ready"
  | "mutation_in_progress"
  | "awaiting_verification"
  | "complete"
  | "expired"
  | "blocked";
```

Tier 4 flow:

1. `holmes_classify.execute` starts at Tier 4 and fails to prove down.
2. It stores a `ProcessRecord` with `tierFloor = 4`, `status = "tier4_looping"`, and a blocked or research-only lease unless there is already a concrete non-mutating/research action to authorize.
3. Observation detects HOLMES passes after the record creation sequence.
4. Each pass is recorded as:

```ts
interface HolmesPassRecord {
  passIndex: number;
  observedAfterSequence: number;
  hone: ComplianceSection;
  observe: ComplianceSection;
  ladder: ComplianceSection;
  map: ComplianceSection;
  establish: ComplianceSection;
  synthesize: ComplianceSection;
  evidenceRefs: EvidenceRef[];
  openedUnknowns: UnknownRecord[];
  resolvedUnknowns: UnknownResolution[];
  broadenedScope: boolean;
  complete: boolean;
}
```

5. After each pass, the process either:
   - remains `tier4_looping` because blockers remain or scope changed;
   - moves to `tier4_mutation_ready` because synthesis is complete and concrete leases exist or can be created;
   - expires/blocks because scope, tool, request, or file state invalidated the process.

There is no maximum pass count. The loop ends only when the state is evidence-complete.

### Does the gate need to track HOLMES pass count?

Yes, but not as a limit.

Pass count is needed for:

- distinguishing Tier 3 single-pass compliance from Tier 4 iterative compliance;
- anchoring each pass after the relevant classification/process record;
- detecting whether new evidence reopened previously closed unknowns;
- audit/status output;
- avoiding stale compliance from a previous pass after scope changed.

The gate should not say “three passes is enough.” It should say “the latest pass closed every blocking unknown with evidence and produced a bounded synthesis.”

### Tier 4 completion condition

There are two completion points:

1. **Analysis/mutation-ready completion** — enough to allow scoped mutations.
2. **Process completion** — all planned mutations and verification for the user request are complete.

For mutation readiness, require:

- TARGET is bounded and current.
- OBSERVE facts cite observed evidence or are direct user-provided facts.
- LADDER reaches the current observed state without gaps.
- MAP contains no blocking unknowns.
- ESTABLISH has resolved required research/delegation/tool-evidence items.
- SYNTHESIZE contains a finite plan with explicit files/tools/effects and verification criteria.
- No assistant text after synthesis broadened scope outside the process envelope.
- A concrete mutation lease covers the pending effect.

For final process completion, additionally require:

- all mutation leases for the synthesized plan are consumed or intentionally expired;
- targeted verification required by the plan has run or been blocked with explicit evidence;
- no new unknowns emerged during mutation/verification.

If a new unknown, new file, new subsystem, or new risk surface appears, the process returns to `tier4_looping` and requires another pass before further mutation.

### Process tier floor and mutation lease with four tiers

The process floor is monotonic for overlapping work in the same user request. A Tier 4 process floor remains Tier 4 until the user request changes or the record expires for an objective reason. A later narrow lease cannot lower it.

Mutation leases stay narrow:

- Tier 1 lease: exact, non-semantic, usually single-use.
- Tier 2 lease: same-scope structured mutation after TARGET/DELTA.
- Tier 3 lease: explicit finite scope after one full HOLMES pass.
- Tier 4 lease: explicit finite scope after the loop reaches mutation-ready synthesis.

A Tier 4 process may contain a mechanically simple edit, but the effective tier for that edit is still Tier 4 if it is part of the Tier 4 user request. The narrow lease limits blast radius; it does not reduce process obligations.

---

## 3. Integration impact

### `src/types.ts`

Current source still has `HolmesTier = 1 | 2 | 3`, a boolean `ReasoningGuardState`, narrow `MUTATING_TOOLS`, and visible marker constants as gate inputs.

Needed changes:

- Change `HolmesTier` to `1 | 2 | 3 | 4`.
- Add `ProcessRecord`, `MutationLease`, `StepDownProof`, `ClassificationBlocker`, `HolmesPassRecord`, `UnknownRecord`, `UnknownResolution`, `CumulativeScopeLedger`, `PendingEffectSummary`, and `EvidenceRef`.
- Replace `ReasoningGuardState.hasReasoned` with classification/compliance state.
- Replace `MUTATING_TOOLS` with `READ_ONLY_TOOLS` and `EFFECTFUL_TOOLS`; unknown tools default effectful.
- Include `holmes_classify` in the read-only/exempt path for gate purposes, while still logging it.
- Keep `CLASSIFY_MARKER` only as telemetry/backward compatibility; it must not authorize mutation.
- Update marker regexes if retained for telemetry to include Tier 4, but prompts should stop encouraging markers as the contract.
- Add a classifier `ruleVersion` so stale records from older prove-down rules cannot authorize later effects.

### `src/classification.ts`

The original design proposed this file but the current source does not have it. It should become the home for deterministic classification and pure helpers.

Needed responsibilities:

- TypeBox schema for `HolmesClassifyParams` with `HolmesTierSchema` including `4`.
- `buildClassificationSnapshot` from latest user request, observation, tool log, params, cumulative records.
- `proveCanStepDownFrom4To3`, `proveCanStepDownFrom3To2`, `proveCanStepDownFrom2To1`.
- Closed Tier 1 safe-operator proof helpers.
- Path/tool/effect extraction and stable hashing.
- Cumulative scope ledger update.
- Process-floor monotonicity and overlap calculation.
- Mutation lease construction.
- Rendering terse tool results.

The existing `maxTier(params.proposedTier, assessedTier)` shape still works, but `assessedTier` must now be the result of failed/successful prove-down, not escalation triggers. If the model proposes a higher tier than the deterministic proof, the higher tier wins.

### `src/guards.ts`

Current `handleReasoningGuard` trusts visible classification markers. That should be retired.

Needed gate order:

1. Record/summarize every tool attempt in the tool log.
2. Allow `holmes_classify`.
3. Allow read-only tools.
4. Treat unknown/effectful tools as requiring a valid lease.
5. Summarize the pending effect, including exact input/effect fingerprint where possible.
6. Select overlapping process records and compute the process tier floor.
7. Select a valid mutation lease covering the pending effect.
8. Validate user request digest, rule version, scope, tool, paths, operation kind, mutation budget, exact fingerprint, opaque input hash, and file-state/anchor freshness where available.
9. Check tier compliance:
   - Tier 1: no visible ceremony, but exact non-semantic lease proof must already exist.
   - Tier 2: TARGET/DELTA after classification.
   - Tier 3: one full HOLMES pass after classification.
   - Tier 4: latest HOLMES loop state is mutation-ready and no blocking unknowns remain.
10. Consume mutation budget and allow.

Compliance checks must distinguish Tier 3 from Tier 4. A single HOLMES-shaped block satisfies Tier 3 only when the Tier 3 record requires one pass. It does not satisfy Tier 4 unless it also closes the loop under the Tier 4 completion rules.

### `src/prompts.ts`

Current prompt says visible markers unlock mutation and defines only three tiers. It must be replaced with the checkpoint/prove-down contract.

Prompt requirements:

- Explain four tiers exactly:
  - Tier 1: provably non-semantic, zero reasoning ceremony.
  - Tier 2: TARGET/DELTA checkpoint.
  - Tier 3: one full HOLMES pass.
  - Tier 4: HOLMES looping until unknowns are resolved and synthesis is complete.
- State that classification starts at Tier 4 and only steps down with positive proof.
- State that absence of risk language is never proof of safety.
- Tell the model to call `holmes_classify` before mutation-capable tools.
- Tell the model that returned tier, process floor, requirements, and mutation lease are binding.
- Clarify that Tier 1 zero ceremony means no TARGET/DELTA/HOLMES block, not “skip the gate.”
- Clarify that `task`, `bash`, `eval`, browser/debug/GitHub operations, `resolve.apply`, broad `ast_edit`, and unknown tools are effectful unless explicitly covered.
- For Tier 4, instruct the model to continue HOLMES passes until the latest synthesis closes all blocking unknowns and yields concrete leases.

### `src/observation.ts`

Current observation detects three-tier markers and HOLMES vocabulary. It needs to become a compliance/evidence accumulator.

Needed helpers:

- `extractPathMentions(text)`.
- `detectTier2Compliance(text, record)` for TARGET/DELTA after record creation.
- `detectTier3SinglePassCompliance(text, record)` for one H/O/L/M/E/S pass after record creation.
- `detectTier4Pass(text, processRecord)` to extract pass sections, opened/resolved unknowns, evidence refs, and synthesis status.
- `detectAssistantBroadenedScope(text, record)`.
- `redactSelfClassification(text)` for diagnostic classifier context.
- Marker detection updated to Tier 4 if retained, but telemetry only.

The module should not mutate classification authority. It should produce observations that `classification.ts` and `guards.ts` consume.

### `src/main.ts`

Needed wiring:

- Create classification/process/lease state near observation state.
- Register `holmes_classify` before event handlers.
- Add a `context` handler to capture latest user request and digest.
- Do not reset classification on raw `turn_start`; expire only on changed user request, rule version, scope/tool/path/fingerprint mismatch, consumed budget, file-state drift, or explicit invalidation.
- Keep `message_update` / `message_end` for observation and compliance, but no visible text opens the gate.
- Replace `handleReasoningGuard` with `handleClassificationGate`.
- Update `/holmes-status` with current process floor, valid leases, Tier 4 pass count, open unknowns, blocked reasons, and classifier stats.

### Can prove-down live in `execute`?

Yes, with one caveat: `execute` can only prove facts available in the bounded snapshot and params. It must not pretend to know a future mutation payload.

For Tier 1 especially, `execute` needs either:

- exact normalized planned effect fingerprints for structured tools; or
- the actual pending effect summarized by the gate; or
- a conservative result of Tier 2+.

The current model-callable design classifies before the mutation tool call, so Tier 1 proof requires the model to provide a concrete planned effect that the gate later matches exactly. If `plannedActions` only contains prose (`summary`, `operationKind`, `paths`), Tier 1 is not provable for source-code changes.

A stronger alternative is to let the gate classify the pending effect at first mutation attempt, but that changes the custom-tool UX. If the model-callable tool remains, add exact structured effect fields for `edit`, `write`, and narrow `ast_edit`, not just `exactOpaqueInput` for opaque tools.

### Compliance detection: single-pass vs multi-pass HOLMES

Yes, compliance detection must distinguish them.

- Tier 3: one complete, post-classification H/O/L/M/E/S pass plus required evidence is sufficient.
- Tier 4: each pass updates a process ledger. Mutation is allowed only after the latest pass reaches mutation-ready synthesis with no blocking unknowns. A single pass may be enough in a simple Tier 4 case, but only because it satisfies the loop completion condition, not because “one pass” is inherently enough.

---

## 4. Multi-step task handling

A Tier 4 task may require many mutations over many files. The process should look like this:

```text
User request
  -> holmes_classify creates Tier 4 process floor
  -> read/search/find/ast_grep discovery proceeds freely
  -> effectful research/delegation tools require exact Tier 4 research leases
  -> HOLMES pass 1 records unknowns and evidence needs
  -> HOLMES pass 2..N continues until blockers close
  -> synthesis creates finite mutation plan
  -> holmes_classify or gate creates concrete mutation leases under the Tier 4 process
  -> each mutation is checked against its lease
  -> verification runs under its own lease/evidence rule where effectful
  -> process completes only when no planned work or verification unknowns remain
```

### Each mutation still needs a scoped lease

No Tier 4 record should authorize arbitrary mutation. Each effectful call needs one of:

- an exact lease for a single pending effect;
- a finite batch lease for explicit planned actions;
- a scope lease over explicit paths/tools with capped mutation count after Tier 4 synthesis.

The lease must include path set, tool set, operation kind, mutation budget, and exact fingerprints for opaque or exact actions. Scope mismatch blocks and forces a new lease. If the mismatch reveals a new subsystem or unknown, the Tier 4 process returns to looping.

### Process tier floor vs narrow mutation leases

The process tier floor answers: “How much reasoning/evidence is required for this user request?”

The mutation lease answers: “Is this specific tool call allowed?”

They are independent but combined at enforcement time:

```ts
const effectiveTier = max(processFloor, lease.leaseTier, overlappingRiskFloor);
```

A narrow lease cannot reduce a Tier 4 floor. A Tier 4 floor cannot widen a lease. Both must pass.

### Should the model reclassify for each mutation within Tier 4?

Every mutation must be covered. That does not mean the model must redo prove-down from scratch before every individual edit.

Recommended rule:

- Reclassify/create a new lease for every mutation or finite batch not already covered.
- Do not allow reclassification to lower the existing Tier 4 process floor.
- Do not require a new HOLMES pass for a mutation already covered by the latest Tier 4 synthesis and lease.
- Require a new HOLMES pass when a mutation attempt broadens scope, touches a new risk surface, invalidates an assumption, reveals a new unknown, or requires a tool/effect outside the synthesized plan.

This preserves safety without forcing one checkpoint per line edit after a Tier 4 plan has already converged.

---

## 5. New edge cases and risks

1. **Negative proof over open domains.**  
   “No architectural/safety risk” cannot be proven by missing keywords. The implementation needs closed low-risk domains for step-down; otherwise remain Tier 4.

2. **Tier 1 exact effect availability.**  
   If `holmes_classify` is called before the edit payload exists, Tier 1 cannot be proven unless exact planned structured effects are provided and later matched.

3. **Loop theater.**  
   Tier 4 can devolve into repeated HOLMES headings with no progress. Track opened/resolved unknowns and evidence refs. Pass count is audit data; completion requires closure, not repetition.

4. **Infinite loop UX.**  
   Unlimited HOLMES passes must not mean unbounded identical blocked retries. The gate should fail closed on repeated identical mutation attempts without new proof, while still allowing the model to continue genuine research/reasoning.

5. **Scope slicing.**  
   A complex task can be split into small leases. The cumulative scope ledger must include prior reads, classifications, blocked attempts, allowed mutations, and assistant-visible intent for the same user request.

6. **File-state drift.**  
   Records that depend on observed file content should bind to read/edit anchor hashes where available. Drift should expire leases for `write`, `ast_edit`, `resolve`, and opaque commands.

7. **Effectful research under Tier 4.**  
   `task` may be needed for research/delegation, but it is still effectful. It needs an exact read-only/delegation lease and subagents must not inherit parent mutation leases.

8. **Zero ceremony ambiguity.**  
   Tier 1 zero ceremony should mean no visible TARGET/DELTA/HOLMES block. It should not mean mutation without an extension-owned classification record or exact pending-effect proof.

9. **Compliance race.**  
   Tier 2/3/4 compliance must be anchored after the classification/process record and preferably finalized on `message_end`. If a mutation arrives before compliance is reconciled, fail closed.

10. **Over-conservatism.**  
   Prove-down will classify more work as Tier 4 unless helpers can prove safety. That is the correct failure mode for Tom’s requirement, but the UI should render Tier 4 blockers clearly and compactly.

---

## 6. Required design changes before implementation

1. Replace three-tier types, schemas, prompts, marker regexes, and requirements with four-tier equivalents.
2. Replace trigger-up classification with explicit prove-down functions and structured step-down proof records.
3. Make Tier 1 a concrete non-semantic effect proof, not a small-change heuristic.
4. Add exact structured planned-effect fingerprints for `edit`, `write`, and narrow `ast_edit`; keep exact opaque hashes for opaque tools.
5. Replace single `active` record with process records plus mutation leases selected from valid history.
6. Add cumulative scope ledger across the current user request.
7. Add Tier 4 pass ledger and completion rules.
8. Make compliance detection tier-specific: TARGET/DELTA, single HOLMES pass, HOLMES loop closure.
9. Keep authority deterministic. Model prose can raise tier or satisfy visible process requirements, but cannot prove a downgrade.
10. Gate every effectful tool with `effectiveTier = max(processFloor, leaseTier, overlappingRiskFloor)` and exact lease coverage.

With those changes, the four-tier prove-down design is stronger than the Round 1 design. It directly addresses the leak where small or keyword-clean work could fall into too-low a tier, while preserving the custom tool’s main architectural advantage: the extension, not the session model, owns the authorization record.
