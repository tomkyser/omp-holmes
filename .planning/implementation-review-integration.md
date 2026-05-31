# HOLMES implementation integration review

Review basis:
- Read `.planning/implementation-spec.md` in full (lines 1-3457).
- Read OMP extension API types at `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts` and `shared-events.ts`.
- Reviewed current `src/` files on disk after StaffEngineer2's prompt update: `src/types.ts`, `src/observation.ts`, `src/guards.ts`, `src/main.ts`, `src/prompts.ts`, and absence of `src/classification.ts`.
- No commands were run.

## 1. Contract verification results

### `src/types.ts` -> all modules

| Contract | Expected by spec | Current result |
|---|---|---|
| `HolmesTier` | `1 | 2 | 3 | 4` | FAIL: still `1 | 2 | 3` at `src/types.ts:1`. |
| Classification domain types | `ImpactAssessment`, `ScopeEnvelope`, `MutationLease`, `ClassificationRecord`, `HolmesClassificationState`, `HolmesTurnMetadata`, `HolmesToolCallLog`, `ProveDownResult`, `HolmesClassifyParams`, `HolmesClassifyDetails`, etc. | FAIL: none are present in `src/types.ts:1-103`. |
| Tool taxonomy | `READ_ONLY_TOOLS` includes `read/search/find/ast_grep/web_search/holmes_classify`; `KNOWN_EFFECTFUL_TOOLS` includes `edit/write/ast_edit/resolve/bash/eval/task/debug/browser/github/generate_image`; unknown tools effectful. | FAIL: still old `PRIMITIVE_TOOLS` and narrow `MUTATING_TOOLS` at `src/types.ts:57-60`; `eval`, `task`, `debug`, `browser`, `github`, `generate_image`, unknown tools are not covered. |
| Marker regex | Tier 1-4 telemetry only. | FAIL: regex only matches tiers 1-3 at `src/types.ts:68`; marker is still used as authorization through guards/main. |
| State factories | `createClassificationState`, `createToolCallLog`, turn metadata factory/update helpers. | FAIL: absent; only old observation/delegation/stats factories at `src/types.ts:71-103`. |
| Stats | Classification records, gate blocks, LLM assessor outcomes, Tier 4 passes, last block, repeated blocks. | FAIL: old stats only at `src/types.ts:44-55` and `src/types.ts:90-103`. |

### `src/classification.ts` -> `src/guards.ts` / `src/main.ts`

| Contract | Expected by spec | Current result |
|---|---|---|
| File existence | New `src/classification.ts`. | FAIL: file does not exist. |
| Tool registration | `HOLMES_CLASSIFY_TOOL`, `buildHolmesClassifyParamsSchema(Type)`, `registerHolmesClassifyTool(...)`. | FAIL: absent; `src/main.ts` does not import or call any classification registration. |
| Prove-down | `assessImpactTier`, Tier 4 start, proof-down records, deterministic floors/ceilings, LLM assessor upward-only integration. | FAIL: absent. |
| Gate helpers | `summarizePendingEffect`, stable hashing, scope/effect matching, freshness/invalidation, record/lease coverage. | FAIL: absent. |
| Import compatibility | `guards.ts` may import pure helpers from `classification.ts`; `classification.ts` must not import `guards.ts`. | NOT VALIDATABLE because `classification.ts` is absent. Current `guards.ts` imports only old `types` and `observation` APIs. |

### `src/observation.ts` -> `src/guards.ts` / `src/classification.ts`

| Contract | Expected by spec | Current result |
|---|---|---|
| Visible marker handling | Marker detection remains telemetry/compliance only. | FAIL: `hasVisibleClassification()` returns authorization evidence at `src/observation.ts:66-70` and is consumed by `src/guards.ts:100-104`. |
| Compliance helpers | `redactSelfClassification`, `extractPathMentions`, `detectAssistantBroadenedScope`, `detectTier2Compliance`, `detectTier3SinglePassCompliance`, `detectTier4Pass`, evidence-reference extraction. | FAIL: none are present in `src/observation.ts:1-152`. |
| Tier 4 marker support | Telemetry regex supports Tier 4. | FAIL: local bare marker regex only supports `[123]` at `src/observation.ts:9-10`; source marker regex in `types.ts` also only supports `[123]`. |

### `src/guards.ts` -> `src/main.ts`

