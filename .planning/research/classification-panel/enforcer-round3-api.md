# Enforcement Specialist Round 3 — `execute()` API Capability Check

## Verdict

A registered tool's `execute()` is trusted in-process extension code, not a sandboxed deterministic callback. The immediate `ctx` argument is limited, but the tool body can retain closure access to the `ExtensionAPI` object passed to the extension factory. That combination means `execute()` can read files directly, can call an LLM directly if it imports/uses provider utilities or raw `fetch`, can inspect session history, and can mutate extension/session state. It cannot invoke other registered tools through a first-class `ctx.callTool()` / `pi.callTool()` API.

The Round 2 architecture assumption that the classifier is purely deterministic is therefore a design choice, not an API limitation. If HOLMES wants model-assisted impact assessment inside `holmes_classify.execute()`, OMP exposes enough capability to build it, but doing so makes the classifier itself an LLM caller with latency, credential, determinism, and audit implications.

## Citation shorthand

- `[ext-types]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`
- `[runner]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/runner.ts`
- `[loader]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts`
- `[ext-wrapper]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/wrapper.ts`
- `[legacy-loader]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/legacy-pi-compat.ts`
- `[coding-index]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/index.ts`
- `[session-manager]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-manager.ts`
- `[model-registry]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/config/model-registry.ts`
- `[ai-index]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/index.ts`
- `[ai-stream]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/stream.ts`
- `[ai-types]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts`
- `[task-executor]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/task/executor.ts`
- `[event-bus]` = `/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/utils/event-bus.ts`

## Execution boundary

`ToolDefinition.execute()` receives `(toolCallId, params, signal, onUpdate, ctx: ExtensionContext)` (`[ext-types]` lines 370-377). The registered-tool adapter calls the stored definition directly and passes `runner.createContext()` (`[ext-wrapper]` lines 51-59).

The extension factory receives `ExtensionAPI` (`[ext-types]` lines 1114-1115), and the loader creates `ConcreteExtensionAPI` and calls `await factory(api)` in-process (`[loader]` lines 295-304). `registerTool()` stores the exact tool object in `extension.tools` (`[loader]` lines 144-151). Therefore a registered tool can close over `pi`, local variables, prior event-handler observations, caches, and any imported modules.

`runner.createContext()` actually provides only: `ui`, `getContextUsage`, `compact`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, current `model`, `isIdle`, `abort`, `hasPendingMessages`, `shutdown`, and `getSystemPrompt` (`[runner]` lines 447-465). The type declaration matches those fields (`[ext-types]` lines 259-286).

## 1. Can `execute()` read files?

**Yes.** Not primarily through `ExtensionContext`, but because extension code is unsandboxed in-process code.

Evidence:

- `ExtensionContext` itself does **not** declare `readFile`, `fs`, or a filesystem helper; its declared surface is UI, context/session/model fields, status controls, and system prompt access (`[ext-types]` lines 259-286).
- `ExtensionContext` does expose `cwd` (`[ext-types]` lines 266-269; `[runner]` line 454), so direct filesystem operations know the session working directory.
- `ExtensionAPI` exposes `exec(command, args, options)` (`[ext-types]` lines 978-979), and the concrete API implements it by calling `execCommand(command, args, options?.cwd ?? this.cwd, options)` (`[loader]` lines 216-218). Because `execute()` can close over `pi`, it can use `pi.exec()` even though `ctx` does not include `exec`.
- The loader uses native module import: it imports/loads the extension module, creates the API, and calls the factory directly (`[loader]` lines 295-304). The legacy mirror loader ultimately performs a dynamic `import(...)` of the mirrored extension file (`[legacy-loader]` lines 334-339). There is no sandbox boundary in this path.
- The legacy import rewriter preserves relative, absolute, URL-like, and already-resolved Node specifiers (`[legacy-loader]` lines 242-255). That means an extension can import `node:fs` / `node:fs/promises` rather than needing an OMP wrapper.

Conclusion: `execute()` can read arbitrary files using `node:fs`, `Bun.file()`, or shelling out through captured `pi.exec()`. HOLMES cannot rely on `execute()` being limited to the context object.

## 2. Can `execute()` call an LLM?

**Yes, but not via a first-class `ctx.complete()` method.** The context/API expose enough model and credential material for an extension to call providers directly.

Evidence:

- `ExtensionContext` exposes `modelRegistry` and current `model` (`[ext-types]` lines 270-275), and `createContext()` passes the live `modelRegistry` and current model getter (`[runner]` lines 455-459).
- `ModelRegistry` exposes model lookup/listing (`getAll`, `getAvailable`, `find`) (`[model-registry]` lines 2081-2087 and 2219-2253).
- `ModelRegistry.getApiKey(model, sessionId?)` returns the provider API key via `authStorage.getApiKey(...)` (`[model-registry]` lines 2262-2270). `getApiKeyForProvider(...)` does the same by provider (`[model-registry]` lines 2272-2280).
- `ExtensionAPI` exposes `sendMessage()` and `sendUserMessage()` (`[ext-types]` lines 957-973; `[loader]` lines 198-210). These can queue/session-inject messages and may trigger a later turn depending on options, but they are not synchronous completion APIs returning model output to `execute()`.
- `ExtensionAPI` exposes `setModel()` / thinking controls / provider registration (`[ext-types]` lines 993-1000 and 1045-1048; `[loader]` lines 236-258), but no `complete`, `sendPrompt`, or `model.complete` method is declared in `ExtensionAPI` (`[ext-types]` lines 827-1049).
- The `pi` module handed to extensions is `typeof import("@oh-my-pi/pi-coding-agent")` (`[ext-types]` lines 841-842), and the concrete API passes `await import("@oh-my-pi/pi-coding-agent")` into `ConcreteExtensionAPI` (`[loader]` lines 295-302).
- Separately, `@oh-my-pi/pi-ai` exports `stream` utilities (`[ai-index]` line 29). `streamSimple(model, context, options)` is exported (`[ai-stream]` lines 437-441), and `completeSimple(model, context, options)` is exported as a convenience wrapper returning the stream result (`[ai-stream]` lines 589-596).

Conclusion: There is no `ctx.complete()` or `pi.model.complete()` equivalent on the extension API itself. But an extension can import `@oh-my-pi/pi-ai`, obtain `ctx.model` plus `ctx.modelRegistry.getApiKey(...)`, build a `Context`, and call `completeSimple()` / `streamSimple()`; or it can call the provider directly with `fetch`. That is enough to make model-assisted classification possible inside `holmes_classify.execute()` if desired.

## 3. Can `execute()` spawn a Task agent?

**No first-class task-spawn method exists on `ExtensionContext` or `ExtensionAPI`; however, the captured `pi` module exposes a lower-level subagent executor.**

Evidence:

- `ExtensionContext` has no task/subagent method in its declared fields (`[ext-types]` lines 259-286), and `createContext()` does not add one (`[runner]` lines 447-465).
- `ExtensionAPI` exposes tool name management (`getActiveTools`, `getAllTools`, `setActiveTools`) but no `spawnTask`, `runSubagent`, `callTool`, or `invokeTool` method (`[ext-types]` lines 981-988). The concrete API delegates only those name-management calls (`[loader]` lines 220-230).
- The coding-agent root export includes `export * from "./task/executor"` and task types (`[coding-index]` lines 48-49).
- The task executor exports `runSubprocess(options: ExecutorOptions)` (`[task-executor]` line 548). Its options include `cwd`, `agent`, `task`, `assignment`, `context`, model/registry/settings/artifact/event-bus fields, and other subagent plumbing (`[task-executor]` lines 142-203).

Conclusion: earlier “no task spawn API” research is correct only for the public extension context/API shape. It is not strictly true for a tool that captures `pi`: `pi.runSubprocess()` is exported and can be called manually if the extension constructs the required `ExecutorOptions`. That is lower-level than the model-callable `task` tool and is not the same as `ctx.spawnTask()`, but it is a real in-process capability.

## 4. Can `execute()` access session history?

**Yes.** The provided `ExtensionContext` includes a read-oriented session manager with history accessors.

Evidence:

- `ExtensionContext.sessionManager` is declared as `ReadonlySessionManager` (`[ext-types]` lines 270-271), and `createContext()` passes the live session manager (`[runner]` line 455).
- `ReadonlySessionManager` includes `getLeafId`, `getLeafEntry`, `getEntry`, `getBranch`, `getHeader`, `getEntries`, `getTree`, usage statistics, artifact methods, and blob storage (`[session-manager]` lines 274-296).
- `SessionMessageEntry` stores `message: AgentMessage` (`[session-manager]` lines 84-87). `SessionEntry` includes message entries, compaction entries, branch summaries, custom entries, custom messages, labels, TTSR injections, MCP selections, session init, and mode changes (`[session-manager]` lines 212-226).
- `getBranch()` walks from the current leaf to root and returns all entries in path order (`[session-manager]` lines 2992-3005).
- `getEntries()` returns all session entries excluding the header (`[session-manager]` lines 3044-3050).
- Tool calls are represented in assistant message content as `ToolCall` blocks (`[ai-types]` lines 483-488 and 580-583). Tool results are separate `ToolResultMessage` entries with `toolCallId`, `toolName`, `content`, `details`, and `isError` (`[ai-types]` lines 607-619).
- `ExtensionContext` also exposes `getSystemPrompt()` (`[ext-types]` lines 284-285; `[runner]` line 464).

Conclusion: `execute()` can inspect prior user/developer/assistant/tool-result messages, prior tool calls and results, branch structure, compaction records, and the current system prompt. It does not receive the exact current provider request object as an `execute()` parameter, but extension event handlers can observe `context`, `before_provider_request`, `after_provider_response`, message, and tool events (`[ext-types]` lines 869-896) and keep that in closure state for later `execute()` use.

## 5. Can `execute()` access the tool registry or invoke other tools?

**It can list and change active tool names; it cannot invoke another tool through the extension API.**

Evidence:

- `ExtensionAPI` has `getActiveTools()`, `getAllTools()`, and `setActiveTools(toolNames)` (`[ext-types]` lines 981-988).
- The concrete API delegates those calls to runtime name-management handlers (`[loader]` lines 220-230).
- `ExtensionContext` has no tool registry field or invocation helper (`[ext-types]` lines 259-286; `[runner]` lines 447-465).
- The declared `ExtensionAPI` action surface has no `callTool`, `invokeTool`, `executeTool`, or equivalent method (`[ext-types]` lines 827-1049).

Conclusion: a classifier cannot simply call built-in `read`, `search`, `find`, `task`, etc. via `ctx.callTool()`. It can use direct Node/Bun APIs, `pi.exec()`, imported SDK internals, or session messages, but not the active tool registry as a public invocation service.

## 6. What can `execute()` definitely do?

Because `execute()` receives `ExtensionContext` and can close over `ExtensionAPI`, it can definitely do the following:

1. **Use closure state.** Factory receives `ExtensionAPI` (`[ext-types]` lines 1114-1115), loader calls `factory(api)` (`[loader]` lines 295-304), `registerTool()` stores the exact tool object (`[loader]` lines 144-151), and the wrapper later invokes the stored `definition.execute()` (`[ext-wrapper]` lines 51-59).
2. **Interact with UI.** `ctx.ui` supports select, confirm, input, notify, terminal input, status/working messages, widgets, header/footer/title, custom components, editor text/paste/editor component, themes, and tool expansion controls (`[ext-types]` lines 137-232). `createContext()` passes `ui` (`[runner]` line 450).
3. **Read session/runtime state.** It gets `cwd`, `hasUI`, `contextUsage`, `sessionManager`, `modelRegistry`, current `model`, pending-message/idle state, and system prompt (`[ext-types]` lines 259-286; `[runner]` lines 447-465).
4. **Control the session loop.** It can compact, abort, and shutdown through `ctx` (`[ext-types]` lines 262-285; `[runner]` lines 451-464).
5. **Access flags.** `ExtensionAPI.registerFlag()` and `getFlag()` exist (`[ext-types]` lines 930-944); concrete implementation stores defaults and returns runtime flag values for registered flags (`[loader]` lines 179-195).
6. **Send or append messages.** Captured `pi.sendMessage()`, `pi.sendUserMessage()`, and `pi.appendEntry()` are declared (`[ext-types]` lines 957-979) and implemented by delegating to runtime (`[loader]` lines 198-214). `sendMessage()` supports `triggerTurn` and delivery modes (`[ext-types]` lines 957-967).
7. **Execute shell commands.** Captured `pi.exec()` is declared (`[ext-types]` lines 978-979) and implemented via `execCommand()` (`[loader]` lines 216-218).
8. **List/change active tools.** Captured `pi.getActiveTools()`, `pi.getAllTools()`, and `pi.setActiveTools()` are declared (`[ext-types]` lines 981-988) and implemented (`[loader]` lines 220-230).
9. **Change model/thinking/session metadata.** Captured `pi.setModel()`, `getThinkingLevel()`, `setThinkingLevel()`, `getSessionName()`, and `setSessionName()` are declared (`[ext-types]` lines 993-1006) and implemented (`[loader]` lines 236-254).
10. **Register providers.** Captured `pi.registerProvider()` is declared (`[ext-types]` lines 1008-1048) and concrete implementation queues provider registrations (`[loader]` lines 256-258). The registry supports runtime custom APIs and OAuth registration (`[model-registry]` lines 2344-2379).
11. **Use extension event bus.** `ExtensionAPI.events` is exposed (`[ext-types]` lines 1047-1048); `EventBus` supports `emit`, `on`, and `clear` (`[event-bus]` lines 3-32).
12. **Persist extension/session artifacts.** `ReadonlySessionManager` includes artifact/blob methods such as `allocateArtifactPath`, `saveArtifact`, `getArtifactPath`, and `putBlob` despite the read-oriented type name (`[session-manager]` lines 274-296).

## Impact on HOLMES classifier architecture

The classifier has three viable designs now:

1. **Deterministic-only `execute()`** — safest, fastest, easiest to audit. It can still use direct file reads/session history for stronger impact signals than request-text scanning. This preserves the Round 2 proof-down posture.
2. **Deterministic classifier with optional advisory LLM** — `execute()` can call an LLM for impact assessment, but the model answer should be advisory/upward-only unless backed by deterministic evidence. This improves semantic coverage without making downgrades model-authoritative.
3. **Model-authoritative classifier inside `execute()`** — technically possible, because `execute()` can read files/session history and call providers. I do not recommend it for enforcement: it reintroduces the core risk that model prose becomes proof. If used, it needs strict audit records, prompt/version pinning, credential controls, latency handling, and deterministic floors.

Primary recommendation: keep downgrade authority deterministic, but update the design to acknowledge that `holmes_classify.execute()` can gather its own evidence: direct file reads, session history inspection, concrete tool-call ledger analysis, and optional advisory LLM calls. The architectural boundary is not “what the API permits”; it is “what HOLMES is willing to trust as proof.”
