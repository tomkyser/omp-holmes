# Staff Engineer Implementability Review

Reviewed inputs:

- `.planning/implementation-spec.md` lines 1-3456: read in full.
- Current source: `src/main.ts`, `src/types.ts`, `src/observation.ts`, `src/guards.ts`, `src/prompts.ts`.
- OMP API verification: local `@oh-my-pi/pi-coding-agent` extension types, shared event result types, TypeBox shim, `@oh-my-pi/pi-ai` completion/context types.

## Implementability Assessment

### TypeScript types

Most externally meaningful domain types are specified: `HolmesTier`, impact surfaces/classes, evidence refs, floors/ceilings, proof-down records, scope envelopes, mutation leases, cumulative ledger, classification state, tool-call summaries, `ProveDownResult`, `HolmesClassifyDetails`, and `ClassificationSnapshot`.

Gaps to resolve before treating the spec as a no-guesswork implementation contract:

1. **LLM assessor output/type mismatch is blocking.** The assessor prompt requires JSON fields `raiseReasons` and `missingEvidence`, and the algorithm references `mergeAssessorBlockers()`, but `LlmImpactAssessment` does not include `raiseReasons` or `missingEvidence`. Add those optional arrays to `LlmImpactAssessment`, or remove them from the prompt and define exactly how missing proof is derived.
2. **`parseLlmImpactAssessment(text)` signature is incomplete.** The parser body depends on `evidenceIds`, `promptVersion`, `outputSchemaVersion`, `modelId`, and `durationMs`, but those are not parameters. Make it `parseLlmImpactAssessment({ text, evidenceIds, promptVersion, outputSchemaVersion, modelId, durationMs })` or equivalent.
3. **`HolmesClassifyParams` is not explicitly spelled out.** The schema is complete, and the spec notes that the interface may need to be manual if `Static` is unavailable. This is implementable, but the implementer must mirror the schema carefully because `@oh-my-pi/pi-coding-agent` does not re-export `Static` directly from the top-level extension types.
4. **New `HolmesStats` fields are not enumerated.** The spec requires status/counters for classification records, gate blocks, LLM assessor outcomes, and Tier 4 passes, but it does not list the final `HolmesStats` shape. This is not architecturally blocking, but it is a typing gap.
5. **Several internal helper result types are referenced but not defined.** Examples: `CoverageResult`, `CoveringAuthorizationResult`, gate decision/compliance/staleness result shapes. These can be local implementation details, but tests will be easier and less ambiguous if they are named in `src/types.ts` or `src/classification.ts`.

### Function signatures

The public signatures are mostly complete: tool registration, snapshot construction, impact assessment, LLM assessor factory, scope envelope, record construction, stable hashing, pending-effect summarization, and gate handling all have enough parameters to implement.

One module/signature conflict should be fixed:

- Section 1.2 says `src/guards.ts` owns `handleClassificationGate()` and calls pure hot-path helpers from `classification.ts`.
- Section 2.22 lists `export function handleClassificationGate(...)` alongside `classification.ts` exports.
- Section 11.5 says to replace `handleReasoningGuard()` with `handleClassificationGate()` in `src/guards.ts`.

Recommended resolution: keep `handleClassificationGate()` in `src/guards.ts`; put `evaluateClassificationGate()`, `summarizePendingEffect()`, lease matching, freshness checks, and fingerprint helpers in `src/classification.ts`. `main.ts` should import the event wrapper from `guards.ts`, preserving the intended dependency graph.

### Prove-down algorithm

The algorithm is implementable as a conservative classifier:

- Always start at Tier 4.
- Compute deterministic hard floors/ceilings.
- Attempt 4→3 bounded proof, then 3→2 predictable proof, then 2→1 null-impact proof.
- Integrate the LLM assessor upward-only.
- Apply cumulative/overlapping floors.
- Build requirements and a finite lease.

The policy is precise enough to avoid unsafe downgrades. The parts that remain abstract are the detector/helper tables: path/file-role mapping, operation-class inference, hard-floor syntax heuristics, AST-equivalence proof, docs-contract detection, and compliance parsing. The safe implementation choice is explicit: if a helper cannot prove the predicate, return missing proof and retain/raise tier. That avoids guesswork, but may initially over-block until detector tables mature.

### LLM assessor call pattern

The OMP/API assumptions are correct, with two implementation corrections:

- Verified `ExtensionContext` provides `cwd`, `sessionManager`, `modelRegistry`, and `model`; it does not expose `ctx.complete()` or `ctx.readFile()`.
- Verified `registerTool()` execute shape is `(toolCallId, params, signal, onUpdate, ctx)` and returns `AgentToolResult<TDetails>`.
- Verified `completeSimple(model, context, options)` exists in `@oh-my-pi/pi-ai`, and `SimpleStreamOptions` supports `apiKey`, `signal`, `maxTokens`, `temperature`, `disableReasoning`, `hideThinkingSummary`, `streamFirstEventTimeoutMs`, and `streamIdleTimeoutMs`.
- The sample import should include all used types: `Api`, `AssistantMessage`, `Context`, and `Model`, not only `Context`.
- The spec says to use `AbortController` to enforce timeout, but the sample code only sets stream first-event/idle timeouts. Implement a wall-clock timeout with an `AbortController` chained to the parent `signal`; otherwise a stream that keeps emitting slowly can exceed the intended classifier budget.

### TypeBox schemas

The TypeBox schema is structurally correct for OMP’s injected shim:

- `pi.typebox.Type` supports the builders used: `Union`, `Literal`, `Object`, `String`, `Array`, `Optional`, and `Integer`.
- `additionalProperties: false` maps to strict Zod objects in the shim.
- The `registerTool<typeof parameters, HolmesClassifyDetails>` pattern matches the local `ToolDefinition<TParams extends TSchema, TDetails>` signature.
- `structuredEffect` intentionally covers structured mutation tools (`edit`, `write`, `ast_edit`); opaque tools are handled by `exactOpaqueInput`.

No TypeBox dependency needs to be added. Do not import `Static` from `@sinclair/typebox`; either import from an approved OMP export if exposed, or write `HolmesClassifyParams` manually.

## Dependency Analysis

### Recommended import graph

```text
src/types.ts
  -> no project imports

src/observation.ts
  -> types/constants from src/types.ts

src/classification.ts
  -> types/constants from src/types.ts
  -> type-only OMP event/tool/context types
  -> node:fs/promises and node:path for classify-tool execute-time bounded reads
  -> @oh-my-pi/pi-ai completeSimple + model/context types for the optional assessor
  -> no runtime import from guards.ts

src/guards.ts
  -> types/constants from src/types.ts
  -> observation compliance helpers from src/observation.ts
  -> pure hot-path helpers from src/classification.ts

src/prompts.ts
  -> no runtime imports from guards/classification

src/main.ts
  -> wires all modules
```

There is no unavoidable circular dependency if `classification.ts` does not import `guards.ts`. `classification.ts` also does not need anything from `guards.ts`; the dependency should flow the other way.

### OMP API assumptions

The enforcer Round 2/3 assumptions in the spec match the local OMP types:

- `pi.registerTool()` exists and registers model-callable tools.
- `ToolDefinition.execute()` receives `(toolCallId, params, signal, onUpdate, ctx)`.
- `ExtensionContext` exposes `cwd`, `sessionManager`, `modelRegistry`, and `model`.
- `ToolCallEventResult` supports only `{ block?: boolean; reason?: string }`.
- `ToolResultEventResult` can replace `content`, `details`, and `isError`.
- `pi.getActiveTools()` and `pi.getAllTools()` exist for runtime visibility checks.
- `ExtensionAPI.typebox` is the intended TypeBox-compatible shim.

TypeScript implementation note: OMP’s `ToolCallEvent` includes a `CustomToolCallEvent` whose `toolName: string` overlaps built-ins, and the type file explicitly says direct `event.toolName === "bash"` does not narrow cleanly. Use `isToolCallEventType()` or explicit input normalization/casts in effect extraction helpers.

## Implementation Risks

### Sections too abstract to implement directly

The architecture is concrete; the detector layer is the main abstract area. The following helpers need deterministic, test-backed tables rather than ad-hoc regexes scattered through the gate:

- file role classification (`source`, `test`, `docs`, `config`, `agent_guardrail`, etc.);
- hard floor detection by path, syntax, effect shape, and tool;
- hard ceiling detection for docs prose/comment/whitespace/AST equivalence;
- operation-class inference from `edit`/`write`/`ast_edit` payloads;
- visible Tier 2/3/4 compliance detection after `createdAtSequence`;
- assistant broadened-scope detection.

Conservative fallback is clear: retain/raise tier and add `missingProof`.

### Undefined or risky edge cases

