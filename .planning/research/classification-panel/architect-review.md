# Systems Architect Review — `holmes_classify` custom tool design

## Verdict

The custom `holmes_classify` design is architecturally stronger than the original Task-courier design. It removes the biggest control-flow liability: using a session-authored Task prompt and Task result as the authority path. A registered custom tool gives the extension a local, deterministic `execute` boundary where it can create extension-owned classification records before any mutation gate is opened.

The design is viable, but it needs tightening in three places before implementation:

1. **Finalize the event-order contract around compliance text.** Classification itself is safe without `message_update`, but Tier 2/3 compliance must not depend on a racy text delta that may not be reconciled before a mutation `tool_call`.
2. **Separate process tier from mutation leases for broad/multi-step tasks.** A broad user request may require Tier 3 process, while individual edits still need narrow exact/scope envelopes. One `active?: ClassificationRecord` is too weak for that lifecycle.
3. **Specify the deterministic helper surface more concretely.** The safety of the design lives in `summarizePendingEffect`, path extraction, scope matching, opaque input hashing, and compliance detection. These must be conservative, testable helpers, not vague “classifier intelligence.”

I would proceed with this design, keeping several control-flow and lease rules from the original architecture.

---

## 1. Control flow correctness

### Event ordering

The proposed order is mostly correct:

```text
context → turn_start → before_agent_start → message_update/message_end → tool_call → tool_result
```

The important shift from the original design is that `holmes_classify` is not an async external classifier request. It is a normal model-callable tool whose `execute` function synchronously creates the extension-owned classification record. That simplifies the state machine substantially:

```text
No covering record
  ├─ read-only tool → allow
  ├─ holmes_classify → allow; execute stores record
  └─ effectful tool → block with instruction to call holmes_classify

Covering record exists
  ├─ stale/scope/tool/path/hash mismatch → expire/block/reclassify
  ├─ requirements missing → block
  └─ requirements satisfied + budget available → consume budget; allow
```

This works if `src/main.ts` wires the handlers with these rules:

- `context` is the source of the latest user request and digest.
- `turn_start` increments counters and resets per-turn primitive/delegation counters, but must not blindly clear classification for internal continuations.
- `before_agent_start` only appends the new prompt contract.
- `message_update` and `message_end` feed observation/compliance telemetry; they do not authorize mutation.
- `tool_call` is the hard boundary and must run classification gating before any effectful tool executes.
- `tool_result` should update tool logs and append verify reminders for real mutations, but not treat `holmes_classify` as a mutation.

The current implementation resets observation and reasoning state on every `turn_start`. That is acceptable for the old visible-marker gate, but it is wrong for the new record lifecycle if internal continuations emit `turn_start`. Classification validity must be keyed to user request digest plus scope, not to every provider loop turn.

### Race between `message_update` observation and `tool_call` gating

There is no serious race for Tier 1 authorization because visible text is no longer the key. The gate uses only the stored `ClassificationRecord` created inside `holmes_classify.execute`.

There is a real race risk for Tier 2/3 compliance if the implementation treats `message_update` deltas as immediately satisfying requirements and then allows a mutation `tool_call` in the same assistant message. Depending on OMP event sequencing, the tool call may arrive before all text deltas or before `message_end` reconciliation. If that happens, the gate could either:

- falsely block valid compliance text that has not been reconciled yet; or
- worse, accept partial/old text if the compliance detector is not anchored after the classification result.

The safe rule is:

- Classification records may be created during `holmes_classify.execute`.
- Tier 2/3 requirements should be satisfied only by assistant text observed **after** the classification record was created.
- Prefer satisfying compliance on `message_end`, or store a monotonic `complianceSatisfiedAt` only after a reconciled assistant message whose start/end is after `record.createdAtMs` / `createdAtSequence`.
- If a mutation `tool_call` arrives before compliance has been finalized, block and ask the model to emit the required block then retry.

This fail-closed behavior is better than trying to infer compliance from possibly incomplete deltas.

### State machine transitions

The custom-tool design no longer needs the original `AWAITING_CLASSIFIER_TASK` / `AWAITING_CLASSIFIER_RESULT` states. That is a major simplification. The replacement states should still be explicit in code, even if represented as record fields:

```ts
type ClassificationAuthorizationState =
  | { kind: "none" }
  | { kind: "recorded"; record: ClassificationRecord; requirementsSatisfied: boolean }
  | { kind: "expired"; reason: ExpirationReason };
```

Or, better for multi-record support:

```ts
interface HolmesClassificationState {
  records: ClassificationRecord[];
  latestUserRequestDigest: string;
  ruleVersion: string;
}
```

Then each effectful tool call asks:

1. Is there a valid covering record for the current user request?
2. Is it stale by rule version, turn/user digest, broadened scope, budget, path, tool, or opaque hash?
3. Is it monotonic with overlapping prior records?
4. Are tier requirements satisfied after this record was created?
5. Does this exact effect fit the envelope?

The design currently says `active?: ClassificationRecord` and also says “latest active matching scope wins.” A single `active` pointer cannot satisfy that cleanly. If the model classifies `src/a.ts`, then later classifies `src/b.ts`, a subsequent covered operation on `src/a.ts` should not accidentally be rejected solely because `src/b.ts` is latest, nor should the implementation have to overwrite useful records. Keep `history`, but make authorization select from valid covering records in history rather than a lone `active` record.

### Tool call before any text

There are two cases:

1. **Model emits an effectful tool before text and before `holmes_classify`.**  
   Correct behavior: block. No observation state is needed. The block message should instruct the model to call `holmes_classify` with concrete target/files/tools/reasoning, then retry.

2. **Model emits `holmes_classify` before any visible text.**  
   Correct behavior: allow the tool. The classifier can use the latest user request, params, and tool log. If the params are sparse or the scope cannot be proven mechanical, the deterministic classifier raises to Tier 2/3 or returns a blocked envelope. This is safe.

The only caveat: if Tier 2/3 is returned, the required visible compliance must occur after the classification record, not be inferred from absent or pre-classification text.

---

## 2. Integration with existing modules

### `src/main.ts`

Current state:

- No `context` handler.
- `turn_start` resets observation/reasoning/delegation every turn.
- `message_update` / `message_end` set `reasoningState.hasReasoned` from visible markers.
- `tool_call` runs primitive burst, delegation guard, then `handleReasoningGuard`.
- `tool_result` only appends verify reminders.

Needed changes:

- Create `classificationState`, `turnMetadata`, and `toolLog` near `observationState`.
- Register `holmes_classify` before event handlers.
- Add `context` handling to capture latest user request/digest and expire classifications only when the user request changes.
- Stop using `ReasoningGuardState.hasReasoned` as an authorization signal.
- Keep `message_update` / `message_end` for observation and compliance telemetry.
- Replace `handleReasoningGuard` with `handleClassificationGate`.
- Ensure the gate runs before any effectful mutation. Primitive-burst can still run first for read/search/find discipline, but it must not allow or consume an effectful tool before classification.
- Update `/holmes-status` with classification count, current effective tier, active/covering scope summaries, and expiration reason if present.

The design’s proposed event order is sound, but implementation should avoid resetting classification on raw `turn_start`.

### `src/types.ts`

Current state:

- `ReasoningGuardState` is a boolean.
- `MUTATING_TOOLS` only includes `edit`, `write`, `ast_edit`, `resolve`, `bash`.
- `eval`, `task`, `browser`, `debug`, `github`, `generate_image`, and unknown custom tools are not covered.
- `CLASSIFY_MARKER` is central to the gate.

Needed changes:

- Add `HolmesClassificationState`, `ClassificationRecord`, `ScopeEnvelope`, `ClassificationRequirement`, `HolmesTurnMetadata`, `HolmesToolCallLog`, `ToolCallSummary`, and `PendingEffectSummary`.
- Replace `MUTATING_TOOLS` with explicit `READ_ONLY_TOOLS` and `EFFECTFUL_TOOLS`, with unknown tools defaulting effectful.
- Keep `CLASSIFY_MARKER` only for diagnostic/backward-compatible telemetry.
- Add a rule version string to records so classifier rule changes can invalidate stale records.
- Add stable operation classes for effect extraction, not just tool names.

### `src/observation.ts`

Current state:

- Tracks bounded visible/thinking text.
- Detects visible/thinking HOLMES evidence and classification markers.
- `hasVisibleClassification()` is used to unlock mutation.

