# Gap 4/5 Research — Delegation and `message_update`

## Scope

Research target: HOLMES Gap 4 (delegation is not operational) and Gap 5 (`message_update` stream events are unused). This is research/planning only; no source files were modified.

Primary evidence:

- HOLMES gap document: `.planning/GAPS.md`
- HOLMES extension: `src/main.ts`, `agents/holmes-researcher.md`, `agents/holmes-verifier.md`
- OMP task/agent discovery: `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/task/*.ts`
- OMP extension API/types: `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`
- OMP stream loop: `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/agent-loop.ts`
- AI event types: `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts`

---

## Executive verdict

### Gap 4 root cause

`agents/holmes-researcher.md` and `agents/holmes-verifier.md` are not merely in the wrong extension subdirectory; they are in a directory that OMP does not consult for Task subagent definitions. OMP has two similarly named concepts:

1. `src/discovery/agents.ts` scans `.agent/` and `.agents/`, but only for skills, rules, prompts, slash commands, `AGENTS.md`, and `SYSTEM.md`.
2. `src/task/discovery.ts` discovers Task subagent definitions from `.omp/agents`, `.claude/agents`, `.codex/agents`, `.gemini/agents`, user equivalents, Claude plugin `agents/`, and bundled agents.

OMP extension package sub-discovery (`omp-plugins.ts`) has no agent provider. An extension package `agents/` directory is therefore dead for Task agent discovery.

### Gap 5 root cause

The stream has the data HOLMES needs. `message_update` receives `AssistantMessageEvent` values for `text_delta`, `thinking_delta`, and tool-call streaming. HOLMES never subscribes to it, so `handleReasoningGuard()` falls back to scanning tool inputs (`src/main.ts:241-266`), which is the wrong data plane.

### Recommended fix

Use a two-part fix:

1. **Delegation:** embed a HOLMES delegation protocol in the system prompt and `/holmes` command, using bundled Task agents (`explore` for read-only research, `oracle` or `task` for verification with HOLMES verifier instructions in the assignment). Add a `tool_call` guard for `task` that blocks known-bad patterns and tells the model exactly how to retry. Do not rely on extension package `agents/` discovery.
2. **Message observation:** add `message_update`/`message_end` handlers with a bounded per-turn accumulator for visible assistant text. The reasoning guard should consult this observed text, not tool-call arguments. Thinking deltas may be recorded diagnostically, but visible evidence should be required if the goal is enforceability.

---

## 1. Agent discovery path analysis

### `.agent/` / `.agents/` provider is not Task-agent discovery

`/src/discovery/agents.ts` is named “Agents (standard) Provider”, but its header says it loads “skills, rules, prompts, commands, context files, and system prompts” from `.agent/` and `.agents/` (`discovery/agents.ts:1-6`). It defines:

```ts
const AGENT_DIR_CANDIDATES = [".agent", ".agents"] as const;
```

It then registers providers for:

- skills from `.agent/skills` and `.agents/skills` (`agents.ts:63-86`)
- rules from `.agent/rules` and `.agents/rules` (`agents.ts:88-114`)
- prompts from `.agent/prompts` and `.agents/prompts` (`agents.ts:116-146`)
- slash commands from `.agent/commands` and `.agents/commands` (`agents.ts:148-179`)
- context files (`AGENTS.md`) (`agents.ts:181-206`)
- system prompts (`SYSTEM.md`) (`agents.ts:208-230`)

There is no Task-agent capability registered in that file.

### Actual Task-agent discovery paths

`/src/task/discovery.ts` is the Task subagent discovery implementation. Its header describes agent definition discovery from:

- `~/.omp/agent/agents/*.md`
- legacy/user/project variants
- `.omp/agents/*.md`
- `.claude/agents/*.md`
- bundled agents

The current code is broader than its stale header comments. It derives source families from `getConfigDirs("", { project: false })` and `config.ts` priority order (`config.ts:9-14`, `config.ts:78-91`):

1. `.omp`
2. `.claude`
3. `.codex`
4. `.gemini`

For Task agents, `discoverAgents(cwd, home)` loads:

- user config directories: `getConfigDirs("agents", { project: false })` (`task/discovery.ts:63-69`)
  - `~/.omp/agent/agents`
  - `~/.claude/agents`
  - `~/.codex/agents`
  - `~/.gemini/agents`
- nearest project config directories: `findAllNearestProjectConfigDirs("agents", cwd)` (`task/discovery.ts:71-77`)
  - nearest `.omp/agents`
  - nearest `.claude/agents`
  - nearest `.codex/agents`
  - nearest `.gemini/agents`
- Claude plugin roots’ `agents/` directories (`task/discovery.ts:91-102`)
- bundled agents (`task/discovery.ts:113-121`)

`findAllNearestProjectConfigDirs()` walks upward from cwd and returns the nearest existing config directory per source family (`config.ts:213-242`).

### Agent frontmatter format