| Contract | Expected by spec | Current result |
|---|---|---|
| Primary mutation gate | `handleClassificationGate(args)` using classification state, observation state, turn metadata, tool log, delegation. | FAIL: absent. `src/guards.ts` still exports `handleReasoningGuard()` at `src/guards.ts:95-119`. |
| Marker authorization removal | Visible markers must not authorize mutation. | FAIL: `handleReasoningGuard()` sets `state.hasReasoned` from visible marker (`src/guards.ts:100-102`) and allows all old mutating tools when `hasReasoned` is true (`src/guards.ts:104-105`). |
| Effectful tool coverage | Gate covers `eval`, `task`, `debug`, `browser`, `github`, `generate_image`, unknown custom tools. | FAIL: old `MUTATING_TOOLS` excludes these tools; `handleReasoningGuard()` therefore lets them execute unclassified (`src/types.ts:59`, `src/guards.ts:104-105`). |
| Verify reminder scope | Expanded to appropriate mutation/effectful tools, excluding read-only and `holmes_classify`. | FAIL/PARTIAL: old reminder only covers `edit/write/resolve/ast_edit` via `VERIFY_TOOLS` (`src/types.ts:60`, `src/guards.ts:163-189`). |
| Delegation guard | Keep dead HOLMES-agent block, but do not let valid `task` bypass classification. | FAIL: valid `task` returns `undefined` in `handleDelegationGuard()` (`src/guards.ts:121-160`) and is not classified by old reasoning guard because `task` is absent from `MUTATING_TOOLS`. |

### `src/main.ts` wiring

| Contract | Expected by spec | Current result |
|---|---|---|
| `registerHolmesClassifyTool` | Register before handlers. | FAIL: no import or registration. |
| Classification state | Create classification state, turn metadata, tool log. | FAIL: old `reasoningState` only (`src/main.ts:34-38`). |
| `context` handler | Capture latest user request digest and expire records only on new user request. | FAIL: no `context` handler. |
| `turn_start` | Reset primitive/delegation/currentTurn only; do not reset classification/observation solely on turn start. | FAIL: resets reasoning and observation every turn at `src/main.ts:90-96`. |
| `message_update` / `message_end` | Observation plus compliance/broadened-scope telemetry; no authorization. | FAIL: both set `reasoningState.hasReasoned` from visible classification at `src/main.ts:103-117`. |
| `tool_call` order | Allow `holmes_classify`; primitive; dead-agent delegation; classification gate; stats. | FAIL: no `holmes_classify` exception or classification gate. Old reasoning guard runs at `src/main.ts:119-146`. |
| `tool_result` | Update tool-result log/verification outcome; no reminder for `holmes_classify`. | FAIL/PARTIAL: only appends old reminder (`src/main.ts:148-152`). |
| `/holmes-status` | Show request digest, active tier/lease, record count, Tier 4 blockers, last block, assessor stats, marker telemetry. | FAIL: old status counters only at `src/main.ts:58-83`. |

### `src/prompts.ts`

| Contract | Expected by spec | Current result |
|---|---|---|
| System prompt | Impact checkpoint prompt using `holmes_classify`, four tiers, prove-down, binding scope, no marker authorization. | PASS: `src/prompts.ts:1-105` matches the spec intent. |
| `/holmes` helper | Four impact tiers and `holmes_classify`; visible self-classification advisory only. | PASS: `src/prompts.ts:127-141`. |
| `/holmes-goal` helper | Received outcome, behavior should/should not change, downstream surfaces, proof needed. | PASS: `src/prompts.ts:144-157`. |
| Runtime consistency | Prompt must align with available tool/gate. | FAIL at integration level: prompt instructs calling `holmes_classify`, but the tool is not registered anywhere. |

### Circular imports

No new cycle is present because `src/classification.ts` is absent. Current graph is old and acyclic (`main -> guards/observation/types/prompts`, `guards -> observation/types`, `observation -> types`). The required new graph cannot be validated.

## 2. End-to-end scenario trace results

### 1. Happy path
Expected: user request -> model calls `holmes_classify` -> execute prove-down -> record stored -> edit -> gate checks record/lease -> allows.

Result: FAIL. `holmes_classify` is not registered. No execute path, classification state, record, lease, proof-down, or gate exists. A model following the updated prompt will attempt a nonexistent tool.

