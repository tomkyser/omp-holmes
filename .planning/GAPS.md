# HOLMES Extension — Gap Analysis & Fix Planning

**Created**: 2025-07-20
**Updated**: 2025-07-20 (research complete, fix plan consolidated)
**Status**: Implementation complete — verification pending
**Owner**: Tom Kyser

---

## Executive Summary

The HOLMES extension loads and its mechanical gates fire, but the framework fails at its core purpose — **forcing backward reasoning and delegation** — because of five structural gaps between what was designed and what was built. The most powerful enforcement mechanisms (TTSR stream interruption, agent delegation) are completely dead due to configuration and wiring issues.

---

## Gap 1: System Prompt Is Suggestion, Not Enforcement

### What
The HOLMES system prompt (embedded in `src/main.ts:36-82`) tells the model to "complete the following cognitive redirect **silently in your thinking**."

### Why It Fails
- No mechanism to **observe or verify** that the model performed HALT/ENVISION/LOCATE/DELTA/CLASSIFY
- "Silently in your thinking" means no trace, no accountability, no confirmation
- The reasoning guard (`handleReasoningGuard`, `src/main.ts:241-266`) checks for keyword evidence in **tool call inputs** (e.g., file paths, bash commands), not in the model's reasoning text or output prose
- The `REDIRECT_EVIDENCE` regex (`src/main.ts:30`) scans `event.input` — but models reason in their text output, not in tool parameters

### Impact
Models read the prompt, maybe nod internally, then forward-chain anyway. There is zero enforcement of the cognitive redirect.

### Key Files
- `src/main.ts:36-82` (system prompt)
- `src/main.ts:241-266` (reasoning guard)
- `src/main.ts:30` (REDIRECT_EVIDENCE regex)
- `src/main.ts:177-189` (hasRedirectEvidence — scans tool input, wrong place)

### Fix Direction
- Hook `message_update` to observe the model's actual text output for HOLMES reasoning evidence
- Require the model to emit evidence **visibly** (not silently) — e.g., structured classification block before first mutation
- Use `before_provider_request` to inject per-request reinforcement if no evidence seen yet this turn

---

## Gap 2: Reasoning Guard Is a One-Shot Speed Bump

### What
`handleReasoningGuard` blocks the first mutating tool call, sets `state.reminded = true`, and allows all subsequent mutations without further checks.

### Why It Fails
- Block once → model retries exact same call → goes through. Model learns nothing.
- `state.reminded` never resets within a turn. After one retry, unlimited edits allowed.
- In print mode (`-p`), the block kills the entire response — no retry opportunity.
- The guard becomes a brief annoyance, not a behavioral gate.

### Key Files
- `src/main.ts:252-253` (`state.reminded` check)
- `src/main.ts:256` (sets `reminded = true`, never blocks again)
- `src/main.ts:373-376` (only resets on `turn_start`)

