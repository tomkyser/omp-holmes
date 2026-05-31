# UX & latency review: Round 3 — impact/outcome reframing

## Verdict

Tom's reframing is the right product-level target. The classifier should not optimize for the smallest-looking edit, the fewest files, or the cleanest keyword scan. It should optimize for the user's experienced outcome: what changes in the finished product, how predictable that change is, what downstream behavior it affects, and how costly the classifier's own friction is.

That changes the UX contract in three ways:

1. **Tier labels must explain impact, not ceremony.** Users should see why the finished product is expected to be cosmetic, bounded, analysis-worthy, or cascading.
2. **Tier 1 should become narrower, not wider.** A source-code behavior change that is “one line” is not Tier 1 just because it is small. Tier 1 is for provably non-behavioral effects. Tier 2 should absorb most bounded code edits with very low visible ceremony.
3. **The classifier must render missing proof as impact uncertainty.** “Could not prove Tier 1” should not feel like arbitrary bureaucracy; it should mean “HOLMES cannot prove this will be only cosmetic.”

The largest UX risk is over-escalation. Impact framing makes it harder to prove zero impact, so many code changes naturally move from Tier 1 to Tier 2. That is acceptable only if Tier 2 is genuinely lightweight and if Tier 3/Tier 4 are reserved for unpredictability, propagation, safety-critical surfaces, or unresolved unknowns. If the product makes Tier 2 feel like a penalty, users will experience the reframing as “HOLMES escalates everything.” If Tier 2 feels like a compact outcome check, the reframing improves trust.

---

## 1. “How the user receives the finished product”

### What this means for classifier UX

The classifier's user-facing job is not to say “this task looks small.” It is to answer:

```text
When this work is finished, what will be different for the user or downstream system?
How predictable is that difference?
What happens if that prediction is wrong?
How much friction am I imposing by requiring more reasoning before mutation?
```

That is a stronger UX model than risk/scope labeling. Scope is still useful evidence, but it is not the thing the user cares about. The user receives outcomes:

- the typo is fixed and nothing else changes;
- the guard now accepts/rejects a case differently;
- authentication, persistence, deployment, or migration behavior may change;
- the agent pauses to reason before editing;
- the agent blocks a mutation and asks for proof;
- the agent emits enough progress to justify delayed mutation.

The classifier therefore needs to make the finished-product consequence visible in compact language. It should prefer statements like:

```text
HOLMES Tier 2 · bounded behavior change: one validation branch changes for src/guards.ts
```

rather than:

```text
HOLMES Tier 2 · one file, behavior_change operation kind
```

The first describes what the user receives. The second describes classifier internals.

### Under-classification as a UX failure

If HOLMES lets a risky change through at Tier 1 and it is wrong, the user experiences more than a bad tier label. They experience:

- the model acted confidently without visible reasoning;
- the finished product changed behavior the user did not expect;
- verification may have been skipped or underspecified;
- debugging later is harder because the classification record implied the change was cosmetic;
- trust shifts from “HOLMES protects me” to “HOLMES rubber-stamps small-looking edits.”

This is especially damaging because Tier 1 is meant to be near-invisible. A wrong Tier 1 hides both the failure and the absence of process. A one-line semantic edit under Tier 1 is not merely under-classified; it is a UX lie about the finished product.

Required UX rule:

> Tier 1 must communicate and enforce “no behavioral effect,” not “small edit.” If the classifier cannot prove that, it should not use Tier 1.

### Over-classification as a UX failure

If HOLMES escalates a trivial change to Tier 4, the user experiences a different failure:

- the model appears blocked by ceremony rather than helped by safety;
- simple requests feel slower and less direct;
- users learn to phrase around HOLMES or disable it;
- trust erodes because the classifier appears unable to distinguish typo fixes from dangerous work;
- the finished product may still be correct, but the interaction feels wasteful.

