# Systems Architect Review — Round 3: impact-based prove-down

## Verdict

Tom's reframing is correct. The classifier's target is not "how big is the edit?" or "which scary words appear?" The target is the predicted effect of the finished work: what behavior changes, who or what receives that change, and what downstream systems can be affected.

That changes the architecture in one important way:

> **Tier is an impact/process floor. The mutation lease is only a concrete tool/path/effect permission.**

Scope still matters, but as a containment and enforcement input. It is not the optimization target. A 500-line documentation rewrite can be Tier 1 if the concrete effect is provably non-functional. A one-line authorization weakening can remain Tier 4 because the possible received effect is unauthorized access, data exposure, or policy bypass.

The authority path should remain deterministic and extension-owned. A deterministic classifier can assess impact safely only by using conservative impact certificates. It cannot generally know arbitrary semantic consequences. When it cannot prove bounded, predictable, or null impact, it must retain the higher tier. Model reasoning is still useful, but as untrusted evidence: it can name affected systems, unknowns, and intended outcomes; it cannot by itself lower the tier.

---

## 1. Impact-Based Prove-Down Algorithm

### Core algorithm

The old proof ladder was effectively about scope:

```text
Can we prove this is narrow?
Can we prove this is one module?
Can we prove this is mechanical?
```

The impact ladder should be:

```text
Start Tier 4: assume impact may be unbounded.

4 → 3: Can we prove the impact is bounded?
3 → 2: Can we prove the impact is predictable?
2 → 1: Can we prove the impact is null/cosmetic?
```

Pseudocode shape:

```ts
function assessImpactTier(snapshot, cumulative, pendingOrPlannedEffect): Decision {
  const objectiveFloors = detectObjectiveImpactFloors(snapshot, cumulative, pendingOrPlannedEffect);
  const proofs: ImpactProof[] = [];

  const bounded = proveBoundedImpact(snapshot, cumulative, pendingOrPlannedEffect);
  if (!bounded.ok) return tier4Decision(objectiveFloors, bounded.missing);
  proofs.push(bounded.proof);

  const predictable = provePredictableImpact(snapshot, cumulative, pendingOrPlannedEffect);
  if (!predictable.ok) return tier3Decision(objectiveFloors, proofs, predictable.missing);
  proofs.push(predictable.proof);

  const nullImpact = proveNullImpact(snapshot, cumulative, pendingOrPlannedEffect);
  if (!nullImpact.ok) return tier2Decision(objectiveFloors, proofs, nullImpact.missing);
  proofs.push(nullImpact.proof);

  return applyFloorsAndProposedTier(1, objectiveFloors, params.proposedTier, proofs);
}
```

Two details matter:

1. **Objective floors can stop descent even when later proof exists.** A narrow auth logic change may have bounded impact but still cannot fall below Tier 3. An auth weakening/removal usually cannot prove bounded impact and should stay Tier 4.
2. **Path count no longer determines Tier 1.** A multi-file doc-only rewrite may be Tier 1 if every concrete effect is non-executable/non-contractual. It still needs a finite mutation lease, but the process tier is based on zero functional impact, not file count.

### 4 → 3: prove impact is bounded

This step asks whether the effect can be contained to a finite, understood boundary. It is not asking whether the edit is small.

**Impact is unbounded when any of these are true:**

- The change alters architecture, public contracts, data model, deployment behavior, runtime ownership boundaries, or cross-system control flow.
- The affected downstream systems are unknown or open-ended.
- The target is a safety-critical path, auth/authz path, crypto path, persistence/data mutation path, transaction/concurrency path, migration path, infrastructure/deploy path, or other high-reliability control plane without a containment certificate.
- The operation weakens validation, authorization, fail-closed behavior, rate/limit thresholds, safety thresholds, or error handling.
- The user request is broad: "refactor," "make robust," "fix the system," "audit," "improve," "clean up," or similar open-ended language without a bounded target.
- The planned action uses broad or opaque mutation: unconstrained `bash`, `eval`, `task`, browser/debug/GitHub actions, broad `ast_edit`, full-file writes, globs, or unknown custom tools without exact effect binding.
- The cumulative session ledger shows scope expansion, repeated slicing, failed verification, or new unknowns.
- User intent is unclear or materially broader/narrower than the planned action.