### Fix Direction
- Remove `reminded` bypass — guard should check for actual evidence every time, not just once
- Integrate with `message_update` observation: only clear the gate when HOLMES evidence is actually observed in the model's output text
- In print mode / non-interactive: downgrade from hard block to injected context (since there's no retry)

---

## Gap 3: TTSR Rules Are Defined But Not Active

### What
Five TTSR rules exist in `rules/` — the **most powerful enforcement mechanism** in OMP. They interrupt model generation **mid-stream** when a regex matches, aborting the response and injecting a redirect.

### Why It Fails
- `.omp/settings.json` points to `"./src/main.ts"` (a **file**), not the package root directory
- OMP's `omp-extension-roots.ts:159` filters `isDirectory()` — file paths produce **zero sub-discovery surface**
- The `rules/`, `skills/`, `agents/`, `commands/` directories are never discovered
- When using `--extension ./`, the CLI passes `"."` (directory) which SHOULD work, but `.omp/settings.json` overrides with the file path

### TTSR Rules That Should Be Active
| Rule File | What It Catches |
|-----------|----------------|
| `forward-chain-guard.md` | "let me edit/write/run" before ENVISION/DELTA/TARGET evidence |
| `assumption-guard.md` | "this should work" / "probably" → action without verification |
| `batch-primitive-prose.md` | "let me read X then search Y" sequential chains |
| `batch-primitive-numbered.md` | "first read... second search..." numbered chains |
| `edit-without-verify.md` | Edit plans with no verification step |

### Impact
**This is the single biggest gap.** TTSR catches forward-chaining AS the model generates text, before tool calls even happen. Without it, the extension can only react after the model has already decided what to do.

### Key Files
- `.omp/settings.json` (currently `["./src/main.ts"]`, should be `["./"]`)
- `rules/*.md` (5 TTSR rules, all dead)
- OMP source: `omp-extension-roots.ts:159` (directory filter)
- OMP source: `omp-plugins.ts:92-107` (rules sub-discovery)

### Fix Direction
- Change `.omp/settings.json` to `["./"]` (package root) so sub-discovery walks `rules/`, `skills/`, etc.
- Verify TTSR rules actually fire after the path fix
- Consider also registering rules programmatically if `resources_discover` supports it (it doesn't return `rulePaths` — only `skillPaths`, `promptPaths`, `themePaths`)
- May need to use `resources_discover` to register skills/prompts, and rely on sub-discovery for rules

---

## Gap 4: No Delegation Enforcement

### What
The design calls for agent delegation — `holmes-researcher` for read-only investigation, `holmes-verifier` for post-edit verification, `[delegate]` execution tags.

### Why It Fails
1. **Agent definitions are dead files.** `agents/*.md` exist but OMP discovers agents from `.agent/` or `.agents/` directories, not from extension package `agents/` dirs. `omp-plugins.ts` has no agent sub-discovery provider.
2. **No programmatic agent dispatch.** `ExtensionAPI` has no `registerAgent()` or `spawnSubagent()`.
3. **System prompt mentions delegation but doesn't operationalize it.** Says "delegate to `holmes-researcher`" but model has no tool to spawn that agent.
4. **`/holmes` command** produces execution packets but doesn't instruct use of `Task` tool with specific agent types.

### Key Files
- `agents/holmes-researcher.md` (dead file)
- `agents/holmes-verifier.md` (dead file)
- `src/main.ts:112-137` (`buildHolmesPrompt` — no delegation instructions)
- OMP source: `omp-plugins.ts` (no agents provider)

### Fix Direction
- Move agent definitions to `.agents/` at project root (native discovery path)
- OR embed agent system prompts in the HOLMES system prompt so the model knows to use `Task` tool with those personas
- Enhance `/holmes` command prompt to explicitly instruct delegation via `Task` tool
- Add `tool_call` handler that watches for `Task` usage and injects HOLMES-aware agent instructions

---

## Gap 5: `message_update` Events Are Unused

### What
OMP fires `message_update` events with `assistantMessageEvent` during streaming — contains the model's actual text output token-by-token.

### Why It Matters
This is where you could **observe whether the model is actually reasoning** or forward-chaining. Currently unused.

### Impact
- No way to detect the model skipped HALT/ENVISION/LOCATE/DELTA
- No way to detect forward-chaining intent in prose before tool calls
- Reasoning guard has to guess from tool call inputs (wrong data source)

### Key Files
- `src/main.ts` — no `message_start`, `message_update`, or `message_end` handlers
- OMP types: `types.ts:466-475` (`MessageUpdateEvent` with `assistantMessageEvent`)

### Fix Direction
- Hook `message_update` to accumulate the model's text output per turn
- Use accumulated text to feed the reasoning guard: has the model shown ENVISION/DELTA evidence?
- This replaces the broken "scan tool inputs for keywords" approach
- Consider `message_end` as the checkpoint: if assistant message completed without HOLMES evidence, flag the next mutation

---

## Active vs. Dead Surface Inventory

| Surface | Status | Notes |
|---------|--------|-------|
| System prompt append | **Active, weak** | Suggestion only, no enforcement |
| Primitive burst gate | **Active, working** | Blocks 4+ consecutive read/search/find |
| Reasoning guard | **Active, ineffective** | Checks wrong data, allows bypass after 1 retry |
| Verify reminder | **Active, working** | Appends "[HOLMES] Verify..." to edit/write results |
| `/holmes` command | **Active, incomplete** | No delegation instructions |
| `/holmes-goal` command | **Active** | Works as designed |
| `/holmes-status` command | **Active** | Diagnostic only |
| TTSR rules (5 files) | **DEAD** | Path config error, not discovered |
| Skill (`SKILL.md`) | **DEAD** | Same sub-discovery failure |
| Agents (researcher, verifier) | **DEAD** | No agent sub-discovery in extension packages |
| `message_update` observation | **NEVER BUILT** | Could observe model reasoning |
| `before_provider_request` | **NEVER BUILT** | Could inject per-request messages |
| `context` event | **NEVER BUILT** | Could inject context messages |

---

## OMP Extension API Surfaces Available But Unused

From `ExtensionAPI` in OMP's `types.ts:827-1049`:

| API Surface | Relevance to HOLMES |
|-------------|-------------------|
| `message_update` event | **Critical** — observe model's actual reasoning text |
| `message_end` event | **Critical** — checkpoint for reasoning evidence |
| `before_provider_request` event | **High** — inject per-request system reinforcement |
| `context` event | **High** — inject context messages into conversation |
| `resources_discover` event | **High** — register skills/prompts programmatically |
| `input` event | **Medium** — transform user input before agent processes it |
| `registerTool` | **Medium** — custom tools for structured HOLMES output |
| `session.compacting` event | **Medium** — preserve HOLMES state across compaction |
| `sendMessage` with `steer` delivery | **High** — mid-turn steering messages |

---

## Session Files for Real-World Analysis

Sessions with HOLMES evidence (extension was active):

### High-Priority (large, recent, extension-active)
- `-dev-ai-podcasts-crm/2026-05-27T18-46-22*.jsonl` (2.8MB) — large real-world session
- `-dev-reasoner/2026-05-20T14-54-41*.jsonl` (3.3MB) — original dev session
- `-dev-ai-podcasts-crm/2026-05-27T16-32-18*.jsonl` (722KB) — medium CRM session
- `-dev-reasoner/2026-05-20T22-03-43*.jsonl` (86KB) — testing session

### Medium-Priority (smaller sessions showing gate behavior)
- `-dev-reasoner/2026-05-20T22-*.jsonl` (7 sessions, 20-30KB each)
- `--private-tmp--/2026-05-27T15-32-40*.jsonl` (7KB) — HOLMES in /tmp context

---

## Research Questions for Fix Planning

1. Can `message_update`'s `assistantMessageEvent` provide usable text for reasoning detection?
2. Does `before_provider_request` allow injecting additional system prompt segments per-request?
3. Can `context` event inject messages that appear as conversation context?
4. What is the exact format of `sendMessage` with `deliverAs: "steer"` — can it redirect mid-turn?
5. Does `resources_discover` with `skillPaths` actually make the skill available to the model?
6. Can the `input` event add HOLMES framing before the model sees user prompts?
7. What does agent definition frontmatter look like in `.agents/` for native discovery?
8. How do TTSR rule `scope` and `condition` fields interact — does `scope: text, thinking` mean it watches both?

---

## Consolidated Fix Plan (from research)

Research files: `.planning/research/session-analysis.md`, `gap-1-2-fix-design.md`, `gap-3-ttsr-fix.md`, `gap-4-5-delegation-messages.md`

### Key Session Analysis Findings

- 11 sessions analyzed, 1,524 messages, 752 tool calls
- **49 of 51 user turns** went straight to tools with no visible HOLMES reasoning
- Only **4 of 724** assistant messages contained a visible full HALT/ENVISION/LOCATE/DELTA/CLASSIFY block
- **32 reasoning gate activations** — but the model bypasses by switching to `eval` (not in MUTATING_TOOLS)
- **0 TTSR events** — confirming Gap 3 is total
- **0 HOLMES-specific delegations** — 6 Task calls, all using generic `agent: "task"`
- `eval` is the primary mutation bypass: model learns "edit blocked → use eval instead"

### Fix 1: Visible Evidence Gate (Gaps 1+2)

**Problem**: Guard scans tool inputs; model reasons in text output. Guard allows bypass after one retry.

**Fix**:
1. Hook `message_update` to accumulate visible assistant text per turn (bounded window, sync handler)
2. Hook `message_end` for reconciliation
3. Require a **visible** classification marker before mutation: `[CLASSIFY: Tier 1]`, `## HOLMES: Tier 2`, or `## HOLMES: Tier 3`
4. Remove `state.reminded` bypass — gate stays closed until visible evidence observed
5. System prompt must say "visible marker required" not "silently in thinking"
6. Non-interactive/print mode: soft context injection via `context` event instead of hard block

**API surfaces used**: `message_update`, `message_end`, `context`, `tool_call`

**Key design**: `AssistantMessageEvent.text_delta` provides visible text tokens. `thinking_delta` is diagnostic only — doesn't open gate. `toolcall_delta` is tool args — never counts as evidence.

### Fix 2: TTSR Rule Activation (Gap 3)

**Problem**: Three issues — path config error, invalid regex syntax, AND no eval-bypass coverage.

**Fix**:
1. Change `.omp/settings.json` from `["./src/main.ts"]` to `["./"]` — makes package root a discovery root
2. `package.json` `omp.extensions` still points at `./src/main.ts` for the factory — no conflict
3. Rewrite all 5 existing TTSR rule `condition` fields to valid JS regex (use `(?is:...)` scoped modifier groups)
4. Add 2 new TTSR rules for eval-as-mutation-bypass (see below)
5. `RULES.md` in `rules/` is safe — no frontmatter means inert (not TTSR, not always-apply, not rulebook)

**New Rule: `eval-mutation-intent.md`** (`scope: text, thinking`)
Catches the model planning to use eval to bypass the mutation gate:
```yaml
---
description: Catch intent to use eval as a mutation bypass
condition: '(?is:(?:eval|eval\s*\().{0,120}(?:write|append|create|modify|bypass).{0,80}(?:gate|guard|block|instead|around))'
scope: text, thinking
---
Stop. Eval is for batched read-only discovery — not for bypassing the HOLMES
reasoning gate. Filesystem mutations must go through `write`, `edit`, or `bash`
with a visible HOLMES classification marker (`[CLASSIFY: Tier 1]`, `## HOLMES: Tier 2`,
or `## HOLMES: Tier 3`) emitted first. Emit your classification, then use the
correct mutating tool.
```

**New Rule: `eval-mutation-code.md`** (`scope: tool:eval`)
Catches actual `write(`/`append(` calls streaming inside eval tool arguments:
```yaml
---
description: Catch filesystem mutation code inside eval tool calls
condition: '(?is:(?:^|[^a-z_])(?:write|append)\s*\()'
scope: tool:eval
---
This eval cell contains filesystem mutation code (`write()` or `append()`).
Eval is for batched read-only investigation — use `write`, `edit`, or `bash`
for mutations so the HOLMES reasoning gate can verify you classified the work
first. Emit a visible HOLMES marker, then use the appropriate mutating tool.
```

**Design rationale — TTSR over MUTATING_TOOLS for eval**:
- Adding eval to `MUTATING_TOOLS` would kill the tool discipline we're trying to enforce (batched discovery)
- TTSR is surgical: only fires when eval contains writes, not on read-only batching
- Intent-level rule (prose/thinking) catches the bypass decision before the tool call forms
- Argument-level rule (`tool:eval` scope) is the backstop for silent bypass attempts
- Model gets a redirect explaining *why* and *what to do instead*

**TTSR repeat behavior**: Default `repeatMode: "once"` means each rule fires once per session. For persistent enforcement, TTSR settings should use `repeatMode: "afterGap"` with a small `repeatGap` (e.g., 3-5 messages). Document this as a recommended user setting.

**Verified**: Proposed JS-compatible regexes compile under Bun. `scope: tool:eval` parses via `#parseToolScopeToken` as `{ toolName: "eval" }`. Buffer isolation ensures eval args don't bleed into text matching.

### Fix 3: Delegation Protocol (Gap 4)

**Problem**: `agents/holmes-researcher.md` and `agents/holmes-verifier.md` are dead files. OMP extension packages have no agent sub-discovery. `ExtensionAPI` has no `registerAgent()`.

**Root cause clarified**: `.agents/` is for skills/rules/prompts/commands — NOT Task agents. Task agents come from `.omp/agents/`, `~/.omp/agent/agents/`, `.claude/agents/`, and bundled agents. Extension `agents/` directories are not in any discovery path.

**Fix (Option B+D — prompt + guard)**:
1. Embed HOLMES delegation protocol in system prompt using **bundled** agents: `explore` for research, `oracle`/`task` for verification
2. Include researcher/verifier contracts as prompt constants (don't depend on file discovery)
3. Update `/holmes` command to require explicit delegation decisions in execution packet
4. Add `tool_call` guard for Task: block dead agent names (`holmes-researcher`, `holmes-verifier`) with actionable retry instructions
5. Track delegation state for `/holmes-status`

**Why not custom tools**: `registerTool()` exists but there's no `spawnSubagent()` — building parallel Task plumbing is fragile. Use native Task with enhanced prompt instructions instead.

### Fix 4: Message Observation (Gap 5)

**Problem**: `message_update` events contain exactly the data HOLMES needs but are never hooked.

**Fix** (merged into Fix 1 implementation):
1. `message_update` handler: accumulate `text_delta` into bounded visible window, check for CLASSIFY marker
2. `message_end` handler: reconcile final assistant text, optionally steer if no evidence seen
3. Feed observation state into reasoning guard — replaces broken tool-input scanning
4. Diagnostic: record `thinking_delta` evidence separately for `/holmes-status` (not enforcement)

**Timing confirmed**: Text/thinking stream events fire before tool execution. `tool_call` guard can consult observation state accumulated from `message_update`.

**Caveat**: Extension `message_update` handlers are fire-and-forget (async queued). Must be synchronous, CPU-only, bounded. Use `message_end` reconciliation as fallback.

### Implementation Order

1. **Gap 3 first** (TTSR) — simplest fix, highest impact. Change settings path + rewrite 5 existing regexes + add 2 new eval-bypass rules. TTSR catches forward-chaining and eval bypass at generation time.
2. **Gaps 1+2+5 together** (visible evidence gate) — core enforcement rewrite. New state types, message observation, guard redesign, prompt rewrite.
3. **Gap 4 last** (delegation) — prompt additions + Task guard. Depends on the reasoning gate working first.

### Verification Plan

After implementation:
- Unit tests: evidence detection helpers, marker parsing, gate behavior with/without evidence
- TTSR smoke test: controlled "let me edit" output triggers `ttsr_triggered` from `forward-chain-guard`
- TTSR eval test: eval cell with `write(` triggers `eval-mutation-code` rule
- Interactive test: ask for edit → gate blocks → emit `[CLASSIFY: Tier 1]` → gate passes
- Print mode test: no hard block, context injection instead
- Delegation test: Task with `holmes-researcher` blocked, retry with `explore` succeeds
- Eval discipline test: eval with read-only batching passes freely; eval with `write()` gets TTSR redirect
- Session replay: re-run representative prompts from session analysis, compare gate activation patterns

### TTSR Settings Recommendation

For full enforcement, users should configure TTSR repeat behavior in `.omp/settings.json`:
```json
{
  "extensions": ["./"],
  "ttsr": {
    "repeatMode": "afterGap",
    "repeatGap": 3
  }
}
```
This allows rules to re-fire after 3 messages, catching repeated violations rather than only the first occurrence per session.
