# Enforcement & Mechanism Review — Round 2 Thorough

## Verdict

The `holmes_classify` custom-tool direction is the right enforcement surface. In current OMP, a registered tool's `execute` function is local extension code, keeps closure access to extension state, and all normal model-callable tools are wrapped by `ExtensionToolWrapper`, which emits a synchronous `tool_call` event before the underlying tool executes. If the HOLMES gate checks extension-owned classification records there, the session model cannot unlock mutation by printing markers or copying tool-result JSON.

That is the mechanical win.

The two requested changes materially change the design:

1. **Four tiers require a new process state model.** Tier 4 is not just "Tier 3 but bigger." It is an open-ended process floor that must remain blocked until an extension-owned closure condition is met.
2. **Prove-down invalidates the current classifier pseudocode.** The design still has trigger-up language: Tier 3 signals, Tier 2 signals, then Tier 1 if no bad flags. The new rule must start at Tier 4 and step down only with positive proof. Absence of risk words, omitted unknowns, or model-supplied `operationKind` must never be proof.

The API is strong enough to enforce scope-bound mutation records. It is not strong enough to prove semantic completeness of arbitrary code/architecture work deterministically. The safe implementation is deterministic prove-down with conservative defaults: when proof is unavailable, stay at the current higher tier, usually Tier 4.

---

## 1. Enforcement airtightness

### 1.1 Exact code path for a registered `holmes_classify` call

Observed OMP path:

1. **Model emits an assistant tool call.**
   `agent-loop.ts` streams assistant message updates, then finalizes the assistant message with `message_end` before tools run (`agent-loop.ts:883-935`). Tool calls are extracted from assistant content (`agent-loop.ts:599-606`, `1019-1023`).

2. **OMP validates tool arguments before execution.**
   `executeToolCalls()` finds the tool from `currentContext.tools` by `toolCall.name` or `customWireName` (`agent-loop.ts:1033-1042`). It validates arguments with `validateToolArguments()` (`agent-loop.ts:1167-1178`). Invalid args produce an error tool result; the tool's `execute` does not run.

3. **The active tool is an `ExtensionToolWrapper`.**
   In SDK session construction, built-ins are put into `toolRegistry`, extension/custom tools are added, then every registry tool is replaced with `new ExtensionToolWrapper(tool, extensionRunner)` (`sdk.ts:1511-1529`). Registered extension tools are first adapted with `wrapRegisteredTools()` (`sdk.ts:1501-1509`; `wrapper.ts:65-73`). Dynamic MCP and RPC-host tools are also wrapped on refresh (`agent-session.ts:3587-3592`, `3635-3639`).

4. **`ExtensionToolWrapper.execute()` runs approval, then emits `tool_call`.**
   The wrapper checks approval first (`wrapper.ts:113-143`). If approval passes, it calls `runner.emitToolCall({ type: "tool_call", toolName, toolCallId, input })` (`wrapper.ts:145-153`). If any handler returns `{ block: true }`, the wrapper throws and the underlying tool is not executed (`wrapper.ts:155-164`).

5. **`ExtensionRunner.emitToolCall()` synchronously awaits handlers and short-circuits on block.**
   It iterates extension handlers in extension order; on the first blocking result it returns that block (`runner.ts:614-647`). If a handler throws, OMP records the extension error and fails closed with `{ block: true }` (`runner.ts:632-642`). Unlike generic events, `tool_call` is not run through the generic timeout wrapper.

6. **The HOLMES gate must explicitly allow `holmes_classify`.**
   The custom classifier tool is itself wrapped. Its model call also emits `tool_call` before its `execute` runs. The classification gate must treat `toolName === "holmes_classify"` as allowed, or it will deadlock.

7. **Registered tool execution preserves extension closure state.**
   `RegisteredToolAdapter.execute()` calls `registeredTool.definition.execute(toolCallId, params, signal, onUpdate, this.runner.createContext())` (`wrapper.ts:51-59`). The definition object is the exact object stored by `ConcreteExtensionAPI.registerTool()` (`loader.ts:144-151`). A `holmes_classify.execute` closure over `classificationState`, `observationState`, `toolLog`, etc. will mutate the same extension instance state that the `tool_call` gate later reads.