**Positive proof for bounded impact requires:**

- A concrete finite effect envelope: paths, tools, operation classes, mutation count, and exact effect fingerprints where possible.
- A named affected system/module/surface, not merely a path list.
- Evidence that downstream effect does not cascade beyond that boundary. Acceptable sources include observed reads/searches, repository policy maps, known file-type semantics, public API detection, dependency/caller extraction, or closed allowlists for non-code surfaces.
- No unresolved blocker that could change the affected-system list.
- No hard Tier 4 floor such as auth weakening, migration safety unknowns, deployment blast radius, architectural cross-cutting change, or unknown data-loss potential.
- Clear bounded user intent that matches the planned effect envelope.

A hard high-impact surface does not always imply Tier 4. It does mean the classifier must not step below Tier 3. For example, adding a missing test around a known auth guard could be bounded Tier 3. Removing the guard or changing fail-closed behavior should remain Tier 4 because the effect is not merely "one line changed"; it is unauthorized access potential.

### 3 → 2: prove impact is predictable

This step asks whether the outcome is foreseeable from available evidence. A change can be bounded but still unpredictable: one subsystem, but unknown contracts, hidden reflection, unobserved callers, or behavior assumptions.

**Impact is unpredictable when any of these are true:**

- The current behavior is not observed but the plan relies on it.
- The change depends on assumptions about callers, serialization/reflection, environment variables, import side effects, ordering, concurrency, retries, transactions, timeouts, defaults, or external service behavior.
- The change modifies an implicit contract: error strings, status codes, schemas, prompts/rules, CLI output, logging consumed by machines, snapshot formats, generated artifacts, config semantics, or public documentation promises.
- Tests or verification are needed to understand the effect, not merely to confirm an understood effect.
- The planned operation changes validation, persistence, external API shape, failure mode, or concurrency semantics.
- The model's reasoning contains unresolved "maybe," "assume," "unclear," "depends," or equivalent language about effect.
- The cumulative ledger has failed checks, broadened scope, or recently discovered dependencies.

**Positive proof for predictable impact requires:**

- One affected system/module/surface with a concrete path set.
- Observed facts for current behavior when the change relies on current behavior.
- An exact description of the before/after effect in terms of runtime behavior, not edit mechanics.
- No unresolved unknowns that could alter the impact assessment.
- No implicit contract risk, or a concrete certificate that the touched text/token is not contractually consumed.
- Structured, inspectable mutation tools or exact-bound opaque inputs.
- User intent alignment: the planned behavioral effect is the effect the user asked for, not a different or broader effect.
- No objective Tier 3 floor remaining from a hard high-impact indicator.

Tier 2 is therefore the normal home for bounded source-code behavior changes with known consequences. It is not the home for arbitrary "small" edits.

### 2 → 1: prove impact is null/cosmetic

This step is the strictest. Tier 1 means no functional or behavioral effect, not "low risk" and not "small."

**Positive proof for null/cosmetic impact requires all applicable checks:**

- The concrete effect is known: normalized patch, planned edit fingerprint, AST edit match/rewrite fingerprint, or file replacement hash.
- No executable code-token semantic change, or a parser-specific semantic-equivalence proof for the file type.
- No runtime config, dependency, lockfile, migration, CI/deploy, prompt/rule/hook, permission, schema, public API, generated artifact, snapshot, or test expectation change unless a file-type-specific rule proves no runtime effect.
- For documentation/prose: no executable snippets, commands, API contracts, safety instructions, policy statements, or user-visible behavioral promises are changed in a way that downstream users/tools rely on.
- For comments/whitespace/formatting: token/AST behavior is unchanged, and the file type is one where comments/formatting are non-semantic.
- For metadata: the metadata is non-executable and non-contractual.
- The mutation lease is finite and exact. It may cover many files when each effect has a null-impact certificate; it must not be a broad glob with unknown matches.

Examples:

- `README.md` prose typo, no command/API/safety meaning changed → Tier 1.
- 500-line doc style rewrite across explicit docs paths, all prose-only and non-contractual → Tier 1 with a finite batch lease.
- Source formatting where token/AST semantics are unchanged → Tier 1 if the formatter/equivalence proof is concrete.
- Variable rename in source → not Tier 1 unless semantic equivalence includes reflection/serialization/export checks for that language and project.
- Error message change → not Tier 1 by default; may be contractually consumed.

---

## 2. Impact Signals Taxonomy

Signals should be grouped by what they prove or prevent. They are not a flat risk score.

### Hard high-impact indicators

Any one of these creates an objective floor of at least Tier 3. If containment is not proven, the result remains Tier 4.

| Indicator | Why it is high impact | Default consequence |
| --- | --- | --- |
| Auth/authz logic | Changes who can do what | At least Tier 3; Tier 4 for weakening/removal, fail-open paths, policy ambiguity |
| Data mutation/persistence | Can lose, corrupt, expose, duplicate, or retain data | At least Tier 3; Tier 4 for migrations, schema changes, unknown rollback/data-loss path |
| Cryptographic operations | Can invalidate confidentiality/integrity assumptions | Usually Tier 4 unless strictly test-only/non-production |
| External API contracts | Affects downstream callers outside the edit scope | At least Tier 3; Tier 4 if compatibility/consumer impact unknown |
| Safety thresholds/limits | Changes operating envelope or hazard controls | Usually Tier 4 unless non-runtime presentation only |
| Validation removal/weakening | Expands accepted bad input | At least Tier 3; Tier 4 if security/data/safety-facing |
| Fail-closed → fail-open error handling | Converts failure into permissive behavior | Usually Tier 4 |
| Concurrency/transaction semantics | Can create races, partial commits, deadlocks, duplicated effects | At least Tier 3; Tier 4 if correctness/data/safety impact unknown |
| Deployment/build/CI/release controls | Can change production artifact or rollout behavior | At least Tier 3; Tier 4 for production deployment paths |
| Dependency/lockfile changes | Can change behavior outside visible code | At least Tier 3 unless proven dev-only/non-runtime |
| Prompts/rules/hooks/agent behavior | Changes model/tool behavior downstream | At least Tier 3; Tier 4 for guardrail enforcement changes |
| Test expectation changes | Can mask real behavior changes | At least Tier 2; Tier 3+ when paired with behavior changes |

These are impact indicators because they describe received effects: access, data, confidentiality, safety margin, API compatibility, production behavior. Scope only modulates whether the impact can be bounded.

### Hard zero-impact indicators

All relevant conditions must be true for Tier 1:

- Concrete effect is known and exact.
- No code-token semantic change, or file-type-specific semantic equivalence is proven.
- No behavioral difference in any execution path.
- Purely cosmetic/presentational: comments, whitespace, non-semantic formatting, prose docs, or non-executable metadata.
- No runtime config, dependency, schema, prompt/rule/hook, CI/deploy, generated artifact, test expectation, API contract, command example, safety instruction, or machine-consumed output changes.
- File type semantics are known to the classifier.
- User intent and planned effect both describe a cosmetic/null change.

This is deliberately a closed set. If the classifier cannot prove zero impact from concrete effect data, it must stop at Tier 2 or higher.

### Soft/ambiguous signals requiring interpolation

These signals are common false-positive/false-negative traps. They do not determine tier alone; they create proof obligations.

| Signal | Usually | Hidden impact risk | Required interpolation |
| --- | --- | --- | --- |
| Variable rename | Cosmetic/refactor | Reflection, serialization, public exports, test snapshots, string-based access | Is the symbol exported, serialized, reflected, or referenced by name? |
| Default value change | Behavior change | Latency, load, retries, resource use, safety thresholds | What receives the default and what downstream behavior changes? |
| Import reorganization | Mechanical | Import side effects, order dependence, tree shaking, polyfills | Are imported modules side-effect-free and order-insensitive? |
| Error message change | Cosmetic | Tests, clients, monitoring, machine parsers, support docs | Is the string part of a contract or machine-consumed output? |
| Documentation rewrite | Cosmetic | Commands, API contracts, safety procedures, compliance language | Is it purely prose, or does it change instructions users execute? |
| Config metadata change | Often behavior | Runtime flags, deployment, security posture, generated code | Is the metadata executable/consumed at runtime? |
| Test-only change | Low direct runtime impact | Can hide regressions or change acceptance criteria | Does it only add coverage, or does it weaken assertions? |
| Generated/snapshot change | Ambiguous | May encode public output/contracts | Was it regenerated from unchanged source, or manually changed? |
| Logging/telemetry change | Often low | Alerts, compliance, machine parsers, incident response | Is log shape or severity consumed operationally? |