Task agent files are Markdown with YAML frontmatter. Parsing path:

- `parseAgent()` in `task/agents.ts:102-122`
- `parseAgentFields()` in `discovery/helpers.ts:222-271`
- `parseFrontmatter()` normalizes kebab-case keys to camelCase (`pi-utils/src/frontmatter.ts:9-37`, `:81-127`)

Required fields:

```yaml
---
name: holmes-researcher
description: Scoped read-only research agent for resolving factual unknowns
tools: read, search, find, eval
---
```

Supported optional fields:

- `tools`: CSV or array; normalized to lower-case; `yield` is auto-added if a tool list is present (`helpers.ts:230-235`)
- `spawns`: `*`, CSV, or array (`helpers.ts:237-250`)
- `model`: string, CSV, or array (`helpers.ts:198-203`, `:266`)
- `thinkingLevel` / `thinking-level` / `thinking`: parsed through `parseThinkingLevel()` (`helpers.ts:258-265`; kebab normalization in `frontmatter.ts`)
- `output`: passed through as opaque schema (`helpers.ts:257`)
- `blocking`: parsed boolean (`helpers.ts:267`)
- `autoloadSkills`: CSV/array (`helpers.ts:268-270`)

Bundled examples:

- `explore`: `name: explore`, `tools: read, search, find, web_search`, `model: pi/smol`, `thinking-level: med` (`prompts/agents/explore.md:1-30`)
- `oracle`: `name: oracle`, `spawns: explore`, `model: pi/slow`, `thinking-level: xhigh`, `blocking: true` (`prompts/agents/oracle.md:1-8`)
- `plan`: `tools: read, search, find, bash, lsp, web_search, ast_grep`, `spawns: explore` (`prompts/agents/plan.md:1-8`)
- `task` and `quick_task` are generated in `task/agents.ts:51-71` from `task.md` body plus injected frontmatter.

### How discovered agents become available to the model

The Task tool discovers agents at tool construction:

```ts
static async create(session: ToolSession): Promise<TaskTool> {
  const { agents } = await discoverAgents(session.cwd);
  return new TaskTool(session, agents);
}
```

Evidence: `task/index.ts:281-287`.

The Task tool description renders a `<agents>` list containing each available agent name and description (`task/index.ts:136-172`, `prompts/tools/task.md:72-80`). This is how the model learns the available agent names. The `agent` parameter schema is only `z.string().describe("agent type")` (`task/types.ts:77-79`); there is no JSON-schema enum. Runtime resolution is exact-name lookup:

```ts
const agent = getAgent(agents, agentName);
if (!agent) return `Unknown agent "${agentName}". Available: ...`;
```

Evidence: `task/index.ts:598-615`.

Implication: custom agents can be referenced if they are discovered and listed, but the model is guided by prompt text rather than schema constraints.

### Are agents from extension packages discovered?

No.

`omp-plugins.ts` explicitly advertises extension package sub-discovery for:

- `skills/`
- `hooks/pre|post/`
- `tools/`
- `commands/`
- `rules/`
- `prompts/`
- `.mcp.json`

Evidence: `omp-plugins.ts:1-8`, `:34-38`.

It registers providers for:

- `Skill` (`omp-plugins.ts:329-335`)
- `SlashCommand` (`:337-343`)
- `Rule` (`:345-351`)
- `Prompt` (`:353-359`)
- `Hook` (`:361-367`)
- `CustomTool` (`:369-375`)
- `MCPServer` (`:377-383`)

There is no `AgentDefinition`/Task-agent provider. Therefore `agents/holmes-researcher.md` and `agents/holmes-verifier.md` in the HOLMES extension package are not discovered.

---

## 2. Task tool dispatch mechanism

### How the model specifies agent type

The model calls the Task tool with:

```json
{
  "agent": "explore",
  "context": "shared context",
  "tasks": [
    {
      "id": "ApiShape",
      "description": "Find API shape",
      "assignment": "..."
    }
  ]
}
```

The schema is defined in `task/types.ts:73-100`:

- `agent: z.string().describe("agent type")`
- `tasks: z.array(...)`
- optional `context`, depending on `task.simple`
- optional `schema`, depending on `task.simple`
- optional `isolated`, when task isolation is enabled

The model-facing Task prompt explains that `agent` is the “agent type for all tasks” and lists available agents by name/description (`prompts/tools/task.md:21-30`, `:72-80`).

### Can the model reference custom agent definitions?

Yes, if they are in Task-agent discovery paths and not disabled/restricted:

- discovery loads custom files before bundled agents (`task/discovery.ts:104-121`)
- first-wins dedup means custom definitions can override bundled names (`task/discovery.ts:104-117`)
- execution rediscovers and resolves exact name (`task/index.ts:568-615`)

Runtime blockers:

- `task.disabledAgents` can reject a discovered agent (`task/index.ts:617-634`)
- parent `spawns` restrictions can reject agent spawning (`task/index.ts:810-829`)
- recursion depth can remove Task from child agents (`task/executor.ts:613-651`)
- `PI_BLOCKED_AGENT` prevents self-recursion (`task/index.ts:792-808`)

### Agent options list

Bundled agents are created in `task/agents.ts:44-72`:

- `explore`
- `plan`
- `designer`
- `reviewer`
- `librarian`
- `oracle`
- `task`
- `quick_task`

The Task tool description is the only “options list” the model sees. It is not an enum in the tool schema.

### Execution path

High-level flow:

1. Task tool is constructed with discovered agents (`task/index.ts:281-287`).
2. Tool description renders the current agent list (`task/index.ts:253-267`).
3. On execution, agents are rediscovered (`task/index.ts:568`).
4. Requested `params.agent` is resolved by exact name (`task/index.ts:598-615`).
5. Task tool derives model/thinking/output-schema and prompt context (`task/index.ts:647-664`, `:854-865`).
6. Each subagent is run via `runSubprocess()` (`task/index.ts:892-935`, `:949-983`).
7. `runSubprocess()` creates a separate `AgentSession` with the selected agent’s system prompt embedded in the subagent system prompt (`task/executor.ts:1207-1248`).

---

## 3. Programmatic agent registration

### ExtensionAPI has no agent registration API

`ExtensionAPI` supports:

- event subscription (`types.ts:848-898`)
- `registerTool()` (`types.ts:904-905`)
- commands, shortcuts, flags (`types.ts:911-938`)
- message rendering (`types.ts:950-951`)
- message/session actions (`types.ts:957-1006`)
- provider registration (`types.ts:1012-1045`)
- event bus (`types.ts:1047-1048`)

There is no `registerAgent()`, `spawnSubagent()`, or agent-discovery return field.

### `resources_discover` cannot register agents

`ResourcesDiscoverResult` only permits:

```ts
{
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}
```

Evidence: `types.ts:398-410`.

No agent paths, rule paths, command paths, or Task-agent definitions are accepted there.

### `registerTool()` can expose delegation-shaped tools, but not via a first-class spawn API

`registerTool()` defines model-callable tools with an `execute()` callback (`types.ts:350-377`). That gives HOLMES clear tool names like `holmes_research` and `holmes_verify`, but the extension API does not expose a high-level “spawn subagent” function.

Possible implementation routes:

1. **Use `pi.sendUserMessage()` / `pi.sendMessage()`**
   - This queues messages into the parent agent.
   - It does not create a subagent.
   - It is useful for steering/reminders, not delegation execution.

2. **Use `pi.exec()` to run an external `omp` process**
   - This can create an out-of-band agent process.
   - It loses native Task integration: shared artifacts, IRC peers, parent context, task UI/progress, recursion policies, and exact session wiring.
   - It is brittle and should not be the primary fix.

3. **Use exported internals (`pi.pi.runSubprocess` / `TaskTool`)**
   - `runSubprocess()` is exported through package exports (`src/index.ts` -> `src/tools/index.ts` -> `src/task`, and `src/task/executor.ts:546`).
   - It can run a subagent if the extension constructs an `AgentDefinition` and enough execution options.
   - Extension event/tool context exposes `cwd` and `modelRegistry`, but not the full `ToolSession` surface Task uses: settings, authStorage, eventBus, artifacts, skills, prompt templates, workspace tree, MCP manager, parent eval session, telemetry, IRC roster, etc.
   - This is technically possible but creates a parallel, partial Task implementation inside HOLMES.

Recommendation: do not implement custom delegation tools until OMP exposes a stable extension spawn API or until HOLMES deliberately accepts the integration losses. Use native Task plus prompt/guarding first.

---

## 4. Delegation fix design

### Option A — Move agent files for native discovery

#### As stated (`.agents/`): reject

Moving `agents/holmes-*.md` to `.agents/` will not make them Task agent types. `.agents/` is used by `discovery/agents.ts` for skills/rules/prompts/commands/context/system prompt, not Task subagent definitions.

#### Correct native path: `.omp/agents/` or user `~/.omp/agent/agents/`

If the files are copied to the consuming project’s `.omp/agents/` directory, or to `~/.omp/agent/agents/`, Task discovery will load them. Then the Task tool description will list `holmes-researcher` and `holmes-verifier`, and the model can call:

```json
{ "agent": "holmes-researcher", "tasks": [...] }
```

Tradeoffs:

- **Buys:** true native Task agent names; clean model-facing list; no custom tool work.
- **Costs:** extension packages cannot provide these automatically via `agents/`; requires installing/copying files into project/user config; model still needs system-prompt instructions to use them.
- **Risk:** package-local `.omp/agents/` only works when the extension package is also the cwd/repo being operated on. It does not help HOLMES when installed as an extension for another project.

Use this only as an optional install path, not as the primary extension fix.

### Option B — Embed delegation instructions in HOLMES system prompt

Embed the researcher/verifier behavior in the HOLMES prompt and instruct the model to use native bundled agents:

- For read-only unknown resolution: `Task` with `agent: "explore"`.
- For verification / senior review: `Task` with `agent: "oracle"` when judgment is required, or `agent: "task"` when a full-capability worker is appropriate and the assignment explicitly forbids edits.

Example system-prompt addition:

```markdown
## HOLMES Delegation Protocol

For Tier 3 factual unknowns, delegate before acting:
- Use Task with `agent: "explore"`.
- Include the HOLMES researcher contract in the assignment:
  - read-only
  - no edits/builds/formatters
  - answer bounded factual questions with file/line evidence
  - return Answer/Facts/Consumers/Unknowns/Searches

For Tier 2/3 post-edit verification, delegate when the change is multi-file, behavioral, or safety-sensitive:
- Use Task with `agent: "oracle"` or `agent: "task"`.
- Include the HOLMES verifier contract in the assignment:
  - no edits
  - verify changed files and acceptance criteria
  - run only targeted checks
  - report PASS/FAIL/BLOCKED with evidence
```

Also update `/holmes` prompt (`buildHolmesPrompt()`, `src/main.ts:112-137`) to require a delegation plan in the execution packet:

```markdown
Delegation:
- Research unknowns: list Task/explore packets, or state why none are needed.
- Verification: list Task/oracle verifier packet for non-trivial edits, or state why parent-only verification is sufficient.
```

Tradeoffs:

- **Buys:** works with current OMP; no discovery assumptions; low integration risk; uses maintained Task tool behavior.
- **Costs:** prompt-only compliance unless paired with `tool_call` guards; larger system prompt.
- **Risk:** model may still skip delegation unless HOLMES adds enforcement in `tool_call`/message observation.

This is the recommended primary path.

### Option C — Custom delegation tools (`holmes_research`, `holmes_verify`)

Register tools via `pi.registerTool()`:

```ts
pi.registerTool({
  name: "holmes_research",
  label: "HOLMES Research",
  description: "Delegate bounded read-only research using HOLMES researcher rules.",
  parameters: z.object({
    question: z.string(),
    files: z.array(z.string()).optional(),
    acceptance: z.string().optional(),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // either instruct model to call Task, or call runSubprocess with a constructed AgentDefinition
  },
});
```

Tradeoffs:

- **Buys:** clear model affordance; can enforce required fields; can separately count research/verification.
- **Costs:** no stable extension-level subagent dispatch; implementing via `runSubprocess()` duplicates Task session plumbing; implementing via `exec()` creates an external, poorly integrated session; implementing via `sendUserMessage()` is not delegation.
- **Risk:** parallel subagent implementation drifts from OMP Task behavior and loses integration details.

Recommendation: defer unless OMP adds `ExtensionAPI.spawnTask()` / `spawnSubagent()` or HOLMES accepts a deliberately narrower tool that blocks and instructs the model to call Task.

### Option D — `tool_call` interception for Task

`tool_call` handlers can only block with a reason (`shared-events.ts:265-270`). They cannot mutate Task input. Therefore this option cannot “inject” HOLMES instructions into an already emitted Task call.

What it can do:

- Block `Task` calls that use dead HOLMES agent names when they are not natively installed:

```ts
if (event.toolName === "task" && agent === "holmes-researcher") {
  return {
    block: true,
    reason:
      "HOLMES researcher is not a native Task agent in this session. Retry with agent: \"explore\" and prepend the HOLMES researcher contract to the assignment."
  };
}
```

- Block verification tasks whose assignment omits verifier boundaries (“no edits”, “targeted checks”, acceptance criteria).
- Block Tier 3 mutating tools if no research delegation was observed.
- Count delegation attempts for `/holmes-status`.

Tradeoffs:

- **Buys:** real enforcement because blocked tool calls do not execute; simple and compatible with current API.
- **Costs:** retry-based rather than transparent injection; requires concise actionable block reasons.
- **Risk:** over-blocking generic Task usage outside HOLMES unless gated by turn state/classification.

Recommendation: pair Option B with a conservative Option D guard.

### Recommended delegation implementation plan

1. **Stop treating package `agents/` as active.** Keep the files only as source text for prompt constants, or move their content into `src/main.ts` / `src/delegation.ts` constants. Do not claim they are discovered.
2. **Add a HOLMES delegation protocol section to `HOLMES_SYSTEM_PROMPT`.** Use bundled agent names (`explore`, `oracle`, `task`) rather than `holmes-researcher`/`holmes-verifier`.
3. **Update `/holmes` command output.** Require the model to explicitly state research and verification delegation decisions in the Layer 4 execution packet.
4. **Add Task call guard.** In the existing `pi.on("tool_call")` path, detect `event.toolName === "task"` and validate:
   - no dead HOLMES agent names unless native install is explicitly detected later
   - `explore` assignments used for HOLMES research include read-only/no-build boundaries
   - verifier assignments include no-edit, changed files, acceptance criteria, and targeted checks