8. **Wrapper emits `tool_result` after the actual tool returns.**
   The wrapper executes the underlying tool (`wrapper.ts:167-179`), then emits `tool_result` with `toolName`, `toolCallId`, `input`, `content`, `details`, and `isError` (`wrapper.ts:181-191`). Tool-result handlers can modify returned content/details/error status (`wrapper.ts:193-214`; `runner.ts:571-611`). The agent loop then emits the role `toolResult` message (`agent-loop.ts:1072-1109`, `1268-1270`).

For `holmes_classify`, the authority point is step 7: local `execute` creates an extension-owned classification record. The visible tool result is audit/UX only.

### 1.2 Is `registerTool` → `execute` → extension state → `tool_call` gate mechanically airtight?

**Airtight for normal model-callable tool execution, under three conditions:**

1. `holmes_classify` is registered during extension initialization and is active.
2. Every mutation-capable tool is either in the effectful set or unknown tools default effectful.
3. The gate checks only extension-owned records, never assistant text or tool-result JSON.

With those conditions, a wrapped mutating tool cannot execute after a blocking `tool_call` result. The wrapper throws before invoking the underlying tool (`wrapper.ts:155-172`).

**Not airtight against these out-of-scope or implementation risks:**

- Other extension code can mutate the filesystem from event handlers, commands, or `pi.exec()` without being a model tool call.
- User-driven `user_bash` / `user_python` events are separate extension events, not model `tool_call` events.
- Other extensions can register conflicting tools or mutate `tool_call` event input objects; OMP does not freeze `event.input`.
- If HOLMES omits a mutation-capable tool from the effectful taxonomy, that tool becomes a bypass.
- If `holmes_classify.execute` commits partial state and then throws, the gate could see a record the model saw as failed unless implementation avoids partial commits.

### 1.3 Can the model fabricate a tool result without `execute` running?

Not a real OMP tool result.

The model can write assistant text that looks like a result, but it cannot create a role `toolResult` message with arbitrary `details`. Tool-result messages are emitted by the agent loop after tool execution or after execution failure (`agent-loop.ts:1072-1109`, `1223-1230`, `1268-1270`).

There are two important nuances:

- A validation failure or gate block creates an error tool result without the underlying tool's `execute` running. That is not a successful `holmes_classify` record.
- Another extension's `tool_result` handler can modify visible result content/details after a tool executes (`runner.ts:571-611`). That can mislead the model or user, but it still cannot create HOLMES classification state unless it has direct access to HOLMES state.

Therefore the gate must ignore visible result text and returned `details` as authority. It should authorize only records stored internally by `holmes_classify.execute`.

### 1.4 Can the model bypass the gate by calling a tool not in the effectful list?

Yes, if the implementation uses a closed mutating list and misses a mutator.

Current source has this problem. `MUTATING_TOOLS` is only `edit`, `write`, `ast_edit`, `resolve`, and `bash` (`src/types.ts:57-60`). `eval`, `task`, `browser`, `debug`, `github`, `generate_image`, MCP tools, RPC-host tools, and unknown custom tools are not covered by the current marker gate. The current `handleReasoningGuard()` allows any tool not in `MUTATING_TOOLS` (`src/guards.ts:95-119`).

The new design must invert the taxonomy:

- Read-only allowlist: `read`, `search`, `find`, `ast_grep`, `web_search`, `holmes_classify`, and truly read-only status/help tools.
- Everything else is effectful until proven read-only.

`eval` and `task` must be effectful by default. `eval` can write files or spawn processes. `task` can delegate mutation to subagents. Exact hashes can bind opaque calls; they do not make those calls Tier 1-safe.

### 1.5 Is there any mutation path that does not go through `tool_call`?

For normal model-callable tools in the active tool registry, OMP wraps the tool with `ExtensionToolWrapper`, so execution goes through `tool_call`.

Outside that model-tool path, yes:

- Extension command handlers can mutate directly.
- Extension event handlers can mutate directly, including via `pi.exec()` (`ExtensionAPI.exec` exists at `types.ts:978-979`).
- User shell/Python events are `user_bash` / `user_python`, not model `tool_call` (`types.ts:539-551`, `runner.ts:649-653`).
- External processes can mutate the workspace between classification and mutation.
- Other extensions can register tools that shadow built-ins or mutate `tool_call` inputs after HOLMES has checked them.

