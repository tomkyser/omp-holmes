# HOLMES implementation adversarial review

## Verdict: FAIL

The implementation has crossed the cutover line — `holmes_classify` exists, the visible-marker authorization path is removed from `src/main.ts`/`src/guards.ts`, and the prompt/state/tool wiring are largely in place — but the enforcement core is still not safe enough to ship.

The remaining blockers are concentrated in `src/classification.ts`, plus stale tests and stale TTSR rule bodies:

- post-classification compliance sequencing is broken;
- Tier 4 can still start mutation-ready from model-supplied params;
- blocking unknowns can be mass-resolved from any cited reference;
- Tier 3/4 compliance remains too shallow versus the spec’s evidence-bound closure requirements;
- `src/main.test.ts` still calls observation helpers with stale signatures;
- rule reminder text still teaches the replaced visible-marker/eval flow.

I did not run commands per assignment. Findings below are grounded in the current on-disk files via `read`/`search`.

## Per-file review

### `src/types.ts`

Spec compliance: mostly PASS.

What is correct:
- Four-tier `HolmesTier` and the Section 2 domain types/constants are present.
- Classification/lease/ledger/state/tool taxonomy types exist.
- `ReasoningGuardState` is removed.
- Telemetry-only marker regex includes Tier 4.
- Factories for classification state, tool log, turn metadata, stats, delegation, and observation are present.

What remains:
- `buildHolmesClassifyParamsSchema()` still lives in `src/types.ts`, although the spec assigns TypeBox schema construction to `src/classification.ts`.

Security impact: low.

### `src/classification.ts`

Spec compliance: FAIL.

What is correct:
- `holmes_classify` is registered as an extension-owned tool.
- Snapshot/prove-down/lease/gate helper architecture exists.
- File reads are now bounded and secret paths are handled conservatively.
- Live tool-log state is merged into the snapshot ledger.
- Opaque-input canonicalization exists.
- Gate-time authorization selection, coverage, invalidation helpers, and LLM assessor plumbing exist.

What is wrong:
- `createdAtSequence` / post-classification sequence tracking is inconsistent, breaking compliance updates.
- Tier 4 process state can still be marked mutation-ready from model-supplied params alone.
- Evidence matching for unknown resolution is non-specific and resolves all blockers from any cited ref.
- Tier 3/4 compliance checks still do not enforce the full fixed-point closure contract from the spec.

Security impact: critical.

### `src/observation.ts`

Spec compliance: PASS for telemetry/extraction responsibilities.

What is correct:
- Visible/thinking accumulation remains bounded.
- Visible markers are telemetry only.
- Self-classification redaction, path extraction, broadened-scope detection, Tier 2/3/4 helper extraction, and evidence-reference extraction exist.

What is wrong:
- No direct issue in this file. The problem is that `src/main.test.ts` still targets older return shapes/signatures than this file exports.

Security impact: low.

### `src/prompts.ts`

Spec compliance: PASS.

What is correct:
- System prompt matches the Section 7 intent: `holmes_classify` authority, four impact tiers, prove-down, read-only preflight, binding scope, and no visible-marker authorization.
- `/holmes` and `/holmes-goal` helpers are updated to impact framing.

Security impact: none found.

### `src/guards.ts`

Spec compliance: partial PASS.

What is correct:
- Visible-marker `handleReasoningGuard()` is gone.
- `handleClassificationGate()` delegates to classification-owned enforcement.
- Dead HOLMES agent names still block.
- Verify reminder skips `holmes_classify`.

What is wrong:
- Primitive-burst reminder text still tells the model to batch through `eval()`, even though the new spec treats `eval` as effectful by default.

Security impact: medium.

### `src/main.ts`

Spec compliance: partial PASS.

What is correct:
- `holmes_classify` registers at startup.
- Classification state, turn metadata, tool log, and `context` handler are wired.
- `turn_start` no longer clears classification state.
- `message_end` calls compliance update instead of treating visible markers as authority.
- `tool_result` updates internal tool-result/verification state.

What is wrong:
- `tool_call` ordering is `delegation → classification → primitive`, while the spec pseudocode says `primitive → delegation → classification`.
- More importantly, `main.ts` advances `classificationState.sequence` as a small counter while `src/classification.ts` records `createdAtSequence` from `Date.now()`, so the post-classification compliance updater never sees `sequence > createdAtSequence`.

Security impact: high because it breaks the intended evidence-update path.

### `src/main.test.ts`

Spec compliance: FAIL.

What is correct:
- The suite is large and targets the new classifier/gate architecture.

What is wrong:
- Observation helper call sites still use stale contracts: tests pass `MessageObservationState` objects and expect `{ ok, missing, closureSatisfied, broadened, paths }`, but `src/observation.ts` exports text-based extractors with different shapes.