- **Assessor blockers:** blocked until `raiseReasons`/`missingEvidence` are added to `LlmImpactAssessment` or removed from the prompt.
- **Gate ownership:** blocked until `handleClassificationGate()` module ownership is made consistent.
- **Record mutation after validation:** Section 5.6 mutates `record.tier` during commit if overlap raises the tier. Prefer computing overlap before `validateClassificationRecord()`, or recompute `requirements`, `process`, `lease.tier`, and `rationale` before storing. Otherwise persisted records can have stale requirements for the effective tier.
- **File-state drift:** the hot gate cannot read files. Drift checks must rely on precomputed fingerprints from classification snapshots, edit anchors, and prior tool results. If no fingerprint exists, fail closed for claims that rely on file state.
- **Context boundary extraction:** `context` messages may contain structured content arrays. `extractLatestUserRequest()` must concatenate text blocks safely and ignore assistant summaries.
- **Concurrent or repeated classifications:** commit must choose active process/lease by request digest, overlap, tier, sequence, and specificity; do not let a later low-tier overlapping lease hide an older high-tier floor.

### Performance concerns

The hot `tool_call` path is feasible if it stays pure:

- Hash and parse only the already-present tool input.
- Do not perform filesystem, network, LLM, shell, glob expansion, or test execution.
- Bound string scans for large `edit`, `write`, `eval`, and `task` inputs.
- Normalize paths syntactically only.
- Use finite mutation budgets and exact fingerprints to avoid repeated expensive matching.

The biggest hot-path cost will be `edit`/`ast_edit` effect extraction and hashing. That is acceptable if implemented as single-pass parsing over the input string/arrays.

### State management issues

The state model is sound but implementation must preserve these invariants:

- `holmes_classify.execute()` builds everything in locals and commits as the last step.
- A failed classifier call leaves no valid record.
- `turn_start` must not clear classification/ledger state.
- `context` digest changes are the request boundary.
- Budget is consumed only when the classification gate is the final allow point before tool execution, or the budget consumption is deferred until all later guards pass.
- Old records remain in history; lower later classifications cannot lower overlapping floors.

## Effort Estimate

Files to create/modify:

- Create: `src/classification.ts`.
- Modify: `src/types.ts`, `src/observation.ts`, `src/guards.ts`, `src/prompts.ts`, `src/main.ts`.
- Tests: update `src/main.test.ts` and likely add focused tests such as `src/classification.test.ts` / `src/classification-gate.test.ts` if the suite is split for maintainability.
- No package dependency change is required based on the local OMP/TypeBox/pi-ai APIs.

Most complex implementation sections:

1. Classification gate effect extraction and lease matching.
2. Deterministic prove-down floors/ceilings plus cumulative ledger overlap.
3. Post-classification compliance detection for Tier 2/3/4.
4. LLM assessor prompt/parser/timeout integration.
5. Event sequencing in `main.ts` around `context`, `turn_start`, `message_end`, `tool_call`, and `tool_result`.

Recommended dependency order:

1. Add/adjust `src/types.ts` domain types, constants, state factories, and stats fields.
2. Add `src/classification.ts` with pure hashing, normalization, effect summaries, floor/ceiling detection, prove-down, lease matching, and assessor helpers.
3. Add observation/compliance helpers in `src/observation.ts` while preserving marker detection as telemetry only.
4. Replace marker authorization in `src/guards.ts` with `handleClassificationGate()` wrapper over pure classification helpers.
5. Wire state, request digest handling, tool registration, event ordering, status output, and tool-result ledger updates in `src/main.ts`.
6. Rewrite prompts in `src/prompts.ts`.
7. Add unit tests for pure prove-down/gate helpers.
8. Add integration/adversarial tests.
9. Remove or retire old marker-authorization exports once tests pass.

## Verdict

The architecture is sound and the OMP API assumptions check out. The implementation is close to ready, but I would not hand it to an implementation agent as a fully self-contained no-guesswork spec until these blocking clarifications are made:

1. Align the LLM assessor prompt, parser, and `LlmImpactAssessment` type for `raiseReasons` and `missingEvidence`.
2. Resolve whether `handleClassificationGate()` lives in `guards.ts` or `classification.ts`; recommended: wrapper in `guards.ts`, pure helpers in `classification.ts`.
3. Specify the new `HolmesStats` fields or explicitly leave them implementation-local.

After those are fixed, the spec is implementation-ready. The safest implementation path is a clean cutover with conservative fail-closed defaults, then targeted tests for every hard floor/ceiling, lease mismatch, stale record, opaque tool, and sequential slicing case listed in the spec.