Over-classification is not harmless. It is a product impact because it changes user behavior around the safety system. The right response is not to weaken Tier 1. The right response is to make lower-impact proof paths efficient and to make Tier 2 cheap enough that “not cosmetic” does not feel like a major escalation.

### Impact of the classifier decision itself

The classifier's output is part of the finished product. It changes what the agent does next and how the user interprets that behavior.

A good classification result should give the user four things without exposing private reasoning:

1. **Impact level** — cosmetic, bounded, analysis-needed, cascading/unpredictable.
2. **Impact target** — what behavior, artifact, or user-visible surface changes.
3. **Predictability** — why the outcome is or is not foreseeable from current evidence.
4. **Next obligation** — what the agent must do before mutation.

For example:

```text
HOLMES Tier 3 · impact needs analysis: request says “fix typo,” but planned edit changes source behavior in auth/session.ts. One HOLMES pass required before mutation.
```

That is not bureaucracy language. It explains the mismatch between user intent and expected finished-product effect.

---

## 2. Impact-based tier descriptions, user-facing

The proposed descriptions are directionally right, but they need two refinements for user clarity:

1. **Say “system/product behavior,” not simply “observable effect.”** Documentation typo fixes are observable to a reader, but they do not alter runtime behavior. Users will be confused if Tier 1 says “no observable effect” while the visible prose changes.
2. **Make predictability and propagation explicit.** The difference between Tier 2, Tier 3, and Tier 4 is not just size; it is whether the outcome can be foreseen and bounded from available evidence.

### Recommended user-facing tier language

#### Tier 1 — cosmetic / non-behavioral

```text
Tier 1: Cosmetic impact. HOLMES can prove this change does not alter system behavior: prose typo, comment-only, whitespace-only, or another exact non-semantic edit.
```

This works better than “no observable effect on system behavior” alone because it handles visible documentation changes without implying nothing changes at all.

What users should understand:

- The finished product may look different in text or formatting.
- Runtime/product behavior is unchanged.
- No TARGET/DELTA or HOLMES pass is needed.
- The proof is concrete, not based on confidence or small scope.

Bad Tier 1 examples:

- changing `if (!user.isAdmin)` to `if (user.isAdmin)`;
- changing a timeout value;
- changing a test expectation;
- changing config or prompt/rule/hook behavior;
- source-token edits that lack semantic-equivalence proof.

Even if each is one line, the finished-product impact can be behavioral.

#### Tier 2 — bounded / predictable behavior

```text
Tier 2: Bounded impact. This changes behavior in a predictable, local way; HOLMES can state the intended outcome and the contained delta before editing.
```

This should be the normal tier for small code edits. It must not feel like a heavy penalty for “any behavior changed.”

What users should understand:

- The finished product behaves differently in a known place.
- The change is bounded to a concrete scope.
- The agent must say TARGET and DELTA before mutation.
- No full HOLMES pass is required because relevant facts and scope are already known.

Example rendering:

```text
HOLMES Tier 2 · bounded impact: validation behavior changes in src/guards.ts · TARGET/DELTA required
```

#### Tier 3 — analysis-needed / bounded uncertainty

```text
Tier 3: Impact needs analysis. The change may affect behavior beyond the obvious edit, but the scope appears bounded enough for one structured HOLMES pass to close the unknowns.
```

This is clear if the renderer explains the missing proof:

```text
HOLMES Tier 3 · impact needs analysis: two callers may observe the changed return behavior; one HOLMES pass required.
```

What users should understand:

- The user-visible or downstream effect is not fully predictable yet.
- The scope is not open-ended enough for Tier 4.
- One complete structured pass should turn uncertainty into a concrete edit plan.
- If that pass expands scope or finds blockers, the work promotes to Tier 4.

#### Tier 4 — cascading / unpredictable / iterative

```text
Tier 4: Potentially cascading impact. The outcome may propagate across systems, safety-critical surfaces, architecture, data, deployment, or unresolved unknowns; HOLMES must iterate until the impact is understood and bounded.
```