The HOLMES gate can be airtight for model tool calls. It cannot be a whole-process filesystem sandbox.

### 1.6 Can a registered tool's `execute` be called by something other than a model tool call?

There is no ordinary `ExtensionAPI` method for one extension to invoke another registered tool's `execute`; `getAllTools()` returns names, not tool objects (`types.ts:981-988`). In normal sessions, registered tools are adapted into active tools and invoked by the agent loop from assistant tool calls.

But `execute` is just a function on an in-process object. Harness/SDK internals or code with direct access to the tool registry can call it. `RegisteredToolAdapter` does not verify provenance; it simply forwards to the definition (`wrapper.ts:51-59`).

This is acceptable if the gate treats `holmes_classify.execute` as a local state transition and still validates user request digest, scope, paths, tools, fingerprints, and requirements before allowing mutation. Do not treat `toolCallId` or the mere fact of `execute` as a security boundary.

---

## 2. API verification

### 2.1 `execute` closure access

Confirmed.

`registerTool()` stores the exact `ToolDefinition` object in the extension's `tools` map (`loader.ts:144-151`). `RegisteredToolAdapter.execute()` later calls `definition.execute(...)` directly (`wrapper.ts:51-59`). There is no serialization boundary between registration and execution. A closure over extension-local state is valid and shared with event handlers registered from the same extension factory invocation.

Subagents are separate sessions with separate extension instances. Do not expect parent classification state to be shared with a Task subagent.

### 2.2 `toolCallId` uniqueness and forgeability

`toolCallId` is not a cryptographic nonce and is not extension-generated.

OMP passes through the assistant tool call ID:

- execution records use `toolCall.id` (`agent-loop.ts:1022-1042`),
- `tool.execute()` receives `toolCall.id` (`agent-loop.ts:1205-1208`),
- `ExtensionToolWrapper` forwards the same ID in `tool_call` and `tool_result` (`wrapper.ts:145-153`, `181-191`).

I did not find OMP code that mints a fresh unforgeable ID for extension tools or enforces uniqueness across tool calls. Providers often generate/enforce tool-call IDs, but the extension should not rely on that as a secret.

Use `toolCallId` only for local correlation/audit. Generate an extension-owned random nonce and monotonic record sequence inside `execute`. Authorization should bind to nonce + user request digest + concrete effect fingerprint/envelope, not to `toolCallId` alone.

### 2.3 Duplicate tool names and shadowing

Tool name collision handling is weak for registered tools.

Observed behavior:

- Within one extension, `registerTool()` uses `this.extension.tools.set(tool.name, ...)`; a later same-name registration overwrites the earlier one (`loader.ts:144-151`).
- Across extensions, `getAllRegisteredTools()` flattens each extension's tool map in extension order (`runner.ts:307-315`).
- SDK assembly inserts built-ins first, then extension/custom tools with `toolRegistry.set(tool.name, tool)` (`sdk.ts:1511-1524`). That means an extension tool can shadow a built-in by name.
- Then every final registry entry is wrapped (`sdk.ts:1525-1529`).
- Commands have reserved-name conflict handling (`runner.ts:412-430`); registered tools do not have equivalent conflict diagnostics in the code I read.
- RPC-host tools do have explicit conflict checks against existing non-RPC tools (`agent-session.ts:3615-3625`), but that protection is not applied to normal extension-registered tools.

Implications:

- Another extension can shadow `holmes_classify`. The model may call a tool with that name, but HOLMES `execute` will not run, so no HOLMES record is created. The gate should still block later mutations; this is fail-closed but can create loops.
- Another extension can shadow `edit`/`write`/`bash`. The HOLMES gate sees a familiar tool name but the actual semantics may be arbitrary. Effect extraction based on built-in schemas is then unsafe.
- Later duplicate registrations can change which execute function runs without changing the model-visible name.

Required design change: at startup/session start, HOLMES should verify tool-name assumptions if the API exposes enough information. At minimum, fail closed or warn loudly if `holmes_classify` is not present in `getAllTools()` or if critical built-in names appear to be shadowed. The current `ExtensionAPI.getAllTools()` exposes names only, so full source/provenance verification may require a platform improvement.

### 2.4 Can the model forge/modify `holmes_classify` parameters to bypass TypeBox validation?

