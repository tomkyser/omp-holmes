# Enforcement Specialist Round 2 — OMP API Mechanics

## Source note

The requested file `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/agent/agent-loop.ts` does not exist in this installed OMP tree. The concrete execution loop used by the coding-agent SDK comes through `Agent` imported from `@oh-my-pi/pi-agent-core` (`[sdk]` lines 1-10), and `Agent` invokes `agentLoop()` / `agentLoopContinue()` from that core package (`[core-agent]` lines 985-987).

## Citation shorthand

- `[ext-types]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`
- `[loader]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts`
- `[wrapper]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/wrapper.ts`
- `[runner]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/runner.ts`
- `[shared-events]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/shared-events.ts`
- `[tool-proxy]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/tool-proxy.ts`
- `[sdk]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts`
- `[session]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/agent-session.ts`
- `[system-prompt]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/system-prompt.ts`
- `[system-template]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/prompts/system/system-prompt.md`
- `[core-loop]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/agent-loop.ts`
- `[core-agent]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/agent.ts`
- `[core-types]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/types.ts`
- `[ai-types]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts`
- `[validation]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/utils/validation.ts`
- `[ai-utils]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/utils.ts`
- `[stream]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/stream.ts`
- `[openai-completions]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-completions.ts`
- `[openai-responses-shared]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-responses-shared.ts`
- `[openai-codex-responses]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-codex-responses.ts`
- `[google-shared]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/google-shared.ts`
- `[cursor-provider]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/cursor.ts`

## 1. Does `registerTool` create a real tool that the LLM sees and can call?

Yes.

Evidence:

- The public type says a registered tool's `name` is "used in LLM tool calls", and `description` is "for LLM" (`[ext-types]` lines 347-358).
- `ExtensionAPI.registerTool` is documented as "Register a tool that the LLM can call" (`[ext-types]` lines 900-905).
- The concrete implementation stores the definition in the extension's `tools` map under `tool.name` (`[loader]` lines 144-152).
- Loaded extensions carry `tools: Map<string, RegisteredTool<any, any>>` (`[ext-types]` lines 1228-1235).
- `ExtensionRunner.getAllRegisteredTools()` walks all loaded extensions and returns their registered tools (`[runner]` lines 307-315).
- SDK session creation pulls those registered tools, wraps them into `AgentTool`s, and appends them to the same `toolRegistry` as built-ins (`[sdk]` lines 1501-1509 and 1511-1524).
- The SDK then wraps every registry entry, built-in and registered, in `ExtensionToolWrapper` (`[sdk]` lines 1525-1530).
- Non-`defaultInactive` registered tools are always added to the initial active tool set unless skipped by MCP discovery rules (`[sdk]` lines 1719-1730).
- Active tools are resolved from `initialToolNames` through `toolRegistry` and passed into `new Agent({ initialState: { tools: initialTools } })` (`[sdk]` lines 1832-1853).
- The agent places `this.#state.tools` into the `AgentContext` used for the model call (`[core-agent]` lines 893-897), and refreshes `context.tools` from live state before each model call (`[core-agent]` lines 952-958).
- The agent loop sends `tools: normalizeTools(context.tools, ...)` in the provider-facing LLM context (`[core-loop]` lines 713-717) and calls the stream function with that context (`[core-loop]` lines 794-803).

System prompt vs tool definitions:

- Registered tools are real provider tool definitions because they flow through `Context.tools` into the provider request (`[core-loop]` lines 713-717 and 794-803). Provider dispatch receives the same `context` object (`[stream]` lines 437-440 and 585-586).
- The default system prompt includes an inventory built from active tool names and metadata (`[system-prompt]` lines 527-535 and 551-558). The prompt template renders either name/label inventory or full descriptions depending on `repeatToolDescriptions` (`[system-template]` lines 100-112).
- Therefore: the callable schema/parameters are in the provider tool list; the system prompt usually contains an inventory entry, and only repeats full descriptions when configured.

## 2. When the model calls a registered tool, what is the execution path?

Path:

1. The provider returns an assistant message containing `toolCall` blocks. The core loop filters `message.content` for `type === "toolCall"` (`[core-loop]` lines 599-603).
2. For each tool call, the core dispatcher finds a matching active tool by `tool.name` or `tool.customWireName` (`[core-loop]` lines 1033-1042).
3. The core loop emits `tool_execution_start` using `toolCall.id`, `toolCall.name`, and the current args (`[core-loop]` lines 1140-1148).
4. The core loop validates arguments before tool execution (`[core-loop]` lines 1169-1178).
5. The core loop calls `tool.execute(toolCall.id, ..., effectiveArgs, ...)` (`[core-loop]` lines 1205-1219).
6. For normal SDK sessions, `tool` is an `ExtensionToolWrapper` because SDK wraps every registry entry after built-ins and registered tools have been inserted (`[sdk]` lines 1511-1530).
7. `ExtensionToolWrapper.execute()` performs approval checks (`[wrapper]` lines 113-143), then emits a `tool_call` event before the underlying tool is executed (`[wrapper]` lines 145-153).
8. If any `tool_call` handler returns `{ block: true }`, wrapper throws before underlying execution (`[wrapper]` lines 155-158).
9. If not blocked, wrapper executes the underlying tool (`[wrapper]` lines 167-173).
10. For extension-registered tools, the underlying tool is `RegisteredToolAdapter`, whose `execute()` calls the original `registeredTool.definition.execute(...)` and passes `runner.createContext()` (`[wrapper]` lines 51-59).
11. The wrapper emits a `tool_result` event after execution and can apply modifications before returning to the core loop (`[wrapper]` lines 181-214).
12. The core loop coerces the final returned result and then emits the final `tool_execution_end` / `toolResult` message (`[core-loop]` lines 1220-1222 and 1072-1108).

Does it go through the same `tool_call` event as built-in tools?

Yes in SDK-created sessions. Built-ins and registered tools are inserted into one `toolRegistry`, then every entry is wrapped in `ExtensionToolWrapper` (`[sdk]` lines 1511-1530). The `tool_call` event is emitted by `ExtensionToolWrapper.execute()` for whichever underlying tool is called (`[wrapper]` lines 145-153). The event's block result shape is `{ block?: boolean; reason?: string }` (`[shared-events]` lines 261-270).

Can an extension's `tool_call` handler see and block its own registered tool?

Yes.

- `emitToolCall()` iterates all loaded extensions and all handlers registered under `"tool_call"`; there is no owner exclusion (`[runner]` lines 614-624).
- If a handler returns a result with `block`, `emitToolCall()` returns immediately (`[runner]` lines 626-630).
- If a handler throws, the runner reports the error and returns a blocking result (`[runner]` lines 632-642).
- The wrapper honors that blocking result before underlying execution (`[wrapper]` lines 155-158).

Does a registered tool bypass the `tool_call` event?

Not in the normal SDK session path. `RegisteredToolAdapter` by itself only delegates to `definition.execute()` (`[wrapper]` lines 51-59), but SDK wraps the adapter in `ExtensionToolWrapper` after adding it to `toolRegistry` (`[sdk]` lines 1509-1530). The event is therefore enforced by the outer wrapper.

Ordering caveat:

- Core `tool_execution_start` is pushed before `tool.execute()` is invoked (`[core-loop]` lines 1140-1148 and 1205-1219).
- The extension `tool_call` event is inside `ExtensionToolWrapper.execute()` (`[wrapper]` lines 145-153). So it is pre-underlying-execute, but after the core has begun the tool-execution lifecycle.

## 3. Is TypeBox parameter validation enforced before `execute()`?

Yes, for the model-supplied arguments in the normal path.

Evidence:

- Extension `ToolDefinition.parameters` accepts Zod or TypeBox/JSON-schema-compatible schemas (`[ext-types]` lines 357-358).
- Core `validateToolArguments()` is called before `tool.execute()` (`[core-loop]` lines 1169-1178 and 1205-1219).
- `validateToolArguments()` builds a validation context from the tool's `parameters`: Zod schemas are validated via Zod, non-Zod schemas are upgraded/handled as JSON Schema (`[validation]` lines 877-885).
- Zod validation uses `safeParse`; JSON-schema validation uses `validateJsonSchemaValue()` (`[validation]` lines 922-940).
- If validation cannot be reconciled, `validateToolArguments()` throws with a validation error (`[validation]` lines 1003-1018).
- The core loop catches that throw and turns it into an error tool result instead of calling the underlying execute body (`[core-loop]` lines 1223-1230).

Can the model send malformed params that skip validation?

Normally no. The model's raw `toolCall.arguments` are validated before wrapper execution (`[core-loop]` lines 1169-1178) and before the underlying registered `definition.execute()` (`[wrapper]` lines 51-59 and 167-173).