This description works because it explains why the process is iterative. The user is not waiting because the edit is “large”; they are waiting because the finished-product consequence is not yet bounded.

Example rendering:

```text
HOLMES Tier 4 · cascading impact possible: auth/session behavior, persistence, and migration path may all be affected. Iterative HOLMES required before mutation.
```

### Do the descriptions explain why the tier was assigned?

They work only if paired with a concrete “because” clause. Tier names alone are not enough.

Bad:

```text
HOLMES assessed Tier 3: impact needs analysis.
```

Good:

```text
HOLMES assessed Tier 3 · impact needs analysis because the planned edit changes source behavior and the current callers have not been bounded.
```

Best compact pattern:

```text
HOLMES Tier N · <impact class>: <what changes or may change> · <next obligation>
```

Examples:

```text
HOLMES Tier 1 · cosmetic impact: documentation typo only
HOLMES Tier 2 · bounded impact: one parser branch changes for invalid input · TARGET/DELTA required
HOLMES Tier 3 · impact needs analysis: return-value change may affect multiple callers · one HOLMES pass required
HOLMES Tier 4 · cascading impact possible: migration and persisted data semantics are unresolved · iterative HOLMES required
```

---

## 3. Over-escalation in impact framing

### Yes: impact framing makes Tier 1 harder to earn

This is expected and desirable. If Tier 1 means “no behavioral effect,” then most source-code edits cannot be Tier 1. That is not over-escalation; it is honest classification.

The dangerous UX mistake would be treating “not Tier 1” as “high risk.” A code edit with some behavioral effect can still be low-friction when its impact is predictable and local. That is Tier 2.

The product should normalize this:

```text
Tier 1 = cosmetic/non-behavioral
Tier 2 = normal bounded code change
Tier 3 = bounded but uncertain impact
Tier 4 = cascading or unpredictable impact
```

Under that framing, “everything code is Tier 2+” is not a failure. The failure would be “everything code is Tier 3+.”

### Tier 1 should be explicitly non-behavioral

I recommend making Tier 1 effectively closed-set:

- non-code prose typo;
- comment-only edit;
- whitespace/formatting-only edit with semantic equivalence where source code is involved;
- documentation formatting or wording that does not alter commands, API contracts, safety instructions, executable examples, or configuration guidance;
- exact known-safe transformations with parser/schema support.

Do not call ordinary source-code changes Tier 1. “One line” and “obvious” are not impact proofs.

This will reduce Tier 1 frequency for code, but it improves user trust. Tier 1 becomes meaningful: when HOLMES says Tier 1, the user can believe the finished product will not behave differently.

### Tier 2 should be the ergonomic baseline for code

Tier 2 is the release valve. It should be:

- one compact visible checkpoint;
- no full HOLMES transcript;
- no repeated phases;
- no progress renderer;
- direct path from classification to TARGET/DELTA to mutation.

Recommended Tier 2 output shape:

```text
HOLMES Tier 2 · bounded impact: <behavior/effect> in <scope>
TARGET: <finished-product outcome>
DELTA: <specific contained change>
```

Optional `NOW` is useful when the agent has observed current behavior and the claim matters. It should not be mandatory for every Tier 2 case if that turns Tier 2 into hidden Tier 3.

### The key threshold is Tier 2 → Tier 3, not Tier 1 → Tier 2

Impact framing should shift product attention from “why did my code edit not get Tier 1?” to “why does this need a full reasoning pass?”

Tier 2 → Tier 3 should require one or more of:

- current behavior or caller impact is not known;
- user intent and planned edit do not obviously match;
- multiple files/callers/surfaces may observe the change;
- the edit is in unfamiliar code where the outcome cannot be predicted from current evidence;
- the model has stated assumptions or unknowns that affect mutation;
- the change alters tests, contracts, prompts/rules/hooks, config, or generated behavior in a way that needs evidence;
- verification strategy is not obvious for the affected behavior.

Tier 3 → Tier 4 should require even stronger uncertainty or propagation:

- cascading impact across subsystems;
- security/auth/crypto/data/deployment/migration/safety-critical surfaces;
- architecture/public API changes;
- unknown root cause debugging;
- broad user request shape;
- one HOLMES pass discovers new blockers;
- scope keeps expanding;
- impact depends on external research, delegation, or user decision.

### Avoiding the “any effect means escalation” trap

Impact is not binary. The classifier should evaluate at least these dimensions:

| Dimension | Low-impact signal | High-impact signal |
| --- | --- | --- |
| Behavioral effect | None or exact non-semantic | Runtime/product behavior changes |
| Predictability | Outcome follows directly from observed facts | Outcome depends on unknown callers/data/environment |
| Propagation | One local surface | Cross-module, cross-system, persisted, public API |
| Reversibility | Easy localized correction | Data migration, release/deploy, persisted state, irreversible side effects |
| User harm if wrong | Cosmetic annoyance | Access control, data loss, money, safety, downtime |
| Verification | Direct targeted check | Complex integration/e2e/manual/domain validation needed |
| Intent alignment | Request and planned edit match | User asked “typo” but edit changes behavior |
| Evidence confidence | Concrete observed facts | Model assumptions, missing proof, unknown file semantics |

Tiering should be based on these dimensions, not on whether “some behavior changes.” Tier 2 is specifically for behavior changes whose dimensions remain low and bounded.

### Minimal read-only preflight remains important

Impact framing makes read-only preflight more valuable, not less. Many apparent Tier 3 cases can be proven Tier 2 by a small amount of observation before classification:

- identify the exact file and current branch;
- confirm the request targets one local function;
- confirm the file is documentation, not executable config;
- confirm a planned rename is comment/prose only;
- bound callers or tests when a return value changes.

The classifier UX should encourage this path:

```text
If the request is plausibly simple but impact is not yet provable, gather minimal read-only evidence before classification. Do not mutate before classification.
```

The user should experience that as the agent quickly aligning on outcome, not as a failed escalation.

---

## 4. The classifier's own impact

### Balancing over-classification and under-classification

The two failure modes are asymmetric per event but both matter systemically.

Under-classification can directly produce unreviewed risky changes. It is the worse single-event failure because it can lead to silent behavior changes, security holes, data loss, or bad releases.

Over-classification produces adoption failure. It is a cumulative failure: if users repeatedly experience HOLMES as arbitrary friction, they will work around it, disable it, or stop trusting its judgments. That eventually recreates the under-classification risk at the product level because the safety system is no longer used.

The correct balance is:

1. **Keep hard safety floors conservative.** Do not widen Tier 1 to reduce friction.
2. **Make Tier 2 cheap and common.** Use it as the normal path for bounded source changes.
3. **Make escalation reasons specific.** Users tolerate friction when they understand what impact uncertainty is being resolved.
4. **Instrument false positives and false negatives separately.** Over-escalation should be tuned by better proof paths and rendering, not by weakening safety claims.
5. **Fail closed on missing proof, but explain the missing proof.** The UX difference between “Tier 4” and “Tier 4 because migration impact is unresolved” is large.

### Confidence in its own impact assessment

Yes, the classifier should carry a confidence signal, but it should be carefully named and used.

The useful confidence is not “how sure the model feels.” It is:

```text
How strong is the evidence that the impact has been correctly bounded?
```

Recommended internal fields:

```ts
impactAssessment: {
  level: "cosmetic" | "bounded" | "analysis_needed" | "cascading_possible";
  behaviorEffect: "none" | "bounded" | "uncertain" | "broad";
  predictability: "high" | "medium" | "low";
  propagation: "none" | "local" | "multi_surface" | "unknown";
  userFailureMode: string;
  evidenceStrength: "concrete" | "observed" | "claimed" | "missing";
  missingProof: string[];
}
```

User-facing confidence should be rendered only when it changes the user's next action. For example:

```text
HOLMES Tier 3 · impact confidence low: callers of the changed return value are not bounded yet. One HOLMES pass required.
```

Avoid noisy confidence badges for Tier 1/Tier 2 when the reason is already clear. “Low confidence” can sound like vague model uncertainty; “could not prove caller impact is bounded” is better.

### Confidence should affect down-classification

Low confidence in impact assessment should prevent step-down. It should not merely annotate a low tier.

Examples:

- If the classifier has concrete proof of comment-only edit, confidence is high enough for Tier 1.
- If the classifier sees one source edit but no current behavior facts, Tier 2 may still be possible if the requested outcome and scope are explicit; otherwise Tier 3.
- If the classifier cannot determine whether config affects deployment, it should stay Tier 4 or Tier 3 depending on policy and scope.
- If a Tier 3 pass discovers new unknowns, the confidence in one-pass sufficiency drops; promote to Tier 4.

This turns confidence into an enforcement property, not a decorative probability.

### The classifier should optimize expected user impact, not user comfort

The user may prefer no friction in the moment. The classifier should still prevent low-proof mutation when the finished-product consequence is uncertain. But it should spend its UX budget carefully:

- no ceremony for proven cosmetic work;
- compact checkpoint for bounded behavior;
- structured progress for real uncertainty;
- iterative progress only for cascading/unpredictable impact.

That is how HOLMES avoids both disabling-level friction and rubber-stamp safety theater.

---

## 5. Rendering impact to the user

### What the tool result should show

The tool result should show impact assessment by default, but in a tier-appropriate amount.

Default fields:

1. **Final tier** — authoritative process level.
2. **Impact class** — cosmetic, bounded, analysis-needed, cascading possible.
3. **What changes** — in finished-product terms.
4. **Why this tier** — proof or missing proof.
5. **Next obligation** — none, TARGET/DELTA, one HOLMES pass, iterative HOLMES.
6. **Approved scope** — path/tool/effect envelope, compact.

Expandable/audit fields:

- proof-down ladder;
- evidence references;
- missing proof obligations;
- impact dimensions;
- cumulative scope ledger summary;
- confidence/evidence strength;
- invalidation rules.

Do not show every proof-down step by default. That would make Tier 1 and Tier 2 feel bureaucratic. Default rendering should answer the user's likely question: “Why am I seeing this, and what happens next?”

### Tier-specific rendering

#### Tier 1

Keep it collapsed:

```text
HOLMES Tier 1 · cosmetic impact: documentation typo only
```

or:

```text
HOLMES checked · Tier 1 · no behavior change
```

Do not show “what could go wrong” by default for Tier 1. If the classifier has enough proof for Tier 1, foregrounding hypothetical risk undermines the meaning of the tier.

#### Tier 2

Show the bounded effect and require a short checkpoint:

```text
HOLMES Tier 2 · bounded impact: invalid email branch changes in src/validators.ts
TARGET: Reject malformed email input with the existing validation error.
DELTA: Change only the local email predicate; preserve existing error shape and callers.
```

This tells the user what the finished product will do differently and constrains the edit.

#### Tier 3

Show missing impact proof and the single-pass requirement:

```text
HOLMES Tier 3 · impact needs analysis: return behavior may affect multiple callers.
Could not prove Tier 2: caller set and current behavior are not bounded yet.
Next: one HOLMES pass to observe callers, close unknowns, and synthesize a scoped edit plan.
```

The user should see uncertainty being resolved, not a generic “risk” label.

#### Tier 4

Show cascading surface, blockers, and progress contract:

```text
HOLMES Tier 4 · cascading impact possible: auth/session behavior, persistence, and migration path may all be affected.
Open blockers: existing-token migration, session invalidation semantics.
Next: iterative HOLMES until blockers close and a concrete mutation scope is synthesized.
```

After each pass, show state change:

```text
Tier 4 progress · Pass 1 complete
Resolved: affected persistence paths bounded to src/auth/session-store.ts.
Remaining: existing-token migration behavior.
Next: inspect migration tests before mutation.
```

