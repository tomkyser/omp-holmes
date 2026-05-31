# Enforcement & Mechanism Findings: External HOLMES Classification

## Verdict

The only airtight enforcement surface in current OMP is `tool_call`. Assistant-visible markers and steer responses are observation/nudge channels, not authority. A correct design must replace “the session agent says Tier 1” with an extension-owned classification record bound to the concrete pending mutation fingerprint.

Current OMP does **not** expose a first-class `spawnTask()` / `spawnSubagent()` API to extensions. A Task-based classifier is still implementable as a **certified courier protocol**: the session agent may transport an exact extension-authored Task call, but it must not control the classifier packet or the verdict. The extension can observe the corresponding Task result through the normal `tool_result` event.

Recommended mechanism:

1. Run a deterministic in-extension fast classifier for a tiny closed set of obviously mechanical actions.
2. For everything else, block the first mutation-capable tool call, create a nonce-bound pending classification request, steer the session to issue exactly one classifier Task call, verify that Task call input exactly matches the extension-built packet, parse the matching Task `tool_result`, then unlock only the matching mutation fingerprint/envelope.
3. Never accept the session model’s own classification prose as authorization.

---

## 1. What the extension API can and cannot enforce

### Can enforce

#### `tool_call` can synchronously block every wrapped tool execution

Evidence:

- `ToolCallEventResult` supports only `{ block?: boolean; reason?: string }` (`shared-events.ts:261-270`).
- `ExtensionToolWrapper.execute()` calls `runner.emitToolCall()` before executing the actual tool, and throws when `block` is true (`wrapper.ts:145-158`).
- `emitToolCall()` awaits handlers and returns immediately on the first blocking result (`runner.ts:614-647`).

Implications:

- This is the hard gate.
- If HOLMES includes every mutation-capable tool in the effectful set, the session agent cannot mutate without satisfying the gate.
- A blocked call becomes a tool error/result visible to the model; this is the retry point.

#### `tool_call` handlers may be async, but there is no built-in timeout there

Evidence:

- `ExtensionHandler` may return `Promise<R | void>` (`types.ts:820-822`).
- `emitToolCall()` directly `await`s `handler(event, ctx)`; unlike most other events, it does not use `#runHandlerWithTimeout()` (`runner.ts:614-647`).

Implications:

- A handler can await an extension-owned classifier if HOLMES implements one itself.
- A hung classifier can hang tool execution. Any awaited classifier must have its own timeout/abort path.
- Do not do slow classification in the hot path unless bounded.

#### A `tool_call` handler can call `pi.sendUserMessage()` / `pi.sendMessage()` while returning `{ block: true }`

Evidence:

- `ExtensionAPI.sendUserMessage()` exists (`types.ts:969-973`) and the concrete API delegates to the initialized runtime (`loader.ts:205-210`).
- `sendUserMessage(..., { deliverAs: "steer" })` queues a user-role steering message (`agent-session.ts:4707-4737`, `4480-4492`).
- After tool execution/error, the agent loop checks steering and can continue with queued steering messages (`agent-loop.ts:1051-1070`, `1292`, `642-645`).

Observed behavior from code path:

1. `tool_call` handler queues a steer and returns `{ block: true }`.
2. `ExtensionToolWrapper` throws the block reason before the tool executes.
3. The agent loop emits a tool result for the blocked call.
4. The steering message is consumed before the next assistant response.

Implications:

- Block + steer is a valid retry protocol.
- The steer cannot authorize mutation; it can only tell the session what to do next.

#### `message_update` / `message_end` can observe assistant text before tool execution

Evidence:

- Assistant stream events include text/thinking/toolcall updates (`types.ts:465-470`; `agent-loop.ts:883-911`).
- Tool calls are executed after the assistant message is complete (`agent-loop.ts:599-614`).
- In this session, `src/main.ts` already updates observation state in `message_update` and reconciles on `message_end` before consulting the reasoning guard in `tool_call` (`src/main.ts:103-146`).

Important caveat:

- `message_update` extension events are queued fire-and-forget (`agent-session.ts:1404-1408`). Keep handlers synchronous and bounded. `message_end` is the reliable reconciliation point before tool execution.

Implications:

- Assistant text can be used as untrusted context or process evidence.
- Assistant text must not be the authority for the tier.

#### `tool_result` can observe Task results

Evidence:

- `tool_result` handlers receive `toolName`, `toolCallId`, `input`, `content`, and `details` (`types.ts:619-623`, `shared-events.ts:272-283`).
- The Task tool returns `details.results` with per-subagent outputs (`task/index.ts:1328-1336`).