5. **Use message observation state to avoid overreach.** Only enforce “must delegate before mutation” after visible Tier 2/Tier 3 classification or after `/holmes` command state, not for trivial Tier 1 turns.
6. **Optional install helper later:** add a command that prints instructions for copying agent definitions to `.omp/agents/`, rather than silently modifying user projects.

---

## 5. `message_update` event data shape and accumulation strategy

### Event type definitions

Extension event:

```ts
export interface MessageUpdateEvent {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}
```

Evidence: `extensibility/extensions/types.ts:465-470`.

AI stream event union (`@oh-my-pi/pi-ai/src/types.ts:707-729`):

```ts
type AssistantMessageEvent =
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

Assistant content blocks include:

- text: `{ type: "text"; text: string }` (`pi-ai/src/types.ts:459-463`)
- thinking: `{ type: "thinking"; thinking: string }` (`:465-470`)
- redacted thinking (`:472-475`)
- tool call: `{ type: "toolCall"; id; name; arguments; intent? }` (`:483-498`)

### Timing relative to tool calls

In the core agent loop:

- `message_update` is pushed for `text_*`, `thinking_*`, and `toolcall_*` events (`agent-loop.ts:891-911`).
- `message_end` is pushed only on `done`/`error` (`agent-loop.ts:924-936`).
- Tool calls are collected and executed after the assistant message returns (`agent-loop.ts:599-614`).
- `beforeToolCall` and actual tool execution happen inside `executeToolCalls()` after `message_end` (`agent-loop.ts:1000-1225`).

Therefore, for a normal turn, text/thinking/toolcall stream updates precede tool execution. A HOLMES `tool_call` guard can consult state accumulated from `message_update` before allowing a mutating tool.

Caveat: `AgentSession.#emitSessionEvent()` handles extension `message_update` events with `void this.#queueExtensionEvent(event)` and returns immediately (`agent-session.ts:1381-1385`). That means extension `message_update` handlers must be synchronous/cheap and update in-memory state immediately. Do not do async work in the handler if later `tool_call` gates depend on the result. As a defensive fallback, the `tool_call` guard can also inspect the latest `event.message`/final assistant message state when available.

### What counts as reasoning evidence

For enforcement, count **visible assistant text**, not hidden thinking, because the gap is “silently in your thinking” being unobservable.

Recommended evidence policy:

- Satisfying evidence must appear in `text_delta`/`text_end` content before the first mutating tool executes.
- Thinking evidence can set `hasHiddenEvidence` for diagnostics but should not clear the gate.
- Tool-call argument text should not satisfy reasoning evidence; it can be used for intent/risk detection only.

A robust visible-evidence check should require labels, not isolated keywords. For example:

```ts
const VISIBLE_ENVISION = /(?:^|\n)\s*(?:[-*]\s*)?(?:ENVISION|TARGET)\s*:/i;
const VISIBLE_DELTA = /(?:^|\n)\s*(?:[-*]\s*)?DELTA\s*:/i;
const VISIBLE_CLASSIFY = /(?:^|\n)\s*(?:[-*]\s*)?(?:CLASSIFY|TIER)\b.*\bTier\s*[123]\b/i;
```

Suggested ENVISION/DELTA/CLASSIFY gate:

```ts
hasVisibleHolmesEvidence =
  VISIBLE_ENVISION.test(window) &&
  VISIBLE_DELTA.test(window) &&
  VISIBLE_CLASSIFY.test(window);
```

For full Tier 2/3 evidence, optionally require at least two HOLMES loop labels:

- `Hone` / `TARGET`
- `Observe` / `NOW`
- `Ladder`
- `Map`
- `Establish`
- `Synthesize`

Avoid accepting a bare mention like “I should classify this” as compliance.

### Accumulator design

Keep the hot path bounded and allocation-light. Do not stringify full events on every token.

```ts
type EvidenceSource = "none" | "visible" | "thinking";

interface StreamBlock {
  kind: "text" | "thinking" | "tool";
  chunks: string[];
  chars: number;
}

interface MessageObservationState {
  turnIndex: number;
  messageOrdinal: number;
  visibleWindow: string;       // bounded rolling window for regex checks
  thinkingWindow: string;      // bounded diagnostic window
  visibleBlocks: Map<number, StreamBlock>;
  thinkingBlocks: Map<number, StreamBlock>;
  sawToolCallStart: boolean;
  sawToolCallEnd: boolean;
  firstToolName?: string;
  firstToolBeforeEvidence?: boolean;
  hasVisibleEvidence: boolean;
  hasThinkingEvidence: boolean;
  assistantEnded: boolean;
  lastAssistantText?: string;  // joined only on message_end/status/debug
}
```

Constants:

```ts
const MAX_EVIDENCE_WINDOW = 16_000;
const MAX_TRANSCRIPT_CHARS = 64_000;
```

Bounded append helper:

```ts
function appendWindow(current: string, delta: string): string {
  if (!delta) return current;
  const combined = current.length === 0 ? delta : current + delta;
  return combined.length <= MAX_EVIDENCE_WINDOW
    ? combined
    : combined.slice(combined.length - MAX_EVIDENCE_WINDOW);
}
```

Block append helper:

```ts
function appendBlock(
  blocks: Map<number, StreamBlock>,
  index: number,
  kind: StreamBlock["kind"],
  delta: string,
): void {
  if (!delta) return;
  let block = blocks.get(index);
  if (!block) {
    block = { kind, chunks: [], chars: 0 };
    blocks.set(index, block);
  }
  if (block.chars >= MAX_TRANSCRIPT_CHARS) return;
  const remaining = MAX_TRANSCRIPT_CHARS - block.chars;
  const piece = delta.length <= remaining ? delta : delta.slice(0, remaining);
  block.chunks.push(piece);
  block.chars += piece.length;
}
```

Handler sketch:

```ts
pi.on("turn_start", (event) => {
  observation = newObservation(event.turnIndex);
});

pi.on("message_update", (event) => {
  const update = event.assistantMessageEvent;

  if (update.type === "text_delta") {
    appendBlock(observation.visibleBlocks, update.contentIndex, "text", update.delta);
    observation.visibleWindow = appendWindow(observation.visibleWindow, update.delta);
    if (!observation.hasVisibleEvidence && hasVisibleEvidence(observation.visibleWindow)) {
      observation.hasVisibleEvidence = true;
      reasoningState.hasReasoned = true;
    }
    return;
  }

  if (update.type === "thinking_delta") {
    appendBlock(observation.thinkingBlocks, update.contentIndex, "thinking", update.delta);
    observation.thinkingWindow = appendWindow(observation.thinkingWindow, update.delta);
    observation.hasThinkingEvidence ||= hasVisibleEvidence(observation.thinkingWindow);
    return;
  }

  if (update.type === "toolcall_start") {
    observation.sawToolCallStart = true;
    observation.firstToolBeforeEvidence ||= !observation.hasVisibleEvidence;
    return;
  }

  if (update.type === "toolcall_end") {
    observation.sawToolCallEnd = true;
    observation.firstToolName ??= update.toolCall.name;
  }
});

pi.on("message_end", (event) => {
  if (event.message.role !== "assistant") return;
  observation.assistantEnded = true;
  observation.lastAssistantText = joinBlocks(observation.visibleBlocks);
  if (!observation.hasVisibleEvidence && hasVisibleEvidence(observation.lastAssistantText)) {
    observation.hasVisibleEvidence = true;
    reasoningState.hasReasoned = true;
  }
});
```

Use `message_end` to reconcile full content (`text_end.content` or `event.message.content`) in case provider chunking or asynchronous extension event delivery drops a delta.

### Feeding the existing reasoning guard

Replace `handleReasoningGuard()`’s tool-input evidence scan with observed visible evidence:

Current broken behavior:

```ts
if (!state.hasReasoned && hasRedirectEvidence(event.input)) {
  state.hasReasoned = true;
}
```

Recommended behavior:

```ts
if (observation.hasVisibleEvidence) {
  state.hasReasoned = true;
}

if (MUTATING_TOOLS.has(event.toolName) && !state.hasReasoned) {
  return {
    block: true,
    reason: "[HOLMES reasoning gate] No visible ENVISION/DELTA/CLASSIFY evidence observed in assistant text this turn before mutating tool ..."
  };
}
```

Remove the one-shot `reminded` bypass for non-interactive correctness, or change it to “blocked once only for Tier 1” after visible Tier classification is present. The current bypass is why Gap 2 remains a speed bump.

---

## 6. Steering message capabilities

### API shape

`ExtensionAPI.sendMessage()` accepts:

```ts
sendMessage(message, options?: {
  triggerTurn?: boolean;
  deliverAs?: "steer" | "followUp" | "nextTurn";
}): void;
```

Evidence: `types.ts:957-967`, `types.ts:1143-1151`.

`sendUserMessage()` accepts:

```ts
sendUserMessage(content, options?: {
  deliverAs?: "steer" | "followUp";
}): void;
```

Evidence: `types.ts:969-973`, `types.ts:1153-1156`.

Event handler `ctx` does not expose `sendMessage`; handlers can still call the `pi` object captured by the extension factory closure.

### Delivery behavior

When streaming:

- `sendCustomMessage(..., { deliverAs: "steer" })` calls `this.agent.steer(appMessage)` (`agent-session.ts:4594-4605`).
- `sendUserMessage(..., { deliverAs: "steer" })` calls `#queueSteer()`, which calls `this.agent.steer(...)` (`agent-session.ts:4427-4439`, `:4678-4684`).
- Core `Agent.steer()` appends to the steering queue (`agent.ts:689-695`).
- The agent loop checks steering after each tool execution when `interruptMode !== "wait"` (`agent-loop.ts:1051-1070`, `:1292`) and after each turn before continuing (`agent-loop.ts:642-645`).