Security impact: high because the advertised acceptance evidence is currently unreliable.

### `rules/`

Spec compliance: FAIL.

What is correct:
- Rules still target useful behaviors (assumptions, primitive chaining, verify-after-edit, eval mutation intent/code).

What is wrong:
- Rule bodies still teach the old marker gate and old eval guidance.
- `rules/RULES.md` still describes a 3-tier visible-marker mutation protocol.
- Batch primitive rules still recommend `eval()` as the default batching escape.

Security impact: high because stale injected guidance trains the model toward the replaced protocol.

## Cross-cutting concerns

1. The extension-owned gate exists, but the post-classification compliance path is still internally inconsistent.
2. Tier 4 closure remains vulnerable to model self-certification through params plus shallow evidence matching.
3. Tests and TTSR rule text are still lagging behind the implementation, so the safety model is not consistently taught or verified.
4. Several components now look correct in isolation (`prompts.ts`, much of `types.ts`, bounded classifier reads), but the remaining gaps are in the load-bearing enforcement chain, so the overall verdict remains FAIL.

## Issues by severity

### CRITICAL

#### CRITICAL-1 — Post-classification compliance sequencing is broken

- File: `src/classification.ts`, `src/main.ts`
- Location:
  - `src/classification.ts` `buildClassificationSnapshot()`, lines 170–179 (`sequence: Date.now()`)
  - `src/classification.ts` `makeClassificationRecord()`, `createdAtSequence: args.snapshot.sequence`
  - `src/main.ts`, lines 151–152 and 193–201 (`classificationState.sequence++` and `updateClassificationComplianceFromObservation({ sequence: classificationState.sequence, ... })`)
- What is wrong: records are stamped with a wall-clock timestamp while the runtime updates compliance with a small monotonic counter. Because `updateClassificationComplianceFromObservation()` only acts when `args.sequence > record.createdAtSequence`, Tier 2/3 post-classification updates never fire.
- What the spec says: §2.15 and §8.5 require compliance to be sequence-anchored after `record.createdAtSequence`, using the same authoritative sequence stream.
- How to fix: pass the live `classification.sequence` counter into `buildClassificationSnapshot()` and store that in `createdAtSequence`. Use a single monotonic sequence source across classification creation and observation reconciliation.

#### CRITICAL-2 — Tier 4 can self-authorize from params alone

- File: `src/classification.ts`
- Location:
  - `processForTier()`, lines 1955–1972
  - `tier4ClosureClaimComplete()`, lines 2392–2394
  - `fullLoopClaimComplete()`, lines 2396–2398
- What is wrong: initial Tier 4 process state sets `closureSatisfied` from `params.holmes.fullLoop` plus empty unknown arrays, and can start `status: "mutation_ready"` before any post-classification observed evidence exists.
- What the spec says: §0.3 invariants 1–3 and §6.8 require Tier 4 closure to be extension-observed, evidence-bound, and post-classification. Assistant prose/params never authorize mutation.
- How to fix: Tier 4 must start non-ready (`tier4_looping` / blocked pending concrete closure evidence). `tier4ClosureClaimComplete()` / `fullLoopClaimComplete()` may inform diagnostics, but must not make the initial process mutation-ready.

#### CRITICAL-3 — Any cited reference resolves all blocking unknowns

- File: `src/classification.ts`
- Location:
  - `updateClassificationComplianceFromObservation()`, lines 2459–2483
  - `extractEvidenceIds()`, lines 2630–2634
  - `markUnknownsResolved()`, lines 2641–2644
- What is wrong: once the model prints HOLMES headings plus any path/line/internal-URI reference, `markUnknownsResolved()` assigns those refs to every blocking unknown with no unknown-specific matching.
- What the spec says: §6.8 requires every flagged blocking unknown to be resolved or marked non-blocking with evidence. Evidence must close the actual blocker, not merely exist somewhere in the message.
- How to fix: unknowns need structured identities/categories, and evidence refs must be matched per-unknown (path/topic/system/obligation). If matching is ambiguous, keep the unknown blocking and require further research or reclassification.

### HIGH

#### HIGH-1 — Tier 3 / Tier 4 compliance checks remain too shallow for the spec’s closure contract

- File: `src/classification.ts`
- Location:
  - `requirementsSatisfied()`, lines 1728–1760
  - `updateClassificationComplianceFromObservation()`, lines 2459–2483