The classifier should not turn these into a numeric score. It should ask: what must be true for this to be bounded, predictable, or null, and is there observed evidence for those truths?

---

## 3. The Interpolation Engine

"Pseudo extrapolation via interpolation" means the classifier predicts the received effect of the finished work from the evidence already available. It does not execute code. It interpolates between user intent, planned operation, observed context, path semantics, and session history to infer an impact envelope.

### Inputs

The engine should use bounded, extension-observed inputs:

- Latest user request and constraints.
- Model's planned actions: tool name, paths, operation kind, summaries, exact structured effects/fingerprints when supplied.
- Observed assistant text, including TARGET/DELTA/HOLMES sections, assumptions, and unknowns.
- Tool log for the current user request: files read/searched/found, paths mentioned, blocked/allowed mutations, prior classifications, verification failures, delegated work.
- File/path semantics: directory names, file names, extensions, module names, function/class names in observed text.
- Operation class: add line, remove line, replace expression, rewrite function, replace file, dependency update, config edit, generated artifact update.
- Historical mutation pattern in the session: scope growth, repeated narrow leases, blocked mismatches, newly discovered dependencies.
- Repository policy maps where available: high-impact path patterns, known docs-only areas, generated files, public API roots, deployment roots, safety/auth/data modules.

The model may supply an impact prediction, but that prediction is a claim. It helps locate proof obligations; it is not the proof.

### Impact envelope

The central internal object should be an impact envelope, not just a path envelope:

```ts
interface ImpactEnvelope {
  affectedPaths: string[];
  affectedSystems: string[];
  runtimeSurfaces: Array<
    | "none"
    | "presentation"
    | "application_logic"
    | "authz"
    | "data_persistence"
    | "crypto"
    | "external_api"
    | "deployment"
    | "concurrency"
    | "agent_guardrail"
    | "unknown"
  >;
  receivedEffect: string;
  downstreamBoundary: "none" | "single_module" | "single_system" | "cross_system" | "unknown";
  predictability: "proven_null" | "predictable" | "bounded_uncertain" | "unbounded_or_unknown";
  objectiveFloors: HolmesTier[];
  intentAlignment: IntentAlignment;
  evidenceRefs: EvidenceRef[];
  missingProof: string[];
}
```

The mutation lease remains path/tool/fingerprint-bound. The impact envelope decides the process tier and proof obligations.

### Reasoning rules

The engine should apply ordered deterministic rules, not a freeform score.

#### Path-based impact inference

Path names are not proof, but they are strong priors and floor triggers:

- `src/auth/*`, `permissions`, `policy`, `session`, `token`, `jwt` → auth/security surface.
- `migration`, `schema`, `db`, `repository`, `persist`, `save`, `delete` → data/persistence surface.
- `crypto`, `hash`, `encrypt`, `sign`, `verify` → crypto surface.
- `api`, `routes`, `protocol`, `schema`, `openapi`, `graphql` → external contract surface.
- `deploy`, `ci`, `workflow`, `docker`, `terraform`, `k8s` → deployment/infrastructure surface.
- `rules`, `hooks`, `prompts`, `agents` → agent behavior/control surface.
- `docs`, `README`, `comments` → likely presentational, but only Tier 1 if concrete effect is non-contractual.

A path can raise or block a step-down. A low-risk path alone cannot prove Tier 1.

#### Operation-based impact inference

Operation class determines received effect risk:

- Removing a condition, validation, guard, permission check, transaction, lock, retry cap, timeout, or error branch is high impact.
- Changing a comparator, threshold, default, feature flag, status code, schema, persistence call, or API response shape is behavioral.
- Rewriting a function/body/file is broader than replacing a comment, even in one path.
- Adding tests is lower runtime impact than changing tests to weaken expectations.
- Import sorting is low only when side effects/order dependence are ruled out.

