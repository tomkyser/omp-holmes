# omp-holmes — Adaptation Plan

**Date**: 2025-07-18
**Status**: Gap fixes implemented — TTSR active, visible evidence gate, delegation protocol
**Target**: OMP extension package with `package.json` `omp.extensions` entry

---

## Framework Overview

A cognitive redirect and reasoning enforcement framework for AI coding agents. Originally prototyped as "RALPH" for Claude Code, now being adapted for OMP with a refined inner loop named HOLMES.

### Outer Architecture (Established)

- **Layer 0**: Cognitive Redirect (HALT → ENVISION → LOCATE → DELTA → CLASSIFY) — fires every turn
- **Layer 1**: Gap Classification — Tier 1 (trivial, skip), Tier 2 (known+large, single pass), Tier 3 (has unknowns, full loop)
- **Layer 2**: Unknown Resolution (scoped research agent dispatch)
- **Layer 3**: HOLMES inner reasoning loop (Tier 2/3 only) — see below
- **Layer 4**: Structured Execution (preflight → read → transform → verify → report)

### Layer 3: HOLMES — Hone, Observe, Ladder, Map, Establish, Synthesize

The inner reasoning loop for Tier 2/3 work. Consumes Layer 0's quick pass, produces a concrete packet for Layer 4.

| Step | Action | Key Output |
|------|--------|------------|
| **H — Hone {TARGET}** | Deepen Layer 0's {END}. Explicit scope, constraints, non-goals, verification criteria. "Bounded excellence within explicit scope." | {TARGET}: statement, acceptance criteria, scope, non-goals, inferences |
| **O — Observe {NOW}** | Facts with provenance, assumptions, unknowns, constraint ledger, contradictions. Facts without source become assumptions. | {NOW}: facts[], assumptions[], unknowns[], constraints[], conflicts[] |
| **L — Ladder backward** | From {TARGET} to {NOW}, outside-in. Abduction for hidden causes, deduction for necessary conditions, induction for project patterns. No forward plan yet. | {BACKWARD_CHAIN}: linked conditions from target to current state |
| **M — Map {VARIABLES}** | Type each: factual / decision / constraint / assumption-risk. Blocking status + resolution route. | {VARIABLES}: id, type, question, aspirational value, evidence, impact, blocking, resolution route |
| **E — Establish / re-enter** | Marshal resources. Blocking factual → Layer 2 research. Blocking decision → resolve from constraints or escalate. Constraint conflict → stop. Merge findings into {NOW}, rerun O/L/M. | Resolved facts, open decisions, hypotheses, resource notes |
| **S — Synthesize** | Package Layer 4 packet. Every plan step traces to backward chain; every assumption has a preflight check; every verification proves part of TARGET. | {PLAN}, {PREFLIGHT}, {VERIFY}, {PIVOTS}, {CONTEXT/DELEGATION} |

**Loop gate**: Proceed only when TARGET is bounded, NOW is sourced, backward chain reaches NOW, constraints are consistent, and no blocking variables remain. Re-entry: new fact → back to O; new variable → back to M; contradiction → back to O.

#### HOLMES Compact Prompt Form (~350 tokens)