Meaning:

- Steering does **not** inject into the provider’s currently streaming text. It is not a token-stream rewrite.
- Steering is consumed after the current assistant message finishes and/or after current tool execution checkpoints.
- With immediate interrupt mode, a queued steer can skip remaining tools after the current tool result is emitted.
- If queued in a `message_end` handler, it can be consumed before the next model request because the agent loop checks `getSteeringMessages()` after `turn_end` (`agent-loop.ts:642-645`).

When idle:

- `sendCustomMessage(..., { deliverAs: "nextTurn", triggerTurn: true })` can schedule an internal continuation (`agent-session.ts:4488-4519`, `:4608-4616`).
- `sendCustomMessage(..., { triggerTurn: true })` prompts immediately if client policy allows agent-initiated turns (`agent-session.ts:4628-4634`).
- `sendUserMessage(..., { deliverAs: "steer" })` queues a steering message but does not itself schedule an idle continuation. `followUp` has explicit idle auto-continue logic (`agent-session.ts:4445-4470`).

### Can this redirect “you forgot to reason”?

Yes, with boundaries:

- From `message_end`: if the assistant ended without visible HOLMES evidence, `pi.sendMessage({ customType: "holmes-redirect", content: "...", display: false }, { deliverAs: "steer" })` can inject corrective context before the next provider request in the same agent loop.
- From `tool_call`: blocking the tool with a reason is more deterministic for preventing mutation.
- From `message_update`: steering queues a later message; it does not stop current text generation. To interrupt mid-stream, TTSR or `ctx.abort()` is the correct mechanism. Extension `message_update` handlers are queued asynchronously, so do not depend on them for hard real-time stream interruption.

Recommended HOLMES usage:

1. Use `message_update` for observation/state.
2. Use `tool_call` blocking for hard gates before mutation.
3. Use `message_end` + `sendMessage(..., { deliverAs: "steer" })` for non-mutating corrective continuations when the assistant would otherwise stop without visible reasoning.
4. Use TTSR rules for true mid-stream interruption of forward-chaining prose.

---

## 7. Proposed code structures

### New state types

```ts
interface DelegationState {
  researchDelegatedThisTurn: boolean;
  verificationDelegatedThisTurn: boolean;
  taskCallsThisTurn: number;
  blockedTaskCalls: number;
}

interface HolmesTurnState {
  reasoning: ReasoningGuardState;
  observation: MessageObservationState;
  delegation: DelegationState;
}
```

### New constants

```ts
const TASK_TOOL_NAMES = new Set(["task", "Task"]);
const DEAD_HOLMES_AGENT_NAMES = new Set(["holmes-researcher", "holmes-verifier"]);

const HOLMES_RESEARCH_ASSIGNMENT_PREFIX = `
You are acting as the HOLMES researcher persona.
Boundaries:
- Read-only: do not edit/write files.
- Do not run formatters, builds, package managers, or project-wide checks.
- Resolve only the assigned factual unknown.
- Return Answer/Facts/Consumers/Unknowns/Searches with file references.
`;

const HOLMES_VERIFY_ASSIGNMENT_PREFIX = `
You are acting as the HOLMES verifier persona.
Boundaries:
- Do not edit files or reimplement the solution.
- Verify the provided TARGET, changed files, and acceptance criteria.
- Run only targeted checks necessary to prove the criteria.
- Return PASS/FAIL/BLOCKED with evidence and command results.
`;
```

### Task guard

```ts
function handleTaskDelegationGuard(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  state: HolmesTurnState,
): ToolCallEventResult | undefined {
  if (event.toolName !== "task") return undefined;

  state.delegation.taskCallsThisTurn++;

  const input = event.input as Record<string, unknown>;
  const agent = typeof input.agent === "string" ? input.agent : "";
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const assignmentText = tasks
    .map((task) => typeof task?.assignment === "string" ? task.assignment : "")
    .join("\n");

  if (DEAD_HOLMES_AGENT_NAMES.has(agent)) {
    state.delegation.blockedTaskCalls++;
    return {
      block: true,
      reason:
        `[HOLMES delegation gate] ${agent} is not discovered from extension package agents/. ` +
        `Retry with bundled agent "${agent === "holmes-researcher" ? "explore" : "oracle"}" ` +
        `and include the HOLMES ${agent === "holmes-researcher" ? "researcher" : "verifier"} contract in the assignment.`,
    };
  }

  if (agent === "explore" && /HOLMES researcher/i.test(assignmentText)) {
    state.delegation.researchDelegatedThisTurn = true;
  }

  if ((agent === "oracle" || agent === "task") && /HOLMES verifier/i.test(assignmentText)) {
    state.delegation.verificationDelegatedThisTurn = true;
  }

  return undefined;
}
```

### Message observation handlers