This is the key latency UX: users tolerate delay when each pass changes the impact ledger.

### Raised-tier rendering

Raised tiers are especially important under impact framing because the mismatch often reveals the problem.

Examples:

```text
HOLMES raised Tier 1 → Tier 3 · request says “fix typo,” but the planned edit changes source behavior in auth/session.ts. Impact needs analysis before mutation.
```

```text
HOLMES raised Tier 2 → Tier 4 · bounded delta was proposed, but the cumulative request spans schema migration and persisted data behavior.
```

This should be neutral, not accusatory. The classifier is aligning user intent with finished-product effect.

### Should rendering include “what could go wrong”?

Yes for Tier 2+ when it is concise and specific. No for every Tier 1 result.

The phrase “what could go wrong” should be framed as user-visible failure mode:

- “wrong users may be accepted/rejected”;
- “existing sessions may be invalidated”;
- “migration may corrupt persisted state”;
- “test change may mask a regression”;
- “deployment config may stall jobs.”

Avoid generic scary text:

```text
This could be risky.
```

Prefer concrete outcome text:

```text
Failure mode if wrong: valid users may be denied login.
```

### Should rendering include what the user will experience?

Yes, but only where it clarifies impact. Good rendering describes the finished product from the receiving side:

```text
User-visible effect: invalid invite links will show the existing expired-link message instead of a generic error.
```

or:

```text
Downstream effect: existing sessions may need migration before the new token format is accepted.
```

This is the UX translation of Tom's reframing. It moves the classifier from syntax/scope to outcome.

### Recommended tool-result shape

```text
HOLMES Tier <n> · <impact class>: <finished-product effect>
Because: <proof or missing proof in one sentence>
Next: <required process before mutation>
Scope: <paths/tools/mutation envelope>
```

Examples:

```text
HOLMES Tier 1 · cosmetic impact: README typo only
Because: planned edit is non-code prose and cannot alter system behavior.
Scope: edit README.md only
```

```text
HOLMES Tier 2 · bounded impact: one validation branch changes in src/guards.ts
Because: effect is local and predictable, but runtime behavior changes so Tier 1 is not valid.
Next: TARGET/DELTA before mutation
Scope: edit src/guards.ts only
```

```text
HOLMES Tier 3 · impact needs analysis: changed return behavior may affect callers
Because: caller impact is not bounded from current evidence.
Next: one HOLMES pass before mutation
Scope: blocked until pass synthesizes explicit paths
```

```text
HOLMES Tier 4 · cascading impact possible: migration may affect persisted user records
Because: data shape, migration path, and rollback behavior are unresolved.
Next: iterative HOLMES until blockers close
Scope: mutation blocked until concrete synthesis
```

---

## 6. The “autocomplete vs outcome” UX

### Reframe HOLMES as outcome alignment

Without HOLMES, the model's natural UX is speed: infer the next plausible action and edit. That feels good when the inference is right and dangerous when the inference is subtly wrong.

With HOLMES, the intended UX is not “wait for bureaucracy.” It is:

```text
Before changing the world, check what the finished world will look like.
```

The visible language should reinforce that. Avoid process-first phrasing:

```text
FULL_HOLMES_LOOP required.
```

Prefer outcome-first phrasing:

```text
Impact not bounded yet: one HOLMES pass required before editing.
```

The process exists because impact is uncertain, not because a rule demands headings.

### The classifier should redirect both model and user attention

The model should be pushed from:

```text
What edit comes next?
```

to:

```text
What will the user receive when this is done, and what could this affect?
```

The user should see the same redirect in the tool result:

- Tier 1: “this only changes presentation/prose; behavior unchanged.”
- Tier 2: “this changes behavior locally; here is the intended outcome.”
- Tier 3: “the outcome may affect more than the edit site; HOLMES is bounding it.”
- Tier 4: “the outcome can cascade; HOLMES is iterating until the impact is understood.”