> Layer 3 — HOLMES inner loop (Tier 2/3 only). Layer 0 already produced quick {END,HERE,DELTA}; Layer 1 already routed. Deepen, do not re-triage. Layer 2 may research; Layer 4 executes. You produce Layer 4's briefing, not tool-specific scripts.
>
> **H — Hone TARGET.** Refine {END} from explicit ask, relevant history, constraints, and justified intent. State the user/system-visible outcome, bounded excellence within scope, non-goals/forbidden changes, and how done will be proven.
>
> **O — Observe NOW.** Deepen {HERE}. Ledger facts, assumptions, unknowns, and constraints with provenance. Facts without source become assumptions. Record must/must-not rules and contradictions.
>
> **L — Ladder backward.** Reason from TARGET to NOW, outside-in. For each required end-state truth, ask what must be true immediately before it; repeat until it touches NOW. Use abduction for likely hidden causes, deduction for necessary conditions, induction for project patterns. No forward plan yet.
>
> **M — Map VARIABLES.** Every placeholder that can change the plan gets id, type, desired/aspirational value, evidence, impact, blocker status, and resolution route. Factual variables have discoverable answers. Decision variables require judgment/preference. Constraint variables expose rule conflicts. Only non-blocking assumptions may survive, and only with checks.
>
> **E — Establish/re-enter.** Marshal generic resources before planning. Blocking factual variable → send exact question/scope/evidence shape to Layer 2; merge findings into NOW and rerun O/L/M. Blocking decision variable → resolve from constraints/history/default behavior or escalate; then rerun. Constraint conflict → stop. Gate passes only when TARGET is bounded, NOW is sourced, the backward chain reaches NOW, constraints are consistent, and no blocking variables remain.
>
> **S — Synthesize Layer 4 packet.** Produce ordered plan, affected surfaces, dependencies, preflight checks from hypotheses, pivot/abort conditions, verification criteria from TARGET, and context/delegation notes. Every plan step traces to the backward chain; every assumption has a check; every verification proves part of TARGET. If synthesis reveals a blocker, return to M/E.

---

## OMP Surface Mapping

| Framework Concern | OMP Surface | Why |
|---|---|---|
| Persistent cognitive redirect (Layer 0) | **Extension factory** system-prompt append on `before_agent_start` | Package-local context files are not loaded by `--extension ./`; the factory makes the prompt append active locally |
| Forward-chaining detection | **Extension factory** `tool_call` gate | TTSR markdown is retained as source material, but package-local `rules/` are not discovered by `--extension ./` |
| Full HOLMES procedure (Layers 1-3) | **Skill asset** plus `/holmes` command | `skills/holmes/SKILL.md` remains the playbook; local runtime access goes through the registered command |
| Research agent patterns (Layer 2) | **Static agent assets** | Package-local `agents/` are not discovered by `--extension ./`; retained for later packaging |
| Execution scaffold (Layer 4) | **Extension factory** command prompts + `tool_result` reminder | Runtime enforcement is active through `src/main.ts` |
| Distribution | **Extension package** (`package.json` + `src/main.ts`) | Local testing uses `omp --extension ./`; publishing is separate |

---

## Key Refinements Over the Original

1. **TTSR is a game-changer.** CC hooks can only inject before/after. TTSR can catch the model *mid-stream* writing bad patterns and redirect. We can catch forward-chaining *as it happens*.
2. **Skills are lazy-loaded.** The CC design paid ~200 tokens/turn for the full prompt on *every* message. With skills, the full procedure only loads when needed. RULES.md carries only the compact Layer 0 redirect.
3. **OMP's `/goal` mode aligns with HOLMES's TARGET philosophy.** The plan includes a `/goal` prompt template that wraps backward-reasoning into goal-mode objectives.
4. **OMP's `/plan` mode maps to Tier 2/3 routing.** Rather than HOLMES reinventing planning, we can leverage `/plan` for the plan-then-execute loop.
5. **Native subagents replace the REPL agent() hack.** The original used `agent()` inside REPL scripts. OMP has typed, scoped, tool-restricted subagents with IRC coordination.

---

## Phases

### Phase 1: Foundation — Plugin Scaffold & Core Context
- Initialize the project as an OMP plugin (`plugin.json`, directory structure)
- Create `AGENTS.md` for this project
- Write the **RULES.md** carrying the compact Layer 0 cognitive redirect (HALT → ENVISION → LOCATE → DELTA → CLASSIFY) — the part that must persist every turn
- Write an **APPEND_SYSTEM.md** variant for users who want HOLMES injected as system-prompt augmentation rather than as a sticky rule

---

## Tool Call Discipline