Implications:

- A Task classifier result can return to the extension without temp files or IRC, if the Task was invoked through the parent session’s normal Task tool.
- The extension can bind a Task verdict to the classifier Task `toolCallId`, nonce, and pending mutation fingerprint.

#### `context` can inject provider-independent hidden context before the next model call

Evidence:

- `context` fires before each LLM call and can return replacement messages (`shared-events.ts:157-168`; `runner.ts:753-796`).
- It is wired as `transformContext` before provider conversion (`sdk.ts:1818-1820`; `agent-loop.ts:696-704`).

Implications:

- Use `context` to remind the model that classification is pending or to include the exact classifier packet before a retry.
- `context` fires before the assistant response, not at the pending tool call. It cannot classify a tool call synchronously by itself.

#### `before_agent_start` can inject system prompt content for parent and Task subagents

Evidence:

- `before_agent_start` can replace/append system prompt content (`types.ts:449-455`, `774-778`; `runner.ts:848-897`).
- Task `runSubprocess()` creates an `AgentSession`, initializes an extension runner, emits `session_start`, then calls `session.prompt(task)` (`task/executor.ts:1214-1260`, `1306-1364`, `1420-1421`). That prompt path triggers `before_agent_start`.

Implications:

- HOLMES can inject general safety/classifier instructions into subagents too.
- This does not by itself create an external classifier or authorize a parent mutation.
- For a classifier Task, `before_agent_start` can harden the classifier prompt, but the parent must still parse the Task result through `tool_result`.

### Cannot enforce directly

#### No first-class extension API to spawn a Task/subagent from `tool_call`

Evidence:

- `ExtensionAPI` has events, commands, actions, provider registration, and `registerTool`, but no `spawnTask`, `spawnSubagent`, or `registerAgent` surface (`types.ts:848-1006`).
- Prior research also found `resources_discover` cannot provide Task agents; it only returns skill/prompt/theme paths (`gap-4-5-delegation-messages.md:260-314`).

Implications:

- The extension cannot simply block, spawn an independent OMP Task classifier, await its result, and resume the blocked tool.
- Using exported internals such as `runSubprocess()` is technically possible but would require reconstructing Task session plumbing and is not a stable extension mechanism.

#### No “pause provider generation, classify, then resume same tool call” mechanism

`tool_call` can only allow or block. A blocked tool call is not suspended for later continuation. The model must retry after the classifier decision.

#### Steer injection cannot be the classifier

A steer message is consumed by the same session agent. If the next assistant message says “Tier 1,” that is still self-classification. It can be used to instruct the session to call the certified classifier Task, not to produce the verdict.

#### Task classifier is not objective if the session controls the prompt

If the session agent chooses the Task assignment/context, it can launder the input. A Task classifier is enforceable only when the extension constructs the full classifier packet and allows exactly that Task call.

#### IRC is not a classifier result channel for the extension

Subagents can use IRC with other agents, but the extension has no IRC receive event. Use `tool_result` for Task results.

#### Temp-file result handoff is unnecessary and worse

A classifier Task writing a temp file adds filesystem mutation, cleanup, races, and spoofing risk. It also violates the desired read-only classifier posture. The parent `tool_result` already carries the result.

#### Factory-local state is not shared across parent and subagent extensions

Task subagents create their own AgentSession/ExtensionRunner. Do not rely on ordinary closure state in `holmes(pi)` being shared. If shared state is ever needed, it must be an explicit module-level registry or event-bus protocol, but the recommended design avoids this by parsing the parent Task `tool_result`.

---

## 2. Recommended enforcement mechanism

### Core policy

The session agent may propose actions. It must never authorize their tier.

The gate should authorize only an extension-owned record:

```ts
type ClassificationSource = "deterministic" | "task_classifier";
type ClassificationStatus = "pending" | "running" | "ready" | "failed";

interface MutationFingerprint {
  classifierVersion: string;
  turnId: number;
  userPromptHash: string;
  toolName: string;
  canonicalInputHash: string;
  effectSummaryHash: string;
}

interface ClassificationDecision {
  source: ClassificationSource;
  nonce: string;
  fingerprint: MutationFingerprint;
  tier: 1 | 2 | 3;
  confidence: "high" | "medium" | "low";
  envelope: ClassificationEnvelope;
  requirements: string[];
  expiresAtTurn: number;
}

interface PendingClassification {
  nonce: string;
  fingerprint: MutationFingerprint;
  pendingToolName: string;
  pendingInput: Record<string, unknown>;
  exactTaskInput?: Record<string, unknown>;
  classifierToolCallId?: string;
  status: ClassificationStatus;
  createdAt: number;
}
```