```ts
pi.on("turn_start", (event) => {
  stats.turnsStarted++;
  resetPrimitiveBurst(primitiveState);
  resetReasoningGuard(reasoningState);
  resetObservation(observationState, event.turnIndex);
  resetDelegation(delegationState);
});

pi.on("message_update", (event) => {
  observeAssistantDelta(event, observationState);
  if (observationState.hasVisibleEvidence) {
    reasoningState.hasReasoned = true;
  }
});

pi.on("message_end", (event) => {
  finalizeAssistantObservation(event, observationState);
  if (observationState.hasVisibleEvidence) {
    reasoningState.hasReasoned = true;
  } else if (event.message.role === "assistant" && shouldSteerForMissingReasoning(observationState)) {
    pi.sendMessage(
      {
        customType: "holmes-reasoning-redirect",
        content:
          "[HOLMES] You started a response without visible ENVISION/DELTA/CLASSIFY evidence. " +
          "Before the next action, emit a concise HOLMES block with TARGET, DELTA, and CLASSIFY.",
        display: false,
        attribution: "agent",
      },
      { deliverAs: "steer" },
    );
  }
});
```

### Updated reasoning guard

```ts
function handleReasoningGuardFromObservation(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  reasoning: ReasoningGuardState,
  observation: MessageObservationState,
): ToolCallEventResult | undefined {
  if (observation.hasVisibleEvidence) {
    reasoning.hasReasoned = true;
  }

  if (!MUTATING_TOOLS.has(event.toolName) || reasoning.hasReasoned) {
    return undefined;
  }

  return {
    block: true,
    reason:
      `[HOLMES reasoning gate] No visible ENVISION/DELTA/CLASSIFY evidence was observed ` +
      `in assistant text this turn before mutating tool ${event.toolName}. ` +
      `Emit the HOLMES block, then retry.`,
  };
}
```

---

## 8. Edge cases and risks

### Agent discovery risks

- `.agents/` is the wrong path for Task agent definitions. Use `.omp/agents/` or user `~/.omp/agent/agents/` for native Task discovery.
- Extension package `agents/` remains dead unless OMP adds an `AgentDefinition` provider to `omp-plugins.ts`.
- Task tool description is built from discovery at tool initialization, while execution rediscovers agents. Mid-session changes can cause description/execution mismatch.
- `agent` is a free string parameter, not an enum; bad names fail at runtime.

### Delegation risks

- Prompt-only delegation is not enforcement. Pair with conservative `tool_call` blocking.
- Blocking all non-delegated Tier 2 work could annoy users. Gate delegation enforcement on visible Tier 2/Tier 3 classification or explicit `/holmes` state.
- `oracle` has broad capabilities. Verifier assignments must explicitly say no edits, no reimplementation, targeted checks only.
- `explore` lacks `eval`; the current HOLMES researcher file includes `eval`. If eval is important for read-only batch inspection, use `oracle` with read-only constraints or native-install `holmes-researcher` into `.omp/agents/` with `eval` in tools.
- Subagents do not inherit conversation history; all relevant facts must be in `context` or `assignment`.

### Message observation risks

- Extension `message_update` handlers are fire-and-forget. Keep them synchronous and cheap; do not await I/O.
- Some models/providers may emit little or no visible reasoning. That is a policy decision: if HOLMES requires visible evidence, the guard should block until it appears.
- Thinking summaries may be hidden or provider-dependent; do not rely on `thinking_delta` for enforcement.
- Regex evidence can false-positive if the assistant quotes instructions. Require labeled fields and `Tier N` classification to reduce this.
- Tool call arguments stream through `toolcall_delta`; do not treat those as reasoning evidence.

### Steering risks

- `deliverAs: "steer"` is not a token-stream interrupt. It is consumed after the current assistant message/tool checkpoint.
- From idle state, `sendUserMessage(..., { deliverAs: "steer" })` queues but does not auto-continue. Use `followUp` or custom `sendMessage(..., { deliverAs: "nextTurn", triggerTurn: true })` for idle continuation.
- For hard mutation prevention, `tool_call` block is safer than `message_end` steering.

---

## 9. Concrete next changes to plan

1. Add `message_update` and `message_end` handlers to `src/main.ts`.
2. Add bounded visible-text observation state and evidence detection helpers.
3. Change `handleReasoningGuard()` to consult observation state, not `event.input`.
4. Remove or narrow `state.reminded` bypass; repeated mutating calls should pass only after visible evidence.
5. Add HOLMES delegation protocol to `HOLMES_SYSTEM_PROMPT`.
6. Update `buildHolmesPrompt()` to require explicit delegation decisions in the execution packet.
7. Add `handleTaskDelegationGuard()` before the mutating reasoning guard in the existing `tool_call` handler.
8. Update `/holmes-status` to report message observation and delegation counters.
9. Decide whether package `agents/*.md` should remain as documentation/reference, be embedded as constants, or be moved to an optional native-install path (`.omp/agents/`) with clear installation instructions.
