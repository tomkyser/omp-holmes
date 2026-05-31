# Adversary Review Round 2: Four-Tier Prove-Down `holmes_classify`

## Position

The two changes move the design in the right direction. Starting at Tier 4 and proving down attacks the main flaw I identified in Round 1: absence of risk signals was being treated as evidence of safety. In a high-reliability gate, that burden was backwards.

However, prove-down only fixes the attack vectors if the "proof" is extension-owned, concrete, cumulative, and mostly mechanical. If the proof can be supplied by model prose — "this is simple," "single file," "no semantics changed," "unknowns resolved" — then the attack has merely moved from hiding escalation signals to manufacturing downgrade evidence.

My updated verdict is:

> **Prove-down + four tiers is robust enough as an enforcement architecture, but only if down-classification is based on positive, deterministic certificates. Tier 1 must require concrete non-semantic effect proof. Tier 2/3 must require cumulative bounded-scope proof. Tier 4 must have a fixed-point completion rule, not a vibe-based "loop as needed" rule.**

---

## 1. Does prove-down fix the top attack vectors?

### 1.1 Input laundering

**Mostly fixed conceptually; still vulnerable if the classifier accepts model-authored proof.**

Round 1 problem: the model could truthfully pass a narrow-looking planned envelope while hiding the semantic danger of the actual mutation. The original design mitigated this with scope/tool/path binding, but the classifier still had places where `operationKind`, `summary`, and absence of risk keywords could help it reach Tier 1.

Prove-down improves this because the model no longer wins by omitting risk signals. A downgrade now needs evidence.

The remaining adversarial move is to launder not the input, but the **proof**:

- `operationKind: "mechanical_code"`
- reasoning says "comment-only cleanup"
- target says "single file"
- planned action summary says "formatting"
- actual edit changes a condition, a validation rule, or an error path

That bypass is closed only if Tier 1 proof is derived from the pending mutation itself: normalized patch/diff, token/AST comparison, exact safe operator, or non-source text classification. The model's characterization of the edit must not count as proof.

**Required rule:** For Tier 1, the classifier/gate must prove from the concrete effect that the change is non-semantic. If the concrete effect is not available yet, or cannot be normalized, the work cannot step down to Tier 1.

### 1.2 Minimal reasoning / garbage input

**Fixed if prove-down is strict.**

Garbage input should produce no down-proof. Under the new model, no proof means the task stays at the current tier, ultimately Tier 4 unless lower-tier certificates are present.

This is a major improvement over the old framing. In the original design, minimal reasoning could still produce Tier 1 if the request looked single-file and no risk keywords appeared. Under prove-down, minimal reasoning should not certify:

- boundedness;
- absence of unresolved unknowns;
- non-semantic effect;
- same-module scope;
- completion of research/delegation;
- safety of opaque tools.

The implementation must be careful not to reintroduce the old behavior through checks like "no unknown flags detected" or "no tradeoff flags detected." Those are absence-of-signal checks. They are not positive proof.

**Required rule:** Low-information reasoning may still be allowed for objectively provable Tier 1 cases, such as a concrete doc typo edit or whitespace/comment-only patch. It must not prove Tier 2 or Tier 3 readiness by silence.

### 1.3 Keyword avoidance

**Fixed only if risk keywords are escalation evidence, never downgrade evidence.**

Prove-down directly addresses the keyword-avoidance attack. Avoiding words like `auth`, `crypto`, `migration`, `security`, `race`, `data loss`, or `architecture` should not help, because the classifier must prove the work belongs below Tier 4/3/2.

The trap is that a deterministic implementation may still implement prove-down as:

```text
if no Tier 4 keywords, step down to Tier 3
if no Tier 3 keywords, step down to Tier 2
if no Tier 2 keywords, step down to Tier 1
```

That would be prove-up in disguise.

**Required rule:** Each step-down predicate must name the concrete facts that certify the lower tier. "No risky term detected" can be used to block an otherwise eligible downgrade, but it cannot itself be part of the affirmative proof.

### 1.4 Sequential slicing

**Not fixed automatically. Slicing still works unless prove-down is cumulative across the user request.**

The new principle says every slice starts at Tier 4. That helps, but it is not sufficient.

A model can still attempt:

1. classify one helper edit as bounded;
2. mutate it;
3. classify the next helper edit as bounded;
4. mutate it;
5. repeat until a broad behavioral change is complete.

If each classification looks only at the next planned mutation, the attack survives. The proof must be about the **cumulative task**, not only the immediate slice.

The classifier should include, for the current user request:

- paths mentioned by the user;
- paths read/searched/found;
- paths already edited;
- prior classification scopes;
- blocked mutation attempts;
- assistant-visible broader intent;
- tool-log evidence of discovered dependencies;
- prior highest tier for overlapping or related work.

A later narrow call should inherit the cumulative scope. If the cumulative work is multi-file, cross-module, architectural, safety-sensitive, or uncertain, the next slice must not step down merely because the next edit is local.

**Required rule:** Step-down proof must certify the cumulative request scope. Per-call scope is insufficient.

---

## 2. New attack vectors introduced by prove-down

### 2.1 Manufactured positive proof of simplicity

This is the main new attack.

The old attack was hiding escalation signals. The new attack is fabricating downgrade certificates:

- "This is non-semantic" when code tokens change.
- "Single-scope" when the user asked for a feature spanning multiple surfaces.
- "Unknowns resolved" when no tool evidence supports the claim.
- "Tests cover it" when no verification has run.
- "Mechanical refactor" when public behavior changes.
- "No safety impact" when the classifier lacks domain knowledge.

The classifier must treat model-authored proof as untrusted data. It can be useful for routing and audit, but it cannot lower the tier unless independently checkable.

Acceptable proof sources:

- concrete pending mutation fingerprints;
- normalized diffs;
- AST/token equivalence checks;
- path/module extraction from user request, tool calls, and actual tool inputs;
- observed read/search/find results;
- recorded verification/delegation tool events;
- prior classification history;
- explicit user-request constraints when they narrow scope and do not contradict observed evidence.

Unacceptable proof sources:

- operation kind labels supplied by the model;
- summaries supplied by the model;
- unsupported claims in TARGET/NOW/DELTA/HOLMES text;
- absence of risky words;
- "I have resolved" statements without evidence references.

**Design implication:** Add `downProofs` to the classification record. Each step-down should store a machine-readable proof object with evidence references, not just rationale text.

### 2.2 Context pre-loading to make complex work look simple

A model can try to shape the observation state before classification:

- read only the file that makes the task look local;
- summarize broad intent as a small cleanup;
- announce a narrow target before calling the classifier;
- avoid reading files likely to reveal coupling;
- frame earlier broad discoveries as irrelevant;
- split exploration and mutation into separate-looking requests.

Prove-down is vulnerable if it treats current visible context as the whole world. It should instead treat selective context as incomplete unless the lower-tier proof is independent of completeness.

Examples:

- Tier 1 does not need whole-world knowledge if the concrete diff is comment-only or docs-only.
- Tier 2 may be certified for one bounded source edit only if the user request, cumulative tool log, and planned effect all agree on the same narrow scope.
- Tier 3 may be certified for a bounded full HOLMES pass only if the cumulative ledger does not show multi-scope expansion or unresolved blocking variables.
- Tier 4 should remain the default when the model has not gathered enough evidence to prove boundedness.

**Design implication:** The classifier needs a cumulative request ledger and a concept of evidence coverage. Selective lack of exploration must not become proof of simplicity.

### 2.3 False positives: everything gets stuck at Tier 4

This is a real risk, but it is the safe failure mode.

If prove-down requires positive proof and the implementation has no clear certificate vocabulary, many legitimate tasks will remain Tier 4 because the classifier cannot prove the negative properties it cares about:

- not architectural;
- not safety-critical;
- not cross-module;
- not semantically risky;
- no hidden dependencies.

The answer is not to weaken prove-down into absence-of-keywords logic. The answer is to define explicit downgrade certificates.

Suggested certificate shapes:

#### Tier 4 -> Tier 3 certificate

The classifier may step down from Tier 4 to Tier 3 only when it can positively establish all of:

- the user request has one coherent objective;
- cumulative scope is bounded to a known path set, module, or subsystem;
- planned tools are inspectable or exact-input-bound;
- no prior classification/tool-log evidence in this user request shows scope expansion beyond that boundary;
- the work can be represented as one full HOLMES pass with explicit unknown tracking;
- the scope is not in a hard-coded always-Tier-4 class such as safety-critical infrastructure, broad architecture, cross-system data migration, deployment/release control, or unresolved incident response.

The last bullet still has an absence component. To keep the prove-down promise honest, it should be implemented as an allowlist of Tier-3-eligible operation/scope patterns plus hard Tier-4 triggers, not as mere absence of Tier-4 words.

#### Tier 3 -> Tier 2 certificate

The classifier may step down from Tier 3 to Tier 2 only when it can positively establish all of:

- one local scope or single module;
- explicit concrete path set;
- no research/delegation need is visible in user request, model reasoning, or tool log;
- no unresolved variables are listed or implied by observed evidence;
- mutation count is small and bounded;
- planned tools are structured direct mutation tools, not opaque execution;
- the task is a bounded implementation/edit decision, not an open design investigation.

#### Tier 2 -> Tier 1 certificate

The classifier may step down from Tier 2 to Tier 1 only when it can prove the concrete effect is non-semantic:

- comments only;
- whitespace/formatting only with unchanged tokens/AST semantics;
- typo in non-code text;
- documentation prose change that does not alter commands, API contracts, safety instructions, or executable snippets;
- exact safe operator from a closed allowlist.

No ordinary source-code token change should reach Tier 1.

### 2.4 Over-escalation of legitimate simple work

Yes, prove-down will over-escalate if the certificates are too narrow or unavailable at classification time.

That is acceptable for safety but dangerous for adoption if it creates constant HOLMES fatigue. The right calibration is:

- keep Tier 1 very narrow and easy to certify from concrete effects;
- make Tier 2 the normal path for bounded source-code edits;
- use Tier 3 for bounded but uncertain/full-reasoning work;
- reserve Tier 4 for work that cannot prove boundedness, spans scopes, touches safety-critical surfaces, or keeps discovering new unknowns.

The design should not try to make Tier 1 pleasant by allowing "simple code edits." That is where the dangerous one-line semantic changes live. The ergonomic release valve should be Tier 2, not a wider Tier 1.

---

## 3. Four-tier edge cases

### 3.1 Boundary between Tier 3 and Tier 4

The new hard boundary is not "hard vs very hard." It is:

- **Tier 3:** one bounded HOLMES pass is enough to produce an evidence-backed synthesis for a concrete scope.
- **Tier 4:** the task may require re-entering HOLMES because scope, evidence, unknowns, or verification results can materially change the plan.

Tier 4 should be selected when any of these are true:

- multi-scope or cross-subsystem work;
- architectural/API design with durable downstream consequences;
- safety/security/auth/crypto/data/deployment/migration surfaces;
- incident/debugging work where root cause is unknown;
- broad user request such as "fix," "refactor," "make robust," or "audit";
- incomplete or conflicting requirements;
- planned delegation/research may change the scope;
- prior tool results contradicted the current plan;
- failed verification requires re-analysis;
- cumulative slicing indicates the work is larger than the next edit.

Tier 3 is appropriate when the classifier can prove the target is bounded and a single full pass can close the loop: Hone, Observe, Ladder, Map, Establish, Synthesize, then execute within the synthesized scope.

### 3.2 Can the model game the Tier 3/4 boundary?

Yes. The model can try to declare:

- "single subsystem" while hiding cross-subsystem effects;
- "all unknowns resolved" without evidence;
- "one pass is enough" before research;
- "bounded scope" after reading only a narrow subset;
- "not safety-critical" because no risky words appear.

Defenses:

1. **Cumulative scope ledger.** A Tier 3 downgrade must account for all paths, tools, reads, blocked mutations, prior classifications, and visible broader intent in the current user request.
2. **Evidence-bound unknown closure.** Unknowns can be marked resolved only with observed evidence references or a clear non-blocking rationale tied to the target.
3. **Reclassification on scope expansion.** If a Tier 3 pass discovers new files/modules, contradicts assumptions, or broadens the target, the next mutation should block until Tier 4 classification or a new down-proof exists.
4. **Tier 4 hard triggers.** Certain surfaces and request forms should be Tier 4 unless a narrowly defined certificate applies. Safety-critical and architectural work should not be downgraded by prose.
5. **No unlimited mutation lease.** Tier 4 looping does not mean unlimited mutation authority. Each mutation still needs concrete scope coverage and satisfied current-loop requirements.

### 3.3 Does Tier 4 need a completion condition?

Yes. "Unlimited" must mean **no artificial pass cap**, not "continue forever" and not "stop whenever the model feels done."

Tier 4 needs a fixed-point completion condition:

A Tier 4 task is ready to mutate or finish only when a HOLMES pass synthesizes a concrete plan and all of the following are true:

- every blocking unknown in the Map is resolved with evidence or explicitly made non-blocking with justification;
- Establish did not add new blocking variables;
- the synthesized scope matches the cumulative request ledger;
- planned mutations are covered by concrete path/tool/effect envelopes;
- no observed evidence contradicts the current synthesis;
- required research/delegation/verification evidence is present;
- if verification fails or new scope appears, the task re-enters HOLMES instead of proceeding on the stale synthesis.