The model cannot pass out-of-schema values through normal execution unless validation is lenient or a post-validation hook mutates arguments. OMP validates before `tool.execute()` (`agent-loop.ts:1167-1178`), and registered tools do not set `lenientArgValidation` in the proposed design.

But validation is not as strict as the TypeBox schema text may imply:

- `validateToolArguments()` accepts JSON-schema/TypeBox or Zod schemas (`validation.ts:968-985`).
- It normalizes optional nulls and applies coercions (`validation.ts:973-1001`).
- For `additionalProperties: false`, validation issues are flattened as `unrecognized` and `coerceArgsFromIssues()` deletes those keys, then revalidates (`validation.ts:799-833`, `901-907`).

So extra forged fields generally get stripped rather than causing a hard failure. That is safe if `execute` only sees the schema-valid subset, but tests should assert this behavior so the implementation does not depend on hard rejection of extra keys.

More importantly, TypeBox validation only validates shape. The model can still provide valid but misleading parameters: minimized paths, low-information reasoning, `operationKind: "mechanical_code"`, omitted planned actions, or invented certainty. Prove-down must treat all params as claims, not proof.

### 2.5 Does schema validation happen before or after `execute`?

Before normal `execute`.

The order is:

1. `validateToolArguments()` in `agent-loop.ts:1167-1178`.
2. optional `beforeToolCall` hook, whose context docs say mutating `args` changes what executes and is not revalidated (`pi-agent-core/src/types.ts:201-208`, `258-264`).
3. optional `transformToolCallArguments` at call time (`agent-loop.ts:1205-1208`).
4. `ExtensionToolWrapper.execute()` emits extension `tool_call`.
5. underlying registered-tool adapter invokes `definition.execute()`.

For the normal OMP path, the extension `tool_call` event and `holmes_classify.execute` see validated/coerced/transformed args. If a platform `beforeToolCall` or transform mutates args after validation, OMP does not revalidate. I did not find current coding-agent code assigning `beforeToolCall`, but SDK users can configure it.

Direct programmatic calls to `RegisteredToolAdapter.execute()` would bypass agent-loop validation unless the caller validates first.

---

## 3. Prove-down enforcement

### 3.1 Deterministic enforceability

Prove-down can be enforced deterministically if the implementation treats each step-down as a checklist of positive proof obligations and refuses to step down on uncertainty.

It cannot be implemented safely as "start at Tier 4, subtract risk flags." That would recreate the old leak: absence of a detected risk is not proof. The algorithm must be structured as:

```text
assessedTier = 4

if proveNotTier4(snapshot, concreteEffect, observedEvidence): assessedTier = 3
else return Tier 4

if proveNotTier3(...): assessedTier = 2
else return Tier 3

if proveNotTier2(...): assessedTier = 1
else return Tier 2
```

Each `proveNotTierN` must return `{ ok: true, proof: [...] }` only from extension-observed evidence or concrete effect analysis. Model claims may point to evidence; they are not evidence by themselves.

### 3.2 What counts as proof for each step-down

The design should make proof obligations explicit.

#### Tier 4 → Tier 3 proof

To prove work is not Tier 4, the extension needs positive evidence that all of these are true:

- Scope is concrete and bounded.
- Work is not architectural or multi-subsystem.
- Work is not safety-critical, security-critical, data-loss-prone, deployment/infrastructure-critical, or otherwise high-reliability domain critical.
- The relevant file/tool/effect types are known to the classifier.
- There are no deep unknowns, unresolved dependencies, missing requirements, or ambiguous user intent requiring iterative investigation.
- A single HOLMES pass is plausibly sufficient because the task has one bounded target and no open-ended design space.

If file type, tool semantics, path role, domain, or user intent is unknown, this proof fails and the tier remains 4.

#### Tier 3 → Tier 2 proof

To prove work is not Tier 3:

- Scope is single-scope and bounded.
- Required facts are already observed or directly obtainable without research/delegation.
- No relevant assumptions/unknowns remain.
- No multi-file/multi-module coordination is required.
- No opaque tool is needed, unless exact-input binding plus higher-tier process already covers it.
- The work does not require full Hone/Observe/Ladder/Map/Establish/Synthesize before mutation.

If any research/delegation/evidence gap remains, stay Tier 3.