Needed changes:

- Keep bounded accumulation and reconciliation.
- Add `redactSelfClassification(text)` for diagnostic/classifier context.
- Add `extractPathMentions(text)` with conservative normalization.
- Add `detectTier2Compliance(text, record)` and `detectTier3Compliance(text, record)` that only consider text after the classification record.
- Add `detectAssistantBroadenedScope(text, record)` and make it conservative.
- Change `hasVisibleClassification()` to telemetry only.

Do not put classification record mutation in `observation.ts`. Observation should remain a pure-ish text/event accumulator.

### `src/guards.ts`

Current state:

- `handleReasoningGuard` trusts visible text markers.
- `handleDelegationGuard` only blocks dead HOLMES agent names and notes delegation evidence.
- `appendVerifyReminder` covers `edit`, `write`, `resolve`, `ast_edit`.

Needed changes:

- Delete or retire `handleReasoningGuard` as an authorization mechanism.
- Add `handleClassificationGate` with this order:
  1. record/summarize tool attempt;
  2. allow `holmes_classify`;
  3. allow read-only tools;
  4. treat unknown/effectful tools as requiring classification;
  5. summarize pending effect;
  6. select valid covering record;
  7. validate freshness/scope/tool/path/hash/budget;
  8. check tier requirements;
  9. consume mutation budget and allow.
- Keep primitive burst and delegation/TTSR behavior, but ensure no effectful path bypasses the classification gate.
- Update verify reminders to include all structured mutations as intended, and exclude `holmes_classify`.

### `src/prompts.ts`

Current state:

- The prompt says visible `[CLASSIFY: Tier N]` opens mutation.
- It says hidden thinking/tool arguments do not count for the marker gate.
- It encourages Tier 1 fast path by printing a marker and proceeding.

Needed changes:

- Replace the visible-marker contract with the `holmes_classify` checkpoint contract.
- State that self-tier labels are advisory only.
- Instruct the model to call `holmes_classify` before mutation-capable tools.
- Explain that returned tier, requirements, and scope are binding.
- Preserve Layer 0 and Tier 2/3 HOLMES loop content as post-classification compliance.
- Keep the delegation protocol, but clarify that `task` itself is effectful unless classified/read-only and that subagents do not inherit parent records.

### Circular dependency risks

The clean dependency shape should be:

```text
types.ts          ← pure shared types/constants
observation.ts    → types.ts
classification.ts → types.ts (+ maybe pure helpers)
guards.ts         → types.ts, observation.ts, classification.ts
prompts.ts        → no runtime imports from guards/classification if possible
main.ts           → all modules; wires state and handlers
```

Avoid these cycles:

- `classification.ts` importing `guards.ts` for effect extraction while `guards.ts` imports classification gate helpers.
- `observation.ts` importing classification state/types beyond shared types.
- `prompts.ts` importing live classification state to render dynamic text.

If both `classification.ts` and `guards.ts` need hashing/path/effect utilities, put them in a small pure helper module or keep the helpers entirely in `classification.ts` and have `guards.ts` call exported pure functions. Do not split them bidirectionally.

---

## 3. State management

### Classification record lifecycle

The intended lifecycle is correct but should be made explicit:

```text
created by holmes_classify.execute
  → valid but maybe requirements-pending
  → selected only if it covers the current effect
  → requirements satisfied after record creation
  → mutation budget consumed on each allowed effect
  → expired on new user request, mismatch, budget exhaustion, rule version change, broadened scope, or opaque hash mismatch
```

Important implementation details:

- Store `createdAtSequence` in addition to `createdAtMs`; event order is safer than wall-clock for compliance checks.
- Store `ruleVersion`; otherwise a long session can keep records from old classifier logic.
- Store source digests for audit, but do not make visible text digest too strict for freshness. Visible text can grow after classification. Use it to detect broadened scope, not to invalidate harmless follow-up text.
- Record failed/blocked classifications too. They are useful for monotonic tier and debugging classifier shopping.

### Monotonic tier rule

The rule is right: a later overlapping classification cannot lower a prior required tier in the same user request. It prevents classifier shopping.

The implementation needs a precise overlap function:

- same user request digest;
- path sets intersect, or one side is broad/unknown/blocked for the same operation family;
- tool/effect classes are compatible or one is opaque/broad;
- prior record has not expired for an objective reason such as new user request or consumed exact single-use mutation.

The current `mergeWithPriorOverlappingTier(record, active)` sketch is insufficient if `active` is the only record. Use history selection:

```text
coveringCandidates = valid records whose scope covers the pending effect
riskFloor = max(tier of valid overlapping records in same request)
chosen = latest covering candidate
allowed tier = max(chosen.tier, riskFloor)
```

If `riskFloor` is higher than `chosen.tier`, the gate should require the higher-tier requirements before allowing the mutation. It should not silently mutate the chosen record in a way that obscures audit history.

### Long multi-step tasks

This is the design’s most important state-management edge case.

A user request can be broad while each mutation is narrow. Example: “implement the feature and update tests.” The request-level process may correctly be Tier 3, but an individual edit may be a one-file structured mutation after the full HOLMES loop has narrowed scope.

Do not force one record to represent both concepts. Keep two related ideas separate:

1. **Process tier floor** — the minimum HOLMES process required for the user request or overlapping scope.
2. **Mutation lease** — the concrete tool/path/hash/budget envelope for the next allowed effects.

For broad work, the first `holmes_classify` may produce Tier 3 with a blocked or broad process record. After the model resolves unknowns and narrows the plan, it should call `holmes_classify` again for concrete planned actions. The second record can have a narrow scope lease, but the tier floor remains Tier 3 for overlapping work until the user request changes or the risk record objectively expires.

This keeps enforcement strict without making broad tasks unworkable.

Mutation budgets also need care. Tier 1 should usually be single-use exact. Tier 2/3 can have a scoped budget, but `expectedMutationCount` must be capped and tied to explicit `plannedActions`. For broad multi-step work, repeated classification is acceptable; silently widening a lease is not.

---

## 4. Missing pieces and implementability

The design references many helpers that need concrete contracts. They are implementable with deterministic heuristics if the failure mode is conservative escalation/blocking.

### Path and tool extraction

- `extractPathMentions(text)`  
  Implement with regex/heuristics over quoted strings, code spans, common path extensions, relative paths, and internal URI/path selectors. Normalize `./`, strip line selectors where safe, reject URLs except internal resource schemes if relevant. False negatives should block or raise tier.

- `extractPathsFromToolCalls(toolLog)`  
  Implement per known tool schema: `read.path`, `write.path`, `edit` patch headers, `ast_edit.paths`, `search.paths`, `find.paths`, `bash` opaque command path hints only as diagnostic, `resolve` pending action metadata when available.

- `extractTools(params)` / `extractOperationKinds(params)`  
  Mostly structured from schema. Validate against known sets; unknown means effectful/unknown.

### Opaque input handling

- `hashOpaqueInputs(plannedActions)`  
  Use stable JSON/string hashing for opaque fields. Do not use raw object key order. Include tool name and normalized operation type in the hash domain.

- `summarizePendingEffect(event)`  
  This is load-bearing. It must produce inspectable path/tool/effect/fingerprint summaries for each effectful tool. If it cannot prove the effect, return `inspectable: false` and block or require higher-tier exact hash.

- `classificationCoversEffect(scope, effect)`  
  Must be exact and boring: tool match, non-empty path subset, operation kind compatibility, mutation budget, exact fingerprint for Tier 1, exact opaque hash for opaque tools.

### Tier signal helpers

- `detectRiskFlags(text)` / `isTier3Surface(flag)`  
  Regex/keyword lists are sufficient: auth, permissions, crypto, secrets, payments, database/data migration, deploy/infra, destructive filesystem, production, security, safety, healthcare/finance/defense-sensitive terms. Expect false positives.

- `detectUnknownsOrVerificationNeeds(evidenceText, params)`  
  Regex for “unknown”, “assume”, “maybe”, “need to investigate”, “not sure”, “unclear”, “depends”, unresolved TODO-like claims, and explicit assumptions/unknowns arrays. Any hit should raise to Tier 3 unless already resolved by observed evidence.