Important caveats:

1. `lenientArgValidation` bypass exists. If a tool has `lenientArgValidation`, validation errors are caught and raw args are used (`[core-loop]` lines 1170-1178). The public `AgentTool` type documents this behavior (`[core-types]` lines 433-434). `ToolDefinition` in the extension API does not declare `lenientArgValidation` (`[ext-types]` lines 350-391), but `applyToolProxy()` forwards arbitrary own properties from the definition object to the wrapper (`[tool-proxy]` lines 4-21), so a JavaScript extension could still attach that property at runtime.
2. Post-validation mutation is possible. The wrapper emits `tool_call` with `input: params` (`[wrapper]` lines 148-153) and later calls the underlying tool with the same `params` reference (`[wrapper]` lines 171-173). A `tool_call` handler that mutates `event.input` can change already-validated args before execute; the wrapper does not revalidate after the event.
3. SDK-level `transformToolCallArguments` runs after validation and immediately before `tool.execute()` (`[core-loop]` lines 1205-1208). In the current SDK it is used for timeout capping and secret deobfuscation (`[sdk]` lines 1927-1936), but the core loop does not revalidate after that transform.

## 4. Can the model fabricate a tool result?

No, not as a real `toolResult` message in the agent/session state.

Evidence:

- Provider output is consumed as `AssistantMessageEvent`s and finalized as an `AssistantMessage` (`[core-loop]` lines 924-937).
- `AssistantMessage.content` can contain text/thinking/image/toolCall-like content, while `ToolResultMessage` is a separate message role (`[ai-types]` lines 580-583 and 607-619).
- The core loop extracts only `toolCall` blocks from an assistant message and then executes local tools (`[core-loop]` lines 599-606).
- Real tool-result messages are constructed by `emitToolResult()` inside the core loop, not taken from assistant text (`[core-loop]` lines 1072-1108).
- That constructed message uses the current `toolCall.id`, `toolCall.name`, `result.content`, `result.details`, and `isError` (`[core-loop]` lines 1092-1100).

Does the tool result come exclusively from `execute()` return value?

No. The model cannot inject it, but runtime code can alter or synthesize it:

- The wrapper catches underlying execute errors and synthesizes error content (`[wrapper]` lines 171-179).
- `tool_result` handlers can replace content/details/isError (`[wrapper]` lines 181-214; runner merge behavior at `[runner]` lines 571-611).
- Core `afterToolCall` can also override content/details/isError after execution (`[core-loop]` lines 1232-1252). The current coding-agent session installs a TTSR after-tool hook (`[session]` lines 1142-1143) that prepends reminder content (`[session]` lines 2120-2135).
- Core also coerces malformed tool returns before persisting them (`[core-loop]` lines 76-109 and 1220-1222).

So the enforceable boundary is: real tool results are produced by local runtime code after a local tool call; they are not accepted from model-generated assistant output.

## 5. Tool name conflicts

A registered tool with the same name as a built-in silently shadows the built-in in the SDK tool registry.

Evidence:

- `registerTool()` stores by `tool.name` in an extension-local `Map` without conflict checks (`[loader]` lines 144-152). A second registration with the same name in the same extension overwrites the prior map entry.
- `getAllRegisteredTools()` returns tool values from each extension without conflict checks (`[runner]` lines 307-315).
- SDK first inserts built-ins into `toolRegistry` (`[sdk]` lines 1511-1515).
- SDK then iterates wrapped extension tools and calls `toolRegistry.set(tool.name, tool)` (`[sdk]` lines 1522-1524). `Map.set` on an existing key replaces the previous value.
- SDK subsequently wraps the final value for every registry key (`[sdk]` lines 1525-1530).

Implications:

- Built-in vs registered conflict: registered tool shadows built-in.
- Registered vs registered conflict across extensions: later insertion into `toolRegistry` wins, based on extension loading/order from `getAllRegisteredTools()` (`[runner]` lines 307-315; `[sdk]` lines 1501-1524).
- There is no merge and no error in this code path. This differs from commands, which explicitly warn/skip on built-in command conflicts (`[runner]` lines 412-430).

## 6. Closure access

`execute()` runs in-process and retains closure access from the extension factory/module. I found no sandbox or isolation layer in the registered-tool path.

Evidence:

- The loader imports the extension module, gets its factory, creates `ConcreteExtensionAPI`, and calls `await factory(api)` directly in the same process (`[loader]` lines 283-304).
- `registerTool()` stores the actual `tool` object, including its function properties, in `extension.tools` (`[loader]` lines 144-152).
- `RegisteredToolAdapter.execute()` later invokes the stored `registeredTool.definition.execute(...)` function (`[wrapper]` lines 51-59).
- The context passed to registered tools is created by `runner.createContext()` and contains live UI/session/model/runtime accessors (`[runner]` lines 447-465).
- The extension API itself exposes process-side capabilities such as `exec()`, which delegates to `execCommand()` (`[loader]` lines 216-218).

Conclusion: any closure state captured when the factory runs is still available to `execute()`. Enforcement code must treat extensions as trusted in-process code, not sandboxed plugins.

## 7. `toolCallId`

Core OMP does not generate a fresh ID at execution time. The core loop uses the ID already present on the provider-decoded `ToolCall` object.

Evidence:

- `ToolCall.id` is a required string in the shared AI type (`[ai-types]` lines 483-487).
- The core dispatcher builds records from `toolCall` objects and carries `toolCall.id` through execution (`[core-loop]` lines 1033-1049).
- `tool_execution_start`, `tool.execute()`, `tool_execution_end`, and the final `ToolResultMessage.toolCallId` all use `toolCall.id` (`[core-loop]` lines 1072-1100, 1140-1148, and 1205-1219).

Where does it come from?

Provider adapters either use upstream IDs or synthesize them when the provider lacks a usable ID:

- OpenAI chat completions uses `toolCall.id || ""` from the streamed provider tool call (`[openai-completions]` lines 820-823).
- OpenAI Responses/Codex encodes upstream `call_id` and item id into the internal tool-call id (`[openai-responses-shared]` lines 87-89; `[openai-codex-responses]` lines 1105-1125 and 1304-1328).
- Google generates an ID if none is provided or if the provided ID duplicates another tool call in the same output; the fallback is `${name}_${Date.now()}_${++toolCallCounter}` (`[google-shared]` lines 420-429 and 584-587).
- Cursor provider code uses an upstream `args.toolCallId` or falls back to `crypto.randomUUID()` (`[cursor-provider]` lines 2005-2007).

Can it be predicted or duplicated?

Do not treat `toolCallId` as a security boundary.

- Some provider paths use provider-supplied IDs; their predictability is provider/model dependent (`[openai-completions]` lines 820-823; `[openai-codex-responses]` lines 1105-1125).
- Some OMP fallback IDs are predictable by construction, e.g. Google fallback uses name + `Date.now()` + a module-local counter (`[google-shared]` lines 420-429).
- Some fallback IDs are random UUIDs, e.g. Cursor (`[cursor-provider]` lines 2005-2007).
- [INFERENCE] The core execution path does not reject duplicate IDs: records are built by mapping tool calls and carrying IDs as supplied (`[core-loop]` lines 1033-1049), and results are emitted under those IDs (`[core-loop]` lines 1072-1108). Google specifically de-dupes only within that provider output path (`[google-shared]` lines 584-587).

## Enforcement feasibility bottom line

The OMP API mechanics are strong enough to make `holmes_classify` a real, model-callable tool and to enforce pre-execution policy around tool calls:

- A registered tool is exposed to the LLM through the same active-tool/provider-tool path as built-ins (`[sdk]` lines 1501-1530; `[core-loop]` lines 713-717).
- Registered tools go through the same extension `tool_call` blocking surface as built-ins in normal SDK sessions (`[sdk]` lines 1511-1530; `[wrapper]` lines 145-158).
- The model cannot fabricate real tool results; local runtime constructs them (`[core-loop]` lines 1072-1108).

The main enforcement risks are not whether registered tools are real. They are:

1. Silent tool-name shadowing by registered tools (`[sdk]` lines 1511-1524).
2. Post-validation argument mutation through `tool_call` handlers or argument transforms (`[wrapper]` lines 148-153 and 171-173; `[core-loop]` lines 1205-1208).
3. Optional lenient validation if a tool exposes `lenientArgValidation` (`[core-loop]` lines 1170-1178; `[core-types]` lines 433-434; `[tool-proxy]` lines 4-21).
4. `toolCallId` is correlation metadata, not an authority token (`[core-loop]` lines 1033-1049 and 1072-1108).