#### Tier 2 → Tier 1 proof

Tier 1 must be a closed, mechanically provable non-semantic set:

- comments only;
- whitespace/formatting only with semantic token/AST equivalence where source code is involved;
- typo in non-code/documentation;
- non-code formatting or metadata that has no executable/configuration effect;
- generated formatting only if the formatter's effect can be proven non-semantic for the file type.

Any source-code token change that can affect runtime behavior is at least Tier 2. Any unknown file type, config format, schema, prompt/rule/hook, dependency file, test harness, deployment file, or safety/security/data surface is not Tier 1 unless the extension can prove the concrete mutation is non-semantic.

### 3.3 Current design changes required for prove-down

The current `classify-tool-design.md` still uses trigger-up pseudocode:

- collect `tier3Signals`, `tier2Signals`, and `tier1Signals`;
- choose Tier 3 if Tier 3 signals exist, else Tier 2 if Tier 2 signals exist, else Tier 1 if candidate, else Tier 3 (`classify-tool-design.md:378-444`).

That is not Tom's requested logic. It still allows "no signal detected" to contribute to a lower tier, especially in the Tier 1 candidate logic (`classify-tool-design.md:418-433`).

Required rewrite:

- Replace `HolmesTier = 1 | 2 | 3` with `1 | 2 | 3 | 4` everywhere (`src/types.ts` currently has `1 | 2 | 3`; design schema also only has literals 1-3).
- Replace `tier1/tier2/tier3Signals` with proof ledgers: `tier4StepDownProof`, `tier3StepDownProof`, `tier2StepDownProof`, and `failedProofObligations`.
- Remove wording like "no risk flags detected" as positive proof.
- Return the highest tier for which the next step-down proof failed.
- Include proof failure reasons in `details` so audit shows why the classifier stayed high.
- Make `params.proposedTier` an upward-only input: `finalTier = max(params.proposedTier, assessedTier)`, where Tier 4 is max.

### 3.4 Need for concrete effect binding

Prove-down is strongest when applied to the concrete pending mutation, not just a planned prose envelope.

The custom tool design is proactive: the model calls `holmes_classify` before mutation and provides planned actions. That is good UX, but it is weak proof for Tier 1 because the extension has not seen the actual edit/write/ast_edit payload yet.

For prove-down, one of these must be true:

1. `holmes_classify` parameters include exact normalized mutation fingerprints/diffs/operators for planned actions, and the later gate verifies exact match; or
2. the first effectful tool call is blocked, classified from the concrete pending tool input, and retried after classification; or
3. proactive classification can only step down to Tier 2/3/4, while Tier 1 is granted only at the gate when the concrete pending mutation is proven non-semantic.

Without concrete effect binding, the model can truthfully classify "fix typo in README" and later issue a broader `write`. Scope matching catches path/tool mismatch, but not semantic mismatch within a same-file source edit unless the actual payload is analyzed.

### 3.5 Unknown file types and unfamiliar patterns

Unknowns stay high.

Examples that should remain Tier 4 unless the classifier has explicit knowledge and observed evidence:

- unknown extension or generated file type;
- config files whose runtime semantics are unclear;
- prompt/rule/hook files that alter agent behavior;
- migration/data/schema files;
- dependency manifests/lockfiles;
- CI/deploy/build files;
- broad `bash`, `eval`, `task`, browser, debug, or GitHub actions;
- source edits where AST/token semantic equivalence cannot be proven.

This will over-classify. That is the intended safety property of prove-down.

### 3.6 Can the session model influence prove-down through parameters?

It can influence the candidate scope and provide claims. It must not influence the proof result downward.

Acceptable uses of model-supplied params:

- planned files/tools as a hypothesis to compare against user request and later tool input;
- exact planned mutation fingerprint for later matching;
- references to observed reads/searches/tool results;
- proposed higher tier;
- explicit assumptions/unknowns that force staying high.

Unacceptable as step-down proof:

- `operationKind: "mechanical_code"`;
- "no unknowns" in reasoning;
- absence of risk words;
- omitted paths;
- statement that a change is safe or non-semantic;
- copied classifier result JSON or nonce.

---

## 4. Four-tier enforcement

### 4.1 Mechanical difference between Tier 3 and Tier 4