The operation should be inferred from concrete effect when possible. Model-supplied `operationKind` is not authoritative.

#### Scope-vs-impact calibration

The classifier should explicitly separate blast radius from path count:

- Large scope + docs/prose-only + no executable/contract changes → low or null impact.
- Tiny scope + auth/data/crypto/safety/fail-open/validation weakening → high impact.
- Multi-file source refactor with AST/token equivalence proof → potentially predictable or null depending on proof strength.
- Single config default change → behavioral until runtime meaning is known.

This avoids both old errors: over-escalating harmless large edits and under-escalating dangerous small edits.

#### User intent alignment

The engine should compare intended received effect with planned received effect:

- User says "fix typo"; planned effect changes auth logic → mismatch, Tier 4 or blocked.
- User says "remove the auth check"; planned effect changes auth logic → aligned, but objective impact remains high.
- User says "make errors clearer"; planned effect changes status codes → partial mismatch because status code is behavior, not just clarity.
- User says "update docs"; planned effect edits executable examples or policy docs → ambiguous; requires contract/presentation proof.

Alignment can raise tier or block mutation. Alignment cannot lower objective impact.

### False-positive and false-negative controls

**False negative controls:**

- Start at Tier 4.
- Use hard impact floors.
- Treat absence of flags as no proof.
- Bind Tier 1 to concrete null-impact effects.
- Track cumulative scope across the user request.
- Escalate on intent mismatch, scope expansion, failed verification, or new unknowns.
- Treat unknown file/tool semantics as high impact until classified.

**False positive controls:**

- Provide explicit null-impact certificates for docs/comments/whitespace/prose-only changes, even across many files.
- Allow minimal read-only preflight before classification when proof is nearby.
- Return missing-proof diagnostics so the model can gather targeted evidence instead of doing full ceremony.
- Use repository policy maps to recognize genuinely low-risk surfaces.
- Distinguish "bounded high-impact" Tier 3 from "unbounded high-impact" Tier 4.

---

## 4. Tool Design Changes

The custom-tool architecture still works. The algorithm and data model need to change more than the mechanism.

### Parameter changes

The classifier should not rely only on `operationKind`, `summary`, paths, and tools. Add model-supplied impact claims as structured, untrusted evidence:

```ts
interface HolmesClassifyParams {
  proposedTier: 1 | 2 | 3 | 4;
  target: TargetSummary;
  plannedActions: PlannedAction[];
  reasoning: string;
  holmes?: HolmesSections;

  impact?: {
    userIntentSummary: string;
    intendedReceivedEffect: string;
    predictedBehaviorChange: string;
    affectedSystems: string[];
    downstreamEffects: string[];
    contractChanges: string[];
    dataEffects: string[];
    safetySecurityEffects: string[];
    reversibility: "trivial" | "bounded" | "difficult" | "unknown";
    confidence: "high" | "medium" | "low";
    assumptions: string[];
    unknowns: string[];
  };

  intentAlignment?: {
    claimedAlignment: "aligned" | "partial" | "mismatch" | "unknown";
    explanation: string;
  };
}
```

For Tier 1 and exact low-tier leases, `plannedActions` also needs structured effect fields, not just prose:

```ts
interface PlannedAction {
  toolName: string;
  paths: string[];
  operationKind: OperationKind;
  summary: string;
  exactOpaqueInput?: string;

  structuredEffect?:
    | { kind: "edit"; path: string; normalizedPatchHash: string; semanticClassClaim: string }
    | { kind: "write"; path: string; contentHash: string; replacementClassClaim: string }
    | { kind: "ast_edit"; paths: string[]; patternHash: string; replacementHash: string; expectedMatchCount?: number };
}
```

The tool uses these claims for comparison and later matching. It must not accept them as downgrade proof unless it can independently verify them or the gate later verifies the concrete pending effect.

### Execute-time signal extractors

`holmes_classify.execute` needs new bounded extractors:

- `buildCumulativeRequestLedger`: user paths, observed paths, reads/searches/finds, prior classifications, blocked/allowed effects, verification results, broadened-scope statements.
- `extractIntent`: requested object, requested operation, constraints, non-goals, explicit risk acceptance, and success target.
- `extractPlannedReceivedEffect`: what the planned action will do to behavior/users/downstream, inferred from concrete effect and model claims.
- `detectIntentMismatch`: planned effect broader/different/weaker than request.
- `detectHardImpactIndicators`: auth, data, crypto, API contract, safety thresholds, validation weakening, fail-open, concurrency/transactions, deployment, agent guardrails.
- `detectNullImpactCertificate`: docs/prose/comment/whitespace/formatting/metadata proof, including executable/contract exclusions.
- `detectBehavioralDelta`: removed guards, changed predicates, changed defaults, changed errors/status, changed persistence calls, changed imports with possible side effects.
- `estimateDownstreamBoundary`: none/single module/single system/cross-system/unknown from path policy, observed dependency evidence, public exports/contracts.
- `detectImplicitContractRisk`: serialized names, reflection, error strings, logs, CLI/API output, generated snapshots, docs commands, public examples.
- `buildImpactEnvelope`: combines all signals into floors, proof obligations, and missing proof.

These must be hot-path bounded: no file reads, no network, no shell, no unbounded parsing inside the gate. File content may be used only if already observed or supplied as exact pending effect data.

### Return value changes

The result should include impact assessment in addition to tier:

```ts
interface HolmesClassifyDetails {
  classificationId: string;
  proposedTier: HolmesTier;
  assessedTier: HolmesTier;
  tier: HolmesTier;

  impact: {
    receivedEffect: string;
    affectedSystems: string[];
    runtimeSurfaces: string[];
    downstreamBoundary: string;
    intentAlignment: IntentAlignment;
    objectiveFloors: string[];
    boundedness: "proven" | "missing_proof";
    predictability: "proven" | "missing_proof";
    nullImpact: "proven" | "not_proven";
  };

  proofDown: Array<{
    fromTier: HolmesTier;
    toTier: HolmesTier;
    question: "bounded_impact" | "predictable_impact" | "null_impact";
    proven: boolean;
    evidence: EvidenceRef[];
    missingProof: string[];
  }>;

  requirements: ClassificationRequirement[];
  lease: MutationLease;
  impactEnvelope: ImpactEnvelope;
  rationale: string;
}
```

Default rendering should stay compact:

```text
HOLMES Tier 3 · bounded auth impact, not predictable/null: authorization behavior surface requires full HOLMES pass.
```

or:

```text
HOLMES Tier 1 · null impact proven: docs/prose-only exact batch, no executable/API/safety text changed.
```

Audit details can expose the full ladder.

### Scope envelope becomes effect/impact-bound

The path-bound scope envelope remains necessary for enforcement, but it is insufficient. Replace or extend it with two layers:

1. **Mutation lease:** exact path/tool/fingerprint/mutation-budget coverage for a pending effect.
2. **Impact envelope:** affected systems, runtime surfaces, downstream boundary, intent alignment, objective floors, and proof obligations.

A Tier 4 process cannot authorize broad mutation merely because it is high tier. Conversely, a Tier 1 docs batch may cover many paths because the impact envelope proves null effect for each concrete mutation.

### Does this require model intelligence?

The authoritative classifier should remain deterministic. It can safely approximate impact through conservative certificates:

- hard floors from path/operation/effect patterns;
- exact diff/effect binding;
- token/AST/comment/docs/config classifiers;
- cumulative ledger;
- intent/planned-effect mismatch detection;
- explicit missing-proof obligations.

It cannot deterministically infer all semantic impact. If product goals require more nuanced down-classification, add model intelligence as advisory evidence or add repository-specific policy/static-analysis plugins. Do not make model judgment the authority for a downgrade.

---

## 5. The User-Intent Alignment Check

Tom's "user intent balanced against objectivity" means classification has two independent questions:

1. **Alignment:** Is the planned effect what the user asked for?
2. **Objective impact:** Even if aligned, what does the planned effect do?

Both matter. Alignment is not safety.

### Alignment model

The classifier should extract an `IntentEnvelope` from the latest user request:

```ts
interface IntentEnvelope {
  requestedObject: string[];        // files, modules, behavior, docs, tests, feature
  requestedOperation: string[];     // fix typo, refactor, remove, add, debug, update
  requestedEffect: string;          // received outcome in user terms
  constraints: string[];            // do not change behavior, docs only, preserve API, etc.
  nonGoals: string[];
  ambiguity: "clear" | "ambiguous" | "conflicting";
}
```

Then compare it to the `ImpactEnvelope` from planned actions:

```ts
type IntentAlignment =
  | { status: "aligned"; evidence: EvidenceRef[] }
  | { status: "partial"; missingOrExtra: string[] }
  | { status: "mismatch"; reason: string; floor: HolmesTier }
  | { status: "unknown"; missingProof: string[] };
```

### Alignment rules

- Planned effect must touch the requested object/surface, or a necessary directly related surface supported by evidence.
- Planned operation must be compatible with requested operation. "Fix typo" does not authorize code behavior changes. "Refactor" does not authorize public behavior changes unless explicitly requested or proven behavior-preserving.
- Planned effect must respect constraints and non-goals. "Do not change behavior" creates a null/preservation proof obligation.
- If the user asks for a high-impact change, the mismatch disappears but the objective floor remains.
- If intent is ambiguous and the planned effect is high-impact, stay Tier 4 or block until clarified/narrowed.
- If intent is ambiguous and planned effect is null/cosmetic, Tier 1 may still be possible if concrete null impact is proven and the path/object is within request bounds.

### Examples

| User intent | Planned action | Alignment | Objective impact | Result |
| --- | --- | --- | --- | --- |
| "Fix typo in README" | edit README prose typo | aligned | null | Tier 1 |
| "Fix typo" | edit auth predicate | mismatch | high | Tier 4/block |
| "Remove auth check" | remove `isAdmin` guard | aligned | unbounded/high | Tier 4 |
| "Make error clearer" | change message text only | aligned/partial | ambiguous contract | Tier 2/3 unless non-contract proof |
| "Make error clearer" | change HTTP 403 to 200 | mismatch or broader effect | behavioral/fail-open risk | Tier 4 |
| "Update docs" | rewrite API guarantee | aligned object, behavioral contract risk | external contract | Tier 3/4 |

The key rule: **intent alignment may remove a mismatch escalation, but it never proves low impact.**

---

## 6. Integration with Prove-Down

The revised proof-down should be implemented as a chain of impact certificates and missing-proof records.

### Start: Tier 4

The classifier begins from maximum impact because the absence of known risk is not evidence that the finished product is safe or low-impact.

```text
Start: Tier 4 (impact may be unbounded or unknown)
```

### 4 → 3: can we prove bounded impact?

Evidence needed:

- Concrete finite file/effect set, not an open glob or broad directory mutation.
- Concrete affected system/module/surface, not just path count.
- No cascading dependency risk, or observed/policy evidence bounding downstream effects.
- No uncontained safety/security/data/deployment/architecture surface.
- No validation weakening, fail-open conversion, guard removal, data-loss potential, migration uncertainty, or safety-threshold change without a domain-specific containment certificate.
- Effect is containable to the planned impact envelope.
- User intent is clear, bounded, and aligned with the planned effect.
- Cumulative request ledger does not show scope expansion or slicing.
- Planned tools are inspectable or exact-input/effect-bound.

If this proof fails, return Tier 4 with the missing bounded-impact proof. Tier 4 then means iterative HOLMES until impact is bounded and a concrete lease exists. It does not mean broad mutation permission.

### 3 → 2: can we prove predictable impact?

Evidence needed:

- Single system/module/surface affected.
- Outcome is foreseeable from available evidence: current behavior facts are observed or not needed.
- No unknowns that could change the impact assessment.
- No implicit contracts or behavioral assumptions remain unresolved.
- No hard high-impact floor requiring full HOLMES process.
- Changes align with the user's stated intent.
- Mutation shape is structured and bounded.
- Verification plan confirms an understood effect rather than discovering what the effect is.

If this proof fails, return Tier 3. Tier 3 requires one full HOLMES pass because impact is bounded but not yet predictable enough for a short TARGET/DELTA checkpoint.

### 2 → 1: can we prove null/cosmetic impact?

Evidence needed:

- Concrete exact effect is available or supplied as a planned effect that the gate later matches exactly.
- No functional/behavioral change to any execution path.
- Purely presentational: comments, whitespace, formatting with semantic equivalence, docs/prose, or non-executable metadata.
- Non-code metadata has no runtime, contract, deployment, prompt/rule/hook, schema, dependency, or generated-artifact effect.
- Even in the worst case, the change cannot affect behavior as received by users, systems, tools, or downstream consumers.

If this proof fails, return Tier 2. Tier 2 is not a failure; it is the normal tier for known, bounded behavior changes.

### Proof object shape

Each step should emit a proof or failed proof object:

```ts
interface ImpactStepDownProof {
  fromTier: HolmesTier;
  toTier: HolmesTier;
  impactQuestion: "bounded" | "predictable" | "null";
  ok: boolean;
  evidenceRefs: EvidenceRef[];
  excludedImpactRisks: string[];
  objectiveFloors: string[];
  missingProof: string[];
  invalidatesOn: InvalidationReason[];
}
```

These proof objects are more important than the final tier label. They make the decision auditable and tell the model what evidence to gather next.

### Classification examples

#### One-line auth removal

```text
Effect: removes authorization guard.
Scope: one file, one line.
Received impact: unauthorized access path may open.
Intent alignment: aligned only if user asked for it; otherwise mismatch.
Bounded impact: not proven; downstream security/data effects unknown or high-criticality.
Tier: 4.
```

If a very narrow auth-adjacent change is provably bounded and not a weakening, it may step to Tier 3, but the hard auth floor prevents Tier 2/1.

#### 500-line documentation rewrite

```text
Effect: prose-only docs rewrite across explicit docs files.
Scope: many files.
Received impact: presentation only.
Null impact proof: all changed regions are non-executable, non-contractual prose; no commands/API/safety instructions changed.
Tier: 1 with finite batch lease.
```

If the docs include commands, API guarantees, safety procedures, or generated reference output, Tier 1 fails until those are proven non-contractual or unchanged.

#### Default timeout change

```text
Effect: changes runtime default from 30 to 3000.
Scope: one line.
Received impact: latency/resource/failure behavior changes for all default consumers.
Bounded impact: may be unknown until consumers are known.
Predictability: not proven without caller/config evidence.
Tier: 3 or 4 depending downstream unknowns.
```

#### Error message change

```text
Effect: changes user-visible/machine-visible string.
Scope: one line.
Received impact: maybe presentational, maybe contract.
Null impact: not proven unless string is known not to be matched/parsed/snapshotted.
Tier: 2 by default; Tier 1 only with non-contract proof.
```

---

## Required architecture changes from Round 2

Round 2's process-floor/mutation-lease split still stands. Round 3 changes what those records prove.

1. Rename the proof-down functions around impact:
   - `proveBoundedImpact` for 4→3.
   - `provePredictableImpact` for 3→2.
   - `proveNullImpact` for 2→1.
2. Replace `scopeFlags` as primary tier evidence with an `ImpactEnvelope` and `IntentEnvelope`.
3. Keep path/tool/fingerprint leases, but treat them as enforcement containment, not tier justification.
4. Add objective impact floors for hard high-impact indicators.
5. Add exact null-impact certificates that can approve large cosmetic/doc batches as Tier 1.
6. Add intent alignment comparison between latest user request and planned received effect.
7. Return `proofDown` and `impact` details from `holmes_classify`.
8. Keep deterministic authority: model impact predictions can raise tiers and identify proof obligations, but cannot lower tiers without extension-observed proof.
9. Keep cumulative request ledgers to prevent slicing a high-impact change into low-impact-looking edits.
10. Invalidate impact proofs on effect drift, file-state drift, new downstream evidence, scope expansion, failed verification, or changed user intent.

## Bottom line

The tool design does not need to become a model-intelligence classifier. It needs a different deterministic target: **classify the predicted received effect of the finished work, then prove down only when impact is bounded, predictable, or null.**

Scope remains necessary to enforce leases. It is no longer sufficient to set tier. The classifier should be conservative where impact cannot be proven, but generous where null impact is concrete: high-impact one-line edits stay high, and broad cosmetic/doc changes can stay cheap when their zero functional effect is actually proven.