### Problem
AI agents default to chaining primitive tool calls sequentially: `read()` → `search()` → `read()` → `find()` → `read()`. This is the tool-call equivalent of forward-chaining — each call burns context tokens, decays coherence, and wastes turns. A real engineer writes a script. The agent should too.

### Principle
Maximize quality of effort, not minimize effort. Batch exploratory operations into a single `eval()` call that returns compact facts. Use primitives only when they're genuinely the simpler choice.

### Enforcement Layering
Three surfaces, each catching a different failure mode:

| Surface | What it catches | Mechanism |
|---------|----------------|-----------|
| **RULES.md** | Default behavior — always-on principle | Compact guidance re-injected every turn |
| **TTSR rules** | Intent to forward-chain (in prose/thinking) | Regex aborts stream before tool calls happen |
| **Pre-hook** | Actual runtime primitive burst | Closure state counts consecutive calls per turn, blocks at threshold |

### RULES.md Language (~78 tokens)
> Architect tool use as scripts. For multi-step file discovery or investigation, batch work inside `eval()` with a small JS/Python plan that calls `find`/`search`/`read`, returning only facts needed for the next decision. Sequential primitives burn context and decay coherence. Use direct primitives when simpler: one-shot lookups, hashline anchor capture, or post-edit verification.

### TTSR Rules

**Rule 1: `batch-primitive-prose.md`** — catches "let me read X, then search Y" patterns
```
---
description: Batch exploratory primitive-tool prose plans
condition: "(?is)\\b(?:I(?:'ll| will)|let me)\\b.{0,120}\\b(?:read|search|find)\\b.{0,180}\\b(?:then|next|after(?:ward)?|from there)\\b.{0,120}\\b(?:read|search|find)\\b"
scope: "text, thinking"
---
You are planning an exploratory primitive-tool chain. Stop and collapse the
investigation into one `eval()` cell: enumerate candidates, search/read needed
slices, and return only compact facts for the next decision. Direct primitives
are only for targeted one-shot lookups, hashline anchor capture, or post-edit
verification.
```

**Rule 2: `batch-primitive-numbered.md`** — catches "first I'll read... second I'll search..." patterns
```
---
description: Batch numbered primitive-tool plans
condition: "(?is)\\b(?:first|1\\.)\\b.{0,80}\\b(?:read|search|find)\\b.{0,240}\\b(?:second|2\\.|then|next)\\b.{0,80}\\b(?:read|search|find)\\b"
scope: "text, thinking"
---
You are outlining sequential primitive file-discovery calls. Replace the sequence
with one planned `eval()` operation that batches discovery and emits a compact
result. Keep direct primitives for one-shot lookups, hashline anchor capture, or
verification.
```

**Design decision**: TTSR fires once/session and has no cross-call state. It cannot count consecutive tool calls. Use it only for intent/prose — the hook handles runtime enforcement.

### Pre-Hook: `tool-discipline.ts`

Runtime enforcer with per-turn closure state:
- Counts `read`, `search`, `find` + bash commands used as file primitives (`cat`, `head`, `tail`, `ls`, `grep`, `rg`, `find`, `fd`)
- Resets on `turn_start` and on non-primitive tool calls
- Exempts: URL/resource reads, `read` after `edit`/`write`/`resolve`/`ast_edit`/`task` (verification + anchor capture)
- Blocks at 4th consecutive primitive, or 3rd in classic read→search/find→primitive pattern
- Block message: actionable, tells model to rewrite remaining work as `eval()` cell