From the gate's perspective, Tier 3 and Tier 4 are both process floors plus mutation leases. The difference must be represented explicitly in state:

- **Tier 3:** one complete HOLMES pass is required before mutation. After that pass and required evidence are observed, the gate may allow mutations inside a concrete scope envelope.
- **Tier 4:** the first HOLMES pass is not enough by definition. The gate keeps a Tier 4 process record open. It requires repeated HOLMES passes / research / delegation / synthesis updates until all blocking unknowns in the extension-owned ledger are resolved and a concrete mutation envelope is created.

Tier 4 cannot be implemented as "detect one full HOLMES block and allow." That collapses it into Tier 3.

### 4.2 Required Tier 4 state model

The design needs a separate process record, not just one `active` classification:

```ts
type HolmesTier = 1 | 2 | 3 | 4;

interface Tier4ProcessRecord {
  classificationId: string;
  userRequestDigest: string;
  scopeFloor: "broad" | "multi_scope" | "architectural" | "safety_critical" | "deep_uncertainty";
  requiredEvidence: string[];
  openUnknowns: Array<{
    id: string;
    text: string;
    source: "classifier" | "model" | "tool_log" | "user_request";
    blocking: boolean;
    resolvedByToolEvidence?: string[];
  }>;
  passCount: number;
  closureSatisfied: boolean;
  mutationLeaseIds: string[];
}
```

For broad work, separate:

1. **Process tier floor:** Tier 4 remains the minimum process requirement for the user request or overlapping scope.
2. **Mutation lease:** concrete tool/path/fingerprint envelopes for actual edits after the process is complete enough.

A later narrow edit classification must not erase the Tier 4 process floor for the same user request. It may create a narrow lease, but the gate should still require Tier 4 closure evidence before allowing the edit.

### 4.3 How the gate knows Tier 4 is complete

Only if completion is defined mechanically.

A safe deterministic closure check can require:

- a post-classification HOLMES pass count of at least one, with no upper bound;
- every `openUnknowns[].blocking` item resolved by observed tool evidence, read-only research, or explicitly marked non-blocking with evidence;
- no newly observed unknowns/tradeoffs/scope expansions after the latest pass;
- a concrete target, path set, tool set, mutation count, and verification plan;
- a new `holmes_classify` or `holmes_close` checkpoint that starts from Tier 4 and proves closure obligations, not merely a visible "done" claim;
- for safety-critical/architectural scopes, required independent review/delegation evidence if policy demands it.

If the gate cannot mechanically connect claimed resolution to observed evidence, it should keep the Tier 4 record open.

### 4.4 Can the model claim Tier 4 is done prematurely?

Yes, if the implementation accepts visible text headings or self-reported unknown resolution.

The gate can reduce this but not eliminate it:

- It can require observed read/search/find/task evidence.
- It can require explicit references to evidence for each open unknown.
- It can block scope expansion.
- It can preserve monotonic tier floors across overlapping classifications.
- It can refuse mutation until a concrete lease exists.

It cannot prove private cognition or semantic architectural completeness from deterministic string checks. If Tier 4 completion means "the architecture is truly settled" or "all safety implications are understood," that requires model intelligence, human review, or acceptance of residual trust. Deterministic code can enforce the process envelope; it cannot be the architect.

### 4.5 Tier 3 single pass enforcement

Tier 3 should require exactly what Tier 4 does not: a finite, observable, one-pass requirement.

Mechanically:

- classification record has `tier: 3`;
- requirements include `FULL_HOLMES_PASS_ONCE`, `RESOLVE_FLAGGED_UNKNOWNS`, and optionally `RESEARCH_OR_DELEGATION_EVIDENCE`;
- compliance is satisfied only by text observed after the classification record and reconciled on `message_end`, not by pre-classification text;
- the pass includes Hone, Observe, Ladder, Map, Establish, Synthesize;
- every classifier-flagged unknown is resolved or marked non-blocking with evidence;
- gate then allows only concrete scoped mutations.

Do not let Tier 3 satisfy Tier 4. Tier 4 needs a closure state, not just a full loop.

---

## 5. Airtight vs trust

### 5.1 Mechanically guaranteed by OMP if implemented correctly