### Effectful tool set

Classify or block all mutation-capable surfaces:

- Always effectful: `edit`, `write`, `ast_edit`, `resolve` apply, `bash`.
- Treat as effectful unless proven read-only: `eval`, browser/debug/app-control tools, custom tools, package/generator commands.
- Treat `task` as effectful unless it is the exact extension-authored classifier Task call or a separately approved read-only research/verification task.
- Read-only tools (`read`, `search`, `find`) can bypass classification.

Current HOLMES has `MUTATING_TOOLS = edit/write/ast_edit/resolve/bash` (`src/types.ts:57-60`). The classification design should broaden enforcement for `task` and mutation-capable `eval`/custom tools; otherwise those become bypasses.

### Fast deterministic path

Preserve a fast path only when the extension can classify objectively without model judgment. Keep it deliberately narrow.

Examples of possible Tier 1 allowlist candidates:

- Single-file, anchored text edit with tiny line/character delta in documentation or comments.
- Single literal typo/string replacement with no code-control-flow change.
- Config/metadata change on a known low-risk file, if exact key/value effect is parseable.

Never deterministic-Tier-1 these by default:

- `bash`.
- `eval` with filesystem/process/network capability.
- `write` replacing a whole source file.
- `ast_edit` across globs or unknown match counts.
- `resolve` unless the staged diff/action is available and fingerprinted.
- Security/auth/crypto/secrets/payment/medical/safety/deployment/build/migration/public API surfaces.
- Any incomplete effect extraction.

If the deterministic classifier is uncertain, it must escalate, not guess.

### Certified Task classifier protocol

This is the strongest implementable external-agent design under current API.

#### Step 1 — first effectful tool call

In `tool_call`:

1. Canonicalize the pending tool input.
2. Extract effect summary: affected paths, operation class, command class, payload/diff hash, risk flags.
3. Compute `MutationFingerprint`.
4. If a ready decision covers the fingerprint/envelope, enforce Tier 2/3 process requirements and allow if satisfied.
5. Else try deterministic Tier 1 classification.
6. If deterministic classification fails or escalates, create `PendingClassification` and block the tool.
7. Build exact classifier Task input from extension-owned data.
8. Queue a steer telling the session to issue exactly that Task call.

Block reason should be short and non-negotiable:

```text
[HOLMES classifier gate] Mutation blocked pending external classification for edit src/foo.ts.
Call the exact classifier Task described in the HOLMES steer message. Any mutation or non-matching Task call will remain blocked.
```

#### Step 2 — exact classifier Task call

While `PendingClassification.status === "pending"`:

- Allow read-only tools.
- Allow exactly one `task` call if and only if:
  - `event.toolName === "task"`;
  - `event.input` canonical hash equals `pending.exactTaskInput` hash;
  - agent is the extension-selected classifier agent (`quick_task`/`explore` for cheap classification, `oracle` for high-risk/ambiguous classification, depending on platform policy);
  - tasks array, context, schema, nonce, and fingerprint match exactly;
  - there are no extra tasks or extra context fields.
- Record `pending.classifierToolCallId = event.toolCallId` and set status `running`.
- Block all non-matching Task calls and all mutation-capable tools.

The session agent is only a courier. It can refuse or fail to call the classifier, but then mutation remains blocked.

#### Step 3 — parse classifier result from `tool_result`

In `tool_result`:

1. Ignore all non-Task results.
2. Ignore Task results whose `toolCallId` does not equal `pending.classifierToolCallId`.
3. Parse `event.details.results[0].output` or the text content if details are unavailable.
4. Require strict JSON containing nonce and fingerprint.
5. Reject if nonce/fingerprint mismatch, schema invalid, confidence low without escalation, or result contains unresolved unknowns inconsistent with the tier.
6. Store `ClassificationDecision` in extension state.
7. Queue a steer: classification ready; retry the exact mutation or satisfy Tier 2/3 requirements first.

Classifier output contract:

```json
{
  "nonce": "extension-generated",
  "fingerprint": "canonical pending mutation hash",
  "tier": 2,
  "confidence": "high",
  "scope": "single-file",
  "risk_features": ["behavioral_code_change"],
  "unknowns": [],
  "requirements": ["TARGET_NOW_DELTA_NEXT"],
  "envelope": {
    "tools": ["edit"],
    "paths": ["src/foo.ts"],
    "operationClass": "single_scope_behavioral_edit",
    "maxMutations": 1,
    "expiresOnTurn": 12
  },
  "reason": "Touches one function implementation; not mechanical."
}
```