```typescript
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const PRIMITIVE = new Set(["read", "search", "find"]);
const EXEMPT_AFTER = new Set(["edit", "write", "resolve", "ast_edit", "task"]);
const MAX_BURST = 3;
const BASH_FILE_PRIMITIVE = /(^|[;&|()\\s])(?:cat|head|tail|less|more|ls|grep|rg|ag|ack|find|fd)(?=\\s|$)/;
const URL_RESOURCE = /^(?:https?:\/\/|pr:\/\/|issue:\/\/|agent:\/\/|artifact:\/\/|memory:\/\/|skill:\/\/)/;

export default function (pi: HookAPI) {
  let burst = 0;
  let lastTool: string | undefined;

  pi.on("turn_start", () => { burst = 0; lastTool = undefined; });

  pi.on("tool_call", (event) => {
    const isPrimitive = PRIMITIVE.has(event.toolName) ||
      (event.toolName === "bash" && BASH_FILE_PRIMITIVE.test(String(event.input.command ?? "")));

    if (!isPrimitive) { burst = 0; lastTool = event.toolName; return; }

    // Exempt verification reads and URL/resource reads
    if (event.toolName === "read") {
      if (lastTool && EXEMPT_AFTER.has(lastTool)) { burst = 0; lastTool = event.toolName; return; }
      if (URL_RESOURCE.test(String(event.input.path ?? ""))) { burst = 0; lastTool = event.toolName; return; }
    }

    burst += 1;
    lastTool = event.toolName;
    if (burst <= MAX_BURST) return;

    return {
      block: true,
      reason: "Primitive exploration chain detected. Rewrite the remaining " +
        "investigation as one eval() cell that batches discovery and returns " +
        "only the facts needed for the next decision. Direct primitives are " +
        "for targeted one-shot lookups, anchor capture, or post-edit verification.",
    };
  });
}
```

### Legitimate Exceptions (primitives ARE correct)
1. Single `read` of a specific file/URL/artifact the user asked about
2. Precise one-shot `search`/`find` for a known symbol or filename
3. Hashline anchor capture: `read()` immediately before `edit()` to get fresh anchors
4. Post-edit/post-write verification reads
5. `read` after `task` returns subagent findings (targeted follow-up)
6. State-dependent debugging where next action genuinely depends on previous result
7. Binary/image/document/web reads where `read()` parser is the capability
8. Mutating or safety-sensitive operations where batching would hide a review boundary
9. When one primitive is genuinely simpler and clearer than an eval() script

### HOLMES Integration: Execution Tags
In HOLMES Step S (Synthesize), every planned operation gets an execution tag:
- **`batch-eval`**: multi-step discovery, investigation, data gathering
- **`direct-primitive`**: one-shot lookups, anchor capture, verification reads
- **`specialized-tool`**: LSP, AST edit, debug, browser, GitHub tools
- **`delegate`**: work that should go to a subagent to protect context window

Layer 4 execution follows the tag. TTSR catches bad intent. Hook catches drift.

### Phase 2: TTSR Rules — Stream-Time Guardrails
- **`forward-chain-guard.md`** — catches the model jumping straight to `edit`/`write`/`bash` tool calls without articulating END/DELTA first (regex against tool call JSON)
- **`assumption-guard.md`** — catches the model stating unverified claims as facts (patterns like "this should work", "I believe", "probably")
- **`edit-without-verify.md`** — catches file edits not followed by a verification read-back
- **`batch-primitive-prose.md`** — catches prose/thinking planning to chain primitives ("let me read X then search Y")
- **`batch-primitive-numbered.md`** — catches numbered sequential primitive plans ("first read... second search...")

### Phase 3: Skill — The Full HOLMES Playbook
- **`holmes` skill** (`skills/holmes/SKILL.md`) — the full Layer 1-4 procedure as an on-demand playbook
  - Description tuned to fire on complex multi-file changes, ambiguous requests, and tasks with unknowns
  - Body contains the HOLMES compact prompt form + classification logic + execution patterns
  - Reference files for examples and patterns (`skill://holmes/references/...`)

### Phase 4: Subagent Definitions — Research Probes
- **`holmes-researcher` agent** — read-only scoped research agent for resolving DELTA unknowns
- **`holmes-verifier` agent** — post-execution verification agent that checks edits landed correctly

### Phase 5: Commands — User-Facing Entry Points
- **`/holmes` command** — explicitly invoke the full HOLMES procedure on the current task
- **`/holmes-goal` command** — compose HOLMES's backward-reasoning into a well-structured `/goal` objective