This makes HOLMES legible as quality control over outcomes, not a compliance ritual.

### Behavior matters more than wording

The UX value proposition will fail if rendering says “outcome alignment” but behavior still feels like generic delays. The implementation must behave consistently:

- Use minimal read-only evidence before classification when that can avoid unnecessary escalation.
- Keep Tier 1 near-invisible.
- Keep Tier 2 compact and common for bounded code changes.
- Make Tier 3 visibly close specific unknowns in one pass.
- Make Tier 4 progress show blocker reduction after each pass.
- Fail closed with a specific missing-impact-proof reason when the loop cannot converge.

The user should be able to tell what safety work was purchased by the delay.

### Latency framing

Do not promise duration. Enforce latency through output shape and process boundaries:

| Tier | UX latency budget by shape |
| --- | --- |
| Tier 1 | One collapsed line; no visible reasoning block. |
| Tier 2 | One compact impact line plus TARGET/DELTA. |
| Tier 3 | One structured HOLMES pass with phase summaries and concrete synthesis. |
| Tier 4 | Iterative progress summaries showing blockers opened/resolved and next evidence action. |

This avoids turning latency into a brittle timing guarantee while still controlling perceived friction.

### Outcome-first copy examples

Bad:

```text
HOLMES requires Tier 3 reasoning due to multiple scope flags.
```

Good:

```text
HOLMES Tier 3 · impact needs analysis: this return-value change may affect multiple callers.
```

Bad:

```text
Tier 4 because security keyword detected.
```

Good:

```text
HOLMES Tier 4 · cascading impact possible: authentication behavior may change for existing sessions.
```

Bad:

```text
Prove-down failed.
```

Good:

```text
Could not prove bounded impact: migration behavior for existing records is still unknown.
```

### The value proposition

The product promise should be:

> HOLMES makes the agent predict and verify the outcome before it changes anything meaningful.

That is different from “HOLMES adds reasoning before edits.” The latter sells process. The former sells correctness.

Users in high-reliability domains will accept friction when it is tied to outcome protection:

- “I paused because this could affect access control.”
- “I used Tier 2 because the behavior change is local and predictable.”
- “I escalated because the requested typo fix would actually alter runtime code.”
- “I am iterating because migration impact is not bounded yet.”

This is how the tool communicates that it is optimizing for the finished product the user receives, not merely for the next plausible token or next edit.

---

## Required design adjustments from the UX perspective

1. **Rename/render tiers by impact class.** Keep numeric tiers for enforcement, but default UI should say cosmetic, bounded, analysis-needed, cascading possible.
2. **Make Tier 1 non-behavioral.** Treat Tier 2 as the baseline for ordinary bounded code edits.
3. **Add impact assessment fields.** Store behavior effect, predictability, propagation, failure mode, evidence strength, and missing proof.
4. **Render the main missing proof.** Users should know why HOLMES could not assign a lower-impact tier.
5. **Make Tier 2 lightweight by design.** One impact line plus TARGET/DELTA; do not require full HOLMES language.
6. **Treat confidence as evidence strength.** Low confidence blocks step-down; it should not merely decorate a lower tier.
7. **Show Tier 4 progress as impact convergence.** Each pass should reduce blockers, bound affected surfaces, or explain why mutation remains blocked.
8. **Collect telemetry on classifier impact.** Track raised tiers, blocked mutations, user interruptions, reclassifications after read-only preflight, Tier 3→4 promotions, and repeated Tier 4 non-convergence. Use this to tune proof paths and rendering, not to relax hard safety floors.

## Bottom line

Adopt the impact/outcome framing. It makes the classifier more honest and more user-legible.

The UX calibration is: Tier 1 is rare and meaningful; Tier 2 is the normal low-friction path for bounded code behavior; Tier 3 is one pass for bounded uncertainty; Tier 4 is iterative convergence for cascading or unpredictable impact. Render each tier as an answer to “what will the user receive when this is done, and how bad is it if we are wrong?”