- A wrapped tool cannot execute if a `tool_call` handler returns `{ block: true }` (`wrapper.ts:145-164`).
- Registered `holmes_classify.execute` runs as local extension code with closure access to extension state (`loader.ts:144-151`; `wrapper.ts:51-59`).
- Assistant text cannot create extension-owned classification records.
- A blocked mutation fails before the underlying tool executes.
- Validation happens before normal tool execution (`agent-loop.ts:1167-1178`).
- The gate can bind authorization to user request digest, paths, tools, concrete fingerprints, mutation budget, and extension-generated nonce.
- Non-cooperation can fail closed: no valid record means no effectful model tool executes.

### 5.2 Requires trust in deterministic classifier accuracy

- Path extraction is complete enough.
- Tool/effect extraction correctly identifies affected paths and operation class.
- Opaque input hashing is stable and includes all relevant command/code fields.
- Source-code Tier 1 proof truly detects non-semantic changes.
- Cumulative scope tracking catches slicing across multiple small classifications.
- File-state freshness detection catches drift where needed.
- Unknown file types stay high instead of being accidentally treated as ordinary text.

Prove-down reduces trust pressure by making failure conservative, but only if proof predicates are narrow.

### 5.3 Requires trust in model compliance

- Tier 2 TARGET/DELTA blocks are meaningful, not boilerplate.
- Tier 3 HOLMES phases actually reflect reasoning.
- Tier 4 loops surface all relevant unknowns instead of omitting hard ones.
- The model cites evidence honestly.
- The model retries within the approved scope instead of repeatedly mismatching and relying on block/retry churn.

The gate can enforce observable artifacts and evidence references. It cannot enforce cognition.

### 5.4 Residual gaps that cannot be fully closed with current API

- Other extensions can shadow tool names, mutate event inputs, alter result displays, or mutate the filesystem outside model tools.
- `toolCallId` is not an unforgeable nonce.
- OMP does not expose tool provenance in `getAllTools()`; HOLMES cannot fully verify that `edit` is the built-in edit tool.
- Deterministic code cannot prove semantic safety of arbitrary source edits or architectural completeness.
- User-driven shell/Python and external file changes are outside the model `tool_call` gate.
- `tool_call` handlers have no built-in timeout; a hung gate hangs tool execution.

---

## 6. Implementation risks

### 6.1 Tool registration timing

Registered tools are gathered during session construction (`sdk.ts:1501-1509`). Registered extension tools that are not `defaultInactive` are always included in the initial active set even when the normal tool filter is narrower (`sdk.ts:1719-1729`).

Risks:

- If `holmes_classify` is registered asynchronously after tool assembly, it will not be in the tool registry for that session.
- If `defaultInactive: true` is used accidentally, the model may not have access to `holmes_classify` unless explicitly activated.
- If another extension registers the same name later in load order, it can shadow HOLMES's tool.

Recommendation: register synchronously in the extension factory, `defaultInactive: false`, and add a session-start self-check that `holmes_classify` appears in active/configured tools.

### 6.2 State consistency if `execute` throws

`holmes_classify.execute` must commit state atomically.

Bad pattern:

```ts
state.records.push(record);
throw new Error("render failed");
```

The model sees a failed classifier call, but the gate may see a valid record and allow mutation.

Safe pattern:

1. Build snapshot in locals.
2. Classify in locals.
3. Build complete record in locals.
4. Validate record invariants.
5. Commit to state as the final step before returning.
6. If any error occurs before commit, no record exists.

If an error occurs after commit while rendering the result, invalidate the record in a `catch` or return a successful result with a minimal fallback rendering.

### 6.3 Handler failures and timeouts

`emitToolCall()` catches handler exceptions and blocks (`runner.ts:632-642`). That is fail-closed.

But `tool_call` handlers are awaited directly, not through `#runHandlerWithTimeout()` (`runner.ts:614-647`). A slow or hung HOLMES gate can hang tool execution. The gate must keep hot-path work bounded and avoid file reads, model calls, network calls, shell commands, and unbounded parsing inside `tool_call`.

### 6.4 Interaction with other extensions

Risks:

- Tool name shadowing has no registered-tool conflict warning.
- `tool_call` events pass mutable input objects. A later handler could mutate `event.input` after HOLMES allows, and the underlying tool receives the same `params` object.
- A prior handler could mutate input before HOLMES sees it.
- `tool_result` handlers can modify visible content/details/isError after tool execution.
- Other extensions can mutate the workspace outside model tools.

