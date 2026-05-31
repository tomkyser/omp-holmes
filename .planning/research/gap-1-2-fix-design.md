# Gap 1/2 Fix Design — Visible HOLMES Evidence + Persistent Gate

## Scope

This document covers fixes for:

- **Gap 1:** the HOLMES system prompt is only a suggestion; no code observes whether the model reasoned.
- **Gap 2:** the reasoning guard is a one-shot reminder because `state.reminded` bypasses future checks.

The target fix is deliberately narrow: observe assistant output, require a visible classification marker before mutating tools, and make the mutating-tool gate persistent until that marker is actually observed.

---

## API findings

### `message_update`

Source references:

- `src/extensibility/extensions/types.ts:466-470`
- `@oh-my-pi/pi-ai/src/types.ts:707-723`
- `@oh-my-pi/pi-agent-core/src/agent-loop.ts:883-911`
- `src/session/agent-session.ts:1381-1385`, `2638-2644`

Type shape:

```ts
export interface MessageUpdateEvent {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

Runtime behavior:

- In current runtime, `message_update` is emitted for `text_start`, `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`, and `toolcall_end`.
- `start` becomes `message_start`.
- `done`/`error` become `message_end`.
- `event.assistantMessageEvent.delta` on `text_delta` is the assistant's streamed visible text token/chunk.
- `thinking_delta` is provider-exposed thinking/summary text when the provider emits it. It is not a guarantee of private chain-of-thought visibility; providers may omit it, redact it, or stream only summaries.
- `toolcall_delta` is streamed tool-call argument text, not assistant prose. It must not be counted as HOLMES reasoning evidence.
- `event.message` is the current partial assistant message. Its `content` array contains blocks such as `{ type: "text", text }`, `{ type: "thinking", thinking }`, and `{ type: "toolCall", ... }`.

Can text be accumulated?

Yes. Use `contentIndex` to keep per-block buffers, append `text_delta.delta`, and replace the block with `text_end.content` when available. Also rescan the final assistant message on `message_end` as a reconciliation pass.

Recommended accumulator shape:

```ts
interface AssistantTextObservation {
  visibleByIndex: Map<number, string>;
  thinkingByIndex: Map<number, string>;
  visibleText: string;
  thinkingText: string;
  evidence: HolmesEvidence | undefined;
}
```

Timing relative to tool calls:

- Provider stream events arrive before tool execution.
- The assistant message is completed before `executeToolCalls()` runs.
- The extension `tool_call` event is emitted from `ExtensionToolWrapper.execute()` immediately before the actual tool executes.
- Important caveat: `AgentSession.#emitSessionEvent()` queues `message_update` extension handlers fire-and-forget. Handlers must be synchronous/CPU-only and must not do I/O. A slow `message_update` handler could lag behind the later `tool_call` guard. Use `message_end` reconciliation too, and keep parsing bounded.

Conclusion:

`message_update` is suitable for passive observation and maintaining per-turn HOLMES evidence state. It is not the right surface for hard interruption; hard blocking still belongs in `tool_call` and TTSR.

### `before_provider_request`

Source references:

- `src/extensibility/extensions/types.ts:438-442`, `746`
- `src/extensibility/extensions/runner.ts:799-824`
- `src/sdk.ts:1820-1822`
- `@oh-my-pi/pi-ai/src/types.ts:340-343`
- Provider examples: Anthropic honors replacement at `anthropic.ts:1186-1189`; Google Gemini CLI honors replacement at `google-gemini-cli.ts:311-315`; OpenAI Responses and OpenAI Chat call `onPayload` but ignore its return at `openai-responses.ts:234` and `openai-completions.ts:467`.

Type shape:

```ts
export interface BeforeProviderRequestEvent {
  type: "before_provider_request";
  payload: unknown;
}

export type BeforeProviderRequestEventResult = unknown;
```

Behavior:

- Fires after OMP has transformed context messages and built the provider-specific wire payload.
- Fires before provider response headers and before any `message_start` / `message_update` events.
- Handlers are chained; if a handler returns a non-`undefined` value, `ExtensionRunner` passes that value as the next payload.
- The payload shape is provider-specific and typed as `unknown` to extensions.
- Some providers honor returned replacement payloads; some currently only support in-place mutation because they call `options?.onPayload?.(params)` without assigning the return value.

Can it inject system prompt content per request?

Technically yes, but not portably:

- OpenAI Chat payloads use `payload.messages` with `system`/`developer` entries.
- OpenAI Responses payloads use `payload.instructions` or `payload.input` developer entries depending on model/provider behavior.
- Anthropic payloads use `payload.system` plus `payload.messages`.
- Google payloads use Gemini request structures.

Because the payload is provider-specific and replacement return handling is inconsistent, this should not be the primary HOLMES enforcement path. If used, mutate in place and return the same object. Prefer `context` for provider-independent per-request reminders and `before_agent_start` for system prompt replacement at prompt start.

### `context`

Source references:

- `src/extensibility/shared-events.ts:157-168`
- `src/extensibility/extensions/types.ts:742-744`
- `src/extensibility/extensions/runner.ts:753-796`
- `src/sdk.ts:1817-1819`
- `@oh-my-pi/pi-agent-core/src/agent-loop.ts:696-704`
- `src/session/messages.ts:394-495`

Type shape:

```ts
export interface ContextEvent {
  type: "context";
  /** Messages about to be sent to the LLM (deep copy, safe to modify) */
  messages: AgentMessage[];
}

export interface ContextEventResult {
  messages?: AgentMessage[];
}
```

Behavior:

- Fires before each LLM call, before conversion to provider messages and before `before_provider_request`.
- The original session messages are not modified. Returned messages only affect the current provider request.
- Handlers receive a deep copy when possible; return a full replacement message array, not just a delta.
- `AgentMessage` includes normal LLM messages (`user`, `developer`, `assistant`, `toolResult`) and OMP custom messages. `custom` messages are converted to user-role messages before provider send.

Can it inject conversation-context messages?

Yes. This is the best provider-independent way to inject per-request HOLMES reminders. For example:

```ts
return {
  messages: [
    ...event.messages,
    {
      role: "custom",
      customType: "holmes-context-reminder",
      content: HOLMES_VISIBLE_MARKER_REMINDER,
      display: false,
      attribution: "agent",
      timestamp: Date.now(),
    },
  ],
};
```

That custom message will be converted to a user message by `convertToLlm()`.

### `sendMessage(..., { deliverAs: "steer" })`

Source references:

- `src/extensibility/extensions/types.ts:964-973`, `1143-1156`
- `src/session/agent-session.ts:4578-4605`, `4647-4685`, `4427-4439`
- `@oh-my-pi/pi-agent-core/src/agent.ts:689-703`, `721-733`, `970-977`
- `@oh-my-pi/pi-agent-core/src/agent-loop.ts:477-505`, `644-653`, `1051-1069`, `1292-1330`

Behavior:

- `pi.sendMessage(custom, { deliverAs: "steer" })` sends a custom message to `agent.steer()` while streaming.
- `pi.sendUserMessage(text, { deliverAs: "steer" })` queues a user message via `#queueSteer()`.
- Steering messages are consumed at the start of an agent loop iteration or after tool execution checks.
- With default `interruptMode: "immediate"`, steering can abort/skip remaining tools after a tool execution check notices queued steering.

What `steer` is not:

- It does not abort the current provider stream mid-token.
- It does not reliably stop the first tool call emitted by the current assistant message, because `executeToolCalls()` checks steering after each tool run, not before the first tool.
- It is therefore not sufficient as the primary Gap 1/2 enforcement mechanism.

Usable from a `message_update` handler?

Yes, but only as a soft redirect queued for the next loop/continuation. It can supplement diagnostics or non-interactive nudges, but hard enforcement must remain in `tool_call` or TTSR.

---

## Proposed fix architecture

### Core state

Replace `ReasoningGuardState` with explicit observed-output state:

```ts
type HolmesTier = 1 | 2 | 3;

type EvidenceSource = "visible_text" | "thinking";

interface HolmesEvidence {
  tier?: HolmesTier;
  marker?: string;
  source: EvidenceSource;
  matchedAt: number;
  hasLayer0Terms: boolean;
}

interface ReasoningGuardState {
  turnIndex: number;
  visibleByIndex: Map<number, string>;
  thinkingByIndex: Map<number, string>;
  visibleText: string;
  thinkingText: string;
  visibleEvidence?: HolmesEvidence;
  thinkingEvidence?: HolmesEvidence;
  hardGate: boolean;
  nonInteractiveNudgePending: boolean;
  blockedThisTurn: number;
}
```

State reset rules:

- Reset on `turn_start`.
- Preserve only aggregate stats across turns.
- Do not carry a prior turn's marker into a new turn. The marker proves this turn's reasoning only.

### Evidence detection

Use two levels of detection:

1. **Strong visible gate marker** — opens the mutating-tool gate.
2. **Weak HOLMES vocabulary** — useful for diagnostics, but does not open the gate alone.

Recommended regexes:

```ts
const CLASSIFY_MARKER =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:HOLMES\s*:\s*Tier\s*([123])|\[\s*CLASSIFY\s*:\s*Tier\s*([123])\s*\]|\[\s*Tier\s*([123])\s*\])/i;

const LAYER0_TERMS =
  /\b(?:HALT|ENVISION|LOCATE|DELTA|CLASSIFY|TARGET|Tier\s*[123]|Hone|Observe|Ladder|Map|Establish|Synthesize)\b/i;
```

Gate policy:

- `visibleEvidence.tier !== undefined` opens the gate.
- Thinking evidence alone does not open the gate. It can be logged for debugging because thinking may be hidden, summarized, omitted, or not user-visible.
- Tool-call arguments never open the gate.

Tier 1 fast path:

- `[Tier 1]`, `[CLASSIFY: Tier 1]`, or `## HOLMES: Tier 1` is sufficient.
- No additional ceremony required.

Tier 2/3:

- The marker opens the mechanical gate.
- The system prompt should require a small visible block with `TARGET`/`DELTA`/`NEXT`, but the guard should not attempt deep semantic validation. Regex semantics will be brittle; TTSR rules are better for catching forward-chain prose.

### `message_update` handler structure

```ts
function updateObservationFromAssistantEvent(
  state: ReasoningGuardState,
  event: MessageUpdateEvent,
): void {
  if (event.message.role !== "assistant") return;

  const update = event.assistantMessageEvent;
  switch (update.type) {
    case "text_start":
      state.visibleByIndex.set(update.contentIndex, "");
      break;
    case "text_delta":
      state.visibleByIndex.set(
        update.contentIndex,
        (state.visibleByIndex.get(update.contentIndex) ?? "") + update.delta,
      );
      break;
    case "text_end":
      state.visibleByIndex.set(update.contentIndex, update.content);
      break;

    case "thinking_start":
      state.thinkingByIndex.set(update.contentIndex, "");
      break;
    case "thinking_delta":
      state.thinkingByIndex.set(
        update.contentIndex,
        (state.thinkingByIndex.get(update.contentIndex) ?? "") + update.delta,
      );
      break;
    case "thinking_end":
      state.thinkingByIndex.set(update.contentIndex, update.content);
      break;

    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      // Do not count tool-call args as reasoning evidence.
      break;
  }

  refreshEvidence(state);
}

function refreshEvidence(state: ReasoningGuardState): void {
  state.visibleText = joinBlocks(state.visibleByIndex);
  state.thinkingText = joinBlocks(state.thinkingByIndex);

  state.visibleEvidence = detectHolmesEvidence(state.visibleText, "visible_text");
  state.thinkingEvidence = detectHolmesEvidence(state.thinkingText, "thinking");
}

function joinBlocks(blocks: Map<number, string>): string {
  return [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join("\n")
    .slice(0, MAX_SCAN_CHARS);
}

function detectHolmesEvidence(text: string, source: EvidenceSource): HolmesEvidence | undefined {
  const marker = CLASSIFY_MARKER.exec(text);
  if (!marker) {
    return LAYER0_TERMS.test(text)
      ? { source, matchedAt: Date.now(), hasLayer0Terms: true }
      : undefined;
  }

  const tierRaw = marker[1] ?? marker[2] ?? marker[3];
  return {
    tier: Number(tierRaw) as HolmesTier,
    marker: marker[0],
    source,
    matchedAt: Date.now(),
    hasLayer0Terms: LAYER0_TERMS.test(text),
  };
}
```

Add `message_end` reconciliation:

```ts
function reconcileAssistantMessageEnd(
  state: ReasoningGuardState,
  event: MessageEndEvent,
): void {
  if (event.message.role !== "assistant") return;
  if (!Array.isArray(event.message.content)) return;

  state.visibleByIndex.clear();
  state.thinkingByIndex.clear();

  event.message.content.forEach((block, index) => {
    if (block.type === "text") state.visibleByIndex.set(index, block.text);
    if (block.type === "thinking") state.thinkingByIndex.set(index, block.thinking);
  });

  refreshEvidence(state);
}
```

### Persistent reasoning guard redesign

Remove `reminded` entirely.

Current failing behavior:

```ts
if (!MUTATING_TOOLS.has(event.toolName) || state.hasReasoned || state.reminded) {
  return undefined;
}
state.reminded = true;
return { block: true, reason: "..." };
```