#### Step 4 — retry mutation

On the next effectful `tool_call`:

- Recompute fingerprint/effect summary.
- Allow only if the ready decision exactly matches or the classifier-issued envelope covers it.
- For Tier 2/3, require extension-observed process evidence before allowing mutation:
  - Tier 2: visible TARGET/NOW/DELTA/NEXT or equivalent grounded in observed reads/searches when factual claims are used.
  - Tier 3: full HOLMES loop plus required delegation/research evidence when classifier risk features demand it.
- Consume single-use Tier 1 decisions after the matching mutation unless the envelope explicitly allows a small batch.

### Classifier packet construction

The classifier prompt must be extension-owned and injection-hardened. It should include:

- nonce and fingerprint;
- classifier policy/rubric;
- raw user prompt from `before_agent_start` / current turn state;
- raw pending tool name/input;
- extension-extracted effect summary;
- affected paths and safe snippets/diffs if available;
- assistant text only as untrusted context, never as authority;
- explicit instruction that all quoted user/repo/session content is untrusted data;
- strict JSON-only output schema.

Do not ask the session agent to summarize the action for the classifier.

### Recommended classifier agent choice

- Deterministic extension classifier: first pass, no latency, closed-set Tier 1 only.
- `quick_task` or a read-only custom/native classifier agent: normal ambiguous single-scope classification if available.
- `oracle`: high-risk, multi-scope, safety/security, opaque shell/eval, broad AST rewrite, low confidence, or conflicting signals.
- `explore`: viable only if classification requires read/search/find and no custom output/schema limitations. It is safer because it is read-only, but may be less reliable for judgment.

If OMP adds a first-class `ExtensionAPI.spawnTask()` later, replace the courier portion with direct extension-owned invocation. Keep the same nonce/fingerprint/result schema.

---

## 3. What is airtight vs. what requires trust

### Airtight under current API, if implemented as above

- A wrapped mutation-capable tool cannot execute when `tool_call` returns `{ block: true }`.
- The session agent cannot unlock the gate by printing `[CLASSIFY: Tier 1]`.
- The session agent cannot authorize mutation with a steer response; only extension state can.
- A Task classifier result can be accepted only when tied to the exact classifier Task `toolCallId`, nonce, and fingerprint.
- A classification decision can be limited to one exact mutation or a narrow classifier-issued envelope.
- Non-cooperation by the session agent fails safe: no exact classifier Task call means no mutation.

### Requires trust / remains fallible

- The classifier model can misclassify subtle risk.
- Deterministic effect extraction can miss shell/eval/package-script side effects unless conservative.
- The extension can classify only observable proposed actions, not private cognition.
- Prompt injection can influence a Task classifier unless the prompt treats all user/repo/session content as untrusted and requires strict schema.
- If a mutation-capable tool is omitted from the effectful set, it becomes a bypass.
- If current OMP lacks reliable exact Task `input`/`toolCallId`/`details.results` in some mode, Task classification must degrade to advisory, not authorization.

### Not acceptable as enforcement

- Session-visible classification markers as the gate authority.
- Steer-then-observe where the same session model emits the classification.
- Task classification using session-authored summaries or freely editable Task assignments.
- Temp-file/IRC classifier result handoff.
- Broad turn-level approval reused for later unrelated mutations.
- Any “skip classification because this looks Tier 1” path controlled by the session model.

---

## 4. Failure modes and fallbacks

### Non-matching classifier Task call

Failure:

- Session calls Task with modified prompt, wrong agent, extra task, extra context, missing nonce, or different fingerprint.

Fallback:

- Block the Task call with a precise reason.
- Re-emit or re-inject the exact classifier Task packet.
- Count as a classifier-protocol violation; do not create a new request unless the pending mutation changed.

### Classifier timeout or no result

Failure:

- Task hangs, errors, is cancelled, or does not yield parseable output.

Fallback:

- Fail closed for mutation.
- Allow read-only tools.
- Permit retry of the exact classifier Task once, or escalate to `oracle` if the first classifier was `quick_task`.
- After repeated failure, report blocked with exact missing condition: no valid external classification for fingerprint.

### Invalid classifier JSON

Failure:

- Result lacks nonce/fingerprint/tier/confidence/envelope, or includes prose around JSON.

Fallback:

- Reject as invalid.
- Re-run with stricter classifier prompt or escalate.
- Do not let the session parse/interpret it.

### Classifier returns low confidence or unknowns

Failure:

- `confidence !== "high"`, unknowns are relevant, or effect scope is unclear.

Fallback:

- Escalate to Tier 3 or run `oracle`.
- Require research/delegation before mutation.
- Never downgrade to Tier 1.

### Pending mutation changes after classification

Failure:

- Tool name, normalized args, path set, command, staged diff, or operation class changes.

Fallback:

- Invalidate exact decision.
- Reclassify changed fingerprint.
- For classifier-issued envelopes, allow only if the new action is explicitly inside the envelope.

### Multiple classifier attempts / classifier shopping

Failure:

- Session tries several classifier Task calls and surfaces the favorable one.

Fallback:

- Keep one active pending request per fingerprint.
- Block non-matching classifier calls.
- Accept only the first valid result for the pending nonce/toolCallId.
- If conflicting valid results somehow occur, take the maximum tier or fail closed.

### Opaque `bash` / `eval` / generator behavior

Failure:

- Extension cannot determine real effects.

Fallback:

- Classify at least Tier 3 or block until a more inspectable tool path is used.
- Approve shell/eval only by exact command/code fingerprint and only within a classifier-issued envelope.
- Prefer direct `edit`/`write`/`ast_edit` with parseable paths over shell mutation.

### `resolve` applies hidden pending action

Failure:

- `resolve` input does not expose the staged diff/action payload.

Fallback:

- Bind classification to pending action id plus staged preview if available.
- If staged payload is not observable to the extension, do not Tier 1 it; require Tier 3/manual platform support or block.

### New user turn / interruption

Failure:

- User changes requirements after classification request.

Fallback:

- Clear pending and ready decisions for the prior turn unless the classifier envelope explicitly survives and hashes the same user request.
- Require reclassification.

### Print/non-interactive mode

Failure:

- Block-and-retry may terminate without a human to guide the model.

Fallback:

- The safe answer is not soft-allow. Use automatic steer/continuation after block where the agent loop can consume it.
- If current mode cannot continue after classifier completion, fail closed with a diagnostic.
- Platform improvement: add direct extension-owned classifier invocation or resumable tool calls.

---

## Implementation sketch

```ts
pi.on("before_agent_start", (event) => {
  turn.userPrompt = event.prompt;
  return { systemPrompt: [...event.systemPrompt, HOLMES_SYSTEM_PROMPT] };
});

pi.on("message_end", (event) => {
  reconcileObservation(observation, event); // untrusted context/process evidence only
});

pi.on("tool_call", (event) => {
  if (isReadOnlyTool(event)) return undefined;

  if (pending && isExactClassifierTaskCall(event, pending)) {
    pending.classifierToolCallId = event.toolCallId;
    pending.status = "running";
    return undefined;
  }

  if (pending && isTaskTool(event)) {
    return block("Non-matching Task call while HOLMES classification is pending. Use the exact classifier packet.");
  }

  if (!isEffectfulTool(event)) return undefined;

  const fingerprint = fingerprintMutation(event, turn, observation);
  const decision = findCoveringDecision(fingerprint, decisions);
  if (decision && requirementsSatisfied(decision, observation, delegation)) {
    return undefined;
  }

  const deterministic = classifyDeterministically(event, fingerprint);
  if (deterministic?.tier === 1) {
    decisions.set(key(fingerprint), deterministic);
    return undefined;
  }

  pending = buildPendingClassification(event, fingerprint, turn, observation);
  pi.sendUserMessage(buildClassifierCourierPrompt(pending), { deliverAs: "steer" });
  return block(`HOLMES external classification pending for ${event.toolName}.`);
});

pi.on("tool_result", (event) => {
  if (!pending || event.toolName !== "task") return appendVerifyReminder(event);
  if (event.toolCallId !== pending.classifierToolCallId) return appendVerifyReminder(event);

  const parsed = parseClassifierResult(event, pending);
  if (!parsed.ok) {
    pending.status = "failed";
    pi.sendUserMessage(buildClassifierRetryPrompt(pending, parsed.reason), { deliverAs: "steer" });
    return appendVerifyReminder(event);
  }

  decisions.set(key(parsed.decision.fingerprint), parsed.decision);
  pending = undefined;
  pi.sendUserMessage("HOLMES external classification is ready. Retry the exact pending mutation only if its requirements are satisfied.", { deliverAs: "steer" });
  return appendVerifyReminder(event);
});
```

## Platform ask

The clean platform feature is:

```ts
const result = await ctx.spawnTaskClassifier({
  agent: "quick_task" | "oracle",
  input: classifierPacket,
  timeoutMs,
  tools: ["read", "search", "find"],
  outputSchema,
});
```

Until OMP exposes that, the certified Task courier protocol is the best current way to get an external model verdict without letting the session model be the authority.