Without this condition, Tier 4 creates two opposite failure modes:

- **livelock:** the model keeps looping because there is no definition of done;
- **ceremony bypass:** the model performs one verbose loop and calls it "unlimited" without actually resolving changed unknowns.

### 3.4 Tier 3 after a failed single pass

The design needs an explicit rule for Tier 3 failure.

If a Tier 3 full pass reveals a blocking unknown, scope expansion, conflicting evidence, or failed verification, the task should promote to Tier 4. A second Tier 3 pass is Tier 4 in practice. The classifier should not allow repeated "single pass" records for the same user request to simulate unlimited looping while avoiding Tier 4 requirements.

---

## 4. What needs to change in the tool design

### 4.1 Update core types for four tiers

`HolmesTier` must become `1 | 2 | 3 | 4`.

Requirements should distinguish Tier 3 and Tier 4:

- Tier 1: `NONE`.
- Tier 2: `TARGET_DELTA_BLOCK` / bounded checkpoint.
- Tier 3: `FULL_HOLMES_SINGLE_PASS`, `RESOLVE_UNKNOWNS` for that pass, research/delegation if required by known bounded scope.
- Tier 4: `HOLMES_LOOP_UNTIL_FIXED_POINT`, `REENTER_ON_NEW_UNKNOWNS`, `EVIDENCE_BOUND_SYNTHESIS`, `RESEARCH_DELEGATION_AS_NEEDED`, `VERIFY_AND_REENTER_ON_FAILURE`.

### 4.2 Replace trigger-based classification with proof-chain classification

The old pseudocode still has trigger-based logic:

- Tier 3 signals first;
- Tier 2 signals second;
- Tier 1 candidate based partly on absence of flags;
- unknown/unclassifiable defaults to Tier 3.

The new design should look structurally like:

```ts
let tier: HolmesTier = 4;
const proofs: DownProof[] = [];

const t3Proof = proveEligibleForTier3(snapshot, cumulativeLedger, pendingEffect);
if (t3Proof.ok) {
  tier = 3;
  proofs.push(t3Proof);

  const t2Proof = proveEligibleForTier2(snapshot, cumulativeLedger, pendingEffect);
  if (t2Proof.ok) {
    tier = 2;
    proofs.push(t2Proof);

    const t1Proof = proveEligibleForTier1(snapshot, cumulativeLedger, pendingEffect);
    if (t1Proof.ok) {
      tier = 1;
      proofs.push(t1Proof);
    }
  }
}

const finalTier = maxTier(params.proposedTier, tier);
```

The important property is not this exact code shape. The important property is that every downgrade returns a positive proof object. Failed proof does not need a risky keyword; failed proof simply stops the descent.

### 4.3 Add machine-readable down-proof records

The record should store more than `signals` and `rationale`.

Add something like:

```ts
interface DownProof {
  fromTier: HolmesTier;
  toTier: HolmesTier;
  certificate: string;
  evidenceRefs: EvidenceRef[];
  invalidatesOn: InvalidationReason[];
}
```

Examples:

- `CONCRETE_NON_SEMANTIC_DIFF`
- `SINGLE_BOUNDED_MODULE_SCOPE`
- `EXPLICIT_PATH_SET_AND_STRUCTURED_TOOLS`
- `FULL_PASS_UNKNOWN_LEDGER_CLOSED`
- `CUMULATIVE_SCOPE_UNCHANGED`

The gate should be able to explain and validate why a lower tier was allowed.

### 4.4 Bind proofs to concrete effects and file state

Round 1's file-state concern becomes more important under prove-down.

A downgrade proof can go stale if:

- the pending edit payload changes;
- an edit anchor hash changes;
- a full-file write target drifts;
- an `ast_edit` match set changes;
- an opaque command/code string changes;
- prior reads are no longer representative of the file state;
- new tool results broaden the path set.

For Tier 1, exact effect binding is mandatory. For Tier 2/3/4, concrete scope and tool binding remain mandatory. Lower-tier proofs should expire on file-state drift when the proof depends on file content.

### 4.5 Make cumulative scope first-class

The original design mentions tool-log paths and monotonic overlapping classifications. Prove-down needs a stronger version.

Add a current-user-request ledger containing:

- all path mentions from user, assistant, classifier params, and tool calls;
- all read/search/find targets;
- all mutation attempts, allowed and blocked;
- all prior classification scopes and tiers;
- all observed broader-scope announcements;
- operation classes and tools attempted;
- verification failures and newly discovered unknowns.