- What is wrong: even after the evidence-ref improvement, compliance still reduces to section headings, some visible evidence refs, delegation booleans, a verification-plan regex, and a few closure phrases. It does not enforce synthesized-scope matching, no-new-scope-after-synthesis, latest synthesis covering cumulative ledger, or unknown-specific closure.
- What the spec says: §6.8 requires concrete synthesized edit scope matching the lease for Tier 3, and evidence-bound fixed-point closure for Tier 4.
- How to fix: persist structured post-classification compliance state from observation (sections, evidence refs, synthesized paths/tools, blocker resolutions, closure proof) and compare it against the lease plus cumulative ledger before allowing mutation.

#### HIGH-2 — `src/main.test.ts` still targets stale observation helper contracts

- File: `src/main.test.ts`
- Location: lines 692, 698, 713, 726, 738, 744
- What is wrong: tests call `detectTier2Compliance`, `detectTier3SinglePassCompliance`, `detectTier4Pass`, and `detectAssistantBroadenedScope` with `MessageObservationState` objects / extra args and expect `{ ok, missing, closureSatisfied, broadened, paths }`. Current `src/observation.ts` exports text-based extractors instead.
- What the spec says: §10 requires meaningful proof via tests; broken tests cannot be treated as verification evidence.
- How to fix: either align the tests to the current observation helper signatures or expose a different compliance API from the classification layer and test that directly.

#### HIGH-3 — Rule reminder text still teaches the replaced marker/eval protocol

- File:
  - `rules/RULES.md`, lines 12–15
  - `rules/eval-mutation-code.md`, lines 6–9
  - `rules/eval-mutation-intent.md`, lines 6–10
  - `rules/batch-primitive-numbered.md`, line 6
  - `rules/batch-primitive-prose.md`, line 6
- What is wrong: these rule bodies still tell the model to emit visible `[CLASSIFY: Tier N]` markers, refer to the old “HOLMES reasoning gate”, and recommend `eval()` as the batching escape.
- What the spec says: §7, §9.5, §11.1, and §11.4 require `holmes_classify` authority and make visible markers telemetry-only; `eval` is effectful by default.
- How to fix: rewrite rule body text to direct the model toward `holmes_classify`, returned lease coverage, and read-only batching via `read`/`search`/`find`/`ast_grep` when possible.

#### HIGH-4 — Tier 2/3/4 compliance updater is effectively bypassed by the sequence bug, leaving Tier 4 params self-certification as the only practical ready path

- File: `src/classification.ts`, `src/main.ts`
- Location:
  - `src/classification.ts` lines 170–179 and 1955–1972
  - `src/main.ts` lines 193–201
- What is wrong: because the updater never reaches `sequence > createdAtSequence`, Tier 2 and Tier 3 readiness is never promoted from observation, while Tier 4 can still start ready from params. This produces a bad fail-open/fail-closed split: lower tiers over-block, while Tier 4 can under-block.
- What the spec says: §6.8 and §8.5 require all higher-tier readiness to come from post-classification evidence, not params.
- How to fix: same as CRITICAL-1 plus CRITICAL-2; these bugs are coupled and should be corrected together.

### MEDIUM

#### MEDIUM-1 — Primitive-burst messaging still recommends `eval()` as the default batching tool

- File: `src/guards.ts`
- Location: `handlePrimitiveBurst()`, lines 104–112
- What is wrong: the block text says to rewrite the investigation as one `eval()` cell.
- What the spec says: §6.3, §6.6 `eval`, and §9.5 make `eval` effectful by default; read-only batching should prefer direct discovery tools.
- How to fix: change the message to prefer batched `read`/`search`/`find`/`ast_grep`, or to classify exact eval-based research if truly necessary.

#### MEDIUM-2 — `tool_call` ordering differs from the spec pseudocode

- File: `src/main.ts`
- Location: lines 221–238
- What is wrong: runtime ordering is `delegation → classification → primitive`, whereas spec §8.6 shows `primitive → delegation → classification`.
- What the spec says: §8.6 defines the intended ordering and budget-consumption assumptions.
- How to fix: either reorder to match the spec exactly, or explicitly document why the current ordering is safe and update the spec/tests together.

### LOW

#### LOW-1 — TypeBox schema ownership remains in `src/types.ts`

- File: `src/types.ts`
- Location: `buildHolmesClassifyParamsSchema()`, lines 688–842
- What is wrong: schema construction lives in `types.ts` rather than `classification.ts`.
- What the spec says: §1.2 assigns TypeBox schema construction to `src/classification.ts`.
- How to fix: move the builder or explicitly bless the current ownership split.

## Final note

The implementation is much closer than the pre-cutover marker gate. The remaining blockers are no longer “missing architecture” problems; they are concentrated enforcement bugs in the classification/compliance path and stale surrounding verification/guidance artifacts. Until those are fixed, the correct verdict remains FAIL.