Replacement behavior:

```ts
function handleReasoningGuard(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  state: ReasoningGuardState,
  options: { hardGate: boolean },
): ToolCallEventResult | undefined {
  if (!MUTATING_TOOLS.has(event.toolName)) return undefined;

  if (state.visibleEvidence?.tier !== undefined) return undefined;

  if (!options.hardGate) {
    state.nonInteractiveNudgePending = true;
    return undefined;
  }

  state.blockedThisTurn++;
  return {
    block: true,
    reason:
      "[HOLMES reasoning gate] I have not seen a visible HOLMES classification marker " +
      "in your assistant output this turn before a mutating tool (`" + event.toolName + "`). " +
      "Emit one visible marker before retrying: `[CLASSIFY: Tier 1]` for a trivial operation, " +
      "or `## HOLMES: Tier 2` / `## HOLMES: Tier 3` with TARGET and DELTA lines for non-trivial work. " +
      "Hidden thinking and tool arguments do not count.",
  };
}
```

Recommended mutating set:

```ts
const MUTATING_TOOLS = new Set(["edit", "write", "ast_edit", "resolve", "bash"]);
```

`bash` remains included because shell commands can mutate the filesystem or external state. `resolve` should be included because applying a pending edit is a mutation.

### Non-interactive / print-mode behavior

Use `ctx.hasUI` from `ExtensionContext`:

- Interactive (`ctx.hasUI === true`): hard-block mutating tools until `visibleEvidence.tier` is present.
- Non-interactive / print / RPC (`ctx.hasUI === false`): do not hard-block, because a blocked tool can terminate the whole print-mode response with no useful retry path. Instead inject a hidden context reminder before model calls and mark violations in stats.

Implementation sketch:

```ts
pi.on("before_agent_start", (event, ctx) => {
  state.hardGate = ctx.hasUI;
  return { systemPrompt: [...event.systemPrompt, HOLMES_SYSTEM_PROMPT_VISIBLE] };
});

pi.on("context", (event, ctx) => {
  if (ctx.hasUI) return undefined;
  if (state.visibleEvidence?.tier !== undefined) return undefined;

  return {
    messages: [
      ...event.messages,
      {
        role: "custom",
        customType: "holmes-visible-marker-reminder",
        content:
          "<system-reminder>Before any mutating action, emit a visible HOLMES marker: " +
          "[CLASSIFY: Tier 1], ## HOLMES: Tier 2, or ## HOLMES: Tier 3. Hidden reasoning does not count.</system-reminder>",
        display: false,
        attribution: "agent",
        timestamp: Date.now(),
      },
    ],
  };
});

pi.on("tool_call", (event, ctx) => {
  const result = handleReasoningGuard(event, state, { hardGate: ctx.hasUI });
  if (result?.block) stats.reasoningBlocks++;
  if (!ctx.hasUI && !state.visibleEvidence?.tier && MUTATING_TOOLS.has(event.toolName)) {
    stats.reasoningSoftViolations++;
  }
  return result;
});
```

### System prompt changes

Replace the current “silently in your thinking” language. The system prompt must require a visible marker that the guard can observe.

Proposed replacement core:

````md
# HOLMES Cognitive Redirect

Before any tool call that can mutate state (`edit`, `write`, `ast_edit`, `resolve`, or `bash`), you MUST emit a visible HOLMES classification marker in your assistant text for the current turn.

Accepted markers:
- `[CLASSIFY: Tier 1]` — trivial, all facts known, act directly.
- `## HOLMES: Tier 2` — larger known-fact work; perform one HOLMES pass, then execute.
- `## HOLMES: Tier 3` — assumptions/unknowns exist; resolve them before execution.

Hidden thinking does not satisfy this requirement. Tool arguments do not satisfy this requirement.

Tier 1 fast path:
- Emit `[CLASSIFY: Tier 1]` and proceed. No ceremony.

Tier 2/3 visible block:
```text
## HOLMES: Tier 2|3
TARGET: concrete end state and acceptance criteria.
NOW: verified facts and constraints.
DELTA: what must change or be learned before mutation.
NEXT: first safe action.
```

If you attempt a mutating tool before the marker, the HOLMES reasoning gate will block the tool. On block, emit the marker/block, then retry.
````

Keep the existing HOLMES inner-loop description after this visible-marker contract, but make the marker contract the first instruction.

### Optional `before_provider_request` use

Do not depend on `before_provider_request` for the core fix. It is useful only as a best-effort provider-payload nudge.