### Phase 6: Hooks — Behavioral Enforcement
- **`tool-discipline.ts`** (pre-hook): Per-turn primitive burst counter. Blocks at 4th consecutive primitive or 3rd in classic forward-chain pattern. Exempts verification reads, URL reads, post-task reads. See Tool Call Discipline section above.
- **Pre-hook**: On `tool_call` for mutating tools (`edit`, `write`, `bash`), check whether the current turn includes DELTA classification. If not, inject a reminder as tool result context.
- **Post-hook**: On `tool_result` for `edit`/`write`, tag the result with a verification reminder.

### Phase 7: Documentation & Distribution
- `README.md` with installation, configuration, and usage
- Example theme configs showing HOLMES in action
- Publish-ready `plugin.json` with all surfaces declared

### Phase 8: Refinement & Testing
- Test across Tier 1/2/3 scenarios to validate classification accuracy
- Tune TTSR regexes to minimize false positives
- Measure context overhead (RULES.md size vs. benefit)
- Validate that Tier 1 (trivial) requests are not delayed

---

## Proposed `/goal` Objective

For use with `omp /goal` when ready to begin execution:

> Build and ship `omp-holmes`, an OMP plugin that adapts the HOLMES cognitive redirect and reasoning enforcement framework for the Oh My Pi agent harness. The plugin must be installable via `omp install` (npm or git source), distribute cleanly as a self-contained plugin package, and decompose HOLMES into native OMP surfaces: a compact RULES.md for the persistent Layer 0 cognitive redirect, TTSR rules for stream-time guardrails against forward-chaining and unverified assumptions, a skill for the full HOLMES playbook (Layers 1-4), custom subagent definitions for research probes and verification, slash commands for explicit invocation (`/holmes`, `/holmes-goal`), and pre/post hooks for behavioral enforcement on mutating tool calls. Each surface must follow OMP's documented conventions (frontmatter format, directory layout, TypeScript module contracts). The plugin README must include installation instructions, configuration options, and usage examples. Deliverables: a working plugin directory with `plugin.json`, all surfaces implemented, and documentation — testable by running `omp install ./` from the project root.

---

## Open Questions

### Q1: TTSR false positive rate
The `assumption-guard` rule needs careful regex tuning. Phrases like "I believe" appear in legitimate code comments and quoted text. Scope to `text` only? Or also `thinking`?

### Q2: RULES.md size vs. context cost
The Layer 0 redirect needs to be compact enough for every-turn injection but complete enough to actually redirect reasoning. Target: ≤150 tokens.

### Q3: Skill trigger sensitivity
The HOLMES skill description must fire on complex tasks but not on trivial ones. The `condition` field can help, but we need real-world testing to calibrate.

### Q4: Hook complexity vs. TTSR overlap
Hooks and TTSR rules both catch bad behavior. Hooks act at tool-call boundaries; TTSR acts mid-stream. We may find one surface sufficient and the other redundant for certain checks. Start with both, prune during Phase 8.

### Q5: `/plan` integration
Should `/holmes` explicitly route to `/plan` for Tier 2/3? Or should it remain independent and let the user compose them? Leaning toward independence with documentation on composition.

### Q6: Plugin naming
`omp-holmes`? `holmes`? `@omp-holmes/plugin`? Need to settle on npm package name and plugin identity.

---

## Reference Material

All original research lives in `research/`:
- `ralph-chat-prompt.md` — the core cognitive redirect prompt (Layer 0 + behavioral rules), originally named RALPH
- `2026-04-17-ralph-implementation-plan.md` — CC-targeted implementation phases (historical, now superseded by HOLMES)
- `2026-04-17-ralph-framework-design.md` — full architectural design with layer diagrams (historical, inner loop now HOLMES)
- `REFERENCES.md` — canonical index of external resources (CC-focused, for background context)