Down-proof functions must consume this ledger. A proof over only `plannedActions` is not sufficient.

### 4.6 Do not make Tier 4 an unlimited broad lease

Tier 4 should allow unlimited HOLMES looping, not unlimited mutation.

A Tier 4 record may authorize research/delegation and analysis. Mutation should still require a current synthesized concrete envelope. If the scope is not concrete, the Tier 4 envelope should be `blocked` for mutation until the loop produces one.

This preserves the useful distinction:

- Tier 4 permits repeated analysis/research/re-entry without artificial pass limits.
- The mutation gate still enforces concrete effect coverage.

### 4.7 Add adversarial tests specific to prove-down

The test suite should include:

1. model labels a code-token behavior change as mechanical; must not reach Tier 1;
2. minimal reasoning with one source edit; must not reach Tier 1 unless concrete diff is non-semantic;
3. keyword-avoiding auth/validation change; must stay Tier 3/4 depending on scope;
4. repeated narrow classifications under one broad user request; cumulative tier must escalate/stay high;
5. manufactured "unknowns resolved" without evidence refs; downgrade rejected;
6. preloaded narrow context after broad request; downgrade rejected unless cumulative ledger is bounded;
7. Tier 3 pass discovers new blocking unknown; must promote to Tier 4;
8. Tier 4 loop reaches fixed point with concrete scope; mutation allowed only inside synthesized envelope;
9. file drift invalidates a previously valid down-proof;
10. opaque tool exact hash mismatch blocks even under Tier 4.

---

## 5. Is prove-down implementable deterministically?

**Yes, if the deterministic system is allowed to be conservative. No, if it is expected to recognize arbitrary semantic simplicity.**

A deterministic classifier can safely implement prove-down for objective certificates:

- path count and scope extraction;
- tool class and exact input hashing;
- concrete diff fingerprinting;
- comment/whitespace/docs-only checks;
- AST/token equivalence for limited languages;
- cumulative ledger matching;
- required-visible-block detection;
- evidence-reference presence;
- mutation budget and freshness checks.

A deterministic classifier cannot generally prove that an arbitrary code edit is semantically safe, that a helper is not part of a safety-critical path, or that one pass of reasoning is sufficient for every bounded-looking task. For those cases, the safe deterministic answer is simply "not proven down," which leaves the task at the higher tier.

If the product goal is to down-classify more ambiguous code work for ergonomics, that requires either:

- model intelligence acting as advisory evidence, with the gate still conservative;
- richer static analysis and semantic diff tooling;
- repository-specific policy maps for safety-critical paths and low-risk areas;
- user-authored trust annotations.

But the core safety property should not depend on model intelligence. Model analysis may raise tiers, explain work, and satisfy Tier 2/3/4 process requirements with evidence. It should not be the authority that proves a downgrade.

---

## 6. Updated verdict

**Prove-down plus four tiers is strong enough to be the right architecture. It is not automatically robust just because the burden is inverted.**

The change fixes the biggest conceptual leak in Round 1: a task no longer becomes cheap merely because risk signals are absent. It also gives the hardest work a better home. The old Tier 3 was overloaded; splitting "one full HOLMES pass" from "loop until unknowns close" is the right shape.

The remaining critical risk is proof forgery. If the model can manufacture the positive evidence used to step down, the system is still gameable. The defense is to make every downgrade depend on extension-observed, concrete, cumulative facts.

### Accept with these required conditions

1. **Tier 1 is provably non-semantic only.** No ordinary source-code behavior change, however small, reaches Tier 1.
2. **Every step-down emits a positive proof object.** Absence of flags is never proof.
3. **Proofs are evidence-bound.** Unsupported model prose cannot lower the tier.
4. **Scope is cumulative per user request.** Sequential slicing cannot reset complexity.
5. **Tier 3/4 boundary has promotion rules.** A failed or scope-expanding Tier 3 pass becomes Tier 4.
6. **Tier 4 has a fixed-point completion condition.** Unlimited means no artificial cap, not no definition of done.
7. **Mutation authority remains concrete.** Even Tier 4 does not grant broad mutation permission without current path/tool/effect coverage.
8. **File/effect freshness invalidates proofs.** A proof tied to a diff, anchor, match set, or observed file state must expire when that state changes.

With those constraints, the design becomes a conservative enforcement system rather than a heuristic classifier. That is the right target. The goal is not to perfectly infer model intent; it is to make unsafe under-classification structurally hard, auditable, and biased toward more reasoning when proof is missing.