- `detectTradeoffs(evidenceText, params)`  
  Regex for alternatives/tradeoffs: “option”, “tradeoff”, “could”, “choose”, “prefer”, “architecture”, “design decision”. These should usually raise to Tier 2.

- `detectBehavioralChange(userRequest, operationKinds, evidenceText)`  
  Use operation kind plus verbs like implement, fix behavior, change logic, handle, validate, enforce, migrate, refactor. This cannot be perfect, so the safe default is Tier 2 or Tier 3.

- `detectScopeFlags({ paths, userPaths, plannedPaths, plannedTools })`  
  Count files/modules, detect mismatch between user-mentioned paths and planned paths, detect no concrete mutation scope, detect glob/broad directories.

- `detectOpaqueToolFlags(plannedTools, plannedActions)`  
  `bash`, `eval`, `task`, `browser`, `debug`, `github`, `resolve`, and broad `ast_edit` are opaque unless exact input/effect binding is available.

- `isBroadOrAmbiguousRequest(userRequest)`  
  Regex/heuristics: “fix this”, “make it better”, “refactor”, “update all”, “implement feature”, “clean up”, “optimize”, “review”, broad directories, no explicit files, multiple goals. If ambiguous, Tier 3.

- `isClearlyMechanical(operationKinds, evidenceText, userRequest)`  
  This must be a closed allowlist, not a broad classifier. Examples: typo/text replacement in one file, exact import path rename in one file, formatting metadata in one file, exact known string replacement. If the helper cannot prove mechanical, return false.

### Compliance helpers

- `detectTier2Compliance(text, record)`  
  Check only post-record assistant text for TARGET and DELTA; preferably NOW and NEXT too. It should not parse hidden thinking. Factual claims in NOW used for mutation should reference observed tools or be simple restatements of the user request.

- `detectTier3Compliance(text, record, toolLog)`  
  Check post-record text for Hone/Observe/Ladder/Map/Establish/Synthesize, explicit unknown resolution, and required delegation/research/tool evidence.

- `detectAssistantBroadenedScope(text, record)`  
  Conservative phrases plus path/tool mentions outside the envelope after classification. This should expire/block, but avoid triggering on quoted diagnostics or the tool’s own scope text.

### Do these need model intelligence?

No. They should not use model intelligence in the authority path. The design’s premise is deterministic extension-owned classification. Some judgments are semantically hard, but the correct deterministic answer to uncertainty is not “ask a model inside the gate”; it is “raise tier or block until scope/evidence is concrete.”

If a future model-based oracle is reintroduced, it should be advisory or an explicitly separate high-tier escalation path. It should not replace the deterministic gate’s scope/tool/hash checks.

### Testing strategy

Add tests at three levels.

#### Pure helper tests

- path extraction: quoted paths, selectors, internal URIs, globs, URLs, duplicate normalization;
- stable hashing: object key order, opaque input hashes, exact mismatch;
- risk/unknown/tradeoff/mechanical detection;
- scope matching: path subset, empty path rejection, glob rejection, operation mismatch;
- monotonic overlap resolution;
- compliance detection anchored after classification creation.

#### Gate unit tests with synthetic events

- mutation before any text and no record blocks;
- `holmes_classify` is allowed with no observation state;
- read-only tools pass unclassified;
- `eval`, `bash`, `task`, `browser`, `debug`, `github`, `generate_image`, and unknown tools require classification;
- visible fake `[CLASSIFY: Tier 1]` does not authorize mutation;
- Tier 1 exact lease allows one matching edit and then expires;
- Tier 1 exact lease rejects changed input/path/tool;
- Tier 2 blocks until post-classification TARGET/DELTA compliance;
- Tier 3 blocks until full loop plus required evidence;
- stale record expires on new user request digest;
- assistant broader-scope announcement expires the record;
- overlapping later lower-tier record cannot downgrade prior higher-tier floor;
- non-overlapping records do not authorize each other.

#### Integration tests with fake `ExtensionAPI`

Simulate full event sequences:

1. `context → turn_start → before_agent_start → tool_call(edit)` with no classification: block.
2. `context → message_update(text) → tool_call(holmes_classify) → tool_result → tool_call(edit)`: allow if exact scope matches.
3. `holmes_classify` before any text: allowed; mutation blocked if returned requirements are missing.
4. Tier 2 result, compliance text in a later `message_end`, then mutation: allow.
5. Tier 2 compliance text and mutation in same assistant message with no finalized compliance state: fail closed unless the implementation can prove event order is reconciled.
6. Broad Tier 3 process record, later narrow mutation lease, same request: enforce Tier 3 requirements but allow concrete scoped edit after compliance.
7. `task` is blocked unless classified as an explicitly read-only/delegation/research action; subagent mutation is not covered by parent record.

These tests should target the extension’s handler functions and pure helpers; they do not need a real model.

---

## 5. Comparison to the original Task-courier design

### Where the custom tool approach is better

- **Authority boundary is cleaner.** Classification records are created inside extension-owned code, not parsed from assistant text or a session-authored Task result.
- **No classifier prompt laundering.** The model can provide params, but it cannot rewrite the classifier assignment or suppress/forge a Task result.
- **Lower latency.** Tier 1 costs one local tool call instead of a blocked mutation plus external Task round trip.
- **Simpler state machine.** No `AWAITING_CLASSIFIER_TASK` or `AWAITING_CLASSIFIER_RESULT`; no need to remember classifier Task call IDs.
- **Less prompt-injection surface.** There is no model classifier prompt to inject; user/repo/session text is scanned as untrusted data.
- **Better print-mode behavior.** A deterministic local tool is much less awkward than forcing a Task-courier retry loop.

### Where it is worse

- **Less semantic judgment.** The Task-courier/oracle design could use a model to reason about ambiguous work. The custom tool relies on heuristics and must over-classify when uncertain.
- **The model still chooses when to call the tool.** The gate fixes this by blocking mutations, but the happy path depends on prompt compliance.
- **Params are still session-authored.** The design handles this by cross-checking, but the deterministic classifier must not rely too heavily on `params.target` or `plannedActions` without observed scope/effect validation.
- **Helper quality matters more.** If path/effect extraction is weak, the custom tool will either block too much or accidentally approve too much. The original oracle could compensate semantically; this design cannot.
- **No independent reviewer by default.** For genuinely high-risk Tier 3 work, deterministic classification enforces process but does not itself provide independent architectural verification.

### What to keep from the original design

Keep these pieces:

- **First side-effect tool is the enforcement boundary.** The model may plan freely, but mutation waits for a valid record.
- **Request digest + scope + tool + fingerprint binding.** This is still the core of non-gameable authorization.
- **Opaque tools require exact hashes.** `bash`, `eval`, `task`, `resolve`, broad `ast_edit`, browser/debug/GitHub operations must not get broad Tier 1 leases.
- **Fail closed on malformed/stale/mismatched state.** Never fall back to assistant claims.
- **Visible text is compliance evidence only.** It can satisfy Tier 2/3 process after classification, but it cannot authorize by itself.
- **Read-only/effectful taxonomy with unknown tools effectful by default.** The current `MUTATING_TOOLS` set is too narrow.
- **No resume of originally blocked mutation.** If the model skipped `holmes_classify`, the blocked tool call should not be resumed invisibly; the model must classify and retry within scope.

Discard the Task-courier authority path as the primary design. It is unnecessary once `pi.registerTool()` exists. Keep Task only as an effectful action that may be required as Tier 3 delegation/research evidence and must itself be covered by a classification envelope.

---

## Implementation notes I would require before merge

1. Replace `active?: ClassificationRecord` with valid-record selection from history, or explicitly document why only one active record is sufficient. I do not think one active record is sufficient for multi-step tasks.
2. Add `createdAtSequence` / `complianceAfterSequence` so Tier 2/3 compliance cannot be satisfied by pre-classification text or racy deltas.
3. Define `summarizePendingEffect` and `classificationCoversEffect` before implementing classifier heuristics. The gate is only as strong as effect matching.
4. Make Tier 1 a closed allowlist in code. Do not implement it as “no Tier 2/3 flags found.”
5. Treat `task` as effectful by default, with an explicit read-only/delegation evidence path only when classified and scope-bound.
6. Add tests for no-text tool calls, same-message compliance races, opaque hash mismatch, monotonic overlap, and broad-request/narrow-step workflows.

With those changes, the custom tool approach is the better architecture.