### 2. Block path
Expected: edit without classifying blocks with instruction to call `holmes_classify`.

Result: FAIL. Current block path is old marker gate: `handleReasoningGuard()` blocks only tools in narrow `MUTATING_TOOLS` and tells the model to emit a visible marker (`src/guards.ts:108-118`), not to call `holmes_classify`.

### 3. Scope mismatch
Expected: classify for file A, edit file B -> block.

Result: FAIL/NOT IMPLEMENTED. There are no leases, path normalization, effect fingerprints, or scope matching. If a visible marker was observed, old gate would allow edits to any path for covered old mutating tools.

### 4. Tier escalation / missing TARGET-DELTA
Expected: Tier 2 classification then no post-classification TARGET/DELTA -> gate blocks.

Result: FAIL/NOT IMPLEMENTED. No classification records or requirement enforcement. Old visible marker gate has no post-classification sequence check and no TARGET/DELTA enforcement.

### 5. Sequential slicing
Expected: README Tier 1 then auth file classification inherits cumulative ledger floor.

Result: FAIL/NOT IMPLEMENTED. No cumulative ledger exists. Old `turn_start` resets authorization state and observation (`src/main.ts:90-96`), and same-turn visible marker authorization is global rather than scoped.

### 6. LLM assessor path
Expected: ambiguous classification triggers extension-owned assessor; higher tier stored.

Result: FAIL/NOT IMPLEMENTED. No assessor code, model call, strict JSON parser, timeout handling, upward-only integration, or assessor stats exist.

## 3. OMP API compatibility check

Verified OMP API facts:
- `ExtensionAPI.registerTool<TParams, TDetails>(tool)` exists; `ToolDefinition.execute` receives `(toolCallId, params, signal, onUpdate, ctx)` and returns `Promise<AgentToolResult<TDetails>>`.
- `ExtensionContext` exposes `cwd`, `sessionManager`, `modelRegistry`, and `model`; it does not expose `ctx.complete()` or `ctx.readFile()`.
- `tool_call` handlers return `ToolCallEventResult | undefined`; `ToolCallEventResult` supports only `{ block?: boolean; reason?: string }`.
- `before_agent_start` may return `{ systemPrompt: string[] }`.
- `pi.typebox.Type` supports the TypeBox-style builders needed by the spec.

Current compatibility:
- `before_agent_start` injection is API-compatible (`src/main.ts:98-101`) and now injects the updated prompt.
- Existing `tool_call` and `tool_result` handler return shapes are API-compatible, but they implement the wrong behavior.
- `registerTool` usage is absent, so `holmes_classify` compatibility cannot be validated and the extension does not meet the spec.
- TypeBox schema construction is absent.
- Event handler signatures in current code are syntactically compatible with OMP, but the required `context` handler and classification tool execute path are missing.

## 4. State lifecycle analysis

Current state:
- Persists only in closure-local `primitiveState`, `reasoningState`, `observationState`, `delegationState`, and `stats` in `src/main.ts:33-38`.
- `turn_start` resets primitive state, reasoning state, observation state, and delegation state on every turn (`src/main.ts:90-96`).
- No state is keyed to latest user request digest.
- No classification history, leases, ledger, active process, active lease, tool log, last block map, rule version, or sequence counter exist.
- Visible markers update `reasoningState.hasReasoned` during streaming/end events (`src/main.ts:103-117`).

Spec mismatch:
- Records cannot persist across internal continuations because no records exist.
- Records cannot be invalidated on new user request or scope changes because no request digest/context handler exists.
- Scope changes, broadened-scope statements, verification failures, file-state drift, repeated blocks, and mutation budgets are not tracked.
- Tool log accumulation is absent; only coarse counters are kept.

## 5. Verdict

FAIL.

Only `src/prompts.ts` currently matches its portion of the new spec. The foundational type system, `src/classification.ts`, classification gate, OMP tool registration, state lifecycle, prove-down algorithm, lease matching, and end-to-end enforcement are missing or still old visible-marker logic.

## 6. Issues and fix guidance

### CRITICAL: `holmes_classify` tool is not implemented or registered

Evidence: `src/classification.ts` absent; `src/main.ts` has no `registerHolmesClassifyTool` import/call.

Impact: Happy path and all classification-dependent enforcement cannot execute. Updated prompt directs the model to a nonexistent tool.