If used, write defensive type guards and mutate in place:

```ts
pi.on("before_provider_request", (event) => {
  if (!state.injectProviderReminder) return undefined;

  const payload = event.payload;
  if (isOpenAIChatPayload(payload)) {
    payload.messages.unshift({ role: "system", content: HOLMES_VISIBLE_MARKER_REMINDER });
    return payload;
  }

  if (isOpenAIResponsesPayload(payload)) {
    payload.instructions = payload.instructions
      ? `${HOLMES_VISIBLE_MARKER_REMINDER}\n\n${payload.instructions}`
      : HOLMES_VISIBLE_MARKER_REMINDER;
    return payload;
  }

  if (isAnthropicPayload(payload)) {
    payload.system = prependAnthropicSystem(payload.system, HOLMES_VISIBLE_MARKER_REMINDER);
    return payload;
  }

  return undefined;
});
```

This is lower priority than `context`, because provider payload shapes and replacement semantics vary.

---

## Edge cases and risks

1. **Hidden thinking is not reliable evidence.** `thinking_delta` may exist, but private reasoning is not guaranteed to be present or visible. Do not open the gate from thinking text.

2. **Extension `message_update` dispatch is fire-and-forget.** Keep the handler synchronous and bounded. Use `message_end` reconciliation. If a rare race causes a false block, the persistent gate will pass on retry once the visible marker is observed.

3. **Tool-call arguments can contain HOLMES words.** The current implementation scans `event.input`; the replacement must not. Tool args are exactly the wrong place to prove reasoning.

4. **Marker spoofing is possible.** A model can emit `[CLASSIFY: Tier 1]` without real reasoning. This fix enforces an observable checkpoint, not semantic truth. TTSR rules and better prompt wording should catch forward-chain prose; semantic verification remains hard.

5. **Print mode cannot rely on hard retry.** In non-interactive mode, a hard block can be terminal. Use hidden context injection and stats instead of blocking.

6. **Provider payload hooks are inconsistent.** Some providers ignore returned replacement payloads. Use in-place mutation if `before_provider_request` is used at all.

7. **Multiple assistant text blocks.** Always track by `contentIndex`, not by blindly appending all `event.message.content`, or text can duplicate on `text_end`.

8. **Multiple turns in one user prompt.** `turn_start` fires for continuations after tools/steering. Reset the marker per turn if the requirement is “this turn before mutation.” If the desired policy is “once per user prompt,” reset on `agent_start` instead. For Gap 1/2, per-turn reset is safer and matches the existing guard behavior.

9. **Bash false positives/negatives.** Treating all `bash` as mutating is conservative. If that is too strict, split into always-mutating file commands vs read-only commands later. Do not do that in the first fix; a simple conservative gate is easier to reason about.

---

## Concrete implementation plan

1. Update state types:
   - Remove `reminded`.
   - Add visible/thinking block buffers and evidence fields.
   - Add stats for `reasoningBlocks`, `reasoningSoftViolations`, and `visibleMarkersObserved`.

2. Update prompt:
   - Replace “silently in your thinking” with a visible marker contract.
   - Add exact accepted markers.
   - Preserve Tier 1 fast path.

3. Add pure helpers:
   - `updateObservationFromAssistantEvent(state, event)`
   - `reconcileAssistantMessageEnd(state, event)`
   - `detectHolmesEvidence(text, source)`
   - `hasVisibleClassification(state)`
   - Unit-test these helpers with text deltas, multi-block messages, thinking-only evidence, and tool-call deltas.

4. Register new handlers:
   - `message_update`: update text observation.
   - `message_end`: reconcile final assistant text.
   - `context`: inject hidden reminder in non-interactive mode when no visible marker has been seen.

5. Redesign `handleReasoningGuard`:
   - Check only visible evidence state.
   - Remove `state.reminded` bypass.
   - Block every mutating tool in interactive mode until a visible marker is present.
   - Soft-nudge in non-interactive mode.

6. Keep primitive-burst and verify-reminder behavior unchanged.

7. Verification to run when implementation happens:
   - Unit tests for detection helpers.
   - Unit tests that `text_delta` opens the gate only after a marker.
   - Unit tests that `thinking_delta` and tool input do not open the gate.
   - Unit tests that repeated mutating calls remain blocked until marker appears.
   - A small interactive smoke session: first ask for an edit without marker and confirm the tool is blocked; then emit `[CLASSIFY: Tier 1]` and confirm the edit proceeds.