Mitigations:

- HOLMES should deep-freeze or stable-hash the event input it authorizes and, if possible, compare immediately before execution. Current wrapper does not provide an after-all-handlers pre-execute hook, so full protection may require platform support.
- Treat tool-name provenance as untrusted when unknown extensions are loaded.
- Fail closed on unexpected tool names/schemas.
- Use internal state, not result display, for authorization.

### 6.5 Approval gate ordering

`ExtensionToolWrapper` runs the user approval check before `tool_call` (`wrapper.ts:113-145`). If approval is required and no UI exists, the wrapper throws before HOLMES sees the tool call (`wrapper.ts:123-132`). That is safe for mutation because execution does not happen, but it can preempt HOLMES's clearer classification diagnostic in print/non-interactive mode.

If approval succeeds, HOLMES still gets `tool_call` before execution and can block.

### 6.6 Print mode

Print mode must not soften enforcement.

Risks:

- Missing classification block can create a repeated block/retry loop.
- Scope mismatch can create repeated classification/mismatch loops.
- Approval-before-HOLMES can fail before the HOLMES diagnostic if approval mode is not yolo/auto-approved.
- Tier 4 default can become an infinite process if closure criteria are not mechanical.

Required behavior:

- Prompt the model to call `holmes_classify` early.
- Bound repeated identical gate blocks by effect fingerprint.
- Fail closed with one diagnostic after repeated non-compliance.
- For Tier 4, report the specific open proof obligations instead of looping indefinitely.
- Never allow unclassified mutation just because no human is present.

---

## 7. Direct answers to the new design questions

### How does the four-tier system change the analysis?

It requires separating **process tier floor** from **mutation lease**.

The three-tier design could treat Tier 3 as the maximum process requirement and eventually allow mutation after one full loop. Tier 4 means some work remains blocked across multiple HOLMES passes until closure evidence exists. A single active record is insufficient. The gate needs history, overlapping risk floors, Tier 4 process records, and concrete mutation leases.

### Does prove-down address the prior gaps?

Yes, if implemented literally.

It directly addresses the main adversarial gap: a task cannot become cheap merely because escalation signals were absent. Tier 1 becomes possible only when non-semantic status is proven. Unknowns stay high. Misleading model wording cannot lower tier.

It does not solve semantic completeness. It changes the failure mode from under-classification to over-classification or blocking, which is the right safety trade.

### New edge cases and risks

- Proactive `holmes_classify` lacks concrete edit payload, so Tier 1 proof may be impossible until the pending mutation is known.
- Unknown file types will remain Tier 4 unless allowlisted with proof logic.
- Tier 4 can become a liveness sink without explicit closure criteria.
- Model can claim all unknowns are resolved unless closure is evidence-bound.
- Tool shadowing can make built-in-name effect extraction wrong.
- Event-input mutation by other extensions can change an approved call after HOLMES checks it.
- Result rendering from other extensions can mislead the model/user, though not the gate.

### What needs to change in the tool design?

- Update all tier types/schemas/details to include Tier 4.
- Replace trigger-up classifier pseudocode with prove-down proof functions.
- Replace signal arrays with proof and failed-obligation ledgers.
- Make Tier 1 require concrete non-semantic proof.
- Add Tier 4 process records with open unknowns, pass count, closure state, and evidence requirements.
- Select authorization from valid history, not a single `active` record.
- Preserve monotonic risk floors across overlapping scopes.
- Bind every mutation to concrete effect fingerprints or exact envelopes.
- Treat unknown tools as effectful by default.
- Add bounded print-mode retry handling.
- Add startup collision/provenance checks where possible.

### Is this implementable with deterministic code, or does prove-down require model intelligence?

The enforcement mechanism is deterministic.

The prove-down classifier can also be deterministic if it is conservative: it only steps down for mechanically checkable proof and otherwise stays high. That is implementable.

What is not deterministically implementable is broad semantic judgment: "this arbitrary source edit is safe," "this architecture has no hidden coupling," or "Tier 4 synthesis is truly complete." If the product requires those judgments to step down or close Tier 4 in ambiguous cases, it requires model intelligence, human review, or accepted trust. Deterministic code should not pretend to know.