Fix guidance: Add `src/classification.ts` per spec sections 2.20-2.22, 3, 4, 5, and register it in `src/main.ts` before event handlers using `pi.typebox.Type` at registration time.

### CRITICAL: visible markers still authorize mutation

Evidence: `hasVisibleClassification()` is consumed by `handleReasoningGuard()` (`src/observation.ts:66-70`, `src/guards.ts:95-119`), and `main.ts` sets `reasoningState.hasReasoned` from visible text (`src/main.ts:103-117`).

Impact: Directly violates the core invariant that assistant prose is untrusted and markers are telemetry only.

Fix guidance: Remove `handleReasoningGuard()` from authorization flow. Keep marker detection only as telemetry/compliance evidence. Wire `handleClassificationGate()` instead.

### CRITICAL: effectful tool coverage is unsafe and incomplete

Evidence: `MUTATING_TOOLS` only includes `edit`, `write`, `ast_edit`, `resolve`, `bash` (`src/types.ts:59`).

Impact: `eval`, `task`, `debug`, `browser`, `github`, `generate_image`, and unknown custom tools can execute without classification.

Fix guidance: Replace old taxonomy with `READ_ONLY_TOOLS` and `KNOWN_EFFECTFUL_TOOLS`; default unknown tools to effectful. Ensure `task` is classified even when dead-agent delegation guard allows it.

### CRITICAL: new type system and state model are absent

Evidence: `src/types.ts:1-103` contains only old guard/observation types and counters.

Impact: Other modules cannot implement records, leases, ledgers, proof-down, LLM assessor, or gate contracts.

Fix guidance: Implement the spec section 2 types/constants/factories, including four-tier `HolmesTier`, classification state, tool log, scope/lease/record types, requirements, impact/proof types, stats, and factories.

### CRITICAL: gate cannot enforce scope/effect/freshness/requirements

Evidence: no lease/fingerprint/scope helpers; old `handleReasoningGuard()` authorizes globally after marker.

Impact: Scope mismatch, changed payloads, file-state drift, mutation budget exhaustion, Tier 2/3/4 process requirements, and gate-time hard floors are unenforced.

Fix guidance: Implement pure hot-path helpers in `classification.ts` and `handleClassificationGate()` wrapper in `guards.ts`; wire it from `main.ts` in the specified handler order.

### HIGH: request-bound lifecycle is missing

Evidence: no `context` handler; `turn_start` resets observation/reasoning each turn (`src/main.ts:90-96`).

Impact: Internal continuations and user-request boundaries cannot be distinguished; sequential slicing and classifier shopping cannot be prevented.

Fix guidance: Add `context` handler to capture latest user-role request digest, expire records only on digest change, reset ledger/observation only for new request, and preserve classification across internal continuations.

### HIGH: observation compliance helpers are missing

Evidence: `src/observation.ts` only implements old marker detection/accumulation.

Impact: Tier 2 TARGET/DELTA, Tier 3 full pass, Tier 4 fixed-point closure, evidence references, path mentions, and broadened-scope invalidation cannot be evaluated.

Fix guidance: Add the helpers listed in spec section 1.2/8.4/8.5 and ensure they feed telemetry/compliance only, not direct authorization.

### HIGH: LLM assessor path is missing

Evidence: no `classification.ts`, no assessor factory/parser/model call/stats.

Impact: Ambiguous middle-tier classifications cannot be raised/retained by the extension-owned assessor, and assessor failure modes are unrepresented.

Fix guidance: Implement assessor using `@oh-my-pi/pi-ai` `completeSimple`, `ctx.modelRegistry.getApiKey`, bounded JSON evidence packets, timeout/abort control, strict parser, and upward-only integration.

### MEDIUM: `/holmes-status` remains old

Evidence: status output only prints old counters (`src/main.ts:58-83`).

Impact: Operators cannot inspect request digest, active process/lease, record count, Tier 4 blockers, last block, repeated blocks, or assessor outcomes.

Fix guidance: Update after classification state exists.

### MEDIUM: tests still assert old marker-gate behavior

Evidence: `src/main.test.ts:284-345` imports and tests `handleReasoningGuard()` and visible-marker authorization.

Impact: Current tests would preserve the behavior the spec removes.

Fix guidance: RedTeam1 should replace these with classification tool/gate/e2e tests from spec section 10 once implementation exports land.
